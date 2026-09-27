/**
 * Layer filters: what can be done to the photograph before a style cuts it up.
 *
 * Each is a row: an id, a group, a list of params and a function from canvas
 * to canvas. They all run at the working size `layers.ts` chooses, and every
 * distance is in document pixels times `k`, so a thumbnail and a 4x export
 * agree about what "a 20px ripple" looks like.
 */

import { gradientLut, GRADIENTS } from './gradients'
import { amount, choice, color, range, toggle, type ParamSpec, type ParamValue } from './params'
import {
  blurred,
  canvas,
  clamp255,
  copy,
  ctx2d,
  fbm,
  fromData,
  hash,
  hexRgb,
  mapThroughLut,
  noise,
  read,
  voronoi,
  warp,
} from './pixels'

export type FilterGroup = 'warp' | 'blur' | 'glass' | 'color' | 'glitch'

export interface FilterCtx {
  /** working pixels per document pixel */
  k: number
  p: Record<string, ParamValue>
}

export interface FilterSpec {
  id: string
  label: string
  group: FilterGroup
  hint: string
  params: ParamSpec[]
  /** has a centre that can be dragged on the canvas */
  positioned?: boolean
  fn: (src: HTMLCanvasElement, c: FilterCtx) => HTMLCanvasElement
}

export const FILTER_GROUPS: { id: FilterGroup; label: string }[] = [
  { id: 'warp', label: 'Warp' },
  { id: 'blur', label: 'Blur' },
  { id: 'glass', label: 'Glass' },
  { id: 'color', label: 'Colour' },
  { id: 'glitch', label: 'Glitch' },
]

const N = (c: FilterCtx, k: string) => c.p[k] as number
const S = (c: FilterCtx, k: string) => c.p[k] as string
const B = (c: FilterCtx, k: string) => c.p[k] as boolean
const rad = (deg: number) => (deg * Math.PI) / 180

const centre = [range('cx', 'Centre X', 0, 1, 0.5, { fmt: 'pct' }), range('cy', 'Centre Y', 0, 1, 0.5, { fmt: 'pct' })]

/** Centre and reach of a positioned filter, in working pixels. */
function focus(src: HTMLCanvasElement, c: FilterCtx, radiusKey = 'radius') {
  const w = src.width
  const h = src.height
  return {
    cx: N(c, 'cx') * w,
    cy: N(c, 'cy') * h,
    R: Math.max(1, (N(c, radiusKey) ?? 0.5) * Math.hypot(w, h) * 0.5),
  }
}

// ----- warp -----

const twirl: FilterSpec = {
  id: 'twirl',
  label: 'Twirl',
  group: 'warp',
  hint: 'Spun around a point, hardest at the centre.',
  positioned: true,
  params: [range('angle', 'Angle', -720, 720, 240, { fmt: 'deg' }), range('radius', 'Reach', 0.05, 1, 0.5, { fmt: 'pct' }), ...centre],
  fn: (src, c) => {
    const { cx, cy, R } = focus(src, c)
    const a = rad(N(c, 'angle'))
    return warp(src, (x, y, o) => {
      const dx = x - cx
      const dy = y - cy
      const d = Math.hypot(dx, dy)
      if (d >= R) return void ((o[0] = x), (o[1] = y))
      const t = 1 - d / R
      const th = a * t * t
      const cs = Math.cos(th)
      const sn = Math.sin(th)
      o[0] = cx + dx * cs - dy * sn
      o[1] = cy + dx * sn + dy * cs
    })
  },
}

const pinch: FilterSpec = {
  id: 'pinch',
  label: 'Pinch',
  group: 'warp',
  hint: 'Pulled in toward a point, or pushed out from it.',
  positioned: true,
  params: [range('amount', 'Amount', -1, 1, 0.6, { fmt: 'pct' }), range('radius', 'Reach', 0.05, 1, 0.45, { fmt: 'pct' }), ...centre],
  fn: (src, c) => {
    const { cx, cy, R } = focus(src, c)
    // sample at t^e: an exponent under 1 reaches further out, which gathers
    // the picture toward the centre; over 1 reaches inward and swells it
    const e = 1 - N(c, 'amount') * 0.7
    return warp(src, (x, y, o) => {
      const dx = x - cx
      const dy = y - cy
      const d = Math.hypot(dx, dy)
      if (d >= R || d === 0) return void ((o[0] = x), (o[1] = y))
      const t = d / R
      const k = Math.pow(t, e) / t
      o[0] = cx + dx * k
      o[1] = cy + dy * k
    })
  },
}

