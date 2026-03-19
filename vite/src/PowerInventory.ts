/**
 * PowerInventory.ts
 *
 * Sistema de superpoderes desbloqueáveis por kills de dragão.
 *
 * Poderes disponíveis (desbloqueiam em ordem de kills):
 *   1  kill  → Corte de Vento   — projétil que viaja e causa dano em área
 *   3  kills → Golpe Sísmico    — onda de choque ao redor do player
 *   6  kills → Chama Carmesim   — explosão de fogo no alvo
 *   10 kills → Raio Fantasma    — corrente elétrica que encadeia inimigos
 *   15 kills → Tempestade Final — tudo ao mesmo tempo em área máxima
 *
 * Teclas de ativação: 1, 2, 3, 4, 5 (hotbar inferior)
 * Tecla I: abre/fecha o painel de inventário
 */

import { Vector3 } from "three"

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface Power {
    id:           string
    name:         string
    description:  string
    killsRequired: number
    cooldown:     number           // segundos
    damage:       number
    range:        number           // raio de impacto
    icon:         string           // SVG inline
    color:        string           // cor do efeito VFX
    unlocked:     boolean
    currentCooldown: number        // 0 = pronto
}

export type PowerCallback = (power: Power, playerPos: Vector3, aimPos: Vector3) => void

// ── Definições dos poderes ────────────────────────────────────────────────────

