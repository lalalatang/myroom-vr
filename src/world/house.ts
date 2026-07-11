import * as THREE from 'three'
import type { AppContext, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'
import { pbrMaterial } from './materials'
import { place, mergedMesh, quadPrism } from './geo'

/**
 * 家屋(書斎・土間・縁側・障子・屋根・軒)を構築する。
 *
 * 建物外形:北壁(x -6..4, z=-9)・東壁(x=4, z -9..-3, 書斎側)・西壁(x=-6, z -9..-3, 土間側)の
 * 3枚のみを外壁として建てる(土間⇔書斎は間仕切りなしの土続き、床の高低差40cmで表現)。
 * 南面(書斎⇔縁側)は壁を作らず、開口の両側だけ袖壁を残して障子2枚で塞ぐ。
 * 屋根は片流れ(北高・南低)にして、複雑なジオメトリの符号ミスを避けつつ縁側の軒を深く出す。
 */

const WALL_T = 0.15
const CEIL_Y = LAYOUT.STUDY.ceilingY // 2.8

const NORTH_Z = LAYOUT.STUDY.minZ // -9 (DOMAと共通)
const EAST_X = LAYOUT.STUDY.maxX // 4
const WEST_X = LAYOUT.DOMA.minX // -6
const PART_Z = LAYOUT.SHOJI_Z // -3 (書斎/縁側境界)
const OPEN_HALF = 1.2 // 障子開口の半幅

// 屋根(片流れ): 北で高く、南(縁側の軒先)で低い
const ROOF_X0 = WEST_X - 0.6
const ROOF_X1 = EAST_X + 0.6
const ROOF_NORTH_Z = NORTH_Z - 0.6
const ROOF_SOUTH_Z = LAYOUT.ENGAWA.maxZ + 0.5
const ROOF_NORTH_Y = 3.3
const ROOF_SOUTH_Y = 2.85
const ROOF_THICK = 0.12

function roofYAt(z: number): number {
  const t = (z - ROOF_NORTH_Z) / (ROOF_SOUTH_Z - ROOF_NORTH_Z)
  return ROOF_NORTH_Y + (ROOF_SOUTH_Y - ROOF_NORTH_Y) * t
}

export function buildHouse(ctx: AppContext): Partial<WorldRefs> {
  const group = new THREE.Group()
  group.name = 'house'
  ctx.scene.add(group)

  // ---- マテリアル ----------------------------------------------------
  const woodDark = pbrMaterial('wood_dark', { repeat: [1, 1], color: 0x4a3626, tint: 0x8a7460, roughness: 0.65 })
  const woodFloor = pbrMaterial('wood_floor', { repeat: [3, 2], color: 0xb08a5c, roughness: 0.55 })
  const tatami = pbrMaterial('tatami', { repeat: [4, 3], color: 0xc2b878, tint: 0xcfc493, roughness: 0.9 })
  const plaster = pbrMaterial('plaster', { repeat: [4, 1], color: 0xe9e2d0, roughness: 0.95 })
  plaster.side = THREE.DoubleSide // 手組みの平面もあるため法線の向きに神経質にならない
  const stone = pbrMaterial('stone', { repeat: [2, 2], color: 0x8a8478, roughness: 1 })
  const roofMat = pbrMaterial('roof', { repeat: [4, 3], color: 0x3a3f42, roughness: 0.8 })
  roofMat.side = THREE.DoubleSide
  const washi = pbrMaterial('washi')

  const teleportSurfaces: THREE.Object3D[] = []
  const windowLightTargets: THREE.Vector3[] = []

  // ---- 床 -------------------------------------------------------------
  const s = LAYOUT.STUDY
  const studyFloor = new THREE.Mesh(
    new THREE.BoxGeometry(s.maxX - s.minX, 0.1, s.maxZ - s.minZ),
    tatami,
  )
  studyFloor.position.set((s.minX + s.maxX) / 2, s.floorY - 0.05, (s.minZ + s.maxZ) / 2)
  studyFloor.userData.walkable = true
  studyFloor.receiveShadow = true
  studyFloor.name = 'studyFloor'
  group.add(studyFloor)
  teleportSurfaces.push(studyFloor)

  const d = LAYOUT.DOMA
  const domaFloor = new THREE.Mesh(
    new THREE.BoxGeometry(d.maxX - d.minX, 0.1, d.maxZ - d.minZ),
    stone,
  )
  domaFloor.position.set((d.minX + d.maxX) / 2, d.floorY - 0.05, (d.minZ + d.maxZ) / 2)
  domaFloor.userData.walkable = true
  domaFloor.receiveShadow = true
  domaFloor.name = 'domaFloor'
  group.add(domaFloor)
  teleportSurfaces.push(domaFloor)

  const e = LAYOUT.ENGAWA
  const engawaFloor = new THREE.Mesh(
    new THREE.BoxGeometry(e.maxX - e.minX, 0.08, e.maxZ - e.minZ),
    woodFloor,
  )
  engawaFloor.position.set((e.minX + e.maxX) / 2, e.floorY - 0.04, (e.minZ + e.maxZ) / 2)
  engawaFloor.userData.walkable = true
  engawaFloor.receiveShadow = true
  engawaFloor.name = 'engawaFloor'
  group.add(engawaFloor)
  teleportSurfaces.push(engawaFloor)

  // ---- 壁(北・東・西 + 南の袖壁) ---------------------------------------
  const wallGeoms: THREE.BufferGeometry[] = []
  const addWallBox = (
    w: number,
    h: number,
    depth: number,
    cx: number,
    cy: number,
    cz: number,
  ) => {
    wallGeoms.push(place(new THREE.BoxGeometry(w, h, depth), [cx, cy, cz]))
  }
  // 北壁(全幅)
  addWallBox(EAST_X - WEST_X, CEIL_Y, WALL_T, (WEST_X + EAST_X) / 2, CEIL_Y / 2, NORTH_Z)
  // 東壁(書斎側)
  addWallBox(WALL_T, CEIL_Y, PART_Z - NORTH_Z, EAST_X, CEIL_Y / 2, (NORTH_Z + PART_Z) / 2)
  // 西壁(土間側)
  addWallBox(WALL_T, CEIL_Y, PART_Z - NORTH_Z, WEST_X, CEIL_Y / 2, (NORTH_Z + PART_Z) / 2)
  // 南の袖壁(障子開口の両脇、書斎の床から天井まで)
  const flankH = CEIL_Y - s.floorY
  addWallBox(-OPEN_HALF - s.minX, flankH, WALL_T, (s.minX + -OPEN_HALF) / 2, s.floorY + flankH / 2, PART_Z)
  addWallBox(s.maxX - OPEN_HALF, flankH, WALL_T, (OPEN_HALF + s.maxX) / 2, s.floorY + flankH / 2, PART_Z)
  const walls = mergedMesh(wallGeoms, plaster, { receiveShadow: true })
  walls.name = 'walls'
  group.add(walls)

  // ---- 丸窓(書斎北壁) --------------------------------------------------
  const WINDOW_X = 2.7
  const WINDOW_Y = 1.7
  const windowGroup = new THREE.Group()
  windowGroup.position.set(WINDOW_X, WINDOW_Y, NORTH_Z + WALL_T / 2 + 0.02)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 8, 24), woodDark)
  const pane = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), washi)
  pane.position.z = -0.01
  windowGroup.add(ring, pane)
  group.add(windowGroup)
  windowLightTargets.push(new THREE.Vector3(WINDOW_X, WINDOW_Y, NORTH_Z))

  // ---- 構造材(柱・梁・畳の目地・上がり框)を1メッシュに統合 -----------------
  const woodGeoms: THREE.BufferGeometry[] = []
  const pillar = (x: number, z: number, yBase: number, yTop: number) => {
    const h = yTop - yBase
    woodGeoms.push(place(new THREE.BoxGeometry(0.14, h, 0.14), [x, yBase + h / 2, z]))
  }
  const beam = (cx: number, cy: number, cz: number, w: number, dep: number) => {
    woodGeoms.push(place(new THREE.BoxGeometry(w, 0.15, dep), [cx, cy, cz]))
  }
  // 北壁沿いの柱
  for (const x of [WEST_X, -3.5, -1, 1.5, EAST_X]) pillar(x, NORTH_Z, 0, CEIL_Y)
  // 東壁沿いの柱
  for (const z of [NORTH_Z, -6, PART_Z]) pillar(EAST_X, z, 0, CEIL_Y)
  // 西壁沿いの柱
  for (const z of [NORTH_Z, -6, PART_Z]) pillar(WEST_X, z, 0, CEIL_Y)
  // 南袖壁の柱(開口脇・端)
  for (const x of [s.minX, -OPEN_HALF, OPEN_HALF, s.maxX]) pillar(x, PART_Z, s.floorY, CEIL_Y)
  // 縁側の縁桁を受ける軒先柱
  for (const x of [-3.8, -1.3, 1.3, 3.8]) {
    pillar(x, LAYOUT.ENGAWA.maxZ, e.floorY, roofYAt(LAYOUT.ENGAWA.maxZ) - 0.05)
  }
  // 梁(桁・鴨居)
  beam((WEST_X + EAST_X) / 2, CEIL_Y, NORTH_Z, EAST_X - WEST_X, 0.15)
  beam(EAST_X, CEIL_Y, (NORTH_Z + PART_Z) / 2, 0.15, PART_Z - NORTH_Z)
  beam(WEST_X, CEIL_Y, (NORTH_Z + PART_Z) / 2, 0.15, PART_Z - NORTH_Z)
  beam((s.minX + -OPEN_HALF) / 2, CEIL_Y, PART_Z, -OPEN_HALF - s.minX, 0.15)
  beam((OPEN_HALF + s.maxX) / 2, CEIL_Y, PART_Z, s.maxX - OPEN_HALF, 0.15)
  beam(0, roofYAt(LAYOUT.ENGAWA.maxZ) - 0.02, LAYOUT.ENGAWA.maxZ, e.maxX - e.minX, 0.12)
  // 上がり框(土間→書斎の段差)
  woodGeoms.push(
    place(new THREE.BoxGeometry(0.06, s.floorY, PART_Z - NORTH_Z), [
      s.minX + 0.03,
      s.floorY / 2,
      (NORTH_Z + PART_Z) / 2,
    ]),
  )
  // 畳の目地(畳縁)。テクスチャ流用だと縁が光って見えるため艶消しの濃紺无地にする
  const mejiGeoms: THREE.BufferGeometry[] = []
  for (const x of [-2, 0, 2]) {
    mejiGeoms.push(
      place(new THREE.BoxGeometry(0.04, 0.01, s.maxZ - s.minZ), [x, s.floorY + 0.006, (s.minZ + s.maxZ) / 2]),
    )
  }
  for (const z of [-7, -5]) {
    mejiGeoms.push(
      place(new THREE.BoxGeometry(s.maxX - s.minX, 0.01, 0.04), [0, s.floorY + 0.006, z]),
    )
  }
  const meji = mergedMesh(
    mejiGeoms,
    new THREE.MeshStandardMaterial({ color: 0x2c3140, roughness: 0.95, metalness: 0 }),
    { receiveShadow: true },
  )
  meji.name = 'tatamiMeji'
  group.add(meji)
  const structure = mergedMesh(woodGeoms, woodDark, { castShadow: true, receiveShadow: true })
  structure.name = 'structure'
  group.add(structure)

  // ---- 天井(書斎・土間)と軒天(縁側) ------------------------------------
  // 屋根裏(片流れ屋根の裏面)が室内から見えるとモアレ状に汚いので板天井で隠す
  const ceilingMat = pbrMaterial('wood_floor', { repeat: [8, 5], color: 0xa88a60 })
  const ceilGeoms: THREE.BufferGeometry[] = [
    // 書斎+土間の天井
    place(new THREE.BoxGeometry(EAST_X - WEST_X, 0.05, PART_Z - NORTH_Z), [
      (WEST_X + EAST_X) / 2,
      CEIL_Y + 0.025,
      (NORTH_Z + PART_Z) / 2,
    ]),
    // 縁側〜軒先の軒天
    place(new THREE.BoxGeometry(EAST_X - WEST_X, 0.04, ROOF_SOUTH_Z - PART_Z), [
      (WEST_X + EAST_X) / 2,
      CEIL_Y + 0.02,
      (PART_Z + ROOF_SOUTH_Z) / 2,
    ]),
  ]
  const ceiling = mergedMesh(ceilGeoms, ceilingMat, { receiveShadow: false })
  ceiling.name = 'ceiling'
  group.add(ceiling)

  // ---- 屋根(片流れ+妻壁) -----------------------------------------------
  const roofGeoms: THREE.BufferGeometry[] = []
  const nw = new THREE.Vector3(ROOF_X0, ROOF_NORTH_Y, ROOF_NORTH_Z)
  const sw = new THREE.Vector3(ROOF_X0, ROOF_SOUTH_Y, ROOF_SOUTH_Z)
  const se = new THREE.Vector3(ROOF_X1, ROOF_SOUTH_Y, ROOF_SOUTH_Z)
  const ne = new THREE.Vector3(ROOF_X1, ROOF_NORTH_Y, ROOF_NORTH_Z)
  roofGeoms.push(quadPrism(nw, sw, se, ne, ROOF_THICK, [5, 4]))
  // 妻壁(東西の三角の隙間を塞ぐ、壁天端から屋根裏まで)
  for (const gx of [EAST_X, WEST_X]) {
    const p1 = new THREE.Vector3(gx, CEIL_Y, NORTH_Z)
    const p2 = new THREE.Vector3(gx, roofYAt(NORTH_Z), NORTH_Z)
    const p3 = new THREE.Vector3(gx, roofYAt(PART_Z), PART_Z)
    const p4 = new THREE.Vector3(gx, CEIL_Y, PART_Z)
    roofGeoms.push(quadPrism(p1, p2, p3, p4, 0.1))
  }
  const roof = mergedMesh(roofGeoms, roofMat, { castShadow: true, receiveShadow: true })
  roof.name = 'roof'
  group.add(roof)

  // ---- 障子2枚 ----------------------------------------------------------
  const shojiPanels: THREE.Object3D[] = []
  const panelW = 1.2
  const panelH = CEIL_Y - s.floorY - 0.15
  const buildPanel = (closedX: number, openX: number, z: number): THREE.Object3D => {
    const panel = new THREE.Group()
    panel.position.set(closedX, s.floorY, z)
    const frameGeoms: THREE.BufferGeometry[] = []
    const barT = 0.05
    // 外枠
    frameGeoms.push(place(new THREE.BoxGeometry(panelW, barT, barT), [0, 0, 0])) // 下框
    frameGeoms.push(place(new THREE.BoxGeometry(panelW, barT, barT), [0, panelH, 0])) // 上框
    frameGeoms.push(place(new THREE.BoxGeometry(barT, panelH, barT), [-panelW / 2, panelH / 2, 0]))
    frameGeoms.push(place(new THREE.BoxGeometry(barT, panelH, barT), [panelW / 2, panelH / 2, 0]))
    // 組子(格子): 横2本・縦1本
    for (const fy of [panelH * 0.35, panelH * 0.68]) {
      frameGeoms.push(place(new THREE.BoxGeometry(panelW - barT, 0.025, 0.025), [0, fy, 0]))
    }
    frameGeoms.push(place(new THREE.BoxGeometry(0.025, panelH - barT, 0.025), [0, panelH / 2, 0]))
    const frame = mergedMesh(frameGeoms, woodDark, { castShadow: false, receiveShadow: false })
    panel.add(frame)

    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(panelW - barT * 1.4, panelH - barT * 1.4),
      washi,
    )
    paper.position.set(0, panelH / 2, 0)
    panel.add(paper)

    panel.userData.slide = { axis: 'x', closed: closedX, open: openX }
    return panel
  }
  // 開口 x:-1.2..1.2 を2枚で塞ぐ。開くと東側へ重ねて逃がす。
  const panelA = buildPanel(-0.6, 0.6, PART_Z - 0.02)
  const panelB = buildPanel(0.6, 1.8, PART_Z + 0.02)
  panelA.name = 'shojiPanelA'
  panelB.name = 'shojiPanelB'
  group.add(panelA, panelB)
  shojiPanels.push(panelA, panelB)
  windowLightTargets.push(new THREE.Vector3(0, s.floorY + panelH / 2, PART_Z))

  return { teleportSurfaces, shojiPanels, windowLightTargets }
}