const spherize: FilterSpec = {
  id: 'spherize',
  label: 'Lens',
  group: 'warp',
  hint: 'Seen through a ball of glass. Negative bends it the other way.',
  positioned: true,
  params: [range('amount', 'Bulge', -1, 1, 0.7, { fmt: 'pct' }), range('radius', 'Reach', 0.05, 1, 0.55, { fmt: 'pct' }), ...centre],
  fn: (src, c) => {
    const { cx, cy, R } = focus(src, c)
    const amt = N(c, 'amount')
    return warp(src, (x, y, o) => {
      const dx = (x - cx) / R
      const dy = (y - cy) / R
      const d = Math.hypot(dx, dy)
      if (d >= 1) return void ((o[0] = x), (o[1] = y))
      // a ball of glass reads nearer its middle (asin), a dished one further out (sin)
      const t = amt >= 0 ? d + ((Math.asin(d) * 2) / Math.PI - d) * amt : d + (Math.sin((d * Math.PI) / 2) - d) * -amt
      const k = d > 0 ? t / d : 1
      o[0] = cx + dx * R * k
      o[1] = cy + dy * R * k
    })
  },
}

const ripple: FilterSpec = {
  id: 'ripple',
  label: 'Ripple',
  group: 'warp',
  hint: 'Rings spreading from a dropped stone.',
  positioned: true,
  params: [range('height', 'Height', 0, 60, 14, { fmt: 'px' }), range('length', 'Wavelength', 4, 200, 48, { fmt: 'px' }), ...centre],
  fn: (src, c) => {
    const cx = N(c, 'cx') * src.width
    const cy = N(c, 'cy') * src.height
    const amp = N(c, 'height') * c.k
    const len = Math.max(2, N(c, 'length') * c.k)
    const fade = Math.hypot(src.width, src.height) * 0.6
    return warp(src, (x, y, o) => {
      const dx = x - cx
      const dy = y - cy
      const d = Math.hypot(dx, dy) + 1e-4
      const off = Math.sin((d / len) * Math.PI * 2) * amp * Math.max(0, 1 - d / fade)
      o[0] = x + (dx / d) * off
      o[1] = y + (dy / d) * off
    })
  },
}

const waves: FilterSpec = {
  id: 'waves',
  label: 'Waves',
  group: 'warp',
  hint: 'Rows slid sideways to a sine, like a flag.',
  params: [range('height', 'Height', 0, 80, 18, { fmt: 'px' }), range('length', 'Wavelength', 8, 400, 120, { fmt: 'px' }), range('angle', 'Angle', 0, 180, 0, { fmt: 'deg' })],
  fn: (src, c) => {
    const amp = N(c, 'height') * c.k
    const len = Math.max(2, N(c, 'length') * c.k)
    const a = rad(N(c, 'angle'))
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    return warp(src, (x, y, o) => {
      const along = x * ca + y * sa
      const off = Math.sin((along / len) * Math.PI * 2) * amp
      o[0] = x - sa * off
      o[1] = y + ca * off
    })
  },
}

const zigzag: FilterSpec = {
  id: 'zigzag',
  label: 'Zigzag',
  group: 'warp',
  hint: 'Sharp folds round a centre, like a pleated fan.',
  positioned: true,
  params: [range('height', 'Height', 0, 40, 10, { fmt: 'px' }), range('ridges', 'Ridges', 2, 40, 12, { fmt: 'int' }), ...centre],
  fn: (src, c) => {
    const cx = N(c, 'cx') * src.width
    const cy = N(c, 'cy') * src.height
    const amp = N(c, 'height') * c.k
    const ridges = N(c, 'ridges')
    const R = Math.hypot(src.width, src.height) / 2
    return warp(src, (x, y, o) => {
      const dx = x - cx
      const dy = y - cy
      const d = Math.hypot(dx, dy) + 1e-4
      const t = (d / R) * ridges
      const tri = Math.abs((t % 2) - 1) * 2 - 1
      o[0] = x + (dx / d) * tri * amp
      o[1] = y + (dy / d) * tri * amp
    })
  },
}

const polar: FilterSpec = {
  id: 'polar',
  label: 'Polar',
  group: 'warp',
  hint: 'The picture rolled into a little planet, or unrolled out of one.',
  params: [choice('way', 'Direction', [{ id: 'planet', label: 'Planet' }, { id: 'tunnel', label: 'Tunnel' }, { id: 'unroll', label: 'Unroll' }]), range('spin', 'Spin', 0, 360, 0, { fmt: 'deg' })],
  fn: (src, c) => {
    const w = src.width
    const h = src.height
    const cx = w / 2
    const cy = h / 2
    const R = Math.min(w, h) / 2
    const way = S(c, 'way')
    const spin = rad(N(c, 'spin'))
    return warp(src, (x, y, o) => {
      if (way === 'unroll') {
        const a = (x / w) * Math.PI * 2 + spin
        const r = (y / h) * R
        o[0] = cx + Math.cos(a) * r
        o[1] = cy + Math.sin(a) * r
        return
      }
      const dx = x - cx
      const dy = y - cy
      let a = Math.atan2(dy, dx) + spin
      a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      const r = Math.min(1, Math.hypot(dx, dy) / R)
      o[0] = (a / (Math.PI * 2)) * w
      o[1] = way === 'planet' ? (1 - r) * h : r * h
    })
  },
}

