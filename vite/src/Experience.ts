import {
    BufferGeometry,
    Clock,
    DirectionalLight,
    Mesh,
    Raycaster,
    Vector2,
    Vector3
} from "three"
import Camera from "./Camera"
import MainScene from "./MainScene"
import Renderer from "./Renderer"
import Player from "./Player"
import { PLAYER_RADIUS } from "./Player"
import { NPC_RADIUS } from "./NPC"
import Loader from "./Loader"
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh"
import Stats from "three/examples/jsm/libs/stats.module.js"
import NPCManager from "./NPCManager"
import HUD from "./HUD"
import VFXManager from "./VFXManager"
import PowerInventory, { type Power } from "./PowerInventory"
import GameUI from "./GameUI"

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
Mesh.prototype.raycast = acceleratedRaycast

const MINIMAP_RANGE = 25

// Y abaixo do qual o player é considerado fora do mapa (void)
const VOID_Y = -30
const WALL_PROBE_DIRS = [
    new Vector3( 1,  0,  0),
    new Vector3(-1,  0,  0),
    new Vector3( 0,  0,  1),
    new Vector3( 0,  0, -1),
    new Vector3( 1,  0,  1).normalize(),
    new Vector3(-1,  0,  1).normalize(),
    new Vector3( 1,  0, -1).normalize(),
    new Vector3(-1,  0, -1).normalize(),
]

class Experience {

    camera: Camera
    mainScene: MainScene
    renderer: Renderer
    clock: Clock
    player: Player
    loader: Loader
    npcManager: NPCManager
    hud: HUD

    // Colisao
    collisionMeshes: Mesh[] = []

    // Raycasters reutilizados (sem new a cada frame)
    private groundRaycaster = new Raycaster()
    private wallRaycaster   = new Raycaster()
    private mouseRaycaster  = new Raycaster()

    private readonly DOWN = new Vector3(0, -1, 0)

    // Arrays de hits reutilizados — evita alocar new[] e GC spikes a cada frame
    private _groundHits: any[] = []
    private _wallHits:   any[] = []
    private _mouseHits:  any[] = []

    // Vectors scratch pré-alocados para wall collision — sem clone() no loop quente
    private _wallOrigin = new Vector3()
    private _wallNormal = new Vector3()

    // Mouse throttle — só recomputa raycasting quando o mouse realmente se moveu
    private _mouseDirty = false
    // Fisica vertical
    private velocityY          = 0
    private readonly GRAVITY   = -20
    private isGrounded         = false

    // Pulo
    private readonly JUMP_FORCE  = 9.0
    private jumpBuffered         = false
    private coyoteTimer          = 0
    private readonly COYOTE_TIME = 0.12

    // Wall collision
    private readonly WALL_PROBE_LEN = PLAYER_RADIUS + 0.18

    // Knockback
    private knockbackVel = new Vector3()
    private readonly KNOCKBACK_FRICTION = 14.0

    // Ponto de spawn inicial — registrado quando o mapa termina de carregar
    private spawnPoint = new Vector3(0, 2, 0)

    // Input
    keysPressed = new Set<string>()

    // Mouse mundo
    private mouseWorldPos = new Vector3()
    private screenMouse   = new Vector2()

    // Stamina
    playerStamina = 100
    private readonly STAMINA_DRAIN = 28
    private readonly STAMINA_REGEN = 14
    isRunning = false

    // stats = new Stats()
    vfx!: VFXManager
    powers!: PowerInventory
    private gameUI!: GameUI
    private gameReady = false   // true quando o player fechou as telas de UI

