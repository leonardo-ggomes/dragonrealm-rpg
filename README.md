<div align="center">

```
██████╗ ██████╗  █████╗  ██████╗  ██████╗ ███╗   ██╗
██╔══██╗██╔══██╗██╔══██╗██╔════╝ ██╔═══██╗████╗  ██║
██║  ██║██████╔╝███████║██║  ███╗██║   ██║██╔██╗ ██║
██║  ██║██╔══██╗██╔══██║██║   ██║██║   ██║██║╚██╗██║
██████╔╝██║  ██║██║  ██║╚██████╔╝╚██████╔╝██║ ╚████║
╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝
                         R E A L M
```

**RPG isométrico dark fantasy no navegador — sem engine, sem framework de UI.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-black?style=flat-square&logo=threedotjs)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.x-646cff?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

</div>

---

## Sobre

**DragonRealm** é um RPG de ação isométrico rodando inteiramente no browser. Construído com Three.js + TypeScript puro e Vite, sem nenhum framework de UI ou engine de jogo. Todo sistema — física, IA, animações, partículas, HUD, inventário — foi implementado do zero sobre a Web API.

O objetivo do projeto é demonstrar que jogos 3D completos com sistemas complexos são viáveis com Web APIs nativas, mantendo um bundle enxuto e zero dependências de runtime além do Three.js.

---

## Gameplay

- Perspectiva isométrica estilo Diablo com câmera fixa e zoom por scroll
- Combate melee com espada — ataque sincronizado com animação (hit no frame certo, não por timer fixo)
- Sistema de **roll / esquiva** com janela de invencibilidade real
- **5 superpoderes** desbloqueáveis por kills, equipáveis na hotbar
- Dragões voadores com IA de perseguição, dois tipos de ataque e respawn automático
- Sistema de vida, stamina, knockback e hit stun
- Morte com animação e ressurgimento com fade-in

---

## Controles

| Input | Ação |
|---|---|
| `W A S D` | Mover |
| `Shift` + movimento | Correr |
| `Espaço` | Pular (com coyote time) |
| `Q` | Esquivar — invencível durante o roll |
| `Click esquerdo` | Ataque com espada |
| `Click direito` | Ativar superpoder equipado |
| `1` – `5` | Selecionar slot do poder |
| `I` | Abrir / fechar inventário de poderes |

---

## Superpoderes

Desbloqueados progressivamente ao derrotar dragões:

| Kills | Poder | Efeito |
|---|---|---|
| 1 | **Corte de Vento** | Projétil em cone frontal, 45 dmg, 8m |
| 3 | **Golpe Sísmico** | Onda de choque ao redor do player, 60 dmg, 4.5m |
| 6 | **Chama Carmesim** | Explosão no ponto mirado, 80 dmg, 3.5m |
| 10 | **Raio Fantasma** | Encadeia até 3 alvos próximos, 55 dmg |
| 15 | **Tempestade Final** | Todos os elementos em área máxima, 120 dmg |

---

## Arquitetura

```
src/
├── Experience.ts       — Orquestrador central: física, loop, input, colisões
├── Player.ts           — Movimento, animações direcionais, roll, morte/respawn
├── NPC.ts              — Dragão: IA (idle → chase → attack), knockback, respawn
├── NPCManager.ts       — Pool de NPCs, LOD por distância, fila de respawn
├── Camera.ts           — Câmera isométrica fixa com zoom por scroll
├── MainScene.ts        — Cena Three.js: névoa exponencial, iluminação hemisférica
├── Renderer.ts         — WebGLRenderer com shadow maps
├── Loader.ts           — GLTFLoader + DRACOLoader
├── VFXManager.ts       — Sistema de partículas em batch (sem draw call por partícula)
├── HUD.ts              — HUD dark fantasy: barras de HP/stamina, minimapa, alertas
├── PowerInventory.ts   — Inventário de poderes: hotbar, painel, cooldowns, notificações
├── GameUI.ts           — Loading screen (progresso real) + tela de instruções
└── style.css           — Reset global + fonte Rajdhani

public/
├── models/
│   ├── the_lost_portal_-_enviroment.glb   — Mapa principal
│   └── glTF/
│       ├── character$animated.glb          — Player (23 animações)
│       └── Dragon.glb                      — NPC dragão (5 animações)
└── draco/                                  — Decoder DRACO para modelos comprimidos
```

