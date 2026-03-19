/**
 * HUD.ts — Dark Fantasy Minimal
 *
 * Layout:
 *   Bottom-left  : HP bar + Stamina bar com ícones SVG
 *   Bottom-right : Kill counter
 *   Top-right    : Minimapa circular compacto
 *   Top-center   : Alerta de perigo (slide-down)
 *   Screen edges : Vinheta de dano (flash vermelho nas bordas)
 *
 * API pública (idêntica — Experience.ts sem alterações):
 *   setHealth(0-100)
 *   setStamina(0-100)
 *   setAmmo(current, reserve)
 *   addEnemy / removeEnemy / clearEnemies
 *   showAlert(msg, duration)
 *   update(playerAngleY)
 */

interface EnemyBlip {
  id: string
  x: number
  z: number
}

class HUD {
  private container: HTMLDivElement

  // Barras de status
  private healthBar!: HTMLDivElement
  private healthVal!: HTMLSpanElement
  private staminaBar!: HTMLDivElement

  // Valores internos
  private healthCur  = 100
  private healthPrev = 100
  private staminaCur = 100

  // Kills
  private killsEl!: HTMLSpanElement
  private kills = 0

  // Minimapa
  private minimapCanvas!: HTMLCanvasElement
  private minimapCtx!: CanvasRenderingContext2D
  private enemyBlips: Map<string, EnemyBlip> = new Map()
  public playerAngle = 0

  // Alerta
  private alertEl!: HTMLDivElement
  private alertText!: HTMLSpanElement
  private alertTimeout: ReturnType<typeof setTimeout> | null = null

  // Hit flash (vinheta de dano)
  private hitVignette!: HTMLDivElement
  private hitFlashTimeout: ReturnType<typeof setTimeout> | null = null

  // Animação suave das barras
  private rafId = 0
  private _healthAnim  = 100
  private _staminaAnim = 100

  constructor() {
      this.injectStyles()
      this.container = this.buildDOM()
      document.body.appendChild(this.container)
      this.queryRefs()
      this.startAnimation()
  }

  // ── API pública ───────────────────────────────────────────────────────────

  setHealth(value: number) {
      const clamped = Math.max(0, Math.min(100, value))

      // Flash de dano quando perde vida
      if (clamped < this.healthCur) this.flashHit()

      this.healthCur = clamped

      // Vinheta de baixa vida
      if (clamped < 30) {
          this.container.classList.add("critical")
      } else {
          this.container.classList.remove("critical")
      }
  }

  setStamina(value: number) {
      this.staminaCur = Math.max(0, Math.min(100, value))
  }

  /** Ammo vira kills */
  setAmmo(current: number, _reserve: number) {
      this.kills = current
      if (this.killsEl) this.killsEl.textContent = String(this.kills).padStart(3, "0")
  }

  addEnemy(blip: EnemyBlip)  { this.enemyBlips.set(blip.id, blip) }
  removeEnemy(id: string)    { this.enemyBlips.delete(id) }
  clearEnemies()             { this.enemyBlips.clear() }

  showAlert(message: string, duration = 3000) {
      if (!message) {
          this.alertEl?.classList.remove("show")
          return
      }
      if (this.alertTimeout) clearTimeout(this.alertTimeout)
      this.alertText.textContent = message
      this.alertEl.classList.add("show")
      this.alertTimeout = setTimeout(() => {
          this.alertEl.classList.remove("show")
      }, duration)
  }

  update(playerAngleY: number) {
      this.playerAngle = playerAngleY
      this.renderMinimap()
  }

  // ── Flash de dano ─────────────────────────────────────────────────────────

  private flashHit() {
      if (this.hitFlashTimeout) clearTimeout(this.hitFlashTimeout)
      this.hitVignette.classList.add("flash")
      this.hitFlashTimeout = setTimeout(() => {
          this.hitVignette.classList.remove("flash")
      }, 350)
  }

  // ── Animação das barras (RAF próprio) ─────────────────────────────────────

