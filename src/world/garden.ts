import * as THREE from 'three'
import type { AppContext, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'

/**
 * 庭(地面・飛び石・池・楓・鹿威し・焚き火スペース・塀)を構築する。
 * TODO(sonnet-world): 本実装。以下は骨格確認用の仮地面のみ。
 */
export function buildGarden(ctx: AppContext): Partial<WorldRefs> {
  const group = new THREE.Group()
  group.name = 'garden'
  ctx.scene.add(group)

  const g = LAYOUT.GARDEN
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x4a5240 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = g.groundY
  ground.userData.walkable = true
  ground.receiveShadow = true
  group.add(ground)

  return { teleportSurfaces: [ground] }
}
