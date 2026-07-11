import * as THREE from 'three'
import type { AppContext, WorldRefs } from '../core/types'
import { place, mergedMesh, mulberry32 } from './geo'
import { pbrMaterial } from './materials'

/**
 * 遠景(浮遊感の根絶が目的)。
 * - 視界の果てまで続く大地(半径160mの円盤、歩行不可)
 * - 半径45〜90mを取り囲む低ポリの町並みシルエット(瓦屋根の家々+火の見櫓+蔵)
 * - さらに外周の山並み
 * 色はフォグ(lighting管理)に沈む前提で彩度低め。近景の商家はstreet.tsが担当。
 */
export function buildSkyline(ctx: AppContext): Partial<WorldRefs> {
  const group = new THREE.Group()
  group.name = 'skyline'
  ctx.scene.add(group)

  const rng = mulberry32(1857)

  // ---- 大地(視界の果てまで) ----
  const earth = new THREE.Mesh(
    new THREE.CircleGeometry(160, 48),
    pbrMaterial('ground', { repeat: [60, 60], color: 0x6a6a52, tint: 0x9a9070 }),
  )
  earth.rotation.x = -Math.PI / 2
  earth.position.y = -0.12 // 通り・敷地の面より僅かに下(z-fight回避)
  earth.receiveShadow = false
  earth.name = 'earth'
  group.add(earth)

  // ---- 町並みシルエット(壁+切妻屋根を1メッシュずつに統合) ----
  const wallGeoms: THREE.BufferGeometry[] = []
  const roofGeoms: THREE.BufferGeometry[] = []

  /** 寄棟風の家: 壁ボックス+ピラミッド屋根(4角錐を軒に合わせて潰す) */
  const addHouse = (x: number, z: number, w: number, d: number, h: number, rotY: number) => {
    wallGeoms.push(place(new THREE.BoxGeometry(w, h, d), [x, h / 2, z], [0, rotY, 0]))
    const roofH = h * 0.4
    // ConeGeometry(4分割)= ピラミッド。45°回して辺を壁と平行にし、間口・奥行きに合わせて非等方スケール
    const pyr = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1)
    pyr.rotateY(Math.PI / 4)
    pyr.scale(w * 1.18, roofH, d * 1.18)
    roofGeoms.push(place(pyr, [x, h + roofH / 2 - 0.02, z], [0, rotY, 0]))
  }

  // 内リング(45〜60m): 密に。外リング(70〜90m): 疎に大きめ
  for (const [rMin, rMax, count, sMin, sMax] of [
    [45, 60, 60, 4, 7],
    [70, 90, 40, 7, 12],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.12
      const r = rMin + rng() * (rMax - rMin)
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const w = sMin + rng() * (sMax - sMin)
      const d = w * (0.6 + rng() * 0.5)
      const h = 2.6 + rng() * 2.6
      // 家の向きはおおむね円周に沿わせる(通りが同心円に走っている見え方)
      addHouse(x, z, w, d, h, -a + (rng() - 0.5) * 0.4)
    }
  }

  // 蔵(白壁・箱形)を数棟
  const kuraGeoms: THREE.BufferGeometry[] = []
  for (let i = 0; i < 8; i++) {
    const a = rng() * Math.PI * 2
    const r = 50 + rng() * 30
    kuraGeoms.push(
      place(new THREE.BoxGeometry(5, 4.5, 7), [Math.cos(a) * r, 2.25, Math.sin(a) * r], [0, -a, 0]),
    )
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

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b6154, roughness: 0.95 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3d4247, roughness: 0.9 })
  const kuraMat = new THREE.MeshStandardMaterial({ color: 0xb9b4a4, roughness: 0.9 })
  const yaguraMat = new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 0.9 })

  group.add(mergedMesh(wallGeoms, wallMat, {}))
  group.add(mergedMesh(roofGeoms, roofMat, {}))
  group.add(mergedMesh(kuraGeoms, kuraMat, {}))
  group.add(mergedMesh(yaguraGeoms, yaguraMat, {}))

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

  return {}
}
