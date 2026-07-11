import * as THREE from 'three'
import type { AppContext, LampId, System, WorldRefs } from '../core/types'
import { interactions } from '../core/registry'
import { store } from '../core/state'
import { bus } from '../core/events'

/**
 * 行灯・デスクランプの個別点灯/消灯(P0-3)。
 * 状態を反転するだけで、光の適用は lighting システムが一元管理する。
 */
export function setupLamps(_ctx: AppContext, refs: WorldRefs): System {
  for (const [id, fixture] of Object.entries(refs.lampFixtures)) {
    if (!fixture) continue
    const lampId = id as LampId
    interactions.add({
      object: fixture,
      label: lampId === 'andon' ? '行灯を点ける/消す' : 'ランプを点ける/消す',
      onSelect() {
        store.setLamp(lampId, !store.state.lamps[lampId])
        bus.emit('sfx', {
          name: 'click',
          position: fixture.getWorldPosition(new THREE.Vector3()),
        })
      },
    })
  }
  return { update() {} }
}
