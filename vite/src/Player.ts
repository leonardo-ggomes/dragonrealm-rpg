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

const WALK_ANIM_REF_SPEED   = 3.5
const RUN_ANIM_REF_SPEED    = 5.5
const SLASH_HIT_FRACTION    = 0.25
const ATTACK_CANCEL_WINDOW  = 0.60
const ROLL_DURATION         = 0.55
const ROLL_SPEED            = 8.0
const HIT_REACT_DURATION    = 0.18
const DEATH_ANIM_DURATION   = 2.2
const RESPAWN_FADE_DURATION = 1.4

type LifeState = "alive" | "dying" | "dead" | "respawning"

class Player extends Object3D {
    loader: Loader

    mixer!:        AnimationMixer
    clips:         Record<string, AnimationClip> = {}
    currentAction: AnimationAction | null = null
    currentState:  string = ""

    velocity = new Vector3()
    private readonly MAX_SPEED    = 3.5
    private readonly RUN_SPEED    = 6.5
    private readonly ACCELERATION = 35.0
    private readonly FRICTION     = 28.0
    private targetQuaternion      = new Quaternion()

    // scratch — sem new/clone() nos caminhos quentes
    private _accel   = new Vector3()
    private _rotAxis = new Vector3(0, 1, 0)
    private _dir     = new Vector3()

    isAttacking    = false
    private attackTimer    = 0
    private attackDuration = 0
    private hitFired       = false
    onHitWindow?: () => void

    isRolling      = false
    private rollTimer    = 0
    private rollDir      = new Vector3()
    private rollCooldown = 0
    private readonly ROLL_COOLDOWN = 1.2

    private hitReacting   = false
    private hitReactTimer = 0

    health    = 100
    maxHealth = 100
    lifeState: LifeState = "alive"
    get isAlive(): boolean { return this.lifeState === "alive" }

