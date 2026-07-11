import * as THREE from 'three'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import type {
  AppContext,
  LampId,
  System,
  TimeOfDay,
  WorldRefs,
} from '../core/types'
import { store } from '../core/state'

/**
 * 昼夜サイクル+照明の一元管理(P0-2 の核)。
 *
 * - HDRI(public/hdri/{morning,noon,evening,night}.hdr)を遅延ロード+キャッシュし、
 *   scene.environment / scene.background に適用。初回は現在の timeOfDay のみ、
 *   残りは切替時かアイドル時にプリロードする。
 * - HDRI が無い/失敗しても、時間帯ごとの空グラデーション(スカイドーム)+
 *   HemisphereLight/DirectionalLight で成立するフォールバックを持つ。
 * - 太陽/月は DirectionalLight 1灯のみ castShadow(§5)。時間帯で位置・色・強度を補間。
 * - 行灯・デスクランプ・焚き火の光は store.state を見てここで一元適用。
 * - 時間帯切替はライトを 1.5s でクロスフェード(HDRI 切替は即時)。
 */

const SUN_DIST = 30
const SHADOW_HALF = 14 // 影カメラが 28m 四方(20m の間取りを余裕でカバー)
const TRANSITION = 1.5 // 秒

interface Profile {
  sunColor: THREE.Color
  sunIntensity: number
  sunDir: THREE.Vector3 // 太陽/月へ向かう単位ベクトル(位置 = dir * SUN_DIST)
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiIntensity: number
  exposure: number
  /** HDRI環境光(IBL)の強度。夜は絞らないと屋内が昼のように明るくなる */
  envIntensity: number
  /** フォグ(v2: 遠景を地平に溶かして浮遊感を消す)。色は時間帯の空気感に合わせる */
  fogColor: THREE.Color
  fogFar: number
  /** HDRI背景の表示輝度(夜のHDRIが明るすぎるのを絞る) */
  backgroundIntensity: number
  skyTop: THREE.Color // フォールバック空グラデーション
  skyBottom: THREE.Color
}

function makeProfile(p: {
  sunColor: number
  sunIntensity: number
  sunDir: [number, number, number]
  hemiSky: number
  hemiGround: number
  hemiIntensity: number
  exposure: number
  envIntensity?: number
  fogColor?: number
  fogFar?: number
  backgroundIntensity?: number
  skyTop: number
  skyBottom: number
}): Profile {
  return {
    sunColor: new THREE.Color(p.sunColor),
    sunIntensity: p.sunIntensity,
    sunDir: new THREE.Vector3(...p.sunDir).normalize(),
    hemiSky: new THREE.Color(p.hemiSky),
    hemiGround: new THREE.Color(p.hemiGround),
    hemiIntensity: p.hemiIntensity,
    exposure: p.exposure,
    envIntensity: p.envIntensity ?? 1,
    fogColor: new THREE.Color(p.fogColor ?? 0xcfdbe8),
    fogFar: p.fogFar ?? 150,
    backgroundIntensity: p.backgroundIntensity ?? 1,
    skyTop: new THREE.Color(p.skyTop),
    skyBottom: new THREE.Color(p.skyBottom),
  }
}

