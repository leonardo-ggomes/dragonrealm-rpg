import { Object3D, PerspectiveCamera, Vector3 } from "three"

class Camera {
    perspectiveCamera: PerspectiveCamera

    private readonly PITCH = Math.PI / 3.2
    private readonly YAW   = Math.PI / 4

    private distance = 18
    private readonly MIN_DISTANCE = 8
    private readonly MAX_DISTANCE = 35

    // Vetores pré-alocados — sem new/clone() em nenhum caminho quente
    private _offset  = new Vector3()
    private _desired = new Vector3()
    private _lookAt  = new Vector3()

    // Direções isométricas pré-calculadas — YAW é fixo (45°), nunca mudam
    private readonly _fwdDir   = new Vector3()
    private readonly _backDir  = new Vector3()
    private readonly _leftDir  = new Vector3()
    private readonly _rightDir = new Vector3()
    private readonly _inputDir = new Vector3()

    constructor() {
        this.perspectiveCamera = new PerspectiveCamera(
            50,
            window.innerWidth / window.innerHeight,
            0.1,
            500
        )

        // Offset calculado uma única vez — ângulos são constantes
        this._offset.set(
            Math.cos(this.YAW) * Math.cos(this.PITCH),
            Math.sin(this.PITCH),
            Math.sin(this.YAW) * Math.cos(this.PITCH)
        )

        // Direções isométricas calculadas uma única vez
        this._fwdDir.set(-1, 0, -1).normalize()
        this._backDir.set( 1, 0,  1).normalize()
        this._leftDir.set(-1, 0,  1).normalize()
        this._rightDir.set(1, 0, -1).normalize()

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

    // Zero alocações — reutiliza _inputDir e as 4 direções pré-calculadas
    getIsometricDirection(keys: Set<string>): Vector3 {
        this._inputDir.set(0, 0, 0)
        if (keys.has("w")) this._inputDir.add(this._fwdDir)
        if (keys.has("s")) this._inputDir.add(this._backDir)
        if (keys.has("a")) this._inputDir.add(this._leftDir)
        if (keys.has("d")) this._inputDir.add(this._rightDir)
        if (this._inputDir.length() > 0) this._inputDir.normalize()
        return this._inputDir
    }

    update(target: Object3D, delta: number) {
        this._desired
            .copy(this._offset)
            .multiplyScalar(this.distance)
            .add(target.position)

        // Lerp delta-corrected — comportamento idêntico em qualquer frame rate
        const factor = 1 - Math.pow(1 - 0.12, delta * 60)
        this.perspectiveCamera.position.lerp(this._desired, factor)

        this._lookAt.copy(target.position)
        this._lookAt.y += 1.0
        this.perspectiveCamera.lookAt(this._lookAt)
    }
}

export default Camera