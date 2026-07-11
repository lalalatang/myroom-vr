import * as THREE from 'three'
import type { AppContext, System, WorldRefs } from '../core/types'
import { interactions } from '../core/registry'

/**
 * XRコントローラー入力基盤: レイ表示+トリガーで Interactable を選択。
 * ctx.xr(raySpaces/gripSpaces/handedness)をここで設定する(main.tsが最初に呼ぶ)。
 * TODO(opus-xr): ホバー時のレイ色変化・ハプティクス・両手対応の磨き込み。
 */
export function createControllers(ctx: AppContext, _refs: WorldRefs): System {
  const { renderer, player } = ctx
  const raycaster = new THREE.Raycaster()
  raycaster.far = 6

  const raySpaces: THREE.Group[] = []
  const gripSpaces: THREE.Group[] = []
  const handedness: ('left' | 'right' | 'unknown')[] = ['unknown', 'unknown']

  for (let i = 0; i < 2; i++) {
    const ray = renderer.xr.getController(i)
    const grip = renderer.xr.getControllerGrip(i)
    player.add(ray, grip)
    raySpaces.push(ray)
    gripSpaces.push(grip)

    ray.addEventListener('connected', (e) => {
      handedness[i] = (e.data?.handedness as 'left' | 'right') ?? 'unknown'
    })
    ray.addEventListener('disconnected', () => (handedness[i] = 'unknown'))

    // レイ表示
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1),
      ]),
      new THREE.LineBasicMaterial({ color: 0xbfd4ff, transparent: true, opacity: 0.6 }),
    )
    line.scale.z = 4
    ray.add(line)

    ray.addEventListener('selectstart', () => {
      const item = raycastFrom(ray)
      item?.onSelect()
    })
  }

  ctx.xr = { raySpaces, gripSpaces, handedness }

  const tmpMat = new THREE.Matrix4()
  function raycastFrom(ray: THREE.Object3D) {
    tmpMat.identity().extractRotation(ray.matrixWorld)
    raycaster.ray.origin.setFromMatrixPosition(ray.matrixWorld)
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat)
    const hits = raycaster.intersectObjects(interactions.targets, true)
    return hits.length ? interactions.resolve(hits[0].object) : null
  }

  return { update() {} }
}