const shear: FilterSpec = {
  id: 'shear',
  label: 'Shear',
  group: 'warp',
  hint: 'Slanted, as if pushed along one edge.',
  params: [range('amount', 'Slant', -1, 1, 0.3, { fmt: 'pct' }), choice('axis', 'Axis', [{ id: 'x', label: 'Across' }, { id: 'y', label: 'Down' }])],
  fn: (src, c) => {
    const amt = N(c, 'amount')
    const horiz = S(c, 'axis') === 'x'
    const w = src.width
    const h = src.height
    return warp(src, (x, y, o) => {
      o[0] = horiz ? x + (y - h / 2) * amt : x
      o[1] = horiz ? y : y + (x - w / 2) * amt
    })
  },
}

const kaleido: FilterSpec = {
  id: 'kaleido',
  label: 'Kaleidoscope',
  group: 'warp',
  hint: 'Mirrored wedges round the centre.',
  positioned: true,
  params: [range('segments', 'Mirrors', 2, 24, 6, { fmt: 'int' }), range('spin', 'Spin', 0, 360, 0, { fmt: 'deg' }), ...centre],
  fn: (src, c) => {
    const cx = N(c, 'cx') * src.width
    const cy = N(c, 'cy') * src.height
    const seg = (Math.PI * 2) / Math.max(2, Math.round(N(c, 'segments')))
    const spin = rad(N(c, 'spin'))
    return warp(src, (x, y, o) => {
      const dx = x - cx
      const dy = y - cy
      const r = Math.hypot(dx, dy)
      let a = Math.atan2(dy, dx) - spin
      a = ((a % seg) + seg) % seg
      if (a > seg / 2) a = seg - a
      o[0] = src.width / 2 + Math.cos(a + spin) * r
      o[1] = src.height / 2 + Math.sin(a + spin) * r
    })
  },
}

const mirror: FilterSpec = {
  id: 'mirror',
  label: 'Mirror',
  group: 'warp',
  hint: 'One half reflected onto the other.',
  params: [choice('side', 'Keep', [{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }, { id: 'top', label: 'Top' }, { id: 'quad', label: 'Quarter' }])],
  fn: (src, c) => {
    const w = src.width
    const h = src.height
    const side = S(c, 'side')
    return warp(src, (x, y, o) => {
      o[0] = side === 'right' ? (x < w / 2 ? w - x : x) : side === 'left' || side === 'quad' ? (x > w / 2 ? w - x : x) : x
      o[1] = side === 'top' || side === 'quad' ? (y > h / 2 ? h - y : y) : y
    })
  },
}

const smudge: FilterSpec = {
  id: 'smudge',
  label: 'Smudge',
  group: 'warp',
  hint: 'Pushed around by a thumb, in soft swirls.',
  params: [range('strength', 'Push', 0, 80, 22, { fmt: 'px' }), range('scale', 'Swirl size', 10, 400, 90, { fmt: 'px' })],
  fn: (src, c) => {
    const amt = N(c, 'strength') * c.k
    const sc = Math.max(2, N(c, 'scale') * c.k)
    return warp(src, (x, y, o) => {
      const a = fbm(x / sc, y / sc, 4) * Math.PI * 4
      o[0] = x + Math.cos(a) * amt
      o[1] = y + Math.sin(a) * amt
    })
  },
}

const tile: FilterSpec = {
  id: 'tile',
  label: 'Repeat',
  group: 'warp',
  hint: 'The picture tiled, each copy flipped to meet its neighbour.',
  params: [range('count', 'Across', 1, 8, 2, { fmt: 'int' }), toggle('flip', 'Flip alternate', true)],
  fn: (src, c) => {
    const n = Math.max(1, Math.round(N(c, 'count')))
    const flip = B(c, 'flip')
    const w = src.width
    const h = src.height
    return warp(src, (x, y, o) => {
      const u = (x / w) * n
      const v = (y / h) * n
      const iu = Math.floor(u)
      const iv = Math.floor(v)
      let fu = u - iu
      let fv = v - iv
      if (flip && iu % 2) fu = 1 - fu
      if (flip && iv % 2) fv = 1 - fv
      o[0] = fu * w
      o[1] = fv * h
    })
  },
}

// ----- blur -----

/** Stack offset copies of the frame through the compositor: every streak blur is this. */
function streak(src: HTMLCanvasElement, taps: number, place: (ctx: CanvasRenderingContext2D, t: number) => void) {
  const out = canvas(src.width, src.height)
  const ctx = ctx2d(out)
  ctx.drawImage(src, 0, 0)
  for (let i = 1; i <= taps; i++) {
    ctx.save()
    ctx.globalAlpha = 1 / (i + 1)
    place(ctx, i / taps)
    ctx.drawImage(src, 0, 0)
    ctx.restore()
  }
  return out
}

const gaussian: FilterSpec = {
  id: 'gaussian',
  label: 'Soften',
  group: 'blur',
  hint: 'Plain Gaussian defocus.',
  params: [range('radius', 'Radius', 0, 60, 6, { fmt: 'px' })],
  fn: (src, c) => blurred(src, N(c, 'radius') * c.k),
}

