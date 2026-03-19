import {
    CapsuleGeometry,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    AnimationMixer,
    AnimationClip,
    AnimationAction,
    LoopOnce,
    LoopRepeat,
    Vector3,
    Quaternion
} from "three"
import Loader from "./Loader"
import NPC from "./NPC"

export const PLAYER_RADIUS = 0.4

// ── Referências de velocidade para timeScale proporcional ─────────────────────
const WALK_ANIM_REF_SPEED = 3.5
const RUN_ANIM_REF_SPEED  = 5.5

// Fração do clip de slash em que o golpe ocorre
const SLASH_HIT_FRACTION = 0.25

// Limiares de direção para animações direcionais
const DOT_BACK_THRESHOLD = -0.5
const DOT_SIDE_THRESHOLD  =  0.65

type LifeState = "alive" | "dying" | "dead" | "respawning"

const DEATH_ANIM_DURATION  = 2.2
const RESPAWN_FADE_DURATION = 1.4

// ── Parâmetros de animação (feel profissional) ────────────────────────────────
//
// Regra geral de jogos AAA:
//   • Transições de locomotion (idle↔walk↔run): 0.15–0.20s — tempo para os pés
//     se ajustarem sem "teleportar"
//   • Transição para ataque: 0.08s saída + 0.06s entrada — responsivo, sem pop
//   • Transição SAINDO do ataque: 0.18s — o braço precisa voltar suavemente
//   • Hit reaction: duração curta (0.20s) + fade rápido para não travar o player
//   • Roll: entrada instantânea (0.04s) para sentir peso e comprometimento
//
const FADE = {
    LOCO_OUT:   0.18,   // saída de locomotion (idle/walk/run)
    LOCO_IN:    0.15,   // entrada de locomotion
    ATTACK_OUT: 0.08,   // saída rápida para iniciar ataque
    ATTACK_IN:  0.06,   // entrada do ataque (responsivo)
    ATTACK_END: 0.18,   // saída DO ataque (braço volta suave)
    HIT_OUT:    0.06,   // saída para hit reaction
    HIT_IN:     0.05,   // entrada da hit reaction
    HIT_END:    0.12,   // saída DA hit reaction (volta ao normal)
    ROLL_OUT:   0.05,
    ROLL_IN:    0.04,
    DEATH_OUT:  0.12,
    DEATH_IN:   0.12,
}

// Hit reaction: duração REAL que o personagem fica em "stun" (sem travar input)
// Jogos como Hades/Dead Cells usam 0.10–0.18s — apenas flash visual, sem lock
const HIT_STUN_DURATION = 0.18

// Janela em que o player pode cancelar o ataque com um novo clique (combo buffer)
// 60% do clip = após o golpe principal, antes do recovery final
const ATTACK_CANCEL_WINDOW = 0.60

// Duração da rolagem (Roll)
const ROLL_DURATION = 0.55
const ROLL_SPEED    = 8.0

class Player extends Object3D {
    loader: Loader

    mixer!: AnimationMixer
    clips: Record<string, AnimationClip> = {}
    currentAction: AnimationAction | null = null
    currentState: string = ""

    velocity = new Vector3()
    private readonly MAX_SPEED    = 3.5
    private readonly RUN_SPEED    = 6.5
    private readonly ACCELERATION = 35.0
    private readonly FRICTION     = 28.0
    private targetQuaternion = new Quaternion()

    // Vectors scratch pré-alocados — sem new/clone() nos caminhos quentes
    private _accel   = new Vector3()
    private _facing  = new Vector3()
    private _perp    = new Vector3()
    private _rotAxis = new Vector3(0, 1, 0)

    // Histerese de animação direcional — evita troca de Run→Run_Back/Left/Right
    // a cada pequena variação do ângulo (causa o travamento visual ao correr)
    private _lastRunAnim  = "CharacterArmature|Run"
    private _lastRunAngle = 0   // ângulo da última troca de anim (rad)

    // ── Ataque ────────────────────────────────────────────────────────────────
    isAttacking    = false
    private attackTimer    = 0
    private attackDuration = 0
    private hitFired       = false
    onHitWindow?: () => void

    // ── Roll (esquiva) ────────────────────────────────────────────────────────
    isRolling      = false
    private rollTimer    = 0
    private rollDir      = new Vector3()
    private rollCooldown = 0
    private readonly ROLL_COOLDOWN = 1.2

