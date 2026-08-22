/**
 * Shadow-scene (gobo) processor.
 *
 * Sources are greyscale photographs of a shadow on a white wall: black where
 * the light is blocked, white where it isn't. What the app actually wants is
 * the shadow *alone*, so this converts luminance into alpha and throws the
 * white away: every pixel becomes black, and its opacity becomes how dark it
 * was. The soft penumbra survives exactly, which is what a manual
 * background-removal pass destroys.
 *
 * Doing it here rather than in the browser matters twice over: the app never
 * ships the 2MB source, and the WebP it does ship is already in the form the
 * compositor needs, so preview and export both just draw an image.
 *
 * `--trim` crops the bottom-right corner, where generative models stamp their
 * watermark. The patterns are abstract and run off every edge, so losing a
 * corner costs nothing; leaving a grey star in the middle of a shadow costs a
 * lot. Pass `--trim=0` for a clean source.
 *
 * Usage: node scripts/optimize-shadows.mjs [--trim=0.15] [--max=1400] [file ...]
 * Reads assets-src/shadows/, writes public/shadows/*.webp. Any non-WebP left in
 * public/shadows/ is treated as a source and moved into assets-src/ for you.
 */
import { mkdir, readdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const SRC_DIR = 'assets-src/shadows'
const OUT_DIR = 'public/shadows'
const SOURCE_EXT = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff'])

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? Number(hit.split('=')[1]) : fallback
}
const TRIM = opt('trim', 0.15)
const MAX = opt('max', 1400)
const THUMB = opt('thumb', 220)

/*
 * Per-source corrections, for images that do not sit with the rest of the set.
 *
 * `soften` is a blur radius as a fraction of the working width, so it means the
 * same thing whatever `--max` is set to, and `gain` scales the resulting alpha.
 *
 * Only `monstera-01` needs them: it was generated before the prompt asked for
 * diffused light, so it came out near-binary, hard-edged and far denser than
 * everything made after. Blurring gives it the penumbra a real shadow has and
 * the gain brings its weight into line, which is cheaper than regenerating it
 * and keeps the asset that was already tested.
 */
const TUNING = {
  'monstera-01': { soften: 0.01, gain: 0.75 },
}

const slug = (file) =>
  path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Move anything droppable into public/shadows back to the source folder. */
async function collectStrays() {
  let names = []
  try {
    names = await readdir(OUT_DIR)
  } catch {
    return
  }
  for (const name of names) {
    if (!SOURCE_EXT.has(path.extname(name).toLowerCase())) continue
    await rename(path.join(OUT_DIR, name), path.join(SRC_DIR, name))
    console.log(`moved ${name} out of public/ into ${SRC_DIR}/`)
  }
}

async function convert(file) {
  const src = path.join(SRC_DIR, file)
  const img = sharp(src)
  const meta = await img.metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  if (!w || !h) throw new Error(`${file}: no dimensions`)

  // keep the top-left square; the watermark lives in the opposite corner
  const keepW = Math.max(1, Math.round(w * (1 - TRIM)))
  const keepH = Math.max(1, Math.round(h * (1 - TRIM)))

  const tune = TUNING[slug(file)] ?? {}
  let pipe = img
    .extract({ left: 0, top: 0, width: keepW, height: keepH })
    .resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true })
    .greyscale()
  if (tune.soften) pipe = pipe.blur(tune.soften * Math.min(MAX, keepW))

  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true })

  // luminance -> alpha, colour -> flat black
  const gain = tune.gain ?? 1
  const out = Buffer.alloc(info.width * info.height * 4)
  for (let i = 0; i < info.width * info.height; i++) {
    out[i * 4 + 3] = Math.round((255 - data[i * info.channels]) * gain)
  }

  const raw = { raw: { width: info.width, height: info.height, channels: 4 } }

  const dest = path.join(OUT_DIR, `${slug(file)}.webp`)
  /*
   * The alpha channel carries the entire picture here, since every RGB pixel is
   * the same black, so `alphaQuality` is the only lever that matters. WebP
   * switches to lossy alpha below 80 and the file drops roughly fourfold with
   * no banding a shadow this soft would ever show.
   */
  await sharp(out, raw).webp({ quality: 82, alphaQuality: 70 }).toFile(dest)

  // the picker draws every scene at once, so it gets its own small copy
  const thumb = path.join(OUT_DIR, `${slug(file)}-thumb.webp`)
  await sharp(out, raw)
    .resize({ width: THUMB, height: THUMB, fit: 'inside' })
    .webp({ quality: 70, alphaQuality: 50 })
    .toFile(thumb)

  const before = (await stat(src)).size
  const after = (await stat(dest)).size
  const small = (await stat(thumb)).size
  const kb = (n) => `${Math.round(n / 1024)}KB`
  console.log(
    `${file} -> ${path.basename(dest)}  ${info.width}x${info.height}  ` +
      `${kb(before)} -> ${kb(after)} (+${kb(small)} thumb)`,
  )
}

await mkdir(SRC_DIR, { recursive: true })
await mkdir(OUT_DIR, { recursive: true })
await collectStrays()

const explicit = args.filter((a) => !a.startsWith('--')).map((a) => path.basename(a))
const files = explicit.length
  ? explicit
  : (await readdir(SRC_DIR)).filter((f) => SOURCE_EXT.has(path.extname(f).toLowerCase()))

if (!files.length) {
  console.log(`nothing to do: drop greyscale shadow images in ${SRC_DIR}/`)
} else {
  for (const f of files) await convert(f)
}
