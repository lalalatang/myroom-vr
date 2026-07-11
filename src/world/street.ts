import * as THREE from 'three'
import type { AppContext, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'
import { pbrMaterial } from './materials'
import { place, mergedMesh, mergeAll, mulberry32, quadPrism } from './geo'

/**
 * 表通り(東西60m)+両側の商家群+路地+ランドマーク(v2「江戸の町」)。
 *
 * ドローコール予算(≤40)を守るため、外観の作り方は徹底的にマテリアル別統合にしている:
 * - shopWalls  : 腰壁・2階の漆喰壁・暗い裏板(頂点カラーで色分け、テクスチャは plaster 共通)
 * - shopLattice: 1階格子(店ごとに頂点カラーで色を変える)
 * - shopRoofs  : 瓦屋根(商家・木戸・井戸屋根・木戸屋根すべて集約)
 * - propsWood  : 天水桶・荷車・立て看板の木部・木戸柱・井戸の柱・物干し竿・長屋壁・板塀など(単色)
 * - propsColor : 反物・野菜籠・毛氈・鳥居・稲荷の朱、手ぬぐいなど(頂点カラーで多色を1メッシュに)
 * - stoneElements: 井戸の石組・石段・稲荷の台石(頂点カラーでわずかな濃淡)
 * - benches    : 床几(座面込みで歩行可能面として1メッシュに統合)
 * それ以外(暖簾・提灯・釣瓶・木戸の扉)は個別アニメーションが必要なため独立メッシュ。
 */

// ---- 色パレット ---------------------------------------------------------
const COL = {
  koshi: new THREE.Color(0x241d17), // 腰壁(濃茶)
  plaster: new THREE.Color(0xe9e0c9), // 2階漆喰
  interior: new THREE.Color(0x14100c), // 開口を塞ぐ暗い板
  latticeHues: [0x3b2a1f, 0x4a2a22, 0x2f3a2a, 0x24201c, 0x33404a].map((c) => new THREE.Color(c)),
  indigo: new THREE.Color(0x1f3a5f),
  kaki: new THREE.Color(0xb85c2e),
  moss: new THREE.Color(0x4f5a3a),
  gofukuBolts: [0x2e4374, 0x7a2e35, 0x8a6a2e].map((c) => new THREE.Color(c)),
  veggie: [0xcf7a2e, 0x4f7a2e, 0x4a3a6e, 0xb8a23a].map((c) => new THREE.Color(c)),
  carpet: new THREE.Color(0xb23a3a),
  toriiRed: new THREE.Color(0xa3392f),
  tenugui: [0xf0ece0, 0xb9c9d6, 0xd9b9c2].map((c) => new THREE.Color(c)),
  stoneGrey: new THREE.Color(0x8a8478),
} as const

type ShopType = 'gofukuya' | 'yaoya' | 'mizuchaya' | 'plain'

interface ShopUnit {
  x0: number
  w: number
  side: 'north' | 'south'
  type: ShopType
}

/** 頂点カラー属性(全頂点同色)を付与する。mergeGeometries で属性を揃えるために使う。 */
function paintUniform(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const count = geo.attributes.position.count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3)
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geo
}

function makeTextCanvasTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const c = canvas.getContext('2d')!
  c.fillStyle = '#a3392f'
  c.fillRect(0, 0, 128, 128)
  c.fillStyle = '#f3ecd8'
  c.font = 'bold 56px sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  for (let i = 0; i < text.length; i++) {
    c.fillText(text[i], 64, 34 + i * 60)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function buildStreet(ctx: AppContext): Partial<WorldRefs> {
  const group = new THREE.Group()
  group.name = 'street'
  ctx.scene.add(group)

  const s = LAYOUT.STREET
  const rng = mulberry32(184509)

  const teleportSurfaces: THREE.Object3D[] = []
  const noren: THREE.Object3D[] = []

  // ---- マテリアル ---------------------------------------------------------
  const roadMat = pbrMaterial('ground', { repeat: [20, 2], color: 0x8a7a60, tint: 0xac9678 })
  const wallMat = pbrMaterial('plaster', { repeat: [1, 1], tint: 0xffffff })
  wallMat.vertexColors = true
  const latticeMat = pbrMaterial('wood_dark', { repeat: [1, 3], tint: 0xffffff })
  latticeMat.vertexColors = true
  const roofMat = pbrMaterial('roof', { repeat: [3, 2], color: 0x2c3238, tint: 0x3a4148 })
  const propsWoodMat = pbrMaterial('wood_dark', { repeat: [1, 1], color: 0x4a3826, tint: 0x8a6a48 })
  const propsColorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })
  const stoneMat = pbrMaterial('stone', { repeat: [1, 1], color: 0x84837a, tint: 0xffffff })
  stoneMat.vertexColors = true
  const benchMat = pbrMaterial('wood_dark', { repeat: [1, 1], color: 0x3a2a1c, tint: 0x8a6a48 })

  // ---- 統合用ジオメトリバケツ ------------------------------------------------
  const wallGeoms: THREE.BufferGeometry[] = []
  const latticeGeoms: THREE.BufferGeometry[] = []
  const roofGeoms: THREE.BufferGeometry[] = []
  const propsWoodGeoms: THREE.BufferGeometry[] = []
  const propsColorGeoms: THREE.BufferGeometry[] = []
  const stoneGeoms: THREE.BufferGeometry[] = []
  const benchGeoms: THREE.BufferGeometry[] = []

  // =========================================================================
  // 路面(通り+路地)
  // =========================================================================
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(s.maxX - s.minX, 0.08, s.maxZ - s.minZ),
    roadMat,
  )
  road.position.set((s.minX + s.maxX) / 2, -0.04, (s.minZ + s.maxZ) / 2)
  road.userData.walkable = true
  road.receiveShadow = true
  road.name = 'streetRoad'
  group.add(road)
  teleportSurfaces.push(road)

  const a = LAYOUT.ALLEY
  const alleyGround = new THREE.Mesh(
    new THREE.BoxGeometry(a.maxX - a.minX, 0.08, a.maxZ - a.minZ),
    roadMat,
  )
  alleyGround.position.set((a.minX + a.maxX) / 2, -0.04, (a.minZ + a.maxZ) / 2)
  alleyGround.userData.walkable = true
  alleyGround.receiveShadow = true
  alleyGround.name = 'alleyGround'
  group.add(alleyGround)
  teleportSurfaces.push(alleyGround)

  // =========================================================================
  // 商家ファサード
  // =========================================================================
  const KOSHI_H = 0.8
  const LATTICE_TOP = 1.85
  const NOREN_CAP = 12
  let norenCount = 0
  let lastType: ShopType | undefined

  /**
   * 切妻屋根(ridge が X 軸に平行)を quadPrism で2枚(前面・背面スロープ)追加する。
   * 回転行列の符号ミスによる裏面カリング(=屋根が消える)を避けるため、
   * BoxGeometry+rotate ではなく世界座標の4隅から直接組む quadPrism を使う。
   */
  function addGableRoof(
    x0: number,
    w: number,
    zFront: number,
    outward: number,
    D: number,
    eaveY: number,
    peakY: number,
  ): void {
    const zBack = zFront + outward * D
    const zMid = zFront + outward * D * 0.5
    const overhangFrontZ = zFront - outward * 0.3
    const overhangBackZ = zBack + outward * 0.15
    const xL = x0 - 0.15
    const xR = x0 + w + 0.15
    const ridgeL = new THREE.Vector3(xL, peakY, zMid)
    const ridgeR = new THREE.Vector3(xR, peakY, zMid)
    const frontL = new THREE.Vector3(xL, eaveY, overhangFrontZ)
    const frontR = new THREE.Vector3(xR, eaveY, overhangFrontZ)
    const backL = new THREE.Vector3(xL, eaveY, overhangBackZ)
    const backR = new THREE.Vector3(xR, eaveY, overhangBackZ)
    roofGeoms.push(quadPrism(ridgeL, ridgeR, frontR, frontL, 0.05))
    roofGeoms.push(quadPrism(ridgeR, ridgeL, backL, backR, 0.05))
  }

  function pickType(): ShopType {
    const roll = rng()
    let t: ShopType
    if (roll < 0.22) t = 'gofukuya'
    else if (roll < 0.44) t = 'yaoya'
    else if (roll < 0.6) t = 'mizuchaya'
    else t = 'plain'
    if (t === lastType && rng() < 0.6) {
      // 3連続同種を避ける
      const alts: ShopType[] = ['gofukuya', 'yaoya', 'mizuchaya', 'plain'].filter((x) => x !== t) as ShopType[]
      t = alts[Math.floor(rng() * alts.length)]
    }
    lastType = t
    return t
  }

  function buildShop(unit: ShopUnit): void {
    const { x0, w, side } = unit
    const outward = side === 'north' ? -1 : 1
    const zFront = side === 'north' ? s.minZ : s.maxZ
    const D = 2.3 + rng() * 0.6
    const eaveY = 2.2 + rng() * 0.3
    const peakY = eaveY + 2.3 + rng() * 0.5
    const cx = x0 + w / 2

    // 腰壁(0〜KOSHI_H)
    wallGeoms.push(paintUniform(place(new THREE.BoxGeometry(w, KOSHI_H, 0.12), [cx, KOSHI_H / 2, zFront]), COL.koshi))
    // 開口を塞ぐ暗い裏板(格子の奥、KOSHI_H〜LATTICE_TOP)
    const backZ = zFront + outward * 0.1
    wallGeoms.push(
      paintUniform(
        place(new THREE.BoxGeometry(w * 0.92, LATTICE_TOP - KOSHI_H, 0.06), [
          cx,
          (KOSHI_H + LATTICE_TOP) / 2,
          backZ,
        ]),
        COL.interior,
      ),
    )
    // 2階漆喰壁(LATTICE_TOP〜eaveY、虫籠窓風)
    wallGeoms.push(
      paintUniform(
        place(new THREE.BoxGeometry(w, eaveY - LATTICE_TOP, 0.14), [cx, (LATTICE_TOP + eaveY) / 2, zFront]),
        COL.plaster,
      ),
    )
    // 虫籠窓のスリット(暗色の細縦帯を数本)
    const slitCount = Math.max(2, Math.floor(w / 1.1))
    for (let i = 0; i < slitCount; i++) {
      const sx = x0 + ((i + 0.5) / slitCount) * w
      wallGeoms.push(
        paintUniform(
          place(
            new THREE.BoxGeometry(0.1, (eaveY - LATTICE_TOP) * 0.55, 0.03),
            [sx, LATTICE_TOP + (eaveY - LATTICE_TOP) * 0.5, zFront - outward * 0.08],
          ),
          COL.interior,
        ),
      )
    }

    // 1階格子(縦棧)
    const hue = COL.latticeHues[Math.floor(rng() * COL.latticeHues.length)]
    const barCount = Math.max(4, Math.floor(w / 0.22))
    for (let i = 0; i < barCount; i++) {
      const bx = x0 + ((i + 0.5) / barCount) * w
      latticeGeoms.push(
        paintUniform(
          place(new THREE.BoxGeometry(0.045, LATTICE_TOP - KOSHI_H, 0.05), [
            bx,
            (KOSHI_H + LATTICE_TOP) / 2,
            zFront + outward * 0.03,
          ]),
          hue,
        ),
      )
    }
    // 上下の貫(横木)
    latticeGeoms.push(
      paintUniform(place(new THREE.BoxGeometry(w, 0.05, 0.07), [cx, KOSHI_H + 0.02, zFront]), hue),
    )
    latticeGeoms.push(
      paintUniform(place(new THREE.BoxGeometry(w, 0.05, 0.07), [cx, LATTICE_TOP - 0.02, zFront]), hue),
    )

    // 屋根(切妻)
    addGableRoof(x0, w, zFront, outward, D, eaveY, peakY)

    // 種類ごとの小物(通り側に張り出す。outward は奥行き方向=通りの逆なので符号反転)
    const frontMargin = zFront - outward * 0.28
    if (unit.type === 'gofukuya') {
      const boltCount = 2
      for (let i = 0; i < boltCount; i++) {
        const bx = cx + (i - (boltCount - 1) / 2) * 0.5
        propsWoodGeoms.push(place(new THREE.BoxGeometry(0.16, 0.1, 0.16), [bx, 0.05, frontMargin]))
        const boltColor = COL.gofukuBolts[Math.floor(rng() * COL.gofukuBolts.length)]
        propsColorGeoms.push(
          paintUniform(place(new THREE.BoxGeometry(0.14, 0.85, 0.12), [bx, 0.1 + 0.425, frontMargin]), boltColor),
        )
      }
    } else if (unit.type === 'yaoya') {
      const basketCount = 2 + Math.floor(rng() * 2)
      for (let i = 0; i < basketCount; i++) {
        const bx = x0 + 0.4 + rng() * (w - 0.8)
        const bz = frontMargin + (rng() - 0.5) * 0.15
        propsWoodGeoms.push(
          place(new THREE.CylinderGeometry(0.22, 0.19, 0.2, 8), [bx, 0.1, bz]),
        )
        const clusterN = 3 + Math.floor(rng() * 2)
        for (let j = 0; j < clusterN; j++) {
          const veg = COL.veggie[Math.floor(rng() * COL.veggie.length)]
          const ox = (rng() - 0.5) * 0.22
          const oz = (rng() - 0.5) * 0.18
          propsColorGeoms.push(
            paintUniform(
              place(new THREE.SphereGeometry(0.075 + rng() * 0.04, 6, 5), [bx + ox, 0.24 + rng() * 0.06, bz + oz]),
              veg,
            ),
          )
        }
      }
    } else if (unit.type === 'mizuchaya') {
      addBench(cx, frontMargin, side)
      propsColorGeoms.push(
        paintUniform(place(new THREE.BoxGeometry(0.95, 0.02, 0.32), [cx, 0.44, frontMargin]), COL.carpet),
      )
    }

    // 暖簾
    if (unit.type !== 'plain' ? norenCount < NOREN_CAP : rng() < 0.3 && norenCount < NOREN_CAP) {
      norenCount++
      const base = rng() < 0.55 ? COL.indigo : COL.kaki
      const jitter = 0.9 + rng() * 0.2
      const color = base.clone().multiplyScalar(jitter)
      const norenW = Math.min(w * 0.75, 1.6)
      const norenGeo = new THREE.PlaneGeometry(norenW, 1.0, 6, 5)
      const norenMat = new THREE.MeshStandardMaterial({ color, roughness: 0.88, side: THREE.DoubleSide })
      const norenMesh = new THREE.Mesh(norenGeo, norenMat)
      norenMesh.name = 'norenCloth'
      const norenGroup = new THREE.Group()
      norenGroup.name = `noren_${side}_${x0.toFixed(1)}`
      norenGroup.position.set(cx, eaveY - 0.55, zFront - outward * 0.02)
      if (side === 'south') norenGroup.rotation.y = Math.PI
      norenGroup.add(norenMesh)
      group.add(norenGroup)
      noren.push(norenGroup)
    }
  }

  function addBench(x: number, z: number, side: 'north' | 'south'): void {
    const seatY = 0.42
    benchGeoms.push(place(new THREE.BoxGeometry(1.1, 0.06, 0.36), [x, seatY, z]))
    const legOff = side === 'north' ? 0.14 : 0.14
    for (const [lx, lz] of [
      [-0.48, -legOff],
      [0.48, -legOff],
      [-0.48, legOff],
      [0.48, legOff],
    ] as const) {
      benchGeoms.push(place(new THREE.BoxGeometry(0.06, seatY, 0.06), [x + lx, seatY / 2, z + lz]))
    }
  }

  function fillSegment(xStart: number, xEnd: number, side: 'north' | 'south'): void {
    let x = xStart
    while (x < xEnd - 0.3) {
      const remaining = xEnd - x
      let w = 3.4 + rng() * 1.8
      if (remaining - w < 2.2) w = remaining // 端数を最後の1軒に吸収
      w = Math.min(w, remaining)
      const type = pickType()
      buildShop({ x0: x, w, side, type })
      x += w
    }
  }

  // 北側(プレイヤー町家 x∈[-6,0] は空ける)
  fillSegment(s.minX, -6, 'north')
  fillSegment(0, s.maxX, 'north')
  // 南側(路地口 x∈[6,9.5] は空ける)
  fillSegment(s.minX, LAYOUT.ALLEY.minX, 'south')
  fillSegment(LAYOUT.ALLEY.maxX, s.maxX, 'south')

  // =========================================================================
  // 井戸(路地の井戸端)
  // =========================================================================
  const wellGroup = new THREE.Group()
  wellGroup.name = 'well'
  wellGroup.position.set(LAYOUT.WELL.x, 0, LAYOUT.WELL.z)
  group.add(wellGroup)

  // 井戸の柱・屋根・滑車は個別アニメ不要なため、全体の propsWood/shopRoofs 統合プールへ(ワールド座標で追加)
  const wx = LAYOUT.WELL.x
  const wz = LAYOUT.WELL.z
  for (const [px, pz] of [
    [-0.42, -0.32],
    [0.42, -0.32],
    [-0.42, 0.32],
    [0.42, 0.32],
  ] as const) {
    propsWoodGeoms.push(place(new THREE.CylinderGeometry(0.045, 0.045, 1.7, 6), [wx + px, 1.7 / 2 + 0.4, wz + pz]))
  }
  {
    // 井戸の小屋根(切妻、ridge は X 軸に平行)
    const ridgeL = new THREE.Vector3(wx - 0.65, 2.3, wz)
    const ridgeR = new THREE.Vector3(wx + 0.65, 2.3, wz)
    const frontL = new THREE.Vector3(wx - 0.65, 2.05, wz - 0.5)
    const frontR = new THREE.Vector3(wx + 0.65, 2.05, wz - 0.5)
    const backL = new THREE.Vector3(wx - 0.65, 2.05, wz + 0.5)
    const backR = new THREE.Vector3(wx + 0.65, 2.05, wz + 0.5)
    roofGeoms.push(quadPrism(ridgeL, ridgeR, frontR, frontL, 0.04))
    roofGeoms.push(quadPrism(ridgeR, ridgeL, backL, backR, 0.04))
  }
  propsWoodGeoms.push(
    place(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10), [wx, 2.05, wz], [0, 0, Math.PI / 2]),
  )
  // 石組(井戸の縁石)。個別アニメ不要なため全体の stoneElements 統合プールへ(ワールド座標で追加)
  stoneGeoms.push(
    paintUniform(
      place(new THREE.CylinderGeometry(0.5, 0.55, 0.45, 10), [LAYOUT.WELL.x, 0.225, LAYOUT.WELL.z]),
      COL.stoneGrey,
    ),
  )
  // 釣瓶(桶+縄)。初期位置は上(滑車付近)
  {
    const tsurube = new THREE.Group()
    tsurube.name = 'tsurube'
    tsurube.position.set(0, 1.55, 0)
    const bucketGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.18, 8)
    const ropeGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.35, 5)
    ropeGeo.translate(0, 0.17 + 0.09, 0)
    const merged = mergeAll([bucketGeo, ropeGeo])!
    const tsurubeMesh = new THREE.Mesh(merged, propsWoodMat)
    tsurubeMesh.castShadow = true
    tsurube.add(tsurubeMesh)
    wellGroup.add(tsurube)
  }

  // =========================================================================
  // 蕎麦屋台
  // =========================================================================
  const yataiGroup = new THREE.Group()
  yataiGroup.name = 'yatai'
  yataiGroup.position.set(LAYOUT.YATAI.x, 0, LAYOUT.YATAI.z)
  group.add(yataiGroup)
  {
    const bodyGeoms: THREE.BufferGeometry[] = []
    bodyGeoms.push(place(new THREE.BoxGeometry(1.5, 0.75, 0.7), [0, 0.375, 0]))
    // 担ぎ棒
    bodyGeoms.push(place(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), [0, 0.75, 0], [0, 0, Math.PI / 2]))
    // 屋根(小さな片流れ)
    bodyGeoms.push(place(new THREE.BoxGeometry(1.7, 0.05, 0.9), [0, 1.35, -0.05], [0, 0, 0.12]))
    // 支柱
    for (const [px, pz] of [
      [-0.65, -0.3],
      [0.65, -0.3],
      [-0.65, 0.3],
      [0.65, 0.3],
    ] as const) {
      bodyGeoms.push(place(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 5), [px, 1.05, pz]))
    }
    const yataiMesh = mergedMesh(bodyGeoms, propsWoodMat, { castShadow: true })
    yataiMesh.name = 'yataiBody'
    yataiGroup.add(yataiMesh)
    // 提灯風の小さな行灯(そば文字)
    const flagTex = makeTextCanvasTexture('そば')
    const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, roughness: 0.85, side: THREE.DoubleSide })
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), flagMat)
    flag.position.set(0.75, 1.05, 0)
    flag.rotation.y = Math.PI / 2
    yataiGroup.add(flag)
    // 湯気の起点
    const steamAnchor = new THREE.Object3D()
    steamAnchor.name = 'steamAnchor'
    steamAnchor.position.set(0, 1.2, 0)
    yataiGroup.add(steamAnchor)
    // 屋台脇の床几
    addBench(LAYOUT.YATAI.x + 1.3, LAYOUT.YATAI.z + 0.1, 'south')
  }

  // =========================================================================
  // 天水桶(2〜3組)・荷車・追加の立て看板
  // =========================================================================
  const tsuboiokePositions: [number, number][] = [
    [-18, s.minZ + 0.15],
    [12, s.maxZ - 0.15],
    [24, s.minZ + 0.15],
  ]
  for (const [tx, tz] of tsuboiokePositions) {
    propsWoodGeoms.push(place(new THREE.CylinderGeometry(0.32, 0.34, 0.5, 10), [tx, 0.25, tz]))
  }

  // 荷車
  {
    const cartGeoms: THREE.BufferGeometry[] = []
    cartGeoms.push(place(new THREE.BoxGeometry(1.3, 0.32, 0.9), [0, 0.5, 0]))
    for (const wx of [-0.55, 0.55]) {
      const wheel = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 12)
      wheel.rotateX(Math.PI / 2)
      cartGeoms.push(place(wheel, [wx, 0.32, 0.5]))
      const wheel2 = wheel.clone()
      cartGeoms.push(place(wheel2, [wx, 0.32, -0.5]))
    }
    cartGeoms.push(place(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 5), [0, 0.5, 0.95]))
    const cartMesh = mergedMesh(cartGeoms, propsWoodMat, { castShadow: true })
    cartMesh.name = 'handcart'
    cartMesh.position.set(-9, 0, 1.6)
    cartMesh.rotation.y = 0.3
    group.add(cartMesh)
  }

  // 追加の立て看板
  for (const [sx, sz, sside] of [
    [-22, s.minZ + 0.1, -1],
    [18, s.maxZ - 0.1, 1],
  ] as const) {
    propsWoodGeoms.push(place(new THREE.BoxGeometry(0.06, 1.0, 0.4), [sx, 0.5, sz]))
    propsWoodGeoms.push(place(new THREE.BoxGeometry(0.04, 0.04, 0.5), [sx, 0.02, sz + 0.05 * sside]))
  }

  // =========================================================================
  // 東端: 柵・立て札・賽銭箱・神社(石段+鳥居)
  // =========================================================================
  let coinBoxMesh: THREE.Object3D
  {
    const fenceX = s.maxX
    for (const px of [-2.2, -0.7, 0.7, 2.2]) {
      propsWoodGeoms.push(place(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), [fenceX, 0.5, px]))
    }
    propsWoodGeoms.push(place(new THREE.BoxGeometry(0.06, 0.06, 4.6), [fenceX, 0.85, 0], [0, 0, 0]))
    propsWoodGeoms.push(place(new THREE.BoxGeometry(0.06, 0.06, 4.6), [fenceX, 0.55, 0], [0, 0, 0]))
    // 立て札
    propsWoodGeoms.push(place(new THREE.BoxGeometry(0.05, 0.9, 0.35), [fenceX - 0.6, 0.45, -2.6]))
    propsWoodGeoms.push(place(new THREE.BoxGeometry(0.04, 0.04, 0.45), [fenceX - 0.6, 0.02, -2.6]))

    // 賽銭箱(独立メッシュ = refs.coinTarget)
    const boxGeoms: THREE.BufferGeometry[] = []
    boxGeoms.push(place(new THREE.BoxGeometry(0.55, 0.4, 0.42), [0, 0.2, 0]))
    for (let i = 0; i < 5; i++) {
      const gx = -0.22 + (i / 4) * 0.44
      boxGeoms.push(place(new THREE.BoxGeometry(0.03, 0.03, 0.42), [gx, 0.41, 0]))
    }
    coinBoxMesh = mergedMesh(boxGeoms, propsWoodMat, { castShadow: true })
    coinBoxMesh.name = 'coinBox'
    coinBoxMesh.position.set(fenceX - 1.1, 0, 0)
    group.add(coinBoxMesh)

    // 石段(5〜7段。丘に上がる表現。歩行不可)
    const stepCount = 6
    for (let i = 0; i < stepCount; i++) {
      const stx = s.maxX + 1.4 + i * 0.42
      const sty = i * 0.2
      stoneGeoms.push(
        paintUniform(place(new THREE.BoxGeometry(0.44, 0.2, 2.6), [stx, sty + 0.1, 0]), COL.stoneGrey),
      )
    }
    const topX = s.maxX + 1.4 + stepCount * 0.42
    const topY = stepCount * 0.2

    // 鳥居(朱色、高さ約4m)
    const toriiGeoms: THREE.BufferGeometry[] = []
    const toriiX = topX + 1.6
    const toriiH = 4
    for (const pz of [-1.4, 1.4]) {
      const post = new THREE.CylinderGeometry(0.13, 0.15, toriiH, 8)
      toriiGeoms.push(place(post, [toriiX, topY + toriiH / 2, pz]))
    }
    // 笠木(上部の反った横材、簡易的に2段の直材で表現)
    toriiGeoms.push(
      place(new THREE.BoxGeometry(0.5, 0.22, 3.6), [toriiX, topY + toriiH + 0.05, 0]),
    )
    toriiGeoms.push(
      place(new THREE.BoxGeometry(0.3, 0.16, 3.3), [toriiX, topY + toriiH - 0.32, 0]),
    )
    // 貫(下の横材)
    toriiGeoms.push(place(new THREE.BoxGeometry(0.16, 0.16, 2.9), [toriiX, topY + toriiH * 0.55, 0]))
    for (const g of toriiGeoms) paintUniform(g, COL.toriiRed)
    propsColorGeoms.push(...toriiGeoms)
  }

  // =========================================================================
  // 西端: 木戸
  // =========================================================================
  const kidoGroup = new THREE.Group()
  kidoGroup.name = 'kido'
  kidoGroup.position.set(LAYOUT.KIDO_X, 0, 0)
  group.add(kidoGroup)
  {
    const kidoStaticGeoms: THREE.BufferGeometry[] = []
    for (const pz of [-3, 3]) {
      kidoStaticGeoms.push(place(new THREE.BoxGeometry(0.22, 2.7, 0.22), [0, 1.35, pz]))
    }
    const kidoStatic = mergedMesh(kidoStaticGeoms, propsWoodMat, { castShadow: true })
    kidoStatic.name = 'kidoFrame'
    kidoGroup.add(kidoStatic)
    // 屋根(切妻、ridge は Z 軸に平行)。kidoGroup は既に KIDO_X に位置しているため
    // ここではワールド座標(=kidoGroup ローカル座標)で quadPrism を組み、street group 直下へ追加する
    const kx = LAYOUT.KIDO_X
    {
      const ridgeA = new THREE.Vector3(kx, 3.0, -3.4)
      const ridgeB = new THREE.Vector3(kx, 3.0, 3.4)
      const leftA = new THREE.Vector3(kx - 0.55, 2.65, -3.4)
      const leftB = new THREE.Vector3(kx - 0.55, 2.65, 3.4)
      const rightA = new THREE.Vector3(kx + 0.55, 2.65, -3.4)
      const rightB = new THREE.Vector3(kx + 0.55, 2.65, 3.4)
      roofGeoms.push(quadPrism(ridgeA, ridgeB, leftB, leftA, 0.04))
      roofGeoms.push(quadPrism(ridgeB, ridgeA, rightA, rightB, 0.04))
    }

    // 板戸(name:'kidoGate')。ヒンジは z=+3 側の柱。
    // interactions/street.ts は「ビルド時の rotation.y = 開」「開 - 90° = 閉」という規約で
    // 角度を導出する(userData は参照しない)。そのため本ビルダー側もこの規約に合わせて組む:
    //   開(ビルド時 = -90°): 柱沿いに西(街の外側、x<KIDO_X)へ畳まれる → 何も無い方向なので干渉なし
    //   閉(開 - 90° = -180°): ヒンジ(z=+3)から z=-3 まで振れて通りの幅を塞ぐ
    const gateGroup = new THREE.Group()
    gateGroup.name = 'kidoGate'
    gateGroup.position.set(0, 0, 3)
    gateGroup.rotation.y = -Math.PI / 2
    gateGroup.userData.hinge = { axis: 'y', closed: -Math.PI, open: -Math.PI / 2 }
    const doorGeo = new THREE.BoxGeometry(0.06, 2.1, 6)
    doorGeo.translate(0, 1.05, 3)
    const doorMesh = new THREE.Mesh(doorGeo, propsWoodMat)
    doorMesh.castShadow = true
    gateGroup.add(doorMesh)
    kidoGroup.add(gateGroup)
  }

  // =========================================================================
  // 路地(長屋木戸・壁・井戸端・物干し・突き当たり板塀)
  // =========================================================================
  {
    const alleyWallH = 1.8
    // 東西の壁(低い軒)
    wallGeoms.push(
      paintUniform(
        place(new THREE.BoxGeometry(0.16, alleyWallH, a.maxZ - a.minZ), [
          a.minX - 0.08,
          alleyWallH / 2,
          (a.minZ + a.maxZ) / 2,
        ]),
        COL.plaster,
      ),
    )
    wallGeoms.push(
      paintUniform(
        place(new THREE.BoxGeometry(0.16, alleyWallH, a.maxZ - a.minZ), [
          a.maxX + 0.08,
          alleyWallH / 2,
          (a.minZ + a.maxZ) / 2,
        ]),
        COL.plaster,
      ),
    )
    // 長屋木戸(入口、常時開: 柱+小屋根のみ)
    for (const px of [a.minX, a.maxX]) {
      propsWoodGeoms.push(place(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 6), [px, 1.0, a.minZ - 0.05]))
    }
    const gateRoofGeoms: THREE.BufferGeometry[] = []
    gateRoofGeoms.push(place(new THREE.BoxGeometry(a.maxX - a.minX + 0.5, 0.06, 0.5), [
      (a.minX + a.maxX) / 2,
      2.05,
      a.minZ - 0.05,
    ]))
    roofGeoms.push(...gateRoofGeoms)

    // 突き当たり板塀
    propsWoodGeoms.push(
      place(new THREE.BoxGeometry(a.maxX - a.minX, alleyWallH, 0.1), [
        (a.minX + a.maxX) / 2,
        alleyWallH / 2,
        a.maxZ + 0.05,
      ]),
    )

    // 物干し竿+手ぬぐい
    const poleZ = 12.2
    propsWoodGeoms.push(
      place(new THREE.CylinderGeometry(0.03, 0.03, a.maxX - a.minX - 0.6, 6), [
        (a.minX + a.maxX) / 2,
        1.9,
        poleZ,
      ], [0, 0, Math.PI / 2]),
    )
    for (const px of [a.minX + 0.3, a.maxX - 0.3]) {
      propsWoodGeoms.push(place(new THREE.CylinderGeometry(0.035, 0.035, 1.9, 6), [px, 0.95, poleZ]))
    }
    for (let i = 0; i < 3; i++) {
      const tx = (a.minX + a.maxX) / 2 + (i - 1) * 0.6
      const tenuguiColor = COL.tenugui[i % COL.tenugui.length]
      propsColorGeoms.push(
        paintUniform(place(new THREE.PlaneGeometry(0.32, 0.55), [tx, 1.6, poleZ + 0.02]), tenuguiColor),
      )
    }
    // 桶
    for (const [bx, bz] of [
      [a.minX + 0.5, 11.2],
      [a.maxX - 0.5, 11.3],
    ] as const) {
      propsWoodGeoms.push(place(new THREE.CylinderGeometry(0.22, 0.2, 0.3, 8), [bx, 0.15, bz]))
    }
  }

  // =========================================================================
  // 稲荷の祠(x≈20、南側)
  // =========================================================================
  {
    const inariX = 20
    const inariZ = s.maxZ - 0.35
    stoneGeoms.push(paintUniform(place(new THREE.BoxGeometry(0.5, 0.2, 0.4), [inariX, 0.1, inariZ]), COL.stoneGrey))
    const miniToriiGeoms: THREE.BufferGeometry[] = []
    for (const pz of [-0.35, 0.35]) {
      miniToriiGeoms.push(place(new THREE.CylinderGeometry(0.035, 0.04, 1.1, 6), [inariX, 0.75, inariZ + pz]))
    }
    miniToriiGeoms.push(place(new THREE.BoxGeometry(0.1, 0.06, 1.0), [inariX, 1.32, inariZ]))
    miniToriiGeoms.push(place(new THREE.BoxGeometry(0.06, 0.06, 0.85), [inariX, 1.1, inariZ]))
    for (const g of miniToriiGeoms) paintUniform(g, COL.toriiRed)
    propsColorGeoms.push(...miniToriiGeoms)
    // 小さな祠本体
    propsWoodGeoms.push(place(new THREE.BoxGeometry(0.35, 0.4, 0.32), [inariX, 0.4, inariZ]))
  }

  // =========================================================================
  // 提灯(通り沿い)。
  // interactions/street.ts は `lampFixtures.chochin.children` を直接 map して
  // 各要素の rotation.z を個別位相で振り子アニメさせる規約(1子=1提灯という前提)。
  // そのため提灯本体(chochinGlow)は「提灯ごとに1つの小さな Group」として
  // chochinGroup の直接の子にする(=揺れが提灯ごとの位置を中心に正しく回る)。
  // 一方、笠・受け・吊り金具などの細部は個別に揺れる必要が薄いため、
  // ドローコール節約のため通り全体の propsWood 統合プールへ静的に混ぜ込む。
  // マテリアルは点灯を一斉に切り替えるため全提灯で共有(専用の glowMat 1つ)。
  // =========================================================================
  const chochinGroup = new THREE.Group()
  chochinGroup.name = 'chochinFixtures'
  group.add(chochinGroup)

  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xf3ecd8,
    emissive: 0xffb050,
    emissiveIntensity: 0,
    roughness: 0.7,
  })

  const lanternCount = 10
  const lanternXs: number[] = []
  for (let i = 0; i < lanternCount; i++) {
    const t = i / (lanternCount - 1)
    lanternXs.push(-25 + t * 51)
  }
  const lightXTargets = [-20, 4, 23]
  const LIGHT_MATCH_DIST = 3.5 // 提灯間隔(約5.7m)の半分超をカバーし、東西中央のいずれかに必ず1灯つく
  const usedLightX = new Set<number>()

  for (let i = 0; i < lanternXs.length; i++) {
    const lx = lanternXs[i]
    const side: 'north' | 'south' = i % 2 === 0 ? 'north' : 'south'
    // 路地口・木戸付近は避ける
    if (lx > LAYOUT.ALLEY.minX - 1 && lx < LAYOUT.ALLEY.maxX + 1 && side === 'south') continue
    const lz = side === 'north' ? s.minZ + 0.15 : s.maxZ - 0.15
    const ly = 2.15

    // 提灯本体(1灯=1 Group=1 draw call、揺れの支点は Group のワールド位置)
    const lanternGroup = new THREE.Group()
    lanternGroup.name = `chochin_${i}`
    lanternGroup.position.set(lx, ly, lz)
    const bodyGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8)
    bodyGeo.scale(1, 1, 0.85)
    const bodyMesh = new THREE.Mesh(bodyGeo, glowMat)
    bodyMesh.name = 'chochinGlow'
    lanternGroup.add(bodyMesh)
    chochinGroup.add(lanternGroup)

    // 笠・受け・吊り金具(揺れ不要、通り全体の propsWood 統合プールへ静的に追加)
    propsWoodGeoms.push(place(new THREE.CylinderGeometry(0.05, 0.09, 0.06, 8), [lx, ly + 0.17, lz]))
    propsWoodGeoms.push(place(new THREE.CylinderGeometry(0.09, 0.05, 0.06, 8), [lx, ly - 0.17, lz]))
    propsWoodGeoms.push(place(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 5), [lx, ly + 0.27, lz]))

    // 東・中・西に分散させて最大3灯まで PointLight を置く
    for (const target of lightXTargets) {
      if (!usedLightX.has(target) && Math.abs(lx - target) < LIGHT_MATCH_DIST) {
        usedLightX.add(target)
        const light = new THREE.PointLight(0xffb050, 0, 10, 2)
        light.name = 'chochinLight'
        light.position.set(lx, ly, lz)
        chochinGroup.add(light)
        break
      }
    }
  }

  // =========================================================================
  // 統合メッシュの生成
  // =========================================================================
  const wallMesh = mergedMesh(wallGeoms, wallMat, { castShadow: true, receiveShadow: true })
  wallMesh.name = 'shopWalls'
  group.add(wallMesh)

  const latticeMesh = mergedMesh(latticeGeoms, latticeMat, { castShadow: false, receiveShadow: true })
  latticeMesh.name = 'shopLattice'
  group.add(latticeMesh)

  const roofMesh = mergedMesh(roofGeoms, roofMat, { castShadow: true, receiveShadow: false })
  roofMesh.name = 'shopRoofs'
  group.add(roofMesh)

  const propsWoodMesh = mergedMesh(propsWoodGeoms, propsWoodMat, { castShadow: true, receiveShadow: true })
  propsWoodMesh.name = 'propsWood'
  group.add(propsWoodMesh)

  const propsColorMesh = mergedMesh(propsColorGeoms, propsColorMat, { castShadow: false, receiveShadow: true })
  propsColorMesh.name = 'propsColor'
  group.add(propsColorMesh)

  const stoneMesh = mergedMesh(stoneGeoms, stoneMat, { castShadow: false, receiveShadow: true })
  stoneMesh.name = 'stoneElements'
  group.add(stoneMesh)

  const benchMesh = mergedMesh(benchGeoms, benchMat, { castShadow: false, receiveShadow: true })
  benchMesh.name = 'benches'
  benchMesh.userData.walkable = true
  group.add(benchMesh)
  teleportSurfaces.push(benchMesh)

  return {
    teleportSurfaces,
    noren,
    lampFixtures: { chochin: chochinGroup },
    well: wellGroup,
    yatai: yataiGroup,
    kido: kidoGroup,
    coinTarget: coinBoxMesh,
    templeBellPos: new THREE.Vector3(LAYOUT.SHRINE_X + 8, 3, 0),
  }
}
