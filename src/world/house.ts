import * as THREE from 'three'
import type { AppContext, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'

/**
 * 家屋(書斎・土間・縁側・障子・屋根・軒)を構築する。
 * TODO(sonnet-world): 本実装。以下は骨格確認用の仮床のみ。
 */
export function buildHouse(_ctx: AppContext): Partial<WorldRefs> {
  const group = new THREE.Group()
  group.name = 'house'
  _ctx.scene.add(group)

  const s = LAYOUT.STUDY
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(s.maxX - s.minX, 0.1, s.maxZ - s.minZ),
    new THREE.MeshStandardMaterial({ color: 0x8a7a5a }),
  )
  floor.position.set((s.minX + s.maxX) / 2, s.floorY - 0.05, (s.minZ + s.maxZ) / 2)
  floor.userData.walkable = true
  floor.receiveShadow = true
  group.add(floor)

  return { teleportSurfaces: [floor], shojiPanels: [] }
}
