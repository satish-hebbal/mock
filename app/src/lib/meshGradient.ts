// Procedural mesh-gradient background (PRD §6.4) — seeded, deterministic.

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Paint a mesh gradient onto the given 2D context, deterministically from seed. */
export function paintMeshGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  colors: string[],
) {
  const rnd = mulberry32(seed || 1)
  ctx.save()
  ctx.fillStyle = colors[0] ?? '#8b9dc3'
  ctx.fillRect(0, 0, w, h)
  const blobs = 6
  ctx.globalCompositeOperation = 'source-over'
  for (let i = 0; i < blobs; i++) {
    const cx = rnd() * w
    const cy = rnd() * h
    const r = (0.35 + rnd() * 0.55) * Math.max(w, h)
    const color = colors[(i + 1) % Math.max(1, colors.length)] ?? '#ffffff'
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, color)
    g.addColorStop(1, `${color}00`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  ctx.restore()
}

const cache = new Map<string, string>()

/** Data-URL of a rendered mesh gradient, cached by seed+colors (for CSS preview). */
export function meshGradientDataURL(seed: number, colors: string[]): string {
  const key = `${seed}|${colors.join(',')}`
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 400
  paintMeshGradient(c.getContext('2d')!, c.width, c.height, seed, colors)
  const url = c.toDataURL('image/png')
  if (cache.size > 24) cache.clear()
  cache.set(key, url)
  return url
}

export const MESH_PALETTES: string[][] = [
  ['#a18cd1', '#fbc2eb', '#8ec5fc', '#e0c3fc'],
  ['#0f2027', '#2c5364', '#4ca1af', '#203a43'],
  ['#ff9a9e', '#fad0c4', '#fbc2eb', '#a18cd1'],
  ['#84fab0', '#8fd3f4', '#a1c4fd', '#c2e9fb'],
  ['#f6d365', '#fda085', '#f5576c', '#f093fb'],
  ['#1a1a2e', '#16213e', '#0f3460', '#533483'],
]