    constructor() {
        // document.body.appendChild(this.stats.dom)

        this.clock      = new Clock()
        this.loader     = new Loader()
        this.camera     = new Camera()
        this.mainScene  = new MainScene()
        this.renderer   = new Renderer(this.camera, this.mainScene)
        this.player     = new Player(this.loader)
        this.npcManager = new NPCManager(this.loader)
        this.hud        = new HUD()

        // UI de loading/instruções — fica na frente até o jogador confirmar
        this.gameUI = new GameUI(() => {
            this.gameReady = true
            this.clock.start()   // reinicia o clock para delta limpo
        })

        this.mainScene.scene.add(this.npcManager.group)

        // VFX — inicializa após a cena estar pronta
        this.vfx = new VFXManager(this.mainScene.scene)

        // Inventário de poderes
        this.powers = new PowerInventory()
        this.powers.onPowerActivated = (power, playerPos, aimPos) => {
            this.executePower(power, playerPos, aimPos)
        }

        this.npcManager.spawn({ x:  5, y: -1.5, z: -10 })
        this.npcManager.spawn({ x: -3, y: -1.5, z: -8  })
        this.npcManager.spawn({ x:  8, y: -1.5, z: -5  })
        this.npcManager.spawn({ x: -6, y: -1.5, z: -14 })

        this.loader.gltfLoad.load("/models/enviroment.glb", (gltf) => {
            const model = gltf.scene
            model.scale.set(.01, .01, .01)
            model.position.set(0, -2, 0)

            model.traverse((child) => {
                if (child instanceof Mesh && child.geometry) {
                    child.geometry.computeBoundsTree()
                    child.material.wireframe = false
                    this.collisionMeshes.push(child)
                }
            })

            const directLight = new DirectionalLight(0xffffff, 1)
            directLight.position.set(3, 6, -5)
            directLight.castShadow = true
            directLight.target = model
            this.mainScene.scene.add(directLight)
            this.mainScene.scene.add(model)

            this.player.position.set(0, 2, 0)
            this.spawnPoint.set(0, 2, 0)
            this.mainScene.scene.add(this.player)

            this.hud.setHealth(this.player.health)
            this.hud.setStamina(this.playerStamina)
            this.hud.setAmmo(0, 0)

            // Mapa carregado — libera a tela de loading
            this.gameUI.setProgress(100)
        }, (xhr) => {
            // Progresso do download (0–100)
            if (xhr.total > 0) {
                this.gameUI.setProgress(Math.round((xhr.loaded / xhr.total) * 90))
            }
        })

        this.setupInput()
        this.update()
    }

    // ── Input ─────────────────────────────────────────────────────────────────

    private setupInput() {
        window.addEventListener("keydown", (e) => {
            const key = e.key.toLowerCase()
            this.keysPressed.add(key)

            if ((key === " " || key === "arrowup") && !e.repeat) {
                this.jumpBuffered = true
            }

            // Roll — tecla Q ou duplo-tap Shift
            if ((key === "q") && !e.repeat && this.player.lifeState === "alive") {
                const inputDir = this.camera.getIsometricDirection(this.keysPressed)
                this.player.roll(inputDir)
            }
        })

        window.addEventListener("keyup", (e) => {
            this.keysPressed.delete(e.key.toLowerCase())
        })

        // Bloqueia menu de contexto do browser (botão direito = poder)
        window.addEventListener("contextmenu", (e) => e.preventDefault())

        window.addEventListener("mousemove", (e) => {
            this.screenMouse.set(
                (e.clientX / window.innerWidth)  *  2 - 1,
                (e.clientY / window.innerHeight) * -2 + 1
            )
            this._mouseDirty = true
        })

        window.addEventListener("mousedown", (e) => {
            // Botão esquerdo — ataque normal
            if (e.button === 0 && this.player.isAlive) {
                const npcMeshes = this.npcManager.collectNpcMeshes(this.npcManager.npcs)
                const forward = new Vector3(
                    this.mouseWorldPos.x - this.player.position.x,
                    0,
                    this.mouseWorldPos.z - this.player.position.z
                ).normalize()
                const swingStarted = this.player.attack(npcMeshes, this.mouseWorldPos)
                if (!swingStarted) return
                this.vfx.slashArc(this.player.position.clone(), forward)
                const originalHitWindow = this.player.onHitWindow
                this.player.onHitWindow = () => {
                    originalHitWindow?.()
                    const nearest = this.npcManager.npcs
                        .filter(n => n.isAlive)
                        .sort((a, b) =>
                            a.position.distanceTo(this.player.position) -
                            b.position.distanceTo(this.player.position)
                        )[0]
                    if (nearest && nearest.position.distanceTo(this.player.position) <= 2.2) {
                        this.vfx.hitSpark(nearest.position.clone())
                        this.vfx.bloodBurst(nearest.position.clone(), forward)
                    }
                }
            }

            // Botão direito — poder equipado
            if (e.button === 2 && this.player.isAlive) {
                e.preventDefault()
                this.powers.activateSelected(
                    this.player.position.clone(),
                    this.mouseWorldPos.clone()
                )
            }
        })
    }

