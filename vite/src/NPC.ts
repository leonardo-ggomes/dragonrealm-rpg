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

export const NPC_RADIUS = 0.8   // dragão é maior que o personagem

// Fração do clip de ataque em que o dano é aplicado ao player
const NPC_SLASH_HIT_FRACTION = 0.35

// Duração alvo do swing do dragão (em segundos)
const NPC_ATTACK_DURATION = 0.9

// ── Nomes das animações do dragão ─────────────────────────────────────────────
const ANIM = {
    IDLE:    "DragonArmature|Dragon_Flying",   // dragão paira em idle
    CHASE:   "DragonArmature|Dragon_Flying",   // mesma animação em perseguição
    ATTACK:  "DragonArmature|Dragon_Attack",
    ATTACK2: "DragonArmature|Dragon_Attack2",
    HIT:     "DragonArmature|Dragon_Hit",
    DEATH:   "DragonArmature|Dragon_Death",
} as const

class NPC extends Object3D {
    loader: Loader

    mixer!: AnimationMixer
    clips: Record<string, AnimationClip> = {}
    currentAction: AnimationAction | null = null
    currentState: string = ""

    health    = 100
    maxHealth = 100
    isAlive   = true

    // IA
    private readonly DETECT_RANGE = 18   // dragão detecta de longe
    private readonly ATTACK_RANGE = 2.4  // alcance maior (asa + mordida)
    private readonly MOVE_SPEED   = 4.0
    private readonly ATTACK_RATE  = 2.0  // cooldown entre ataques (s)
    private attackCooldown        = 0

    // Alterna entre Attack e Attack2 para variedade
    private attackToggle = false

    private aiState: "idle" | "chase" | "attack" | "dead" = "idle"
    private targetQuaternion = new Quaternion()
    velocity = new Vector3()

    // Hit recovery
    private hitTimer              = 0
    private readonly HIT_DURATION = 0.4

    // Ataque sincronizado
    private isAttacking    = false
    private attackTimer    = 0
    private attackDuration = NPC_ATTACK_DURATION
    private hitFired       = false
    onHitWindow?: () => void

    // Knockback recebido
    private knockbackVel             = new Vector3()
    private readonly KNOCKBACK_DECAY = 8.0

    // Death timer
    private deathTimer              = 0
    private readonly DEATH_DURATION = 3.5   // animação de morte do dragão é mais longa

    // Dano pendente (lido pelo NPCManager via flushDamage)
    _pendingDamage = 0

    // Flag lido por Experience.update() para registrar kill exatamente uma vez
    killCounted = false

    constructor(loader: Loader) {
        super()
        this.loader = loader

        // Hitbox invisível
        const capsule = new Mesh(
            new CapsuleGeometry(NPC_RADIUS, 1.2, 8, 16),
            new MeshBasicMaterial({ color: 0xff0000, wireframe: true, visible: false })
        )
        capsule.position.y = 0.6
        this.add(capsule)

        this.loader.gltfLoad.load("/models/glTF/Dragon.glb", (gltf) => {
            const model = gltf.scene
            model.scale.set(0.3, 0.3, 0.3)
            model.position.y = -0.5

            model.traverse((child) => {
                if (child instanceof Mesh && child.geometry) {
                    child.geometry.computeBoundsTree()
                    child.material.wireframe = false
                    child.userData.type      = "npc"
                    child.userData.parentNpc = this
                }
            })

            this.add(model)

            this.mixer = new AnimationMixer(model)
            gltf.animations.forEach((clip: AnimationClip) => {
                this.clips[clip.name] = clip
            })

            // Inicia pairando
            this.setState(ANIM.IDLE, 1.0)
        })
    }

    // ── Dano recebido ─────────────────────────────────────────────────────────

