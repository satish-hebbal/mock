/**
 * Catalog thumbnails for the .glb devices.
 *
 * The Devices panel shows each model as a picture rather than a name, and the
 * picture is the model itself: this boots Vite, opens scripts/device-thumbs/
 * for one device at a time in headless Chrome, and saves what the app's own
 * GltfDevice draws, on a clear background, as a small WebP.
 *
 * Run it after adding or re-verifying a model in deviceModels.json. Needs a
 * local Chrome and puppeteer-core, which isn't a dependency:
 *   npm i --no-save puppeteer-core
 *
 * Usage: node scripts/render-device-thumbs.mjs [id ...]   (default: every verified model)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import sharp from 'sharp'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const OUT = path.join(ROOT, 'public', 'device-thumbs')
/** CSS size of the render, and how much denser the saved image is */
const SIZE = 180
const DPR = 2

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p))
if (!CHROME) throw new Error('No Chrome found. Set CHROME_PATH.')

const models = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'lib', 'deviceModels.json'), 'utf8')).models
const ids = process.argv.slice(2).length ? process.argv.slice(2) : models.filter((m) => m.verified).map((m) => m.id)

fs.mkdirSync(OUT, { recursive: true })

const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // software GL, so the render is the same on a machine with no GPU
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  for (const id of ids) {
    const page = await browser.newPage()
    await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: DPR })
    page.on('pageerror', (e) => console.error(`${id}: ${e.message}`))
    await page.goto(`${base}scripts/device-thumbs/index.html?id=${id}`, { waitUntil: 'networkidle0', timeout: 120000 })
    await page.waitForFunction(() => window.__ready === true, { timeout: 120000, polling: 200 })
    const png = await page.screenshot({ omitBackground: true })
    const out = path.join(OUT, `${id}.webp`)
    await sharp(png).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile(out)
    console.log(`${id.padEnd(22)} ${(fs.statSync(out).size / 1024).toFixed(1)}KB`)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
