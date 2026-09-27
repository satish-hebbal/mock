/**
 * The whole-frame styles.
 *
 * Print and paint processes that cannot be written as "draw one cell": a
 * halftone screen is rotated against the grid, an oil painting needs a wide
 * neighbourhood per pixel, a pixel sort is sequential along a row. Each is a
 * function from a working canvas (the source, fitted and toned) to a finished
 * art layer of the same size. `render.ts` decides the working size and scales
 * the result to the output; the colour pass, reveal and finish still run on
 * top of it like any other style.
 *
 * `k` is working pixels per document pixel, so a setting written in document
 * pixels (a dot pitch, a line spacing) keeps its look at every output size.
 */

import { getGradient, gradientLut, lutFromStops } from './gradients'
import type { ParamValue } from './params'
import {
  blurred,
  boxAt,
  boxStats,
  canvas,
  clamp255,
  copy,
  ctx2d,
  fbm,
  fromData,
  hash,
  hexRgb,
  lumaOf,
  mapThroughLut,
  noise,
  pixelAt,
  read,
  sobel,
  voronoi,
} from './pixels'

export interface ProcessCtx {
  /** working pixels per document pixel */
  k: number
  p: Record<string, ParamValue>
}

export type ProcessFn = (src: HTMLCanvasElement, c: ProcessCtx) => HTMLCanvasElement

const n = (c: ProcessCtx, key: string) => c.p[key] as number
const s = (c: ProcessCtx, key: string) => c.p[key] as string
const b = (c: ProcessCtx, key: string) => c.p[key] as boolean

function paper(w: number, h: number, color: string) {
  const out = canvas(w, h)
  const ctx = ctx2d(out)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  return { out, ctx }
}

// ----- print -----

/**
 * A four-colour press: cyan, magenta, yellow and black dot screens, each at
 * its traditional angle, multiplied onto the paper. The rosette you see in a
 * magnifier on a magazine page comes out of those four angles on its own.
 */
