import * as THREE from 'three'
import type { AppContext, System, WorldRefs } from '../core/types'
import { bus } from '../core/events'

/**
 * 鹿威し(P1-8): 竹アーム(name:'shishiArm')を約12秒周期でアニメーション。
 * ゆっくり傾く(水が溜まる)→ 一気に戻る → 戻った瞬間に「コン」(bus sfx 'kon'、支点のワールド座標で3D定位)。
 * refs.shishiodoshi または 'shishiArm' が無ければ no-op。
 */
export function setupShishiodoshi(_ctx: AppContext, refs: WorldRefs): System {
  const root = refs.shishiodoshi
  const arm = root?.getObjectByName('shishiArm')
  if (!root || !arm) return { update() {} }

  const PERIOD = 12 // 秒
  const SNAP = 0.55 // 戻り(打撃)にかける秒数
  const FILL = PERIOD - SNAP // 傾く区間
  const TILT = 0.4 // 傾き量(rad)
  const restRot = arm.rotation.x

  let phase = Math.random() * PERIOD // 初期位相をずらす
  let fired = false

  return {
    update(dt: number): void {
      phase = (phase + dt) % PERIOD
      if (phase < FILL) {
        fired = false
        // ゆっくり傾く(水が溜まる): ease-in 気味
        const u = phase / FILL
        arm.rotation.x = restRot + TILT * (u * u)
      } else {
        // 一気に戻る
        const k = Math.min(1, (phase - FILL) / SNAP)
        arm.rotation.x = restRot + TILT * (1 - k)
        if (k >= 1 && !fired) {
          fired = true
          bus.emit('sfx', {
            name: 'kon',
            position: root.getWorldPosition(new THREE.Vector3()),
          })
        }
      }
    },
  }
}
