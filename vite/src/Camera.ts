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

    // Suavização — fração alvo por segundo (não por frame)
    // Valor 8 significa: a câmera percorre ~8x a distância restante por segundo.
    // É convertido para lerp delta-corrected no update(), garantindo
    // comportamento idêntico em qualquer frame rate (60fps, 120fps, 30fps).
    private readonly SMOOTH_SPEED = 8

    // Vectors pré-alocados — sem new/clone() dentro do update() a cada frame
    private _offset  = new Vector3()
    private _desired = new Vector3()
    private _lookAt  = new Vector3()

    constructor() {
        this.perspectiveCamera = new PerspectiveCamera(
            50,
            window.innerWidth / window.innerHeight,
            0.1,
            500
        )

        // Pré-computa o offset fixo uma única vez — nunca muda em runtime
        this._offset.set(
            Math.cos(this.YAW) * Math.cos(this.PITCH),
            Math.sin(this.PITCH),
            Math.sin(this.YAW) * Math.cos(this.PITCH)
        )

        window.addEventListener("resize", () => {
            this.perspectiveCamera.aspect = window.innerWidth / window.innerHeight
            this.perspectiveCamera.updateProjectionMatrix()
        })

        document.addEventListener("wheel", this.onWheel)
    }

    private onWheel = (e: WheelEvent) => {
        this.distance += e.deltaY * 0.02
        this.distance = Math.max(this.MIN_DISTANCE, Math.min(this.MAX_DISTANCE, this.distance))
    }

    getIsometricDirection(keys: Set<string>): Vector3 {
        const dir = new Vector3()

        const forward = new Vector3(-1, 0, -1).normalize()
        const back    = new Vector3( 1, 0,  1).normalize()
        const left    = new Vector3(-1, 0,  1).normalize()
        const right   = new Vector3( 1, 0, -1).normalize()

        if (keys.has("w")) dir.add(forward)
        if (keys.has("s")) dir.add(back)
        if (keys.has("a")) dir.add(left)
        if (keys.has("d")) dir.add(right)

        if (dir.length() > 0) dir.normalize()
        return dir
    }

    update(target: Object3D, delta: number) {
        // Posição desejada: target + offset escalado pela distância atual
        // Usa _desired e _offset pré-alocados — zero alocação aqui
        this._desired
            .copy(this._offset)
            .multiplyScalar(this.distance)
            .add(target.position)

        // Lerp delta-corrected: fator = 1 - (1 - base)^(delta * 60)
        // Isso garante que a câmera se comporte igual em qualquer frame rate.
        // Sem isso: a 30fps a câmera fica mais "colada", a 120fps fica mais "solta"
        // — o player se move mais que a câmera consegue acompanhar, causando tremor.
        const factor = 1 - Math.pow(1 - 0.12, delta * 60)
        this.perspectiveCamera.position.lerp(this._desired, factor)

        // lookAt: sempre aponta para a cabeça do player — sem clone(), sem new
        this._lookAt.copy(target.position)
        this._lookAt.y += 1.0
        this.perspectiveCamera.lookAt(this._lookAt)
    }
}

export default Camera