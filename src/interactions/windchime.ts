import type { AppContext, System, WorldRefs } from '../core/types'

/**
 * 風鈴(P1-10): 縁側でかすかに揺れ、時折「チリン」(bus sfx 'chime'、3D定位)。
 * TODO(opus-audio): 本実装。
 */
export function setupWindChime(_ctx: AppContext, _refs: WorldRefs): System {
  return { update() {} }
}
