import * as THREE from 'three'
import type { AppContext, System, WorldRefs } from '../core/types'
import { interactions } from '../core/registry'

/**
 * 掛け軸(P1-7): public/texts/tanka.json から短歌をランダム表示、クリックで次の一首。
 * canvas に縦書きレンダリングして CanvasTexture で掛け軸面に貼る。
 */

interface Tanka {
  lines: string[]
  author: string
}

const FALLBACK_TANKA: Tanka = {
  lines: ['秋の田の', 'かりほの庵の', '苫をあらみ', 'わが衣手は', '露にぬれつつ'],
  author: '天智天皇',
}

const CANVAS_W = 512
const CANVAS_H = 768
const FONT_FAMILY = '"Hiragino Mincho ProN", "Yu Mincho", serif'

export function setupKakejiku(_ctx: AppContext, refs: WorldRefs): System {
  const kakejiku = refs.kakejiku
  if (!kakejiku) {
    // world/furniture.ts が掛け軸をまだ用意していない場合は何もしない(壊れない)。
    return { update() {} }
  }

  // ---- canvas + texture ----
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const g = canvas.getContext('2d')!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4

  let list: Tanka[] = [FALLBACK_TANKA]
  let index = 0

  drawTanka(g, list[index]) // 初回は同期的にフォールバック歌を描画しておく
  texture.needsUpdate = true

  // ---- public/texts/tanka.json を取得(ベース相対パス。先頭'/'を付けない) ----
  fetch('texts/tanka.json')
    .then((res) => {
      if (!res.ok) throw new Error(`tanka.json fetch failed: ${res.status}`)
      return res.json()
    })
    .then((data: unknown) => {
      const arr = (data as { tanka?: unknown })?.tanka
      if (!Array.isArray(arr) || arr.length === 0) return
      const parsed = arr.filter(
        (t): t is Tanka =>
          !!t &&
          Array.isArray((t as Tanka).lines) &&
          (t as Tanka).lines.length > 0 &&
          typeof (t as Tanka).author === 'string',
      )
      if (parsed.length === 0) return
      list = parsed
      index = Math.floor(Math.random() * list.length)
      drawTanka(g, list[index])
      texture.needsUpdate = true
    })
    .catch(() => {
      // フォールバックの一首のまま表示を続ける
    })

  // ---- 掛け軸面に平面を貼る ----
  const panelMesh = buildPanelMesh(kakejiku, texture)
  kakejiku.add(panelMesh)

  // ---- クリック/レイで次の一首へ ----
  interactions.add({
    object: kakejiku,
    label: '掛け軸の歌をめくる',
    onSelect() {
      index = (index + 1) % list.length
      drawTanka(g, list[index])
      texture.needsUpdate = true
    },
  })

  return { update() {} }
}

/**
 * kakejiku のワールド包囲サイズから概ねのローカル寸法を推定し、
 * その正面(userData.faceNormal)にテキスト平面を少し浮かせて配置する。
 */
function buildPanelMesh(kakejiku: THREE.Object3D, texture: THREE.CanvasTexture): THREE.Mesh {
  const box = new THREE.Box3().setFromObject(kakejiku)
  const worldSize = new THREE.Vector3()
  box.getSize(worldSize)
  const worldScale = kakejiku.getWorldScale(new THREE.Vector3())

  // 掛け軸がどの向き(X軸沿い/Z軸沿い)の壁に掛かっていても幅を取れるよう大きい方を使う
  const localWidth = Math.max(worldSize.x, worldSize.z) / (Math.max(worldScale.x, worldScale.z) || 1)
  const localHeight = worldSize.y / (worldScale.y || 1)

  const panelW = Math.max(0.15, localWidth * 0.7 || 0.28)
  const panelH = Math.max(0.4, localHeight * 0.62 || 0.85)

  const geo = new THREE.PlaneGeometry(panelW, panelH)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    toneMapped: false,
    side: THREE.DoubleSide,
    transparent: true,
  })
  const mesh = new THREE.Mesh(geo, mat)

  // userData.faceNormal はワールド座標系の法線。パネルは kakejiku の子として置くため、
  // 親のワールド回転の逆をかけてローカル法線に直してから向きを合わせる
  const worldNormal = (
    (kakejiku.userData.faceNormal as THREE.Vector3 | undefined)?.clone() ??
    new THREE.Vector3(0, 0, 1)
  ).normalize()
  const invParent = kakejiku.getWorldQuaternion(new THREE.Quaternion()).invert()
  const localNormal = worldNormal.applyQuaternion(invParent).normalize()
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localNormal)
  mesh.position.copy(localNormal.multiplyScalar(0.012))

  return mesh
}

/** 縦書き(右列→左列、1行=1列、文字を縦に積む)。作者は左端に小さく。 */
function drawTanka(g: CanvasRenderingContext2D, tanka: Tanka): void {
  const w = CANVAS_W
  const h = CANVAS_H

  // 生成り(和紙色)の背景
  g.clearRect(0, 0, w, h)
  g.fillStyle = '#f1e6c8'
  g.fillRect(0, 0, w, h)

  // ざらつき(和紙の質感を軽く表現)
  g.fillStyle = 'rgba(120, 100, 60, 0.05)'
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    g.fillRect(x, y, 1.3, 1.3)
  }

  // 縁取り
  g.strokeStyle = 'rgba(90, 70, 40, 0.35)'
  g.lineWidth = 3
  g.strokeRect(16, 16, w - 32, h - 32)

  const padTop = 60
  const padBottom = 60
  const padRight = 48
  const padLeft = 48
  const authorColW = 34

  const lines = tanka.lines
  const maxChars = Math.max(...lines.map((l) => l.length), 1)
  const usableH = h - padTop - padBottom
  const fontSize = Math.min(46, Math.floor((usableH / maxChars) * 0.9))
  const lineHeight = fontSize * 1.08

  const usableW = w - padLeft - padRight - authorColW - 10
  const colSpacing = lines.length > 0 ? usableW / lines.length : usableW

  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#2b2419'
  g.font = `${fontSize}px ${FONT_FAMILY}`

  // 右列から左列へ、1行=1列、文字を縦に積む
  lines.forEach((line, colIndex) => {
    const cx = w - padRight - colSpacing * colIndex - colSpacing / 2
    const totalTextHeight = line.length * lineHeight
    const startY = padTop + (usableH - totalTextHeight) / 2 + lineHeight / 2
    for (let c = 0; c < line.length; c++) {
      g.fillText(line[c], cx, startY + c * lineHeight)
    }
  })

  // 作者(左端に小さく、縦書き)
  if (tanka.author) {
    const authorFontSize = Math.max(14, Math.floor(fontSize * 0.5))
    const authorLineHeight = authorFontSize * 1.15
    g.font = `${authorFontSize}px ${FONT_FAMILY}`
    g.fillStyle = '#6b5a3a'
    const ax = padLeft + authorColW / 2 - 6
    const totalH = tanka.author.length * authorLineHeight
    const startY = h - padBottom - totalH + authorLineHeight / 2
    for (let c = 0; c < tanka.author.length; c++) {
      g.fillText(tanka.author[c], ax, startY + c * authorLineHeight)
    }
  }
}
