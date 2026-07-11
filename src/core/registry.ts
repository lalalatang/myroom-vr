import type * as THREE from 'three'
import type { Interactable } from './types'

/**
 * インタラクション対象の一元レジストリ。
 * XRコントローラー(systems/controllers.ts)とデスクトップクリック(systems/desktop.ts)の両方がここを引く。
 */
class InteractionRegistry {
  private items = new Set<Interactable>()
  private byObject = new WeakMap<THREE.Object3D, Interactable>()

  add(item: Interactable): void {
    this.items.add(item)
    this.byObject.set(item.object, item)
  }

  remove(item: Interactable): void {
    this.items.delete(item)
    this.byObject.delete(item.object)
  }

  /** レイキャスト対象のルート一覧 */
  get targets(): THREE.Object3D[] {
    return [...this.items].map((i) => i.object)
  }

  /** ヒットした Object3D から親を辿って Interactable を解決 */
  resolve(hit: THREE.Object3D): Interactable | null {
    let cur: THREE.Object3D | null = hit
    while (cur) {
      const item = this.byObject.get(cur)
      if (item) return item
      cur = cur.parent
    }
    return null
  }
}

export const interactions = new InteractionRegistry()