const POWER_DEFS: Omit<Power, "unlocked" | "currentCooldown">[] = [
    {
        id:           "wind_slash",
        name:         "Corte de Vento",
        description:  "Projeta uma lâmina de ar que atravessa inimigos em linha",
        killsRequired: 1,
        cooldown:     3.0,
        damage:       45,
        range:        8.0,
        color:        "#88ffee",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/>
          <path d="M9.6 4.6A2 2 0 1 1 11 8H2"/>
          <path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>
        </svg>`,
    },
    {
        id:           "seismic",
        name:         "Golpe Sísmico",
        description:  "Golpeia o chão criando uma onda de choque circular",
        killsRequired: 3,
        cooldown:     5.0,
        damage:       60,
        range:        4.5,
        color:        "#ffaa44",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M2 12h4l2-8 4 16 2-8h4"/>
          <path d="M5 20c2-1 4-1.5 7-1.5s5 .5 7 1.5"/>
        </svg>`,
    },
    {
        id:           "crimson_flame",
        name:         "Chama Carmesim",
        description:  "Invoca uma explosão de fogo dracônico no ponto mirado",
        killsRequired: 6,
        cooldown:     6.5,
        damage:       80,
        range:        3.5,
        color:        "#ff4422",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M12 2c0 6-6 8-6 13a6 6 0 0 0 12 0c0-5-6-7-6-13z"/>
          <path d="M12 12c0 3-2 4-2 6a2 2 0 0 0 4 0c0-2-2-3-2-6z"/>
        </svg>`,
    },
    {
        id:           "phantom_bolt",
        name:         "Raio Fantasma",
        description:  "Encadeia correntes de energia em até 3 inimigos próximos",
        killsRequired: 10,
        cooldown:     8.0,
        damage:       55,
        range:        6.0,
        color:        "#aa88ff",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>`,
    },
    {
        id:           "final_storm",
        name:         "Tempestade Final",
        description:  "Desencadeia todos os elementos em área máxima",
        killsRequired: 15,
        cooldown:     15.0,
        damage:       120,
        range:        7.0,
        color:        "#ffffff",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>`,
    },
]

// ── PowerInventory ────────────────────────────────────────────────────────────

class PowerInventory {
    private powers: Power[]
    private killCount  = 0
    private activePower: number | null = null   // índice 0-4 do poder equipado na hotbar
    private panelOpen  = false

    // Callback chamado quando um poder é ativado — Experience cria os VFX e dano
    onPowerActivated?: PowerCallback

    // DOM
    private root!: HTMLDivElement
    private hotbarSlots: HTMLDivElement[] = []
    private panelEl!: HTMLDivElement
    private killsDisplay!: HTMLSpanElement

    constructor() {
        this.powers = POWER_DEFS.map(def => ({
            ...def,
            unlocked: false,
            currentCooldown: 0,
        }))

        this.buildDOM()
        this.injectStyles()
        this.bindKeys()
        this.updateHotbar()
    }

    // ── API pública ───────────────────────────────────────────────────────────

    /** Chame quando um NPC (dragão) morrer */
    onDragonKilled(_playerPos: Vector3, _npcPos: Vector3) {
        this.killCount++
        this.killsDisplay.textContent = String(this.killCount)
        this.root.querySelector("#inv-kill-count")!.textContent = String(this.killCount)

        // FIX Bug 1: usa filter para desbloquear TODOS os poderes elegíveis de uma vez,
        // não apenas o primeiro. Garante que kills acumuladas desbloqueiem múltiplos poderes.
        const newUnlocks = this.powers.filter(
            p => !p.unlocked && p.killsRequired <= this.killCount
        )

        if (newUnlocks.length > 0) {
            newUnlocks.forEach(power => {
                power.unlocked = true
                this.showUnlockNotification(power)
            })
            this.updateHotbar()
            this.updatePanel()
        }
    }

    /** Retorna o total de kills — usado pelo HUD */
    getKillCount(): number {
        return this.killCount
    }

    /** Chame todo frame para decrementar cooldowns */
    update(delta: number) {
        let changed = false
        for (const p of this.powers) {
            if (p.currentCooldown > 0) {
                p.currentCooldown = Math.max(0, p.currentCooldown - delta)
                changed = true
            }
        }
        if (changed) this.updateCooldownUI()
    }

    /** Retorna o poder ativo ou null */
    getActivePower(): Power | null {
        if (this.activePower === null) return null
        const p = this.powers[this.activePower]
        return (p?.unlocked) ? p : null
    }

    /** Usa o poder equipado */
    activateSelected(playerPos: Vector3, aimPos: Vector3): boolean {
        const power = this.getActivePower()
        if (!power) return false
        if (power.currentCooldown > 0) return false

        power.currentCooldown = power.cooldown
        this.updateCooldownUI()
        this.onPowerActivated?.(power, playerPos, aimPos)
        return true
    }

    // ── Construção do DOM ─────────────────────────────────────────────────────

    private buildDOM() {
        this.root = document.createElement("div")
        this.root.id = "inv-root"

        // Hotbar
        const hotbar = document.createElement("div")
        hotbar.id = "inv-hotbar"

        for (let i = 0; i < 5; i++) {
            const slot = document.createElement("div")
            slot.className = "inv-slot"
            slot.dataset.index = String(i)
            slot.innerHTML = `
                <div class="inv-slot-inner">
                    <div class="inv-slot-icon"></div>
                    <div class="inv-slot-cooldown"></div>
                    <span class="inv-slot-key">${i + 1}</span>
                    <div class="inv-slot-lock">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                    </div>
                </div>
                <span class="inv-slot-name"></span>
            `
            slot.addEventListener("click", () => this.selectSlot(i))
            this.hotbarSlots.push(slot)
            hotbar.appendChild(slot)
        }

        // Botão de inventário
        const invBtn = document.createElement("button")
        invBtn.id = "inv-toggle-btn"
        invBtn.title = "Inventário [I]"
        invBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <rect x="2" y="7" width="20" height="14" rx="2"/>
                <path d="M16 7V5a2 2 0 0 0-4 0v2M8 7V5a2 2 0 0 0-4 0v2"/>
                <line x1="12" y1="12" x2="12" y2="17"/>
                <line x1="9.5" y1="14.5" x2="14.5" y2="14.5"/>
            </svg>
        `
        invBtn.addEventListener("click", () => this.togglePanel())
        hotbar.appendChild(invBtn)

        // Kills no hotbar
        const killsWrap = document.createElement("div")
        killsWrap.id = "inv-kills-tag"
        killsWrap.innerHTML = `
            <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                <path d="M8 1.5C5 1.5 3 3.5 3 6c0 2 1 3.5 2.5 4.5V12h5v-1.5C12 9.5 13 8 13 6c0-2.5-2-4.5-5-4.5z" stroke="currentColor" stroke-width="1.2"/>
                <rect x="5.5" y="12" width="3" height="2" rx="0.5" stroke="currentColor" stroke-width="1"/>
            </svg>
            <span id="inv-kill-count">0</span>
        `
        hotbar.appendChild(killsWrap)

        // Painel de inventário
        this.panelEl = document.createElement("div")
        this.panelEl.id = "inv-panel"
        this.panelEl.innerHTML = `
            <div id="inv-panel-header">
                <div id="inv-panel-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18" stroke-linecap="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                        <path d="M2 17l10 5 10-5"/>
                        <path d="M2 12l10 5 10-5"/>
                    </svg>
                    Poderes
                </div>
                <button id="inv-panel-close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div id="inv-kills-bar">
                <span>Dragões abatidos:</span>
                <span id="inv-kills-num">0</span>
            </div>
            <div id="inv-grid"></div>
        `

        this.panelEl.querySelector("#inv-panel-close")!
            .addEventListener("click", () => this.togglePanel())

        this.root.appendChild(hotbar)
        this.root.appendChild(this.panelEl)
        document.body.appendChild(this.root)

        this.killsDisplay = this.root.querySelector("#inv-kills-num")!
        this.root.querySelector("#inv-kill-count")!.textContent = "0"
    }

    // ── Hotbar ────────────────────────────────────────────────────────────────

    private updateHotbar() {
        this.powers.forEach((power, i) => {
            const slot    = this.hotbarSlots[i]
            const icon    = slot.querySelector(".inv-slot-icon")!
            const name    = slot.querySelector(".inv-slot-name")!
            const lock    = slot.querySelector(".inv-slot-lock") as HTMLElement
            const cdOverlay = slot.querySelector(".inv-slot-cooldown") as HTMLElement

            if (power.unlocked) {
                slot.classList.remove("locked")
                lock.style.display = "none"
                icon.innerHTML = power.icon
                ;(icon as HTMLElement).style.color = power.color
                name.textContent = power.name
                cdOverlay.style.display = "block"
            } else {
                slot.classList.add("locked")
                lock.style.display = "flex"
                icon.innerHTML = ""
                name.textContent = `${power.killsRequired} kills`
            }

            if (i === this.activePower && power.unlocked) {
                slot.classList.add("active")
            } else {
                slot.classList.remove("active")
            }
        })
    }

    private updateCooldownUI() {
        this.powers.forEach((power, i) => {
            const slot = this.hotbarSlots[i]
            const cd   = slot.querySelector(".inv-slot-cooldown") as HTMLElement
            if (!cd || !power.unlocked) return

            const pct = power.currentCooldown / power.cooldown
            if (pct > 0) {
                cd.style.height  = `${pct * 100}%`
                cd.style.opacity = "1"
            } else {
                cd.style.height  = "0%"
                cd.style.opacity = "0"
            }
        })
    }

    private selectSlot(index: number) {
        const power = this.powers[index]
        if (!power.unlocked) return
        this.activePower = index
        this.updateHotbar()
    }

    // ── Painel de inventário ──────────────────────────────────────────────────

    private togglePanel() {
        this.panelOpen = !this.panelOpen
        if (this.panelOpen) {
            this.updatePanel()
            this.panelEl.classList.add("open")
        } else {
            this.panelEl.classList.remove("open")
        }
    }

    private updatePanel() {
        const grid = this.panelEl.querySelector("#inv-grid")!
        grid.innerHTML = ""

        this.powers.forEach((power, i) => {
            const card = document.createElement("div")
            card.className = "inv-card" + (power.unlocked ? " unlocked" : " locked-card")
            if (i === this.activePower && power.unlocked) card.classList.add("equipped")

            card.innerHTML = `
                <div class="inv-card-icon" style="color:${power.unlocked ? power.color : "rgba(255,255,255,0.15)"}">
                    ${power.icon}
                </div>
                <div class="inv-card-info">
                    <div class="inv-card-name">
                        ${power.name}
                        ${power.unlocked ? `<span class="inv-card-badge" style="background:${power.color}22;color:${power.color};border-color:${power.color}44">
                            ${i === this.activePower ? "Equipado" : "Desbloqueado"}
                        </span>` : `<span class="inv-card-badge locked-badge">${power.killsRequired} kills</span>`}
                    </div>
                    <div class="inv-card-desc">${power.description}</div>
                    <div class="inv-card-stats">
                        <span class="stat-pill">⚔ ${power.damage} dano</span>
                        <span class="stat-pill">◎ ${power.range}m alcance</span>
                        <span class="stat-pill">⏱ ${power.cooldown}s CD</span>
                    </div>
                </div>
                ${power.unlocked ? `
                    <button class="inv-equip-btn ${i === this.activePower ? "equipped-btn" : ""}"
                        data-index="${i}">
                        ${i === this.activePower ? "Equipado" : "Equipar [" + (i+1) + "]"}
                    </button>
                ` : `<div class="inv-locked-overlay">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
                        <rect x="3" y="11" width="18" height="11" rx="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                </div>`}
            `

            if (power.unlocked) {
                card.querySelector(".inv-equip-btn")!.addEventListener("click", () => {
                    this.selectSlot(i)
                    this.updatePanel()
                })
            }

            grid.appendChild(card)
        })
    }

    // ── Notificação de desbloqueio ────────────────────────────────────────────

    private showUnlockNotification(power: Power) {
        const notif = document.createElement("div")
        notif.className = "inv-unlock-notif"
        notif.innerHTML = `
            <div class="inv-unlock-icon" style="color:${power.color}">${power.icon}</div>
            <div class="inv-unlock-text">
                <div class="inv-unlock-title">Poder Desbloqueado!</div>
                <div class="inv-unlock-name" style="color:${power.color}">${power.name}</div>
            </div>
        `
        document.body.appendChild(notif)

        // Animação de entrada e saída com delay escalonado para múltiplos desbloqueios
        requestAnimationFrame(() => notif.classList.add("show"))
        setTimeout(() => {
            notif.classList.remove("show")
            setTimeout(() => notif.remove(), 500)
        }, 3500)
    }

    // ── Teclado ───────────────────────────────────────────────────────────────

    private bindKeys() {
        window.addEventListener("keydown", (e) => {
            if (e.repeat) return
            const key = e.key

            // 1-5: seleciona slot
            const n = parseInt(key)
            if (n >= 1 && n <= 5) {
                this.selectSlot(n - 1)
            }

            // I: toggle painel
            if (key.toLowerCase() === "i") {
                this.togglePanel()
            }
        })
    }

    // ── Estilos ───────────────────────────────────────────────────────────────

    private injectStyles() {
        const s = document.createElement("style")
        s.textContent = `
/* ── Root ── */
#inv-root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 1000;
    font-family: 'Rajdhani', 'Segoe UI', sans-serif;
}

/* ════════════════════════════════════
   HOTBAR
════════════════════════════════════ */
#inv-hotbar {
    position: absolute;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: flex-end;
    gap: 6px;
    pointer-events: all;
}

.inv-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    cursor: pointer;
}

.inv-slot-inner {
    position: relative;
    width: 52px;
    height: 52px;
    background: rgba(6, 8, 16, 0.82);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    transition: border-color 0.15s, box-shadow 0.15s;
}

.inv-slot:hover .inv-slot-inner {
    border-color: rgba(255,255,255,0.25);
}

.inv-slot.active .inv-slot-inner {
    border-color: rgba(255,255,255,0.55);
    box-shadow: 0 0 12px rgba(255,255,255,0.12), inset 0 0 16px rgba(255,255,255,0.04);
}

.inv-slot.locked .inv-slot-inner {
    border-color: rgba(255,255,255,0.05);
    opacity: 0.5;
}

.inv-slot-icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.inv-slot-icon svg {
    width: 28px;
    height: 28px;
}

/* Overlay de cooldown — cresce de baixo para cima */
.inv-slot-cooldown {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 0%;
    background: rgba(0,0,0,0.65);
    transition: height 0.1s linear;
    pointer-events: none;
}

.inv-slot-key {
    position: absolute;
    bottom: 3px;
    right: 4px;
    font-size: 9px;
    font-weight: 700;
    color: rgba(255,255,255,0.35);
    line-height: 1;
}

.inv-slot-lock {
    color: rgba(255,255,255,0.2);
    display: flex;
    align-items: center;
    justify-content: center;
}

.inv-slot-name {
    font-size: 9px;
    font-weight: 600;
    color: rgba(255,255,255,0.35);
    letter-spacing: 0.03em;
    text-align: center;
    max-width: 54px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.inv-slot.active .inv-slot-name {
    color: rgba(255,255,255,0.7);
}

/* Botão inventário */
#inv-toggle-btn {
    width: 40px;
    height: 40px;
    background: rgba(6,8,16,0.82);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    color: rgba(255,255,255,0.5);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: all;
    transition: all 0.15s;
    margin-bottom: 6px;
}
#inv-toggle-btn:hover {
    border-color: rgba(255,255,255,0.3);
    color: rgba(255,255,255,0.85);
    background: rgba(20,24,40,0.9);
}

