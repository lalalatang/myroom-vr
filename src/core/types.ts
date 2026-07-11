/**
 * モジュール間契約(contract-first)。
 * 全サブモジュールはこのファイルの型にのみ依存して並列実装する。
 */
import type * as THREE from 'three'

// ---- 状態 -------------------------------------------------------------

export type TimeOfDay = 'morning' | 'noon' | 'evening' | 'night'
export type Weather = 'clear' | 'rain'
export type LampId = 'andon' | 'deskLamp'

export interface WorldState {
  timeOfDay: TimeOfDay
  weather: Weather
  /** 行灯・デスクランプの点灯状態。適用(光の強度反映)は lighting システムが一元管理 */
  lamps: Record<LampId, boolean>
  /** 書斎⇔縁側の障子。true = 開 */
  shojiOpen: boolean
  radioPlaying: boolean
  bonfireLit: boolean
}

// ---- アプリ骨格 -------------------------------------------------------

export interface AppContext {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** プレイヤーリグ。移動(テレポート/WASD)はこの Group の position/rotation を動かす。camera はこの子 */
  player: THREE.Group
  listener: THREE.AudioListener
  /** systems/controllers.ts が生成時に設定する。VR外では undefined のまま */
  xr?: XRInput
}

export interface XRInput {
  /** renderer.xr.getController(i) のレイ空間(ワールドはplayer子) */
  raySpaces: THREE.Group[]
  /** renderer.xr.getControllerGrip(i) */
  gripSpaces: THREE.Group[]
  /** index → 'left' | 'right' | 'unknown'('connected'イベントで更新される) */
  handedness: ('left' | 'right' | 'unknown')[]
}

/** 毎フレーム呼ばれる。dt は秒(0.1にクランプ済み)、elapsed は起動からの秒 */
export interface System {
  update(dt: number, elapsed: number): void
}

/** すべてのモジュールのエントリ関数はこのシグネチャ */
export type ModuleFactory = (ctx: AppContext, refs: WorldRefs) => System

// ---- ワールド参照(world/ が構築し、systems/interactions が消費) ----

export interface WorldRefs {
  /** テレポート/WASD接地の対象面(床・地面・縁側・飛び石)。userData.walkable=true も併せて設定すること */
  teleportSurfaces: THREE.Object3D[]
  /**
   * 障子パネル群。各パネルは userData.slide = { axis:'x', closed:number, open:number }(ローカル座標)を持ち、
   * interactions/doors.ts が position[axis] を closed↔open に補間する。
   */
  shojiPanels: THREE.Object3D[]
  /**
   * 照明器具。各 fixture は子に PointLight(name: `${id}Light`)と
   * 発光メッシュ(name: `${id}Glow`、MeshStandardMaterial で emissive 設定)を持つこと。
   * 強度の適用は systems/lighting.ts が一元管理する。
   */
  lampFixtures: Partial<Record<LampId, THREE.Object3D>>
  /** 文机の上のラジオ本体(クリック対象・3D音源の位置) */
  radio?: THREE.Object3D
  /** 掛け軸。interactions/kakejiku.ts が正面に短歌テキスト平面を貼る。userData.faceNormal に表面法線(THREE.Vector3) */
  kakejiku?: THREE.Object3D
  /** 鹿威し。竹アーム(name:'shishiArm')を子に持ち、interactions が回転アニメ+音を付ける */
  shishiodoshi?: THREE.Object3D
  /** 焚き火(石組+薪)。interactions/bonfire.ts が炎・光・音を付ける */
  bonfire?: THREE.Object3D
  /** 風鈴。短冊(name:'windChimeTanzaku')を子に持つ */
  windChime?: THREE.Object3D
  /** 庭の池の水面メッシュ(雨の波紋対象) */
  pond?: THREE.Mesh
  /** 窓・障子開口部の中心(夕方の差し込み光などの演出用) */
  windowLightTargets?: THREE.Vector3[]
}

// ---- インタラクション --------------------------------------------------

export interface Interactable {
  /** レイキャスト対象。この Object3D の子孫へのヒットでこの interactable が選択される */
  object: THREE.Object3D
  /** デスクトップのホバーヒント表示用(日本語で短く) */
  label?: string
  /** トリガー/クリックで呼ばれる */
  onSelect(): void
  onHoverIn?(): void
  onHoverOut?(): void
}