const halftone: ProcessFn = (src, c) => {
  const w = src.width
  const h = src.height
  const img = read(src)
  const cell = Math.max(3, n(c, 'cell') * c.k)
  const { out, ctx } = paper(w, h, s(c, 'paper'))
  const mono = s(c, 'mode') === 'mono'
  const inks = mono
    ? [{ angle: 45, color: s(c, 'ink'), cov: (r: number, g: number, bl: number) => 1 - (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255 }]
    : [
        { angle: 15, color: '#00a8e8', cov: (r: number, g: number, bl: number) => under(r, g, bl, 0) },
        { angle: 75, color: '#e8158c', cov: (r: number, g: number, bl: number) => under(r, g, bl, 1) },
        { angle: 0, color: '#ffe600', cov: (r: number, g: number, bl: number) => under(r, g, bl, 2) },
        { angle: 45, color: '#1d1d1b', cov: (r: number, g: number, bl: number) => 1 - Math.max(r, g, bl) / 255 },
      ]
  ctx.globalCompositeOperation = 'multiply'
  const diag = Math.hypot(w, h)
  for (const ink of inks) {
    const a = (ink.angle * Math.PI) / 180
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    ctx.fillStyle = ink.color
    ctx.beginPath()
    for (let v = -diag; v < diag; v += cell) {
      for (let u = -diag; u < diag; u += cell) {
        const x = w / 2 + u * ca - v * sa
        const y = h / 2 + u * sa + v * ca
        if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue
        const [r, g, bl] = pixelAt(img, x, y)
        const cov = ink.cov(r, g, bl)
        if (cov <= 0.02) continue
        const rad = cell * 0.62 * Math.sqrt(cov)
        ctx.moveTo(x + rad, y)
        ctx.arc(x, y, rad, 0, Math.PI * 2)
      }
    }
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  return out
}

/** Under-colour removal: how much of one subtractive ink a pixel needs once black has taken its share. */
function under(r: number, g: number, bl: number, ch: 0 | 1 | 2) {
  const k = 1 - Math.max(r, g, bl) / 255
  if (k >= 0.999) return 0
  const v = [r, g, bl][ch] / 255
  return Math.max(0, (1 - v - k) / (1 - k))
}

/**
 * Risograph: two fluorescent drum inks, each a grainy stochastic screen, one
 * knocked slightly out of register. The grain and the misregistration are the
 * whole charm, so both are settings.
 */
const riso: ProcessFn = (src, c) => {
  const w = src.width
  const h = src.height
  const img = read(blurred(src, 0.8 * c.k))
  const d = img.data
  const A = hexRgb(s(c, 'inkA'))
  const B = hexRgb(s(c, 'inkB'))
  const P = hexRgb(s(c, 'paper'))
  const grain = Math.max(1, n(c, 'grain') * c.k)
  const off = Math.round(n(c, 'shift') * c.k)
  const out = new ImageData(w, h)
  const o = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
      // drum A carries the shadows, drum B the reds and warm midtones
      const bx = Math.min(w - 1, Math.max(0, x - off))
      const by = Math.min(h - 1, Math.max(0, y + Math.round(off * 0.5)))
      const j = (by * w + bx) * 4
      const lumB = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) / 255
      const covA = Math.pow(1 - lum, 1.15)
      const covB = Math.min(1, Math.max(0, (d[j] - d[j + 2]) / 255 * 0.9 + (1 - lumB) * 0.45))
      // a clumpy screen, part smooth noise and part grain, which is what a drum
      // actually lays down; pure per-pixel noise reads as static instead
      const gx = Math.floor(x / grain)
      const gy = Math.floor(y / grain)
      const tA = noise(x / (grain * 1.6), y / (grain * 1.6), 3) * 0.7 + hash(gx, gy, 3) * 0.3
      const tB = noise(x / (grain * 1.6), y / (grain * 1.6), 9) * 0.7 + hash(gx, gy, 9) * 0.3
      const onA = covA > tA ? 1 : 0
      const onB = covB > tB ? 1 : 0
      for (let ch = 0; ch < 3; ch++) {
        let v = P[ch]
        if (onA) v = (v * A[ch]) / 255
        if (onB) v = (v * B[ch]) / 255
        o[i + ch] = v
      }
      o[i + 3] = 255
    }
  }
  return fromData(out)
}

/** Mezzotint: every pixel inked or not against a noise screen. Grainy, velvety blacks. */
const mezzotint: ProcessFn = (src, c) => {
  const w = src.width
  const h = src.height
  const img = read(src)
  const lum = lumaOf(img)
  const grain = Math.max(1, n(c, 'grain') * c.k)
  const worm = s(c, 'screen') === 'worms'
  const out = new ImageData(w, h)
  const o = out.data
  const ink = hexRgb(s(c, 'ink'))
  const pap = hexRgb(s(c, 'paper'))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const t = worm ? noise(x / grain, y / (grain * 0.35), 5) : hash(Math.floor(x / grain), Math.floor(y / grain), 5)
      const on = 1 - lum[i] > t
      const col = on ? ink : pap
      o[i * 4] = col[0]
      o[i * 4 + 1] = col[1]
      o[i * 4 + 2] = col[2]
      o[i * 4 + 3] = 255
    }
  }
  return fromData(out)
}

/**
 * Line engraving: parallel lines whose width follows the darkness, bent a
 * little by the brightness so they read as contours over the form, which is
 * what separates an engraving from a row of stripes.
 */
