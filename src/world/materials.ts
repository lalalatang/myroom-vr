import * as THREE from 'three'

/**
 * PBRマテリアルのファクトリ。public/textures/ 以下のテクスチャを読み、
 * 未取得(fetch-assets未実行)でも単色フォールバックで動くこと。
 * TODO(sonnet-world): 本実装。
 */
export function woodMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x7a5c3e, roughness: 0.8 })
}

export function tatamiMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xa8a06a, roughness: 0.95 })
}
