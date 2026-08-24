import { meshFromColors } from '../lib/meshGradient'
import type { ShotsBackground } from './types'

// ----- color helpers -----

function clamp255(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)))
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex)
  if (!m) return [128, 128, 128]
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, s, l]
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

export function lighten(hex: string, amt: number): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex))
  return hslToHex(h, s, Math.min(1, l + amt))
}

export function darken(hex: string, amt: number): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex))
  return hslToHex(h, s, Math.max(0, l - amt))
}

/** Bump saturation a touch so muted screenshots still yield lively backgrounds. */
function vivid(hex: string): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex))
  return hslToHex(h, Math.min(1, s * 1.25 + 0.1), Math.max(0.35, Math.min(0.72, l)))
}

// ----- palette extraction -----

interface Bucket {
  count: number
  r: number
  g: number
  b: number
}

interface ScoredBucket extends Bucket {
  /** frequency weighted toward saturated, mid-tone pixels */
  score: number
  sat: number
  hue: number
}

function dist(a: Bucket, b: Bucket) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)
}

function hueDist(a: number, b: number) {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

/** How many colors each of the three palettes below carries. */
export const PALETTE_GROUP_SIZE = 6

/** Exactly how many colors `extractPalette` returns: the three groups, back to back. */
export const PALETTE_FULL_SIZE = PALETTE_GROUP_SIZE * 3

/** shots.so-style "Magic": every distinct-ish color in an image, scored. */
function scoredBuckets(source: CanvasImageSource, sw: number, sh: number): ScoredBucket[] {
  const target = 64
  const scale = Math.min(target / Math.max(1, sw), target / Math.max(1, sh), 1)
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(source, 0, 0, w, h)
  const data = g.getImageData(0, 0, w, h).data

  const map = new Map<number, Bucket>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 125) continue
    const r = data[i]
    const gg = data[i + 1]
    const b = data[i + 2]
    const key = ((r >> 3) << 10) | ((gg >> 3) << 5) | (b >> 3)
    const e = map.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    e.count++
    e.r += r
    e.g += gg
    e.b += b
    map.set(key, e)
  }

  return [...map.values()]
    .map((e) => ({ count: e.count, r: e.r / e.count, g: e.g / e.count, b: e.b / e.count }))
    // weight by frequency but favor saturated/mid-tone colors over flat white/black
    .map((e) => {
      const [hue, s, l] = rgbToHsl(e.r, e.g, e.b)
      const interest = 0.4 + s * 0.8 + (1 - Math.abs(l - 0.5)) * 0.4
      return { ...e, score: e.count * interest, sat: s, hue }
    })
    .sort((a, b) => b.score - a.score)
}

/** Greedily take the highest-ranked buckets, skipping ones too close (in raw
 * RGB) to what's already picked; pads with next-best if too few are distinct. */
function pickRanked(sorted: ScoredBucket[], count: number): ScoredBucket[] {
  const picked: ScoredBucket[] = []
  for (const bkt of sorted) {
    if (picked.length >= count) break
    if (picked.every((p) => dist(p, bkt) > 48)) picked.push(bkt)
  }
  for (const bkt of sorted) {
    if (picked.length >= Math.min(3, count)) break
    if (!picked.includes(bkt)) picked.push(bkt)
  }
  return picked
}

/** Same candidates, spread around the hue wheel by farthest-point sampling
 * instead of ranked by prominence, so a small but real patch of green shows
 * up even when it's nowhere near the top by pixel count. */
