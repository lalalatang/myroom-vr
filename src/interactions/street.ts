import type { AppContext, System, WorldRefs } from '../core/types'

/**
 * 通りの仕掛け一式(v2)。
 * - 井戸(P1): 釣瓶('tsurube')をクリック → ロープが落ち、水音(bus sfx)
 * - 蕎麦屋台(P1): 'steamAnchor' から湯気パーティクル。近づくと出汁の気配(音はaudio側)
 * - 木戸(P1): 夜は 'kidoGate' が閉まる(タイムオブデイ監視、ゆっくり回転/スライド)
 * - 小銭投げ(P1): デスクトップ=Cキー、VR=squeeze で小銭を放物線で投げる。
 *   着地で「チャリン」、refs.coinTarget 命中で特別な音
 * - 暖簾のはためき・提灯の揺れ(update内の頂点/回転アニメ)
 * TODO(opus-street): 本実装。
 */
export function setupStreet(_ctx: AppContext, _refs: WorldRefs): System {
  return { update() {} }
}