    takeDamage(amount: number, attackerPos?: Vector3) {
        if (!this.isAlive) return

        this.health = Math.max(0, this.health - amount)

        if (this.health > 0) {
            this.setState(ANIM.HIT, 1.2)
            this.hitTimer    = this.HIT_DURATION
            this.isAttacking = false
            this.hitFired    = false
            this.attackTimer = 0

            if (attackerPos) {
                const kb = new Vector3(
                    this.position.x - attackerPos.x,
                    0,
                    this.position.z - attackerPos.z
                )
                if (kb.lengthSq() > 0.001) {
                    kb.normalize().multiplyScalar(3.5)
                    this.knockbackVel.copy(kb)
                }
            }
        } else {
            this.die()
        }
    }

    private die() {
        if (!this.isAlive) return
        this.isAlive     = false
        this.killCounted = false   // será marcado true por Experience.update() no próximo frame
        this.aiState     = "dead"
        this.isAttacking = false
        this.velocity.set(0, 0, 0)
        this.knockbackVel.set(0, 0, 0)
        this.deathTimer  = 0
        this.setState(ANIM.DEATH, 1.0)
    }

    // ── IA ────────────────────────────────────────────────────────────────────

    updateBehavior(playerPos: Vector3, delta: number): number {
        if (!this.isAlive) return 0

        // Cooldown de ataque
        if (this.attackCooldown > 0)
            this.attackCooldown = Math.max(0, this.attackCooldown - delta)

        // Recuperação de hit
        if (this.hitTimer > 0) {
            this.hitTimer -= delta
            if (this.hitTimer <= 0) {
                this.hitTimer     = 0
                this.currentState = ""
            }
            this.applyKnockback(delta)
            return 0
        }

        // Swing em curso
        if (this.isAttacking) {
            this.attackTimer += delta

            const hitMoment = this.attackDuration * NPC_SLASH_HIT_FRACTION
            if (!this.hitFired && this.attackTimer >= hitMoment) {
                this.hitFired = true
                this.onHitWindow?.()
                this.onHitWindow = undefined
            }

            if (this.attackTimer >= this.attackDuration) {
                this.isAttacking  = false
                this.attackTimer  = 0
                this.hitFired     = false
                this.currentState = ""
            }

            this.applyKnockback(delta)
            this.quaternion.slerp(this.targetQuaternion, Math.min(1, delta * 8))
            return 0
        }

        // Máquina de estados
        const dist = this.position.distanceTo(playerPos)

        if (dist <= this.ATTACK_RANGE && this.attackCooldown <= 0) {
            // ── Ataque ───────────────────────────────────────────────────────
            this.aiState = "attack"

            // Alterna entre as duas animações de ataque
            const animName = this.attackToggle ? ANIM.ATTACK2 : ANIM.ATTACK
            this.attackToggle = !this.attackToggle

            const attackClip = this.clips[animName]
            if (attackClip) {
                const timeScale = attackClip.duration / NPC_ATTACK_DURATION

                const action = this.mixer.clipAction(attackClip)
                action.timeScale         = timeScale
                action.setLoop(LoopOnce, 1)
                action.clampWhenFinished = true

                if (this.currentAction) this.currentAction.fadeOut(0.08)
                action.reset().fadeIn(0.06).play()

                this.currentAction = action
                this.currentState  = animName

                this.isAttacking    = true
                this.attackTimer    = 0
                this.hitFired       = false
                this.attackDuration = NPC_ATTACK_DURATION
                this.attackCooldown = this.ATTACK_RATE

                const targetPos = playerPos.clone()
                this.onHitWindow = () => {
                    if (this.position.distanceTo(targetPos) <= this.ATTACK_RANGE * 1.4) {
                        this._pendingDamage = 15   // dragão causa mais dano
                    }
                }
            }

        } else if (dist <= this.DETECT_RANGE) {
            // ── Perseguição (voo) ─────────────────────────────────────────────
            this.aiState = "chase"

            // timeScale do voo proporcional à velocidade de aproximação
            const flightSpeed = Math.max(0.6, this.MOVE_SPEED / 4.5)
            this.setStateWithSpeed(ANIM.CHASE, flightSpeed)

            const dir = new Vector3(
                playerPos.x - this.position.x,
                0,
                playerPos.z - this.position.z
            ).normalize()

            this.velocity.lerp(
                dir.clone().multiplyScalar(this.MOVE_SPEED),
                Math.min(1, delta * 6)
            )

            this.position.x += this.velocity.x * delta
            this.position.z += this.velocity.z * delta

            // Leve flutuação vertical ao voar
            this.position.y += Math.sin(Date.now() * 0.002) * 0.008

            this.targetQuaternion.setFromAxisAngle(
                new Vector3(0, 1, 0),
                Math.atan2(dir.x, dir.z)
            )

        } else {
            // ── Idle (paira no lugar) ─────────────────────────────────────────
            this.aiState = "idle"
            this.setState(ANIM.IDLE, 0.8)
            this.velocity.multiplyScalar(0.85)

            // Flutuação suave em idle
            this.position.y += Math.sin(Date.now() * 0.0015) * 0.006
        }

        this.applyKnockback(delta)
        this.quaternion.slerp(this.targetQuaternion, Math.min(1, delta * 8))
        return 0
    }