const engrave: ProcessFn = (src, c) => {
  const w = src.width
  const h = src.height
  const lum = lumaOf(read(blurred(src, 0.8 * c.k)))
  const gap = Math.max(2, n(c, 'spacing') * c.k)
  const a = (n(c, 'angle') * Math.PI) / 180
  const bend = n(c, 'bend') * gap * 2
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const ink = hexRgb(s(c, 'ink'))
  const pap = hexRgb(s(c, 'paper'))
  const out = new ImageData(w, h)
  const o = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const l = lum[i]
      const v = (-x * sa + y * ca + l * bend) / gap
      const f = v - Math.floor(v)
      const half = (1 - l) * 0.5
      const dist = Math.abs(f - 0.5)
      // a one-pixel ramp at the line's edge, so the strokes are not jagged
      const cov = Math.max(0, Math.min(1, (half - dist) * gap + 0.5))
      for (let ch = 0; ch < 3; ch++) o[i * 4 + ch] = pap[ch] + (ink[ch] - pap[ch]) * cov
      o[i * 4 + 3] = 255
    }
  }
  return fromData(out)
}

/** Woodcut: bold black shapes, with gouge marks cut into the light areas along one direction. */
const woodcut: ProcessFn = (src, c) => {
  const w = src.width
  const h = src.height
  const lum = lumaOf(read(blurred(src, 1.4 * c.k)))
  const t = n(c, 'threshold')
  const gap = Math.max(2, n(c, 'cuts') * c.k)
  const ink = hexRgb(s(c, 'ink'))
  const pap = hexRgb(s(c, 'paper'))
  const out = new ImageData(w, h)
  const o = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const l = lum[i]
      const wob = (fbm(x / (gap * 6), y / (gap * 6), 13) - 0.5) * 1.2
      const v = (y + x * 0.25) / gap + wob
      const f = Math.abs((v - Math.floor(v)) - 0.5) * 2
      // below the threshold the block is left whole; above it the gouges widen
      // with the light until only thin ridges of wood are left to take ink
      const cutWidth = 0.35 + ((l - t) / (1 - t + 1e-3)) * 0.65
      const on = l < t || f > cutWidth ? 1 : 0
      const col = on ? ink : pap
      o[i * 4] = col[0]
      o[i * 4 + 1] = col[1]
      o[i * 4 + 2] = col[2]
      o[i * 4 + 3] = 255
    }
  }
  return fromData(out)
}

/** Pencil: soft edges traced in graphite, shadows filled with a light diagonal hatch. */
const sketch: ProcessFn = (src, c) => {
  const w = src.width
  const h = src.height
  const lum = lumaOf(read(blurred(src, 1.1 * c.k)))
  const { mag } = sobel(lum, w, h)
  const strength = n(c, 'lines') * 3
  const hatchAmt = n(c, 'shade')
  const gap = Math.max(2, 4 * c.k)
  const lead = hexRgb(s(c, 'ink'))
  const pap = hexRgb(s(c, 'paper'))
  const out = new ImageData(w, h)
  const o = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const e = Math.min(1, mag[i] * strength)
      const dark = 1 - lum[i]
      const v = (x + y) / gap
      const f = Math.abs((v - Math.floor(v)) - 0.5) * 2
      const hatch = dark > 0.35 && f < dark * 0.6 ? hatchAmt * 0.55 * dark : 0
      const v2 = (x - y) / gap
      const f2 = Math.abs((v2 - Math.floor(v2)) - 0.5) * 2
      const hatch2 = dark > 0.65 && f2 < (dark - 0.3) * 0.6 ? hatchAmt * 0.45 : 0
      const grainy = 0.85 + hash(x, y, 17) * 0.15
      const cov = Math.min(1, (e + hatch + hatch2) * grainy)
      for (let ch = 0; ch < 3; ch++) o[i * 4 + ch] = pap[ch] + (lead[ch] - pap[ch]) * cov
      o[i * 4 + 3] = 255
    }
  }
  return fromData(out)
}