    // ── Mouse mundo (raycaster reutilizado) ──────────────────────────────────

    private updateMouseWorldPosition() {
        // Só recalcula se o mouse se moveu desde o último frame — sem raycast desnecessário
        if (!this._mouseDirty) return
        this._mouseDirty = false

        this.mouseRaycaster.setFromCamera(this.screenMouse, this.camera.perspectiveCamera)

        if (this.collisionMeshes.length > 0) {
            this._mouseHits.length = 0
            for (let i = 0; i < this.collisionMeshes.length; i++) {
                this.mouseRaycaster.intersectObject(this.collisionMeshes[i], true, this._mouseHits)
            }
            if (this._mouseHits.length > 0) {
                this._mouseHits.sort((a, b) => a.distance - b.distance)
                this.mouseWorldPos.copy(this._mouseHits[0].point)
                return
            }
        }

        // Fallback: plano horizontal na altura do player
        const ray   = this.mouseRaycaster.ray
        const denom = ray.direction.y
        if (Math.abs(denom) > 1e-6) {
            const t = -(ray.origin.y - this.player.position.y) / denom
            if (t > 0) ray.at(t, this.mouseWorldPos)
        }
    }

    // ── Gravidade ─────────────────────────────────────────────────────────────

    private applyGravity(delta: number) {
        if (this.isGrounded && this.velocityY <= 0) {
            this.velocityY = 0
        } else {
            this.velocityY += this.GRAVITY * delta
            if (this.velocityY < -30) this.velocityY = -30
        }
        this.player.position.y += this.velocityY * delta
    }

    // ── Ground snap (sem lerp) ────────────────────────────────────────────────

    private checkGround() {
        const origin = this.player.position.clone()
        origin.y += 0.5

        this.groundRaycaster.set(origin, this.DOWN)
        this.groundRaycaster.far = 1.8

        this._groundHits.length = 0
        for (let i = 0; i < this.collisionMeshes.length; i++) {
            this.groundRaycaster.intersectObject(this.collisionMeshes[i], true, this._groundHits)
        }

        if (this._groundHits.length === 0) {
            this.isGrounded = false
            return
        }

        this._groundHits.sort((a, b) => a.distance - b.distance)
        const surfaceY    = this._groundHits[0].point.y
        const distToFloor = this.player.position.y - surfaceY

        if (distToFloor <= 0.12 && this.velocityY <= 0.5) {
            this.player.position.y = surfaceY
            this.velocityY         = 0
            this.isGrounded        = true
            this.coyoteTimer       = this.COYOTE_TIME
        } else {
            this.isGrounded = false
        }
    }

    // ── Pulo ──────────────────────────────────────────────────────────────────

    private handleJump(delta: number) {
        if (!this.isGrounded) {
            this.coyoteTimer = Math.max(0, this.coyoteTimer - delta)
        }

        if (this.jumpBuffered) {
            this.jumpBuffered = false

            if (this.isGrounded || this.coyoteTimer > 0) {
                this.velocityY   = this.JUMP_FORCE
                this.isGrounded  = false
                this.coyoteTimer = 0

                // Toca animação se existir, senão cai de volta pro Run/Walk
                if (this.player.clips["CharacterArmature|Jump_Full_Short"]) {
                    this.player.setState("CharacterArmature|Jump_Full_Short", 1.4)
                }
            }
        }
    }

    // ── Wall collision (radial, 8 direcoes) ───────────────────────────────────