    flushDamage(): number {
        const d = this._pendingDamage
        this._pendingDamage = 0
        return d
    }

    // ── Death update ──────────────────────────────────────────────────────────

    updateDeath(delta: number): boolean {
        if (this.isAlive) return false
        this.deathTimer += delta
        return this.deathTimer >= this.DEATH_DURATION
    }

    // ── Respawn ───────────────────────────────────────────────────────────────

    respawn(position: Vector3) {
        // FIX Bug 3: NÃO seta isAlive=false aqui para evitar que Experience.update()
        // conte este NPC como "morto novamente" no mesmo frame, disparando onDragonKilled
        // a mais. Todo o estado é preparado antes de isAlive=true ao final.
        this.health         = this.maxHealth
        this.aiState        = "idle"
        this.isAttacking    = false
        this.attackTimer    = 0
        this.hitFired       = false
        this.attackCooldown = 0
        this.hitTimer       = 0
        this.deathTimer     = 0
        this.velocity.set(0, 0, 0)
        this.knockbackVel.set(0, 0, 0)
        this._pendingDamage = 0
        this.killCounted    = false

        this.position.copy(position)

        if (this.mixer && this.clips[ANIM.IDLE]) {
            const action = this.mixer.clipAction(this.clips[ANIM.IDLE])
            if (this.currentAction) this.currentAction.stop()
            action.timeScale = 1.0
            action.setLoop(LoopRepeat, Infinity)
            action.reset().play()
            this.currentAction = action
            this.currentState  = ANIM.IDLE
        } else {
            this.currentState = ""
        }

        this.traverse((child) => {
            if (child instanceof Mesh) child.visible = true
        })

        // FIX Bug 3: isAlive=true apenas depois de todo o estado estar pronto
        this.isAlive = true
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private applyKnockback(delta: number) {
        if (this.knockbackVel.lengthSq() < 0.001) {
            this.knockbackVel.set(0, 0, 0)
            return
        }
        this.position.x += this.knockbackVel.x * delta
        this.position.z += this.knockbackVel.z * delta
        this.knockbackVel.multiplyScalar(Math.max(0, 1 - this.KNOCKBACK_DECAY * delta))
    }

    update(delta: number) {
        if (this.mixer) this.mixer.update(delta)
    }

    setState(name: string, speed: number) {
        if (this.currentState === name || !this.clips[name]) return

        const clip      = this.clips[name]
        const newAction = this.mixer.clipAction(clip)
        newAction.timeScale = speed

        if (name === ANIM.DEATH) {
            newAction.setLoop(LoopOnce, 1)
            newAction.clampWhenFinished = true
        } else {
            newAction.setLoop(LoopRepeat, Infinity)
        }

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

export default NPC