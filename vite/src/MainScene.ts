import {
    AmbientLight,
    Color,
    DirectionalLight,
    FogExp2,
    HemisphereLight,
    Scene
} from "three"

class MainScene {
    scene: Scene

    constructor() {
        this.scene = new Scene()

        // Fundo: azul-noite profundo, quase preto
        this.scene.background = new Color(0x080b12)

        // Névoa exponencial — envolve as bordas do mapa de forma mais natural
        // que a Fog linear, dando sensação de distância sem corte brusco
        this.scene.fog = new FogExp2(0x080b12, 0.022)

        this.setupLighting()
    }

    private setupLighting() {
        // Luz hemisférica: céu frio (azul) / chão quente (âmbar apagado)
        // Dá ao cenário uma paleta de RPG noturno sem precisar de muitas luzes
        const hemi = new HemisphereLight(
            0x1a2a4a,   // sky — azul escuro
            0x2a1a0a,   // ground — âmbar muito escuro
            0.9
        )
        this.scene.add(hemi)

        // Luz ambiente fraca — mantém as sombras densas sem ser pitch-black
        const ambient = new AmbientLight(0x0d1520, 0.6)
        this.scene.add(ambient)
    }
}

export default MainScene