const motion: FilterSpec = {
  id: 'motion',
  label: 'Motion',
  group: 'blur',
  hint: 'Streaked along one direction, as if the camera moved.',
  params: [range('distance', 'Distance', 0, 200, 40, { fmt: 'px' }), range('angle', 'Angle', 0, 180, 0, { fmt: 'deg' })],
  fn: (src, c) => {
    const d = N(c, 'distance') * c.k
    const a = rad(N(c, 'angle'))
    return streak(src, 16, (ctx, t) => {
      const s = (t - 0.5) * d
      ctx.translate(Math.cos(a) * s, Math.sin(a) * s)
    })
  },
}

const spin: FilterSpec = {
  id: 'spin',
  label: 'Spin',
  group: 'blur',
  hint: 'Rotated round a centre while the shutter was open.',
  positioned: true,
  params: [range('angle', 'Angle', 0, 60, 10, { fmt: 'deg' }), ...centre],
  fn: (src, c) => {
    const cx = N(c, 'cx') * src.width
    const cy = N(c, 'cy') * src.height
    const a = rad(N(c, 'angle'))
    return streak(src, 18, (ctx, t) => {
      ctx.translate(cx, cy)
      ctx.rotate((t - 0.5) * a)
      ctx.translate(-cx, -cy)
    })
  },
}

const zoom: FilterSpec = {
  id: 'zoom',
  label: 'Zoom',
  group: 'blur',
  hint: 'Rushing outward from a point.',
  positioned: true,
  params: [range('amount', 'Rush', 0, 1, 0.25, { fmt: 'pct' }), ...centre],
  fn: (src, c) => {
    const cx = N(c, 'cx') * src.width
    const cy = N(c, 'cy') * src.height
    const amt = N(c, 'amount') * 0.5
    return streak(src, 18, (ctx, t) => {
      const s = 1 + t * amt
      ctx.translate(cx, cy)
      ctx.scale(s, s)
      ctx.translate(-cx, -cy)
    })
  },
}

/** A blurred copy shown through a gradient mask, shared by tilt-shift and progressive. */
function maskedBlur(src: HTMLCanvasElement, radius: number, mask: (ctx: CanvasRenderingContext2D) => void) {
  const soft = blurred(src, radius)
  const m = canvas(src.width, src.height)
  const mc = ctx2d(m)
  mask(mc)
  const sc = ctx2d(soft)
  sc.globalCompositeOperation = 'destination-in'
  sc.drawImage(m, 0, 0)
  const out = copy(src)
  ctx2d(out).drawImage(soft, 0, 0)
  return out
}

const tiltshift: FilterSpec = {
  id: 'tiltshift',
  label: 'Tilt-shift',
  group: 'blur',
  hint: 'A sharp band with everything above and below it melting away. Makes things look tiny.',
  params: [range('focus', 'Focus line', 0, 1, 0.55, { fmt: 'pct' }), range('band', 'Sharp band', 0.02, 0.6, 0.16, { fmt: 'pct' }), range('radius', 'Blur', 0, 40, 12, { fmt: 'px' })],
  fn: (src, c) => {
    const h = src.height
    const f = N(c, 'focus')
    const band = N(c, 'band')
    return maskedBlur(src, N(c, 'radius') * c.k, (m) => {
      const g = m.createLinearGradient(0, 0, 0, h)
      const at = (v: number) => Math.min(1, Math.max(0, v))
      g.addColorStop(0, '#fff')
      g.addColorStop(at(f - band * 1.8), '#fff')
      g.addColorStop(at(f - band * 0.5), 'rgba(255,255,255,0)')
      g.addColorStop(at(f + band * 0.5), 'rgba(255,255,255,0)')
      g.addColorStop(at(f + band * 1.8), '#fff')
      g.addColorStop(1, '#fff')
      m.fillStyle = g
      m.fillRect(0, 0, src.width, h)
    })
  },
}

const progressive: FilterSpec = {
  id: 'progressive',
  label: 'Fade blur',
  group: 'blur',
  hint: 'Sharp on one side, softening steadily toward the other.',
  params: [range('radius', 'Blur', 0, 60, 18, { fmt: 'px' }), range('angle', 'Direction', 0, 360, 90, { fmt: 'deg' }), range('start', 'Starts at', 0, 1, 0.3, { fmt: 'pct' })],
  fn: (src, c) => {
    const w = src.width
    const h = src.height
    const a = rad(N(c, 'angle'))
    const half = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2
    return maskedBlur(src, N(c, 'radius') * c.k, (m) => {
      const g = m.createLinearGradient(
        w / 2 - Math.cos(a) * half,
        h / 2 - Math.sin(a) * half,
        w / 2 + Math.cos(a) * half,
        h / 2 + Math.sin(a) * half,
      )
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(Math.min(0.99, N(c, 'start')), 'rgba(255,255,255,0)')
      g.addColorStop(1, '#fff')
      m.fillStyle = g
      m.fillRect(0, 0, w, h)
    })
  },
}

