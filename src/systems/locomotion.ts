import * as THREE from 'three'
import type { AppContext, System, WorldRefs } from '../core/types'

/**
 * VR移動: 左スティック押し込み方向でテレポート照準→離すと移動。右スティックでスナップターン45°。
 * TODO(opus-xr): 放物線アーク照準・着地マーカー・ビネット(酔い対策)の本実装。
 * 以下は骨格確認用の最小実装(スティック倒しでマーカー表示、戻すとテレポート)。
 */
export function createLocomotion(ctx: AppContext, refs: WorldRefs): System {
  const { renderer, player } = ctx
  const raycaster = new THREE.Raycaster()

  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.22, 24),
    new THREE.MeshBasicMaterial({ color: 0x9fd8a0, transparent: true, opacity: 0.8 }),
  )
  marker.rotation.x = -Math.PI / 2
  marker.visible = false
  ctx.scene.add(marker)

  let aiming = false
  let target: THREE.Vector3 | null = null
  let snapCooldown = 0
  const tmpMat = new THREE.Matrix4()

  return {
    update(dt) {
      snapCooldown = Math.max(0, snapCooldown - dt)
      const session = renderer.xr.getSession()
      if (!session || !ctx.xr) {
        marker.visible = false
        return
      }

      let aimingNow = false
      for (const source of session.inputSources) {
        const gp = source.gamepad
        if (!gp) continue
        const [, , ax = 0, ay = 0] = gp.axes // Quest: axes[2,3]=スティック
        const idx = ctx.xr.handedness.findIndex((h) => h === source.handedness)
        const ray = idx >= 0 ? ctx.xr.raySpaces[idx] : null

        if (source.handedness === 'left' && ray) {
          if (ay < -0.5) {
            // 前倒しで照準
            aimingNow = true
            tmpMat.identity().extractRotation(ray.matrixWorld)
            raycaster.ray.origin.setFromMatrixPosition(ray.matrixWorld)
            raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat)
            raycaster.far = 10
            const hit = raycaster.intersectObjects(refs.teleportSurfaces, true)[0]
            if (hit) {
              target = hit.point.clone()
              marker.position.copy(target).add(new THREE.Vector3(0, 0.01, 0))
              marker.visible = true
            } else {
              target = null
              marker.visible = false
            }
          }
        }
        if (source.handedness === 'right' && Math.abs(ax) > 0.6 && snapCooldown === 0) {
          player.rotation.y -= Math.sign(ax) * (Math.PI / 4)
          snapCooldown = 0.35
        }
      }

      if (aiming && !aimingNow && target) {
        // スティックを戻した瞬間にテレポート
        player.position.set(target.x, target.y, target.z)
        target = null
        marker.visible = false
      }
      aiming = aimingNow
      if (!aimingNow) marker.visible = false
    },
  }
}