/* Tag de kills */
#inv-kills-tag {
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(6,8,16,0.75);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 700;
    color: rgba(255,255,255,0.45);
    margin-bottom: 6px;
}

/* ════════════════════════════════════
   PAINEL
════════════════════════════════════ */
#inv-panel {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -48%) scale(0.94);
    width: 640px;
    max-height: 72vh;
    background: rgba(6, 8, 18, 0.96);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.2s ease;
    box-shadow: 0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04);
    backdrop-filter: blur(16px);
}

#inv-panel.open {
    opacity: 1;
    pointer-events: all;
    transform: translate(-50%, -50%) scale(1);
}

#inv-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.07);
    flex-shrink: 0;
}

#inv-panel-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 700;
    color: rgba(255,255,255,0.85);
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

#inv-panel-close {
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.12s;
}
#inv-panel-close:hover {
    background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.8);
}

#inv-kills-bar {
    padding: 10px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: rgba(255,255,255,0.4);
    border-bottom: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
}

#inv-kills-num {
    font-weight: 700;
    color: rgba(255,255,255,0.7);
    font-size: 14px;
}

#inv-grid {
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

#inv-grid::-webkit-scrollbar { width: 4px; }
#inv-grid::-webkit-scrollbar-track { background: transparent; }
#inv-grid::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

