import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'
import type { AppContext, System } from './core/types'
import { LAYOUT } from './core/layout'
import { buildWorld } from './world'
import { createDesktopControls } from './systems/desktop'
import { createControllers } from './systems/controllers'
import { createLocomotion } from './systems/locomotion'
import { createLighting } from './systems/lighting'
import { createWeather } from './systems/weather'
import { createAudio } from './systems/audio'
import { setupWristPanel } from './interactions/wristpanel'
import { setupLamps } from './interactions/lamps'
import { setupDoors } from './interactions/doors'
import { setupRadio } from './interactions/radio'
import { setupKakejiku } from './interactions/kakejiku'
import { setupShishiodoshi } from './interactions/shishiodoshi'
import { setupBonfire } from './interactions/bonfire'
import { setupWindChime } from './interactions/windchime'
import { setupStreet } from './interactions/street'
import { createNpc } from './systems/npc'

// ---- レンダラ(Quest向け設定: §5 パフォーマンス予算) ----
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.xr.enabled = true
renderer.xr.setFoveation(1)
document.getElementById('app')!.appendChild(renderer.domElement)
document.body.appendChild(VRButton.createButton(renderer))

// ---- シーンとプレイヤーリグ ----
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x10141c)

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.05,
  120,
)
camera.position.set(0, LAYOUT.EYE_HEIGHT, 0) // VRでは xr が上書きする

const player = new THREE.Group()
player.position.set(LAYOUT.SPAWN.x, LAYOUT.SPAWN.y, LAYOUT.SPAWN.z)
player.rotation.y = LAYOUT.SPAWN.yaw
player.add(camera)
scene.add(player)

const listener = new THREE.AudioListener()
camera.add(listener)

const ctx: AppContext = { renderer, scene, camera, player, listener }

// ---- ワールド構築 → システム/インタラクション配線 ----
const refs = buildWorld(ctx)

const systems: System[] = [
  createControllers(ctx, refs), // ctx.xr を設定するため最初
  createLocomotion(ctx, refs),
  createDesktopControls(ctx, refs),
  createLighting(ctx, refs),
  createWeather(ctx, refs),
  createAudio(ctx, refs),
  setupWristPanel(ctx, refs),
  setupLamps(ctx, refs),
  setupDoors(ctx, refs),
  setupRadio(ctx, refs),
  setupKakejiku(ctx, refs),
  setupShishiodoshi(ctx, refs),
  setupBonfire(ctx, refs),
  setupWindChime(ctx, refs),
  setupStreet(ctx, refs),
  createNpc(ctx, refs),
]

// ---- リサイズ ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// ---- 検証用フック(scripts/verify-desktop.mjs が参照) ----
import { store } from './core/state'
;(window as unknown as Record<string, unknown>).__myroom = { player, camera, renderer, store, refs }

// ---- メインループ ----
const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1)
  const elapsed = clock.elapsedTime
  for (const s of systems) s.update(dt, elapsed)
  renderer.render(scene, camera)
})
