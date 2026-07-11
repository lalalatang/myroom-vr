import type { AppContext, System, WorldRefs } from '../core/types'

/**
 * 焚き火(P1-9): 夜のみクリックで点火可能。炎スプライト+揺れるPointLight+パチパチ音。
 * 光の強度適用は lighting システム側(state.bonfireLit を参照)。
 * TODO(opus-audio): 本実装。
 */
export function setupBonfire(_ctx: AppContext, _refs: WorldRefs): System {
  return { update() {} }
}
