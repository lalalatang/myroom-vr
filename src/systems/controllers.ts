import * as THREE from 'three'
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js'
import type { AppContext, System, WorldRefs, Interactable } from '../core/types'
import { interactions } from '../core/registry'

/**
 * XRコントローラー入力基盤: grip に実機モデル表示、レイで Interactable を選択。
 * ctx.xr(raySpaces/gripSpaces/handedness)をここで設定する(main.tsが最初に呼ぶ)。
 * ホバー中はレイの色/長さをヒット点まで変え、ヒット点にドットを表示。
 * onHoverIn/onHoverOut を前フレーム差分で発火、選択時にハプティクス。
 */
const RAY_REST_COLOR = 0xbfd4ff
const RAY_HOVER_COLOR = 0x8affc1
const RAY_REST_LEN = 5

export function createControllers(ctx: AppContext, _refs: WorldRefs): System {
  const { renderer, player, scene } = ctx
  const raycaster = new THREE.Raycaster()
  raycaster.far = 8

  const raySpaces: THREE.Group[] = []
  const gripSpaces: THREE.Group[] = []
  const handedness: ('left' | 'right' | 'unknown')[] = ['unknown', 'unknown']

  const modelFactory = new XRControllerModelFactory()

  // 毎フレームのアロケーションを避けるため、コントローラーごとの状態はループ外で保持
  const lines: THREE.Line[] = []
  const dots: THREE.Mesh[] = []
  const hovered: (Interactable | null)[] = [null, null]

  const dotGeo = new THREE.SphereGeometry(0.012, 8, 8)

  for (let i = 0; i < 2; i++) {
    const ray = renderer.xr.getController(i)
    const grip = renderer.xr.getControllerGrip(i)
    player.add(ray, grip)
    raySpaces.push(ray)
    gripSpaces.push(grip)

    // grip に実機コントローラーモデル
    grip.add(modelFactory.createControllerModel(grip))

    ray.addEventListener('connected', (e) => {
      handedness[i] = (e.data?.handedness as 'left' | 'right') ?? 'unknown'
    })
    ray.addEventListener('disconnected', () => (handedness[i] = 'unknown'))

    // レイ表示(コントローラーごとに独立したマテリアルで色を変える)
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1),
      ]),
      new THREE.LineBasicMaterial({ color: RAY_REST_COLOR, transparent: true, opacity: 0.6 }),
    )
    line.scale.z = RAY_REST_LEN
    ray.add(line)
    lines.push(line)

    // ヒット点ドット(ワールド空間)
    const dot = new THREE.Mesh(
      dotGeo,
      new THREE.MeshBasicMaterial({ color: RAY_HOVER_COLOR }),
    )
    dot.visible = false
    dot.frustumCulled = false
    scene.add(dot)
    dots.push(dot)

    ray.addEventListener('selectstart', (e) => {
      // 毎フレームのホバー結果を再利用
      hovered[i]?.onSelect()
      // ハプティクス(型が緩いため any 経由)
      const src = e.data as unknown as { gamepad?: { hapticActuators?: Array<{ pulse?: (v: number, ms: number) => void }> } }
      src?.gamepad?.hapticActuators?.[0]?.pulse?.(0.5, 50)
    })
  }

  ctx.xr = { raySpaces, gripSpaces, handedness }

  const tmpMat = new THREE.Matrix4()

  interface RayHit {
    item: Interactable
    point: THREE.Vector3
    distance: number
  }
  function castRay(ray: THREE.Object3D): RayHit | null {
    tmpMat.identity().extractRotation(ray.matrixWorld)
    raycaster.ray.origin.setFromMatrixPosition(ray.matrixWorld)
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat)
    const hits = raycaster.intersectObjects(interactions.targets, true)
    for (const h of hits) {
      const item = interactions.resolve(h.object)
      if (item) return { item, point: h.point, distance: h.distance }
    }
    return null
  }

  return {
    update() {
      const presenting = renderer.xr.isPresenting
      for (let i = 0; i < 2; i++) {
        const ray = raySpaces[i]
        const line = lines[i]
        const dot = dots[i]
        const mat = line.material as THREE.LineBasicMaterial

        const hit = presenting ? castRay(ray) : null
        const next = hit?.item ?? null
        const prev = hovered[i]
        if (next !== prev) {
          prev?.onHoverOut?.()
          next?.onHoverIn?.()
          hovered[i] = next
        }

        if (hit) {
          line.scale.z = hit.distance
          mat.color.setHex(RAY_HOVER_COLOR)
          mat.opacity = 0.9
          dot.position.copy(hit.point)
          dot.visible = true
        } else {
          line.scale.z = RAY_REST_LEN
          mat.color.setHex(RAY_REST_COLOR)
          mat.opacity = 0.6
          dot.visible = false
        }
      }
    },
  }
}
