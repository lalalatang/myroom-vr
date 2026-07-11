import * as THREE from 'three'
import type { AppContext, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'
import { pbrMaterial } from './materials'

/**
 * 表通り(東西60m)+両側の商家群+路地+ランドマーク。
 * - 商家: 呉服屋・蕎麦屋台・八百屋・水茶屋など(ファサード中心、内部は作らない)
 * - 小物: 井戸・天水桶・置き看板・提灯・荷車・暖簾
 * - 東端: 神社の石段と鳥居(行けない・見える)、西端: 木戸(夜は閉まる)
 * - 路地: 長屋の木戸・井戸端・物干し(行き止まり)
 * TODO(sonnet-street): 本実装。以下は骨格確認用の路面のみ。
 */
export function buildStreet(ctx: AppContext): Partial<WorldRefs> {
  const group = new THREE.Group()
  group.name = 'street'
  ctx.scene.add(group)

  const s = LAYOUT.STREET
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(s.maxX - s.minX, 0.08, s.maxZ - s.minZ),
    pbrMaterial('ground', { repeat: [20, 2], color: 0x8a7a60, tint: 0xa08a68 }),
  )
  road.position.set((s.minX + s.maxX) / 2, -0.04, (s.minZ + s.maxZ) / 2)
  road.userData.walkable = true
  road.receiveShadow = true
  road.name = 'streetRoad'
  group.add(road)

  return { teleportSurfaces: [road], noren: [] }
}
