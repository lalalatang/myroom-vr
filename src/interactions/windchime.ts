import * as THREE from 'three'
import type { AppContext, System, WorldRefs } from '../core/types'
import { bus } from '../core/events'

/**
 * 風鈴(P1-10): 短冊(name:'windChimeTanzaku')を風で揺らし、不定期(平均20秒間隔、ポアソン的)に
 * 「チリン」(bus sfx 'chime'、風鈴のワールド座標で3D定位)。refs.windChime が無ければ no-op。
 */
export function setupWindChime(_ctx: AppContext, refs: WorldRefs): System {
  const root = refs.windChime
  if (!root) return { update() {} }
  const tanzaku = root.getObjectByName('windChimeTanzaku')
  const restZ = tanzaku?.rotation.z ?? 0
  const restX = tanzaku?.rotation.x ?? 0

  const MEAN = 20 // 平均間隔(秒)
  const nextInterval = (): number =>
    Math.max(4, -Math.log(1 - Math.random()) * MEAN) // 指数分布(ポアソン過程の到来間隔)

  let timer = 0
  let next = nextInterval()

  return {
    update(dt: number, elapsed: number): void {
      if (tanzaku) {
        // 風で揺れる: sin の重ね合わせ + 微小ノイズ
        const sway =
          Math.sin(elapsed * 1.3) * 0.08 +
          Math.sin(elapsed * 0.37 + 1) * 0.04 +
          (Math.random() * 2 - 1) * 0.008
        tanzaku.rotation.z = restZ + sway
        tanzaku.rotation.x = restX + Math.cos(elapsed * 1.1) * 0.04
      }

      timer += dt
      if (timer >= next) {
        timer = 0
        next = nextInterval()
        bus.emit('sfx', {
          name: 'chime',
          position: root.getWorldPosition(new THREE.Vector3()),
        })
      }
    },
  }
}