const lens: FilterSpec = {
  id: 'lens',
  label: 'Bokeh',
  group: 'blur',
  hint: 'Out of focus through a real lens: highlights swell into bright discs.',
  params: [range('radius', 'Blur', 0, 40, 10, { fmt: 'px' }), amount(0.6, 'Highlights', 'glow')],
  fn: (src, c) => {
    const r = N(c, 'radius') * c.k
    const out = blurred(src, r)
    const glow = N(c, 'glow')
    if (glow <= 0 || r < 1) return out
    // bright spots only, spread wider than the blur and added back on
    const bright = copy(src)
    const bc = ctx2d(bright)
    bc.filter = 'brightness(0.7) contrast(3) brightness(0.6)'
    bc.drawImage(src, 0, 0)
    bc.filter = 'none'
    const ctx = ctx2d(out)
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = glow
    ctx.drawImage(blurred(bright, r * 1.6), 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    return out
  },
}

// ----- glass -----

const fluted: FilterSpec = {
  id: 'fluted',
  label: 'Reeded',
  group: 'glass',
  hint: 'Behind ribbed glass: every flute bends its own strip of the picture.',
  params: [range('width', 'Rib width', 4, 120, 28, { fmt: 'px' }), range('bend', 'Bend', 0, 1, 0.55, { fmt: 'pct' }), range('angle', 'Angle', 0, 180, 0, { fmt: 'deg' }), toggle('cross', 'Cross ribs')],
  fn: (src, c) => {
    const wd = Math.max(2, N(c, 'width') * c.k)
    const bend = N(c, 'bend') * wd * 1.4
    const a = rad(N(c, 'angle'))
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const cross = B(c, 'cross')
    const lensAt = (v: number) => {
      const f = v / wd - Math.floor(v / wd)
      return (f - 0.5) * 2
    }
    return warp(src, (x, y, o) => {
      const u = x * ca + y * sa
      const off = lensAt(u) * bend
      let ox = x - ca * off
      let oy = y - sa * off
      if (cross) {
        const off2 = lensAt(-x * sa + y * ca) * bend
        ox += sa * off2
        oy -= ca * off2
      }
      o[0] = ox
      o[1] = oy
    })
  },
}

const frosted: FilterSpec = {
  id: 'frosted',
  label: 'Frosted',
  group: 'glass',
  hint: 'Sandblasted glass: fine scatter and a milky softness.',
  params: [range('scatter', 'Scatter', 0, 30, 8, { fmt: 'px' }), amount(0.25, 'Milk', 'milk')],
  fn: (src, c) => {
    const s = N(c, 'scatter') * c.k
    const out = warp(src, (x, y, o) => {
      o[0] = x + (hash(x | 0, y | 0, 1) - 0.5) * s * 2
      o[1] = y + (hash(x | 0, y | 0, 2) - 0.5) * s * 2
    })
    const milk = N(c, 'milk')
    if (milk > 0) {
      const ctx = ctx2d(out)
      ctx.fillStyle = `rgba(235, 240, 245, ${milk * 0.5})`
      ctx.fillRect(0, 0, out.width, out.height)
    }
    return blurred(out, s * 0.25)
  },
}

const glasstiles: FilterSpec = {
  id: 'glasstiles',
  label: 'Glass blocks',
  group: 'glass',
  hint: 'A wall of square glass bricks, each one a small lens.',
  params: [range('size', 'Block', 8, 200, 48, { fmt: 'px' }), range('bend', 'Bend', 0, 1, 0.5, { fmt: 'pct' })],
  fn: (src, c) => {
    const size = Math.max(4, N(c, 'size') * c.k)
    const bend = N(c, 'bend')
    return warp(src, (x, y, o) => {
      const fx = x / size - Math.floor(x / size) - 0.5
      const fy = y / size - Math.floor(y / size) - 0.5
      o[0] = x - fx * size * bend * 1.2
      o[1] = y - fy * size * bend * 1.2
    })
  },
}

const hammered: FilterSpec = {
  id: 'hammered',
  label: 'Hammered',
  group: 'glass',
  hint: 'Dimpled, hand-beaten glass.',
  params: [range('size', 'Dimple', 6, 120, 30, { fmt: 'px' }), range('strength', 'Depth', 0, 40, 12, { fmt: 'px' })],
  fn: (src, c) => {
    const size = Math.max(3, N(c, 'size') * c.k)
    const amt = N(c, 'strength') * c.k
    return warp(src, (x, y, o) => {
      const v = voronoi(x, y, size, 11)
      const dx = (x - v.sx) / size
      const dy = (y - v.sy) / size
      o[0] = x - dx * amt * 2
      o[1] = y - dy * amt * 2
    })
  },
}

const shatter: FilterSpec = {
  id: 'shatter',
  label: 'Shatter',
  group: 'glass',
  hint: 'Broken into shards, each knocked slightly out of place.',
  params: [range('size', 'Shard', 10, 300, 80, { fmt: 'px' }), range('offset', 'Knock', 0, 60, 14, { fmt: 'px' }), toggle('cracks', 'Cracks', true)],
  fn: (src, c) => {
    const size = Math.max(4, N(c, 'size') * c.k)
    const amt = N(c, 'offset') * c.k
    const out = warp(src, (x, y, o) => {
      const v = voronoi(x, y, size, 19)
      o[0] = x + (hash(v.id, 0, 3) - 0.5) * amt * 2
      o[1] = y + (hash(v.id, 0, 4) - 0.5) * amt * 2
    })
    if (!B(c, 'cracks')) return out
    const img = read(out)
    const d = img.data
    const w = img.width
    for (let i = 0; i < w * img.height; i++) {
      const x = i % w
      const y = (i / w) | 0
      const v = voronoi(x, y, size, 19)
      if (v.d2 - v.d1 < 1.2 * c.k) {
        d[i * 4] = clamp255(d[i * 4] + 90)
        d[i * 4 + 1] = clamp255(d[i * 4 + 1] + 90)
        d[i * 4 + 2] = clamp255(d[i * 4 + 2] + 90)
      }
    }
    return fromData(img)
  },
}

const orb: FilterSpec = {
  id: 'orb',
  label: 'Glass orb',
  group: 'glass',
  hint: 'A crystal ball sat on the picture, showing it upside down.',
  positioned: true,
  params: [range('radius', 'Size', 0.05, 0.8, 0.3, { fmt: 'pct' }), amount(0.8, 'Refraction', 'refract'), ...centre],
  fn: (src, c) => {
    const { cx, cy, R } = focus(src, c)
    const refract = N(c, 'refract')
    const out = warp(src, (x, y, o) => {
      const dx = (x - cx) / R
      const dy = (y - cy) / R
      const d = Math.hypot(dx, dy)
      if (d >= 1) return void ((o[0] = x), (o[1] = y))
      const z = Math.sqrt(1 - d * d)
      const k = 1 - refract * (1 + z)
      o[0] = cx + dx * R * k
      o[1] = cy + dy * R * k
    })
    const ctx = ctx2d(out)
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.02, cx, cy, R)
    g.addColorStop(0, 'rgba(255,255,255,0.55)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.08)')
    g.addColorStop(0.92, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.35)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fill()
    return out
  },
}