    // ── Hit reaction ─────────────────────────────────────────────────────────
    // NÃO é mais um "stun" que trava tudo — é apenas um timer de animação.
    // O player continua podendo se mover e atacar durante a reação de hit.
    private hitReacting  = false
    private hitReactTimer = 0

    // ── Vida ──────────────────────────────────────────────────────────────────
    health    = 100
    maxHealth = 100
    lifeState: LifeState = "alive"
    get isAlive(): boolean { return this.lifeState === "alive" }

    private deathTimer   = 0
    private respawnTimer = 0

    // ── Hit flash ────────────────────────────────────────────────────────────
    private hitFlashTimer = 0
    private readonly HIT_FLASH_DURATION = 0.18

    onRespawnComplete?: () => void

    constructor(loader: Loader) {
        super()
        this.loader = loader

        const capsule = new Mesh(
            new CapsuleGeometry(PLAYER_RADIUS, 1.0, 8, 16),
            new MeshBasicMaterial({ color: 0x0000ff, wireframe: true, visible: false })
        )
        capsule.position.y = 0.5
        this.add(capsule)

        this.loader.gltfLoad.load("/models/glTF/character$animated.glb", (gltf) => {
            const model = gltf.scene
            model.scale.set(0.7, 0.7, 0.7)

            model.traverse((child) => {
                if (child instanceof Mesh && child.geometry) {
                    child.geometry.computeBoundsTree()
                    child.material.wireframe = false
                }
            })

            this.add(model)
            this.mixer = new AnimationMixer(model)
            gltf.animations.forEach((clip: AnimationClip) => {
                this.clips[clip.name] = clip
            })

            const idleClip = this.clips["CharacterArmature|Idle_Sword"] ?? this.clips["CharacterArmature|Idle"]
            if (idleClip) this.setState(idleClip.name, 1.0)
        })
    }

    // ── Movimento com animações direcionais ───────────────────────────────────

    applyMovement(inputDir: Vector3, isRunning: boolean, delta: number) {
        if (this.lifeState !== "alive") return
        if (this.isRolling) return

        const maxSpeed = isRunning ? this.RUN_SPEED : this.MAX_SPEED

        if (inputDir.length() > 0) {
            // Reutiliza _accel — sem clone() a cada frame
            this._accel.copy(inputDir).multiplyScalar(this.ACCELERATION * delta)
            this.velocity.add(this._accel)
            if (this.velocity.length() > maxSpeed)
                this.velocity.normalize().multiplyScalar(maxSpeed)

            const angle = Math.atan2(inputDir.x, inputDir.z)
            this.targetQuaternion.setFromAxisAngle(this._rotAxis, angle)

            if (!this.isAttacking && !this.hitReacting) {
                const speed = this.velocity.length()
                if (isRunning) {
                    const animName = this.getDirectionalRunAnim(inputDir)
                    this.setStateWithSpeed(animName, Math.max(0.5, speed / RUN_ANIM_REF_SPEED))
                } else {
                    this.setStateWithSpeed("CharacterArmature|Walk",
                        Math.max(0.3, speed / WALK_ANIM_REF_SPEED))
                }
            }
        } else {
            this.velocity.multiplyScalar(Math.max(0, 1 - this.FRICTION * delta))

            // Histerese na troca walk→idle: threshold maior evita flickering
            // quando velocidade oscila perto de zero
            if (this.velocity.length() < 0.12) {
                this.velocity.set(0, 0, 0)
                if (!this.isAttacking && !this.hitReacting) {
                    this.setState(this.idleName(), 1.0)
                }
            } else if (!this.isAttacking && !this.hitReacting) {
                const speed = this.velocity.length()
                const isRun = this.currentState.includes("Run")
                const ref   = isRun ? RUN_ANIM_REF_SPEED : WALK_ANIM_REF_SPEED
                if (this.currentAction)
                    this.currentAction.timeScale = Math.max(0.2, speed / ref)
            }
        }

        this.position.x += this.velocity.x * delta
        this.position.z += this.velocity.z * delta
    }

    private idleName(): string {
        return this.clips["CharacterArmature|Idle_Sword"]
            ? "CharacterArmature|Idle_Sword"
            : "CharacterArmature|Idle"
    }

