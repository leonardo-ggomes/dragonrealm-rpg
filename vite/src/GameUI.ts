/**
 * GameUI.ts
 *
 * Gerencia duas telas pré-jogo:
 *
 *   1. LOADING SCREEN
 *      - Aparece assim que a página carrega
 *      - Barra de progresso atualizada por Experience via setProgress(0–100)
 *      - Quando chega a 100% mostra botão "COMEÇAR" que leva para...
 *
 *   2. INSTRUCTIONS SCREEN
 *      - Resumo visual dos controles e mecânicas
 *      - Botão "JOGAR" fecha tudo e entrega controle ao jogo
 *
 * Uso em Experience.ts:
 *   const ui = new GameUI(() => { game.resume() })
 *   // dentro do callback do loader:
 *   ui.setProgress(100)
 */

export default class GameUI {
    private root: HTMLDivElement
    private loadingScreen: HTMLDivElement
    private instructionsScreen: HTMLDivElement
    private progressBar: HTMLDivElement
    private progressText: HTMLSpanElement
    private startBtn: HTMLButtonElement
    private onReady: () => void
    private _progress = 0

    constructor(onReady: () => void) {
        this.onReady = onReady
        this.injectStyles()
        this.root = document.createElement("div")
        this.root.id = "gameui-root"

        this.loadingScreen     = this.buildLoadingScreen()
        this.instructionsScreen = this.buildInstructionsScreen()

        this.root.appendChild(this.loadingScreen)
        this.root.appendChild(this.instructionsScreen)
        document.body.appendChild(this.root)

        // Refs
        this.progressBar  = this.root.querySelector("#gui-progress-fill")!
        this.progressText = this.root.querySelector("#gui-progress-text")!
        this.startBtn     = this.root.querySelector("#gui-start-btn")!

        this.startBtn.addEventListener("click", () => this.showInstructions())
        this.root.querySelector("#gui-play-btn")!
            .addEventListener("click", () => this.dismiss())
    }

    // ── API pública ───────────────────────────────────────────────────────────

    setProgress(pct: number) {
        this._progress = Math.min(100, Math.max(0, pct))
        this.progressBar.style.width = `${this._progress}%`
        this.progressText.textContent = `${Math.round(this._progress)}%`

        if (this._progress >= 100) {
            setTimeout(() => {
                this.progressText.textContent = "Pronto!"
                this.startBtn.classList.add("ready")
                this.startBtn.disabled = false
            }, 300)
        }
    }

    // ── Transições ────────────────────────────────────────────────────────────

    private showInstructions() {
        this.loadingScreen.classList.add("gui-hide")
        setTimeout(() => {
            this.loadingScreen.style.display = "none"
            this.instructionsScreen.style.display = "flex"
            requestAnimationFrame(() =>
                this.instructionsScreen.classList.add("gui-show")
            )
        }, 400)
    }

    private dismiss() {
        this.instructionsScreen.classList.remove("gui-show")
        this.instructionsScreen.classList.add("gui-hide")
        setTimeout(() => {
            this.root.remove()
            this.onReady()
        }, 450)
    }

    // ── Tela de loading ───────────────────────────────────────────────────────