---

## Sistemas Técnicos

### Física
- **Gravidade** com `velocityY` e terminal velocity
- **Ground snap** via raycast BVH — sem lerp, sem flickering em rampas
- **Coyote time** (120ms) para pulo responsivo nas bordas
- **Wall collision** radial com 8 raycasts horizontais e pushout por face normal
- **Capsule pushout** player ↔ NPC e NPC ↔ NPC
- **Knockback** com decay exponencial por delta

### Animações
- **Sincronização de ataque** — `timeScale` calculado pela duração real do clip GLTF; hit window em fração do swing, não em timer fixo
- **Animações direcionais** — `Run`, `Run_Back`, `Run_Left`, `Run_Right` com seleção por dot product
- **timeScale proporcional à velocidade** — walk/run acompanham o personagem em vez de timeScale fixo
- **Máquina de estados de vida**: `alive → dying → dead → respawning` com fade-in de opacidade

### IA dos Dragões
- Estados: `idle` (paira no lugar) → `chase` (voo direcional) → `attack` (alterna entre 2 clips)
- Flutuação vertical via `Math.sin` para simular voo orgânico
- Hit stun com timer delta-based (zero `setTimeout` na lógica de jogo)
- Knockback físico por direção do atacante
- Respawn em ponto distante do player após animação de morte completa

### VFX (Batch Geometry)
O sistema anterior criava um objeto Three.js por partícula — centenas de draw calls por frame. O novo sistema agrupa todas as partículas de um burst em um único `Points` com N posições no mesmo `Float32BufferAttribute`:

```
Antes: 20 partículas de sangue = 20 draw calls
Depois: 20 partículas de sangue = 2 draw calls (jato + coágulo)
```

Curvas de fade personalizadas por tipo: `fadeFire` (cresce → pleno → some), `fadeBlood` (pleno no jato → some ao cair), `fadeLinear` para efeitos rápidos.

### LOD dos NPCs
Três níveis por distância ao player:

| Distância | Comportamento |
|---|---|
| > 35u | Skip total — sem update |
| 18–35u | Apenas animação, sem IA |
| < 18u | IA completa + física |

---

## Como Rodar

**Pré-requisitos:** Node.js 18+ e npm.

```bash
# Clone
git clone https://github.com/seu-usuario/dragonrealm.git
cd dragonrealm

# Instale dependências
npm install

# Servidor de desenvolvimento
npm run dev
```

Acesse `http://localhost:5173`.

```bash
# Build de produção
npm run build

# Preview do build
npm run preview
```

---

## Dependências

```json
{
  "dependencies": {
    "three": "^0.165.0"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vite": "^5.x",
    "@types/three": "^0.165.0",
    "three-mesh-bvh": "^0.7.x"
  }
}
```

**Zero dependências de runtime além do Three.js.** HUD, inventário, partículas, física e IA são implementações próprias sobre DOM e WebGL.

---

## Decisões de Design

**Por que sem engine?**
Engines como Unity/Babylon abstraem colisão, animação e física — ótimo para produção, mas opaco para aprendizado. Implementar cada sistema do zero com Three.js expõe exatamente o que acontece em cada frame.

**Por que batch geometry nas partículas?**
`Points` com 1 ponto por objeto = 1 draw call por partícula. Com 4 dragões emitindo fogo a 60fps isso chegava a 200+ draw calls só de VFX. Batch geometry reduz para 3–4 draw calls por emissão.

**Por que `FogExp2` em vez de `Fog`?**
A névoa linear corta com borda visível no `far` plane. `FogExp2` acumula progressivamente com a distância, criando uma transição natural.

**Por que `HemisphereLight` em vez de `AmbientLight` branca?**
Luz ambiente branca uniforme achata os modelos 3D. `HemisphereLight(céu azul, chão âmbar)` cria gradientes naturais nos modelos sem precisar de múltiplas luzes.

---

## Autor

Desenvolvido por **Leonardo G**

---

<div align="center">

Se o projeto foi útil ou interessante, deixe uma ⭐

</div>
