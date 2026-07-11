import * as THREE from 'three'
import type { AppContext, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'
import { pbrMaterial } from './materials'
import { place, mergedMesh, quadPrism, mulberry32, leafBlob } from './geo'

/**
 * プレイヤーの町家(間口6m、通りに面した商家)。
 *
 * 通り(南, z=-3)→ 店先(土間・MISE, y=0)→ 障子(SHOJI_Z=-8.5)→ 奥の間(畳・OKUNOMA, y=0.35)
 * → 坪庭(TSUBONIWA, y=0, 開放)と北へ続く。軒高はどこも LAYOUT.EAVE_Y(2.2m)で統一し、
 * 江戸町家らしい「圧の低さ」を作る(壁の立ち上がりは軒高でフラットに切り、屋根はそこから
 * 片流れで北へ緩く上がるだけ。天井高が異様に高くならないよう終始 2.2m 前後に抑える)。
 *
 * ドローコール予算(この建物単体で目安20以下)のため、当たり判定/個別アニメが不要な
 * 静的ジオメトリ(柱・梁・格子・上がり框・店の造作・文机・文庫棚・行灯や電気スタンドの
 * 台座部分・風鈴の金物・掛け軸の軸棒と本紙)はすべて素材ごとに mergeGeometries で1メッシュに
 * 統合する。クリック対象になる物体(ラジオ本体、行灯/デスクランプの発光笠、風鈴の短冊、
 * 障子2枚、暖簾)だけは個別 Object3D として残す。
 */

// ---- 建物envelope -------------------------------------------------------
const WALL_T = 0.15
const o = LAYOUT.OKUNOMA
const m = LAYOUT.MISE
const tb = LAYOUT.TSUBONIWA
const WEST_X = o.minX // -6
const EAST_X = o.maxX // 0
const CENTER_X = (WEST_X + EAST_X) / 2 // -3
const NORTH_Z = o.minZ // -13 (奥の間/坪庭の境)
const SHOJI_Z = LAYOUT.SHOJI_Z // -8.5 (土間/奥の間の境)
const SOUTH_Z = m.maxZ // -3 (通りに面した壁面)
const TSUBO_NORTH_Z = tb.minZ // -16 (坪庭奥の垣根)
const EAVE_Y = LAYOUT.EAVE_Y // 2.2
const OPEN_HALF = 1.2 // 通り側・障子側とも開口の半幅(x: CENTER_X±1.2)

// ---- 屋根(北で少し高く、通り側の軒先で EAVE_Y に落ちる片流れ+深い軒) -------
const ROOF_X0 = WEST_X - 0.3
const ROOF_X1 = EAST_X + 0.3
const ROOF_NORTH_Z = NORTH_Z - 0.4 // 奥の間北壁より少し張り出す
const ROOF_NORTH_Y = 2.5
const ROOF_SOUTH_Z = SOUTH_Z // 通り側の壁面で軒高ちょうどに合わせる
const ROOF_SOUTH_Y = EAVE_Y
const EAVE_TIP_Z = SOUTH_Z + 1.5 // 通りへ深く張り出す軒先
const ROOF_THICK = 0.08

function roofYAt(z: number): number {
  const t = (z - ROOF_NORTH_Z) / (ROOF_SOUTH_Z - ROOF_NORTH_Z)
  return ROOF_NORTH_Y + (ROOF_SOUTH_Y - ROOF_NORTH_Y) * t
}

export function buildMachiya(ctx: AppContext): Partial<WorldRefs> {
  const group = new THREE.Group()
  group.name = 'machiya'
  ctx.scene.add(group)

  const rng = mulberry32(4104)

  // ---- マテリアル --------------------------------------------------------
  const woodDark = pbrMaterial('wood_dark', { repeat: [1, 1], color: 0x4a3626, tint: 0x8a7460, roughness: 0.62 })
  const ceilingMat = pbrMaterial('wood_floor', { repeat: [6, 5], color: 0xa88a60, roughness: 0.6 })
  const tatami = pbrMaterial('tatami', { repeat: [3, 2], color: 0xc2b878, tint: 0xcfc493, roughness: 0.9 })
  const plaster = pbrMaterial('plaster', { repeat: [5, 1], color: 0xe9e2d0, roughness: 0.95 })
  plaster.side = THREE.DoubleSide
  // 三和土(たたき)は暗い土間色に(stoneテクスチャ素のままだと白大理石に見える)
  const stone = pbrMaterial('stone', { repeat: [2, 2], color: 0x8a8478, tint: 0x6e675c, roughness: 1 })
  const ground = pbrMaterial('ground', { repeat: [3, 2], color: 0x6a6248, tint: 0x8c8163, roughness: 1 })
  const roofMat = pbrMaterial('roof', { repeat: [4, 3], color: 0x3a3f42, roughness: 0.8 })
  roofMat.side = THREE.DoubleSide
  const washi = pbrMaterial('washi')
  const shrubMat = new THREE.MeshStandardMaterial({ color: 0x3f5a34, roughness: 1, vertexColors: true })
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xcfd6d8, roughness: 0.35, metalness: 0.7 })

  const teleportSurfaces: THREE.Object3D[] = []
  const shojiPanels: THREE.Object3D[] = []
  const noren: THREE.Object3D[] = []
  const windowLightTargets: THREE.Vector3[] = []
  const lampFixtures: Partial<WorldRefs['lampFixtures']> = {}

  // 静的ジオメトリの集積バケツ(素材ごと)
  const woodGeoms: THREE.BufferGeometry[] = []
  const plasterGeoms: THREE.BufferGeometry[] = []
  const washiGeoms: THREE.BufferGeometry[] = []
  const stoneGeoms: THREE.BufferGeometry[] = []
  // 畳マテリアルの静的ジオメトリ(床本体+座布団を1メッシュに統合してドローコールを節約)
  const tatamiGeoms: THREE.BufferGeometry[] = [
    place(new THREE.BoxGeometry(EAST_X - WEST_X, 0.1, SHOJI_Z - NORTH_Z), [CENTER_X, o.floorY - 0.05, (NORTH_Z + SHOJI_Z) / 2]),
  ]

  // ======================================================================
  // 床
  // ======================================================================

  // 畳の目地(艶消し濃紺の専用マテリアル。テクスチャ流用だと縁が光って見えるため別材)
  const mejiMat = new THREE.MeshStandardMaterial({ color: 0x2c3140, roughness: 0.95, metalness: 0 })
  const mejiGeoms: THREE.BufferGeometry[] = []
  for (const x of [WEST_X + 2, WEST_X + 4]) {
    mejiGeoms.push(place(new THREE.BoxGeometry(0.04, 0.01, SHOJI_Z - NORTH_Z), [x, o.floorY + 0.006, (NORTH_Z + SHOJI_Z) / 2]))
  }
  for (const z of [NORTH_Z + 1.5, NORTH_Z + 3]) {
    mejiGeoms.push(place(new THREE.BoxGeometry(EAST_X - WEST_X, 0.01, 0.04), [CENTER_X, o.floorY + 0.006, z]))
  }
  const meji = mergedMesh(mejiGeoms, mejiMat, { receiveShadow: true })
  meji.name = 'tatamiMeji'
  group.add(meji)

  const domaFloor = new THREE.Mesh(
    new THREE.BoxGeometry(EAST_X - WEST_X, 0.06, SOUTH_Z - SHOJI_Z),
    stone,
  )
  domaFloor.position.set(CENTER_X, m.floorY - 0.03, (SHOJI_Z + SOUTH_Z) / 2)
  domaFloor.userData.walkable = true
  domaFloor.receiveShadow = true
  domaFloor.name = 'domaFloor'
  group.add(domaFloor)
  teleportSurfaces.push(domaFloor)

  const tsuboGround = new THREE.Mesh(
    new THREE.BoxGeometry(EAST_X - WEST_X, 0.05, NORTH_Z - TSUBO_NORTH_Z),
    ground,
  )
  tsuboGround.position.set(CENTER_X, tb.groundY - 0.025, (TSUBO_NORTH_Z + NORTH_Z) / 2)
  tsuboGround.userData.walkable = true
  tsuboGround.receiveShadow = true
  tsuboGround.name = 'tsuboniwaGround'
  group.add(tsuboGround)
  teleportSurfaces.push(tsuboGround)

  // 上がり框(土間→奥の間、段差0.35m)。奥の間側の床端(SHOJI_Z)に立ち上がりの框板を張る。
  woodGeoms.push(
    place(new THREE.BoxGeometry(EAST_X - WEST_X, o.floorY, 0.07), [CENTER_X, o.floorY / 2, SHOJI_Z + 0.03]),
  )

  // ======================================================================
  // 壁(東西の側壁+北面+通り側の南面+坪庭の垣根)
  // ======================================================================
  // 東西の側壁(隣家と接する想定で窓なし。土間〜奥の間の区間をEAVE_Yまでフラットに)
  plasterGeoms.push(place(new THREE.BoxGeometry(WALL_T, EAVE_Y, SOUTH_Z - NORTH_Z), [WEST_X, EAVE_Y / 2, (NORTH_Z + SOUTH_Z) / 2]))
  plasterGeoms.push(place(new THREE.BoxGeometry(WALL_T, EAVE_Y, SOUTH_Z - NORTH_Z), [EAST_X, EAVE_Y / 2, (NORTH_Z + SOUTH_Z) / 2]))
  // 坪庭を囲む低い垣根(東西)
  const FENCE_H = 1.8
  plasterGeoms.push(place(new THREE.BoxGeometry(WALL_T, FENCE_H, NORTH_Z - TSUBO_NORTH_Z), [WEST_X, FENCE_H / 2, (TSUBO_NORTH_Z + NORTH_Z) / 2]))
  plasterGeoms.push(place(new THREE.BoxGeometry(WALL_T, FENCE_H, NORTH_Z - TSUBO_NORTH_Z), [EAST_X, FENCE_H / 2, (TSUBO_NORTH_Z + NORTH_Z) / 2]))
  // 坪庭奥の垣根(北端)
  plasterGeoms.push(place(new THREE.BoxGeometry(EAST_X - WEST_X, FENCE_H, WALL_T), [CENTER_X, FENCE_H / 2, TSUBO_NORTH_Z]))

  // 北面(奥の間⇔坪庭の境): 下半分は壁、上は明かり取りの固定格子窓(開閉不要)
  const NORTH_SILL_Y = 1.3
  const northTopY = roofYAt(NORTH_Z) // 屋根の勾配に合わせて壁頂を切る(隙間を作らない)
  plasterGeoms.push(place(new THREE.BoxGeometry(EAST_X - WEST_X, NORTH_SILL_Y, WALL_T), [CENTER_X, NORTH_SILL_Y / 2, NORTH_Z]))
  // 明かり取り窓: 障子紙(固定)+格子
  const windowW = EAST_X - WEST_X - 1.4
  washiGeoms.push(place(new THREE.PlaneGeometry(windowW, northTopY - NORTH_SILL_Y - 0.1), [CENTER_X, (NORTH_SILL_Y + northTopY - 0.1) / 2, NORTH_Z + WALL_T / 2 + 0.01]))
  for (let i = 0; i <= 4; i++) {
    const x = WEST_X + 0.7 + (windowW / 4) * i
    woodGeoms.push(place(new THREE.BoxGeometry(0.03, northTopY - NORTH_SILL_Y, 0.03), [x, (NORTH_SILL_Y + northTopY) / 2, NORTH_Z]))
  }
  woodGeoms.push(place(new THREE.BoxGeometry(windowW + 0.1, 0.04, 0.05), [CENTER_X, NORTH_SILL_Y, NORTH_Z]))
  woodGeoms.push(place(new THREE.BoxGeometry(windowW + 0.1, 0.04, 0.05), [CENTER_X, northTopY - 0.02, NORTH_Z]))
  windowLightTargets.push(new THREE.Vector3(CENTER_X, (NORTH_SILL_Y + northTopY) / 2, NORTH_Z))

  // 南面(通りへの開口。中央2.4mを開け、両脇は下=土壁+上=蔀格子)
  const SOUTH_SILL_Y = 0.9
  const openL0 = CENTER_X - OPEN_HALF
  const openL1 = CENTER_X + OPEN_HALF
  for (const [x0, x1] of [
    [WEST_X, openL0],
    [openL1, EAST_X],
  ] as const) {
    const w = x1 - x0
    const cx = (x0 + x1) / 2
    plasterGeoms.push(place(new THREE.BoxGeometry(w, SOUTH_SILL_Y, WALL_T), [cx, SOUTH_SILL_Y / 2, SOUTH_Z]))
    // 蔀格子(縦組子)
    const slats = Math.max(3, Math.round(w / 0.14))
    for (let i = 0; i < slats; i++) {
      const sx = x0 + (w / slats) * (i + 0.5)
      woodGeoms.push(place(new THREE.BoxGeometry(0.03, EAVE_Y - SOUTH_SILL_Y, 0.03), [sx, (SOUTH_SILL_Y + EAVE_Y) / 2, SOUTH_Z]))
    }
    woodGeoms.push(place(new THREE.BoxGeometry(w, 0.04, 0.05), [cx, SOUTH_SILL_Y, SOUTH_Z]))
    woodGeoms.push(place(new THREE.BoxGeometry(w, 0.04, 0.05), [cx, EAVE_Y - 0.02, SOUTH_Z]))
  }
  // 揚げ戸(店じまいの板戸)を1枚、東脇に立てかけて収納してある表現
  woodGeoms.push(
    place(new THREE.BoxGeometry(0.9, EAVE_Y - SOUTH_SILL_Y - 0.05, 0.04), [EAST_X - 0.2, (SOUTH_SILL_Y + EAVE_Y) / 2, SOUTH_Z + 0.12], [0.08, 0, 0]),
  )
  // 開口の鴨居(暖簾を吊る頭上の梁)
  woodGeoms.push(place(new THREE.BoxGeometry(openL1 - openL0 + 0.15, 0.08, 0.08), [CENTER_X, EAVE_Y - 0.06, SOUTH_Z]))
  windowLightTargets.push(new THREE.Vector3(CENTER_X, 1.1, SOUTH_Z))

  // 障子の両脇の袖壁(土間⇔奥の間は中央の開口だけを障子2枚で塞ぎ、両脇は土壁で仕切る)
  const flankH = EAVE_Y - o.floorY
  for (const [x0, x1] of [
    [WEST_X, openL0],
    [openL1, EAST_X],
  ] as const) {
    plasterGeoms.push(place(new THREE.BoxGeometry(x1 - x0, flankH, WALL_T), [(x0 + x1) / 2, o.floorY + flankH / 2, SHOJI_Z]))
  }

  // ---- 妻壁(東西の壁頂と屋根裏の隙間を三角に塞ぐ) --------------------------
  for (const gx of [WEST_X, EAST_X]) {
    const p1 = new THREE.Vector3(gx, EAVE_Y, NORTH_Z)
    const p2 = new THREE.Vector3(gx, roofYAt(NORTH_Z), NORTH_Z)
    const p3 = new THREE.Vector3(gx, roofYAt(SOUTH_Z), SOUTH_Z)
    const p4 = new THREE.Vector3(gx, EAVE_Y, SOUTH_Z)
    plasterGeoms.push(quadPrism(p1, p2, p3, p4, 0.08))
  }

  // ======================================================================
  // 構造材(柱・梁)
  // ======================================================================
  const pillar = (x: number, z: number, yTop: number) => {
    woodGeoms.push(place(new THREE.BoxGeometry(0.14, yTop, 0.14), [x, yTop / 2, z]))
  }
  const beam = (cx: number, cy: number, cz: number, w: number, dep: number) => {
    woodGeoms.push(place(new THREE.BoxGeometry(w, 0.13, dep), [cx, cy, cz]))
  }
  for (const x of [WEST_X, EAST_X]) {
    for (const z of [NORTH_Z, SHOJI_Z, SOUTH_Z]) pillar(x, z, EAVE_Y)
    for (const z of [TSUBO_NORTH_Z]) pillar(x, z, FENCE_H)
  }
  pillar(openL0, SOUTH_Z, EAVE_Y)
  pillar(openL1, SOUTH_Z, EAVE_Y)
  pillar(openL0, SHOJI_Z, EAVE_Y)
  pillar(openL1, SHOJI_Z, EAVE_Y)
  // 桁(壁頂を結ぶ梁)
  beam(WEST_X, EAVE_Y, (NORTH_Z + SOUTH_Z) / 2, 0.13, SOUTH_Z - NORTH_Z)
  beam(EAST_X, EAVE_Y, (NORTH_Z + SOUTH_Z) / 2, 0.13, SOUTH_Z - NORTH_Z)
  beam(CENTER_X, northTopY, NORTH_Z, EAST_X - WEST_X, 0.13)

  // ======================================================================
  // 屋根(片流れ+通り側の深い軒+妻壁は上で処理済み)
  // ======================================================================
  const roofGeoms: THREE.BufferGeometry[] = []
  const nw = new THREE.Vector3(ROOF_X0, ROOF_NORTH_Y, ROOF_NORTH_Z)
  const sw = new THREE.Vector3(ROOF_X0, ROOF_SOUTH_Y, ROOF_SOUTH_Z)
  const se = new THREE.Vector3(ROOF_X1, ROOF_SOUTH_Y, ROOF_SOUTH_Z)
  const ne = new THREE.Vector3(ROOF_X1, ROOF_NORTH_Y, ROOF_NORTH_Z)
  roofGeoms.push(quadPrism(nw, sw, se, ne, ROOF_THICK, [5, 6]))
  // 店先の上の低い軒(EAVE_Y一定で通りへ深く張り出す)
  const enw = new THREE.Vector3(ROOF_X0, EAVE_Y, SOUTH_Z)
  const esw = new THREE.Vector3(ROOF_X0, EAVE_Y, EAVE_TIP_Z)
  const ese = new THREE.Vector3(ROOF_X1, EAVE_Y, EAVE_TIP_Z)
  const ene = new THREE.Vector3(ROOF_X1, EAVE_Y, SOUTH_Z)
  roofGeoms.push(quadPrism(enw, esw, ese, ene, 0.06, [4, 1]))
  const roof = mergedMesh(roofGeoms, roofMat, { castShadow: true, receiveShadow: true })
  roof.name = 'roof'
  group.add(roof)

  // 板天井(屋根裏を隠す)。奥の間は畳から約2mの頭上余裕を確保するため
  // 屋根勾配(この区間では常に2.36以上)の直下 2.33m に張り、土間側は軒なりの 2.18m に張る。
  const okunomaCeil = new THREE.Mesh(
    new THREE.BoxGeometry(EAST_X - WEST_X, 0.05, SHOJI_Z - NORTH_Z),
    ceilingMat,
  )
  okunomaCeil.position.set(CENTER_X, 2.33, (NORTH_Z + SHOJI_Z) / 2)
  okunomaCeil.name = 'okunomaCeiling'
  group.add(okunomaCeil)

  const miseCeil = new THREE.Mesh(
    new THREE.BoxGeometry(EAST_X - WEST_X, 0.05, SOUTH_Z - SHOJI_Z),
    ceilingMat,
  )
  miseCeil.position.set(CENTER_X, 2.18, (SHOJI_Z + SOUTH_Z) / 2)
  miseCeil.name = 'miseCeiling'
  group.add(miseCeil)

  // 障子境界上部の欄間ふさぎ(天井高の差 2.18〜2.36 を埋める横木)
  woodGeoms.push(
    place(new THREE.BoxGeometry(EAST_X - WEST_X, 0.24, 0.1), [CENTER_X, 2.24, SHOJI_Z]),
  )

  // ======================================================================
  // 障子2枚(土間⇔奥の間、SHOJI_Z)
  // ======================================================================
  const panelW = 1.2
  const panelH = o.ceilingY - o.floorY - 0.15
  const buildPanel = (closedX: number, openX: number, z: number, name: string): THREE.Object3D => {
    const panel = new THREE.Group()
    panel.position.set(closedX, o.floorY, z)
    const frameGeoms: THREE.BufferGeometry[] = []
    const barT = 0.05
    frameGeoms.push(place(new THREE.BoxGeometry(panelW, barT, barT), [0, 0, 0]))
    frameGeoms.push(place(new THREE.BoxGeometry(panelW, barT, barT), [0, panelH, 0]))
    frameGeoms.push(place(new THREE.BoxGeometry(barT, panelH, barT), [-panelW / 2, panelH / 2, 0]))
    frameGeoms.push(place(new THREE.BoxGeometry(barT, panelH, barT), [panelW / 2, panelH / 2, 0]))
    for (const fy of [panelH * 0.35, panelH * 0.68]) {
      frameGeoms.push(place(new THREE.BoxGeometry(panelW - barT, 0.025, 0.025), [0, fy, 0]))
    }
    frameGeoms.push(place(new THREE.BoxGeometry(0.025, panelH - barT, 0.025), [0, panelH / 2, 0]))
    const frame = mergedMesh(frameGeoms, woodDark, { castShadow: false, receiveShadow: false })
    panel.add(frame)

    const paper = new THREE.Mesh(new THREE.PlaneGeometry(panelW - barT * 1.4, panelH - barT * 1.4), washi)
    paper.position.set(0, panelH / 2, 0)
    panel.add(paper)

    panel.userData.slide = { axis: 'x', closed: closedX, open: openX }
    panel.name = name
    return panel
  }
  const panelA = buildPanel(CENTER_X - 0.6, CENTER_X + 0.6, SHOJI_Z - 0.02, 'shojiPanelA')
  const panelB = buildPanel(CENTER_X + 0.6, CENTER_X + 1.8, SHOJI_Z + 0.02, 'shojiPanelB')
  group.add(panelA, panelB)
  shojiPanels.push(panelA, panelB)

  // ======================================================================
  // 店先(土間)の造作: 帳場格子・棚と商品籠
  // ======================================================================
  // 帳場格子(東寄り、低い格子の間仕切り)
  const CG_X = EAST_X - 0.9
  const CG_Z0 = SHOJI_Z + 0.6
  const CG_Z1 = SHOJI_Z + 2.1
  woodGeoms.push(place(new THREE.BoxGeometry(0.06, 0.85, CG_Z1 - CG_Z0), [CG_X, 0.425, (CG_Z0 + CG_Z1) / 2]))
  for (let i = 0; i <= 5; i++) {
    const z = CG_Z0 + ((CG_Z1 - CG_Z0) / 5) * i
    woodGeoms.push(place(new THREE.BoxGeometry(0.03, 0.85, 0.03), [CG_X, 0.425, z]))
  }
  // 棚(西寄り)+商品籠
  const shelfX = WEST_X + 0.25
  const shelfZ0 = SHOJI_Z + 0.5
  const shelfZ1 = SHOJI_Z + 2.0
  woodGeoms.push(place(new THREE.BoxGeometry(0.28, 1.1, shelfZ1 - shelfZ0), [shelfX, 0.55, (shelfZ0 + shelfZ1) / 2]))
  for (const by of [0.35, 0.75, 1.1]) {
    woodGeoms.push(place(new THREE.BoxGeometry(0.3, 0.03, shelfZ1 - shelfZ0), [shelfX, by, (shelfZ0 + shelfZ1) / 2]))
  }
  for (const [kx, kz] of [
    [shelfX + 0.02, shelfZ0 + 0.35],
    [shelfX - 0.02, shelfZ0 + 0.9],
    [shelfX + 0.03, shelfZ0 + 1.35],
  ] as const) {
    woodGeoms.push(place(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 10), [kx, 0.78, kz]))
  }
  // 上がり口の沓脱石(通りからの入口)
  stoneGeoms.push(place(new THREE.CylinderGeometry(0.22, 0.26, 0.06, 8), [CENTER_X, 0.03, SOUTH_Z - 0.35]))

  // ======================================================================
  // 暖簾(通りの開口、頭上の鴨居から吊るす。頂点アニメ用に4分割以上)
  // ======================================================================
  const norenMat = new THREE.MeshStandardMaterial({
    color: 0x24405e, // 藍染
    roughness: 0.85,
    side: THREE.DoubleSide,
  })
  const norenMat2 = norenMat.clone()
  const norenTopY = EAVE_Y - 0.12
  const norenH = 0.8
  const norenPanelW = (openL1 - openL0) / 2 - 0.03
  const makeNoren = (cx: number, mat: THREE.Material, name: string): THREE.Object3D => {
    const geo = new THREE.PlaneGeometry(norenPanelW, norenH, 6, 8)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(cx, norenTopY - norenH / 2, SOUTH_Z + WALL_T / 2 + 0.03)
    mesh.name = name
    mesh.castShadow = false
    mesh.receiveShadow = false
    return mesh
  }
  const noren1 = makeNoren(openL0 + norenPanelW / 2 + 0.015, norenMat, 'norenLeft')
  const noren2 = makeNoren(openL1 - norenPanelW / 2 - 0.015, norenMat2, 'norenRight')
  group.add(noren1, noren2)
  noren.push(noren1, noren2)

  // ======================================================================
  // 奥の間の家具: 文机・ラジオ・デスクランプ・行灯・掛け軸・座布団・文庫棚
  // ======================================================================
  const deskCenter = new THREE.Vector3(EAST_X - 1.1, o.floorY, NORTH_Z + 1.4)
  const deskH = 0.32
  {
    const deskGeoms: THREE.BufferGeometry[] = []
    deskGeoms.push(place(new THREE.BoxGeometry(1.05, 0.04, 0.5), [0, deskH - 0.02, 0]))
    const legOffsets: [number, number][] = [
      [0.45, 0.2],
      [-0.45, 0.2],
      [0.45, -0.2],
      [-0.45, -0.2],
    ]
    for (const [lx, lz] of legOffsets) {
      deskGeoms.push(place(new THREE.BoxGeometry(0.05, deskH - 0.04, 0.05), [lx, (deskH - 0.04) / 2, lz]))
    }
    for (const g of deskGeoms) woodGeoms.push(place(g, [deskCenter.x, deskCenter.y, deskCenter.z]))
  }
  const deskTopY = deskCenter.y + deskH

  // ラジオ(クリック対象。独立オブジェクト)
  const radio = new THREE.Group()
  radio.name = 'radio'
  radio.position.set(deskCenter.x - 0.32, deskTopY, deskCenter.z - 0.1)
  {
    const radioGeoms: THREE.BufferGeometry[] = []
    radioGeoms.push(place(new THREE.BoxGeometry(0.2, 0.12, 0.14), [0, 0.06, 0]))
    radioGeoms.push(place(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 12), [0.065, 0.09, 0.071]))
    for (let i = 0; i < 5; i++) {
      radioGeoms.push(place(new THREE.BoxGeometry(0.001, 0.07, 0.001), [-0.07 + i * 0.014, 0.06, 0.071]))
    }
    const radioBody = mergedMesh(radioGeoms, woodDark, { castShadow: false, receiveShadow: false })
    radio.add(radioBody)
  }
  group.add(radio)

  // デスクランプ(発光メッシュは専用マテリアルインスタンス)
  const deskLamp = new THREE.Group()
  deskLamp.name = 'deskLamp'
  deskLamp.position.set(deskCenter.x + 0.38, deskTopY, deskCenter.z - 0.14)
  {
    const armGeoms: THREE.BufferGeometry[] = []
    armGeoms.push(place(new THREE.CylinderGeometry(0.05, 0.06, 0.02, 10), [0, 0.01, 0]))
    armGeoms.push(place(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 6), [0, 0.12, 0]))
    armGeoms.push(place(new THREE.CylinderGeometry(0.011, 0.011, 0.13, 6), [0.055, 0.22, 0], [0, 0, Math.PI / 3]))
    for (const g of armGeoms) woodGeoms.push(place(g, [deskLamp.position.x, deskLamp.position.y, deskLamp.position.z]))
  }
  const deskLampShade = new THREE.Mesh(
    new THREE.ConeGeometry(0.065, 0.09, 12, 1, true),
    pbrMaterial('washi', { color: 0xf2e9d2 }),
  )
  deskLampShade.position.set(0.1, 0.3, 0)
  deskLampShade.rotation.x = Math.PI
  deskLampShade.name = 'deskLampGlow'
  ;(deskLampShade.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xfff0c0)
  ;(deskLampShade.material as THREE.MeshStandardMaterial).emissiveIntensity = 0
  const deskLampLight = new THREE.PointLight(0xffe6b0, 0, 2.4, 2)
  deskLampLight.name = 'deskLampLight'
  deskLampLight.position.set(0.1, 0.26, 0)
  deskLamp.add(deskLampShade, deskLampLight)
  group.add(deskLamp)
  lampFixtures.deskLamp = deskLamp

  // 行灯(床置き)
  const andon = new THREE.Group()
  andon.name = 'andon'
  andon.position.set(WEST_X + 0.9, o.floorY, NORTH_Z + 2.6)
  {
    const baseGeoms: THREE.BufferGeometry[] = []
    baseGeoms.push(place(new THREE.BoxGeometry(0.32, 0.06, 0.32), [0, 0.03, 0]))
    const postOffsets: [number, number][] = [
      [0.14, 0.14],
      [-0.14, 0.14],
      [0.14, -0.14],
      [-0.14, -0.14],
    ]
    for (const [px, pz] of postOffsets) {
      baseGeoms.push(place(new THREE.BoxGeometry(0.025, 0.48, 0.025), [px, 0.06 + 0.24, pz]))
    }
    baseGeoms.push(place(new THREE.BoxGeometry(0.32, 0.02, 0.32), [0, 0.54, 0]))
    for (const g of baseGeoms) woodGeoms.push(place(g, [andon.position.x, andon.position.y, andon.position.z]))
  }
  const andonShade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.42, 0.28), pbrMaterial('washi', { color: 0xf2e9d2 }))
  andonShade.position.y = 0.06 + 0.21
  andonShade.name = 'andonGlow'
  ;(andonShade.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xffdca0)
  ;(andonShade.material as THREE.MeshStandardMaterial).emissiveIntensity = 0
  const andonLight = new THREE.PointLight(0xffcf8a, 0, 3.8, 2)
  andonLight.name = 'andonLight'
  andonLight.position.y = 0.28
  andon.add(andonShade, andonLight)
  group.add(andon)
  lampFixtures.andon = andon

  // 掛け軸(西壁。壁厚+2cm以上手前に浮かせる)
  const kakejikuCenter = new THREE.Vector3(WEST_X + WALL_T / 2 + 0.04, 1.55, NORTH_Z + 2.3)
  const kakejiku = new THREE.Group()
  kakejiku.name = 'kakejiku'
  kakejiku.position.copy(kakejikuCenter)
  kakejiku.rotation.y = Math.PI / 2 // 西壁の内側(+X)を向く
  kakejiku.userData.faceNormal = new THREE.Vector3(1, 0, 0)
  group.add(kakejiku)
  {
    const scrollW = 0.5
    const scrollH = 1.2
    const rodGeom = new THREE.CylinderGeometry(0.018, 0.018, scrollW + 0.08, 8)
    const rodTop = place(rodGeom, [0, scrollH / 2 + 0.02, 0], [0, 0, Math.PI / 2])
    const rodBottom = place(rodGeom, [0, -scrollH / 2 - 0.02, 0], [0, 0, Math.PI / 2])
    for (const g of [rodTop, rodBottom]) {
      woodGeoms.push(place(g, [kakejikuCenter.x, kakejikuCenter.y, kakejikuCenter.z], [Math.PI / 2, 0, 0]))
    }
    washiGeoms.push(
      place(new THREE.PlaneGeometry(scrollW, scrollH), [kakejikuCenter.x + 0.01, kakejikuCenter.y, kakejikuCenter.z], [Math.PI / 2, 0, 0]),
    )
  }

  // 座布団x2(畳マテリアル、床材メッシュに統合)
  const cushionCenter = new THREE.Vector3(deskCenter.x - 0.05, o.floorY, deskCenter.z + 0.5)
  tatamiGeoms.push(place(new THREE.CylinderGeometry(0.26, 0.28, 0.06, 8), [cushionCenter.x, o.floorY + 0.03, cushionCenter.z], [0.3, 0, 0]))
  tatamiGeoms.push(place(new THREE.CylinderGeometry(0.26, 0.28, 0.06, 8), [cushionCenter.x - 0.55, o.floorY + 0.03, cushionCenter.z + 0.35], [-0.4, 0, 0]))

  // 文庫棚(小さめ、東壁沿い北寄り)+本(インスタンス)
  const shelfBaseX = EAST_X - 0.02
  const shelfZ0b = NORTH_Z + 0.3
  const shelfZ1b = NORTH_Z + 1.5
  const shelfTopY = 1.0
  const shelfDepth = 0.24
  {
    const bkGeoms: THREE.BufferGeometry[] = []
    bkGeoms.push(place(new THREE.BoxGeometry(0.03, shelfTopY - o.floorY, shelfZ1b - shelfZ0b), [shelfBaseX, o.floorY + (shelfTopY - o.floorY) / 2, (shelfZ0b + shelfZ1b) / 2]))
    const boardYs = [o.floorY, o.floorY + 0.45, shelfTopY]
    for (const by of boardYs) {
      bkGeoms.push(place(new THREE.BoxGeometry(shelfDepth, 0.02, shelfZ1b - shelfZ0b), [shelfBaseX - shelfDepth / 2, by, (shelfZ0b + shelfZ1b) / 2]))
    }
    for (const g of bkGeoms) woodGeoms.push(g)
  }
  const bookPalette = [0x6b2a2a, 0x2a3a52, 0x2f4a34, 0x8a6a2a, 0x3a2a20].map((c) => new THREE.Color(c))
  const bookRows = [o.floorY + 0.02, o.floorY + 0.47]
  const booksPerRow = 14
  const bookGeo = new THREE.BoxGeometry(1, 1, 1)
  const bookMat = new THREE.MeshStandardMaterial({ roughness: 0.85 })
  const books = new THREE.InstancedMesh(bookGeo, bookMat, bookRows.length * booksPerRow)
  books.name = 'bunkoBooks'
  books.castShadow = false
  books.receiveShadow = true
  const dummy = new THREE.Object3D()
  let bi = 0
  const usableD = shelfZ1b - shelfZ0b - 0.08
  for (const rowY of bookRows) {
    const bh = 0.24 + rng() * 0.03
    for (let i = 0; i < booksPerRow; i++) {
      const bw = 0.02 + rng() * 0.012
      const bd = 0.17
      const z = shelfZ0b + 0.04 + (usableD / booksPerRow) * (i + 0.5)
      dummy.position.set(shelfBaseX - shelfDepth / 2, rowY + bh / 2, z)
      dummy.rotation.set(0, (rng() - 0.5) * 0.06, 0)
      dummy.scale.set(bd, bh, bw)
      dummy.updateMatrix()
      books.setMatrixAt(bi, dummy.matrix)
      books.setColorAt(bi, bookPalette[Math.floor(rng() * bookPalette.length)])
      bi++
    }
  }
  books.instanceMatrix.needsUpdate = true
  if (books.instanceColor) books.instanceColor.needsUpdate = true
  group.add(books)

  // ======================================================================
  // 坪庭: 飛び石・庭石・手水鉢・低木+軒先の風鈴
  // ======================================================================
  const stepStones: [number, number][] = [
    [CENTER_X - 0.3, NORTH_Z - 0.9],
    [CENTER_X + 0.5, NORTH_Z - 1.7],
    [CENTER_X - 0.2, NORTH_Z - 2.5],
  ]
  for (const [sx, sz] of stepStones) {
    stoneGeoms.push(place(new THREE.CylinderGeometry(0.16 + rng() * 0.04, 0.18 + rng() * 0.04, 0.05, 7), [sx, tb.groundY + 0.025, sz]))
  }
  // 庭石(いびつな塊)
  stoneGeoms.push(place(new THREE.DodecahedronGeometry(0.22, 0), [WEST_X + 0.7, tb.groundY + 0.12, TSUBO_NORTH_Z + 0.7], [0.4, 0.2, 0]))
  // 手水鉢
  stoneGeoms.push(place(new THREE.CylinderGeometry(0.19, 0.22, 0.28, 10), [EAST_X - 0.7, tb.groundY + 0.14, TSUBO_NORTH_Z + 1.1]))
  stoneGeoms.push(place(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 10), [EAST_X - 0.7, tb.groundY + 0.29, TSUBO_NORTH_Z + 1.1]))
  // 低木
  const shrubGeoms: THREE.BufferGeometry[] = []
  const shrubCenter = new THREE.Vector3(WEST_X + 0.6, tb.groundY + 0.22, NORTH_Z - 0.5)
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Color(0x3f5a34).offsetHSL(0, 0, (rng() - 0.5) * 0.08)
    shrubGeoms.push(
      place(leafBlob(0.22 + rng() * 0.08, 1, 0.25, c, rng), [
        shrubCenter.x + (rng() - 0.5) * 0.2,
        shrubCenter.y + (rng() - 0.5) * 0.1,
        shrubCenter.z + (rng() - 0.5) * 0.2,
      ]),
    )
  }
  const shrub = mergedMesh(shrubGeoms, shrubMat, { castShadow: false, receiveShadow: true })
  shrub.name = 'tsuboniwaShrub'
  group.add(shrub)

  // 風鈴(軒先、坪庭を見下ろす位置)
  const windChime = new THREE.Group()
  windChime.name = 'windChime'
  const wcTopY = roofYAt(NORTH_Z + 0.3) - 0.06
  windChime.position.set(CENTER_X + 1.5, wcTopY, NORTH_Z + 0.3)
  {
    const wcGeoms: THREE.BufferGeometry[] = []
    wcGeoms.push(place(new THREE.CylinderGeometry(0.004, 0.004, 0.32, 5), [0, -0.16, 0]))
    wcGeoms.push(place(new THREE.SphereGeometry(0.05, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), [0, -0.34, 0]))
    wcGeoms.push(place(new THREE.CylinderGeometry(0.003, 0.003, 0.11, 4), [0, -0.4, 0]))
    wcGeoms.push(place(new THREE.SphereGeometry(0.011, 6, 6), [0, -0.46, 0]))
    const wcMesh = mergedMesh(wcGeoms, metalMat, { castShadow: false, receiveShadow: false })
    windChime.add(wcMesh)
  }
  const tanzaku = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.15), pbrMaterial('washi', { color: 0xf0e6cc }))
  tanzaku.name = 'windChimeTanzaku'
  tanzaku.position.y = -0.53
  windChime.add(tanzaku)
  group.add(windChime)

  // ======================================================================
  // 静的ジオメトリの統合
  // ======================================================================
  const structure = mergedMesh(woodGeoms, woodDark, { castShadow: true, receiveShadow: true })
  structure.name = 'structure'
  group.add(structure)

  const walls = mergedMesh(plasterGeoms, plaster, { castShadow: false, receiveShadow: true })
  walls.name = 'walls'
  group.add(walls)

  const fixedWashi = mergedMesh(washiGeoms, washi, { castShadow: false, receiveShadow: false })
  fixedWashi.name = 'fixedWashiPanels'
  group.add(fixedWashi)

  const stoneDecor = mergedMesh(stoneGeoms, stone, { castShadow: false, receiveShadow: true })
  stoneDecor.name = 'stoneDecor'
  group.add(stoneDecor)

  // 畳(床本体+座布団を統合した1メッシュ)。床全体を歩行/テレポート対象として登録する。
  const okunomaFloor = mergedMesh(tatamiGeoms, tatami, { castShadow: false, receiveShadow: true })
  okunomaFloor.name = 'okunomaFloor'
  okunomaFloor.userData.walkable = true
  group.add(okunomaFloor)
  teleportSurfaces.push(okunomaFloor)

  return {
    teleportSurfaces,
    shojiPanels,
    lampFixtures: lampFixtures as WorldRefs['lampFixtures'],
    radio,
    kakejiku,
    windChime,
    noren,
    windowLightTargets,
  }
}