function pickHueDiverse(sorted: ScoredBucket[], count: number): ScoredBucket[] {
  if (sorted.length === 0) return []
  const picked: ScoredBucket[] = [sorted[0]]
  const remaining = sorted.slice(1)
  while (picked.length < count && remaining.length > 0) {
    let bestIdx = 0
    let bestDist = -1
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.min(...picked.map((p) => hueDist(p.hue, remaining[i].hue)))
      if (d > bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    picked.push(remaining[bestIdx])
    remaining.splice(bestIdx, 1)
  }
  return picked
}

/**
 * Extract three small palettes from an image (shots.so "Magic"), each
 * reading the same pixels a different way, concatenated into one array of
 * `PALETTE_GROUP_SIZE * 3` hex colors:
 *
 *  - Dominant (first group): frequency ranked, favoring saturated mid-tones,
 *    the original single-palette behavior.
 *  - Vibrant (second group): the same candidates re-ranked by saturation
 *    alone, so a small vivid patch can outrank a big dull one.
 *  - Diverse (third group): spread across the hue wheel instead of ranked by
 *    prominence at all, so a color that's real but rare, the one sliver of
 *    green in an otherwise orange screenshot, still gets a slot instead of
 *    being out-voted by everything else every time.
 *
 * Callers that only want the classic single palette can just take the first
 * `PALETTE_GROUP_SIZE` entries; nothing about that slice changed.
 */
export function extractPalette(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  perGroup = PALETTE_GROUP_SIZE,
): string[] {
  const scored = scoredBuckets(source, sw, sh)
  if (scored.length === 0) return []

  /*
   * Every group is padded out to `perGroup`, so the returned length is always
   * exactly three groups and callers can slice group `i` by arithmetic alone.
   *
   * Without this a flat screenshot, which is most app UI, yields fewer than
   * `perGroup` distinct colors, the total comes up short, and the panel can no
   * longer tell "three groups" from "one legacy palette". It then shows the
   * same colors under all three tabs, which is the bug this prevents. Padding
   * repeats the last color rather than inventing one, so a two-color image
   * honestly reads as a two-color image.
   */
  const pad = (list: ScoredBucket[]) => {
    const out = list.slice(0, perGroup)
    while (out.length > 0 && out.length < perGroup) out.push(out[out.length - 1])
    return out
  }

  const dominant = pad(pickRanked(scored, perGroup))
  const vibrant = pad(pickRanked([...scored].sort((a, b) => b.sat - a.sat || b.score - a.score), perGroup))
  const diverse = pad(pickHueDiverse(scored, perGroup))

  return [...dominant, ...vibrant, ...diverse].map((p) => rgbToHex(p.r, p.g, p.b))
}

// ----- background generators -----

type BgPatch = Partial<ShotsBackground>

/** A full mesh spec from a palette, so generated meshes get real blobs too. */
const meshPatch = (colors: string[], seed: number) => ({
  seed,
  colors,
  ...meshFromColors(colors, seed),
})

/** Build shots.so-style "Magic" backgrounds from an extracted palette. */
export function magicBackgrounds(palette: string[]): BgPatch[] {
  if (palette.length === 0) return []
  const c0 = vivid(palette[0])
  const c1 = vivid(palette[1] ?? palette[0])
  const c2 = vivid(palette[2] ?? palette[1] ?? palette[0])
  return [
    { type: 'gradient', gradient: { kind: 'linear', angle: 135, from: c0, to: c1 } },
    { type: 'gradient', gradient: { kind: 'linear', angle: 160, from: c1, to: c2 } },
    { type: 'gradient', gradient: { kind: 'radial', angle: 0, from: lighten(c0, 0.12), to: darken(c0, 0.4) } },
    { type: 'gradient', gradient: { kind: 'linear', angle: 145, from: darken(c0, 0.22), to: darken(c1, 0.42) } },
    { type: 'gradient', gradient: { kind: 'linear', angle: 135, from: lighten(c0, 0.4), to: lighten(c1, 0.42) } },
    { type: 'mesh', mesh: meshPatch(palette.slice(0, 4), 7) },
    { type: 'gradient', gradient: { kind: 'linear', angle: 45, from: c2, to: c0 } },
    { type: 'solid', color: c0 },
  ]
}

/** A pleasing random background (used by the Randomize button). */
export function randomBackground(palette?: string[]): BgPatch {
  const magic = palette && palette.length > 0 ? magicBackgrounds(palette) : []
  const roll = Math.random()
  if (magic.length > 0 && roll < 0.55) {
    return magic[Math.floor(Math.random() * magic.length)]
  }
  if (roll < 0.72) {
    // random mesh from harmonious hues
    const base = Math.random() * 360
    const colors = [0, 40, 200, 320].map((off) =>
      hslToHex(base + off + Math.random() * 30, 0.6 + Math.random() * 0.3, 0.55 + Math.random() * 0.2),
    )
    return { type: 'mesh', mesh: meshPatch(colors, Math.floor(Math.random() * 1e6)) }
  }
  // random gradient with analogous / complementary hues
  const base = Math.random() * 360
  const second = base + (Math.random() < 0.5 ? 25 + Math.random() * 45 : 160 + Math.random() * 40)
  const from = hslToHex(base, 0.68, 0.58)
  const to = hslToHex(second, 0.66, 0.5)
  return {
    type: 'gradient',
    gradient: {
      kind: Math.random() < 0.3 ? 'radial' : 'linear',
      angle: Math.round(Math.random() * 360),
      from,
      to,
    },
  }
}
