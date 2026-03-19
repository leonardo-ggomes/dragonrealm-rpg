import NPC, { NPC_RADIUS } from "./NPC"
import Loader from "./Loader"
import { Group, Mesh, Vector3 } from "three"
import VFXManager from "./VFXManager"

// LOD thresholds
const LOD_FULL_RANGE = 18
const LOD_ANIM_RANGE = 35

// Posições de spawn predefinidas — NPCs revivem em uma delas aleatoriamente,
// longe do player (escolhe a mais distante se possível)
const SPAWN_POOL: Array<{ x: number; y: number; z: number }> = [
    { x:  5,  y: -1.5, z: -10 },
    { x: -3,  y: -1.5, z: -8  },
    { x:  8,  y: -1.5, z: -5  },
    { x: -6,  y: -1.5, z: -14 },
    { x:  12, y: -1.5, z: -18 },
    { x: -10, y: -1.5, z: -20 },
    { x:  0,  y: -1.5, z: -22 },
    { x:  15, y: -1.5, z: -8  },
]

// Tempo de espera antes de respawnar (s)
const RESPAWN_DELAY = 4.0
// Distância mínima do player para escolher ponto de spawn
const MIN_SPAWN_DIST = 12.0

class NPCManager {
    npcs: NPC[] = []
    group: Group = new Group()
    loader: Loader

    // Fila de respawn: { npc, timer }
    private respawnQueue: Array<{ npc: NPC; timer: number }> = []

    constructor(loader: Loader) {
        this.loader = loader
    }

    spawn(position: { x: number; y: number; z: number }) {
        const npc = new NPC(this.loader)
        npc.position.set(position.x, position.y, position.z)
        this.npcs.push(npc)
        this.group.add(npc)
    }

    // experience e vfx: any para evitar import circular
    update(delta: number, playerPos: Vector3, experience?: any, vfx?: VFXManager): number {
        // ── Processa fila de respawn ───────────────────────────────────────────
        for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
            const entry = this.respawnQueue[i]
            entry.timer -= delta

            if (entry.timer <= 0) {
                const spawnPos = this.chooseFarSpawn(playerPos)
                entry.npc.respawn(new Vector3(spawnPos.x, spawnPos.y, spawnPos.z))

                // Reinsere na lista de npcs ativos
                if (!this.npcs.includes(entry.npc)) {
                    this.npcs.push(entry.npc)
                }

                this.respawnQueue.splice(i, 1)
            }
        }

        // ── Remove NPCs que caíram fora da cena ───────────────────────────────
        this.npcs = this.npcs.filter(n => n.isAlive || n.parent !== null)

        let totalDamage = 0

        for (const npc of this.npcs) {
            const dist = npc.position.distanceTo(playerPos)

            // ── Animação de morte (delta-based, sem setTimeout) ───────────────
            if (!npc.isAlive) {
                npc.update(delta)
                const ready = npc.updateDeath(delta)
                if (ready) {
                    this.scheduleRespawn(npc)
                    // Remove da lista de ativos temporariamente
                    this.npcs = this.npcs.filter(n => n !== npc)
                }
                continue
            }

            if (dist > LOD_ANIM_RANGE) continue

            npc.update(delta)

            if (dist > LOD_FULL_RANGE) continue

            // IA completa
            npc.updateBehavior(playerPos, delta)

            // Coleta dano via flushDamage (sincronizado com hit window)
            const damage = npc.flushDamage()

            if (damage > 0) {
                totalDamage += damage

                // VFX: arco vermelho do ataque do NPC
                if (vfx) {
                    const forward = new Vector3(
                        playerPos.x - npc.position.x,
                        0,
                        playerPos.z - npc.position.z
                    ).normalize()
                    vfx.npcAttackSlash(npc.position.clone(), forward)
                }

                // Knockback no player
                if (experience) {
                    const dir = new Vector3(
                        playerPos.x - npc.position.x,
                        0,
                        playerPos.z - npc.position.z
                    )
                    experience.applyPlayerKnockback(dir, 3.5)
                }
            }
        }

        this.resolveNpcCollisions()

        return totalDamage
    }

    // ── Respawn helpers ───────────────────────────────────────────────────────

    private scheduleRespawn(npc: NPC) {
        // Esconde o NPC enquanto aguarda respawn
        npc.traverse((child) => {
            if (child instanceof Mesh) child.visible = false
        })

        this.respawnQueue.push({ npc, timer: RESPAWN_DELAY })
    }

    private chooseFarSpawn(playerPos: Vector3): { x: number; y: number; z: number } {
        // Ordena por distância ao player (maior primeiro)
        const sorted = [...SPAWN_POOL].sort((a, b) => {
            const da = new Vector3(a.x, a.y, a.z).distanceTo(playerPos)
            const db = new Vector3(b.x, b.y, b.z).distanceTo(playerPos)
            return db - da   // mais longe primeiro
        })

        // Pega o mais distante que seja > MIN_SPAWN_DIST, senão o mais distante de todos
        const good = sorted.find(p =>
            new Vector3(p.x, p.y, p.z).distanceTo(playerPos) >= MIN_SPAWN_DIST
        )
        return good ?? sorted[0]
    }

    // ── Colisão NPC ↔ NPC ────────────────────────────────────────────────────

    private resolveNpcCollisions() {
        const minDist = NPC_RADIUS * 2

        for (let i = 0; i < this.npcs.length; i++) {
            for (let j = i + 1; j < this.npcs.length; j++) {
                const a = this.npcs[i]
                const b = this.npcs[j]
                if (!a.isAlive || !b.isAlive) continue

                const diff = new Vector3(
                    a.position.x - b.position.x,
                    0,
                    a.position.z - b.position.z
                )
                const dist = diff.length()

                if (dist < minDist && dist > 0.001) {
                    const overlap = (minDist - dist) / 2
                    const push    = diff.normalize().multiplyScalar(overlap)
                    a.position.x += push.x
                    a.position.z += push.z
                    b.position.x -= push.x
                    b.position.z -= push.z
                }
            }
        }
    }

    getAll(): NPC[] {
        return this.npcs
    }

    collectNpcMeshes(npcs: NPC[]): Mesh[] {
        const meshes: Mesh[] = []
        npcs.forEach(npc => {
            npc.traverse((child) => {
                if (child instanceof Mesh && child.userData.type === "npc") {
                    meshes.push(child)
                }
            })
        })
        return meshes
    }
}

export default NPCManager