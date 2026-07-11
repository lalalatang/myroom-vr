import type { AppContext, System, WorldRefs } from '../core/types'
import { interactions } from '../core/registry'
import { store } from '../core/state'

/**
 * ラジオ(P0-4): クリックで再生/停止をトグル。実際の音は audio システムが受け持つ。
 */
export function setupRadio(_ctx: AppContext, refs: WorldRefs): System {
  if (refs.radio) {
    interactions.add({
      object: refs.radio,
      label: 'ラジオを鳴らす/止める',
      onSelect() {
        store.set('radioPlaying', !store.state.radioPlaying)
      },
    })
  }
  return { update() {} }
}
