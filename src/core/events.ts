/**
 * 疎結合な単発イベント用の小さなバス。
 * 継続的な状態は core/state.ts を使うこと。ここは「鳴らす」「光らせる」等の瞬間イベント専用。
 */
import type * as THREE from 'three'

export type SfxName =
  | 'click' // UI・スイッチ操作音
  | 'kon' // 鹿威し
  | 'chime' // 風鈴
  | 'slide' // 障子の開閉
  | 'ignite' // 焚き火点火
  | 'splash' // 井戸の水音(v2)
  | 'coin' // 小銭が地面に落ちる「チャリン」(v2)
  | 'coinTarget' // 小銭が賽銭的に当たった時(v2)

export interface BusEvents {
  /** 効果音再生要求。position があれば3D定位、なければ非定位。audio システムが消費 */
  sfx: { name: SfxName; position?: THREE.Vector3; velocity?: number }
}

type Handler<T> = (payload: T) => void

const handlers = new Map<keyof BusEvents, Set<Handler<never>>>()

export const bus = {
  on<K extends keyof BusEvents>(name: K, fn: Handler<BusEvents[K]>): () => void {
    let set = handlers.get(name)
    if (!set) handlers.set(name, (set = new Set()))
    set.add(fn as Handler<never>)
    return () => set!.delete(fn as Handler<never>)
  },
  emit<K extends keyof BusEvents>(name: K, payload: BusEvents[K]): void {
    handlers.get(name)?.forEach((fn) => (fn as Handler<BusEvents[K]>)(payload))
  },
}