// ----- colour -----

/** Run a per-pixel colour function over the frame. */
function perPixel(src: HTMLCanvasElement, fn: (d: Uint8ClampedArray, p: number) => void) {
  const img = read(src)
  const d = img.data
  for (let p = 0; p < d.length; p += 4) fn(d, p)
  return fromData(img)
}

const gradmap: FilterSpec = {
  id: 'gradmap',
  label: 'Gradient map',
  group: 'color',
  hint: 'Brightness re-coloured through a gradient.',
  params: [choice('gradient', 'Gradient', GRADIENTS.map((g) => ({ id: g.id, label: g.label })), 'cyber'), amount(1, 'Mix')],
  fn: (src, c) => {
    const img = read(src)
    mapThroughLut(img, gradientLut(S(c, 'gradient')), N(c, 'amount'))
    return fromData(img)
  },
}

const duotone: FilterSpec = {
  id: 'duotone',
  label: 'Duotone',
  group: 'color',
  hint: 'Two inks, shadows and highlights.',
  params: [color('dark', 'Shadows', '#1d1a4f'), color('light', 'Highlights', '#ff9f68'), amount(1, 'Mix')],
  fn: (src, c) => {
    const a = hexRgb(S(c, 'dark'))
    const b = hexRgb(S(c, 'light'))
    const mix = N(c, 'amount')
    return perPixel(src, (d, p) => {
      const l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255
      for (let ch = 0; ch < 3; ch++) d[p + ch] += (a[ch] + (b[ch] - a[ch]) * l - d[p + ch]) * mix
    })
  },
}

const hue: FilterSpec = {
  id: 'hue',
  label: 'Hue & vibrance',
  group: 'color',
  hint: 'Turn the colour wheel, and push or drain saturation.',
  params: [range('shift', 'Hue', -180, 180, 40, { fmt: 'deg' }), range('sat', 'Saturation', 0, 3, 1.3, { fmt: 'x' }), range('bright', 'Brightness', 0.2, 2, 1, { fmt: 'x' })],
  fn: (src, c) => {
    const out = canvas(src.width, src.height)
    const ctx = ctx2d(out)
    ctx.filter = `hue-rotate(${N(c, 'shift')}deg) saturate(${N(c, 'sat')}) brightness(${N(c, 'bright')})`
    ctx.drawImage(src, 0, 0)
    ctx.filter = 'none'
    return out
  },
}

const temperature: FilterSpec = {
  id: 'temperature',
  label: 'Temperature',
  group: 'color',
  hint: 'Warmer or cooler light, with a green or magenta tint.',
  params: [range('warmth', 'Warmth', -1, 1, 0.35, { fmt: 'pct' }), range('tint', 'Tint', -1, 1, 0, { fmt: 'pct' })],
  fn: (src, c) => {
    const t = N(c, 'warmth') * 40
    const g = N(c, 'tint') * 30
    return perPixel(src, (d, p) => {
      d[p] = clamp255(d[p] + t)
      d[p + 1] = clamp255(d[p + 1] - g)
      d[p + 2] = clamp255(d[p + 2] - t)
    })
  },
}