    private resolveWallCollisions() {
        if (this.collisionMeshes.length === 0) return

        // Usa vector scratch pré-alocado — sem clone() no loop quente
        this._wallOrigin.copy(this.player.position)
        this._wallOrigin.y += 0.8

        for (const dir of WALL_PROBE_DIRS) {
            this.wallRaycaster.set(this._wallOrigin, dir)
            this.wallRaycaster.far = this.WALL_PROBE_LEN

            // Reusa o mesmo array a cada probe — length=0 limpa sem realocar
            this._wallHits.length = 0
            for (let i = 0; i < this.collisionMeshes.length; i++) {
                this.wallRaycaster.intersectObject(this.collisionMeshes[i], true, this._wallHits)
            }

            if (this._wallHits.length === 0) continue
            this._wallHits.sort((a, b) => a.distance - b.distance)

            const hit     = this._wallHits[0]
            const overlap = this.WALL_PROBE_LEN - hit.distance
            if (overlap <= 0) continue

            if (hit.face) {
                this._wallNormal.copy(hit.face.normal)
                    .transformDirection(hit.object.matrixWorld)
            } else {
                this._wallNormal.copy(dir).negate()
            }

            this._wallNormal.y = 0
            if (this._wallNormal.lengthSq() < 0.001) continue
            this._wallNormal.normalize()

            this.player.position.x += this._wallNormal.x * overlap
            this.player.position.z += this._wallNormal.z * overlap

            const velDot = this.player.velocity.dot(dir)
            if (velDot > 0) {
                this.player.velocity.x -= dir.x * velDot
                this.player.velocity.z -= dir.z * velDot
            }
        }
    }

    // ── Knockback do player ───────────────────────────────────────────────────

    applyPlayerKnockback(direction: Vector3, force: number) {
        const kb = direction.clone()
        kb.y = 0
        if (kb.lengthSq() < 0.001) return
        kb.normalize().multiplyScalar(force)
        this.knockbackVel.add(kb)
    }

    private updateKnockback(delta: number) {
        if (this.knockbackVel.lengthSq() < 0.0001) {
            this.knockbackVel.set(0, 0, 0)
            return
        }
        this.player.position.x += this.knockbackVel.x * delta
        this.player.position.z += this.knockbackVel.z * delta
        this.knockbackVel.multiplyScalar(Math.max(0, 1 - this.KNOCKBACK_FRICTION * delta))
    }

    // ── Colisao player / NPC ─────────────────────────────────────────────────

    private resolvePlayerNpcCollisions() {
        const minDist = PLAYER_RADIUS + NPC_RADIUS

        for (const npc of this.npcManager.npcs) {
            if (!npc.isAlive) continue

            const diff = new Vector3(
                this.player.position.x - npc.position.x,
                0,
                this.player.position.z - npc.position.z
            )
            const dist = diff.length()

            if (dist < minDist && dist > 0.001) {
                const overlap = minDist - dist
                const push    = diff.normalize().multiplyScalar(overlap * 0.6)
                this.player.position.x += push.x
                this.player.position.z += push.z
            }
        }
    }

    // ── Stamina ───────────────────────────────────────────────────────────────

    private updateStamina(delta: number) {
        if (this.isRunning) {
            this.playerStamina = Math.max(0, this.playerStamina - this.STAMINA_DRAIN * delta)
            if (this.playerStamina === 0) this.hud.showAlert("SEM FOLEGO!", 1500)
        } else {
            this.playerStamina = Math.min(100, this.playerStamina + this.STAMINA_REGEN * delta)
        }
        this.hud.setStamina(this.playerStamina)
    }

    // ── Minimapa ──────────────────────────────────────────────────────────────

    private updateMinimapEnemies() {
        this.hud.clearEnemies()
        for (const npc of this.npcManager.npcs) {
            if (!npc.isAlive) continue
            const rel = npc.position.clone().sub(this.player.position)
            this.hud.addEnemy({ id: npc.uuid, x: rel.x / MINIMAP_RANGE, z: rel.z / MINIMAP_RANGE })
            if (rel.length() < 4) this.hud.showAlert("INIMIGO PROXIMO!", 1500)
        }
    }

    // ── Ciclo de vida do player (morte → respawn) ─────────────────────────────

    private handlePlayerLifecycle() {
        switch (this.player.lifeState) {

            case "dying":
                // Bloqueia input e movimento durante a animação de morte
                // (o player.update() já cuida do timer internamente)
                this.hud.showAlert("VOCÊ MORREU", 99999)
                break

            case "dead":
                // Animação de morte concluída — inicia o respawn
                this.triggerRespawn()
                break

            // "alive" e "respawning" não precisam de ação aqui
        }
    }