    private buildLoadingScreen(): HTMLDivElement {
        const el = document.createElement("div")
        el.id = "gui-loading"
        el.innerHTML = `
            <!-- Partículas de fundo -->
            <div class="gui-particles" aria-hidden="true">
                ${Array.from({ length: 22 }, (_) => {
                    const size  = 1 + Math.random() * 2.5
                    const left  = Math.random() * 100
                    const delay = Math.random() * 8
                    const dur   = 6 + Math.random() * 8
                    return `<span class="gui-particle" style="
                        width:${size}px;height:${size}px;
                        left:${left}%;
                        animation-delay:${delay}s;
                        animation-duration:${dur}s;
                        opacity:${0.15 + Math.random() * 0.35}
                    "></span>`
                }).join("")}
            </div>

            <div class="gui-loading-content">

                <!-- Logo / título -->
                <div class="gui-logo-wrap">
                    <div class="gui-logo-icon">
                        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <!-- Espada -->
                            <line x1="24" y1="6" x2="24" y2="36" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                            <line x1="16" y1="18" x2="32" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <path d="M21 36 L24 42 L27 36 Z" fill="currentColor"/>
                            <!-- Dragão simplificado -->
                            <path d="M8 28 Q14 20 20 24 Q24 12 28 16 Q34 8 38 14 Q42 20 36 26 Q30 30 24 26 Q18 30 8 28Z"
                                  stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
                            <circle cx="35" cy="14" r="1.5" fill="currentColor"/>
                        </svg>
                    </div>
                    <div class="gui-title-block">
                        <h1 class="gui-game-title">DRAGON<span>REALM</span></h1>
                        <p class="gui-game-sub">Dark Fantasy RPG</p>
                    </div>
                </div>

                <!-- Barra de progresso -->
                <div class="gui-progress-wrap">
                    <div class="gui-progress-track">
                        <div id="gui-progress-fill"></div>
                        <div class="gui-progress-glow"></div>
                    </div>
                    <div class="gui-progress-labels">
                        <span class="gui-loading-label">Carregando mundo…</span>
                        <span id="gui-progress-text">0%</span>
                    </div>
                </div>

                <!-- Botão (desabilitado até 100%) -->
                <button id="gui-start-btn" disabled>
                    <span>COMEÇAR</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         width="18" height="18" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                    </svg>
                </button>

                <!-- Dica rotativa -->
                <p class="gui-tip" id="gui-tip"></p>
            </div>
        `

        // Dicas rotativas
        const tips = [
            "Derrote dragões para desbloquear superpoderes",
            "Use botão direito para ativar poderes equipados",
            "Pressione Q para esquivar — você é invencível durante o roll",
            "Pressione I para abrir o inventário de poderes",
            "Dragões detectam você a 18 metros de distância",
            "Cair no vazio te teleporta de volta ao spawn",
            "Teclas 1–5 selecionam o poder da hotbar",
        ]
        let tipIdx = 0
        const tipEl = el.querySelector("#gui-tip") as HTMLElement
        const rotateTip = () => {
            tipEl.style.opacity = "0"
            setTimeout(() => {
                tipEl.textContent = `💡 ${tips[tipIdx % tips.length]}`
                tipEl.style.opacity = "1"
                tipIdx++
            }, 400)
        }
        rotateTip()
        setInterval(rotateTip, 4000)

        return el
    }

    // ── Tela de instruções ────────────────────────────────────────────────────

    private buildInstructionsScreen(): HTMLDivElement {
        const el = document.createElement("div")
        el.id = "gui-instructions"
        el.style.display = "none"
        el.innerHTML = `
            <div class="gui-instr-content">

                <div class="gui-instr-header">
                    <h2 class="gui-instr-title">Como Jogar</h2>
                    <p class="gui-instr-sub">Aprenda os controles antes de entrar no campo de batalha</p>
                </div>

                <div class="gui-instr-grid">

                    <!-- Movimento -->
                    <div class="gui-instr-card">
                        <div class="gui-instr-card-icon">
                            <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                                <rect x="14" y="2" width="8" height="8" rx="2"/>
                                <rect x="2" y="14" width="8" height="8" rx="2"/>
                                <rect x="26" y="14" width="8" height="8" rx="2"/>
                                <rect x="14" y="26" width="8" height="8" rx="2"/>
                                <rect x="14" y="14" width="8" height="8" rx="2" fill="currentColor" opacity="0.2"/>
                            </svg>
                        </div>
                        <div class="gui-instr-card-body">
                            <h3>Movimento</h3>
                            <ul>
                                <li><kbd>W A S D</kbd> Mover</li>
                                <li><kbd>Shift</kbd> Correr</li>
                                <li><kbd>Espaço</kbd> Pular</li>
                                <li><kbd>Q</kbd> Esquivar <span class="gui-badge">Invencível</span></li>
                            </ul>
                        </div>
                    </div>

                    <!-- Combate -->
                    <div class="gui-instr-card">
                        <div class="gui-instr-card-icon">
                            <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                                <line x1="8" y1="28" x2="28" y2="8"/>
                                <path d="M24 8 L28 8 L28 12"/>
                                <path d="M8 22 L6 30 L14 28 Z" fill="currentColor" opacity="0.3"/>
                                <line x1="12" y1="24" x2="16" y2="20"/>
                            </svg>
                        </div>
                        <div class="gui-instr-card-body">
                            <h3>Combate</h3>
                            <ul>
                                <li><kbd>Click ←</kbd> Ataque com espada</li>
                                <li><kbd>Click →</kbd> Usar superpoder</li>
                                <li><span class="gui-dim">Mire com o mouse para direcionar</span></li>
                                <li><span class="gui-dim">Roll cancela dano recebido</span></li>
                            </ul>
                        </div>
                    </div>

                    <!-- Poderes -->
                    <div class="gui-instr-card">
                        <div class="gui-instr-card-icon" style="color: #aa88ff">
                            <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                                <polygon points="18,3 22,14 34,14 24,21 28,33 18,26 8,33 12,21 2,14 14,14"/>
                            </svg>
                        </div>
                        <div class="gui-instr-card-body">
                            <h3>Superpoderes</h3>
                            <ul>
                                <li><kbd>1</kbd>–<kbd>5</kbd> Selecionar poder</li>
                                <li><kbd>I</kbd> Abrir inventário</li>
                                <li><span class="gui-dim">Desbloqueados matando dragões</span></li>
                                <li><span class="gui-dim">Cada poder tem cooldown próprio</span></li>
                            </ul>
                        </div>
                    </div>

                    <!-- Objetivo -->
                    <div class="gui-instr-card gui-instr-card-wide">
                        <div class="gui-instr-card-icon" style="color: #ff6644">
                            <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                                <path d="M6 20 Q10 10 14 14 Q18 4 22 8 Q26 2 30 8 Q34 14 28 20 Q22 24 18 20 Q14 24 6 20Z"/>
                                <circle cx="28" cy="8" r="2" fill="currentColor"/>
                            </svg>
                        </div>
                        <div class="gui-instr-card-body">
                            <h3>Objetivo</h3>
                            <p class="gui-instr-obj">
                                Dragões patrulham o mapa e atacam quando te detectam.
                                Derrote-os para ganhar superpoderes cada vez mais
                                devastadores. Sobreviva e torne-se o Caçador de Dragões.
                            </p>
                            <div class="gui-kill-milestones">
                                <div class="gui-milestone"><span class="gui-ms-num">1</span><span>Corte de Vento</span></div>
                                <div class="gui-milestone"><span class="gui-ms-num">3</span><span>Golpe Sísmico</span></div>
                                <div class="gui-milestone"><span class="gui-ms-num">6</span><span>Chama Carmesim</span></div>
                                <div class="gui-milestone"><span class="gui-ms-num">10</span><span>Raio Fantasma</span></div>
                                <div class="gui-milestone"><span class="gui-ms-num">15</span><span>Tempestade Final</span></div>
                            </div>
                        </div>
                    </div>

                </div>

                <button id="gui-play-btn">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                        <polygon points="5,3 19,12 5,21"/>
                    </svg>
                    <span>ENTRAR NO JOGO</span>
                </button>

            </div>
        `
        return el
    }

    // ── Estilos ───────────────────────────────────────────────────────────────

    private injectStyles() {
        const s = document.createElement("style")
        s.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Cinzel:wght@700&display=swap');

/* ── Root ── */
#gameui-root {
    position: fixed;
    inset: 0;
    z-index: 9999;
    font-family: 'Rajdhani', 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
}

/* ════════════════════════════════════
   LOADING SCREEN
════════════════════════════════════ */
#gui-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
        radial-gradient(ellipse at 20% 60%, rgba(140,30,10,.35) 0%, transparent 55%),
        radial-gradient(ellipse at 80% 30%, rgba(80,20,120,.3) 0%, transparent 50%),
        linear-gradient(160deg, #06080e 0%, #0a0c18 50%, #100812 100%);
    transition: opacity 0.4s ease;
}

#gui-loading.gui-hide {
    opacity: 0;
    pointer-events: none;
}

/* Partículas flutuantes */
.gui-particles {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
}

.gui-particle {
    position: absolute;
    bottom: -10px;
    border-radius: 50%;
    background: rgba(200, 100, 40, 0.6);
    animation: gui-float linear infinite;
}

@keyframes gui-float {
    0%   { transform: translateY(0) scale(1);   opacity: var(--op, 0.3); }
    50%  { transform: translateY(-45vh) scale(1.3); opacity: calc(var(--op, 0.3) * 1.5); }
    100% { transform: translateY(-100vh) scale(0.8); opacity: 0; }
}

/* Conteúdo central */
.gui-loading-content {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 32px;
    width: 440px;
}

/* Logo */
.gui-logo-wrap {
    display: flex;
    align-items: center;
    gap: 18px;
}

.gui-logo-icon {
    width: 72px;
    height: 72px;
    color: #e87040;
    filter: drop-shadow(0 0 16px rgba(232,112,64,.5));
    animation: gui-logo-pulse 3s ease-in-out infinite;
}

@keyframes gui-logo-pulse {
    0%, 100% { filter: drop-shadow(0 0 12px rgba(232,112,64,.4)); }
    50%       { filter: drop-shadow(0 0 28px rgba(232,112,64,.8)); }
}

.gui-logo-icon svg { width: 72px; height: 72px; }

.gui-title-block { display: flex; flex-direction: column; gap: 2px; }

.gui-game-title {
    margin: 0;
    font-family: 'Cinzel', serif;
    font-size: 38px;
    font-weight: 700;
    color: rgba(255,255,255,0.92);
    letter-spacing: 0.06em;
    line-height: 1;
    text-shadow: 0 0 30px rgba(232,112,64,.4);
}

.gui-game-title span {
    color: #e87040;
}

.gui-game-sub {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.3);
}

/* Progress */
.gui-progress-wrap {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.gui-progress-track {
    position: relative;
    height: 4px;
    background: rgba(255,255,255,0.07);
    border-radius: 2px;
    overflow: hidden;
}

#gui-progress-fill {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #b84010, #e87040, #ffa060);
    border-radius: 2px;
    transition: width 0.4s cubic-bezier(0.4,0,0.2,1);
}

.gui-progress-glow {
    position: absolute;
    top: -4px; bottom: -4px;
    left: 0; right: 0;
    background: linear-gradient(90deg, transparent, rgba(232,112,64,.3), transparent);
    animation: gui-shimmer 1.8s ease-in-out infinite;
}

@keyframes gui-shimmer {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}

.gui-progress-labels {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.gui-loading-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.3);
}

#gui-progress-text {
    font-size: 11px;
    font-weight: 700;
    color: rgba(255,255,255,0.45);
    letter-spacing: 0.05em;
}

/* Start button */
#gui-start-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 13px 36px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 5px;
    color: rgba(255,255,255,0.25);
    font-family: 'Rajdhani', sans-serif;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.2em;
    cursor: not-allowed;
    transition: all 0.3s ease;
    text-transform: uppercase;
}

#gui-start-btn.ready {
    background: rgba(232,112,64,0.12);
    border-color: rgba(232,112,64,0.5);
    color: #e87040;
    cursor: pointer;
    box-shadow: 0 0 24px rgba(232,112,64,0.15);
    animation: gui-btn-pulse 2s ease-in-out infinite;
}

@keyframes gui-btn-pulse {
    0%, 100% { box-shadow: 0 0 20px rgba(232,112,64,.15); }
    50%       { box-shadow: 0 0 36px rgba(232,112,64,.3); }
}

#gui-start-btn.ready:hover {
    background: rgba(232,112,64,0.2);
    border-color: rgba(232,112,64,0.8);
    transform: translateY(-1px);
}

/* Tip */
.gui-tip {
    margin: 0;
    font-size: 12px;
    color: rgba(255,255,255,0.22);
    text-align: center;
    transition: opacity 0.4s ease;
    min-height: 18px;
    font-style: italic;
    letter-spacing: 0.02em;
}

/* ════════════════════════════════════
   INSTRUCTIONS SCREEN
════════════════════════════════════ */
#gui-instructions {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
        radial-gradient(ellipse at 75% 25%, rgba(80,20,120,.25) 0%, transparent 50%),
        linear-gradient(160deg, #06080e, #0a0c18 60%, #100812);
    opacity: 0;
    transition: opacity 0.4s ease;
    overflow-y: auto;
    padding: 24px 16px;
}

#gui-instructions.gui-show  { opacity: 1; }
#gui-instructions.gui-hide  { opacity: 0; pointer-events: none; }

.gui-instr-content {
    width: 100%;
    max-width: 820px;
    display: flex;
    flex-direction: column;
    gap: 28px;
    animation: gui-slide-up 0.45s cubic-bezier(0.22,1,0.36,1) forwards;
}

@keyframes gui-slide-up {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
}

.gui-instr-header { text-align: center; }

.gui-instr-title {
    margin: 0 0 6px;
    font-family: 'Cinzel', serif;
    font-size: 28px;
    font-weight: 700;
    color: rgba(255,255,255,0.9);
    letter-spacing: 0.08em;
    text-shadow: 0 0 24px rgba(255,255,255,.1);
}

.gui-instr-sub {
    margin: 0;
    font-size: 13px;
    color: rgba(255,255,255,.3);
    letter-spacing: 0.08em;
}

/* Grid de cards */
.gui-instr-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
}

.gui-instr-card {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 8px;
    padding: 18px;
    display: flex;
    gap: 14px;
    align-items: flex-start;
}

.gui-instr-card-wide {
    grid-column: span 2;
}

.gui-instr-card-icon {
    width: 42px;
    height: 42px;
    flex-shrink: 0;
    color: rgba(255,255,255,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.04);
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.06);
}

.gui-instr-card-icon svg { width: 26px; height: 26px; }

.gui-instr-card-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.gui-instr-card-body h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.75);
}

.gui-instr-card-body ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.gui-instr-card-body li {
    font-size: 13px;
    color: rgba(255,255,255,0.55);
    display: flex;
    align-items: center;
    gap: 7px;
}

kbd {
    display: inline-flex;
    align-items: center;
    padding: 2px 7px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    border-bottom: 2px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    font-family: 'Rajdhani', monospace;
    font-size: 11px;
    font-weight: 700;
    color: rgba(255,255,255,0.75);
    letter-spacing: 0.04em;
    white-space: nowrap;
}

.gui-badge {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 6px;
    background: rgba(100,200,100,0.12);
    border: 1px solid rgba(100,200,100,0.3);
    border-radius: 3px;
    color: #6cd46c;
}

.gui-dim {
    font-size: 11px;
    color: rgba(255,255,255,0.28);
    font-style: italic;
}

/* Objective card */
.gui-instr-obj {
    margin: 0;
    font-size: 13px;
    color: rgba(255,255,255,0.4);
    line-height: 1.6;
}

.gui-kill-milestones {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
}

.gui-milestone {
    display: flex;
    align-items: center;
    gap: 5px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    color: rgba(255,255,255,0.45);
}

.gui-ms-num {
    font-weight: 700;
    font-size: 13px;
    color: #e87040;
    min-width: 14px;
}

/* Play button */
#gui-play-btn {
    align-self: center;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 48px;
    background: linear-gradient(135deg, rgba(232,112,64,0.18), rgba(180,50,20,0.22));
    border: 1px solid rgba(232,112,64,0.45);
    border-radius: 5px;
    color: #e87040;
    font-family: 'Rajdhani', sans-serif;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 0 28px rgba(232,112,64,.12);
}

#gui-play-btn:hover {
    background: linear-gradient(135deg, rgba(232,112,64,0.3), rgba(180,50,20,0.35));
    border-color: rgba(232,112,64,0.75);
    transform: translateY(-2px);
    box-shadow: 0 6px 32px rgba(232,112,64,.22);
}

#gui-play-btn:active {
    transform: translateY(0);
}
        `
        document.head.appendChild(s)
    }
}