    private deathTimer   = 0
    private respawnTimer = 0

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
            gltf.animations.forEach((c: AnimationClip) => { this.clips[c.name] = c })
            this.playLoop(this.idleName(), 1.0)
        })
    }

    // ── Movimento ─────────────────────────────────────────────────────────────

    applyMovement(inputDir: Vector3, isRunning: boolean, delta: number) {
        if (this.lifeState !== "alive" || this.isRolling) return

        if (inputDir.length() > 0) {
            const maxSpeed = isRunning ? this.RUN_SPEED : this.MAX_SPEED
            this._accel.copy(inputDir).multiplyScalar(this.ACCELERATION * delta)
            this.velocity.add(this._accel)
            if (this.velocity.length() > maxSpeed)
                this.velocity.normalize().multiplyScalar(maxSpeed)

            // Personagem olha para onde anda — sem conflito com faceWorldPoint
            this.targetQuaternion.setFromAxisAngle(
                this._rotAxis,
                Math.atan2(inputDir.x, inputDir.z)
            )

            if (!this.isAttacking && !this.hitReacting) {
                const spd = this.velocity.length()
                if (isRunning) {
                    this.playLoop("CharacterArmature|Run",
                        Math.max(0.5, spd / RUN_ANIM_REF_SPEED))
                } else {
                    this.playLoop("CharacterArmature|Walk",
                        Math.max(0.3, spd / WALK_ANIM_REF_SPEED))
                }
            }
        } else {
            this.velocity.multiplyScalar(Math.max(0, 1 - this.FRICTION * delta))

            if (this.velocity.length() < 0.1) {
                this.velocity.set(0, 0, 0)
                if (!this.isAttacking && !this.hitReacting)
                    this.playLoop(this.idleName(), 1.0)
            } else if (!this.isAttacking && !this.hitReacting) {
                // Ajusta apenas timeScale durante desaceleração — sem troca de animação
                if (this.currentAction)
                    this.currentAction.timeScale = Math.max(0.15,
                        this.velocity.length() / WALK_ANIM_REF_SPEED)
            }
        }

        this.position.x += this.velocity.x * delta
        this.position.z += this.velocity.z * delta
    }

    // Orienta para o mouse apenas quando quase parado — sem conflito com movimento
    faceWorldPoint(worldPoint: Vector3) {
        if (this.lifeState !== "alive" || this.isRolling) return
        if (this.velocity.length() > 0.3) return
        this._dir.set(
            worldPoint.x - this.position.x, 0,
            worldPoint.z - this.position.z
        )
        if (this._dir.length() < 0.01) return
        this._dir.normalize()
        this.targetQuaternion.setFromAxisAngle(
            this._rotAxis,
            Math.atan2(this._dir.x, this._dir.z)
        )
    }

    private idleName(): string {
        return this.clips["CharacterArmature|Idle_Sword"]
            ? "CharacterArmature|Idle_Sword"
            : "CharacterArmature|Idle"
    }

    // ── Ataque ────────────────────────────────────────────────────────────────

    attack(npcs: Mesh[], aimPoint: Vector3): boolean {
        if (this.lifeState !== "alive" || this.isRolling) return false
        if (this.isAttacking && this.attackTimer < this.attackDuration * ATTACK_CANCEL_WINDOW)
            return false

        const slashClip = this.clips["CharacterArmature|Sword_Slash"]
        if (!slashClip) return false

        const TARGET_DURATION = 0.55
        this.hitReacting   = false
        this.hitReactTimer = 0
        this.isAttacking   = true
        this.attackTimer   = 0
        this.hitFired      = false
        this.attackDuration = TARGET_DURATION

        this.playOnce(slashClip, TARGET_DURATION, 0.08, 0.06)

        const attackDir = new Vector3(
            aimPoint.x - this.position.x, 0,
            aimPoint.z - this.position.z
        ).normalize()

        this.onHitWindow = () => {
            const checked = new Set<NPC>()
            for (const mesh of npcs) {
                if (mesh.userData.type !== "npc") continue
                const npc = mesh.userData.parentNpc as NPC
                if (checked.has(npc) || !npc.isAlive) continue
                checked.add(npc)
                const toNpc = new Vector3(
                    npc.position.x - this.position.x, 0,
                    npc.position.z - this.position.z
                )
                if (toNpc.length() > 2.0) continue
                if (attackDir.dot(toNpc.normalize()) >= Math.cos(Math.PI / 2))
                    npc.takeDamage(35, this.position)
            }
        }
        return true
    }

    // ── Roll ──────────────────────────────────────────────────────────────────

    roll(inputDir: Vector3): boolean {
        if (this.lifeState !== "alive" || this.isRolling) return false
        if (this.rollCooldown > 0) return false
        if (!this.clips["CharacterArmature|Roll"]) return false

        this.isAttacking   = false
        this.hitFired      = false
        this.onHitWindow   = undefined
        this.hitReacting   = false
        this.hitReactTimer = 0

        this.rollDir = inputDir.length() > 0.1
            ? inputDir.clone().normalize()
            : new Vector3(0, 0, 1).applyQuaternion(this.quaternion).normalize()

        // Garante que rollDir é válido — quaternion em transição pode gerar NaN
        if (!isFinite(this.rollDir.x) || !isFinite(this.rollDir.z) || this.rollDir.lengthSq() < 0.001) {
            this.rollDir.set(0, 0, 1)
        }

        this.isRolling    = true
        this.rollTimer    = 0
        this.rollCooldown = this.ROLL_COOLDOWN
        this.velocity.copy(this.rollDir).multiplyScalar(ROLL_SPEED)

        this.playOnce(this.clips["CharacterArmature|Roll"], ROLL_DURATION, 0.05, 0.04)
        return true
    }

    // ── Dano ──────────────────────────────────────────────────────────────────

    takeDamage(amount: number) {
        if (this.lifeState !== "alive" || this.isRolling) return
        this.health = Math.max(0, this.health - amount)
        this.hitFlashTimer = this.HIT_FLASH_DURATION

        if (this.health <= 0) { this.startDying(); return }

        this.velocity.multiplyScalar(0.25)
        this.hitReacting   = true
        this.hitReactTimer = 0

        if (!this.isAttacking) {
            const hitClip = this.clips["CharacterArmature|HitRecieve"]
                ?? this.clips["CharacterArmature|HitRecieve_2"]
            if (hitClip) this.playOnce(hitClip, HIT_REACT_DURATION, 0.06, 0.05)
        }
    }

    // ── Morte / Respawn ───────────────────────────────────────────────────────

    private startDying() {
        this.lifeState   = "dying"
        this.deathTimer  = 0
        this.isAttacking = false
        this.isRolling   = false
        this.hitReacting = false
        this.onHitWindow = undefined
        this.velocity.set(0, 0, 0)
        const clip = this.clips["CharacterArmature|Death"]
        if (clip) this.playOnce(clip, DEATH_ANIM_DURATION, 0.12, 0.12)
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
        if (this.currentAction) this.currentAction.stop()
        this.currentState = ""
        this.playLoop(this.idleName(), 1.0)
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
        // Rotação delta-corrected — igual em qualquer frame rate
        const rotFactor = 1 - Math.pow(0.001, delta * (this.isRolling ? 15 : 8))
        this.quaternion.slerp(this.targetQuaternion, rotFactor)

        if (this.rollCooldown > 0)
            this.rollCooldown = Math.max(0, this.rollCooldown - delta)

        // Roll
        if (this.isRolling) {
            this.rollTimer += delta
            const t       = Math.min(this.rollTimer / ROLL_DURATION, 1)
            const impulse = ROLL_SPEED * Math.pow(1 - t, 1.5)
            // Garante que impulse é finito antes de aplicar — evita NaN na posição
            if (isFinite(impulse) && isFinite(this.rollDir.x) && isFinite(this.rollDir.z)) {
                this.position.x += this.rollDir.x * impulse * delta
                this.position.z += this.rollDir.z * impulse * delta
            }
            if (this.rollTimer >= ROLL_DURATION) {
                this.isRolling = false
                this.rollTimer = 0
                this.velocity.set(0, 0, 0)
                this.playLoop(this.idleName(), 1.0)
            }
            return
        }

        // Hit react
        if (this.hitReacting) {
            this.hitReactTimer += delta
            if (this.hitReactTimer >= HIT_REACT_DURATION) {
                this.hitReacting   = false
                this.hitReactTimer = 0
                if (!this.isAttacking) {
                    const spd = this.velocity.length()
                    this.playLoop(
                        spd < 0.1 ? this.idleName() : "CharacterArmature|Walk",
                        Math.max(0.3, spd / WALK_ANIM_REF_SPEED)
                    )
                }
            }
        }

        // Ataque
        if (this.isAttacking) {
            this.attackTimer += delta
            if (!this.hitFired && this.attackTimer >= this.attackDuration * SLASH_HIT_FRACTION) {
                this.hitFired = true
                this.onHitWindow?.()
                this.onHitWindow = undefined
            }
            if (this.attackTimer >= this.attackDuration) {
                this.isAttacking = false
                this.attackTimer = 0
                this.hitFired    = false
                const spd = this.velocity.length()
                if (spd < 0.1)
                    this.playLoop(this.idleName(), 1.0)
                else if (spd > this.MAX_SPEED * 0.85)
                    this.playLoop("CharacterArmature|Run", spd / RUN_ANIM_REF_SPEED)
                else
                    this.playLoop("CharacterArmature|Walk", spd / WALK_ANIM_REF_SPEED)
            }
        }

        // Hit flash
        if (this.hitFlashTimer > 0) {
            this.hitFlashTimer -= delta
            const vis = Math.floor(this.hitFlashTimer / 0.045) % 2 === 0
            this.traverse((c) => {
                if (c instanceof Mesh && !c.material.wireframe) c.visible = vis
            })
        } else {
            this.traverse((c) => {
                if (c instanceof Mesh && !c.material.wireframe) c.visible = true
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
        this.setModelOpacity(1 - Math.pow(1 - t, 3))
        if (t >= 1) {
            this.lifeState = "alive"
            this.setModelOpacity(1)
            this.onRespawnComplete?.()
        }
    }

    // ── Animação: dois métodos, regra clara ───────────────────────────────────
    //
    // playLoop  — idle / walk / run (loop contínuo)
    //   Se já está na mesma animação: só ajusta timeScale, nunca reinicia o clip.
    //   Se é nova: crossfade de 0.15s.
    //
    // playOnce  — ataque / hit / roll / morte (one-shot)
    //   Sempre reinicia. fadeOutPrev/fadeInNew controlam o crossfade.

    playLoop(name: string, speed: number) {
        if (!this.clips[name] || !this.mixer) return
        if (this.currentState === name) {
            if (this.currentAction) this.currentAction.timeScale = Math.max(0.1, speed)
            return
        }
        const action = this.mixer.clipAction(this.clips[name])
        action.timeScale         = Math.max(0.1, speed)
        action.setLoop(LoopRepeat, Infinity)
        action.clampWhenFinished = false
        if (this.currentAction && this.currentAction !== action)
            this.currentAction.fadeOut(0.15)
        action.reset().fadeIn(0.15).play()
        this.currentAction = action
        this.currentState  = name
    }

    private playOnce(
        clip: AnimationClip,
        targetDuration: number,
        fadeOutPrev: number,
        fadeInNew: number
    ) {
        if (!this.mixer) return
        const action = this.mixer.clipAction(clip)
        action.timeScale         = clip.duration / targetDuration
        action.setLoop(LoopOnce, 1)
        action.clampWhenFinished = true
        if (this.currentAction && this.currentAction !== action)
            this.currentAction.fadeOut(fadeOutPrev)
        action.reset().fadeIn(fadeInNew).play()
        this.currentAction = action
        this.currentState  = clip.name
    }

    private setModelOpacity(opacity: number) {
        this.traverse((child) => {
            if (child instanceof Mesh && !child.material.wireframe) {
                child.visible              = opacity > 0
                child.material.transparent = opacity < 1
                child.material.opacity     = opacity
                child.material.needsUpdate = true
            }
        })
    }
}

export default Player