    private getDirectionalRunAnim(inputDir: Vector3): string {
        // Reutiliza _facing e _perp — sem new Vector3() a cada frame
        this._facing.set(0, 0, 1).applyQuaternion(this.targetQuaternion)
        this._perp.set(-this._facing.z, 0, this._facing.x)

        const dotFwd  = inputDir.dot(this._facing)
        const dotSide = inputDir.dot(this._perp)

        // Determina a animação candidata com base nos dots
        let candidate = "CharacterArmature|Run"
        if (dotFwd < DOT_BACK_THRESHOLD)
            candidate = this.clips["CharacterArmature|Run_Back"] ? "CharacterArmature|Run_Back" : "CharacterArmature|Run"
        else if (Math.abs(dotSide) >= DOT_SIDE_THRESHOLD)
            candidate = dotSide > 0
                ? (this.clips["CharacterArmature|Run_Left"]  ? "CharacterArmature|Run_Left"  : "CharacterArmature|Run")
                : (this.clips["CharacterArmature|Run_Right"] ? "CharacterArmature|Run_Right" : "CharacterArmature|Run")

        // Histerese: só troca de animação se o candidato mudou E a diferença
        // angular for maior que 15° (0.26 rad). Sem isso, qualquer micro-oscilação
        // do inputDir causa fadeOut+fadeIn constante = travamento visual.
        if (candidate !== this._lastRunAnim) {
            const currentAngle = Math.atan2(inputDir.x, inputDir.z)
            const angleDiff    = Math.abs(currentAngle - this._lastRunAngle)
            const wrappedDiff  = Math.min(angleDiff, Math.PI * 2 - angleDiff)

            if (wrappedDiff > 0.26) {   // 15°
                this._lastRunAnim  = candidate
                this._lastRunAngle = currentAngle
            }
        }

        return this._lastRunAnim
    }

    faceWorldPoint(worldPoint: Vector3) {
        if (this.lifeState !== "alive" || this.isRolling) return
        this._facing.set(
            worldPoint.x - this.position.x,
            0,
            worldPoint.z - this.position.z
        )
        if (this._facing.length() < 0.01) return
        this._facing.normalize()
        this.targetQuaternion.setFromAxisAngle(this._rotAxis, Math.atan2(this._facing.x, this._facing.z))
    }

    // ── Ataque ────────────────────────────────────────────────────────────────

    attack(npcs: Mesh[], aimPoint: Vector3): boolean {
        if (this.lifeState !== "alive") return false

        // Roll cancela ataque, mas hit reaction NÃO bloqueia — o player pode
        // atacar mesmo sendo atingido (igual Hades, Dead Cells, Elden Ring).
        if (this.isRolling) return false

        // Se já está atacando, só aceita novo ataque na janela de cancel (após 60% do clip)
        if (this.isAttacking && this.attackTimer < this.attackDuration * ATTACK_CANCEL_WINDOW)
            return false

        const slashClip = this.clips["CharacterArmature|Sword_Slash"]
        if (!slashClip) return false

        const TARGET_ATTACK_DURATION = 0.55
        const timeScale = slashClip.duration / TARGET_ATTACK_DURATION

        // Cancela hit reaction se estiver ativa — ataque tem prioridade
        this.hitReacting  = false
        this.hitReactTimer = 0

        this.isAttacking    = true
        this.attackTimer    = 0
        this.hitFired       = false
        this.attackDuration = TARGET_ATTACK_DURATION

        const action = this.mixer.clipAction(slashClip)
        action.timeScale         = timeScale
        action.setLoop(LoopOnce, 1)
        action.clampWhenFinished = true
        if (this.currentAction) this.currentAction.fadeOut(FADE.ATTACK_OUT)
        action.reset().fadeIn(FADE.ATTACK_IN).play()
        this.currentAction = action
        this.currentState  = "CharacterArmature|Sword_Slash"

        const attackDir = new Vector3(
            aimPoint.x - this.position.x,
            0,
            aimPoint.z - this.position.z
        ).normalize()

        const HIT_RADIUS = 2.0
        const HIT_ANGLE  = Math.PI / 2

        this.onHitWindow = () => {
            const checkedNpcs = new Set<NPC>()
            for (const mesh of npcs) {
                if (mesh.userData.type !== "npc") continue
                const npc = mesh.userData.parentNpc as NPC
                if (checkedNpcs.has(npc) || !npc.isAlive) continue
                checkedNpcs.add(npc)
                const toNpc = new Vector3(
                    npc.position.x - this.position.x,
                    0,
                    npc.position.z - this.position.z
                )
                if (toNpc.length() > HIT_RADIUS) continue
                toNpc.normalize()
                if (attackDir.dot(toNpc) >= Math.cos(HIT_ANGLE))
                    npc.takeDamage(35, this.position)
            }
        }

        return true
    }

