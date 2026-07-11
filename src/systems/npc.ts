import * as THREE from 'three'
import { mergeAll } from '../world/geo'
import type { AppContext, System, WorldRefs } from '../core/types'
import { LAYOUT } from '../core/layout'
import { store } from '../core/state'

/**
 * 賑わい第2層: 通りを歩く町人(v2「江戸の町」)。
 *
 * - 20体(晴天・昼)。雨天は7体、夜は半減(10体)、両方なら7体に。
 *   減らすときはプレイヤーから遠い個体から消す(切替は即時)。
 * - 見た目: 藍・茶・鼠・柿・海老茶など町人色の着物シルエット(裾広がりの角錐台+肩の示唆)+
 *   頭(八面体)+髷(小突起)。1体 ≈ 60トライ、顔は作らない。男女は高さと髷で示唆。
 * - 実装: InstancedMesh 2個(体+頭)。毎フレーム各インスタンスの Matrix4 を dummy 使い回しで更新し、
 *   instanceMatrix.needsUpdate は 1回/フレーム。毎フレームのアロケーションなし。ドローコール +2。
 * - 動き: 17体が通り(x∈[-26,28]帯 / z∈[-2.2,2.2]レーン)を東西に歩き端で折返し。歩行ボビング+左右ロール。
 *   3体は路地(LAYOUT.ALLEY)入口付近で立ち話(その場で向かい合って揺れる)。
 * - 会釈: プレイヤーに1.3m以内へ入った歩行者は立ち止まり体を前傾(~12°)して会釈。離れると歩行再開。
 *   同時に会釈するのは近い2体まで。
 */

const N_TOTAL = 20
const N_CHATTERS = 3
const N_WALKERS = N_TOTAL - N_CHATTERS

const RAIN_COUNT = 7 // 雨天時の人数
const NIGHT_COUNT = 10 // 夜の人数(半減)

// 歩行帯(refs.npcPathXRange が無いときの折返し範囲)
const DEFAULT_X_RANGE: [number, number] = [-26, 28]
const LANE_MIN_Z = -2.2
const LANE_MAX_Z = 2.2

// 江戸の町人色(藍・茶・鼠・柿・海老茶・鉄紺・黄櫨・褐色)
const KIMONO_COLORS = [
  0x2e4b63, // 藍
  0x6b4a2b, // 茶
  0x7a756c, // 鼠
  0xb85c2a, // 柿
  0x6d2f2c, // 海老茶
  0x35485a, // 鉄紺
  0x8a6a3a, // 黄櫨
  0x4a4038, // 褐色
]

const HAIR_COLOR = 0x40342a // 髪・髷(暗い墨茶)

const BOW_RADIUS = 1.3 // 会釈が起きる距離
const BOW_MAX_ANGLE = THREE.MathUtils.degToRad(12) // 前傾角
// 同時に会釈するのは近い2体まで(下の bow0/bow1 で最近傍2体のみ選定)

// 路地(立ち話)の中心。ALLEY 入口(通り側)付近
const CHAT_CENTER = new THREE.Vector3(
  (LAYOUT.ALLEY.minX + LAYOUT.ALLEY.maxX) / 2,
  0,
  LAYOUT.ALLEY.minZ + 0.6,
)

interface Agent {
  chatter: boolean
  active: boolean
  // 位置
  x: number
  z: number
  // 歩行者
  dir: number // +1=東 / -1=西
  speed: number // m/s
  bobFreq: number // ボビング角速度
  phase: number // 個体ごとの位相
  // 会釈
  bow: number // 0..1(補間中の会釈量)
  // 立ち話の向き(中心へのオフセット角)
  faceCenter: number
  // 見た目
  heightScale: number
  colorIndex: number
}