/* ── Card de poder ── */
.inv-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.07);
    background: rgba(255,255,255,0.03);
    transition: border-color 0.15s, background 0.15s;
    position: relative;
    overflow: hidden;
}

.inv-card.unlocked:hover {
    border-color: rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.05);
}

.inv-card.equipped {
    border-color: rgba(255,255,255,0.3);
    background: rgba(255,255,255,0.07);
}

.inv-card.locked-card {
    opacity: 0.45;
}

.inv-card-icon {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.04);
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.07);
}

.inv-card-icon svg {
    width: 26px;
    height: 26px;
}

.inv-card-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.inv-card-name {
    font-size: 14px;
    font-weight: 700;
    color: rgba(255,255,255,0.85);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.inv-card-badge {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 3px;
    border: 1px solid;
}

.locked-badge {
    background: rgba(255,255,255,0.05);
    color: rgba(255,255,255,0.3);
    border-color: rgba(255,255,255,0.1);
}

.inv-card-desc {
    font-size: 12px;
    color: rgba(255,255,255,0.38);
    line-height: 1.4;
}

.inv-card-stats {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 2px;
}

.stat-pill {
    font-size: 10px;
    font-weight: 600;
    color: rgba(255,255,255,0.4);
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    padding: 2px 7px;
    border-radius: 3px;
}

.inv-equip-btn {
    flex-shrink: 0;
    padding: 7px 16px;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 5px;
    color: rgba(255,255,255,0.7);
    font-family: 'Rajdhani', sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: all 0.12s;
}

.inv-equip-btn:hover {
    background: rgba(255,255,255,0.13);
    color: rgba(255,255,255,0.95);
}

.inv-equip-btn.equipped-btn {
    background: rgba(255,255,255,0.12);
    border-color: rgba(255,255,255,0.35);
    color: rgba(255,255,255,0.95);
    cursor: default;
}

.inv-locked-overlay {
    flex-shrink: 0;
    color: rgba(255,255,255,0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
}

/* ════════════════════════════════════
   NOTIFICAÇÃO DE DESBLOQUEIO
════════════════════════════════════ */
.inv-unlock-notif {
    position: fixed;
    bottom: 160px;
    right: 28px;
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(6, 8, 18, 0.95);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 8px;
    padding: 12px 18px;
    pointer-events: none;
    z-index: 1100;
    opacity: 0;
    transform: translateX(20px);
    transition: opacity 0.3s ease, transform 0.3s ease;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    backdrop-filter: blur(12px);
}

.inv-unlock-notif.show {
    opacity: 1;
    transform: translateX(0);
}

.inv-unlock-icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.inv-unlock-icon svg { width: 30px; height: 30px; }

.inv-unlock-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.inv-unlock-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.4);
}

.inv-unlock-name {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.03em;
}
        `
        document.head.appendChild(s)
    }
}

export default PowerInventory