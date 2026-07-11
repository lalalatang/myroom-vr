import type { AppContext, System, WorldRefs } from '../core/types'

/**
 * 鹿威し(P1-8): 一定間隔で竹アーム(name:'shishiArm')が傾き「コン」(bus sfx 'kon'、3D定位)。
 * TODO(opus-audio): 本実装。
 */
export function setupShishiodoshi(_ctx: AppContext, _refs: WorldRefs): System {
  return { update() {} }
}