const posterize: FilterSpec = {
  id: 'posterize',
  label: 'Posterize',
  group: 'color',
  hint: 'Fewer steps per channel, like a cheap print.',
  params: [range('levels', 'Levels', 2, 12, 4, { fmt: 'int' })],
  fn: (src, c) => {
    const step = 255 / (Math.max(2, Math.round(N(c, 'levels'))) - 1)
    return perPixel(src, (d, p) => {
      d[p] = Math.round(d[p] / step) * step
      d[p + 1] = Math.round(d[p + 1] / step) * step
      d[p + 2] = Math.round(d[p + 2] / step) * step
    })
  },
}

const threshold: FilterSpec = {
  id: 'threshold',
  label: 'Threshold',
  group: 'color',
  hint: 'Every pixel black or white.',
  params: [range('level', 'Level', 0, 1, 0.5, { fmt: 'pct' }), range('soft', 'Softness', 0, 0.3, 0.02, { fmt: 'pct' })],
  fn: (src, c) => {
    const t = N(c, 'level') * 255
    const soft = Math.max(1, N(c, 'soft') * 255)
    return perPixel(src, (d, p) => {
      const l = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]
      const v = clamp255(((l - t) / soft + 0.5) * 255)
      d[p] = v
      d[p + 1] = v
      d[p + 2] = v
    })
  },
}

const solarize: FilterSpec = {
  id: 'solarize',
  label: 'Solarize',
  group: 'color',
  hint: 'Highlights flipped to negative, the Sabattier darkroom accident.',
  params: [range('level', 'Turn at', 0, 1, 0.5, { fmt: 'pct' })],
  fn: (src, c) => {
    const t = N(c, 'level') * 255
    return perPixel(src, (d, p) => {
      for (let ch = 0; ch < 3; ch++) if (d[p + ch] > t) d[p + ch] = 255 - d[p + ch] + t * 0.2
    })
  },
}

const invert: FilterSpec = {
  id: 'invert',
  label: 'Negative',
  group: 'color',
  hint: 'Every colour to its opposite.',
  params: [amount(1, 'Mix')],
  fn: (src, c) => {
    const m = N(c, 'amount')
    return perPixel(src, (d, p) => {
      d[p] += (255 - 2 * d[p]) * m
      d[p + 1] += (255 - 2 * d[p + 1]) * m
      d[p + 2] += (255 - 2 * d[p + 2]) * m
    })
  },
}

const vignetteLayer: FilterSpec = {
  id: 'spotlight',
  label: 'Spotlight',
  group: 'color',
  hint: 'Light pooled on one spot, the rest in shadow. Before the style, so the style draws the falloff.',
  positioned: true,
  params: [range('radius', 'Pool', 0.05, 1, 0.45, { fmt: 'pct' }), amount(0.8, 'Darkness'), ...centre],
  fn: (src, c) => {
    const { cx, cy, R } = focus(src, c)
    const out = copy(src)
    const ctx = ctx2d(out)
    const g = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 1.4)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${N(c, 'amount')})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, out.width, out.height)
    return out
  },
}

// ----- glitch -----

const rgbshift: FilterSpec = {
  id: 'rgbshift',
  label: 'Channel shift',
  group: 'glitch',
  hint: 'Red, green and blue knocked apart.',
  params: [range('distance', 'Distance', 0, 60, 8, { fmt: 'px' }), range('angle', 'Angle', 0, 360, 0, { fmt: 'deg' })],
  fn: (src, c) => {
    const img = read(src)
    const { width: w, height: h, data: d } = img
    const dist = N(c, 'distance') * c.k
    const a = rad(N(c, 'angle'))
    const ox = Math.round(Math.cos(a) * dist)
    const oy = Math.round(Math.sin(a) * dist)
    const out = new ImageData(w, h)
    const o = out.data
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4
        const rx = Math.min(w - 1, Math.max(0, x + ox))
        const ry = Math.min(h - 1, Math.max(0, y + oy))
        const bx = Math.min(w - 1, Math.max(0, x - ox))
        const by = Math.min(h - 1, Math.max(0, y - oy))
        o[p] = d[(ry * w + rx) * 4]
        o[p + 1] = d[p + 1]
        o[p + 2] = d[(by * w + bx) * 4 + 2]
        o[p + 3] = d[p + 3]
      }
    }
    return fromData(out)
  },
}

const slices: FilterSpec = {
  id: 'slices',
  label: 'Datamosh',
  group: 'glitch',
  hint: 'Blocks of the frame dragged sideways and smeared, like a broken video stream.',
  params: [range('amount', 'Damage', 0, 1, 0.4, { fmt: 'pct' }), range('block', 'Block', 4, 80, 16, { fmt: 'px' }), range('seed', 'Seed', 0, 99, 7, { fmt: 'int' })],
  fn: (src, c) => {
    const blk = Math.max(2, N(c, 'block') * c.k)
    const amt = N(c, 'amount')
    const seed = N(c, 'seed')
    const w = src.width
    return warp(src, (x, y, o) => {
      const by = Math.floor(y / blk)
      const bx = Math.floor(x / (blk * 4))
      const hit = hash(bx, by, seed) < amt * 0.5
      const row = hash(0, by, seed + 1) < amt * 0.35
      o[0] = hit ? x - (hash(bx, by, seed + 2) - 0.3) * w * 0.15 * amt : row ? x - hash(0, by, seed + 3) * w * 0.3 * amt : x
      o[1] = hit ? by * blk + (y % blk) * 0.2 : y
    })
  },
}

