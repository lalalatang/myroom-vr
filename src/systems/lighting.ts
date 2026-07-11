import * as THREE from 'three'
import type { AppContext, System, WorldRefs } from '../core/types'

/**
 * 昼夜サイクル+照明の一元管理。
 * - HDRI(public/hdri/{morning,noon,evening,night}.hdr)を environment/background に適用
 * - directional light(太陽/月)1灯のみ影あり(§5)
 * - 行灯・デスクランプ・焚き火の PointLight 強度は store.state を見てここで適用
 * - HDRI未取得でも空グラデーションで動くフォールバック必須
 * TODO(opus-lighting): 本実装。以下は骨格確認用の仮ライト。
 */
export function createLighting(ctx: AppContext, _refs: WorldRefs): System {
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.5)
  sun.position.set(8, 12, 6)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  ctx.scene.add(sun)
  ctx.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a5040, 0.7))
  return { update() {} }
}
