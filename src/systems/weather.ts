import * as THREE from 'three'
import type { AppContext, System, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'
import { store } from '../core/state'

/**
 * 天候システム(P1-6): 晴れ/雨。
 *
 * - 雨: プレイヤー周囲(半径10m×高さ6m の円柱)に線分の雨粒。プレイヤーに追従し、
 *   屋根の下(書斎/縁側/土間の XZ)にはリスポーン時に再抽選して降らせない。
 * - 池の波紋: refs.pond があれば雨天時に水面へ拡大フェードするリングを使い回す。
 * - 減光は lighting に手を入れず scene.environmentIntensity を 0.6 倍に(晴れで復元)。
 * - 雨音は audio 担当(store 経由)なので触らない。
 *
 * ドローコール: 雨=1 + 波紋リング(最大6) = 最大7(予算 +10 以内)。
 */

const RAIN_COUNT = 1200 // 800〜1500 の範囲
const RAIN_RADIUS = 10
const RAIN_HEIGHT = 6
const RIPPLE_POOL = 6

// 屋根に覆われた領域(この XZ には雨粒を降らせない)
const ROOFED = [LAYOUT.MISE, LAYOUT.OKUNOMA]

function insideRoof(x: number, z: number): boolean {
  for (const r of ROOFED) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return true
  }
  return false
}

export function createWeather(ctx: AppContext, refs: WorldRefs): System {
  const { scene, player } = ctx

  // ---- 雨パーティクル(1本 = 2頂点の線分) ----
  const rainGroup = new THREE.Group()
  rainGroup.name = 'rain'
  rainGroup.visible = false
  scene.add(rainGroup)

  const positions = new Float32Array(RAIN_COUNT * 2 * 3)
  const ox = new Float32Array(RAIN_COUNT)
  const oz = new Float32Array(RAIN_COUNT)
  const oy = new Float32Array(RAIN_COUNT)
  const len = new Float32Array(RAIN_COUNT)
  const spd = new Float32Array(RAIN_COUNT)

  // プレイヤー相対の XZ を(屋根の下を避けて)再抽選
  function reroll(i: number): void {
    const px = player.position.x
    const pz = player.position.z
    let x = 0
    let z = 0
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = Math.sqrt(Math.random()) * RAIN_RADIUS
      const a = Math.random() * Math.PI * 2
      x = r * Math.cos(a)
      z = r * Math.sin(a)
      if (!insideRoof(px + x, pz + z)) break
    }
    ox[i] = x
    oz[i] = z
  }

  for (let i = 0; i < RAIN_COUNT; i++) {
    reroll(i)
    oy[i] = Math.random() * RAIN_HEIGHT
    len[i] = 0.25 + Math.random() * 0.3
    spd[i] = 8 + Math.random() * 4
  }

  const rainGeo = new THREE.BufferGeometry()
  const posAttr = new THREE.BufferAttribute(positions, 3)
  posAttr.setUsage(THREE.DynamicDrawUsage)
  rainGeo.setAttribute('position', posAttr)
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xaec4de,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    fog: false,
  })
  const rain = new THREE.LineSegments(rainGeo, rainMat)
  rain.frustumCulled = false
  rainGroup.add(rain)

  // ---- 池の波紋リング(使い回しプール) ----
  interface Ripple {
    mesh: THREE.Mesh
    mat: THREE.MeshBasicMaterial
    active: boolean
    age: number
    life: number
    delay: number
  }
  const ripples: Ripple[] = []
  let pondReady = false
  let pondY = 0
  let pondMinX = 0
  let pondMaxX = 0
  let pondMinZ = 0
  let pondMaxZ = 0

  if (refs.pond) {
    const box = new THREE.Box3().setFromObject(refs.pond)
    pondY = box.max.y + 0.005
    // 縁を少し内側に寄せてリングが水面からはみ出しにくくする
    const inset = 0.15
    pondMinX = box.min.x + inset
    pondMaxX = box.max.x - inset
    pondMinZ = box.min.z + inset
    pondMaxZ = box.max.z - inset
    if (pondMaxX > pondMinX && pondMaxZ > pondMinZ) {
      pondReady = true
      const ringGeo = new THREE.RingGeometry(0.5, 0.62, 20)
      for (let i = 0; i < RIPPLE_POOL; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xbcd6ee,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        })
        const mesh = new THREE.Mesh(ringGeo, mat)
        mesh.rotation.x = -Math.PI / 2
        mesh.visible = false
        mesh.renderOrder = 1
        scene.add(mesh)
        ripples.push({
          mesh,
          mat,
          active: false,
          age: 0,
          life: 1.0 + Math.random() * 0.6,
          delay: Math.random() * 1.2,
        })
      }
    }
  }

  function placeRipple(r: Ripple): void {
    r.mesh.position.set(
      pondMinX + Math.random() * (pondMaxX - pondMinX),
      pondY,
      pondMinZ + Math.random() * (pondMaxZ - pondMinZ),
    )
    r.age = 0
    r.active = true
    r.mesh.visible = true
  }

  // 雨天の減光は lighting システムが environmentIntensity を一元管理するためここでは扱わない

  function setRain(on: boolean): void {
    rainGroup.visible = on
    if (!on) {
      for (const r of ripples) {
        r.active = false
        r.mesh.visible = false
        r.mat.opacity = 0
      }
    }
  }

  // weather の変化に反応 + 初期状態を反映
  const unsub = store.on((state, changed) => {
    if (changed !== 'weather') return
    setRain(state.weather === 'rain')
  })
  void unsub
  setRain(store.state.weather === 'rain')

  return {
    update(dt: number) {
      if (store.state.weather !== 'rain') return

      // 雨粒: Y を落下させ、地面下に抜けたら上へ再投入(XZ 再抽選)
      const px = player.position.x
      const pz = player.position.z
      for (let i = 0; i < RAIN_COUNT; i++) {
        oy[i] -= spd[i] * dt
        if (oy[i] < 0) {
          reroll(i)
          oy[i] = RAIN_HEIGHT
          len[i] = 0.25 + Math.random() * 0.3
          spd[i] = 8 + Math.random() * 4
        }
        const idx = i * 6
        const x = ox[i]
        const z = oz[i]
        const yb = oy[i]
        positions[idx] = x
        positions[idx + 1] = yb + len[i]
        positions[idx + 2] = z
        positions[idx + 3] = x
        positions[idx + 4] = yb
        positions[idx + 5] = z
      }
      posAttr.needsUpdate = true
      rainGroup.position.set(px, 0, pz) // プレイヤー追従(XZ)

      // 池の波紋: 拡大 + フェード
      if (pondReady) {
        for (const r of ripples) {
          if (!r.active) {
            r.delay -= dt
            if (r.delay <= 0) placeRipple(r)
            continue
          }
          r.age += dt
          const s = r.age / r.life
          if (s >= 1) {
            r.active = false
            r.mesh.visible = false
            r.mat.opacity = 0
            r.delay = 0.15 + Math.random() * 1.0
            continue
          }
          const scale = 0.1 + s * 1.3
          r.mesh.scale.set(scale, scale, scale)
          r.mat.opacity = (1 - s) * 0.5
        }
      }
    },
  }
}