/** Comic: flat posterised colour, a heavy ink line, and Ben-Day dots in the shadows. */
const comic: ProcessFn = (src, c) => {
  const w = src.width
  const h = src.height
  const soft = read(blurred(src, 1.2 * c.k))
  const lum = lumaOf(soft)
  const { mag } = sobel(lum, w, h)
  const levels = Math.max(2, Math.round(n(c, 'levels')))
  const line = n(c, 'line')
  const dot = Math.max(3, n(c, 'dots') * c.k)
  const d = soft.data
  const step = 255 / (levels - 1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const p = i * 4
      for (let ch = 0; ch < 3; ch++) d[p + ch] = Math.round(d[p + ch] / step) * step
      // dots in the mid shadows, on a 45 degree screen
      const l = lum[i]
      if (l < 0.55 && l > 0.12) {
        const u = (x + y) / dot
        const v = (x - y) / dot
        const fu = u - Math.floor(u) - 0.5
        const fv = v - Math.floor(v) - 0.5
        if (Math.hypot(fu, fv) < (0.55 - l) * 0.9) {
          d[p] *= 0.55
          d[p + 1] *= 0.55
          d[p + 2] *= 0.55
        }
      }
      if (mag[i] > 0.28 - line * 0.22) {
        d[p] = 12
        d[p + 1] = 12
        d[p + 2] = 14
      }
    }
  }
  return fromData(soft)
}

// ----- paint -----

/** Kuwahara: each pixel takes the mean of whichever quadrant around it is calmest. */
function kuwahara(img: ImageData, r: number): ImageData {
  const { width: w, height: h } = img
  const st = boxStats(img)
  const out = new ImageData(w, h)
  const o = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity
      let mr = 0
      let mg = 0
      let mb = 0
      for (let q = 0; q < 4; q++) {
        const x0 = q & 1 ? x : x - r
        const y0 = q & 2 ? y : y - r
        const R = boxAt(st, 0, x0, y0, x0 + r + 1, y0 + r + 1)
        const G = boxAt(st, 1, x0, y0, x0 + r + 1, y0 + r + 1)
        const B = boxAt(st, 2, x0, y0, x0 + r + 1, y0 + r + 1)
        const v = R.variance + G.variance + B.variance
        if (v < best) {
          best = v
          mr = R.mean
          mg = G.mean
          mb = B.mean
        }
      }
      const p = (y * w + x) * 4
      o[p] = mr
      o[p + 1] = mg
      o[p + 2] = mb
      o[p + 3] = 255
    }
  }
  return out
}

const oil: ProcessFn = (src, c) => {
  const r = Math.max(1, Math.round(n(c, 'brush') * c.k))
  const img = kuwahara(read(src), r)
  // canvas weave: a faint cross-grain, so the flat strokes read as paint on something
  const texture = n(c, 'canvas')
  if (texture > 0) {
    const d = img.data
    const w = img.width
    for (let i = 0; i < w * img.height; i++) {
      const x = i % w
      const y = (i / w) | 0
      const t = 1 + (((x & 3) === 0 ? -1 : 0) + ((y & 3) === 0 ? -1 : 0) + hash(x, y, 2) - 0.5) * 0.06 * texture
      d[i * 4] = clamp255(d[i * 4] * t)
      d[i * 4 + 1] = clamp255(d[i * 4 + 1] * t)
      d[i * 4 + 2] = clamp255(d[i * 4 + 2] * t)
    }
  }
  return fromData(img)
}

/** Watercolour: soft washes, pigment pooling at the edges of each wash, on cold-press paper. */
const watercolor: ProcessFn = (src, c) => {
  const r = Math.max(1, Math.round(n(c, 'wash') * c.k))
  const washed = kuwahara(read(blurred(src, r * 0.6)), r)
  const w = washed.width
  const h = washed.height
  const lum = lumaOf(washed)
  const { mag } = sobel(lum, w, h)
  const pool = n(c, 'edges') * 1.6
  const grain = n(c, 'paper')
  const d = washed.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const p = i * 4
      // lift toward white first, the way a thin wash lets the paper through
      const lift = 0.18
      const edge = 1 - Math.min(0.5, mag[i] * pool)
      const tex = 1 - (fbm(x / (6 * c.k), y / (6 * c.k), 21) - 0.5) * 0.22 * grain
      for (let ch = 0; ch < 3; ch++) {
        const v = d[p + ch] + (255 - d[p + ch]) * lift
        d[p + ch] = clamp255(v * edge * tex)
      }
    }
  }
  return fromData(washed)
}

