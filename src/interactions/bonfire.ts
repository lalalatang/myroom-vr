import * as THREE from 'three'
import type { AppContext, System, WorldRefs } from '../core/types'
import { interactions } from '../core/registry'
import { store } from '../core/state'
import { bus } from '../core/events'

/**
 * 焚き火(P1-9):
 * - interactions で焚き火をクリック可能に。夜(timeOfDay==='night')のみ点火可、夜以外は何もしない。
 *   点火で bonfireLit=true + sfx 'ignite'、再クリックで消火。
 * - 炎ビジュアル: 加算合成の Plane 3枚(カメラへビルボード)+ 上昇する火の粉(Points)。点火中のみ表示。
 * - 光(bonfireLight)は lighting 担当、パチパチ音は audio 担当なのでここでは扱わない。
 */
export function setupBonfire(ctx: AppContext, refs: WorldRefs): System {
  const root = refs.bonfire

  // -- クリックで点火/消火 --
  if (root) {
    interactions.add({
      object: root,
      label: '焚き火を点ける/消す',
      onSelect() {
        if (!store.state.bonfireLit) {
          if (store.state.timeOfDay !== 'night') return // 夜以外は点火不可
          store.set('bonfireLit', true)
          bus.emit('sfx', {
            name: 'ignite',
            position: root.getWorldPosition(new THREE.Vector3()),
          })
        } else {
          store.set('bonfireLit', false)
        }
      },
    })
  }

  // root が無ければビジュアルも配置できない(位置不明)ため no-op
  if (!root) return { update() {} }

  // -- 炎テクスチャ(canvas 生成、外部アセット不要) --
  const makeFlameTexture = (): THREE.CanvasTexture => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 40, 2, 32, 40, 30)
    grad.addColorStop(0.0, 'rgba(255,255,230,1)')
    grad.addColorStop(0.25, 'rgba(255,200,90,0.95)')
    grad.addColorStop(0.55, 'rgba(255,110,30,0.6)')
    grad.addColorStop(1.0, 'rgba(120,20,0,0)')
    g.fillStyle = grad
    // 涙滴形の炎
    g.beginPath()
    g.moveTo(32, 4)
    g.bezierCurveTo(52, 26, 52, 52, 32, 60)
    g.bezierCurveTo(12, 52, 12, 26, 32, 4)
    g.fill()
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }
  const flameTex = makeFlameTexture()

  const flameGroup = new THREE.Group()
  const basePos = root.getWorldPosition(new THREE.Vector3())
  flameGroup.position.copy(basePos)
  flameGroup.position.y += 0.35
  flameGroup.visible = false
  ctx.scene.add(flameGroup)

  const flames: THREE.Mesh[] = []
  const flameCount = 3
  for (let i = 0; i < flameCount; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: flameTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
      color: i === 0 ? 0xffe0a0 : 0xff7a20,
    })
    const w = 0.4 - i * 0.08
    const h = 0.6 - i * 0.12
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
    mesh.position.set((i - 1) * 0.05, i * 0.05, 0)
    flames.push(mesh)
    flameGroup.add(mesh)
  }

  // -- 火の粉(Points) --
  const sparkCount = 40
  const sparkPos = new Float32Array(sparkCount * 3)
  const sparkVel = new Float32Array(sparkCount * 3)
  const sparkLife = new Float32Array(sparkCount)
  const resetSpark = (i: number): void => {
    sparkPos[i * 3] = (Math.random() * 2 - 1) * 0.12
    sparkPos[i * 3 + 1] = Math.random() * 0.05
    sparkPos[i * 3 + 2] = (Math.random() * 2 - 1) * 0.12
    sparkVel[i * 3] = (Math.random() * 2 - 1) * 0.15
    sparkVel[i * 3 + 1] = 0.5 + Math.random() * 0.6
    sparkVel[i * 3 + 2] = (Math.random() * 2 - 1) * 0.15
    sparkLife[i] = 0.6 + Math.random() * 1.0
  }
  for (let i = 0; i < sparkCount; i++) resetSpark(i)
  const sparkGeo = new THREE.BufferGeometry()
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3))
  const sparkMat = new THREE.PointsMaterial({
    color: 0xff9030,
    size: 0.03,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })
  const sparks = new THREE.Points(sparkGeo, sparkMat)
  flameGroup.add(sparks)

  const _camQ = new THREE.Quaternion()
  let flicker = 0

  return {
    update(dt: number, elapsed: number): void {
      const lit = store.state.bonfireLit
      flameGroup.visible = lit
      if (!lit) return

      // カメラへビルボード
      ctx.camera.getWorldQuaternion(_camQ)
      flameGroup.quaternion.copy(_camQ)

      // 炎の揺らぎ
      flicker = 0.7 + 0.3 * Math.sin(elapsed * 13) * Math.sin(elapsed * 7.3)
      for (let i = 0; i < flames.length; i++) {
        const m = flames[i]
        const wob = Math.sin(elapsed * (6 + i * 2) + i) * 0.06
        m.scale.set(1 + wob * 0.5, flicker + wob, 1)
        const mat = m.material as THREE.MeshBasicMaterial
        mat.opacity = (0.7 + 0.3 * Math.random()) * (i === 0 ? 1 : 0.8)
      }

      // 火の粉の上昇
      for (let i = 0; i < sparkCount; i++) {
        sparkLife[i] -= dt
        if (sparkLife[i] <= 0) {
          resetSpark(i)
          continue
        }
        sparkPos[i * 3] += sparkVel[i * 3] * dt
        sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt
        sparkVel[i * 3 + 1] -= 0.2 * dt // わずかに減速
      }
      sparkGeo.attributes.position.needsUpdate = true
    },
  }
}
