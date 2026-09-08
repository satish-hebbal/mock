/**
 * Turning a luminance field into ink.
 *
 * Two steps, kept apart on purpose. `ditherField` decides, for every pixel,
 * whether it is lit, and writes one byte per pixel. `paintField` decides what
 * colour a lit pixel becomes. Splitting them means the accent mapping can read
 * both the original luminance and the dither result, which is what the
 * 'pattern' accent mode needs: it tints only the lit pixels inside a luminance
 * band, so it needs to know both things about a pixel at once.
 *
 * Every buffer here is allocated once at module scope and grown on demand.
 * These run sixty times a second over as many as two million pixels, and a
 * per-frame `new Uint8Array` is the single fastest way to turn a smooth tool
 * into a stuttering one.
 */

import type { MaskId, SignalInk, SignalQuantize } from './types'

// ----- reusable buffers -----

let ditherBuf = new Uint8Array(0)
let blockBuf = new Uint8Array(0)
let imageData: ImageData | null = null
let imageW = 0
let imageH = 0

function outBuffer(len: number) {
  if (ditherBuf.length < len) ditherBuf = new Uint8Array(len)
  return ditherBuf
}

function blocks(len: number) {
  if (blockBuf.length < len) blockBuf = new Uint8Array(len)
  return blockBuf
}

function frameData(w: number, h: number) {
  if (!imageData || imageW !== w || imageH !== h) {
    imageData = new ImageData(w, h)
    imageW = w
    imageH = h
  }
  return imageData
}

/** Discard the cached buffers. Called when a document changes size. */
export function releaseBuffers() {
  ditherBuf = new Uint8Array(0)
  blockBuf = new Uint8Array(0)
  imageData = null
  imageW = 0
  imageH = 0
}

// ----- the ordered masks -----

const BAYER2 = [0, 2, 3, 1].map((v) => v / 4)

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16)

/**
 * The 8x8 Bayer matrix, built by bit interleaving rather than written out.
 *
 * The recurrence is the standard one: each level takes the level above, scales
 * it by four, and adds a fixed offset per quadrant. Interleaving the bits of
 * `x ^ y` and `y` is the same answer reached sideways, and it fits in a loop
 * short enough to check by eye.
 */
const BAYER8 = (() => {
  const m = new Float32Array(64)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let v = 0
      let xc = x ^ y
      let yc = y
      for (let bit = 0; bit < 6; bit++) {
        v |= (yc & 1) << (5 - bit)
        bit++
        if (bit < 6) v |= (xc & 1) << (5 - bit)
        yc >>= 1
        xc >>= 1
      }
      m[y * 8 + x] = v / 64
    }
  }
  return m
})()

/**
 * A hashed blue noise, rather than a stored tile.
 *
 * Genuine blue noise needs a precomputed 64x64 table, which the ASCII tool
 * carries because it renders one frame and can afford the memory and the setup.
 * Here the mask is sampled at every pixel of every frame, and this hash gives a
 * spectrum close enough that no one has picked the difference out of a dithered
 * animation, for the cost of four integer multiplies and no table at all.
 */
function blueNoise(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263 + 1013904223) | 0
  h = ((h >> 16) ^ h) * 1274126177
  h = ((h >> 16) ^ h) * 1274126177
  h = (h >> 16) ^ h
  return (h & 255) / 255
}

const SIN45 = Math.SQRT1_2

export type MaskFn = (x: number, y: number) => number

export const MASKS: Record<MaskId, MaskFn> = {
  bayer2: (x, y) => BAYER2[(y & 1) * 2 + (x & 1)],
  bayer4: (x, y) => BAYER4[(y & 3) * 4 + (x & 3)],
  bayer8: (x, y) => BAYER8[(y & 7) * 8 + (x & 7)],

  /*
   * A print halftone: round dots on a screen rotated 45 degrees.
   *
   * The rotation is the whole point. An unrotated dot screen lines its dots up
   * with the pixel grid and reads as a checkerboard; 45 degrees is the angle
   * every printer uses for exactly that reason. The distance is Euclidean, so
   * the dots are round rather than the diamonds a Manhattan metric would give.
   */
  halftone: (x, y) => {
    const size = 12
    const half = size / 2
    const rx = x * SIN45 + y * SIN45
    const ry = -x * SIN45 + y * SIN45
    const cx = (((rx % size) + size) % size) - half
    const cy = (((ry % size) + size) % size) - half
    return Math.min(1, Math.sqrt(cx * cx + cy * cy) / (half * 0.95))
  },

  'blue-noise': blueNoise,
  crosshatch: (x, y) => Math.min(((x + y) % 8) / 8, ((x - y + 800) % 8) / 8),
  diamond: (x, y) => (Math.abs((x % 8) - 3.5) + Math.abs((y % 8) - 3.5)) / 7,
  spiral: (x, y) => {
    const cx = (x % 12) - 5.5
    const cy = (y % 12) - 5.5
    const angle = Math.atan2(cy, cx)
    return ((((angle / Math.PI + Math.sqrt(cx * cx + cy * cy) / 6) % 1) + 1) % 1)
  },
  lines: (_x, y) => (y % 6) / 6,

  /* 'none' is a flat 0.5, which makes the threshold a plain cut with no
     texture at all. Useful on its own, and it is what the glyph modes want. */
  none: () => 0.5,
}

