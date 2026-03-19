/**
 * VFXManager.ts — rewrite com batch geometry
 *
 * Problema anterior: cada partícula = 1 Object3D + 1 draw call.
 * Solução: cada "burst" cria um único Points com N pontos no mesmo buffer.
 * Fogo e sangue usam curvas de fade não-lineares e sizeAttenuation correto.
 *
 * Efeitos:
 *   slashArc()        — arco de espada do player
 *   hitSpark()        — faíscas de impacto
 *   bloodBurst()      — sangue ao acertar NPC
 *   npcAttackSlash()  — arco vermelho do NPC
 *   respawnBurst()    — anel de luz ao ressurgir
 *   tickRunTrail()    — pó ao correr (contínuo)
 *   tickDragonFire()  — fogo do dragão (contínuo, batch)
 */

import {
    AdditiveBlending,
    BufferGeometry,
    Float32BufferAttribute,
    Mesh,
    MeshBasicMaterial,
    NormalBlending,
    Points,
    PointsMaterial,
    RingGeometry,
    Scene,
    TorusGeometry,
    Vector3,
} from "three"

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos
// ─────────────────────────────────────────────────────────────────────────────

/** Uma partícula individual dentro de um batch */
interface Pt {
    x: number; y: number; z: number
    vx: number; vy: number; vz: number
    life: number       // segundos restantes
    maxLife: number
    gravity: number    // positivo = cai, negativo = sobe
    drag: number       // [0,1] por segundo
    size: number       // tamanho base
}

/** Um batch: um único Points com vários pontos */
interface Batch {
    points: Points
    geo: BufferGeometry
    mat: PointsMaterial
    pts: Pt[]
    life: number       // vida máxima do batch inteiro
    maxLife: number
    /** curva de fade: "linear" | "fire" | "blood" */
    fadeCurve: "linear" | "fire" | "blood"
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Constrói um batch a partir de uma lista de pontos iniciais */
function makeBatch(scene: Scene, pts: Pt[], color: number, baseSize: number, blend: any, fadeCurve: Batch["fadeCurve"] = "linear"): Batch {
    const count = pts.length
    const posArr = new Float32Array(count * 3)
    const szArr  = new Float32Array(count)

    for (let i = 0; i < count; i++) {
        posArr[i * 3]     = pts[i].x
        posArr[i * 3 + 1] = pts[i].y
        posArr[i * 3 + 2] = pts[i].z
        szArr[i]          = pts[i].size
    }

    const geo = new BufferGeometry()
    geo.setAttribute("position", new Float32BufferAttribute(posArr, 3))
    // Tamanho por partícula via attribute — requer shader customizado,
    // mas PointsMaterial aceita `size` global; usamos um único size médio
    // e variamos por escala do objeto (workaround simples, zero extra shader)

    const maxLife = Math.max(...pts.map(p => p.maxLife))

    const mat = new PointsMaterial({
        color,
        size: baseSize,
        sizeAttenuation: true,    // tamanho correto com perspectiva — elimina o aspecto "quadrado"
        transparent: true,
        opacity: 1.0,
        blending: blend,
        depthWrite: false,
        vertexColors: false,
    })

    const mesh = new Points(geo, mat)
    scene.add(mesh)

    return { points: mesh, geo, mat, pts, life: maxLife, maxLife, fadeCurve }
}

/** Curvas de fade — retornam opacity [0,1] dado t = vida restante / maxLife */
function fadeFire(t: number): number {
    // Cresce rápido, some suavemente — simula chama real
    if (t > 0.7) return (1 - t) / 0.3         // 30% final: aparece
    if (t > 0.2) return 1.0                    // meio: opaco
    return t / 0.2                             // 20% inicial: fade-out
}
function fadeBlood(t: number): number {
    // Rápido no início (jato), some lento (gotícula)
    return t < 0.5 ? 1.0 : (t - 0.5) / 0.5 // second half fades
}
function fadeLinear(t: number): number { return t }

// ─────────────────────────────────────────────────────────────────────────────
// VFXManager
// ─────────────────────────────────────────────────────────────────────────────

class VFXManager {
    private scene: Scene
    private batches: Batch[] = []

    // Timers contínuos
    private runTrailTimer  = 0
    private readonly TRAIL_INTERVAL = 0.042

    private dragonFireTimers: Map<string, number> = new Map()
    private readonly FIRE_INTERVAL = 0.06