  private startAnimation() {
      const tick = () => {
          this.rafId = requestAnimationFrame(tick)

          // Interpola suavemente
          this._healthAnim  += (this.healthCur  - this._healthAnim)  * 0.1
          this._staminaAnim += (this.staminaCur - this._staminaAnim) * 0.12

          const hp = this._healthAnim
          const st = this._staminaAnim

          // Largura das barras
          if (this.healthBar)  this.healthBar.style.width  = `${hp}%`
          if (this.staminaBar) this.staminaBar.style.width = `${st}%`

          // Cor da barra de HP muda conforme o valor
          if (this.healthBar) {
              if (hp < 25)       this.healthBar.style.background = "var(--c-hp-crit)"
              else if (hp < 50)  this.healthBar.style.background = "var(--c-hp-low)"
              else               this.healthBar.style.background = "var(--c-hp)"
          }

          // Valor numérico de HP
          if (this.healthVal)
              this.healthVal.textContent = String(Math.round(hp))
      }
      tick()
  }

  // ── Minimapa ──────────────────────────────────────────────────────────────

  private renderMinimap() {
      const ctx = this.minimapCtx
      const W   = this.minimapCanvas.width
      const cx  = W / 2
      const r   = cx - 2

      ctx.clearRect(0, 0, W, W)

      // Clip circular
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cx, r, 0, Math.PI * 2)
      ctx.clip()

      // Fundo
      ctx.fillStyle = "rgba(4, 6, 12, 0.92)"
      ctx.fillRect(0, 0, W, W)

      // Grade fina
      ctx.strokeStyle = "rgba(255,255,255,0.04)"
      ctx.lineWidth   = 0.5
      for (let i = -3; i <= 3; i++) {
          const p = cx + (i / 3) * r
          ctx.beginPath(); ctx.moveTo(p, cx - r); ctx.lineTo(p, cx + r); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(cx - r, p); ctx.lineTo(cx + r, p); ctx.stroke()
      }

      // Círculos de referência
      ctx.strokeStyle = "rgba(255,255,255,0.05)"
      ;[0.4, 0.75].forEach(s => {
          ctx.beginPath()
          ctx.arc(cx, cx, r * s, 0, Math.PI * 2)
          ctx.stroke()
      })

