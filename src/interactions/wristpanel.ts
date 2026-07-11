import * as THREE from 'three'
import type { XRGripSpace } from 'three'
import type { AppContext, System, TimeOfDay, WorldRefs } from '../core/types'
import { interactions } from '../core/registry'
import { store } from '../core/state'

/**
 * 左手首パネル(P0-2のUI): 朝/昼/夕/夜ボタン+天候トグル。
 * 左グリップ(ctx.xr.gripSpaces の handedness==='left' のもの)に追従する小さなキャンバスUI。
 * ctx.xr は VR外(または connected イベント到達前)では undefined/'unknown' のことがあるため、
 * 毎フレーム遅延アタッチを試みる(壊れないことを優先)。
 */

const PANEL_W = 0.12 // 12cm
const PANEL_H = 0.08 // 8cm
const CANVAS_W = 384
const CANVAS_H = 256
const FONT_FAMILY = '"Hiragino Mincho ProN", "Yu Mincho", serif'

const TIME_BUTTONS: { id: TimeOfDay; label: string }[] = [
  { id: 'morning', label: '朝' },
  { id: 'noon', label: '昼' },
  { id: 'evening', label: '夕' },
  { id: 'night', label: '夜' },
]

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function setupWristPanel(ctx: AppContext, _refs: WorldRefs): System {
  // ---- canvas + texture ----
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const g = canvas.getContext('2d')!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const panelMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
  const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), panelMat)
  panelMesh.visible = false

  // ---- ボタンレイアウト(canvasピクセル座標) ----
  const margin = 14
  const gap = 6
  const rowH = 108
  const btnW = (CANVAS_W - margin * 2 - gap * 3) / 4
  const timeRects: (Rect & { id: TimeOfDay; label: string })[] = TIME_BUTTONS.map((b, i) => ({
    ...b,
    x: margin + i * (btnW + gap),
    y: 14,
    w: btnW,
    h: rowH,
  }))
  const weatherRect: Rect = {
    x: margin,
    y: rowH + 28,
    w: CANVAS_W - margin * 2,
    h: CANVAS_H - rowH - 28 - 14,
  }

  function pxToLocal(px: number, py: number): [number, number] {
    const lx = (px / CANVAS_W - 0.5) * PANEL_W
    const ly = (0.5 - py / CANVAS_H) * PANEL_H
    return [lx, ly]
  }

  function roundRect(x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath()
    g.moveTo(x + r, y)
    g.arcTo(x + w, y, x + w, y + h, r)
    g.arcTo(x + w, y + h, x, y + h, r)
    g.arcTo(x, y + h, x, y, r)
    g.arcTo(x, y, x + w, y, r)
    g.closePath()
  }

  function draw(): void {
    const { timeOfDay, weather } = store.state
    g.clearRect(0, 0, CANVAS_W, CANVAS_H)

    // 背景(木の手首パネル風)
    roundRect(0, 0, CANVAS_W, CANVAS_H, 18)
    g.fillStyle = '#3b2f26'
    g.fill()
    roundRect(3, 3, CANVAS_W - 6, CANVAS_H - 6, 16)
    g.fillStyle = '#efe6d8'
    g.fill()

    g.textAlign = 'center'
    g.textBaseline = 'middle'

    for (const r of timeRects) {
      const active = r.id === timeOfDay
      roundRect(r.x, r.y, r.w, r.h, 10)
      g.fillStyle = active ? '#c9622a' : '#d8cdb8'
      g.fill()
      g.lineWidth = 2
      g.strokeStyle = '#3b2f26'
      roundRect(r.x, r.y, r.w, r.h, 10)
      g.stroke()
      g.fillStyle = active ? '#fffaf0' : '#3b2f26'
      g.font = `bold ${Math.floor(r.h * 0.5)}px ${FONT_FAMILY}`
      g.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2 + 2)
    }

    const isClear = weather === 'clear'
    roundRect(weatherRect.x, weatherRect.y, weatherRect.w, weatherRect.h, 10)
    g.fillStyle = isClear ? '#4f8bd6' : '#5a5f68'
    g.fill()
    g.lineWidth = 2
    g.strokeStyle = '#3b2f26'
    roundRect(weatherRect.x, weatherRect.y, weatherRect.w, weatherRect.h, 10)
    g.stroke()
    g.fillStyle = '#fffaf0'
    g.font = `bold ${Math.floor(weatherRect.h * 0.5)}px ${FONT_FAMILY}`
    g.fillText(
      isClear ? '晴' : '雨',
      weatherRect.x + weatherRect.w / 2,
      weatherRect.y + weatherRect.h / 2 + 2,
    )

    texture.needsUpdate = true
  }

  draw()

  // ---- ボタンのヒット用透明メッシュを重ねる ----
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })

  function addHitArea(rect: Rect, label: string, onSelect: () => void): void {
    const [lx, ly] = pxToLocal(rect.x + rect.w / 2, rect.y + rect.h / 2)
    const w = (rect.w / CANVAS_W) * PANEL_W
    const h = (rect.h / CANVAS_H) * PANEL_H
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(w, h), hitMat)
    hit.position.set(lx, ly, 0.001)
    panelMesh.add(hit)
    interactions.add({ object: hit, label, onSelect })
  }

  for (const r of timeRects) {
    addHitArea(r, `${r.label}にする`, () => store.set('timeOfDay', r.id))
  }
  addHitArea(weatherRect, '天気を切り替える', () => {
    store.set('weather', store.state.weather === 'clear' ? 'rain' : 'clear')
  })

  store.on((_state, changed) => {
    if (changed === 'timeOfDay' || changed === 'weather') draw()
  })

  // ---- 左グリップへの遅延アタッチ ----
  // connected イベント(handedness確定)は main実行後・XRセッション開始後に来るため、
  // 毎フレーム ctx.xr / handedness を確認しつつ、connected イベントも併せて監視する。
  let attached = false
  const listenedGrips = new WeakSet<THREE.Object3D>()

  function attachTo(grip: THREE.Object3D): void {
    if (attached) return
    attached = true
    grip.add(panelMesh)
    // 手首の上側・やや前方に配置し、覗き込みやすい角度に傾ける
    panelMesh.position.set(0, 0.03, -0.02)
    panelMesh.rotation.set(-Math.PI / 2.3, 0, 0)
  }

  function tryAttach(): void {
    if (attached) return
    const xr = ctx.xr
    if (!xr) return
    for (let i = 0; i < xr.gripSpaces.length; i++) {
      if (xr.handedness[i] === 'left') {
        attachTo(xr.gripSpaces[i])
        return
      }
    }
    for (const grip of xr.gripSpaces) {
      if (listenedGrips.has(grip)) continue
      listenedGrips.add(grip)
      ;(grip as unknown as XRGripSpace).addEventListener('connected', (e) => {
        if (!attached && e.data.handedness === 'left') attachTo(grip)
      })
    }
  }

  tryAttach()

  return {
    update() {
      if (!attached) tryAttach()
      panelMesh.visible = attached && ctx.renderer.xr.isPresenting
    },
  }
}