/** Crystallize: the frame broken into Voronoi cells, each one the colour at its seed. */
const crystal: ProcessFn = (src, c) => {
  const w = src.width
  const h = src.height
  const img = read(src)
  const size = Math.max(3, n(c, 'size') * c.k)
  const edge = n(c, 'edges')
  const out = new ImageData(w, h)
  const o = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = voronoi(x, y, size, 31)
      const [r, g, bl] = pixelAt(img, v.sx, v.sy)
      const border = edge > 0 && v.d2 - v.d1 < edge * 2.2 * c.k ? 0.35 : 1
      const p = (y * w + x) * 4
      o[p] = r * border
      o[p + 1] = g * border
      o[p + 2] = bl * border
      o[p + 3] = 255
    }
  }
  return fromData(out)
}

/** Contour map: lines of equal brightness, optionally over elevation colour. */
const topo: ProcessFn = (src, c) => {
  const w = src.width
  const h = src.height
  const lum = lumaOf(read(blurred(src, 2 * c.k)))
  const levels = Math.max(2, Math.round(n(c, 'levels')))
  const weight = n(c, 'weight') * c.k
  const fill = b(c, 'fill')
  const lut = gradientLut(s(c, 'gradient'))
  const ink = hexRgb(s(c, 'ink'))
  const pap = hexRgb(s(c, 'paper'))
  const out = new ImageData(w, h)
  const o = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const v = lum[i] * levels
      const gx = (lum[Math.min(w - 1, x + 1) + y * w] - lum[Math.max(0, x - 1) + y * w]) * levels * 0.5
      const gy = (lum[x + Math.min(h - 1, y + 1) * w] - lum[x + Math.max(0, y - 1) * w]) * levels * 0.5
      const fw = Math.hypot(gx, gy) + 1e-4
      const f = v - Math.floor(v)
      const dist = Math.min(f, 1 - f) / fw
      const major = Math.floor(v + 0.5) % 5 === 0 ? 1.8 : 1
      const cov = Math.max(0, Math.min(1, weight * major - dist + 0.5))
      let base: [number, number, number] = pap
      if (fill) {
        const li = Math.round((Math.floor(v) / levels) * 255) * 3
        base = [lut[li], lut[li + 1], lut[li + 2]]
      }
      const p = i * 4
      for (let ch = 0; ch < 3; ch++) o[p + ch] = base[ch] + (ink[ch] - base[ch]) * cov
      o[p + 3] = 255
    }
  }
  return fromData(out)
}

