/**
 * デスクトップフォールバックの自動検証(受け入れ基準の開発検証用)。
 * 前提: `npm run dev` が https://localhost:5173 で起動中、システムにGoogle Chromeがあること。
 * 実行: node scripts/verify-desktop.mjs [出力ディレクトリ]
 * 検証項目: ページロード/コンソールエラー0/WASD移動/時間帯切替/描画統計(ドローコール・三角形数)
 */
import puppeteer from 'puppeteer-core'

const OUT = process.argv[2] ?? '.'
const URL = process.env.MYROOM_URL ?? 'https://localhost:5173/'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const errors = []
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--ignore-certificate-errors', '--mute-audio', '--window-size=1280,800'],
  defaultViewport: { width: 1280, height: 800 },
})
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })
await page.waitForFunction(() => window.__myroom !== undefined, { timeout: 15000 })
await new Promise((r) => setTimeout(r, 3000)) // アセット読み込み待ち

const getPos = () =>
  page.evaluate(() => {
    const p = window.__myroom.player.position
    return { x: p.x, y: p.y, z: p.z }
  })

await page.screenshot({ path: `${OUT}/shot-1-spawn.png` })

// ポインターロック → WASD移動
await page.mouse.click(640, 400)
await new Promise((r) => setTimeout(r, 500))
const locked = await page.evaluate(() => document.pointerLockElement !== null)
const before = await getPos()
await page.keyboard.down('KeyW')
await new Promise((r) => setTimeout(r, 1200))
await page.keyboard.up('KeyW')
const after = await getPos()
const moved = Math.hypot(after.x - before.x, after.z - before.z)

// 視点回転して庭方向を見る
await page.mouse.move(640, 400)
await page.mouse.move(900, 380)
await new Promise((r) => setTimeout(r, 300))
await page.screenshot({ path: `${OUT}/shot-2-moved.png` })

// 時間帯切替(夜)
await page.keyboard.press('Digit4')
await new Promise((r) => setTimeout(r, 2500))
await page.screenshot({ path: `${OUT}/shot-3-night.png` })
const todNight = await page.evaluate(() => window.__myroom.store.state.timeOfDay)

// 夕方
await page.keyboard.press('Digit3')
await new Promise((r) => setTimeout(r, 2500))
await page.screenshot({ path: `${OUT}/shot-4-evening.png` })

// 雨
await page.keyboard.press('Digit2')
await page.keyboard.press('KeyR')
await new Promise((r) => setTimeout(r, 2000))
await page.screenshot({ path: `${OUT}/shot-5-rain.png` })
const weather = await page.evaluate(() => window.__myroom.store.state.weather)

const info = await page.evaluate(() => {
  const r = window.__myroom.renderer
  return { calls: r.info.render.calls, triangles: r.info.render.triangles }
})

await browser.close()

const results = {
  pointerLock: locked,
  movedMeters: +moved.toFixed(2),
  movedOk: moved > 0.5,
  timeOfDayNight: todNight === 'night',
  weatherRain: weather === 'rain',
  drawCalls: info.calls,
  triangles: info.triangles,
  drawCallsOk: info.calls <= 100,
  trianglesOk: info.triangles <= 300000,
  consoleErrors: errors,
}
console.log(JSON.stringify(results, null, 2))
const ok =
  results.movedOk && results.timeOfDayNight && results.weatherRain && errors.length === 0
process.exit(ok ? 0 : 1)
