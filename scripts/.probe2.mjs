import puppeteer from 'puppeteer-core'

const OUT = process.argv[2] ?? '.'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--ignore-certificate-errors', '--mute-audio'],
  defaultViewport: { width: 1280, height: 800 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto('https://localhost:5173/', { waitUntil: 'networkidle2', timeout: 30000 })
await page.waitForFunction(() => window.__myroom !== undefined, { timeout: 15000 })
await new Promise((r) => setTimeout(r, 4000))

const look = async (x, y, z, yaw, pitch, name, wait = 600) => {
  await page.evaluate(
    (x, y, z, yaw, pitch) => {
      const m = window.__myroom
      m.player.position.set(x, y, z)
      m.player.rotation.y = yaw
      m.camera.rotation.set(pitch, 0, 0)
    },
    x, y, z, yaw, pitch,
  )
  await new Promise((r) => setTimeout(r, wait))
  await page.screenshot({ path: `${OUT}/${name}.png` })
}

// 通りの中央から四方(浮遊感チェック)
await look(0, 0, 0, Math.PI / 2, 0, 'v2-street-west')   // 西(木戸方向)
await look(0, 0, 0, -Math.PI / 2, 0, 'v2-street-east')  // 東(鳥居方向)
await look(0, 0, 0, Math.PI, -0.05, 'v2-street-south')  // 南(商家・路地)
await look(0, 0, 0, 0, -0.05, 'v2-street-north')        // 北(自分の町家)
await look(0, 0, 0, Math.PI / 4, 0.5, 'v2-street-skyup') // 空と遠景の境目

const info = await page.evaluate(() => {
  const r = window.__myroom.renderer
  return { calls: r.info.render.calls, triangles: r.info.render.triangles, errors: [] }
})
console.log(JSON.stringify({ ...info, pageErrors: errors }))
await browser.close()