/** Pointillism: dabs of saturated colour on a jittered grid, the paper showing between them. */
const pointil: ProcessFn = (src, c) => {
  const w = src.width
  const h = src.height
  const img = read(src)
  const size = Math.max(2, n(c, 'size') * c.k)
  const { out, ctx } = paper(w, h, s(c, 'paper'))
  const sat = n(c, 'vivid')
  const step = size * 0.9
  for (let gy = -1; gy * step < h + step; gy++) {
    for (let gx = -1; gx * step < w + step; gx++) {
      const x = (gx + hash(gx, gy, 1)) * step
      const y = (gy + hash(gx, gy, 2)) * step
      let [r, g, bl] = pixelAt(img, x, y)
      const m = (r + g + bl) / 3
      r = clamp255(m + (r - m) * (1 + sat))
      g = clamp255(m + (g - m) * (1 + sat))
      bl = clamp255(m + (bl - m) * (1 + sat))
      ctx.fillStyle = `rgb(${r | 0}, ${g | 0}, ${bl | 0})`
      ctx.beginPath()
      ctx.arc(x, y, size * (0.42 + hash(gx, gy, 3) * 0.2), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  return out
}

// ----- colour -----

const POP_SETS = [
  ['#1b1464', '#ff2e88', '#ffe600'],
  ['#004d40', '#ff6f00', '#b2ff59'],
  ['#311b92', '#00e5ff', '#ff4081'],
  ['#b71c1c', '#ffd600', '#00b0ff'],
  ['#1a237e', '#76ff03', '#ff9100'],
  ['#3e2723', '#ff80ab', '#84ffff'],
  ['#0d47a1', '#ffeb3b', '#f50057'],
  ['#263238', '#ff3d00', '#c6ff00'],
  ['#4a148c', '#ffab00', '#18ffff'],
]

/** Pop art: the picture repeated in a grid, each copy screen-printed in its own three inks. */
const popart: ProcessFn = (src, c) => {
  const w = src.width
  const h = src.height
  const k = s(c, 'grid') === '3' ? 3 : 2
  const { out, ctx } = paper(w, h, '#000')
  const tw = w / k
  const th = h / k
  const small = canvas(tw, th)
  const sc = ctx2d(small)
  sc.drawImage(src, 0, 0, tw, th)
  const base = read(small)
  const cut = n(c, 'levels')
  for (let i = 0; i < k * k; i++) {
    const tile = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height)
    const inks = POP_SETS[(i + Math.round(n(c, 'shift'))) % POP_SETS.length].map(hexRgb)
    const d = tile.data
    for (let p = 0; p < d.length; p += 4) {
      const l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255
      const idx = l < cut * 0.6 ? 0 : l < cut ? 1 : 2
      d[p] = inks[idx][0]
      d[p + 1] = inks[idx][1]
      d[p + 2] = inks[idx][2]
    }
    ctx.putImageData(tile, Math.round((i % k) * tw), Math.round(Math.floor(i / k) * th))
  }
  return out
}

/** Screenprint: brightness cut into a few flat bands, each pulled from a gradient. */
const poster: ProcessFn = (src, c) => {
  const img = read(blurred(src, 0.8 * c.k))
  const levels = Math.max(2, Math.round(n(c, 'levels')))
  const stops = getGradient(s(c, 'gradient')).stops
  const lut = lutFromStops(stops)
  const d = img.data
  for (let p = 0; p < d.length; p += 4) {
    const l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255
    const q = Math.round(Math.min(levels - 1, Math.floor(l * levels)) / (levels - 1) * 255) * 3
    d[p] = lut[q]
    d[p + 1] = lut[q + 1]
    d[p + 2] = lut[q + 2]
  }
  return fromData(img)
}

/** A thermal camera: soft focus, brightness as heat, and a little sensor noise. */
const thermal: ProcessFn = (src, c) => {
  const img = read(blurred(src, n(c, 'soften') * c.k))
  const d = img.data
  const w = img.width
  const noiseAmt = n(c, 'noise') * 40
  for (let i = 0, p = 0; p < d.length; i++, p += 4) {
    const x = i % w
    const y = (i / w) | 0
    const jitter = (hash(x, y, 77) - 0.5) * noiseAmt
    d[p] = clamp255(d[p] + jitter)
    d[p + 1] = clamp255(d[p + 1] + jitter)
    d[p + 2] = clamp255(d[p + 2] + jitter)
  }
  mapThroughLut(img, gradientLut(s(c, 'palette')))
  return fromData(img)
}

/** Cyanotype: Prussian blue sun print, uneven where the brush missed the paper. */
const cyanotype: ProcessFn = (src, c) => {
  const img = read(src)
  const w = img.width
  const h = img.height
  const d = img.data
  const exposure = n(c, 'exposure')
  const brush = n(c, 'brush')
  const lut = gradientLut('cyanotype')
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      let l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255
      l = Math.min(1, Math.max(0, (l - 0.5) * (0.8 + exposure) + 0.5 + (exposure - 0.5) * 0.3))
      // a ragged border where the emulsion was brushed on by hand
      const ex = Math.min(x, w - 1 - x, y, h - 1 - y) / Math.min(w, h)
      const edge = brush > 0 ? Math.min(1, Math.max(0, (ex - 0.02 - fbm(x / 40, y / 40, 3) * 0.05 * brush * 4) * 40)) : 1
      l = 1 - (1 - l) * edge
      const t = 1 - (fbm(x / (5 * c.k), y / (5 * c.k), 8) - 0.5) * 0.12
      const li = Math.round(Math.min(1, l * t) * 255) * 3
      d[p] = lut[li]
      d[p + 1] = lut[li + 1]
      d[p + 2] = lut[li + 2]
    }
  }
  return fromData(img)
}

