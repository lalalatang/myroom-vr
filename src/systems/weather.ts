import type { AppContext, System, WorldRefs } from '../core/types'

/**
 * 天候システム(P1): 晴れ/雨。雨=パーティクル+雨音(audio連携)+池の波紋。
 * TODO(opus-lighting): 本実装。
 */
export function createWeather(_ctx: AppContext, _refs: WorldRefs): System {
  return { update() {} }
}
