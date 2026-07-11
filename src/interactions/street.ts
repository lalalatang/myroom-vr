import * as THREE from 'three'
import type { AppContext, System, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'
import { interactions } from '../core/registry'
import { store } from '../core/state'
import { bus } from '../core/events'

/**
 * 通りの仕掛け一式(v2)。すべて refs が無ければ該当分だけ no-op。
 * - 井戸(P1): 釣瓶('tsurube')をクリック → 1.5m 落下(0.6s)→ 水音 → 2s で戻る。動作中は再クリック無効
 * - 蕎麦屋台: 'steamAnchor' から湯気(半透明白のPlaneプール、上昇+拡大+フェード)。常時
 * - 木戸(P1): 夜は 'kidoGate' がヒンジ90°で閉まる(3s)、夜以外は開ける
 * - 小銭投げ(P1): デスクトップ=Cキー / VR=squeezestart。前方へ初速4.5m/sの放物線。
 *   着地で 'coin'、refs.coinTarget のバウンディングボックス命中で 'coinTarget'。5枚プール。
 * - 暖簾のはためき: 布メッシュ頂点を波打たせる(下端ほど振幅大)
 * - 提灯の揺れ: lampFixtures.chochin の各子を振り子回転(rotation.z、位相差)
 */
export function setupStreet(ctx: AppContext, refs: WorldRefs): System {
  const updaters: ((dt: number, elapsed: number) => void)[] = []
  const easeInOut = (u: number): number =>
    u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2

  // ---------------------------------------------------------------------
  // 井戸(P1): 釣瓶の落下 → 水音 → 復帰
  // ---------------------------------------------------------------------
  {
    const well = refs.well
    const tsurube = well?.getObjectByName('tsurube') as THREE.Object3D | undefined
    if (well && tsurube) {
      const restY = tsurube.position.y
      const DROP = 1.5
      const DROP_T = 0.6
      const RISE_T = 2.0
      const wellPos = well.getWorldPosition(new THREE.Vector3())
      let phase: 'idle' | 'drop' | 'wait' | 'rise' = 'idle'
      let tacc = 0

      interactions.add({
        object: tsurube,
        label: '釣瓶を落とす',
        onSelect() {
          if (phase !== 'idle') return // 動作中は再クリック無効
          phase = 'drop'
          tacc = 0
        },
      })

      updaters.push((dt) => {
        if (phase === 'idle') return
        tacc += dt
        if (phase === 'drop') {
          const u = Math.min(1, tacc / DROP_T)
          tsurube.position.y = restY - DROP * easeInOut(u)
          if (u >= 1) {
            phase = 'wait'
            tacc = 0
            bus.emit('sfx', {
              name: 'splash',
              position: new THREE.Vector3(wellPos.x, 0.2, wellPos.z),
            })
          }
        } else if (phase === 'wait') {
          if (tacc >= 0.4) {
            phase = 'rise'
            tacc = 0
          }
        } else {
          const u = Math.min(1, tacc / RISE_T)
          tsurube.position.y = restY - DROP * (1 - easeInOut(u))
          if (u >= 1) {
            tsurube.position.y = restY
            phase = 'idle'
          }
        }
      })
    }
  }

  // ---------------------------------------------------------------------
  // 蕎麦屋台の湯気(半透明白のPlaneプール、上昇+拡大+フェード)
  // ---------------------------------------------------------------------
  {
    const anchor = refs.yatai?.getObjectByName('steamAnchor') as THREE.Object3D | undefined
    if (anchor) {
      const anchorPos = anchor.getWorldPosition(new THREE.Vector3())
      // ソフトな白い放射状テクスチャ(canvas 生成、外部アセット不要)
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 64
      const g2d = c.getContext('2d')!
      const grad = g2d.createRadialGradient(32, 32, 2, 32, 32, 30)
      grad.addColorStop(0, 'rgba(255,255,255,0.9)')
      grad.addColorStop(0.5, 'rgba(255,255,255,0.4)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g2d.fillStyle = grad
      g2d.fillRect(0, 0, 64, 64)
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace

      const N = 6
      const geo = new THREE.PlaneGeometry(0.3, 0.3)
      interface Puff {
        mesh: THREE.Mesh
        life: number
        ttl: number
        vy: number
      }
      const puffs: Puff[] = []
      for (let i = 0; i < N; i++) {
        // 加算合成はしない(白っぽく)= 通常のアルファブレンド
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          color: 0xffffff,
        })
        const m = new THREE.Mesh(geo, mat)
        m.position.copy(anchorPos)
        m.visible = false
        m.frustumCulled = false
        ctx.scene.add(m)
        puffs.push({ mesh: m, life: 0, ttl: 0, vy: 0 })
      }

      let spawnT = 0
      const _q = new THREE.Quaternion()
      updaters.push((dt) => {
        ctx.camera.getWorldQuaternion(_q)
        spawnT -= dt
        if (spawnT <= 0) {
          const p = puffs.find((pp) => !pp.mesh.visible)
          if (p) {
            p.mesh.visible = true
            p.life = 0
            p.ttl = 2.2 + Math.random() * 0.8
            p.vy = 0.25 + Math.random() * 0.15
            p.mesh.position.set(
              anchorPos.x + (Math.random() * 2 - 1) * 0.08,
              anchorPos.y,
              anchorPos.z + (Math.random() * 2 - 1) * 0.08,
            )
          }
          spawnT = 0.5 + Math.random() * 0.4
        }
        for (const p of puffs) {
          if (!p.mesh.visible) continue
          p.life += dt
          const u = p.life / p.ttl
          if (u >= 1) {
            p.mesh.visible = false
            continue
          }
          p.mesh.position.y += p.vy * dt
          const sc = 0.3 + u * 0.9
          p.mesh.scale.set(sc, sc, sc)
          p.mesh.quaternion.copy(_q) // カメラへビルボード
          ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(u * Math.PI) * 0.5
        }
      })
    }
  }

  // ---------------------------------------------------------------------
  // 木戸(P1): 夜は閉まる(ヒンジ90°、3s)
  // ---------------------------------------------------------------------
  {
    const kido = refs.kido
    const gate = kido?.getObjectByName('kidoGate') as THREE.Object3D | undefined
    if (kido && gate) {
      const openRot = gate.rotation.y
      const closedRot = openRot - Math.PI / 2
      let target = store.state.timeOfDay === 'night' ? closedRot : openRot
      gate.rotation.y = target // 初期状態を即反映
      const SPEED = Math.PI / 2 / 3 // 90° / 3s
      store.on((s, changed) => {
        if (changed === 'timeOfDay') target = s.timeOfDay === 'night' ? closedRot : openRot
      })
      updaters.push((dt) => {
        const diff = target - gate.rotation.y
        if (Math.abs(diff) > 1e-4) {
          gate.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), SPEED * dt)
        }
      })
    }
  }

  // ---------------------------------------------------------------------
  // 小銭投げ(P1): C(デスクトップ) / squeezestart(VR)。放物線、着地音、賽銭命中音
  // ---------------------------------------------------------------------
  {
    const coinN = 5
    const coinGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.008, 12)
    const coinMat = new THREE.MeshStandardMaterial({
      color: 0xd9b84a,
      metalness: 0.9,
      roughness: 0.35,
    })
    interface Coin {
      mesh: THREE.Mesh
      vel: THREE.Vector3
      active: boolean
      landed: boolean
      hitTarget: boolean
      hideAt: number
    }
    const coins: Coin[] = []
    for (let i = 0; i < coinN; i++) {
      const m = new THREE.Mesh(coinGeo, coinMat)
      m.visible = false
      ctx.scene.add(m)
      coins.push({
        mesh: m,
        vel: new THREE.Vector3(),
        active: false,
        landed: false,
        hitTarget: false,
        hideAt: 0,
      })
    }

    // 賽銭的の静的バウンディングボックス(移動しない前提で一度だけ計算)
    let targetBox: THREE.Box3 | null = null
    if (refs.coinTarget) {
      refs.coinTarget.updateWorldMatrix(true, false)
      targetBox = new THREE.Box3().setFromObject(refs.coinTarget)
    }

    const _origin = new THREE.Vector3()
    const _quat = new THREE.Quaternion()
    const _dir = new THREE.Vector3()
    const forwardOf = (obj: THREE.Object3D): THREE.Vector3 => {
      obj.getWorldQuaternion(_quat)
      return _dir.set(0, 0, -1).applyQuaternion(_quat) // カメラ/コントローラ共に前方=-Z
    }
    const throwCoin = (origin: THREE.Vector3, dir: THREE.Vector3): void => {
      const c = coins.find((x) => !x.active)
      if (!c) return
      c.active = true
      c.landed = false
      c.hitTarget = false
      c.mesh.visible = true
      c.mesh.position.copy(origin)
      const d = dir.clone().normalize()
      d.y += 0.35 // やや上向きに放る
      d.normalize()
      c.vel.copy(d).multiplyScalar(4.5)
    }

    // デスクトップ: Cキー
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyC' || ctx.renderer.xr.isPresenting) return
      ctx.camera.getWorldPosition(_origin)
      throwCoin(_origin, forwardOf(ctx.camera))
    })
    // VR: squeezestart(各コントローラのレイ空間)。Group 型に XR イベントが無いためキャスト
    if (ctx.xr) {
      for (const ray of ctx.xr.raySpaces) {
        ;(ray as unknown as { addEventListener(t: string, cb: () => void): void }).addEventListener(
          'squeezestart',
          () => {
            ray.getWorldPosition(_origin)
            throwCoin(_origin, forwardOf(ray))
          },
        )
      }
    }

    updaters.push((_dt, elapsed) => {
      for (const c of coins) {
        if (!c.active) continue
        if (!c.landed) {
          c.vel.y -= 9.8 * _dt
          c.mesh.position.addScaledVector(c.vel, _dt)
          c.mesh.rotation.x += 6 * _dt
          c.mesh.rotation.z += 4 * _dt
          // 賽銭的への命中判定
          if (targetBox && !c.hitTarget && targetBox.containsPoint(c.mesh.position)) {
            c.hitTarget = true
            c.landed = true
            c.hideAt = elapsed + 1.5
            bus.emit('sfx', { name: 'coinTarget', position: c.mesh.position.clone() })
          } else if (c.mesh.position.y <= 0.02) {
            c.mesh.position.y = 0.02
            c.landed = true
            c.hideAt = elapsed + 1.5
            bus.emit('sfx', { name: 'coin', position: c.mesh.position.clone() })
          }
        } else if (elapsed >= c.hideAt) {
          c.active = false
          c.mesh.visible = false
        }
      }
    })
  }

  // ---------------------------------------------------------------------
  // 暖簾のはためき(布メッシュ頂点を波打たせる。下端ほど振幅大)
  // ---------------------------------------------------------------------
  {
    interface Cloth {
      geo: THREE.BufferGeometry
      base: Float32Array
      minY: number
      maxY: number
      phase: number
    }
    const cloths: Cloth[] = []
    for (const n of refs.noren ?? []) {
      n.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const geo = mesh.geometry as THREE.BufferGeometry
        const pos = geo.attributes.position as THREE.BufferAttribute
        if (!pos) return
        const base = new Float32Array(pos.array as ArrayLike<number>)
        let minY = Infinity
        let maxY = -Infinity
        for (let i = 0; i < pos.count; i++) {
          const y = base[i * 3 + 1]
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
        cloths.push({ geo, base, minY, maxY, phase: Math.random() * Math.PI * 2 })
      })
    }
    if (cloths.length) {
      updaters.push((_dt, elapsed) => {
        for (const cl of cloths) {
          const pos = cl.geo.attributes.position as THREE.BufferAttribute
          const arr = pos.array as Float32Array
          const span = cl.maxY - cl.minY || 1
          for (let i = 0; i < pos.count; i++) {
            const bx = cl.base[i * 3]
            const by = cl.base[i * 3 + 1]
            const amp = (cl.maxY - by) / span // 0=上端, 1=下端
            const wave =
              Math.sin(elapsed * 2.5 + cl.phase + bx * 3) * 0.05 +
              Math.sin(elapsed * 1.7 + cl.phase * 1.3 + by * 2) * 0.03
            arr[i * 3] = bx
            arr[i * 3 + 1] = by
            arr[i * 3 + 2] = cl.base[i * 3 + 2] + wave * amp
          }
          pos.needsUpdate = true
        }
      })
    }
  }

  // ---------------------------------------------------------------------
  // 提灯の揺れ(chochin Group の各子を振り子回転)
  // ---------------------------------------------------------------------
  {
    const chochin = refs.lampFixtures.chochin
    if (chochin && chochin.children.length) {
      const items = chochin.children.map((obj) => ({
        obj,
        phase: Math.random() * Math.PI * 2,
        base: obj.rotation.z,
      }))
      updaters.push((_dt, elapsed) => {
        for (const it of items) {
          it.obj.rotation.z = it.base + Math.sin(elapsed * 1.3 + it.phase) * 0.08
        }
      })
    }
  }

  return {
    update(dt, elapsed) {
      for (const u of updaters) u(dt, elapsed)
    },
  }
}