// ----- glitch and light -----

/**
 * Pixel sort: runs of pixels whose brightness sits between two thresholds are
 * sorted by brightness, along rows or down columns. The streaks stop wherever
 * the picture leaves the band, so the subject stays and the rest melts.
 */
const pixelsort: ProcessFn = (src, c) => {
  const img = read(src)
  const { width: w, height: h, data: d } = img
  const lo = n(c, 'low')
  const hi = Math.max(lo + 0.01, n(c, 'high'))
  const vertical = s(c, 'direction') === 'down'
  const reverse = b(c, 'reverse')
  const lineLen = vertical ? h : w
  const lines = vertical ? w : h
  const idx: number[] = []
  const buf: number[][] = []
  for (let L = 0; L < lines; L++) {
    let start = -1
    for (let t = 0; t <= lineLen; t++) {
      let inside = false
      let p = 0
      if (t < lineLen) {
        p = vertical ? (t * w + L) * 4 : (L * w + t) * 4
        const l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255
        inside = l >= lo && l <= hi
      }
      if (inside && start < 0) start = t
      if ((!inside || t === lineLen) && start >= 0) {
        idx.length = 0
        buf.length = 0
        for (let u = start; u < t; u++) {
          const q = vertical ? (u * w + L) * 4 : (L * w + u) * 4
          idx.push(q)
          buf.push([d[q], d[q + 1], d[q + 2], 0.2126 * d[q] + 0.7152 * d[q + 1] + 0.0722 * d[q + 2]])
        }
        buf.sort((a, z) => (reverse ? z[3] - a[3] : a[3] - z[3]))
        for (let u = 0; u < idx.length; u++) {
          d[idx[u]] = buf[u][0]
          d[idx[u] + 1] = buf[u][1]
          d[idx[u] + 2] = buf[u][2]
        }
        start = -1
      }
    }
  }
  return fromData(img)
}

/** Relief: the picture pressed into metal or stone, lit from one side. */
const relief: ProcessFn = (src, c) => {
  const img = read(blurred(src, 0.6 * c.k))
  const w = img.width
  const h = img.height
  const lum = lumaOf(img)
  const a = (n(c, 'light') * Math.PI) / 180
  const depth = n(c, 'depth') * 6
  const tint = b(c, 'color')
  const lx = Math.cos(a)
  const ly = Math.sin(a)
  const d = img.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const dx = lum[Math.min(w - 1, x + 1) + y * w] - lum[Math.max(0, x - 1) + y * w]
      const dy = lum[x + Math.min(h - 1, y + 1) * w] - lum[x + Math.max(0, y - 1) * w]
      const shade = 0.5 + (dx * lx + dy * ly) * depth
      const p = i * 4
      if (tint) {
        d[p] = clamp255(d[p] * shade * 1.4)
        d[p + 1] = clamp255(d[p + 1] * shade * 1.4)
        d[p + 2] = clamp255(d[p + 2] * shade * 1.4)
      } else {
        const v = clamp255(shade * 255)
        d[p] = v
        d[p + 1] = v
        d[p + 2] = v
      }
    }
  }
  return fromData(img)
}

