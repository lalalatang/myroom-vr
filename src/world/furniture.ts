import * as THREE from 'three'
import type { AppContext, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'
import { pbrMaterial } from './materials'
import { place, mergedMesh, mulberry32 } from './geo'

/**
 * 家具(文机・本棚・掛け軸・行灯・デスクランプ・ラジオ・座布団・風鈴)を構築する。
 */
export function buildFurniture(ctx: AppContext): Partial<WorldRefs> {
  const group = new THREE.Group()
  group.name = 'furniture'
  ctx.scene.add(group)

  const s = LAYOUT.STUDY
  const rng = mulberry32(816)

  const woodDark = pbrMaterial('wood_dark', { repeat: [1, 1], color: 0x3c2c1e, tint: 0x7d6a56, roughness: 0.55 })
  const washi = pbrMaterial('washi', { color: 0xf2e9d2 })
  const tatami = pbrMaterial('tatami', { repeat: [1, 1], color: 0xa89a58, tint: 0xbfb383, roughness: 0.95 })

  const lampFixtures: Partial<WorldRefs['lampFixtures']> = {}

  // ---- 文机(座卓) ---------------------------------------------------------
  const deskCenter = new THREE.Vector3(1.5, s.floorY, -5.5)
  const deskH = 0.32
  const deskGeoms: THREE.BufferGeometry[] = []
  deskGeoms.push(place(new THREE.BoxGeometry(1.15, 0.04, 0.5), [0, deskH - 0.02, 0]))
  const legOffsets: [number, number][] = [
    [0.5, 0.2],
    [-0.5, 0.2],
    [0.5, -0.2],
    [-0.5, -0.2],
  ]
  for (const [lx, lz] of legOffsets) {
    deskGeoms.push(place(new THREE.BoxGeometry(0.05, deskH - 0.04, 0.05), [lx, (deskH - 0.04) / 2, lz]))
  }
  const desk = mergedMesh(deskGeoms, woodDark, { castShadow: true, receiveShadow: true })
  desk.name = 'desk'
  desk.position.copy(deskCenter)
  group.add(desk)
  const deskTopY = deskCenter.y + deskH

  // ---- 本棚(北壁、窓を避けて西寄り) ------------------------------------------
  const shelfX0 = s.minX
  const shelfX1 = 1.5
  const shelfZ = LAYOUT.STUDY.minZ + 0.2 // 内壁面のすぐ内側
  const shelfY0 = s.floorY
  const shelfTopY = 2.5
  const shelfDepth = 0.32
  const shelfGeoms: THREE.BufferGeometry[] = []
  const shelfW = shelfX1 - shelfX0
  const shelfCx = (shelfX0 + shelfX1) / 2
  // 背板
  shelfGeoms.push(
    place(new THREE.BoxGeometry(shelfW, shelfTopY - shelfY0, 0.03), [
      shelfCx,
      (shelfY0 + shelfTopY) / 2,
      shelfZ - shelfDepth / 2,
    ]),
  )
  // 側板
  for (const sx of [shelfX0, shelfX1]) {
    shelfGeoms.push(
      place(new THREE.BoxGeometry(0.03, shelfTopY - shelfY0, shelfDepth), [sx, (shelfY0 + shelfTopY) / 2, shelfZ]),
    )
  }
  // 棚板
  const shelfBoardYs = [shelfY0, shelfY0 + 0.55, shelfY0 + 1.1, shelfY0 + 1.65, shelfTopY]
  for (const by of shelfBoardYs) {
    shelfGeoms.push(place(new THREE.BoxGeometry(shelfW, 0.03, shelfDepth), [shelfCx, by, shelfZ]))
  }
  const shelfFrame = mergedMesh(shelfGeoms, woodDark, { castShadow: false, receiveShadow: true })
  shelfFrame.name = 'bookshelfFrame'
  group.add(shelfFrame)

  // 本(InstancedMesh、色をランダムに)
  const bookPalette = [0x6b2a2a, 0x2a3a52, 0x2f4a34, 0x8a6a2a, 0x3a2a20, 0x5a4a70].map(
    (c) => new THREE.Color(c),
  )
  const rowGap = 0.02
  const rows: number[] = []
  for (let i = 0; i < shelfBoardYs.length - 1; i++) rows.push(shelfBoardYs[i] + rowGap)
  const booksPerRow = 110
  const bookCount = rows.length * booksPerRow
  const bookGeo = new THREE.BoxGeometry(1, 1, 1)
  const bookMat = new THREE.MeshStandardMaterial({ roughness: 0.85 })
  const books = new THREE.InstancedMesh(bookGeo, bookMat, bookCount)
  books.name = 'books'
  const dummy = new THREE.Object3D()
  let bi = 0
  const usableW = shelfW - 0.1
  for (const rowY of rows) {
    const bh = 0.42 + rng() * 0.06
    for (let i = 0; i < booksPerRow; i++) {
      const bw = 0.028 + rng() * 0.018
      const bd = shelfDepth - 0.06
      const x = shelfX0 + 0.06 + (usableW / booksPerRow) * (i + 0.5) + (rng() - 0.5) * 0.005
      dummy.position.set(x, rowY + bh / 2, shelfZ)
      dummy.rotation.set(0, (rng() - 0.5) * 0.06, 0)
      dummy.scale.set(bw, bh, bd)
      dummy.updateMatrix()
      books.setMatrixAt(bi, dummy.matrix)
      books.setColorAt(bi, bookPalette[Math.floor(rng() * bookPalette.length)])
      bi++
    }
  }
  books.instanceMatrix.needsUpdate = true
  if (books.instanceColor) books.instanceColor.needsUpdate = true
  group.add(books)

  // ---- 掛け軸(東壁) --------------------------------------------------------
  // 東壁は中心x=4・厚0.15 → 内面は x=3.925。埋没しないよう十分手前に出す
  const kakejikuCenter = new THREE.Vector3(s.maxX - 0.12, 1.65, -5)
  const kakejiku = new THREE.Group()
  kakejiku.name = 'kakejiku'
  kakejiku.position.copy(kakejikuCenter)
  kakejiku.rotation.y = -Math.PI / 2 // 東壁の内側を向く(法線 -X)
  const scrollW = 0.55
  const scrollH = 1.3
  const rodGeom = new THREE.CylinderGeometry(0.02, 0.02, scrollW + 0.1, 8)
  const rodTop = new THREE.Mesh(rodGeom, woodDark)
  rodTop.rotation.z = Math.PI / 2
  rodTop.position.set(0, scrollH / 2 + 0.02, 0)
  const rodBottom = rodTop.clone()
  rodBottom.position.y = -scrollH / 2 - 0.02
  const scrollBody = new THREE.Mesh(new THREE.PlaneGeometry(scrollW, scrollH), washi)
  kakejiku.add(rodTop, rodBottom, scrollBody)
  kakejiku.userData.faceNormal = new THREE.Vector3(-1, 0, 0)
  group.add(kakejiku)

  // ---- 行灯(床置き) --------------------------------------------------------
  const andon = new THREE.Group()
  andon.name = 'andon'
  andon.position.set(-3.3, s.floorY, -3.6)
  const andonBase = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.34), woodDark)
  andonBase.position.y = 0.03
  const andonFrameGeoms: THREE.BufferGeometry[] = []
  const postOffsets: [number, number][] = [
    [0.15, 0.15],
    [-0.15, 0.15],
    [0.15, -0.15],
    [-0.15, -0.15],
  ]
  for (const [px, pz] of postOffsets) {
    andonFrameGeoms.push(place(new THREE.BoxGeometry(0.025, 0.5, 0.025), [px, 0.06 + 0.25, pz]))
  }
  andonFrameGeoms.push(place(new THREE.BoxGeometry(0.34, 0.02, 0.34), [0, 0.56, 0]))
  const andonFrame = mergedMesh(andonFrameGeoms, woodDark, { castShadow: false, receiveShadow: false })
  // 発光部は emissive を lighting が個別制御するため、共有 washi とは別インスタンスにする
  const andonShade = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.44, 0.3),
    pbrMaterial('washi', { color: 0xf2e9d2 }),
  )
  andonShade.position.y = 0.06 + 0.22
  andonShade.name = 'andonGlow'
  ;(andonShade.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xffdca0)
  ;(andonShade.material as THREE.MeshStandardMaterial).emissiveIntensity = 0
  const andonLight = new THREE.PointLight(0xffcf8a, 0, 4, 2)
  andonLight.name = 'andonLight'
  andonLight.position.y = 0.3
  andon.add(andonBase, andonFrame, andonShade, andonLight)
  group.add(andon)
  lampFixtures.andon = andon

  // ---- デスクランプ(文机の上) ----------------------------------------------
  const deskLamp = new THREE.Group()
  deskLamp.name = 'deskLamp'
  deskLamp.position.set(deskCenter.x + 0.42, deskTopY, deskCenter.z - 0.15)
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.02, 10), woodDark)
  lampBase.position.y = 0.01
  const lampArmGeoms: THREE.BufferGeometry[] = []
  lampArmGeoms.push(place(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), [0, 0.13, 0]))
  lampArmGeoms.push(
    place(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6), [0.06, 0.24, 0], [0, 0, Math.PI / 3]),
  )
  const lampArm = mergedMesh(lampArmGeoms, woodDark, { castShadow: false, receiveShadow: false })
  const lampShade = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.1, 12, 1, true),
    pbrMaterial('washi', { color: 0xf2e9d2 }),
  )
  lampShade.position.set(0.11, 0.33, 0)
  lampShade.rotation.x = Math.PI
  lampShade.name = 'deskLampGlow'
  ;(lampShade.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xfff0c0)
  ;(lampShade.material as THREE.MeshStandardMaterial).emissiveIntensity = 0
  const deskLampLight = new THREE.PointLight(0xffe6b0, 0, 2.5, 2)
  deskLampLight.name = 'deskLampLight'
  deskLampLight.position.set(0.11, 0.28, 0)
  deskLamp.add(lampBase, lampArm, lampShade, deskLampLight)
  group.add(deskLamp)
  lampFixtures.deskLamp = deskLamp

  // ---- ラジオ(文机の上) ------------------------------------------------------
  const radio = new THREE.Group()
  radio.name = 'radio'
  radio.position.set(deskCenter.x - 0.35, deskTopY, deskCenter.z - 0.1)
  const radioGeoms: THREE.BufferGeometry[] = []
  radioGeoms.push(place(new THREE.BoxGeometry(0.22, 0.13, 0.15), [0, 0.065, 0]))
  radioGeoms.push(place(new THREE.CylinderGeometry(0.018, 0.018, 0.015, 12), [0.07, 0.1, 0.076])) // ダイヤル
  for (let i = 0; i < 5; i++) {
    // スピーカー格子
    radioGeoms.push(
      place(new THREE.BoxGeometry(0.001, 0.08, 0.001), [-0.08 + i * 0.015, 0.07, 0.076]),
    )
  }
  const radioBody = mergedMesh(radioGeoms, woodDark, { castShadow: false, receiveShadow: false })
  radio.add(radioBody)
  group.add(radio)

  // ---- 座布団 x2 -------------------------------------------------------------
  const cushionMat = tatami
  const makeCushion = (x: number, z: number, rot: number) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.07, 8), cushionMat)
    c.position.set(x, s.floorY + 0.035, z)
    c.rotation.y = rot
    c.receiveShadow = true
    return c
  }
  const cushion1 = makeCushion(deskCenter.x - 0.05, deskCenter.z + 0.55, 0.3)
  const cushion2 = makeCushion(deskCenter.x - 0.6, deskCenter.z + 0.9, -0.4)
  cushion1.name = 'cushion1'
  cushion2.name = 'cushion2'
  group.add(cushion1, cushion2)

  // ---- 風鈴(縁側、軒から吊るす) -----------------------------------------------
  const windChime = new THREE.Group()
  windChime.name = 'windChime'
  windChime.position.set(3.4, 2.7, -1.6)
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xcfd6d8, roughness: 0.35, metalness: 0.7 })
  const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.35, 5), woodDark)
  thread.position.y = -0.175
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), metalMat)
  bell.position.y = -0.37
  const clapperThread = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.12, 4), woodDark)
  clapperThread.position.y = -0.44
  const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), metalMat)
  clapper.position.y = -0.5
  const tanzaku = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.16), washi)
  tanzaku.name = 'windChimeTanzaku'
  tanzaku.position.y = -0.58
  windChime.add(thread, bell, clapperThread, clapper, tanzaku)
  group.add(windChime)

  return {
    lampFixtures: lampFixtures as WorldRefs['lampFixtures'],
    radio,
    kakejiku,
    windChime,
  }
}
