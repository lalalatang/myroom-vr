import type { AppContext, System, WorldRefs } from '../core/types'

/**
 * 掛け軸(P1-7): public/texts/tanka.json から短歌をランダム表示、クリックで次の一首。
 * canvas に縦書きレンダリングして CanvasTexture で掛け軸面に貼る。
 * TODO(sonnet-ui): 本実装。
 */
export function setupKakejiku(_ctx: AppContext, _refs: WorldRefs): System {
  return { update() {} }
}