    private triggerRespawn() {
        const RESPAWN_DELAY = 1.0   // pausa de escuridão antes do fade-in

        // Muda estado para respawning imediatamente (evita re-trigger)
        // Player.startRespawn() vai definir lifeState = "respawning"
        this.player.lifeState = "respawning" as any   // temporary gate

        setTimeout(() => {
            // Reseta física
            this.velocityY   = 0
            this.isGrounded  = false
            this.coyoteTimer = 0
            this.knockbackVel.set(0, 0, 0)

            // Posiciona no spawn e inicia o fade-in
            this.player.position.copy(this.spawnPoint)
            this.player.startRespawn()

            // Restaura stamina
            this.playerStamina = 100
            this.hud.setStamina(this.playerStamina)
            this.hud.setHealth(this.player.health)
            this.hud.showAlert("", 0)

            // VFX de ressurgimento — explosão de luz no ponto de spawn
            this.vfx.respawnBurst(this.spawnPoint.clone())

            // Callback quando o fade-in terminar
            this.player.onRespawnComplete = () => {
                this.hud.showAlert("", 0)
            }

        }, RESPAWN_DELAY * 1000)
    }

    // ── Void recovery ─────────────────────────────────────────────────────────

    private respawnPlayer() {
        // Reseta física vertical
        this.velocityY   = 0
        this.isGrounded  = false
        this.coyoteTimer = 0

        // Reseta knockback
        this.knockbackVel.set(0, 0, 0)

        // Reseta velocidade horizontal do player
        this.player.velocity.set(0, 0, 0)

        // Teleporta para o spawn
        this.player.position.copy(this.spawnPoint)

        // Se ainda vivo (caiu sem morrer), restaura tudo e continua
        if (this.player.lifeState === "alive") {
            this.player.health = this.player.maxHealth
            this.hud.setHealth(this.player.health)
            this.playerStamina = 100
            this.hud.setStamina(this.playerStamina)
            this.hud.showAlert("CAIU NO VAZIO!", 2000)
            this.vfx.respawnBurst(this.spawnPoint.clone())
        }
    }

    // ── Loop ──────────────────────────────────────────────────────────────────

    update = () => {
        requestAnimationFrame(this.update)
        // this.stats.update()
        this.renderer.update()

        // Não processa lógica até o player fechar as telas de UI
        if (!this.gameReady) return

        const delta = Math.min(this.clock.getDelta(), 0.05)

        this.camera.update(this.player, delta)
        this.updateMouseWorldPosition()

        if (this.mouseWorldPos.lengthSq() > 0) {
            this.player.faceWorldPoint(this.mouseWorldPos)
        }

        const canRun = this.playerStamina > 0
        this.isRunning = this.keysPressed.has("shift") && canRun && (
            this.keysPressed.has("w") || this.keysPressed.has("s") ||
            this.keysPressed.has("a") || this.keysPressed.has("d")
        )

        const inputDir = this.camera.getIsometricDirection(this.keysPressed)
        this.player.applyMovement(inputDir, this.isRunning, delta)

        // Fisica vertical
        this.handleJump(delta)
        this.applyGravity(delta)
        this.checkGround()

        // Void recovery — player caiu fora do mapa (só quando vivo)
        if (this.player.lifeState === "alive" && this.player.position.y < VOID_Y) {
            this.respawnPlayer()
        }

        // Colisoes
        this.resolveWallCollisions()
        this.resolvePlayerNpcCollisions()
        this.updateKnockback(delta)

        // NPCs - passa 'this' para knockback e LOD
        const damageThisFrame = this.npcManager.update(delta, this.player.position, this, this.vfx)

        if (damageThisFrame > 0 && this.player.lifeState === "alive") {
            this.player.takeDamage(damageThisFrame)
            this.hud.setHealth(this.player.health)
        }

        // player.update() dispara o onHitWindow → npc.takeDamage() → isAlive=false.
        // A detecção de kills DEVE acontecer depois disto.
        this.player.update(delta)

        // Detecta mortes pelo flag killCounted no próprio NPC — evita depender de
        // comparação de contagem que quebra quando takeDamage ocorre fora de ordem.
        for (const npc of this.npcManager.npcs) {
            if (!npc.isAlive && !npc.killCounted) {
                npc.killCounted = true
                this.powers.onDragonKilled(this.player.position.clone(), npc.position.clone())
                this.hud.setAmmo(this.powers.getKillCount(), 0)
            }
        }

        // ── Gerencia morte e respawn do player ────────────────────────────────
        this.handlePlayerLifecycle()

        // ── VFX ───────────────────────────────────────────────────────────────
        this.vfx.update(delta)

        // Rastro de corrida — emite atrás do player quando está correndo
        if (this.isRunning && this.isGrounded) {
            const forward = this.player.velocity.clone()
            if (forward.lengthSq() > 0.01) forward.normalize()
            this.vfx.tickRunTrail(delta, this.player.position.clone(), forward, true)
        } else {
            this.vfx.tickRunTrail(delta, this.player.position.clone(), new Vector3(), false)
        }

        // Fogo sutil dos dragões — emite continuamente enquanto vivos
        for (const npc of this.npcManager.npcs) {
            this.vfx.tickDragonFire(delta, npc.uuid, npc.position.clone(), npc.isAlive)
        }

        this.updateStamina(delta)
        this.updateMinimapEnemies()
        this.hud.update(Math.PI * 1.25)

        // Atualiza cooldowns do inventário
        this.powers.update(delta)
    }

