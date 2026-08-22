/**
 * Preset background image processor.
 *
 * Reads assets-src/preset-bgs/<category>/*.{jpg,jpeg,png,heic,heif}, writes
 * public/preset-bgs/<category>/<category>-NN.webp (+ -thumb.webp) for the
 * preset picker. HEIC/HEIF sources are decoded via heic-convert first — the
 * sharp build in this project only reads .avif, not real HEIC, since Apple's
 * HEIC codec is patent-encumbered and left out of sharp's prebuilt binaries.
 *
 * Presets aren't pre-cropped to any fixed aspect: the app already fills
 * whatever frame is active via drawCover() (src/shots/render.ts), so a
 * single reasonably-sized source per preset covers every ratio.
 *
 * Idempotent by design: assets-src/preset-bgs/manifest.json remembers which
 * source file earned which serial number, so re-running after dropping in a
 * few new images only converts the new ones — it doesn't re-derive slug
 * names for sources that already have a serial id (that used to duplicate
 * the whole catalog on every run). A source mapped to `null` in the manifest
 * was deliberately removed (e.g. a near-duplicate) and stays skipped rather
 * than being re-assigned a new number.
 *
 * Any non-webp file left in public/preset-bgs/ is treated as a source and
 * moved into assets-src/ for you, same as optimize-shadows.mjs.
 *
 * Usage: node scripts/optimize-presets.mjs [--max=1600] [--thumb=360]
 */
import { mkdir, readdir, readFile as fsReadFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import convertHeic from 'heic-convert'

const SRC_DIR = 'assets-src/preset-bgs'
const OUT_DIR = 'public/preset-bgs'
const MANIFEST_PATH = path.join(SRC_DIR, 'manifest.json')
const SOURCE_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp'])
const HEIC_EXT = new Set(['.heic', '.heif'])

/**
 * What this script itself writes: `<category>-07.webp` and its thumb.
 *
 * Sources are told apart from output by *name*, not by extension. Extension
 * alone worked only while no source was ever a WebP, and the moment one is,
 * treating every .webp as a source would sweep the entire generated catalog
 * back out of public/ on the next run.
 */
const outputName = (cat) => new RegExp(`^${cat}-\\d+(-thumb)?\\.webp$`)

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? Number(hit.split('=')[1]) : fallback
}
const MAX = opt('max', 1600)
const THUMB = opt('thumb', 360)

/*
 * Filenames that are recognizably official Apple wallpapers, dynamic
 * desktop pictures, or Aerial/NatGeo screensaver frames rather than
 * generic stock photography — excluded so the app doesn't ship someone
 * else's copyrighted OS assets as product presets. Keyed by category
 * folder so the same generic name in a different folder isn't caught by
 * accident.
 */
const EXCLUDE = {
  abstract: new Set([
    'Appearance_Light.png',
    'Big Sur Night Grasses.heic',
    'Big Sur Night Succulents.heic',
    'Chroma 1.jpg',
    'Chroma Blue.heic',
    'Chroma Red.heic',
    'Iridescence-Dark.png',
    'MBA2020.png',
    'Mac-Pro-macOS-Catalina-Wallpaper.jpg',
    'Mac.png',
    'Monterey Graphic.heic',
    'NatGeo11.jpg',
    'NatGeo14.jpg',
    'Aerial01.jpg',
    'Aerial02.jpg',
    'Aerial06.jpg',
    'Aerial08.jpg',
    'Panther Aqua Blue.jpg',
    'Radial Purple.heic',
    'Sonoma.heic',
    'Ventura 13.heic',
    'Ventura dark.jpg',
    'black_unity_22_wallpaper_mac.png',
    'hello Blue.heic',
    'hello Grey.heic',
    'hello Purple.heic',
    'hello-Blue-2-dragged.jpg',
    'hello-Green-2-dragged.jpg',
    'hello-Orange-2-dragged.jpg',
    'hello-Purple-2-dragged.jpg',
    'hello-Red-2-dragged.jpg',
    'hello-Yellow-2-dragged.jpg',
    'osx_hero_2x.jpg',
  ]),
  nature: new Set([
    'Appearance Dynamic.heic',
    'Appearance Dynamic_2.png',
    'Appearance Dynamic_5.png',
    'Appearance Dynamic_6.png',
    'Big Sur Aerial.heic',
    'Big Sur Coastline.heic',
    'Big Sur Horizon.heic',
    'Big Sur Mountains.heic',
    'Big Sur Road.heic',
    'Big Sur Waters Edge.heic',
    'Catalina Shoreline.heic',
    'Catalina Silhouette.heic',
    'Dome.heic',
    'Dome-2-dragged.jpg',
    'Dynamic.heic',
    'Mojave (Dynamic) 01.heic',
    'Mojave (Dynamic) 14.heic',
    'Mojave Day.jpg',
    'Mojave Night.jpg',
    'Peak.heic',
    'Peak-2-dragged.jpg',
    'Aerial03.jpg',
    'Aerial04.jpg',
    'Aerial05.jpg',
    'Aerial06.jpg',
    'Aerial07.jpg',
    'Aerial08.jpg',
    'Aerial09.jpg',
    'NatGeo01.jpg',
    'NatGeo03.jpg',
    'NatGeo04.jpg',
    'NatGeo05.jpg',
    'NatGeo07.jpg',
    'NatGeo09.jpg',
    'NatGeo11.jpg',
    'NatGeo12.jpg',
    'NatGeo15.jpg',
    'NatGeo16.jpg',
    'NatGeo17.jpg',
  ]),
}

