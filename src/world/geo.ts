import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * world/ 配下(house・garden・furniture)共通のジオメトリ組み立てヘルパー。
 * ドローコール予算(GOAL §5: ≤100)を守るため、同一マテリアルの静的メッシュは
 * ここで BufferGeometry を1つに統合してから Mesh 化する。
 */

/** 位置/回転/スケールを適用してから配列に積む(mergeGeometries用の下ごしらえ)。 */
export function place(
  geo: THREE.BufferGeometry,
  pos: [number, number, number] = [0, 0, 0],
  rotYXZ: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.BufferGeometry {
  const g = geo.clone()
  g.scale(scale[0], scale[1], scale[2])
  if (rotYXZ[1]) g.rotateX(rotYXZ[1])
  if (rotYXZ[0]) g.rotateY(rotYXZ[0])
  if (rotYXZ[2]) g.rotateZ(rotYXZ[2])
  g.translate(pos[0], pos[1], pos[2])
  return g
}

/**
 * 複数ジオメトリを1つの BufferGeometry に統合する。空配列は null。
 * mergeGeometries は「index の有無」「属性集合」が全ジオメトリで一致しないと失敗するため、
 * ここで正規化する: index 混在は非インデックス化で統一し、欠落属性は補完する
 * (color=白 / uv系=0 / normal=再計算)。BoxGeometry(indexed)と quadPrism(non-indexed)、
 * paintUniform 済み(color付き)と未着色の混在を安全にマージできる。
 */
export function mergeAll(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geoms.length === 0) return null
  if (geoms.length === 1) return geoms[0]

  const anyIndexed = geoms.some((g) => g.index !== null)
  const allIndexed = geoms.every((g) => g.index !== null)
  const list = anyIndexed && !allIndexed ? geoms.map((g) => (g.index ? g.toNonIndexed() : g)) : geoms

  const names = new Set<string>()
  for (const g of list) for (const n of Object.keys(g.attributes)) names.add(n)
  for (const g of list) {
    const count = g.attributes.position.count
    for (const n of names) {
      if (g.attributes[n]) continue
      if (n === 'color') {
        const arr = new Float32Array(count * 3)
        arr.fill(1)
        g.setAttribute(n, new THREE.BufferAttribute(arr, 3))
      } else if (n === 'normal') {
        g.computeVertexNormals()
      } else {
        const proto = list.find((o) => o.attributes[n])
        const itemSize = proto ? (proto.attributes[n] as THREE.BufferAttribute).itemSize : 2
        g.setAttribute(n, new THREE.BufferAttribute(new Float32Array(count * itemSize), itemSize))
      }
    }
  }
  return mergeGeometries(list, false)
}

/** 統合ジオメトリを1本の Mesh にする。null(空)なら空の Group を返す(呼び出し側を簡潔に保つ)。 */
export function mergedMesh(
  geoms: THREE.BufferGeometry[],
  material: THREE.Material,
  opts: { castShadow?: boolean; receiveShadow?: boolean } = {},
): THREE.Object3D {
  const geo = mergeAll(geoms)
  if (!geo) return new THREE.Group()
  geo.computeBoundingSphere()
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = opts.castShadow ?? false
  mesh.receiveShadow = opts.receiveShadow ?? false
  return mesh
}

/**
 * 上面4隅(a→b→c→d、平面四角形)から厚み thickness の板(プリズム)を作る。
 * 回転行列の符号ミスを避けるため、常にワールド座標の4点から直接組み立てる。
 * 法線は (b-a)×(d-a) 方向。厚みはその逆方向に伸びる。
 * side: THREE.DoubleSide 前提のマテリアルで使うこと(法線の向きに神経質にならなくてよい)。
 */
export function quadPrism(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
  thickness: number,
  repeat: [number, number] = [1, 1],
): THREE.BufferGeometry {
  const edge1 = new THREE.Vector3().subVectors(b, a)
  const edge2 = new THREE.Vector3().subVectors(d, a)
  const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize()
  const off = normal.clone().multiplyScalar(-thickness)
  const a2 = a.clone().add(off)
  const b2 = b.clone().add(off)
  const c2 = c.clone().add(off)
  const d2 = d.clone().add(off)

  const positions: number[] = []
  const uvs: number[] = []
  const [ru, rv] = repeat

  const face = (
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3,
    p4: THREE.Vector3,
    uvSet: [number, number][] = [
      [0, 0],
      [ru, 0],
      [ru, rv],
      [0, rv],
    ],
  ) => {
    positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z)
    positions.push(p1.x, p1.y, p1.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z)
    uvs.push(...uvSet[0], ...uvSet[1], ...uvSet[2])
    uvs.push(...uvSet[0], ...uvSet[2], ...uvSet[3])
  }

  face(a, b, c, d) // top
  face(d2, c2, b2, a2) // bottom
  face(a, d, d2, a2, [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ])
  face(d, c, c2, d2, [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ])
  face(c, b, b2, c2, [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ])
  face(b, a, a2, b2, [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ])

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.computeVertexNormals()
  return geo
}

/** シード付き擬似乱数(位置ジッタ等の再現性のため Math.random は使わない)。 */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 葉のブロブ用: Icosahedron を軽くジッタして「ローポリの塊」感を減らす。頂点カラーで色を焼き込む。 */
export function leafBlob(
  radius: number,
  detail: number,
  jitter: number,
  color: THREE.Color,
  rng: () => number,
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail)
  const pos = geo.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const n = v.clone().normalize()
    const jit = 1 + (rng() - 0.5) * 2 * jitter
    v.copy(n.multiplyScalar(v.length() * jit))
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) colors.set([color.r, color.g, color.b], i * 3)
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geo
}