    // Limite máximo de batches vivos para controle de performance
    private readonly MAX_BATCHES = 80

    constructor(scene: Scene) {
        this.scene = scene
    }

    // ── Update ────────────────────────────────────────────────────────────────

    update(delta: number) {
        for (let i = this.batches.length - 1; i >= 0; i--) {
            const b = this.batches[i]
            b.life -= delta

            if (b.life <= 0) {
                this.scene.remove(b.points)
                b.geo.dispose()
                b.mat.dispose()
                this.batches.splice(i, 1)
                continue
            }

            const posAttr = b.geo.getAttribute("position") as Float32BufferAttribute
            const arr     = posAttr.array as Float32Array

            // Tempo global do batch [0=morto, 1=nascido]
            const tBatch = b.life / b.maxLife

            for (let j = 0; j < b.pts.length; j++) {
                const p = b.pts[j]
                if (p.life <= 0) continue

                p.life -= delta

                // Física simples
                p.vx *= Math.pow(p.drag, delta)
                p.vz *= Math.pow(p.drag, delta)
                p.vy -= p.gravity * delta

                p.x += p.vx * delta
                p.y += p.vy * delta
                p.z += p.vz * delta

                arr[j * 3]     = p.x
                arr[j * 3 + 1] = p.y
                arr[j * 3 + 2] = p.z
            }

            posAttr.needsUpdate = true

            // Opacity global do batch via curva
            const tLife = b.life / b.maxLife   // [1=fresh, 0=dead]
            switch (b.fadeCurve) {
                case "fire":   b.mat.opacity = fadeFire(tLife);   break
                case "blood":  b.mat.opacity = fadeBlood(tLife);  break
                default:       b.mat.opacity = fadeLinear(tLife); break
            }
        }
    }

    // ── Adiciona batch com limite de capacidade ────────────────────────────────

