import type { AppContext, System, WorldRefs } from '../core/types'
import { interactions } from '../core/registry'
import { store } from '../core/state'
import { bus } from '../core/events'

/**
 * 障子/戸の開閉(P0-5)。クリックで shojiOpen をトグルし、
 * 毎フレーム userData.slide = { axis, closed, open } に従ってスライド補間する。
 * TODO(opus-audio): 音との同期微調整。
 */
export function setupDoors(_ctx: AppContext, refs: WorldRefs): System {
  for (const panel of refs.shojiPanels) {
    interactions.add({
      object: panel,
      label: '障子を開ける/閉める',
      onSelect() {
        store.set('shojiOpen', !store.state.shojiOpen)
        bus.emit('sfx', { name: 'slide' })
      },
    })
  }
  return {
    update(dt) {
      for (const panel of refs.shojiPanels) {
        const slide = panel.userData.slide as
          | { axis: 'x' | 'z'; closed: number; open: number }
          | undefined
        if (!slide) continue
        const target = store.state.shojiOpen ? slide.open : slide.closed
        const cur = panel.position[slide.axis]
        panel.position[slide.axis] = cur + (target - cur) * Math.min(1, dt * 4)
      }
    },
  }
}
