import * as THREE from 'three'
import type { AppContext, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'
import { pbrMaterial } from './materials'
import { place, mergedMesh, mergeAll, mulberry32, leafBlob } from './geo'

/**
 * 庭(地面・飛び石・池・楓・鹿威し・焚き火スペース・生垣)を構築する。
 * 石材(飛び石・沓脱石・池の縁石・焚き火の石組)は同一マテリアルなので
 * 1メッシュに統合してドローコールを節約する。
 */
export function buildGarden(ctx: AppContext): Partial<WorldRefs> {
  const group = new THREE.Group()
  group.name = 'garden'
  ctx.scene.add(group)

  const g = LAYOUT.GARDEN
  const rng = mulberry32(20260711)

  // ---- マテリアル ----------------------------------------------------
  const ground = pbrMaterial('ground', { repeat: [10, 6], color: 0x4d5238, tint: 0x8c9a6e, roughness: 1 })
  const stone = pbrMaterial('stone', { repeat: [1, 1], color: 0x84837a, roughness: 0.9 })
  const bamboo = pbrMaterial('wood_dark', { repeat: [1, 2], color: 0x8fa25f, tint: 0xa5b872, roughness: 0.45 })
  const charredWood = pbrMaterial('wood_dark', { repeat: [1, 1], color: 0x241d17, tint: 0x4a4038, roughness: 0.85 })
  const bark = pbrMaterial('wood_dark', { repeat: [1, 2], color: 0x4c3a2a, tint: 0x9a8064, roughness: 0.8 })
  const hedgeMat = pbrMaterial('ground', { repeat: [2, 1], color: 0x3c4a2c, tint: 0x6c7c50, roughness: 1 })

  // ---- 地面 -------------------------------------------------------------
  const groundW = g.maxX - g.minX
  const groundD = g.maxZ - g.minZ
  const groundMesh = new THREE.Mesh(
    new THREE.BoxGeometry(groundW, 0.1, groundD),
    ground,
  )
  groundMesh.position.set((g.minX + g.maxX) / 2, g.groundY - 0.05, (g.minZ + g.maxZ) / 2)
  groundMesh.userData.walkable = true
  groundMesh.receiveShadow = true
  groundMesh.name = 'gardenGround'
  group.add(groundMesh)

  const teleportSurfaces: THREE.Object3D[] = [groundMesh]

  // ---- 石材(飛び石・沓脱石・池縁・焚き火の石組)を1メッシュに統合 -----------
  const stoneGeoms: THREE.BufferGeometry[] = []
  const addStone = (x: number, z: number, r: number, h: number, sides = 8) => {
    const rx = r * (0.85 + rng() * 0.3)
    const rz = r * (0.85 + rng() * 0.3)
    const rot = rng() * Math.PI
    stoneGeoms.push(
      place(new THREE.CylinderGeometry(r, r * 0.94, h, sides), [x, h / 2, z], [0, rot, 0], [
        rx / r,
        1,
        rz / r,
      ]),
    )
  }

  // 沓脱石(縁側から庭へ降りる石)
  addStone(0, -1.75, 0.32, 0.14, 9)

  // 飛び石の小径(縁側 → 庭奥)
  const path: [number, number][] = [
    [0, -2.35],
    [0.55, -3.05],
    [0.25, -3.85],
    [0.9, -4.6],
    [0.55, -5.45],
    [1.15, -6.2],
    [0.85, -7.0],
  ]
  for (const [x, z] of path) addStone(x, z, 0.27 + rng() * 0.06, 0.1, 8)

  // ---- 池 -----------------------------------------------------------------
  const pondCenter = new THREE.Vector3(-3.6, 0, 4.6)
  // 池縁の石(池の周囲に不揃いに配置)
  const rimCount = 10
  for (let i = 0; i < rimCount; i++) {
    const a = (i / rimCount) * Math.PI * 2
    const rx = 1.55 + rng() * 0.15
    const rz = 1.2 + rng() * 0.15
    addStone(pondCenter.x + Math.cos(a) * rx, pondCenter.z + Math.sin(a) * rz, 0.18 + rng() * 0.08, 0.16, 7)
  }

  // 水面(不整形な楕円。オーガニックな縁のため頂点半径を揺らす)
  const pondSegs = 22
  const pondGeo = new THREE.CircleGeometry(1, pondSegs)
  {
    const pos = pondGeo.attributes.position
    const v = new THREE.Vector2()
    for (let i = 1; i < pos.count; i++) {
      // index0 は中心
      v.set(pos.getX(i), pos.getY(i))
      const jitter = 1 + (rng() - 0.5) * 0.18
      pos.setXY(i, v.x * jitter, v.y * jitter)
    }
    pondGeo.computeVertexNormals()
  }
  const pondMat = new THREE.MeshStandardMaterial({
    color: 0x1c3430,
    roughness: 0.12,
    metalness: 0.35,
    transparent: true,
    opacity: 0.88,
  })
  const pond = new THREE.Mesh(pondGeo, pondMat)
  pond.rotation.x = -Math.PI / 2
  pond.scale.set(1.35, 1, 1.05)
  pond.position.set(pondCenter.x, -0.08, pondCenter.z)
  pond.name = 'pond'
  group.add(pond)

  // 池底(暗い水底の見え方を出す薄い皿)
  const pondBed = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.4, 0.12, pondSegs),
    stone,
  )
  pondBed.scale.set(1.35, 1, 1.05)
  pondBed.position.set(pondCenter.x, -0.2, pondCenter.z)
  pondBed.receiveShadow = true
  group.add(pondBed)

  // ---- 楓の木 ---------------------------------------------------------------
  const treePos = new THREE.Vector3(3.6, 0, 6.2)
  const trunkGeoms: THREE.BufferGeometry[] = []
  trunkGeoms.push(
    place(new THREE.CylinderGeometry(0.11, 0.19, 1.9, 8), [treePos.x, 0.95, treePos.z]),
  )
  const branchDirs: [number, number, number][] = [
    [0.55, 1.7, 0.25],
    [-0.5, 1.85, -0.2],
    [0.15, 1.95, -0.55],
  ]
  for (const [bx, by, bz] of branchDirs) {
    const len = 0.9 + rng() * 0.4
    const dir = new THREE.Vector3(bx, by - 1.5, bz).normalize()
    const base = new THREE.Vector3(treePos.x, 1.75, treePos.z)
    const branch = new THREE.CylinderGeometry(0.045, 0.08, len, 6)
    // 原点基準にしてから向きを合わせる(根本=原点、先端=+Y*len)
    branch.translate(0, len / 2, 0)
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    branch.applyQuaternion(quat)
    branch.translate(base.x, base.y, base.z)
    trunkGeoms.push(branch)
  }
  const trunk = mergedMesh(trunkGeoms, bark, { castShadow: true, receiveShadow: true })
  trunk.name = 'mapleTrunk'
  group.add(trunk)

  // 葉: ローポリ感を抑えるため Icosahedron を軽くジッタし、頂点カラーで紅葉のグラデーションを付ける
  const leafPalette = [0xb33f2e, 0xd98a3d, 0x8c8a3a, 0xc4552f].map((c) => new THREE.Color(c))
  const leafGeoms: THREE.BufferGeometry[] = []
  const canopyCenter = new THREE.Vector3(treePos.x + 0.1, 2.7, treePos.z - 0.1)
  const blobCount = 16
  for (let i = 0; i < blobCount; i++) {
    const a = rng() * Math.PI * 2
    const h = rng() * Math.PI - Math.PI / 2
    const r = 0.55 + rng() * 0.55
    const ox = Math.cos(a) * Math.cos(h) * r
    const oy = Math.sin(h) * r * 0.6
    const oz = Math.sin(a) * Math.cos(h) * r
    const radius = 0.38 + rng() * 0.28
    const color = leafPalette[Math.floor(rng() * leafPalette.length)]
    const blob = leafBlob(radius, 1, 0.32, color, rng)
    blob.translate(canopyCenter.x + ox, canopyCenter.y + oy, canopyCenter.z + oz)
    leafGeoms.push(blob)
  }
  const leafGeo = mergeAll(leafGeoms)!
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    vertexColors: true,
  })
  const leaves = new THREE.Mesh(leafGeo, leafMat)
  leaves.name = 'mapleLeaves'
  leaves.castShadow = true
  group.add(leaves)

  // ---- 鹿威し ---------------------------------------------------------------
  const shishiBase = new THREE.Vector3(-4.0, 0, 1.6)
  const shishiodoshi = new THREE.Group()
  shishiodoshi.name = 'shishiodoshi'
  shishiodoshi.position.copy(shishiBase)
  group.add(shishiodoshi)

  // 受け石(水受けの石鉢) — 石メッシュへ統合
  addStone(shishiBase.x, shishiBase.z, 0.22, 0.22, 8)

  // 支柱(竹、静的)
  const bambooGeoms: THREE.BufferGeometry[] = []
  bambooGeoms.push(place(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), [-0.18, 0.35, 0]))
  bambooGeoms.push(place(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), [0.18, 0.35, 0]))
  // 支柱上部を繋ぐ横木
  bambooGeoms.push(
    place(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8), [0, 0.68, 0], [0, 0, Math.PI / 2]),
  )
  const shishiStatic = mergedMesh(bambooGeoms, bamboo, { castShadow: false, receiveShadow: false })
  shishiodoshi.add(shishiStatic)

  // 可動アーム(竹筒)。支点(0.68付近)からずらして偏心させ、シーソー運動を可能にする
  const armPivot = new THREE.Group()
  armPivot.name = 'shishiArm'
  armPivot.position.set(0, 0.68, 0)
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.9, 8), bamboo)
  tube.rotation.x = Math.PI / 2
  tube.position.set(0, 0, 0.15)
  tube.castShadow = false
  armPivot.add(tube)
  shishiodoshi.add(armPivot)

  // ---- 焚き火スペース ---------------------------------------------------------
  const bonfirePos = new THREE.Vector3(2.6, 0, 2.2)
  const bonfire = new THREE.Group()
  bonfire.name = 'bonfire'
  bonfire.position.copy(bonfirePos)
  group.add(bonfire)

  // 石組(輪、石メッシュへ統合)
  const ringCount = 9
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * Math.PI * 2
    addStone(bonfirePos.x + Math.cos(a) * 0.55, bonfirePos.z + Math.sin(a) * 0.55, 0.13, 0.16, 6)
  }

  // 薪(井桁に組む)
  const logGeoms: THREE.BufferGeometry[] = []
  const logLen = 0.5
  for (let i = 0; i < 3; i++) {
    logGeoms.push(
      place(new THREE.CylinderGeometry(0.045, 0.05, logLen, 6), [0, 0.05 + i * 0.02, (i - 1) * 0.12], [
        0,
        0,
        Math.PI / 2,
      ]),
    )
  }
  for (let i = 0; i < 3; i++) {
    logGeoms.push(
      place(
        new THREE.CylinderGeometry(0.045, 0.05, logLen, 6),
        [(i - 1) * 0.12, 0.12 + i * 0.02, 0],
        [Math.PI / 2, 0, 0],
      ),
    )
  }
  const logs = mergedMesh(logGeoms, charredWood, { castShadow: false, receiveShadow: true })
  logs.name = 'bonfireLogs'
  bonfire.add(logs)

  // 石材メッシュを統合して庭グループへ追加(飛び石・沓脱石・池縁・鹿威し受け石・焚き火の石組)
  const stoneMesh = mergedMesh(stoneGeoms, stone, { castShadow: false, receiveShadow: true })
  stoneMesh.name = 'gardenStones'
  stoneMesh.userData.walkable = true
  group.add(stoneMesh)
  teleportSurfaces.push(stoneMesh)

  // ---- 生垣(南・東・西の外周。北は家屋が兼ねる) --------------------------
  const hedgeGeoms: THREE.BufferGeometry[] = []
  const hedgeSeg = (cx: number, cz: number, len: number, alongX: boolean) => {
    const h = 0.9 + rng() * 0.25
    const w = alongX ? len : 0.4
    const d = alongX ? 0.4 : len
    hedgeGeoms.push(place(new THREE.BoxGeometry(w, h, d), [cx, h / 2, cz]))
  }
  const SITE_MIN = -9.7
  const SITE_MAX = 9.7
  const segLen = 2
  // 南辺
  for (let x = SITE_MIN; x < SITE_MAX; x += segLen) {
    hedgeSeg(x + segLen / 2, SITE_MAX, Math.min(segLen, SITE_MAX - x), true)
  }
  // 東西辺(縁側の南端 z=-1.4 から南辺まで)
  const eastWestStart = LAYOUT.ENGAWA.maxZ + 0.3
  for (let z = eastWestStart; z < SITE_MAX; z += segLen) {
    const len = Math.min(segLen, SITE_MAX - z)
    hedgeSeg(SITE_MAX, z + len / 2, len, false)
    hedgeSeg(SITE_MIN, z + len / 2, len, false)
  }
  const hedge = mergedMesh(hedgeGeoms, hedgeMat, { castShadow: false, receiveShadow: true })
  hedge.name = 'hedge'
  group.add(hedge)

  return {
    teleportSurfaces,
    pond,
    shishiodoshi,
    bonfire,
  }
}
