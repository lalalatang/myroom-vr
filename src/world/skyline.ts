import * as THREE from 'three'
import type { AppContext, WorldRefs } from '../core/types'
import { place, mergedMesh, mulberry32, leafBlob } from './geo'
import { pbrMaterial } from './materials'

/**
 * 遠景(浮遊感の根絶が目的)。
 * - 視界の果てまで続く大地(半径160mの円盤、歩行不可)
 * - 半径42〜96mの町並みシルエット(瓦屋根の家々+火の見櫓+蔵+木々+竈の煙)。
 *   同心円ではなく東西・南北のグリッド風に並べ、屋根の稜線方向を通り筋ごとに揃える。
 * - 通り(z∈[-3,3])の東西延長線上は建物を置かず、道が奥まで続いて見える抜けを作る。
 * - 東(x 40〜70)に神社の丘(杜+石段+社殿)。通りの東端から見た「通りの先に神社」の構図。
 * - 北西に寺の大屋根(入母屋風シルエット)。鐘の音源位置を templeBellPos として返す。
 * - さらに外周の山並み。
 * 色はフォグ(lighting管理)に沈む前提で彩度低め。近景の商家はstreet.tsが担当。
 */
export function buildSkyline(ctx: AppContext): Partial<WorldRefs> {
  const group = new THREE.Group()
  group.name = 'skyline'
  ctx.scene.add(group)

  const rng = mulberry32(1857)

  // ---- 町の外形(半径帯)と、抜け・除外ゾーンの定義 ----
  const TOWN_R_MIN = 42
  const TOWN_R_MAX = 96
  // 神社の丘(通り東端の先)
  const HILL_X = 54
  const HILL_Z = 0
  const HILL_R = 19
  const HILL_H = 13
  // 寺(北西)
  const TEMPLE_X = -48
  const TEMPLE_Z = -62

  /** 汎用の建物・小物を置いてよいか(町並みシルエット用の除外判定)。 */
  const inExclusion = (x: number, z: number): boolean => {
    const r = Math.hypot(x, z)
    if (r < TOWN_R_MIN || r > TOWN_R_MAX) return true
    // 通りの東西延長線上は開けたままにする(道が奥まで続いて見える抜け)
    if (Math.abs(z) < 7 && (x > 27 || x < -27)) return true
    // 神社の丘のための予約域
    if (x > 34 && Math.abs(z) < HILL_R + 6) return true
    // 寺の周囲
    if (Math.hypot(x - TEMPLE_X, z - TEMPLE_Z) < 13) return true
    return false
  }

  // ---- 大地(視界の果てまで。通り側の土色路面と馴染む彩度に) ----
  const earth = new THREE.Mesh(
    new THREE.CircleGeometry(160, 48),
    pbrMaterial('ground', { repeat: [60, 60], color: 0x7c6c53, tint: 0x8f7c5e }),
  )
  earth.rotation.x = -Math.PI / 2
  earth.position.y = -0.12 // 通り・敷地の面より僅かに下(z-fight回避)
  earth.receiveShadow = false
  earth.name = 'earth'
  group.add(earth)

  // ---- 町並みシルエット(壁+屋根を1メッシュずつに統合) ----
  const wallGeoms: THREE.BufferGeometry[] = []
  const roofGeoms: THREE.BufferGeometry[] = []

  /**
   * 寄棟風の家: 壁ボックス(+任意で厨子二階の上箱)+ピラミッド屋根。
   * baseY を渡すと丘の上などの高台に建てられる(社殿用)。
   */
  const addHouse = (
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    rotY: number,
    opts: { twoStory?: boolean; baseY?: number } = {},
  ) => {
    const baseY = opts.baseY ?? 0
    wallGeoms.push(place(new THREE.BoxGeometry(w, h, d), [x, baseY + h / 2, z], [0, rotY, 0]))
    let topY = baseY + h
    if (opts.twoStory) {
      // 厨子二階: 一回り小さい上箱
      const uw = w * 0.8
      const ud = d * 0.8
      const uh = h * 0.6
      wallGeoms.push(place(new THREE.BoxGeometry(uw, uh, ud), [x, topY + uh / 2, z], [0, rotY, 0]))
      topY += uh
    }
    const totalH = topY - baseY
    const roofH = totalH * 0.4
    // ConeGeometry(4分割)= ピラミッド。45°回して辺を壁と平行にし、間口・奥行きに合わせて非等方スケール
    const pyr = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1)
    pyr.rotateY(Math.PI / 4)
    pyr.scale(w * 1.18, roofH, d * 1.18)
    roofGeoms.push(place(pyr, [x, topY + roofH / 2 - 0.02, z], [0, rotY, 0]))
  }

  // 町並み本体: 同心円ではなく東西・南北のグリッドに沿って配置。
  // 同じ行(z方向のグリッド線)の家は同じ向きに揃え、隣の行と直交させることで
  // 街区(通り筋)を感じさせる。密度は内側ほど高い。
  const GRID_STEP = 8.5
  let houseBudget = 130
  for (let gx = -95; gx <= 95; gx += GRID_STEP) {
    for (let gz = -95; gz <= 95; gz += GRID_STEP) {
      if (houseBudget <= 0) continue
      if (inExclusion(gx, gz)) continue
      const r = Math.hypot(gx, gz)
      const density = r < 65 ? 0.82 : 0.52
      if (rng() > density) continue
      houseBudget--

      const x = gx + (rng() - 0.5) * GRID_STEP * 0.55
      const z = gz + (rng() - 0.5) * GRID_STEP * 0.55
      const rowIndex = Math.round(gz / GRID_STEP)
      const baseRot = rowIndex % 2 === 0 ? 0 : Math.PI / 2
      const rotY = baseRot + (rng() - 0.5) * 0.24

      const w = 4.5 + rng() * 4.5
      const d = w * (0.55 + rng() * 0.5)
      const h = 2.4 + rng() * 1.6
      const twoStory = rng() < 0.32
      addHouse(x, z, w, d, h, rotY, { twoStory })
    }
  }

  // 蔵(白壁・箱形)を数棟、町並みの隙間に散らす
  const kuraGeoms: THREE.BufferGeometry[] = []
  {
    let placed = 0
    let guard = 0
    while (placed < 9 && guard++ < 300) {
      const a = rng() * Math.PI * 2
      const r = 46 + rng() * 42
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (inExclusion(x, z)) continue
      kuraGeoms.push(place(new THREE.BoxGeometry(5, 4.5, 7), [x, 2.25, z], [0, -a, 0]))
      placed++
    }
  }

  // 火の見櫓(1基、北東の方角に目立たせる)
  const yaguraGeoms: THREE.BufferGeometry[] = []
  {
    const yx = 38
    const yz = -34
    const H = 11
    for (const [ox, oz] of [
      [-1.1, -1.1],
      [1.1, -1.1],
      [-1.1, 1.1],
      [1.1, 1.1],
    ] as const) {
      // 脚(上すぼまり)
      const leg = new THREE.CylinderGeometry(0.12, 0.2, H, 5)
      leg.translate(0, H / 2, 0)
      yaguraGeoms.push(place(leg, [yx + ox * 0.75, 0, yz + oz * 0.75], [ox * 0.06, 0, -oz * 0.06]))
    }
    // 見張り台+小屋根
    yaguraGeoms.push(place(new THREE.BoxGeometry(2.6, 0.18, 2.6), [yx, H - 1.4, yz]))
    const cap = new THREE.ConeGeometry(2.1, 1.2, 4)
    yaguraGeoms.push(place(cap, [yx, H + 0.4, yz], [0, Math.PI / 4, 0]))
    // 半鐘
    yaguraGeoms.push(place(new THREE.CylinderGeometry(0.22, 0.26, 0.4, 8), [yx, H - 0.6, yz]))
  }

  // ---- 神社の丘(東の突き当たり): 杜+石段+鳥居風の門+社殿 ----
  const hillGeoms: THREE.BufferGeometry[] = []
  {
    // 丘本体(半球ドームを上下に潰した低ポリの土饅頭)
    const dome = new THREE.SphereGeometry(HILL_R, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
    dome.scale(1, HILL_H / HILL_R, 1)
    hillGeoms.push(place(dome, [HILL_X, 0, HILL_Z]))

    // 石段: 西側(通り側)から丘を登る帯
    const stepsN = 12
    for (let i = 0; i < stepsN; i++) {
      const t = i / (stepsN - 1)
      const sx = HILL_X - 17 + t * 14
      const sy = t * HILL_H * 0.62
      const sz = HILL_Z + Math.sin(t * 2.2) * 1.1
      hillGeoms.push(place(new THREE.BoxGeometry(2.6, 0.32, 1.3), [sx, sy, sz], [0, -0.12, 0]))
    }

    // 鳥居風の門(石段のふもと。近距離の鳥居はstreet.ts担当のため x<38には置かない)
    const gx = HILL_X - 18
    const gz = HILL_Z
    wallGeoms.push(place(new THREE.CylinderGeometry(0.22, 0.22, 3.2, 6), [gx - 1.3, 1.6, gz]))
    wallGeoms.push(place(new THREE.CylinderGeometry(0.22, 0.22, 3.2, 6), [gx + 1.3, 1.6, gz]))
    roofGeoms.push(place(new THREE.BoxGeometry(3.6, 0.3, 0.5), [gx, 3.25, gz]))

    // 社殿(丘の頂に小さく)
    addHouse(HILL_X, HILL_Z, 6, 5.5, 3, 0.08, { baseY: HILL_H - 1.4 })
  }

  // ---- 寺(北西): 入母屋風の大屋根シルエット(壁+屋根は既存メッシュに統合) ----
  {
    wallGeoms.push(place(new THREE.BoxGeometry(11, 4.4, 14), [TEMPLE_X, 2.2, TEMPLE_Z]))
    const templeHip = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1)
    templeHip.rotateY(Math.PI / 4)
    templeHip.scale(11 * 1.3, 3.4, 14 * 1.3)
    roofGeoms.push(place(templeHip, [TEMPLE_X, 4.4 + 3.4 / 2 - 0.05, TEMPLE_Z]))
    // 入母屋の破風(棟に沿う小さな切妻の張り出し)
    roofGeoms.push(place(new THREE.BoxGeometry(3.4, 1.1, 9), [TEMPLE_X, 4.4 + 3.4 - 0.3, TEMPLE_Z]))
  }
  const templeBellPos = new THREE.Vector3(TEMPLE_X + 7, 3.2, TEMPLE_Z + 9)

  // ---- 木々(遠景用の低ポリ樹木: 幹+葉クラスタ、1本50ポリ以下) ----
  const trunkGeoms: THREE.BufferGeometry[] = []
  const leafGeoms: THREE.BufferGeometry[] = []
  const addTree = (x: number, z: number) => {
    const trunkH = 2 + rng() * 2.2
    const trunk = new THREE.CylinderGeometry(0.12, 0.18, trunkH, 5, 1, true)
    trunkGeoms.push(place(trunk, [x, trunkH / 2, z]))
    const leafCount = rng() < 0.55 ? 1 : 2
    const hue = 0.27 + rng() * 0.06
    const sat = 0.25 + rng() * 0.12
    const lig = 0.26 + rng() * 0.12
    for (let i = 0; i < leafCount; i++) {
      const r0 = 1.0 + rng() * 0.8
      const oy = trunkH + r0 * (0.55 + i * 0.4)
      const ox = i === 0 ? 0 : (rng() - 0.5) * 0.7
      const oz = i === 0 ? 0 : (rng() - 0.5) * 0.7
      const color = new THREE.Color().setHSL(hue, sat, lig)
      leafGeoms.push(place(leafBlob(r0, 0, 0.28, color, rng), [x + ox, oy, z + oz]))
    }
  }

  // 町並みの間に散らす木々
  {
    let placed = 0
    let guard = 0
    while (placed < 28 && guard++ < 500) {
      const a = rng() * Math.PI * 2
      const r = 40 + rng() * 58
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (inExclusion(x, z)) continue
      addTree(x, z)
      placed++
    }
  }
  // 神社の杜(丘を取り囲む木々のクラスタ)
  {
    let placed = 0
    let guard = 0
    while (placed < 28 && guard++ < 500) {
      const a = rng() * Math.PI * 2
      const r = 4 + rng() * (HILL_R + 7)
      const tx = HILL_X + Math.cos(a) * r
      const tz = HILL_Z + Math.sin(a) * r
      // 西側の石段の通り道は空けておく
      if (Math.abs(tz) < 3 && tx < HILL_X - 3) {
        guard--
        continue
      }
      addTree(tx, tz)
      placed++
    }
  }

  // ---- 竈の煙(数カ所。静的、揺らぎ不要) ----
  const smokeGeoms: THREE.BufferGeometry[] = []
  {
    for (let i = 0; i < 3; i++) {
      let sx = 0
      let sz = 0
      let tries = 0
      do {
        const a = rng() * Math.PI * 2
        const r = 46 + rng() * 40
        sx = Math.cos(a) * r
        sz = Math.sin(a) * r
        tries++
      } while (inExclusion(sx, sz) && tries < 20)
      const h = 3.2 + rng() * 2
      const smoke = new THREE.CylinderGeometry(0.05, 0.5, h, 6, 1, true)
      smokeGeoms.push(place(smoke, [sx, 3 + h / 2, sz], [(rng() - 0.5) * 0.4, 0, (rng() - 0.5) * 0.4]))
    }
  }

  // ---- マテリアル ----
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b6154, roughness: 0.95 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3d4247, roughness: 0.9 })
  const kuraMat = new THREE.MeshStandardMaterial({ color: 0xb9b4a4, roughness: 0.9 })
  const yaguraMat = new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 0.9 })
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x3e4a32, roughness: 1 })
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3e3226, roughness: 1 })
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
  const smokeMat = new THREE.MeshStandardMaterial({
    color: 0xcfd2d0,
    roughness: 1,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: THREE.DoubleSide,
  })

  group.add(mergedMesh(wallGeoms, wallMat, {}))
  group.add(mergedMesh(roofGeoms, roofMat, {}))
  group.add(mergedMesh(kuraGeoms, kuraMat, {}))
  group.add(mergedMesh(yaguraGeoms, yaguraMat, {}))
  group.add(mergedMesh(hillGeoms, hillMat, {}))
  group.add(mergedMesh(trunkGeoms, trunkMat, {}))
  group.add(mergedMesh(leafGeoms, leafMat, {}))
  const smokeMesh = mergedMesh(smokeGeoms, smokeMat, {})
  smokeMesh.name = 'kamadoSmoke'
  group.add(smokeMesh)

  // ---- 山並み(最外周。フォグに霞む) ----
  const mtGeoms: THREE.BufferGeometry[] = []
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng() * 0.3
    const r = 115 + rng() * 30
    const h = 18 + rng() * 22
    const base = 30 + rng() * 30
    const cone = new THREE.ConeGeometry(base, h, 7)
    mtGeoms.push(place(cone, [Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r]))
  }
  const mtMat = new THREE.MeshStandardMaterial({ color: 0x55606b, roughness: 1 })
  const mountains = mergedMesh(mtGeoms, mtMat, {})
  mountains.name = 'mountains'
  group.add(mountains)

  return { templeBellPos }
}