export function createNpc(ctx: AppContext, refs: WorldRefs): System {
  const { scene, player } = ctx

  const [minX, maxX] = refs.npcPathXRange ?? DEFAULT_X_RANGE

  // ---- ジオメトリ(全て自前・ローポリ) ----
  // 体: 裾広がりの角錐台(着物)+ 肩の示唆(薄い箱)。基準身長 1.6m、足元 y=0。
  const kimono = new THREE.CylinderGeometry(0.14, 0.21, 1.4, 8, 1)
  kimono.translate(0, 0.7, 0)
  const shoulder = new THREE.BoxGeometry(0.34, 0.08, 0.19)
  shoulder.translate(0, 1.36, 0)
  const bodyGeo = mergeAll([kimono, shoulder])!
  kimono.dispose()
  shoulder.dispose()

  // 頭: 八面体 + 髷(小さな突起)。体と同じローカル座標系(足元 y=0 基準)に配置。
  const head = new THREE.SphereGeometry(0.095, 8, 6)
  head.scale(1, 1.16, 1)
  head.translate(0, 1.5, 0)
  const mage = new THREE.ConeGeometry(0.03, 0.055, 5)
  mage.translate(0, 1.63, -0.02)
  const headGeo = mergeAll([head, mage])!
  head.dispose()
  mage.dispose()

  // ---- マテリアル ----
  // 体は白ベース + instanceColor で町人色を掛ける。頭は一律の髪色。
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
  })
  const headMat = new THREE.MeshStandardMaterial({
    color: HAIR_COLOR,
    roughness: 0.85,
    metalness: 0.0,
  })

  const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, N_TOTAL)
  const headMesh = new THREE.InstancedMesh(headGeo, headMat, N_TOTAL)
  bodyMesh.name = 'npcBody'
  headMesh.name = 'npcHead'
  // インスタンスは移動するのでバウンディングによる誤カリングを避ける(DCは2のまま)
  bodyMesh.frustumCulled = false
  headMesh.frustumCulled = false
  bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(bodyMesh, headMesh)

  // ---- エージェント初期化 ----
  const agents: Agent[] = []
  const rng = mulberry32(0x9e3779b9) // 決定論的(見た目の再現性)

  // 立ち話(3体): 中心を囲んで向かい合う
  for (let i = 0; i < N_CHATTERS; i++) {
    const a = (i / N_CHATTERS) * Math.PI * 2
    const r = 0.42
    agents.push({
      chatter: true,
      active: true,
      x: CHAT_CENTER.x + Math.cos(a) * r,
      z: CHAT_CENTER.z + Math.sin(a) * r,
      dir: 1,
      speed: 0,
      bobFreq: 1.0 + rng() * 0.6,
      phase: rng() * Math.PI * 2,
      bow: 0,
      faceCenter: 0,
      heightScale: (1.5 + rng() * 0.2) / 1.6,
      colorIndex: Math.floor(rng() * KIMONO_COLORS.length),
    })
  }

  // 歩行者(17体): レーン(z)と位相を散らす
  for (let i = 0; i < N_WALKERS; i++) {
    const laneT = (i + 0.5) / N_WALKERS
    const z =
      LANE_MIN_Z + laneT * (LANE_MAX_Z - LANE_MIN_Z) + (rng() - 0.5) * 0.3
    const speed = 0.5 + rng() * 0.4
    agents.push({
      chatter: false,
      active: true,
      x: minX + rng() * (maxX - minX),
      z: THREE.MathUtils.clamp(z, LANE_MIN_Z, LANE_MAX_Z),
      dir: rng() < 0.5 ? 1 : -1,
      speed,
      bobFreq: 4 + speed * 4,
      phase: rng() * Math.PI * 2,
      bow: 0,
      faceCenter: 0,
      heightScale: (1.5 + rng() * 0.2) / 1.6,
      colorIndex: Math.floor(rng() * KIMONO_COLORS.length),
    })
  }

  // ---- 色(instanceColor)を一度だけ設定 ----
  const tmpColor = new THREE.Color()
  for (let i = 0; i < agents.length; i++) {
    tmpColor.setHex(KIMONO_COLORS[agents[i].colorIndex])
    bodyMesh.setColorAt(i, tmpColor)
  }
  bodyMesh.instanceColor!.needsUpdate = true

  // ---- 使い回しオブジェクト(毎フレームのアロケーション禁止) ----
  const dummy = new THREE.Object3D()
  const qBow = new THREE.Quaternion()
  const qRoll = new THREE.Quaternion()
  const bowAxis = new THREE.Vector3()
  const X_AXIS = new THREE.Vector3(1, 0, 0)
  const HIDDEN_SCALE = 0.0001

  // ---- 人数制御(遠い個体から消す) ----
  const order = agents.map((_, i) => i) // 距離ソート用の使い回し配列

  function targetCount(): number {
    let n = N_TOTAL
    if (store.state.timeOfDay === 'night') n = NIGHT_COUNT
    if (store.state.weather === 'rain') n = Math.min(n, RAIN_COUNT)
    return n
  }

  function applyVisibility(): void {
    const n = targetCount()
    const px = player.position.x
    const pz = player.position.z
    // プレイヤーからの距離昇順に並べ替え、近い n 体だけ active に
    order.sort((ia, ib) => {
      const a = agents[ia]
      const b = agents[ib]
      const da = (a.x - px) * (a.x - px) + (a.z - pz) * (a.z - pz)
      const db = (b.x - px) * (b.x - px) + (b.z - pz) * (b.z - pz)
      return da - db
    })
    for (let k = 0; k < order.length; k++) {
      agents[order[k]].active = k < n
    }
  }

  const unsub = store.on((_state, changed) => {
    if (changed === 'weather' || changed === 'timeOfDay') applyVisibility()
  })
  void unsub
  applyVisibility()

  return {
    update(dt: number, elapsed: number) {
      const px = player.position.x
      const pz = player.position.z

      // --- 会釈対象の選定: 1.3m以内の歩行者から近い2体 ---
      let bow0 = -1
      let bow1 = -1
      let d0 = Infinity
      let d1 = Infinity
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i]
        if (a.chatter || !a.active) continue
        const dx = a.x - px
        const dz = a.z - pz
        const d = dx * dx + dz * dz
        if (d > BOW_RADIUS * BOW_RADIUS) continue
        if (d < d0) {
          d1 = d0
          bow1 = bow0
          d0 = d
          bow0 = i
        } else if (d < d1) {
          d1 = d
          bow1 = i
        }
      }

      for (let i = 0; i < agents.length; i++) {
        const a = agents[i]

        if (!a.active) {
          // 非表示: スケール0で描画上消す
          dummy.position.set(a.x, -5, a.z)
          dummy.quaternion.identity()
          dummy.scale.setScalar(HIDDEN_SCALE)
          dummy.updateMatrix()
          bodyMesh.setMatrixAt(i, dummy.matrix)
          headMesh.setMatrixAt(i, dummy.matrix)
          continue
        }

        if (a.chatter) {
          // 立ち話: その場で中心へわずかに傾き揺れる
          const sway = Math.sin(elapsed * 0.8 + a.phase) * 0.045
          const bob = Math.sin(elapsed * 1.3 + a.phase) * 0.008
          // 中心方向へ前傾(会話に身を寄せる示唆)
          const dxc = CHAT_CENTER.x - a.x
          const dzc = CHAT_CENTER.z - a.z
          const invc = 1 / Math.max(1e-4, Math.hypot(dxc, dzc))
          const ndx = dxc * invc
          const ndz = dzc * invc
          bowAxis.set(ndz, 0, -ndx)
          qBow.setFromAxisAngle(bowAxis, 0.09 + sway)
          dummy.position.set(a.x, bob, a.z)
          dummy.quaternion.copy(qBow)
          dummy.scale.set(1, a.heightScale, 1)
          dummy.updateMatrix()
          bodyMesh.setMatrixAt(i, dummy.matrix)
          headMesh.setMatrixAt(i, dummy.matrix)
          continue
        }

        // --- 歩行者 ---
        // 会釈量を補間(選ばれていれば1へ、そうでなければ0へ)
        const bowTarget = i === bow0 || i === bow1 ? 1 : 0
        a.bow += (bowTarget - a.bow) * Math.min(1, dt * 6)
        if (a.bow < 0.001) a.bow = 0

        const moveScale = 1 - a.bow // 会釈中は減速して停止
        a.x += a.dir * a.speed * moveScale * dt

        // 端で折返し(対称形状なのでスナップは目立たない)
        if (a.x > maxX) {
          a.x = maxX
          a.dir = -1
        } else if (a.x < minX) {
          a.x = minX
          a.dir = 1
        }

        // ボビング(上下)+ 左右ロール。歩行速度に応じて位相を進める
        a.phase += dt * a.bobFreq * (0.3 + 0.7 * moveScale)
        const bobY = Math.sin(a.phase) * 0.017 * (0.3 + 0.7 * moveScale)
        const roll = Math.sin(a.phase) * 0.035 * moveScale

        // 進行方向(x軸)まわりのロール = 左右の揺れ
        qRoll.setFromAxisAngle(X_AXIS, roll)

        // 会釈: プレイヤー方向へ前傾
        if (a.bow > 0.001) {
          const dxp = px - a.x
          const dzp = pz - a.z
          const invp = 1 / Math.max(1e-4, Math.hypot(dxp, dzp))
          bowAxis.set(dzp * invp, 0, -dxp * invp)
          qBow.setFromAxisAngle(bowAxis, a.bow * BOW_MAX_ANGLE)
          dummy.quaternion.copy(qBow).multiply(qRoll)
        } else {
          dummy.quaternion.copy(qRoll)
        }

        dummy.position.set(a.x, bobY, a.z)
        dummy.scale.set(1, a.heightScale, 1)
        dummy.updateMatrix()
        bodyMesh.setMatrixAt(i, dummy.matrix)
        headMesh.setMatrixAt(i, dummy.matrix)
      }

      // 行列更新のフラグは 1回/フレーム(2メッシュぶん)
      bodyMesh.instanceMatrix.needsUpdate = true
      headMesh.instanceMatrix.needsUpdate = true
    },
  }
}

/** 決定論的な擬似乱数(見た目の再現性のため。外部依存なし) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