/** Move anything droppable into public/preset-bgs back to the source folder. */
async function collectStrays() {
  let cats = []
  try {
    cats = (await readdir(OUT_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return
  }
  for (const cat of cats) {
    const outCat = path.join(OUT_DIR, cat)
    const names = await readdir(outCat)
    const isOutput = outputName(cat)
    for (const name of names) {
      if (isOutput.test(name)) continue
      if (!SOURCE_EXT.has(path.extname(name).toLowerCase())) continue
      await mkdir(path.join(SRC_DIR, cat), { recursive: true })
      await rename(path.join(outCat, name), path.join(SRC_DIR, cat, name))
      console.log(`moved ${cat}/${name} out of public/ into ${SRC_DIR}/${cat}/`)
    }
  }
}

async function loadManifest() {
  try {
    return JSON.parse(await fsReadFile(MANIFEST_PATH, 'utf8'))
  } catch {
    return {}
  }
}

async function saveManifest(manifest) {
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
}

async function outputsExist(cat, id) {
  try {
    await stat(path.join(OUT_DIR, cat, `${id}.webp`))
    await stat(path.join(OUT_DIR, cat, `${id}-thumb.webp`))
    return true
  } catch {
    return false
  }
}

function nextId(cat, manifest) {
  const used = Object.values(manifest[cat] ?? {})
    .filter((id) => id) // skip nulled-out (deliberately removed) entries
    .map((id) => Number(id.slice(cat.length + 1)))
  const n = (used.length ? Math.max(...used) : 0) + 1
  return `${cat}-${String(n).padStart(2, '0')}`
}

/** Decode any supported source into a sharp() pipeline, EXIF-rotated upright. */
async function openImage(file) {
  const ext = path.extname(file).toLowerCase()
  if (HEIC_EXT.has(ext)) {
    const inputBuffer = await fsReadFile(file)
    const outputBuffer = await convertHeic({ buffer: inputBuffer, format: 'JPEG', quality: 0.95 })
    return sharp(outputBuffer).rotate()
  }
  return sharp(file).rotate()
}

async function convert(cat, file, id) {
  const src = path.join(SRC_DIR, cat, file)
  const before = (await stat(src)).size

  const full = await openImage(src)
  const dest = path.join(OUT_DIR, cat, `${id}.webp`)
  await full.resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(dest)

  const thumbImg = await openImage(src)
  const thumb = path.join(OUT_DIR, cat, `${id}-thumb.webp`)
  await thumbImg.resize({ width: THUMB, height: THUMB, fit: 'inside' }).webp({ quality: 70 }).toFile(thumb)

  const after = (await stat(dest)).size
  const small = (await stat(thumb)).size
  const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`)
  console.log(`${cat}/${file} -> ${id}.webp  ${kb(before)} -> ${kb(after)} (+${kb(small)} thumb)`)
}

await mkdir(SRC_DIR, { recursive: true })
await mkdir(OUT_DIR, { recursive: true })
await collectStrays()

const categories = (await readdir(SRC_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)

if (!categories.length) {
  console.log(`nothing to do: drop preset images under ${SRC_DIR}/<category>/`)
} else {
  const manifest = await loadManifest()
  let converted = 0
  let skipped = 0
  let upToDate = 0

  for (const cat of categories) {
    await mkdir(path.join(OUT_DIR, cat), { recursive: true })
    manifest[cat] ??= {}
    const files = (await readdir(path.join(SRC_DIR, cat))).filter((f) => SOURCE_EXT.has(path.extname(f).toLowerCase()))
    const excludeSet = EXCLUDE[cat] ?? new Set()

    for (const f of files) {
      if (excludeSet.has(f)) {
        console.log(`skip (Apple-branded): ${cat}/${f}`)
        skipped++
        continue
      }

      const known = manifest[cat][f]
      if (known === null) continue // deliberately removed; never re-add

      if (known && (await outputsExist(cat, known))) {
        upToDate++
        continue
      }

      const id = known ?? nextId(cat, manifest)
      await convert(cat, f, id)
      manifest[cat][f] = id
      converted++
    }
  }

  await saveManifest(manifest)
  console.log(
    `\n${converted} converted, ${upToDate} already up to date, ${skipped} skipped as Apple-branded/screensaver assets.`,
  )
}