      // Inimigos — losangos vermelhos com glow
      this.enemyBlips.forEach(blip => {
          const d  = Math.hypot(blip.x, blip.z)
          const nx = d > 1 ? blip.x / d : blip.x
          const nz = d > 1 ? blip.z / d : blip.z
          const bx = cx + nx * r * 0.88
          const by = cx + nz * r * 0.88

          // Glow
          const g = ctx.createRadialGradient(bx, by, 0, bx, by, 7)
          g.addColorStop(0, "rgba(255,60,60,0.55)")
          g.addColorStop(1, "transparent")
          ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2)
          ctx.fillStyle = g; ctx.fill()

          // Losango
          ctx.save()
          ctx.translate(bx, by); ctx.rotate(Math.PI / 4)
          ctx.fillStyle = "#e03030"
          ctx.fillRect(-3, -3, 6, 6)
          ctx.restore()
      })

      // Player — triângulo branco-ciano
      ctx.save()
      ctx.translate(cx, cx)
      ctx.rotate(-this.playerAngle)
      ctx.fillStyle = "#00d4ff"
      ctx.beginPath()
      ctx.moveTo(0, -9)
      ctx.lineTo(5, 5)
      ctx.lineTo(0, 2)
      ctx.lineTo(-5, 5)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      // Vinheta interna
      const vig = ctx.createRadialGradient(cx, cx, r * 0.45, cx, cx, r)
      vig.addColorStop(0, "transparent")
      vig.addColorStop(1, "rgba(0,0,0,0.7)")
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, W, W)

      ctx.restore()

      // Borda — anel fino ciano escuro
      ctx.beginPath()
      ctx.arc(cx, cx, r, 0, Math.PI * 2)
      ctx.strokeStyle = "rgba(0,180,220,0.25)"
      ctx.lineWidth   = 1.5
      ctx.stroke()

      // Anel externo escuro
      ctx.beginPath()
      ctx.arc(cx, cx, r + 1.5, 0, Math.PI * 2)
      ctx.strokeStyle = "rgba(0,0,0,0.8)"
      ctx.lineWidth   = 3
      ctx.stroke()
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  private buildDOM(): HTMLDivElement {
      const root = document.createElement("div")
      root.id = "hud"
      root.innerHTML = `

    <!-- STATUS: canto inferior esquerdo -->
    <div id="hud-status">

      <!-- HP -->
      <div class="stat-row">
        <div class="stat-icon">
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 14s-6-3.8-6-8a4 4 0 0 1 6-3.46A4 4 0 0 1 14 6c0 4.2-6 8-6 8z"
              fill="var(--c-hp)" opacity="0.9"/>
          </svg>
        </div>
        <div class="stat-bars">
          <div class="bar-track">
            <div class="bar-fill" id="hud-hp-bar"></div>
          </div>
        </div>
        <span class="stat-val" id="hud-hp-val">100</span>
      </div>

      <!-- Stamina -->
      <div class="stat-row">
        <div class="stat-icon">
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polygon points="9,1 4,9 8,9 7,15 12,7 8,7"
              fill="var(--c-sta)" opacity="0.9"/>
          </svg>
        </div>
        <div class="stat-bars">
          <div class="bar-track">
            <div class="bar-fill bar-sta" id="hud-sta-bar"></div>
          </div>
        </div>
      </div>

    </div>

    <!-- KILLS: canto inferior direito -->
    <div id="hud-kills">
      <svg class="skull-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="10" cy="8.5" rx="6" ry="6.5" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
        <rect x="6.5" y="13" width="3" height="3.5" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.18)" stroke-width="0.8"/>
        <rect x="10.5" y="13" width="3" height="3.5" rx="1" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.18)" stroke-width="0.8"/>
        <ellipse cx="7.5" cy="8" rx="1.8" ry="2" fill="rgba(0,0,0,0.5)"/>
        <ellipse cx="12.5" cy="8" rx="1.8" ry="2" fill="rgba(0,0,0,0.5)"/>
      </svg>
      <div id="hud-kills-num"><span id="hud-kills-val">000</span></div>
    </div>

    <!-- MINIMAPA: canto superior direito -->
    <div id="hud-minimap">
      <canvas id="hud-map-canvas" width="140" height="140"></canvas>
    </div>

    <!-- ALERTA: centro superior -->
    <div id="hud-alert">
      <div id="hud-alert-bar"></div>
      <span id="hud-alert-text"></span>
    </div>

    <!-- HIT VIGNETTE: bordas da tela -->
    <div id="hud-hit-vignette"></div>

    <!-- LOW-HEALTH VIGNETTE: bordas vermelhas pulsando -->
    <div id="hud-crit-vignette"></div>

  `
      return root
  }

  private queryRefs() {
      this.healthBar     = this.container.querySelector("#hud-hp-bar")!
      this.healthVal     = this.container.querySelector("#hud-hp-val")!
      this.staminaBar    = this.container.querySelector("#hud-sta-bar")!
      this.killsEl       = this.container.querySelector("#hud-kills-val")!
      this.minimapCanvas = this.container.querySelector("#hud-map-canvas")!
      this.minimapCtx    = this.minimapCanvas.getContext("2d")!
      this.alertEl       = this.container.querySelector("#hud-alert")!
      this.alertText     = this.container.querySelector("#hud-alert-text")!
      this.hitVignette   = this.container.querySelector("#hud-hit-vignette")!
  }

  // ── Estilos ───────────────────────────────────────────────────────────────

  private injectStyles() {
      const s = document.createElement("style")
      s.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&display=swap');

/* ── Variáveis ── */
#hud {
--c-hp:        #e8394a;
--c-hp-low:    #e8773a;
--c-hp-crit:   #cc2233;
--c-sta:       #00c8e8;
--c-text:      rgba(255,255,255,0.82);
--c-text-dim:  rgba(255,255,255,0.35);
--c-panel:     rgba(4,6,12,0.78);
--c-border:    rgba(255,255,255,0.07);
--font:        'Rajdhani', 'Segoe UI', sans-serif;
}

/* ── Raiz ── */
#hud {
position: fixed;
inset: 0;
pointer-events: none;
z-index: 999;
font-family: var(--font);
}

/* ════════════════════════════════
 STATUS BARS — bottom-left
════════════════════════════════ */
#hud-status {
position: absolute;
bottom: 28px;
left: 28px;
display: flex;
flex-direction: column;
gap: 8px;
width: 220px;
}

.stat-row {
display: flex;
align-items: center;
gap: 8px;
}

.stat-icon {
width: 16px;
height: 16px;
flex-shrink: 0;
}

.stat-icon svg {
width: 16px;
height: 16px;
}

.stat-bars {
flex: 1;
}

.bar-track {
height: 5px;
background: rgba(255,255,255,0.06);
border-radius: 2px;
overflow: hidden;
position: relative;
}

/* Linha de brilho interna */
.bar-track::after {
content: '';
position: absolute;
top: 0; left: 0; right: 0;
height: 1px;
background: rgba(255,255,255,0.08);
}

