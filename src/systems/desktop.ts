import * as THREE from 'three'
import type { AppContext, System, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'
import { interactions } from '../core/registry'
import { store } from '../core/state'

/**
 * デスクトップフォールバック(開発検証用): PointerLock + WASD + クリックで仕掛け操作。
 * 高さは walkable 面への下向きレイキャストで追従(縁側の段差対応)。
 * ショートカット: 1-4 = 朝/昼/夕/夜, R = 天候切替。
 * TODO(opus-xr): 慣性・ヒント表示の磨き込み(基本動作は実装済み)。
 */
export function createDesktopControls(ctx: AppContext, refs: WorldRefs): System {
  const { camera, player, renderer } = ctx
  const keys = new Set<string>()
  let locked = false
  let yaw = player.rotation.y
  let pitch = 0

  const crosshair = document.getElementById('crosshair')
  const hint = document.getElementById('hint')
  const canvas = renderer.domElement

  canvas.addEventListener('click', () => {
    if (renderer.xr.isPresenting) return
    if (!locked) canvas.requestPointerLock()
  })
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas
    if (crosshair) crosshair.style.display = locked ? 'block' : 'none'
    if (!locked && hint) hint.style.display = 'none'
  })
  document.addEventListener('mousemove', (e) => {
    if (!locked) return
    yaw -= e.movementX * 0.002
    pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.002, -1.4, 1.4)
  })
  document.addEventListener('mousedown', (e) => {
    if (!locked || e.button !== 0) return
    const hit = raycastCenter()
    hit?.onSelect()
  })
  document.addEventListener('keydown', (e) => {
    keys.add(e.code)
    const tod = ({ Digit1: 'morning', Digit2: 'noon', Digit3: 'evening', Digit4: 'night' } as const)[
      e.code as 'Digit1'
    ]
    if (tod) store.set('timeOfDay', tod)
    if (e.code === 'KeyR') store.set('weather', store.state.weather === 'clear' ? 'rain' : 'clear')
  })
  document.addEventListener('keyup', (e) => keys.delete(e.code))

  const raycaster = new THREE.Raycaster()
  raycaster.far = 5
  function raycastCenter() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
    const hits = raycaster.intersectObjects(interactions.targets, true)
    return hits.length ? interactions.resolve(hits[0].object) : null
  }

  const down = new THREE.Raycaster()
  const wish = new THREE.Vector3() // 入力から決まる目標速度
  const vel = new THREE.Vector3() // 現在の水平速度(慣性)
  const fwd = new THREE.Vector3()
  const right = new THREE.Vector3()

  return {
    update(dt) {
      if (renderer.xr.isPresenting || !locked) return

      // 視点
      player.rotation.y = yaw
      camera.rotation.set(pitch, 0, 0)

      // 移動(カメラ基準の水平移動)。目標速度へ加速/減速して慣性を出す。
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw))
      right.set(fwd.z, 0, -fwd.x)
      wish.set(0, 0, 0)
      if (keys.has('KeyW')) wish.add(fwd)
      if (keys.has('KeyS')) wish.sub(fwd)
      if (keys.has('KeyA')) wish.sub(right)
      if (keys.has('KeyD')) wish.add(right)
      const moving = wish.lengthSq() > 0
      if (moving) wish.normalize().multiplyScalar(keys.has('ShiftLeft') ? 4 : 2)
      // 入力中は素早く、放したときはやや緩やかに減速
      const rate = 1 - Math.exp(-(moving ? 12 : 8) * dt)
      vel.x += (wish.x - vel.x) * rate
      vel.z += (wish.z - vel.z) * rate
      if (vel.lengthSq() > 1e-8) {
        const nx = player.position.x + vel.x * dt
        const nz = player.position.z + vel.z * dt
        // 歩行可能な外周(LAYOUT.BOUNDS)の外へは出さない
        const b = LAYOUT.BOUNDS
        if (nx > b.minX && nx < b.maxX && nz > b.minZ && nz < b.maxZ) {
          player.position.x = nx
          player.position.z = nz
        } else {
          vel.set(0, 0, 0)
        }
      }

      // 接地(walkable面へスナップ)
      down.set(
        new THREE.Vector3(player.position.x, player.position.y + 1.2, player.position.z),
        new THREE.Vector3(0, -1, 0),
      )
      down.far = 3
      const ground = down.intersectObjects(refs.teleportSurfaces, true)[0]
      if (ground) {
        const targetY = ground.point.y
        player.position.y += (targetY - player.position.y) * Math.min(1, dt * 10)
      }
      camera.position.y = LAYOUT.EYE_HEIGHT

      // ホバーヒント
      if (hint) {
        const item = raycastCenter()
        hint.style.display = item?.label ? 'block' : 'none'
        if (item?.label) hint.textContent = item.label
      }
    },
  }
}