    // ── Roll (esquiva) ────────────────────────────────────────────────────────

    roll(inputDir: Vector3): boolean {
        if (this.lifeState !== "alive") return false
        if (this.isRolling) return false
        if (this.rollCooldown > 0) return false
        if (!this.clips["CharacterArmature|Roll"]) return false

        // Roll cancela ataque (comprometimento tático) e hit reaction
        this.isAttacking   = false
        this.hitFired      = false
        this.onHitWindow   = undefined
        this.hitReacting   = false
        this.hitReactTimer = 0

        this.rollDir = inputDir.length() > 0.1
            ? inputDir.clone().normalize()
            : new Vector3(0, 0, 1).applyQuaternion(this.quaternion)

        this.isRolling    = true
        this.rollTimer    = 0
        this.rollCooldown = this.ROLL_COOLDOWN

        this.velocity.copy(this.rollDir).multiplyScalar(ROLL_SPEED)

        const rollClip = this.clips["CharacterArmature|Roll"]
        const ts       = rollClip.duration / ROLL_DURATION

        const action = this.mixer.clipAction(rollClip)
        action.timeScale         = ts
        action.setLoop(LoopOnce, 1)
        action.clampWhenFinished = true
        if (this.currentAction) this.currentAction.fadeOut(FADE.ROLL_OUT)
        action.reset().fadeIn(FADE.ROLL_IN).play()
        this.currentAction = action
        this.currentState  = "CharacterArmature|Roll"

        return true
    }

    // ── Dano recebido ─────────────────────────────────────────────────────────

    takeDamage(amount: number) {
        if (this.lifeState !== "alive") return

        // Roll dá iframes — ignora dano
        if (this.isRolling) return

        this.health = Math.max(0, this.health - amount)
        this.hitFlashTimer = this.HIT_FLASH_DURATION

        if (this.health <= 0) {
            this.health = 0
            this.startDying()
            return
        }

        // Reduz velocidade sem parar completamente — sensação de impacto sem travar
        this.velocity.multiplyScalar(0.25)

        // Hit reaction: toca animação MAS não cancela ataque nem trava input.
        // Se estiver atacando, apenas o flash visual acontece — o golpe continua.
        // Isso é o comportamento padrão em jogos de ação profissionais.
        this.hitReacting   = true
        this.hitReactTimer = 0

        // Só troca animação se não estiver no meio de um ataque
        if (!this.isAttacking) {
            const hitClip = this.clips["CharacterArmature|HitRecieve"]
                ?? this.clips["CharacterArmature|HitRecieve_2"]
            if (hitClip && this.mixer) {
                const action = this.mixer.clipAction(hitClip)
                const ts     = hitClip.duration / HIT_STUN_DURATION
                action.timeScale         = ts
                action.setLoop(LoopOnce, 1)
                action.clampWhenFinished = true
                if (this.currentAction) this.currentAction.fadeOut(FADE.HIT_OUT)
                action.reset().fadeIn(FADE.HIT_IN).play()
                this.currentAction = action
                this.currentState  = hitClip.name
            }
        }
    }

    // ── Morte ─────────────────────────────────────────────────────────────────

    private startDying() {
        this.lifeState    = "dying"
        this.deathTimer   = 0
        this.isAttacking  = false
        this.isRolling    = false
        this.hitReacting  = false
        this.onHitWindow  = undefined
        this.velocity.set(0, 0, 0)

        const deathClip = this.clips["CharacterArmature|Death"]
        if (deathClip && this.mixer) {
            const action = this.mixer.clipAction(deathClip)
            action.timeScale         = deathClip.duration / DEATH_ANIM_DURATION
            action.setLoop(LoopOnce, 1)
            action.clampWhenFinished = true
            if (this.currentAction) this.currentAction.fadeOut(FADE.DEATH_OUT)
            action.reset().fadeIn(FADE.DEATH_IN).play()
            this.currentAction = action
            this.currentState  = "CharacterArmature|Death"
        }
    }

