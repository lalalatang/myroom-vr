import type { AppContext, System, WorldRefs } from '../core/types'

/**
 * 左手首パネル(P0-2のUI): 朝/昼/夕/夜ボタン+天候トグル。
 * 左グリップ(ctx.xr.gripSpaces の handedness==='left' のもの)に追従する小さなキャンバスUI。
 * 各ボタンは Interactable としてレジストリに登録(コントローラーレイで押せる)。
 * デスクトップではキーボード1-4/Rで代替(desktop.ts実装済み)なので非表示でよい。
 * TODO(sonnet-ui): 本実装。
 */
export function setupWristPanel(_ctx: AppContext, _refs: WorldRefs): System {
  return { update() {} }
}
