import type { AppContext, System, WorldRefs } from '../core/types'

/**
 * 簡易NPC(P0: 賑わいの第2層)。
 * - ローポリ人型(頭+着物のシルエット、1体200ポリ以下)を InstancedMesh で15〜25体
 * - 通り(LAYOUT.STREET)を一定経路でゆっくり歩く(端で折返し)。歩行のボビング・わずかな揺れ
 * - プレイヤーが1.2m以内に近づくと立ち止まって会釈
 * - 雨天(store.state.weather==='rain')は人数を減らす
 * TODO(opus-npc): 本実装。
 */
export function createNpc(_ctx: AppContext, _refs: WorldRefs): System {
  return { update() {} }
}