    // ── Execução dos superpoderes ─────────────────────────────────────────────

    private executePower(power: Power, playerPos: Vector3, aimPos: Vector3) {
        const dir = new Vector3(
            aimPos.x - playerPos.x,
            0,
            aimPos.z - playerPos.z
        ).normalize()

        // NPCs vivos no alcance do poder
        const inRange = this.npcManager.npcs.filter(npc => {
            if (!npc.isAlive) return false
            return npc.position.distanceTo(aimPos) <= power.range
                || npc.position.distanceTo(playerPos) <= power.range
        })

        switch (power.id) {

            case "wind_slash": {
                // Linha em frente — atinge NPCs no cone à frente
                this.vfx.slashArc(playerPos.clone(), dir)
                inRange.forEach(npc => {
                    const toNpc = npc.position.clone().sub(playerPos).normalize()
                    if (dir.dot(toNpc) > 0.5) npc.takeDamage(power.damage, playerPos)
                })
                break
            }

            case "seismic": {
                // Área ao redor do player
                this.vfx.respawnBurst(playerPos.clone())
                inRange.forEach(npc => {
                    if (npc.position.distanceTo(playerPos) <= power.range)
                        npc.takeDamage(power.damage, playerPos)
                })
                break
            }

            case "crimson_flame": {
                // Explosão no ponto mirado
                this.vfx.respawnBurst(aimPos.clone())
                this.vfx.bloodBurst(aimPos.clone(), dir)
                inRange.forEach(npc => {
                    if (npc.position.distanceTo(aimPos) <= power.range)
                        npc.takeDamage(power.damage, playerPos)
                })
                break
            }

            case "phantom_bolt": {
                // Encadeia até 3 alvos mais próximos
                const targets = inRange
                    .sort((a, b) => a.position.distanceTo(playerPos) - b.position.distanceTo(playerPos))
                    .slice(0, 3)
                targets.forEach(npc => {
                    this.vfx.hitSpark(npc.position.clone())
                    npc.takeDamage(power.damage, playerPos)
                })
                if (targets.length > 0) this.vfx.slashArc(playerPos.clone(), dir)
                break
            }

            case "final_storm": {
                // Tudo ao mesmo tempo em área máxima
                this.vfx.respawnBurst(playerPos.clone())
                this.vfx.slashArc(playerPos.clone(), dir)
                this.vfx.bloodBurst(aimPos.clone(), dir)
                inRange.forEach(npc => {
                    this.vfx.hitSpark(npc.position.clone())
                    npc.takeDamage(power.damage, playerPos)
                })
                break
            }
        }
    }
}

new Experience()