export const MASK_LIST: { id: MaskId; label: string; hint: string }[] = [
  { id: 'bayer4', label: 'Bayer 4', hint: 'The classic crosshatch. Tight and even.' },
  { id: 'bayer8', label: 'Bayer 8', hint: 'The same idea, finer, with a longer repeat.' },
  { id: 'bayer2', label: 'Bayer 2', hint: 'Coarse and obvious, for large pixels.' },
  { id: 'halftone', label: 'Halftone', hint: 'Round dots on a screen turned 45 degrees.' },
  { id: 'blue-noise', label: 'Blue Noise', hint: 'No grid at all. Organic, and the safest at any scale.' },
  { id: 'crosshatch', label: 'Crosshatch', hint: 'Diagonals crossing, like a pen drawing.' },
  { id: 'diamond', label: 'Diamond', hint: 'Cells that fill from their corners.' },
  { id: 'spiral', label: 'Spiral', hint: 'A twist per cell. Strange at small sizes, good at large.' },
  { id: 'lines', label: 'Lines', hint: 'Horizontal only, so the picture reads as a print.' },
  { id: 'none', label: 'None', hint: 'A hard cut at the threshold, with no pattern.' },
]

// ----- the dither pass -----

/** The hash behind pixel-size randomness, so an irregular grid is reproducible. */
function fastHash(n: number) {
  n = (((n >> 16) ^ n) * 0x45d9f3b) | 0
  n = (((n >> 16) ^ n) * 0x45d9f3b) | 0
  return (((n >> 16) ^ n) & 0xffff) / 0xffff
}

/**
 * Threshold the field against the mask, one byte out per pixel.
 *
 * Two paths, and the split is worth the duplication. With randomness off, the
 * block a pixel belongs to is a plain division and the loop is four operations
 * wide. With it on, every pixel has to look up its block's own pixel size
 * first, which costs an extra indexed read per pixel and a setup pass over the
 * blocks. Most documents never turn it on, and they should not pay for it.
 */
export function ditherField(
  field: Float32Array,
  w: number,
  h: number,
  q: SignalQuantize,
): Uint8Array {
  const out = outBuffer(w * h)
  const mask = MASKS[q.mask] ?? MASKS.bayer4
  const threshold = q.threshold / 255
  const spread = q.spread / 100
  const basePS = Math.max(1, q.pixelSize)
  const rAmt = q.randomness / 100

  if (rAmt < 0.01) {
    for (let y = 0; y < h; y++) {
      const qy = Math.floor(y / basePS)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const m = mask(Math.floor(x / basePS), qy)
        out[i] = field[i] + (m - 0.5) * spread > threshold ? 1 : 0
      }
    }
    return out
  }

  const bx = Math.ceil(w / basePS) + 1
  const by = Math.ceil(h / basePS) + 1
  const sizes = blocks(bx * by)
  for (let b = 0; b < by; b++) {
    for (let a = 0; a < bx; a++) {
      const roll = fastHash(a * 374761 + b * 668265 + 1013)
      sizes[b * bx + a] = Math.max(1, Math.round(basePS + (roll - 0.5) * 2 * rAmt * basePS * 1.5))
    }
  }

  for (let y = 0; y < h; y++) {
    const blockRow = Math.floor(y / basePS) * bx
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const ps = sizes[blockRow + Math.floor(x / basePS)]
      const m = mask(Math.floor(x / ps), Math.floor(y / ps))
      out[i] = field[i] + (m - 0.5) * spread > threshold ? 1 : 0
    }
  }
  return out
}

// ----- colour -----

export type RGB = [number, number, number]