    startRespawn() {
        this.lifeState    = "respawning"
        this.respawnTimer = 0
        this.health       = this.maxHealth
        this.isRolling    = false
        this.hitReacting  = false
        this.rollCooldown = 0
        this.velocity.set(0, 0, 0)
        this.setModelOpacity(0)

        const idleName = this.idleName()
        if (this.clips[idleName] && this.mixer) {
            const action = this.mixer.clipAction(this.clips[idleName])
            action.timeScale = 1.0
            action.setLoop(LoopRepeat, Infinity)
            if (this.currentAction) this.currentAction.stop()
            action.reset().play()
            this.currentAction = action
            this.currentState  = idleName
        }
    }

    // ── Update ────────────────────────────────────────────────────────────────

    update(delta: number) {
        if (this.mixer) this.mixer.update(delta)

        switch (this.lifeState) {
            case "alive":      this.updateAlive(delta);      break
            case "dying":      this.updateDying(delta);      break
            case "respawning": this.updateRespawning(delta); break
        }
    }

    private updateAlive(delta: number) {
        // Slerp delta-corrected — comportamento idêntico em qualquer frame rate.
        // Sem isso: a 120fps o personagem rotaciona 2x mais rápido que a 60fps.
        const rotFactor = 1 - Math.pow(0.01, delta * (this.isRolling ? 20 : 10))
        this.quaternion.slerp(this.targetQuaternion, rotFactor)

        // ── Cooldown do roll ──────────────────────────────────────────────────
        if (this.rollCooldown > 0) this.rollCooldown = Math.max(0, this.rollCooldown - delta)

        // ── Roll ─────────────────────────────────────────────────────────────
        if (this.isRolling) {
            this.rollTimer += delta

            const progress = this.rollTimer / ROLL_DURATION
            const impulse  = ROLL_SPEED * Math.pow(1 - progress, 1.5)
            this.position.x += this.rollDir.x * impulse * delta
            this.position.z += this.rollDir.z * impulse * delta

            if (this.rollTimer >= ROLL_DURATION) {
                this.isRolling = false
                this.rollTimer = 0
                this.velocity.set(0, 0, 0)
                this.setState(this.idleName(), 1.0)
            }
            return
        }

        // ── Hit reaction (timer apenas — NÃO trava input) ────────────────────
        if (this.hitReacting) {
            this.hitReactTimer += delta
            if (this.hitReactTimer >= HIT_STUN_DURATION) {
                this.hitReacting   = false
                this.hitReactTimer = 0
                // Só força retorno à locomotion se não estiver atacando
                if (!this.isAttacking) {
                    // Usa fadeIn suave para não saltar bruscamente de volta ao idle
                    const speed = this.velocity.length()
                    if (speed < 0.1) {
                        this.blendToState(this.idleName(), 1.0, FADE.HIT_END)
                    } else {
                        this.blendToState(
                            "CharacterArmature|Walk",
                            Math.max(0.3, speed / WALK_ANIM_REF_SPEED),
                            FADE.HIT_END
                        )
                    }
                }
            }
            // Continua processando ataque mesmo em hit reaction
        }

        // ── Timer de ataque ───────────────────────────────────────────────────
        if (this.isAttacking) {
            this.attackTimer += delta

            const hitMoment = this.attackDuration * SLASH_HIT_FRACTION
            if (!this.hitFired && this.attackTimer >= hitMoment) {
                this.hitFired = true
                this.onHitWindow?.()
                this.onHitWindow = undefined
            }

            if (this.attackTimer >= this.attackDuration) {
                this.isAttacking = false
                this.attackTimer = 0
                this.hitFired    = false
                // Transição de saída do ataque com fade generoso para suavidade
                const speed = this.velocity.length()
                if (speed < 0.1) {
                    this.blendToState(this.idleName(), 1.0, FADE.ATTACK_END)
                } else if (speed > this.MAX_SPEED * 0.85) {
                    this.blendToStateWithSpeed(
                        "CharacterArmature|Run",
                        speed / RUN_ANIM_REF_SPEED,
                        FADE.ATTACK_END
                    )
                } else {
                    this.blendToStateWithSpeed(
                        "CharacterArmature|Walk",
                        speed / WALK_ANIM_REF_SPEED,
                        FADE.ATTACK_END
                    )
                }
            }
        }

        // ── Hit flash ─────────────────────────────────────────────────────────
        if (this.hitFlashTimer > 0) {
            this.hitFlashTimer -= delta
            const visible = Math.floor(this.hitFlashTimer / 0.045) % 2 === 0
            this.traverse((child) => {
                if (child instanceof Mesh && !child.material.wireframe)
                    child.visible = visible
            })
        } else {
            this.traverse((child) => {
                if (child instanceof Mesh && !child.material.wireframe)
                    child.visible = true
            })
        }
    }

