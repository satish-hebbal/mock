/**
 * A small image toolkit, for the parts of the pipeline that work on pixels
 * rather than on cells: the whole-frame styles in `process.ts` and the layer
 * filters in `filters.ts`.
 *
 * Everything here is deterministic. There is no `Math.random` anywhere, for the
 * reason the cell renderer already gives: the preview and the export are two
 * separate calls, and a frosted glass that re-rolled its grain between them
 * would export a different picture from the one on screen.
 */

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: true })!
}

export function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  const s = src as { videoWidth?: number; videoHeight?: number; width?: number; height?: number }
  const w = s.videoWidth || (typeof s.width === 'number' ? s.width : 0)
  const h = s.videoHeight || (typeof s.height === 'number' ? s.height : 0)
  return { w, h }
}

/** `src` drawn to cover `w` x `h`, cropping the overflow. */
export function cover(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const out = canvas(w, h)
  const ctx = ctx2d(out)
  const { w: sw, h: sh } = sourceSize(src)
  if (!sw || !sh) return out
  const k = Math.max(out.width / sw, out.height / sh)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, (out.width - sw * k) / 2, (out.height - sh * k) / 2, sw * k, sh * k)
  return out
}

export function read(c: HTMLCanvasElement): ImageData {
  return ctx2d(c).getImageData(0, 0, c.width, c.height)
}

export function fromData(img: ImageData): HTMLCanvasElement {
  const c = canvas(img.width, img.height)
  ctx2d(c).putImageData(img, 0, 0)
  return c
}

export function copy(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = canvas(c.width, c.height)
  ctx2d(out).drawImage(c, 0, 0)
  return out
}

/** 0..1 luminance per pixel. */
export function lumaOf(img: ImageData): Float32Array {
  const d = img.data
  const out = new Float32Array(img.width * img.height)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255
  }
  return out
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** Integer hash to 0..1, stable per position and salt. */
export function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967295
}

/** Smooth value noise, 0..1. */
export function noise(x: number, y: number, salt = 0): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi, salt)
  const b = hash(xi + 1, yi, salt)
  const c = hash(xi, yi + 1, salt)
  const d = hash(xi + 1, yi + 1, salt)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Three octaves of value noise, 0..1. */
export function fbm(x: number, y: number, salt = 0): number {
  return (noise(x, y, salt) * 0.57 + noise(x * 2.03, y * 2.03, salt + 1) * 0.29 + noise(x * 4.1, y * 4.1, salt + 2) * 0.14)
}

/**
 * Inverse warp: for every output pixel, `map` says where in the source to read.
 *
 * Bilinear, and clamped at the edges rather than wrapped or left transparent,
 * because a distortion that pulls from outside the frame should smear the
 * border in, not punch a hole in the picture.
 */
export function warp(
  src: HTMLCanvasElement,
  map: (x: number, y: number, out: Float64Array) => void,
): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const s = read(src).data
  const out = new ImageData(w, h)
  const d = out.data
  const at = new Float64Array(2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      at[0] = x
      at[1] = y
      map(x + 0.5, y + 0.5, at)
      let sx = at[0] - 0.5
      let sy = at[1] - 0.5
      if (!(sx === sx)) sx = x
      if (!(sy === sy)) sy = y
      sx = sx < 0 ? 0 : sx > w - 1 ? w - 1 : sx
      sy = sy < 0 ? 0 : sy > h - 1 ? h - 1 : sy
      const x0 = sx | 0
      const y0 = sy | 0
      const x1 = x0 + 1 < w ? x0 + 1 : x0
      const y1 = y0 + 1 < h ? y0 + 1 : y0
      const fx = sx - x0
      const fy = sy - y0
      const i00 = (y0 * w + x0) * 4
      const i10 = (y0 * w + x1) * 4
      const i01 = (y1 * w + x0) * 4
      const i11 = (y1 * w + x1) * 4
      const o = (y * w + x) * 4
      for (let c = 0; c < 4; c++) {
        const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * fx
        const bot = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * fx
        d[o + c] = top + (bot - top) * fy
      }
    }
  }
  return fromData(out)
}

/**
 * Gaussian blur through the compositor.
 *
 * Drawn from a copy padded past the frame, because `blur()` samples
 * transparent black from outside and would leave a dark border all round.
 */
export function blurred(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  if (radius <= 0.05) return copy(src)
  const pad = Math.ceil(radius * 2)
  const padded = canvas(src.width + pad * 2, src.height + pad * 2)
  const pc = ctx2d(padded)
  pc.drawImage(src, pad, pad)
  // stretch the outermost rows and columns into the padding
  pc.drawImage(src, 0, 0, 1, src.height, 0, pad, pad, src.height)
  pc.drawImage(src, src.width - 1, 0, 1, src.height, pad + src.width, pad, pad, src.height)
  pc.drawImage(padded, 0, pad, padded.width, 1, 0, 0, padded.width, pad)
  pc.drawImage(padded, 0, pad + src.height - 1, padded.width, 1, 0, pad + src.height, padded.width, pad)
  const out = canvas(src.width, src.height)
  const oc = ctx2d(out)
  oc.filter = `blur(${radius}px)`
  oc.drawImage(padded, -pad, -pad)
  oc.filter = 'none'
  return out
}