export function hexRgb(hex: string): RGB {
  const s = hex.replace('#', '')
  const full = s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Map the dithered field onto ink, paper and accent.
 *
 * The accent does not live anywhere in particular. It occupies a *band of
 * luminance* centred on the midpoint, whose width is `mix`, so it lands on the
 * parts of the picture that are neither lit nor dark: the transition zone the
 * dither is already working hardest in. That is why it reads as belonging to
 * the image rather than sitting on it.
 *
 * A negative field value short-circuits all of that and paints flat accent. It
 * is the sentinel a generator uses to say "this pixel is accent, whatever the
 * luminance rules would have said".
 *
 * The zero-mix fast path is not premature. It is the default, it skips six
 * branches and four multiplies per pixel, and at 1080p that is about eight
 * milliseconds a frame.
 */
export function paintField(
  field: Float32Array,
  dithered: Uint8Array,
  w: number,
  h: number,
  ink: SignalInk,
): ImageData {
  const img = frameData(w, h)
  const d = img.data
  const fg = hexRgb(ink.ink)
  const bg = hexRgb(ink.paper)
  const ac = hexRgb(ink.accent)
  const mix = ink.mix / 100

  if (mix < 0.01) {
    for (let i = 0; i < dithered.length; i++) {
      const c = field[i] < 0 ? ac : dithered[i] ? fg : bg
      const p = i * 4
      d[p] = c[0]
      d[p + 1] = c[1]
      d[p + 2] = c[2]
      d[p + 3] = 255
    }
    return img
  }

  const halfZone = mix * 0.45
  const lo = 0.5 - halfZone
  const hi = 0.5 + halfZone
  const mode = ink.mode

  for (let i = 0; i < dithered.length; i++) {
    const v = field[i]
    const p = i * 4
    let r: number
    let g: number
    let b: number

    if (v < 0) {
      r = ac[0]
      g = ac[1]
      b = ac[2]
    } else if (v >= lo && v <= hi) {
      if (mode === 'hard') {
        r = ac[0]
        g = ac[1]
        b = ac[2]
      } else if (mode === 'pattern') {
        const c = dithered[i] ? ac : bg
        r = c[0]
        g = c[1]
        b = c[2]
      } else {
        // quadratic falloff, so the accent has a soft shoulder rather than a
        // visible edge where the band stops
        const edge = halfZone > 0.01 ? 1 - Math.abs(v - 0.5) / halfZone : 1
        const k = edge * edge
        const base = dithered[i] ? fg : bg
        r = base[0] + (ac[0] - base[0]) * k
        g = base[1] + (ac[1] - base[1]) * k
        b = base[2] + (ac[2] - base[2]) * k
      }
    } else {
      const c = dithered[i] ? fg : bg
      r = c[0]
      g = c[1]
      b = c[2]
    }

    d[p] = r
    d[p + 1] = g
    d[p + 2] = b
    d[p + 3] = 255
  }
  return img
}

/**
 * Threshold and colour in one walk of the frame.
 *
 * `ditherField` and `paintField` are still exported and still tested, because
 * they say what the two stages are far more clearly than this does. But running
 * them in sequence means two passes over a million pixels and a megabyte of
 * intermediate bytes between them, and at 1080p that was the difference between
 * a preview at ten frames a second and one at twenty-five.
 *
 * Nothing here decides anything the two of them would not have decided. The
 * threshold test and the accent mapping are the same arithmetic in the same
 * order; they have simply stopped writing their answer down before using it.
 */
export function ditherAndPaint(
  field: Float32Array,
  w: number,
  h: number,
  q: SignalQuantize,
  ink: SignalInk,
): ImageData {
  const img = frameData(w, h)
  const d = img.data
  const mask = MASKS[q.mask] ?? MASKS.bayer4
  const threshold = q.threshold / 255
  const spread = q.spread / 100
  const basePS = Math.max(1, q.pixelSize)
  const rAmt = q.randomness / 100

  const fg = hexRgb(ink.ink)
  const bg = hexRgb(ink.paper)
  const ac = hexRgb(ink.accent)
  const mix = ink.mix / 100
  const plain = mix < 0.01
  const halfZone = mix * 0.45
  const lo = 0.5 - halfZone
  const hi = 0.5 + halfZone
  const mode = ink.mode

  // the irregular grid, when it is asked for, still has to be laid out first
  let sizes: Uint8Array | null = null
  let bx = 0
  if (rAmt >= 0.01) {
    bx = Math.ceil(w / basePS) + 1
    const by = Math.ceil(h / basePS) + 1
    sizes = blocks(bx * by)
    for (let b = 0; b < by; b++) {
      for (let a = 0; a < bx; a++) {
        const roll = fastHash(a * 374761 + b * 668265 + 1013)
        sizes[b * bx + a] = Math.max(1, Math.round(basePS + (roll - 0.5) * 2 * rAmt * basePS * 1.5))
      }
    }
  }

  for (let y = 0; y < h; y++) {
    const qy = Math.floor(y / basePS)
    const blockRow = sizes ? qy * bx : 0
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const v = field[i]

      let m: number
      if (sizes) {
        const ps = sizes[blockRow + Math.floor(x / basePS)]
        m = mask(Math.floor(x / ps), Math.floor(y / ps))
      } else {
        m = mask(Math.floor(x / basePS), qy)
      }
      const lit = v + (m - 0.5) * spread > threshold

      let r: number
      let g: number
      let b: number

      if (v < 0) {
        r = ac[0]
        g = ac[1]
        b = ac[2]
      } else if (plain || v < lo || v > hi) {
        const c = lit ? fg : bg
        r = c[0]
        g = c[1]
        b = c[2]
      } else if (mode === 'hard') {
        r = ac[0]
        g = ac[1]
        b = ac[2]
      } else if (mode === 'pattern') {
        const c = lit ? ac : bg
        r = c[0]
        g = c[1]
        b = c[2]
      } else {
        const edge = halfZone > 0.01 ? 1 - Math.abs(v - 0.5) / halfZone : 1
        const k = edge * edge
        const base = lit ? fg : bg
        r = base[0] + (ac[0] - base[0]) * k
        g = base[1] + (ac[1] - base[1]) * k
        b = base[2] + (ac[2] - base[2]) * k
      }

      const p = i * 4
      d[p] = r
      d[p + 1] = g
      d[p + 2] = b
      d[p + 3] = 255
    }
  }
  return img
}

