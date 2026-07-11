import * as THREE from 'three'
import type { AppContext, System, WorldRefs } from '../core/types'

/**
 * VR移動: 左スティック前倒しで放物線アーク照準→離すとテレポート。右スティックでスナップターン45°。
 * - テレポートは上向き法線(normal.y > 0.7)の面のみ有効。無効時はアークを赤に。
 * - 回転/着地はいずれもカメラ(頭)のワールドXZを基準に player.position を補正する。
 * - テレポート瞬間に短い黒フェード(酔い対策)。
 */
const ARC_SPEED = 6 // 初速 m/s
const ARC_GRAVITY = 9.8 // 重力風の下向き加速
const ARC_STEP = 0.06 // 秒/セグメント
const ARC_MAX = 40 // 最大セグメント数
const ARC_VALID = 0x6fe38a
const ARC_INVALID = 0xff5a5a

const SNAP_ANGLE = Math.PI / 4 // 45°
const SNAP_COOLDOWN = 0.3
const SNAP_DEADZONE = 0.6
const AIM_DEADZONE = 0.6

const FADE_TIME = 0.22
const FADE_MAX_OPACITY = 0.85

export function createLocomotion(ctx: AppContext, refs: WorldRefs): System {
  const { renderer, player, camera, scene } = ctx
  const raycaster = new THREE.Raycaster()

  // --- 着地リング ---
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.22, 24),
    new THREE.MeshBasicMaterial({ color: ARC_VALID, transparent: true, opacity: 0.85 }),
  )
  marker.rotation.x = -Math.PI / 2
  marker.visible = false
  marker.frustumCulled = false
  scene.add(marker)

  // --- 放物線アーク(線分近似) ---
  const arcPos = new Float32Array(ARC_MAX * 3)
  const arcGeom = new THREE.BufferGeometry()
  arcGeom.setAttribute('position', new THREE.BufferAttribute(arcPos, 3))
  const arcMat = new THREE.LineBasicMaterial({ color: ARC_VALID, transparent: true, opacity: 0.85 })
  const arcLine = new THREE.Line(arcGeom, arcMat)
  arcLine.frustumCulled = false
  arcLine.visible = false
  scene.add(arcLine)

  // --- 酔い対策フェード(カメラ前の黒平面) ---
  const fadeMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const fadeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fadeMat)
  fadeMesh.position.set(0, 0, -0.1)
  fadeMesh.renderOrder = 999
  fadeMesh.frustumCulled = false
  fadeMesh.visible = false
  camera.add(fadeMesh)

  // --- 状態 ---
  let snapCooldown = 0
  let wasAiming = false
  let hasValid = false
  let fade = 0

  // --- ループ外に確保した一時オブジェクト ---
  const tmpMat = new THREE.Matrix4()
  const origin = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const cur = new THREE.Vector3()
  const prev = new THREE.Vector3()
  const segDir = new THREE.Vector3()
  const worldNormal = new THREE.Vector3()
  const landPoint = new THREE.Vector3()
  const validTarget = new THREE.Vector3()
  const head = new THREE.Vector3()

  function hideAim(): void {
    arcLine.visible = false
    marker.visible = false
  }

  function updateAim(ray: THREE.Object3D): void {
    tmpMat.identity().extractRotation(ray.matrixWorld)
    origin.setFromMatrixPosition(ray.matrixWorld)
    dir.set(0, 0, -1).applyMatrix4(tmpMat).normalize()

    prev.copy(origin)
    arcPos[0] = origin.x
    arcPos[1] = origin.y
    arcPos[2] = origin.z
    let count = 1
    let valid = false

    for (let step = 1; step < ARC_MAX; step++) {
      const t = step * ARC_STEP
      cur.set(
        origin.x + dir.x * ARC_SPEED * t,
        origin.y + dir.y * ARC_SPEED * t - 0.5 * ARC_GRAVITY * t * t,
        origin.z + dir.z * ARC_SPEED * t,
      )
      segDir.copy(cur).sub(prev)
      const len = segDir.length()
      if (len > 1e-4) {
        segDir.multiplyScalar(1 / len)
        raycaster.set(prev, segDir)
        raycaster.far = len
        const hit = raycaster.intersectObjects(refs.teleportSurfaces, true)[0]
        if (hit) {
          arcPos[count * 3] = hit.point.x
          arcPos[count * 3 + 1] = hit.point.y
          arcPos[count * 3 + 2] = hit.point.z
          count++
          if (hit.face) {
            worldNormal
              .copy(hit.face.normal)
              .transformDirection(hit.object.matrixWorld)
              .normalize()
            valid = worldNormal.y > 0.7
          }
          if (valid) landPoint.copy(hit.point)
          break
        }
      }
      arcPos[count * 3] = cur.x
      arcPos[count * 3 + 1] = cur.y
      arcPos[count * 3 + 2] = cur.z
      count++
      prev.copy(cur)
    }

    arcGeom.setDrawRange(0, count)
    ;(arcGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true
    arcMat.color.setHex(valid ? ARC_VALID : ARC_INVALID)
    arcLine.visible = true

    hasValid = valid
    if (valid) {
      validTarget.copy(landPoint)
      marker.position.set(landPoint.x, landPoint.y + 0.02, landPoint.z)
      marker.visible = true
    } else {
      marker.visible = false
    }
  }

  /** カメラ(頭)のワールドXZを軸に player を θ 回転(頭の位置がずれないよう position を補正) */
  function snapTurn(theta: number): void {
    camera.getWorldPosition(head)
    const ox = head.x - player.position.x
    const oz = head.z - player.position.z
    const c = Math.cos(theta)
    const s = Math.sin(theta)
    // Three の +Y 回転: x' = c*x + s*z, z' = -s*x + c*z
    const rx = c * ox + s * oz
    const rz = -s * ox + c * oz
    player.position.x = head.x - rx
    player.position.z = head.z - rz
    player.rotation.y += theta
  }

  /** 着地点にカメラ(頭)のXZが来るよう player.position を補正してテレポート */
  function doTeleport(target: THREE.Vector3): void {
    camera.getWorldPosition(head)
    const offX = head.x - player.position.x
    const offZ = head.z - player.position.z
    player.position.x = target.x - offX
    player.position.z = target.z - offZ
    player.position.y = target.y
    fade = 1 // 到着時に黒からフェードイン
  }

  return {
    update(dt) {
      // フェード減衰
      if (fade > 0) {
        fade = Math.max(0, fade - dt / FADE_TIME)
        fadeMat.opacity = fade * FADE_MAX_OPACITY
        fadeMesh.visible = fade > 0
      }

      snapCooldown = Math.max(0, snapCooldown - dt)
      const session = renderer.xr.getSession()
      if (!session || !ctx.xr) {
        hideAim()
        wasAiming = false
        hasValid = false
        return
      }

      let aimingNow = false
      let leftRay: THREE.Object3D | null = null

      for (const source of session.inputSources) {
        const gp = source.gamepad
        if (!gp) continue
        const ax = gp.axes[2] ?? 0
        const ay = gp.axes[3] ?? 0
        const idx = ctx.xr.handedness.findIndex((h) => h === source.handedness)
        const ray = idx >= 0 ? ctx.xr.raySpaces[idx] : null

        if (source.handedness === 'left' && ray) {
          if (ay < -AIM_DEADZONE) {
            aimingNow = true
            leftRay = ray
          }
        } else if (source.handedness === 'right') {
          if (Math.abs(ax) > SNAP_DEADZONE && snapCooldown === 0) {
            snapTurn(-Math.sign(ax) * SNAP_ANGLE)
            snapCooldown = SNAP_COOLDOWN
          }
        }
      }

      if (aimingNow && leftRay) {
        updateAim(leftRay)
      } else {
        hideAim()
      }

      // スティックを離した瞬間に有効な着地点へテレポート
      if (wasAiming && !aimingNow && hasValid) {
        doTeleport(validTarget)
      }
      if (!aimingNow) hasValid = false
      wasAiming = aimingNow
    },
  }
}
