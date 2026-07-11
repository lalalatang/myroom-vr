import * as THREE from 'three'
import type { AppContext, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'
import { pbrMaterial } from './materials'

/**
 * プレイヤーの町家: 店先(土間)→ 奥の間(畳・v1書斎の後継)→ 坪庭。
 * 奥の間には文机・行灯・デスクランプ・ラジオ・掛け軸を引き継ぐ。
 * TODO(sonnet-machiya): 本実装(v1 の house/furniture 相当を移植改修)。
 * 以下は骨格確認用の仮床のみ。
 */
export function buildMachiya(ctx: AppContext): Partial<WorldRefs> {
  const group = new THREE.Group()
  group.name = 'machiya'
  ctx.scene.add(group)

  const o = LAYOUT.OKUNOMA
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(o.maxX - o.minX, 0.1, o.maxZ - o.minZ),
    pbrMaterial('tatami', { repeat: [3, 2], color: 0xc2b878, tint: 0xcfc493 }),
  )
  floor.position.set((o.minX + o.maxX) / 2, o.floorY - 0.05, (o.minZ + o.maxZ) / 2)
  floor.userData.walkable = true
  floor.receiveShadow = true
  group.add(floor)

  const m = LAYOUT.MISE
  const doma = new THREE.Mesh(
    new THREE.BoxGeometry(m.maxX - m.minX, 0.06, m.maxZ - m.minZ),
    pbrMaterial('stone', { repeat: [3, 2], color: 0x8a8478 }),
  )
  doma.position.set((m.minX + m.maxX) / 2, m.floorY - 0.03, (m.minZ + m.maxZ) / 2)
  doma.userData.walkable = true
  doma.receiveShadow = true
  group.add(doma)

  return { teleportSurfaces: [floor, doma], shojiPanels: [] }
}