.bar-fill {
height: 100%;
width: 100%;
background: var(--c-hp);
border-radius: 2px;
transition: width 0.25s cubic-bezier(0.4,0,0.2,1), background 0.4s;
position: relative;
}

/* Brilho na ponta da barra */
.bar-fill::after {
content: '';
position: absolute;
right: 0;
top: 0;
bottom: 0;
width: 6px;
background: rgba(255,255,255,0.35);
border-radius: 2px;
filter: blur(1px);
}

.bar-sta {
background: var(--c-sta) !important;
}

.stat-val {
font-size: 13px;
font-weight: 600;
color: var(--c-text);
min-width: 28px;
text-align: right;
letter-spacing: 0.03em;
line-height: 1;
}

/* Crítico: barra pisca */
#hud.critical .bar-fill:not(.bar-sta) {
animation: hp-crit-pulse 0.9s ease-in-out infinite;
}

@keyframes hp-crit-pulse {
0%, 100% { opacity: 1; }
50%       { opacity: 0.5; }
}

/* ════════════════════════════════
 KILLS — bottom-right
════════════════════════════════ */
#hud-kills {
position: absolute;
bottom: 28px;
right: 28px;
display: flex;
align-items: center;
gap: 8px;
background: var(--c-panel);
border: 1px solid var(--c-border);
border-radius: 4px;
padding: 6px 12px 6px 10px;
backdrop-filter: blur(6px);
}

.skull-icon {
width: 20px;
height: 20px;
flex-shrink: 0;
}

#hud-kills-num {
display: flex;
flex-direction: column;
align-items: flex-end;
}

#hud-kills-val {
font-size: 20px;
font-weight: 700;
color: var(--c-text);
letter-spacing: 0.08em;
line-height: 1;
}

/* ════════════════════════════════
 MINIMAPA — top-right
════════════════════════════════ */
#hud-minimap {
position: absolute;
top: 24px;
right: 24px;
line-height: 0;
}

#hud-map-canvas {
display: block;
border-radius: 50%;
}

/* ════════════════════════════════
 ALERTA — top-center
════════════════════════════════ */
#hud-alert {
position: absolute;
top: 36px;
left: 50%;
transform: translateX(-50%) translateY(-12px);
opacity: 0;
pointer-events: none;
transition: opacity 0.25s ease, transform 0.25s ease;
display: flex;
align-items: center;
gap: 8px;
background: rgba(4, 6, 14, 0.88);
border: 1px solid rgba(255,255,255,0.08);
border-radius: 3px;
padding: 7px 20px;
white-space: nowrap;
backdrop-filter: blur(8px);
}

/* Linha de acento esquerda */
#hud-alert-bar {
width: 2px;
height: 14px;
background: var(--c-hp);
border-radius: 1px;
flex-shrink: 0;
}

#hud-alert.show {
opacity: 1;
transform: translateX(-50%) translateY(0);
}

#hud-alert-text {
font-size: 12px;
font-weight: 700;
letter-spacing: 0.18em;
color: var(--c-text);
text-transform: uppercase;
}

/* ════════════════════════════════
 HIT VIGNETTE — flash vermelho
════════════════════════════════ */
#hud-hit-vignette {
position: fixed;
inset: 0;
pointer-events: none;
background: radial-gradient(
  ellipse at center,
  transparent 50%,
  rgba(200, 20, 20, 0.55) 100%
);
opacity: 0;
z-index: 997;
transition: opacity 0.08s ease;
}

#hud-hit-vignette.flash {
opacity: 1;
animation: hit-fade 0.35s ease forwards;
}

@keyframes hit-fade {
0%   { opacity: 1; }
100% { opacity: 0; }
}

/* ════════════════════════════════
 CRITICAL VIGNETTE — HP baixo
════════════════════════════════ */
#hud-crit-vignette {
position: fixed;
inset: 0;
pointer-events: none;
background: radial-gradient(
  ellipse at center,
  transparent 35%,
  rgba(160, 0, 0, 0.0) 55%,
  rgba(160, 0, 0, 0.45) 100%
);
opacity: 0;
z-index: 996;
transition: opacity 0.6s ease;
}

#hud.critical #hud-crit-vignette {
opacity: 1;
animation: crit-pulse 1.6s ease-in-out infinite;
}

@keyframes crit-pulse {
0%, 100% { opacity: 0.45; }
50%       { opacity: 0.85; }
}
  `
      document.head.appendChild(s)
  }
}

export default HUD