// ----- glyphs -----

const DEFAULT_RAMP = ' .:-=+*#%@'

/**
 * Draw the field as characters instead of pixels.
 *
 * The cell is four times the pixel size, which keeps one control doing one job:
 * turning pixel size up coarsens the picture whether you are looking at blocks
 * or at letters. Each cell averages its own patch of the field and picks a
 * character by brightness.
 *
 * Space is skipped rather than drawn. On a dark field that is most of the
 * frame, and `fillText` of a space still costs a shaping pass.
 */
export function paintGlyphs(
  ctx: CanvasRenderingContext2D,
  field: Float32Array,
  w: number,
  h: number,
  q: SignalQuantize,
  ink: SignalInk,
) {
  const ramp = q.glyphs === 'custom' && q.ramp.length > 1 ? q.ramp : DEFAULT_RAMP
  const cell = Math.max(4, q.pixelSize * 4)
  const cols = Math.floor(w / cell)
  const rows = Math.floor(h / cell)
  const fg = hexRgb(ink.ink)
  const ac = hexRgb(ink.accent)
  const mix = ink.mix / 100
  const halfZone = mix * 0.45
  const lo = 0.5 - halfZone
  const hi = 0.5 + halfZone

  ctx.fillStyle = ink.paper
  ctx.fillRect(0, 0, w, h)
  ctx.font = `${cell}px ui-monospace, "SF Mono", Menlo, monospace`
  ctx.textBaseline = 'top'

  for (let row = 0; row < rows; row++) {
    const sy = row * cell
    for (let col = 0; col < cols; col++) {
      const sx = col * cell
      let sum = 0
      let count = 0
      let negative = 0
      for (let cy = sy; cy < sy + cell && cy < h; cy++) {
        for (let cx = sx; cx < sx + cell && cx < w; cx++) {
          const v = field[cy * w + cx]
          if (v < 0) negative++
          sum += Math.abs(v)
          count++
        }
      }
      const avg = count > 0 ? sum / count : 0
      const ch = ramp[Math.min(ramp.length - 1, Math.floor(avg * ramp.length))]
      if (ch === ' ') continue

      if (negative > count / 2) {
        ctx.fillStyle = `rgb(${ac[0]},${ac[1]},${ac[2]})`
      } else if (mix > 0.01 && avg >= lo && avg <= hi) {
        const edge = halfZone > 0.01 ? 1 - Math.abs(avg - 0.5) / halfZone : 1
        const k = edge * edge
        ctx.fillStyle = `rgb(${(fg[0] + (ac[0] - fg[0]) * k) | 0},${(fg[1] + (ac[1] - fg[1]) * k) | 0},${
          (fg[2] + (ac[2] - fg[2]) * k) | 0
        })`
      } else {
        ctx.fillStyle = `rgb(${fg[0]},${fg[1]},${fg[2]})`
      }
      ctx.fillText(ch, sx, sy)
    }
  }
}