const PROFILES: Record<TimeOfDay, Profile> = {
  // 朝: 東から低い暖色光。空は薄い水色〜地平の暖色。
  morning: makeProfile({
    sunColor: 0xffc48a,
    sunIntensity: 2.2,
    sunDir: [1.0, 0.32, 0.35],
    hemiSky: 0xbcd6ff,
    hemiGround: 0x6b5a3e,
    hemiIntensity: 0.6,
    exposure: 1.0,
    envIntensity: 0.85,
    fogColor: 0xd8dce0,
    fogFar: 130,
    skyTop: 0x8fb5e0,
    skyBottom: 0xf3d9b0,
  }),
  // 昼: 高い白光。もっとも明るい。
  noon: makeProfile({
    sunColor: 0xfff6ea,
    sunIntensity: 3.2,
    sunDir: [0.2, 1.0, 0.15],
    hemiSky: 0xdfefff,
    hemiGround: 0x7a7050,
    hemiIntensity: 0.9,
    exposure: 1.0,
    envIntensity: 1.0,
    fogColor: 0xd4e0ea,
    fogFar: 155,
    skyTop: 0x5b8fd0,
    skyBottom: 0xbcd6ee,
  }),
  // 夕: 西へ傾いた強いオレンジ。影は長く。
  evening: makeProfile({
    sunColor: 0xff7a2e,
    sunIntensity: 2.6,
    sunDir: [-1.0, 0.24, 0.12],
    hemiSky: 0xd98a5a,
    hemiGround: 0x4a3a2a,
    hemiIntensity: 0.5,
    exposure: 1.05,
    envIntensity: 0.5,
    backgroundIntensity: 0.9,
    fogColor: 0xa4765a,
    fogFar: 110,
    skyTop: 0x3f4d84,
    skyBottom: 0xe8794a,
  }),
  // 夜: 月光で青白く弱い。環境は暗く、行灯/ランプ/焚き火が主役に。
  night: makeProfile({
    sunColor: 0x8fa4d6,
    sunIntensity: 0.5,
    sunDir: [0.3, 0.82, -0.4],
    hemiSky: 0x2a3550,
    hemiGround: 0x14161e,
    hemiIntensity: 0.24, // 江戸の夜は現代より暗い(ただしVRで不安にならない下限)
    exposure: 1.15,
    envIntensity: 0.08,
    backgroundIntensity: 0.3,
    fogColor: 0x0a0f18,
    fogFar: 80,
    skyTop: 0x090d1a,
    skyBottom: 0x1c2436,
  }),
}

type HdriEntry = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  background?: THREE.Texture
  env?: THREE.Texture
}

interface LampEntry {
  id: LampId
  lights: THREE.PointLight[]
  glows: THREE.MeshStandardMaterial[]
  flicker: boolean // 行灯・提灯は揺らぐ
  lightBase: number
  glowBase: number
}

function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