/**
 * Summed-area tables of each channel and its square, so the mean and variance
 * of any rectangle is four lookups. It is what makes Kuwahara (oil paint) cost
 * the same at radius 12 as at radius 2.
 */
export interface BoxStats {
  w: number
  h: number
  sum: Float64Array[]
  sq: Float64Array[]
}

export function boxStats(img: ImageData): BoxStats {
  const { width: w, height: h, data } = img
  const W = w + 1
  const sum = [0, 1, 2].map(() => new Float64Array(W * (h + 1)))
  const sq = [0, 1, 2].map(() => new Float64Array(W * (h + 1)))
  for (let c = 0; c < 3; c++) {
    const S = sum[c]
    const Q = sq[c]
    for (let y = 0; y < h; y++) {
      let rs = 0
      let rq = 0
      for (let x = 0; x < w; x++) {
        const v = data[(y * w + x) * 4 + c]
        rs += v
        rq += v * v
        S[(y + 1) * W + x + 1] = S[y * W + x + 1] + rs
        Q[(y + 1) * W + x + 1] = Q[y * W + x + 1] + rq
      }
    }
  }
  return { w, h, sum, sq }
}

/** Mean and variance of a channel over [x0, x1) x [y0, y1), clamped to the image. */
export function boxAt(b: BoxStats, c: number, x0: number, y0: number, x1: number, y1: number) {
  x0 = Math.max(0, x0)
  y0 = Math.max(0, y0)
  x1 = Math.min(b.w, x1)
  y1 = Math.min(b.h, y1)
  const n = Math.max(1, (x1 - x0) * (y1 - y0))
  const W = b.w + 1
  const S = b.sum[c]
  const Q = b.sq[c]
  const s = S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0]
  const q = Q[y1 * W + x1] - Q[y0 * W + x1] - Q[y1 * W + x0] + Q[y0 * W + x0]
  const mean = s / n
  return { mean, variance: q / n - mean * mean }
}

/** Sobel over a luminance array: magnitude 0..1 and direction in radians. */
export function sobel(lum: Float32Array, w: number, h: number) {
  const mag = new Float32Array(w * h)
  const dir = new Float32Array(w * h)
  const at = (x: number, y: number) =>
    lum[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
      const gy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
      mag[y * w + x] = Math.min(1, Math.hypot(gx, gy) / 2)
      dir[y * w + x] = Math.atan2(gy, gx)
    }
  }
  return { mag, dir }
}

/**
 * Nearest seed on a jittered grid, the building block for crystallize,
 * shatter and glass tiles. Returns the seed's position and the distances to
 * the nearest and second nearest, whose difference is the distance to the
 * cell's border.
 */
export function voronoi(x: number, y: number, size: number, salt = 0) {
  const gx = Math.floor(x / size)
  const gy = Math.floor(y / size)
  let best = Infinity
  let second = Infinity
  let sx = 0
  let sy = 0
  let id = 0
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i
      const cy = gy + j
      const px = (cx + 0.15 + hash(cx, cy, salt) * 0.7) * size
      const py = (cy + 0.15 + hash(cx, cy, salt + 7) * 0.7) * size
      const d = (px - x) * (px - x) + (py - y) * (py - y)
      if (d < best) {
        second = best
        best = d
        sx = px
        sy = py
        id = cx * 7919 + cy
      } else if (d < second) {
        second = d
      }
    }
  }
  return { sx, sy, id, d1: Math.sqrt(best), d2: Math.sqrt(second) }
}

/** Colour of `img` at a pixel, clamped to the frame. */
export function pixelAt(img: ImageData, x: number, y: number): [number, number, number] {
  const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)))
  const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)))
  const p = (yi * img.width + xi) * 4
  return [img.data[p], img.data[p + 1], img.data[p + 2]]
}

export function hexRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const f = s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s.slice(0, 6)
  const n = parseInt(f, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Map every pixel through a 256-entry RGB lookup by its luminance, mixed by `amount`. */
export function mapThroughLut(img: ImageData, lut: Uint8ClampedArray, amount = 1) {
  const d = img.data
  for (let p = 0; p < d.length; p += 4) {
    const l = Math.round(0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) * 3
    d[p] += (lut[l] - d[p]) * amount
    d[p + 1] += (lut[l + 1] - d[p + 1]) * amount
    d[p + 2] += (lut[l + 2] - d[p + 2]) * amount
  }
}