const compress: FilterSpec = {
  id: 'compress',
  label: 'Compression',
  group: 'glitch',
  hint: 'Over-compressed: flat 8px blocks with the colour bleeding.',
  params: [range('block', 'Block', 4, 48, 12, { fmt: 'px' }), amount(0.7, 'Crush')],
  fn: (src, c) => {
    const blk = Math.max(2, Math.round(N(c, 'block') * c.k))
    const crush = N(c, 'amount')
    const small = canvas(Math.ceil(src.width / blk), Math.ceil(src.height / blk))
    const sc = ctx2d(small)
    sc.drawImage(src, 0, 0, small.width, small.height)
    const out = copy(src)
    const ctx = ctx2d(out)
    ctx.imageSmoothingEnabled = false
    ctx.globalAlpha = crush
    ctx.drawImage(small, 0, 0, small.width * blk, small.height * blk)
    ctx.globalAlpha = 1
    const step = 255 / Math.max(2, Math.round(10 - crush * 7))
    return perPixel(out, (d, p) => {
      d[p] = Math.round(d[p] / step) * step
      d[p + 1] = Math.round(d[p + 1] / (step * 0.6)) * step * 0.6
      d[p + 2] = Math.round(d[p + 2] / step) * step
    })
  },
}

const scanjitter: FilterSpec = {
  id: 'scanjitter',
  label: 'VHS',
  group: 'glitch',
  hint: 'Tracking wobble, bleeding colour and a noise bar, off an old tape.',
  params: [amount(0.5, 'Wobble'), amount(0.4, 'Bleed', 'bleed'), range('seed', 'Seed', 0, 99, 3, { fmt: 'int' })],
  fn: (src, c) => {
    const amt = N(c, 'amount') * 12 * c.k
    const seed = N(c, 'seed')
    const h = src.height
    const bar = hash(seed, 0, 5) * h
    const wobbly = warp(src, (x, y, o) => {
      const nearBar = Math.max(0, 1 - Math.abs(y - bar) / (h * 0.06))
      o[0] = x + (noise(y / (8 * c.k), seed, 2) - 0.5) * amt + nearBar * amt * 3 * (hash(0, y | 0, seed) - 0.5)
      o[1] = y
    })
    const bleed = N(c, 'bleed')
    if (bleed <= 0) return wobbly
    const img = read(wobbly)
    const d = img.data
    const w = img.width
    const reach = Math.max(1, Math.round(bleed * 8 * c.k))
    for (let y = 0; y < img.height; y++) {
      let r = d[y * w * 4]
      let bl = d[y * w * 4 + 2]
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4
        r += (d[p] - r) / reach
        bl += (d[p + 2] - bl) / reach
        d[p] = r
        d[p + 2] = bl
      }
    }
    return fromData(img)
  },
}

const noiseLayer: FilterSpec = {
  id: 'noise',
  label: 'Noise',
  group: 'glitch',
  hint: 'Sensor noise before the style, so the style draws it too.',
  params: [amount(0.3), toggle('mono', 'Mono', true)],
  fn: (src, c) => {
    const amt = N(c, 'amount') * 120
    const mono = B(c, 'mono')
    const w = src.width
    let i = 0
    return perPixel(src, (d, p) => {
      const x = i % w
      const y = (i / w) | 0
      i++
      const a = (hash(x, y, 1) - 0.5) * amt
      d[p] = clamp255(d[p] + a)
      d[p + 1] = clamp255(d[p + 1] + (mono ? a : (hash(x, y, 2) - 0.5) * amt))
      d[p + 2] = clamp255(d[p + 2] + (mono ? a : (hash(x, y, 3) - 0.5) * amt))
    })
  },
}

export const FILTERS: FilterSpec[] = [
  twirl,
  pinch,
  spherize,
  ripple,
  waves,
  zigzag,
  polar,
  shear,
  kaleido,
  mirror,
  smudge,
  tile,
  gaussian,
  motion,
  spin,
  zoom,
  tiltshift,
  progressive,
  lens,
  fluted,
  frosted,
  glasstiles,
  hammered,
  shatter,
  orb,
  gradmap,
  duotone,
  hue,
  temperature,
  posterize,
  threshold,
  solarize,
  invert,
  vignetteLayer,
  rgbshift,
  slices,
  compress,
  scanjitter,
  noiseLayer,
]

const BY_ID = new Map(FILTERS.map((f) => [f.id, f]))

export function getFilter(id: string): FilterSpec | undefined {
  return BY_ID.get(id)
}