export function createLighting(ctx: AppContext, refs: WorldRefs): System {
  const { scene, renderer } = ctx

  // ---- 太陽/月(唯一の影あり)+ 半球光 ----
  const sun = new THREE.DirectionalLight(0xffffff, 1)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  const sc = sun.shadow.camera
  sc.left = -SHADOW_HALF
  sc.right = SHADOW_HALF
  sc.top = SHADOW_HALF
  sc.bottom = -SHADOW_HALF
  sc.near = 0.5
  sc.far = SUN_DIST * 2 + 20
  sc.updateProjectionMatrix()
  sun.shadow.bias = -0.0005
  scene.add(sun)
  scene.add(sun.target) // ターゲットは原点固定(間取り中心を照らす)

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1)
  scene.add(hemi)

  // ---- フォグ(v2: 遠景リングと合わせて浮遊感を根絶) ----
  const fog = new THREE.Fog(0xd4e0ea, 28, 155)
  scene.fog = fog

  // ---- フォールバック用スカイドーム(HDRI 未取得時のみ表示) ----
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x5b8fd0) },
      bottomColor: { value: new THREE.Color(0xbcd6ee) },
      exponent: { value: 0.55 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float exponent;
      varying vec3 vWorld;
      void main() {
        float h = max(normalize(vWorld).y, 0.0);
        vec3 col = mix(bottomColor, topColor, pow(h, exponent));
        // ShaderMaterial は自動 sRGB 変換されないため手動でエンコード
        col = pow(col, vec3(1.0 / 2.2));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(90, 24, 16), domeMat)
  dome.frustumCulled = false
  dome.renderOrder = -1
  scene.add(dome)

  // ---- HDRI キャッシュ ----
  const hdri: Record<TimeOfDay, HdriEntry> = {
    morning: { status: 'idle' },
    noon: { status: 'idle' },
    evening: { status: 'idle' },
    night: { status: 'idle' },
  }
  let rgbeLoader: RGBELoader | null = null
  let pmrem: THREE.PMREMGenerator | null = null

  function applyHdri(tod: TimeOfDay): void {
    const entry = hdri[tod]
    if (entry.status === 'ready' && entry.background && entry.env) {
      scene.background = entry.background
      scene.environment = entry.env
      dome.visible = false
    } else {
      // フォールバック: environment なし + グラデーションドーム
      scene.background = null
      scene.environment = null
      dome.visible = true
    }
  }

  function loadHdri(tod: TimeOfDay, onDone?: () => void): void {
    const entry = hdri[tod]
    if (entry.status !== 'idle') {
      onDone?.()
      return
    }
    entry.status = 'loading'
    if (!rgbeLoader) rgbeLoader = new RGBELoader()
    if (!pmrem) {
      pmrem = new THREE.PMREMGenerator(renderer)
      pmrem.compileEquirectangularShader()
    }
    rgbeLoader.load(
      `hdri/${tod}.hdr`,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping
        const env = pmrem!.fromEquirectangular(texture).texture
        entry.background = texture
        entry.env = env
        entry.status = 'ready'
        if (store.state.timeOfDay === tod) applyHdri(tod)
        onDone?.()
      },
      undefined,
      () => {
        // ファイル無し/失敗: フォールバックのまま
        entry.status = 'failed'
        if (store.state.timeOfDay === tod) applyHdri(tod)
        onDone?.()
      },
    )
  }

  // 残り時間帯をアイドル時に一枚ずつプリロード
  const idle: (cb: () => void) => void =
    typeof (globalThis as { requestIdleCallback?: unknown })
      .requestIdleCallback === 'function'
      ? (cb) =>
          (
            globalThis as unknown as {
              requestIdleCallback: (c: () => void) => void
            }
          ).requestIdleCallback(cb)
      : (cb) => setTimeout(cb, 1200)

  function preloadNext(): void {
    const order: TimeOfDay[] = ['morning', 'noon', 'evening', 'night']
    const next = order.find((t) => hdri[t].status === 'idle')
    if (!next) return
    idle(() => loadHdri(next, () => idle(preloadNext)))
  }

  // ---- 補助照明(行灯・デスクランプ)の参照解決 ----
  const lampEntries: LampEntry[] = []
  for (const key of Object.keys(refs.lampFixtures) as LampId[]) {
    const fixture = refs.lampFixtures[key]
    if (!fixture) continue
    // `${id}Light`/`${id}Glow` の名を持つ子孫を全て収集(提灯群は多数のglow+少数のlightを持つ)
    const lights: THREE.PointLight[] = []
    const glows: THREE.MeshStandardMaterial[] = []
    fixture.traverse((obj) => {
      if (obj.name === `${key}Light` && obj instanceof THREE.PointLight) lights.push(obj)
      if (
        obj.name === `${key}Glow` &&
        (obj as THREE.Mesh).isMesh &&
        (obj as THREE.Mesh).material instanceof THREE.MeshStandardMaterial
      ) {
        glows.push((obj as THREE.Mesh).material as THREE.MeshStandardMaterial)
      }
    })
    lampEntries.push({
      id: key,
      lights,
      glows,
      flicker: key !== 'deskLamp',
      // 行灯=和紙越しの暖色 / デスクランプ=やや白め / 提灯=1灯あたり控えめ(数が多いため)
      lightBase: key === 'andon' ? 2.0 : key === 'chochin' ? 5.0 : 2.6,
      glowBase: key === 'andon' ? 1.6 : key === 'chochin' ? 2.0 : 1.2,
    })
  }

  // ---- 焚き火の PointLight(無ければ生成) ----
  let bonfireLight: THREE.PointLight | null = null
  if (refs.bonfire) {
    const found = refs.bonfire.getObjectByName('bonfireLight')
    if (found instanceof THREE.PointLight) {
      bonfireLight = found
    } else {
      bonfireLight = new THREE.PointLight(0xff6a1e, 0, 8, 2)
      bonfireLight.name = 'bonfireLight'
      bonfireLight.position.set(0, 0.5, 0)
      refs.bonfire.add(bonfireLight)
    }
  }

  // ---- クロスフェード状態 ----
  const from: Profile = makeProfile({
    sunColor: 0xffffff,
    sunIntensity: 1,
    sunDir: [0, 1, 0],
    hemiSky: 0xffffff,
    hemiGround: 0x444444,
    hemiIntensity: 1,
    exposure: 1,
    skyTop: 0x5b8fd0,
    skyBottom: 0xbcd6ee,
  })
  const cur: Profile = makeProfile({
    sunColor: 0xffffff,
    sunIntensity: 1,
    sunDir: [0, 1, 0],
    hemiSky: 0xffffff,
    hemiGround: 0x444444,
    hemiIntensity: 1,
    exposure: 1,
    skyTop: 0x5b8fd0,
    skyBottom: 0xbcd6ee,
  })

  function copyProfile(dst: Profile, src: Profile): void {
    dst.sunColor.copy(src.sunColor)
    dst.sunIntensity = src.sunIntensity
    dst.sunDir.copy(src.sunDir)
    dst.hemiSky.copy(src.hemiSky)
    dst.hemiGround.copy(src.hemiGround)
    dst.hemiIntensity = src.hemiIntensity
    dst.exposure = src.exposure
    dst.envIntensity = src.envIntensity
    dst.fogColor.copy(src.fogColor)
    dst.fogFar = src.fogFar
    dst.backgroundIntensity = src.backgroundIntensity
    dst.skyTop.copy(src.skyTop)
    dst.skyBottom.copy(src.skyBottom)
  }

  let target: Profile = PROFILES[store.state.timeOfDay]
  let progress = 1 // 1 = 遷移完了

  // 初期状態を即時反映
  copyProfile(cur, target)
  copyProfile(from, target)

  function beginTransition(tod: TimeOfDay): void {
    copyProfile(from, cur)
    target = PROFILES[tod]
    progress = 0
  }

  // timeOfDay の変化に反応(HDRI は即時、ライトは補間)
  const unsub = store.on((state, changed) => {
    if (changed !== 'timeOfDay') return
    applyHdri(state.timeOfDay)
    loadHdri(state.timeOfDay) // 未ロードなら取得
    beginTransition(state.timeOfDay)
    // 提灯は夕・夜に自動点灯(江戸の通りの灯り)。手動トグルも可能なまま
    store.setLamp('chochin', state.timeOfDay === 'evening' || state.timeOfDay === 'night')
  })
  void unsub // このシステムはアプリ寿命と同じ

  // 初期 HDRI をロード → 完了後に残りをアイドルプリロード
  applyHdri(store.state.timeOfDay)
  loadHdri(store.state.timeOfDay, () => idle(preloadNext))

  const tmpPos = new THREE.Vector3()

  function applyCurrent(elapsed: number): void {
    sun.color.copy(cur.sunColor)
    sun.intensity = cur.sunIntensity
    tmpPos.copy(cur.sunDir).normalize().multiplyScalar(SUN_DIST)
    sun.position.copy(tmpPos)

    hemi.color.copy(cur.hemiSky)
    hemi.groundColor.copy(cur.hemiGround)
    hemi.intensity = cur.hemiIntensity

    renderer.toneMappingExposure = cur.exposure

    fog.color.copy(cur.fogColor)
    fog.far = cur.fogFar
    fog.near = cur.fogFar * 0.18
    scene.backgroundIntensity = cur.backgroundIntensity

    const u = domeMat.uniforms as {
      topColor: { value: THREE.Color }
      bottomColor: { value: THREE.Color }
    }
    u.topColor.value.copy(cur.skyTop)
    u.bottomColor.value.copy(cur.skyBottom)
    void elapsed
  }

  // 初期プロファイルを一度反映(progress=1 のため update ではスキップされる)
  applyCurrent(0)

  const lamps = store.state.lamps

  function applyLamps(elapsed: number): void {
    // 行灯: ±10% でほのかに揺らぐ疑似ノイズ
    const andonFlick =
      1 +
      0.1 *
        (0.6 * Math.sin(elapsed * 11.0) + 0.4 * Math.sin(elapsed * 23.3))
    for (const e of lampEntries) {
      const on = lamps[e.id]
      const f = e.flicker ? andonFlick : 1
      for (const l of e.lights) l.intensity = on ? e.lightBase * f : 0
      for (const g of e.glows) g.emissiveIntensity = on ? e.glowBase * f : 0
    }
  }

  function applyBonfire(elapsed: number): void {
    // 夜以外は自動消火
    if (store.state.bonfireLit && store.state.timeOfDay !== 'night') {
      store.set('bonfireLit', false)
    }
    if (!bonfireLight) return
    if (store.state.bonfireLit) {
      const flick =
        1 +
        0.35 *
          (0.6 * Math.sin(elapsed * 13.0 + 1.7) +
            0.4 * Math.sin(elapsed * 27.0))
      bonfireLight.intensity = 3.2 * Math.max(0.2, flick)
    } else {
      bonfireLight.intensity = 0
    }
  }

  return {
    update(dt: number, elapsed: number) {
      if (progress < 1) {
        progress = Math.min(1, progress + dt / TRANSITION)
        const t = smoothstep(progress)
        cur.sunColor.copy(from.sunColor).lerp(target.sunColor, t)
        cur.sunIntensity =
          from.sunIntensity + (target.sunIntensity - from.sunIntensity) * t
        cur.sunDir.copy(from.sunDir).lerp(target.sunDir, t)
        cur.hemiSky.copy(from.hemiSky).lerp(target.hemiSky, t)
        cur.hemiGround.copy(from.hemiGround).lerp(target.hemiGround, t)
        cur.hemiIntensity =
          from.hemiIntensity +
          (target.hemiIntensity - from.hemiIntensity) * t
        cur.exposure = from.exposure + (target.exposure - from.exposure) * t
        cur.envIntensity =
          from.envIntensity + (target.envIntensity - from.envIntensity) * t
        cur.fogColor.copy(from.fogColor).lerp(target.fogColor, t)
        cur.fogFar = from.fogFar + (target.fogFar - from.fogFar) * t
        cur.backgroundIntensity =
          from.backgroundIntensity + (target.backgroundIntensity - from.backgroundIntensity) * t
        cur.skyTop.copy(from.skyTop).lerp(target.skyTop, t)
        cur.skyBottom.copy(from.skyBottom).lerp(target.skyBottom, t)
        applyCurrent(elapsed)
      }
      // 環境光(IBL)強度: 時間帯プロファイル × 雨天減光(単一の書き込み元をここに集約)
      scene.environmentIntensity =
        cur.envIntensity * (store.state.weather === 'rain' ? 0.6 : 1)
      // 影の範囲(±14m)を60mの通り全域で使えるよう、太陽とターゲットをプレイヤーに追従させる
      tmpPos.copy(cur.sunDir).multiplyScalar(SUN_DIST)
      sun.position.set(
        ctx.player.position.x + tmpPos.x,
        tmpPos.y,
        ctx.player.position.z + tmpPos.z,
      )
      sun.target.position.set(ctx.player.position.x, 0, ctx.player.position.z)
      applyLamps(elapsed)
      applyBonfire(elapsed)
    },
  }
}