    private addBatch(b: Batch) {
        // Se exceder o limite, remove o mais velho (menos vida restante)
        if (this.batches.length >= this.MAX_BATCHES) {
            const oldest = this.batches.reduce((a, b) => a.life < b.life ? a : b)
            this.scene.remove(oldest.points)
            oldest.geo.dispose()
            oldest.mat.dispose()
            this.batches.splice(this.batches.indexOf(oldest), 1)
        }
        this.batches.push(b)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Efeito 1 — SLASH ARC (player)
    // ─────────────────────────────────────────────────────────────────────────

    slashArc(origin: Vector3, forward: Vector3) {
        const COUNT    = 22
        const baseAngle = Math.atan2(forward.x, forward.z)
        const SPREAD   = Math.PI * 0.85
        const pts: Pt[] = []

        for (let i = 0; i < COUNT; i++) {
            const t     = i / (COUNT - 1)
            const angle = baseAngle - SPREAD / 2 + t * SPREAD
            const spd   = 4.5 + Math.random() * 2.0
            pts.push({
                x: origin.x + Math.sin(angle) * 0.3,
                y: origin.y + 0.9 + Math.random() * 0.3,
                z: origin.z + Math.cos(angle) * 0.3,
                vx: Math.sin(angle) * spd,
                vy: 1.2 + Math.random() * 1.0,
                vz: Math.cos(angle) * spd,
                life: 0.25 + Math.random() * 0.1,
                maxLife: 0.35,
                gravity: 5,
                drag: 0.88,
                size: 0.07 + Math.random() * 0.05,
            })
        }

        const life = 0.35
        const b = makeBatch(this.scene, pts, 0x88ddff, 0.08, AdditiveBlending, "linear")
        b.life = b.maxLife = life
        this.addBatch(b)

        // Anel de impacto
        this.spawnRing(origin.clone().setY(origin.y + 0.9), forward, 0x66ccff, 0.5, 0.25)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Efeito 2 — HIT SPARK
    // ─────────────────────────────────────────────────────────────────────────

    hitSpark(position: Vector3) {
        const COUNT = 16
        const pts: Pt[] = []

        for (let i = 0; i < COUNT; i++) {
            const theta = Math.random() * Math.PI * 2
            const phi   = (Math.random() - 0.5) * Math.PI * 0.8
            const spd   = 2.5 + Math.random() * 4.0
            pts.push({
                x: position.x + (Math.random() - 0.5) * 0.2,
                y: position.y + 0.8 + Math.random() * 0.3,
                z: position.z + (Math.random() - 0.5) * 0.2,
                vx: Math.cos(theta) * Math.cos(phi) * spd,
                vy: Math.abs(Math.sin(phi)) * spd * 1.1,
                vz: Math.sin(theta) * Math.cos(phi) * spd,
                life: 0.2 + Math.random() * 0.15,
                maxLife: 0.35,
                gravity: 10,
                drag: 0.84,
                size: 0.06 + Math.random() * 0.04,
            })
        }

        const b = makeBatch(this.scene, pts, 0xff6600, 0.07, AdditiveBlending, "linear")
        this.addBatch(b)

        // Flash de anel
        this.spawnRing(position.clone().setY(position.y + 0.8), new Vector3(0, 0, 1), 0xffffff, 0.25, 0.12)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Efeito 3 — BLOOD BURST
    // Usa fadeCurve "blood" e NormalBlending para parecer real
    // ─────────────────────────────────────────────────────────────────────────

    bloodBurst(position: Vector3, direction: Vector3) {
        const COUNT = 20
        const pts: Pt[] = []

        for (let i = 0; i < COUNT; i++) {
            // Concentrado na direção do golpe + spread cônico
            const spread = 0.7
            const spd    = 1.5 + Math.random() * 3.5

            // Perturbação cônica ao redor da direção
            const perpX =  direction.z
            const perpZ = -direction.x
            const cone  = (Math.random() - 0.5) * spread

            pts.push({
                x: position.x,
                y: position.y + 0.7 + Math.random() * 0.5,
                z: position.z,
                vx: direction.x * spd + perpX * cone * spd,
                vy: 0.8 + Math.random() * 1.8,
                vz: direction.z * spd + perpZ * cone * spd,
                life: 0.28 + Math.random() * 0.22,
                maxLife: 0.5,
                gravity: 14,
                drag: 0.80,
                size: 0.05 + Math.random() * 0.04,
            })
        }

        // Batch vermelho com blend normal — sangue não brilha
        const b = makeBatch(this.scene, pts, 0xcc1111, 0.06, NormalBlending, "blood")
        this.addBatch(b)

        // Segundo batch menor mais escuro (coágulo)
        const COUNT2 = 10
        const pts2: Pt[] = []
        for (let i = 0; i < COUNT2; i++) {
            const spd = 0.5 + Math.random() * 2.0
            pts2.push({
                x: position.x + (Math.random() - 0.5) * 0.3,
                y: position.y + 0.6,
                z: position.z + (Math.random() - 0.5) * 0.3,
                vx: direction.x * spd + (Math.random() - 0.5) * 1.5,
                vy: 0.3 + Math.random() * 0.8,
                vz: direction.z * spd + (Math.random() - 0.5) * 1.5,
                life: 0.35 + Math.random() * 0.3,
                maxLife: 0.65,
                gravity: 18,
                drag: 0.75,
                size: 0.07 + Math.random() * 0.05,
            })
        }
        const b2 = makeBatch(this.scene, pts2, 0x880808, 0.08, NormalBlending, "blood")
        this.addBatch(b2)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Efeito 4 — NPC ATTACK SLASH
    // ─────────────────────────────────────────────────────────────────────────

    npcAttackSlash(origin: Vector3, forward: Vector3) {
        const COUNT    = 16
        const baseAngle = Math.atan2(forward.x, forward.z)
        const SPREAD   = Math.PI * 0.7
        const pts: Pt[] = []

        for (let i = 0; i < COUNT; i++) {
            const t     = i / (COUNT - 1)
            const angle = baseAngle - SPREAD / 2 + t * SPREAD
            const spd   = 3.5 + Math.random() * 1.5
            pts.push({
                x: origin.x,
                y: origin.y + 0.9 + Math.random() * 0.2,
                z: origin.z,
                vx: Math.sin(angle) * spd,
                vy: 1.0 + Math.random() * 0.8,
                vz: Math.cos(angle) * spd,
                life: 0.18 + Math.random() * 0.08,
                maxLife: 0.26,
                gravity: 6,
                drag: 0.88,
                size: 0.06 + Math.random() * 0.03,
            })
        }

        const b = makeBatch(this.scene, pts, 0xff2200, 0.07, AdditiveBlending, "linear")
        this.addBatch(b)
        this.spawnRing(origin.clone().setY(origin.y + 0.9), forward, 0xff3300, 0.4, 0.22)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Efeito 5 — RESPAWN BURST
    // ─────────────────────────────────────────────────────────────────────────

    respawnBurst(origin: Vector3) {
        const COUNT = 32
        const pts: Pt[] = []

        for (let i = 0; i < COUNT; i++) {
            const angle = (i / COUNT) * Math.PI * 2
            const spd   = 3.0 + Math.random() * 4.0
            pts.push({
                x: origin.x,
                y: origin.y + 0.5 + Math.random() * 0.4,
                z: origin.z,
                vx: Math.cos(angle) * spd,
                vy: 1.2 + Math.random() * 3.5,
                vz: Math.sin(angle) * spd,
                life: 0.5 + Math.random() * 0.5,
                maxLife: 1.0,
                gravity: 5,
                drag: 0.86,
                size: 0.09 + Math.random() * 0.07,
            })
        }

        const b = makeBatch(this.scene, pts, 0xffe080, 0.10, AdditiveBlending, "linear")
        this.addBatch(b)

        this.spawnRing(origin.clone().setY(origin.y + 0.5), new Vector3(1, 0, 0), 0xffc040, 0.1, 0.55)
        this.spawnRing(origin.clone().setY(origin.y + 0.5), new Vector3(1, 0, 0), 0xffffff, 0.1, 0.7)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Efeito 6 — RUN TRAIL
    // ─────────────────────────────────────────────────────────────────────────

    tickRunTrail(delta: number, position: Vector3, forward: Vector3, isRunning: boolean) {
        if (!isRunning) { this.runTrailTimer = 0; return }
        this.runTrailTimer += delta
        if (this.runTrailTimer < this.TRAIL_INTERVAL) return
        this.runTrailTimer = 0

        const COUNT = 5
        const back  = forward.clone().negate()
        const pts: Pt[] = []

        for (let i = 0; i < COUNT; i++) {
            const side   = (Math.random() - 0.5) * 0.4
            const spd    = 1.5 + Math.random() * 1.5
            pts.push({
                x: position.x + back.x * 0.2 + (-back.z) * side,
                y: position.y + 0.06 + Math.random() * 0.08,
                z: position.z + back.z * 0.2 + (back.x) * side,
                vx: back.x * spd + (Math.random() - 0.5) * 0.5,
                vy: 0.3 + Math.random() * 0.5,
                vz: back.z * spd + (Math.random() - 0.5) * 0.5,
                life: 0.25 + Math.random() * 0.15,
                maxLife: 0.40,
                gravity: 2.0,
                drag: 0.82,
                size: 0.14 + Math.random() * 0.10,
            })
        }

        const b = makeBatch(this.scene, pts, 0xc8c0b0, 0.15, NormalBlending, "linear")
        b.mat.opacity = 0.22
        this.addBatch(b)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Efeito 7 — DRAGON FIRE (contínuo, batch único por emissão)
    //
    // Três batches por tick — cada um com blending e curva diferente:
    //   • Núcleo quente (additive, fadeCurve fire)    — brasas branco-amarelas
    //   • Chama externa (additive, fadeCurve fire)    — laranja/vermelho, sobe mais
    //   • Fumaça quente (normal, linear, baixa opac)  — cinza-marrom, sobe devagar
    // ─────────────────────────────────────────────────────────────────────────

    tickDragonFire(delta: number, npcId: string, position: Vector3, isAlive: boolean) {
        if (!isAlive) { this.dragonFireTimers.delete(npcId); return }

        const prev = this.dragonFireTimers.get(npcId) ?? 0
        const next = prev + delta
        this.dragonFireTimers.set(npcId, next < this.FIRE_INTERVAL ? next : 0)
        if (next < this.FIRE_INTERVAL) return

        this.spawnDragonFireBatch(position)
    }

    private spawnDragonFireBatch(origin: Vector3) {
        // ── Núcleo: brasas brancas/amarelas, pequenas, subindo rápido ────────
        const CORE = 4
        const corePts: Pt[] = []
        for (let i = 0; i < CORE; i++) {
            const angle = Math.random() * Math.PI * 2
            const r     = Math.random() * 0.5
            corePts.push({
                x: origin.x + Math.cos(angle) * r,
                y: origin.y + 0.3 + Math.random() * 0.8,
                z: origin.z + Math.sin(angle) * r,
                vx: (Math.random() - 0.5) * 0.4,
                vy: 0.6 + Math.random() * 0.8,
                vz: (Math.random() - 0.5) * 0.4,
                life: 0.3 + Math.random() * 0.3,
                maxLife: 0.6,
                gravity: -0.8,    // sobe com aceleração
                drag:    0.97,
                size:    0.05 + Math.random() * 0.04,
            })
        }
        const bCore = makeBatch(this.scene, corePts, 0xffdd88, 0.06, AdditiveBlending, "fire")
        bCore.life = bCore.maxLife = 0.6
        this.addBatch(bCore)

        // ── Chama: laranja/vermelho, maior, sobe mais lento ───────────────────
        const FLAME = 5
        const flamePts: Pt[] = []
        for (let i = 0; i < FLAME; i++) {
            const angle  = Math.random() * Math.PI * 2
            const r      = 0.2 + Math.random() * 0.7
            flamePts.push({
                x: origin.x + Math.cos(angle) * r,
                y: origin.y + 0.1 + Math.random() * 1.0,
                z: origin.z + Math.sin(angle) * r,
                vx: (Math.random() - 0.5) * 0.6,
                vy: 0.35 + Math.random() * 0.55,
                vz: (Math.random() - 0.5) * 0.6,
                life: 0.4 + Math.random() * 0.4,
                maxLife: 0.8,
                gravity: -0.5,
                drag:    0.95,
                size:    0.08 + Math.random() * 0.07,
            })
        }
        // Alterna cor entre laranja e vermelho para variar
        const flameColor = Math.random() < 0.5 ? 0xff5500 : 0xff2200
        const bFlame = makeBatch(this.scene, flamePts, flameColor, 0.09, AdditiveBlending, "fire")
        bFlame.life = bFlame.maxLife = 0.8
        // Opacidade inicial baixa — o fadeFire vai crescer
        bFlame.mat.opacity = 0.35
        this.addBatch(bFlame)

        // ── Fumaça: marrom-cinza, grande, opacidade mínima ────────────────────
        if (Math.random() < 0.55) {   // nem toda emissão gera fumaça
            const smkPts: Pt[] = [{
                x: origin.x + (Math.random() - 0.5) * 0.9,
                y: origin.y + 0.8 + Math.random() * 0.8,
                z: origin.z + (Math.random() - 0.5) * 0.9,
                vx: (Math.random() - 0.5) * 0.25,
                vy: 0.18 + Math.random() * 0.22,
                vz: (Math.random() - 0.5) * 0.25,
                life: 0.7 + Math.random() * 0.5,
                maxLife: 1.2,
                gravity: -0.15,
                drag:    0.93,
                size:    0.22 + Math.random() * 0.16,
            }]
            const bSmk = makeBatch(this.scene, smkPts, 0x331408, 0.24, NormalBlending, "linear")
            bSmk.mat.opacity = 0.09 + Math.random() * 0.07
            bSmk.life = bSmk.maxLife = 1.2
            this.addBatch(bSmk)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Anel de impacto / expansivo (Mesh, não batch)
    // ─────────────────────────────────────────────────────────────────────────

    private spawnRing(center: Vector3, forward: Vector3, color: number, startScale: number, duration: number) {
        const geo = new TorusGeometry(startScale, 0.035, 5, 28, Math.PI * 0.8)
        const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.75, blending: AdditiveBlending, depthWrite: false })
        const ring = new Mesh(geo, mat)
        ring.position.copy(center)
        ring.rotation.x = Math.PI / 2
        ring.rotation.z = Math.atan2(forward.x, forward.z)
        this.scene.add(ring)

        let elapsed = 0
        const fade = () => {
            elapsed += 0.016
            const p = Math.min(elapsed / duration, 1)
            ring.scale.setScalar(1 + p * 2.5)
            mat.opacity = 0.75 * (1 - p)
            if (p < 1) requestAnimationFrame(fade)
            else { this.scene.remove(ring); geo.dispose(); mat.dispose() }
        }
        fade()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Limpeza
    // ─────────────────────────────────────────────────────────────────────────

    dispose() {
        for (const b of this.batches) {
            this.scene.remove(b.points)
            b.geo.dispose()
            b.mat.dispose()
        }
        this.batches = []
    }
}

export default VFXManager