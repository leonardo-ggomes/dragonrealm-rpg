import { Object3D, PerspectiveCamera, Vector3 } from "three"

class Camera {
    perspectiveCamera: PerspectiveCamera

    // Ângulo isométrico fixo — pitch de ~55° dá a sensação Diablo
    private readonly PITCH = Math.PI / 3.2   // ~56°
    private readonly YAW   = Math.PI / 4     // 45° — diagonal isométrica

    // Distância da câmera ao player (zoom)
    private distance = 18
    private readonly MIN_DISTANCE = 8
    private readonly MAX_DISTANCE = 35

    // Suavização
    private readonly SMOOTH = 0.12

    constructor() {
        this.perspectiveCamera = new PerspectiveCamera(
            50,                                    // FOV menor = menos distorção perspectiva
            window.innerWidth / window.innerHeight,
            0.1,
            500
        )

        document.addEventListener("wheel", this.onWheel)
    }

    private onWheel = (e: WheelEvent) => {
        this.distance += e.deltaY * 0.02
        this.distance = Math.max(this.MIN_DISTANCE, Math.min(this.MAX_DISTANCE, this.distance))
    }

    /**
     * Retorna a direção flat (XZ) para onde o player deve andar
     * com base nas teclas pressionadas na câmera isométrica.
     * W/S/A/D são remapeados para os 4 eixos isométricos.
     */
    getIsometricDirection(keys: Set<string>): Vector3 {
        const dir = new Vector3()

        // Na câmera a 45° isométrica, "frente" na tela é diagonal no mundo
        const forward = new Vector3(-1, 0, -1).normalize()  // W
        const back    = new Vector3( 1, 0,  1).normalize()  // S
        const left    = new Vector3(-1, 0,  1).normalize()  // A
        const right   = new Vector3( 1, 0, -1).normalize()  // D

        if (keys.has("w")) dir.add(forward)
        if (keys.has("s")) dir.add(back)
        if (keys.has("a")) dir.add(left)
        if (keys.has("d")) dir.add(right)

        if (dir.length() > 0) dir.normalize()
        return dir
    }

    update(target: Object3D) {
        // Offset fixo isométrico — não rotaciona com o mouse
        const offset = new Vector3(
            Math.cos(this.YAW) * Math.cos(this.PITCH),
            Math.sin(this.PITCH),
            Math.sin(this.YAW) * Math.cos(this.PITCH)
        ).multiplyScalar(this.distance)

        const desired = target.position.clone().add(offset)

        this.perspectiveCamera.position.lerp(desired, this.SMOOTH)

        // Sempre olha para o player com offset de altura
        const lookAt = target.position.clone().add(new Vector3(0, 1, 0))
        this.perspectiveCamera.lookAt(lookAt)
    }
}

export default Camera