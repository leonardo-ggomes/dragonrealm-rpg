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
// dot(velocidade, facing) ≤ -0.5 → correndo para trás
// |dot(perp, velocidade)| ≥ 0.65 → correndo para o lado
const DOT_BACK_THRESHOLD = -0.5
const DOT_SIDE_THRESHOLD  =  0.65

type LifeState = "alive" | "dying" | "dead" | "respawning"

const DEATH_ANIM_DURATION   = 2.2
const RESPAWN_FADE_DURATION  = 1.4

// Duração da animação de hit (bloqueia outros estados)
const HIT_ANIM_DURATION = 0.38

// Duração da rolagem (Roll)
const ROLL_DURATION = 0.55
// Velocidade de impulso durante a rolagem
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

    // ── Ataque ────────────────────────────────────────────────────────────────
    isAttacking    = false
    private attackTimer    = 0
    private attackDuration = 0
    private hitFired       = false
    onHitWindow?: () => void

    // ── Roll (esquiva) ────────────────────────────────────────────────────────
    isRolling       = false
    private rollTimer     = 0
    private rollDir       = new Vector3()
    // Cooldown para não fazer roll spam
    private rollCooldown  = 0
    private readonly ROLL_COOLDOWN = 1.2

    // ── Hit stun ─────────────────────────────────────────────────────────────
    private isHitStunned  = false
    private hitStunTimer  = 0

    // ── Vida ──────────────────────────────────────────────────────────────────
    health    = 100
    maxHealth = 100
    lifeState: LifeState = "alive"
    get isAlive(): boolean { return this.lifeState === "alive" }

    private deathTimer   = 0
    private respawnTimer = 0

    // ── Hit flash ────────────────────────────────────────────────────────────
    private hitFlashTimer = 0
    private readonly HIT_FLASH_DURATION = 0.15

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

            // Inicia com Idle_Sword (espada equipada) se disponível
            const idleClip = this.clips["CharacterArmature|Idle_Sword"] ?? this.clips["CharacterArmature|Idle"]
            if (idleClip) this.setState(idleClip.name, 1.0)
        })
    }

    // ── Movimento com animações direcionais ───────────────────────────────────

    applyMovement(inputDir: Vector3, isRunning: boolean, delta: number) {
        if (this.lifeState !== "alive") return
        if (this.isRolling || this.isHitStunned) return   // roll e hitstun bloqueiam input

        const maxSpeed = isRunning ? this.RUN_SPEED : this.MAX_SPEED

        if (inputDir.length() > 0) {
            const accel = inputDir.clone().multiplyScalar(this.ACCELERATION * delta)
            this.velocity.add(accel)
            if (this.velocity.length() > maxSpeed)
                this.velocity.normalize().multiplyScalar(maxSpeed)

            const angle = Math.atan2(inputDir.x, inputDir.z)
            this.targetQuaternion.setFromAxisAngle(new Vector3(0, 1, 0), angle)

            if (!this.isAttacking) {
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

            if (this.velocity.length() < 0.05) {
                this.velocity.set(0, 0, 0)
                if (!this.isAttacking) {
                    const idleName = this.clips["CharacterArmature|Idle_Sword"]
                        ? "CharacterArmature|Idle_Sword"
                        : "CharacterArmature|Idle"
                    this.setState(idleName, 1.0)
                }
            } else if (!this.isAttacking) {
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

    /**
     * Escolhe Run, Run_Back, Run_Left ou Run_Right com base na direção
     * relativa ao facing atual do player (targetQuaternion).
     */
    private getDirectionalRunAnim(inputDir: Vector3): string {
        // Facing atual: eixo Z local no espaço mundo
        const facing = new Vector3(0, 0, 1).applyQuaternion(this.targetQuaternion)
        const perp   = new Vector3(-facing.z, 0, facing.x)   // 90° à esquerda

        const dotFwd  = inputDir.dot(facing)
        const dotSide = inputDir.dot(perp)

        // Retrocesso: muito alinhado com -facing
        if (dotFwd < DOT_BACK_THRESHOLD) {
            return this.clips["CharacterArmature|Run_Back"]
                ? "CharacterArmature|Run_Back"
                : "CharacterArmature|Run"
        }

        // Lateral: componente perpendicular dominante
        if (Math.abs(dotSide) >= DOT_SIDE_THRESHOLD) {
            if (dotSide > 0) {
                return this.clips["CharacterArmature|Run_Left"]
                    ? "CharacterArmature|Run_Left"
                    : "CharacterArmature|Run"
            } else {
                return this.clips["CharacterArmature|Run_Right"]
                    ? "CharacterArmature|Run_Right"
                    : "CharacterArmature|Run"
            }
        }

        return "CharacterArmature|Run"
    }

    faceWorldPoint(worldPoint: Vector3) {
        if (this.lifeState !== "alive" || this.isRolling) return
        const dir = new Vector3(
            worldPoint.x - this.position.x,
            0,
            worldPoint.z - this.position.z
        )
        if (dir.length() < 0.01) return
        dir.normalize()
        this.targetQuaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(dir.x, dir.z))
    }

    // ── Ataque ────────────────────────────────────────────────────────────────

    attack(npcs: Mesh[], aimPoint: Vector3): boolean {
        if (this.isAttacking || this.isRolling || this.isHitStunned) return false
        if (this.lifeState !== "alive") return false

        const slashClip = this.clips["CharacterArmature|Sword_Slash"]
        if (!slashClip) return false

        const TARGET_ATTACK_DURATION = 0.55
        const timeScale = slashClip.duration / TARGET_ATTACK_DURATION

        this.isAttacking    = true
        this.attackTimer    = 0
        this.hitFired       = false
        this.attackDuration = TARGET_ATTACK_DURATION

        const action = this.mixer.clipAction(slashClip)
        action.timeScale         = timeScale
        action.setLoop(LoopOnce, 1)
        action.clampWhenFinished = true
        if (this.currentAction) this.currentAction.fadeOut(0.08)
        action.reset().fadeIn(0.05).play()
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
    // Retorna true se a rolagem foi iniciada

    roll(inputDir: Vector3): boolean {
        if (this.lifeState !== "alive") return false
        if (this.isRolling || this.isAttacking || this.isHitStunned) return false
        if (this.rollCooldown > 0) return false
        if (!this.clips["CharacterArmature|Roll"]) return false

        // Direção da rolagem: inputDir se existir, senão facing atual
        this.rollDir = inputDir.length() > 0.1
            ? inputDir.clone().normalize()
            : new Vector3(0, 0, 1).applyQuaternion(this.quaternion)

        this.isRolling    = true
        this.rollTimer    = 0
        this.rollCooldown = this.ROLL_COOLDOWN

        // Velocidade de impulso na direção da rolagem
        this.velocity.copy(this.rollDir).multiplyScalar(ROLL_SPEED)

        const rollClip = this.clips["CharacterArmature|Roll"]
        const ts       = rollClip.duration / ROLL_DURATION

        const action = this.mixer.clipAction(rollClip)
        action.timeScale         = ts
        action.setLoop(LoopOnce, 1)
        action.clampWhenFinished = true
        if (this.currentAction) this.currentAction.fadeOut(0.06)
        action.reset().fadeIn(0.04).play()
        this.currentAction = action
        this.currentState  = "CharacterArmature|Roll"

        return true
    }

    // ── Dano recebido ─────────────────────────────────────────────────────────

    takeDamage(amount: number) {
        if (this.lifeState !== "alive") return

        // Roll dá iframes — ignora dano enquanto rolando
        if (this.isRolling) return

        this.health = Math.max(0, this.health - amount)
        this.hitFlashTimer = this.HIT_FLASH_DURATION

        if (this.health <= 0) {
            this.health = 0
            this.startDying()
            return
        }

        // Hit stun: interrompe ataque e toca animação de dano
        this.isAttacking  = false
        this.isHitStunned = true
        this.hitStunTimer = 0
        this.velocity.multiplyScalar(0.1)   // para quase completamente

        const hitClip = this.clips["CharacterArmature|HitRecieve"]
            ?? this.clips["CharacterArmature|HitRecieve_2"]
        if (hitClip && this.mixer) {
            const action = this.mixer.clipAction(hitClip)
            const ts     = hitClip.duration / HIT_ANIM_DURATION
            action.timeScale         = ts
            action.setLoop(LoopOnce, 1)
            action.clampWhenFinished = true
            if (this.currentAction) this.currentAction.fadeOut(0.06)
            action.reset().fadeIn(0.04).play()
            this.currentAction = action
            this.currentState  = hitClip.name
        }
    }

    // ── Morte ─────────────────────────────────────────────────────────────────

    private startDying() {
        this.lifeState   = "dying"
        this.deathTimer  = 0
        this.isAttacking = false
        this.isRolling   = false
        this.isHitStunned = false
        this.velocity.set(0, 0, 0)

        const deathClip = this.clips["CharacterArmature|Death"]
        if (deathClip && this.mixer) {
            const action = this.mixer.clipAction(deathClip)
            action.timeScale         = deathClip.duration / DEATH_ANIM_DURATION
            action.setLoop(LoopOnce, 1)
            action.clampWhenFinished = true
            if (this.currentAction) this.currentAction.fadeOut(0.1)
            action.reset().fadeIn(0.1).play()
            this.currentAction = action
            this.currentState  = "CharacterArmature|Death"
        }
    }

    startRespawn() {
        this.lifeState    = "respawning"
        this.respawnTimer = 0
        this.health       = this.maxHealth
        this.isRolling    = false
        this.isHitStunned = false
        this.rollCooldown = 0
        this.velocity.set(0, 0, 0)
        this.setModelOpacity(0)

        const idleName = this.clips["CharacterArmature|Idle_Sword"]
            ? "CharacterArmature|Idle_Sword"
            : "CharacterArmature|Idle"

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
        // Rotação suave — mais rápida durante roll para parecer responsivo
        const rotSpeed = this.isRolling ? 20 : 12
        this.quaternion.slerp(this.targetQuaternion, Math.min(1, delta * rotSpeed))

        // ── Roll ─────────────────────────────────────────────────────────────
        if (this.isRolling) {
            this.rollTimer += delta

            // Aplica impulso decrescente na direção da rolagem
            const progress = this.rollTimer / ROLL_DURATION
            const impulse  = ROLL_SPEED * Math.pow(1 - progress, 1.5)   // ease-out
            this.position.x += this.rollDir.x * impulse * delta
            this.position.z += this.rollDir.z * impulse * delta

            if (this.rollTimer >= ROLL_DURATION) {
                this.isRolling = false
                this.rollTimer = 0
                this.velocity.set(0, 0, 0)
                // Volta para idle suavemente
                const idleName = this.clips["CharacterArmature|Idle_Sword"]
                    ? "CharacterArmature|Idle_Sword"
                    : "CharacterArmature|Idle"
                this.setState(idleName, 1.0)
            }
            // Cooldown do roll
            if (this.rollCooldown > 0) this.rollCooldown = Math.max(0, this.rollCooldown - delta)
            return   // bloqueia outros updates enquanto rola
        }

        // ── Cooldown do roll (fora do roll) ───────────────────────────────────
        if (this.rollCooldown > 0) this.rollCooldown = Math.max(0, this.rollCooldown - delta)

        // ── Hit stun ─────────────────────────────────────────────────────────
        if (this.isHitStunned) {
            this.hitStunTimer += delta
            if (this.hitStunTimer >= HIT_ANIM_DURATION) {
                this.isHitStunned = false
                this.hitStunTimer = 0
                this.currentState = ""   // força reavaliação de animação
            }
            return
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
                const speed = this.velocity.length()
                if (speed < 0.1) {
                    const idleName = this.clips["CharacterArmature|Idle_Sword"]
                        ? "CharacterArmature|Idle_Sword"
                        : "CharacterArmature|Idle"
                    this.setState(idleName, 1.0)
                } else if (speed > this.MAX_SPEED * 0.85) {
                    this.setStateWithSpeed("CharacterArmature|Run", speed / RUN_ANIM_REF_SPEED)
                } else {
                    this.setStateWithSpeed("CharacterArmature|Walk", speed / WALK_ANIM_REF_SPEED)
                }
            }
        }

        // ── Hit flash ─────────────────────────────────────────────────────────
        if (this.hitFlashTimer > 0) {
            this.hitFlashTimer -= delta
            const visible = Math.floor(this.hitFlashTimer / 0.04) % 2 === 0
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

    // ── setState ──────────────────────────────────────────────────────────────

    setState(name: string, speed: number) {
        if (this.currentState === name || !this.clips[name]) return
        const clip      = this.clips[name]
        const newAction = this.mixer.clipAction(clip)
        newAction.timeScale = speed
        newAction.setLoop(LoopRepeat, Infinity)
        if (this.currentAction) this.currentAction.fadeOut(0.15)
        newAction.reset().fadeIn(0.15).play()
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
        if (this.currentAction) this.currentAction.fadeOut(0.12)
        newAction.reset().fadeIn(0.12).play()
        this.currentAction = newAction
        this.currentState  = name
    }
}

export default Player