/** Edge glow: only the outlines survive, lit in their own colour on black. */
const glowedge: ProcessFn = (src, c) => {
  const soft = read(blurred(src, 0.8 * c.k))
  const w = soft.width
  const h = soft.height
  const { mag } = sobel(lumaOf(soft), w, h)
  const gain = 1 + n(c, 'gain') * 6
  const d = soft.data
  for (let i = 0; i < w * h; i++) {
    const e = Math.min(1, mag[i] * gain)
    const p = i * 4
    const m = Math.max(d[p], d[p + 1], d[p + 2], 1)
    // the colour pushed to full brightness, so a dark red edge still glows red
    d[p] = (d[p] / m) * 255 * e
    d[p + 1] = (d[p + 1] / m) * 255 * e
    d[p + 2] = (d[p + 2] / m) * 255 * e
  }
  const lines = fromData(soft)
  const glow = n(c, 'glow')
  if (glow <= 0) return lines
  const out = copy(lines)
  const ctx = ctx2d(out)
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = glow
  ctx.drawImage(blurred(lines, 4 * c.k), 0, 0)
  ctx.drawImage(blurred(lines, 12 * c.k), 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  return out
}

/**
 * Anaglyph: red from a copy shifted one way, cyan from a copy shifted the
 * other, with bright things pushed further so they float toward the glasses.
 */
const anaglyph: ProcessFn = (src, c) => {
  const img = read(src)
  const { width: w, height: h, data: d } = img
  const off = n(c, 'depth') * 10 * c.k
  const byLight = b(c, 'pop')
  const out = new ImageData(w, h)
  const o = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      const l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255
      const k = byLight ? off * (0.3 + l) : off
      const lx = Math.min(w - 1, Math.max(0, Math.round(x + k)))
      const rx = Math.min(w - 1, Math.max(0, Math.round(x - k)))
      const L = (y * w + lx) * 4
      const R = (y * w + rx) * 4
      o[p] = 0.2126 * d[L] + 0.7152 * d[L + 1] + 0.0722 * d[L + 2]
      o[p + 1] = d[R + 1]
      o[p + 2] = d[R + 2]
      o[p + 3] = 255
    }
  }
  return fromData(out)
}

/** Blueprint: white linework on drafting blue, over a fine grid. */
const blueprint: ProcessFn = (src, c) => {
  const w = src.width
  const h = src.height
  const lum = lumaOf(read(blurred(src, 1 * c.k)))
  const { mag } = sobel(lum, w, h)
  const gridPx = Math.max(4, n(c, 'grid') * c.k)
  const gain = 1 + n(c, 'lines') * 5
  const base = hexRgb(s(c, 'paper'))
  const out = new ImageData(w, h)
  const o = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const onGrid = x % Math.round(gridPx) === 0 || y % Math.round(gridPx) === 0
      const major = x % Math.round(gridPx * 5) === 0 || y % Math.round(gridPx * 5) === 0
      const g = major ? 0.28 : onGrid ? 0.12 : 0
      const e = Math.min(1, mag[i] * gain)
      const cov = Math.min(1, e + g)
      const p = i * 4
      for (let ch = 0; ch < 3; ch++) o[p + ch] = base[ch] + (240 - base[ch]) * cov
      o[p + 3] = 255
    }
  }
  return fromData(out)
}

export const PROCESSES: Record<string, ProcessFn> = {
  halftone,
  riso,
  mezzotint,
  engrave,
  woodcut,
  sketch,
  comic,
  oil,
  watercolor,
  crystal,
  topo,
  pointil,
  popart,
  poster,
  thermal,
  cyanotype,
  pixelsort,
  relief,
  glowedge,
  anaglyph,
  blueprint,
}
