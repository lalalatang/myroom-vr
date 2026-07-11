import * as THREE from 'three'

/**
 * PBRマテリアルのファクトリ。public/textures/<name>/{color,normal,roughness}.jpg を
 * 試行的に読み込み、無い場合(別エージェントが並行取得中/未取得)でも opts.color の
 * 単色 MeshStandardMaterial として成立する(onError でそのスロットだけ諦める)。
 *
 * テクスチャ名は8種に固定(他エージェントとの共有契約):
 * wood_floor / wood_dark / tatami / plaster / stone / washi / ground / roof
 */
export interface PbrOptions {
  /** UV repeat(タイル回数)。省略時は [1,1] */
  repeat?: [number, number]
  /** テクスチャ未取得時 or 取得完了までのベースカラー(読込後は白にリセットされる) */
  color?: number
  roughness?: number
  /**
   * テクスチャ読込後も乗算し続ける色。省略時は白(=テクスチャ本来の色)。
   * material.color はテクスチャに乗算されるため、fallback用の暗い color を
   * 残すとテクスチャが黒ずむ。恒久的な色調整はこちらで指定する。
   */
  tint?: number
}

const loader = new THREE.TextureLoader()
// Vite の base 設定(GitHub Pages のサブパス配信)に追従してテクスチャURLを組む
const BASE_URL: string = import.meta.env.BASE_URL ?? '/'

type Slot = 'color' | 'normal' | 'roughness'

function loadSlot(
  name: string,
  slot: Slot,
  repeat: [number, number],
  onReady: (tex: THREE.Texture) => void,
): void {
  const url = `${BASE_URL}textures/${name}/${slot}.jpg`
  loader.load(
    url,
    (tex) => {
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(repeat[0], repeat[1])
      if (slot === 'color') tex.colorSpace = THREE.SRGBColorSpace
      onReady(tex)
    },
    undefined,
    () => {
      // 404 等: このスロットだけ諦める。マテリアルは単色フォールバックのまま成立する。
    },
  )
}

/**
 * 和のPBRマテリアルを生成する。テクスチャは非同期に差し込まれる(先に単色で返り、
 * 読み込めたスロットだけ順次 map/normalMap/roughnessMap を差し替える)。
 */
export function pbrMaterial(name: string, opts: PbrOptions = {}): THREE.MeshStandardMaterial {
  const repeat = opts.repeat ?? [1, 1]
  const isWashi = name === 'washi'

  const material = new THREE.MeshStandardMaterial({
    color: opts.color ?? (isWashi ? 0xf3ecd8 : 0xffffff),
    roughness: opts.roughness ?? (isWashi ? 0.85 : 0.92),
    metalness: 0,
  })

  if (isWashi) {
    // 和紙: 貼れなくても半透明白の紙として成立させる
    material.transparent = true
    material.opacity = 0.82
    material.side = THREE.DoubleSide
    material.depthWrite = false
  }

  loadSlot(name, 'color', repeat, (tex) => {
    material.map = tex
    // fallback色はテクスチャに乗算され黒ずむため、読込後は tint(既定=白)に置き換える
    material.color.set(opts.tint ?? 0xffffff)
    material.needsUpdate = true
  })
  loadSlot(name, 'normal', repeat, (tex) => {
    material.normalMap = tex
    material.needsUpdate = true
  })
  loadSlot(name, 'roughness', repeat, (tex) => {
    material.roughnessMap = tex
    material.needsUpdate = true
  })

  return material
}