    private updateDying(delta: number) {
        this.deathTimer += delta
        if (this.deathTimer >= DEATH_ANIM_DURATION) this.lifeState = "dead"
    }

    private updateRespawning(delta: number) {
        this.respawnTimer += delta
        const t = Math.min(this.respawnTimer / RESPAWN_FADE_DURATION, 1)
        this.setModelOpacity(this.easeOutCubic(t))
        if (t >= 1) {
            this.lifeState = "alive"
            this.setModelOpacity(1)
            this.onRespawnComplete?.()
        }
    }

    // ── Material ──────────────────────────────────────────────────────────────

    private setModelOpacity(opacity: number) {
        this.traverse((child) => {
            if (child instanceof Mesh && !child.material.wireframe) {
                child.visible = opacity > 0
                if (child.material) {
                    child.material.transparent = opacity < 1
                    child.material.opacity     = opacity
                    child.material.needsUpdate = true
                }
            }
        })
    }

    private easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3) }

    // ── Camada de animação ────────────────────────────────────────────────────
    //
    // setState      — transições de locomotion (loop, fade padrão LOCO)
    // setStateWithSpeed — atualiza timeScale se já na mesma anim, senão troca
    // blendToState  — transição com fadeOut customizável (para saídas de ataque/hit)
    // blendToStateWithSpeed — idem com timeScale variável

    setState(name: string, speed: number) {
        if (this.currentState === name || !this.clips[name]) return
        const clip      = this.clips[name]
        const newAction = this.mixer.clipAction(clip)
        newAction.timeScale = speed
        newAction.setLoop(LoopRepeat, Infinity)
        if (this.currentAction) this.currentAction.fadeOut(FADE.LOCO_OUT)
        newAction.reset().fadeIn(FADE.LOCO_IN).play()
        this.currentAction = newAction
        this.currentState  = name
    }

    private setStateWithSpeed(name: string, speed: number) {
        if (!this.clips[name]) return
        if (this.currentState === name && this.currentAction) {
            this.currentAction.timeScale = Math.max(0.1, speed)
            return
        }
        const clip      = this.clips[name]
        const newAction = this.mixer.clipAction(clip)
        newAction.timeScale = Math.max(0.1, speed)
        newAction.setLoop(LoopRepeat, Infinity)
        if (this.currentAction) this.currentAction.fadeOut(FADE.LOCO_OUT)
        newAction.reset().fadeIn(FADE.LOCO_IN).play()
        this.currentAction = newAction
        this.currentState  = name
    }

    // Transição com fadeOut explícito — usada nas saídas de ataque e hit reaction
    private blendToState(name: string, speed: number, fadeOutDuration: number) {
        if (!this.clips[name]) return
        if (this.currentState === name) return
        const clip      = this.clips[name]
        const newAction = this.mixer.clipAction(clip)
        newAction.timeScale = speed
        newAction.setLoop(LoopRepeat, Infinity)
        if (this.currentAction) this.currentAction.fadeOut(fadeOutDuration)
        newAction.reset().fadeIn(FADE.LOCO_IN).play()
        this.currentAction = newAction
        this.currentState  = name
    }

    private blendToStateWithSpeed(name: string, speed: number, fadeOutDuration: number) {
        if (!this.clips[name]) return
        if (this.currentState === name && this.currentAction) {
            this.currentAction.timeScale = Math.max(0.1, speed)
            return
        }
        const clip      = this.clips[name]
        const newAction = this.mixer.clipAction(clip)
        newAction.timeScale = Math.max(0.1, speed)
        newAction.setLoop(LoopRepeat, Infinity)
        if (this.currentAction) this.currentAction.fadeOut(fadeOutDuration)
        newAction.reset().fadeIn(FADE.LOCO_IN).play()
        this.currentAction = newAction
        this.currentState  = name
    }
}

export default Player