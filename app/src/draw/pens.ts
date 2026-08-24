/**
 * The pens.
 *
 * "Each pen behaves like the thing it's named after. The pencil, pen and brush
 * thin out the faster you move, while the fineliner and highlighter keep a
 * constant width. The fountain pen responds to direction instead: thick one
 * way, hairline the other."
 *
 * That paragraph is the whole specification, and each clause is a different
 * mechanism rather than a different number:
 *
 *   - *Thinning with speed* is a velocity model. It matters most on a mouse,
 *     which reports no pressure at all, so without it every stroke from a
 *     trackpad comes out as dead uniform tube. Where a real stylus is present
 *     its pressure is used instead, because that is the better signal.
 *   - *Constant width* is the absence of that model, not a small amount of it.
 *     A fineliner that varies is a broken fineliner.
 *   - *Direction* is not a width curve at all. A chisel nib is a line segment
 *     dragged through the page: offset the edges along the *nib* rather than
 *     along the perpendicular of travel and the thick/thin falls out of the
 *     geometry for free, including the hairline you get moving along the nib.
 *
 * A stroke is turned into a filled outline rather than a stroked centre line,
 * which is the only way width can vary along it.
 */

import type { PenId } from './types'
import type { Point } from './rough'

export interface PenSpec {
  id: PenId
  name: string
  /** single-key shortcut, shown in the tooltip */
  key: string
  /** default barrel size, in scene units */
  size: number
  /** what the size slider spans for this pen */
  range: [number, number]
  /** 0 = constant width, 1 = fully speed/pressure driven */
  thinning: number
  /** how hard the input is pulled toward the pointer; higher is smoother, laggier */
  streamline: number
  opacity: number
  /** paint under what is already there, the way a real highlighter does */
  blend?: 'multiply'
  /** a chisel nib. The stroke becomes a ribbon swept at this angle, in radians */
  nib?: number
  /** how far the nib narrows at its thinnest, as a fraction of the barrel */
  nibMin?: number
  /** ragged edge, for the pencil */
  grain?: number
  /** [start, end] taper, as a multiple of the barrel size */
  taper: [number, number]
  /** butt caps rather than round, for chisel tips */
  flatCap?: boolean
  /** barrel colours [body, accent] for the pen drawn in the tray */
  barrel: [string, string]
}

/**
 * The tray, in order.
 *
 * The order is not arbitrary: it runs from hardest and finest to softest and
 * widest, so the row itself is a scale you can read, and the pen you want is
 * roughly where your eye expects it before you have read a single tooltip.
 */
export const PEN_ORDER: PenId[] = [
  'pencil',
  'pen',
  'fineliner',
  'marker',
  'highlighter',
  'brush',
  'fountain',
]

export const PENS: Record<PenId, PenSpec> = {
  pencil: {
    id: 'pencil',
    name: 'Pencil',
    key: 'p',
    size: 4,
    range: [1, 24],
    thinning: 0.62,
    streamline: 0.42,
    opacity: 0.92,
    grain: 0.5,
    taper: [0.6, 1.2],
    barrel: ['#d9a441', '#3d3d3d'],
  },
  pen: {
    id: 'pen',
    name: 'Pen',
    key: 'n',
    size: 5,
    range: [1, 28],
    thinning: 0.5,
    streamline: 0.5,
    opacity: 1,
    taper: [0.3, 0.9],
    barrel: ['#2b6cb0', '#c2c7d0'],
  },
  fineliner: {
    id: 'fineliner',
    name: 'Fineliner',
    key: 'f',
    size: 3,
    range: [0.5, 16],
    // dead constant on purpose: a fineliner that varies is a broken fineliner
    thinning: 0,
    streamline: 0.5,
    opacity: 1,
    taper: [0, 0],
    barrel: ['#1a1a1a', '#8a8f98'],
  },
  marker: {
    id: 'marker',
    name: 'Marker',
    key: 'm',
    size: 12,
    range: [4, 48],
    thinning: 0.12,
    streamline: 0.55,
    opacity: 1,
    taper: [0, 0.15],
    barrel: ['#c9463f', '#f0e6d2'],
  },
  highlighter: {
    id: 'highlighter',
    name: 'Highlighter',
    key: 'g',
    size: 22,
    range: [8, 60],
    thinning: 0,
    streamline: 0.6,
    // low enough that overlapping passes build up rather than blocking out
    opacity: 0.38,
    blend: 'multiply',
    flatCap: true,
    taper: [0, 0],
    barrel: ['#e9d13a', '#f6f0b4'],
  },
  brush: {
    id: 'brush',
    name: 'Brush',
    key: 'b',
    size: 14,
    range: [3, 64],
    // the most dramatic of the three, which is what makes it read as a brush
    thinning: 0.82,
    streamline: 0.38,
    opacity: 1,
    taper: [1.4, 2.2],
    barrel: ['#7c4a2d', '#2f2f2f'],
  },
  fountain: {
    id: 'fountain',
    name: 'Fountain Pen',
    key: 'k',
    size: 11,
    range: [3, 40],
    thinning: 0.2,
    streamline: 0.45,
    opacity: 1,
    // 45 degrees up to the right, where a right-handed nib naturally sits
    nib: -Math.PI / 4,
    nibMin: 0.12,
    taper: [0.2, 0.5],
    barrel: ['#1f3a5f', '#c9a227'],
  },
}

/** The eraser's barrel, so the tray can draw it alongside the pens. */
export const ERASER = {
  id: 'eraser',
  name: 'Eraser',
  key: 'e',
  size: 24,
  range: [6, 120],
  barrel: ['#e8e0d4', '#5a8fd6'] as [string, string],
}

/*
 * Above this speed a velocity-driven pen is at its thinnest. Measured in scene
 * units per millisecond: unhurried drawing sits near 0.4, and a fast flick
 * across the canvas is comfortably past 2.
 */
const FAST = 2.1

/** Does this device actually report pressure, or is it a mouse telling us 0.5? */
function hasRealPressure(pts: [number, number, number, number][]): boolean {
  for (const p of pts) {
    const v = p[2]
    if (v > 0 && Math.abs(v - 0.5) > 0.02) return true
  }
  return false
}

const dist = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1])

/** roughjs's PRNG again, so a stroke's grain is stable across repaints. */
function rng(seed: number) {
  let s = seed || 1
  return () => {
    s = Math.imul(48271, s)
    return ((2 ** 31 - 1) & s) / 2 ** 31
  }
}

/**
 * The outline of a stroke: the closed polygon that, filled, *is* the mark.
 *
 * Returned in the element's own coordinates. The caller scales for zoom, so
 * this stays independent of how far in you happen to be looking.
 */
export function strokeOutline(
  raw: [number, number, number, number][],
  spec: PenSpec,
  size: number,
  seed: number,
): Point[] {
  if (raw.length === 0) return []
  const half = size / 2

  // a tap with no travel is still a mark: the dab the nib leaves sitting still
  if (raw.length === 1) {
    const [x, y] = raw[0]
    const out: Point[] = []
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      out.push([x + Math.cos(a) * half, y + Math.sin(a) * half])
    }
    return out
  }

  /*
   * Streamline first. Raw pointer samples are noisy and unevenly spaced, and
   * drawing straight from them gives a stroke the shakes even on a steady
   * hand. This is an exponential pull of the working point toward the reported
   * one: the higher the streamline, the smoother and the more it lags.
   */
  const s = spec.streamline
  const pts: [number, number, number, number][] = [raw[0].slice() as [number, number, number, number]]
  for (let i = 1; i < raw.length; i++) {
    const prev = pts[pts.length - 1]
    const p = raw[i]
    const x = prev[0] + (p[0] - prev[0]) * (1 - s)
    const y = prev[1] + (p[1] - prev[1]) * (1 - s)
    // drop samples that did not really go anywhere; they only add corner noise
    if (Math.hypot(x - prev[0], y - prev[1]) < 0.35 && i !== raw.length - 1) continue
    pts.push([x, y, p[2], p[3]])
  }
  if (pts.length < 2) pts.push([raw[raw.length - 1][0] + 0.01, raw[raw.length - 1][1], raw[raw.length - 1][2], raw[raw.length - 1][3]])

  const nib = spec.nib
  const usePressure = hasRealPressure(raw)

  /*
   * Per-point radius.
   *
   * A stylus's own pressure beats anything inferred, so it wins where present.
   * Otherwise speed stands in for it, on the reasoning that a hand bearing down
   * is also a hand moving slowly.
   */
  const radii: number[] = []
  for (let i = 0; i < pts.length; i++) {
    let t: number
    if (spec.thinning === 0) {
      t = 1
    } else if (usePressure) {
      t = 1 - spec.thinning + spec.thinning * Math.max(0.05, pts[i][2])
    } else {
      const a = pts[Math.max(0, i - 1)]
      const b = pts[i]
      const dt = Math.max(1, b[3] - a[3])
      const speed = Math.hypot(b[0] - a[0], b[1] - a[1]) / dt
      // eased so the interesting range sits where ordinary drawing lives
      const f = Math.min(1, speed / FAST) ** 0.75
      t = 1 - spec.thinning * f
    }
    radii.push(half * t)
  }

  // smooth the radius along the stroke, or every speed spike becomes a bulge
  const smoothed = radii.map((_, i) => {
    let sum = 0
    let count = 0
    for (let k = Math.max(0, i - 2); k <= Math.min(radii.length - 1, i + 2); k++) {
      sum += radii[k]
      count++
    }
    return sum / count
  })

  /*
   * Taper. Real pens do not start at full width; they arrive. The taper runs
   * over a distance proportional to the barrel, so it stays in proportion at
   * every size rather than swallowing a short stroke whole.
   */
  const [taperIn, taperOut] = spec.taper
  if (taperIn > 0 || taperOut > 0) {
    const cum: number[] = [0]
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + dist([pts[i - 1][0], pts[i - 1][1]], [pts[i][0], pts[i][1]]))
    }
    const total = cum[cum.length - 1]
    const inLen = Math.min(taperIn * size, total / 2)
    const outLen = Math.min(taperOut * size, total / 2)
    for (let i = 0; i < smoothed.length; i++) {
      let f = 1
      if (inLen > 0) f = Math.min(f, Math.sqrt(Math.min(1, cum[i] / inLen)))
      if (outLen > 0) f = Math.min(f, Math.sqrt(Math.min(1, (total - cum[i]) / outLen)))
      smoothed[i] *= f
    }
  }

  const rand = rng(seed)
  const grain = spec.grain ?? 0

  const left: Point[] = []
  const right: Point[] = []

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    let ox: number
    let oy: number

    if (nib !== undefined) {
      /*
       * The chisel, treated as the shape it actually is: a thin rectangle
       * dragged through the page. The width you see at any instant is that
       * rectangle's shadow across the direction of travel, which is its full
       * length when you move across the nib and only its thickness when you
       * move along it.
       *
       * Offsetting along the *nib* is the tempting shortcut, and it is wrong.
       * It puts both edges of the ribbon on the line of travel whenever you
       * move parallel to the nib, so the stroke encloses no area and a fountain
       * pen drawn at its own angle disappears completely. Offsetting
       * perpendicular to travel by the nib's shadow is the honest version, and
       * `nibMin` is then a real thickness rather than a fudge factor. The slant
       * that makes a calligraphic stroke recognisable comes back at the caps.
       */
      const prev = pts[Math.max(0, i - 1)]
      const next = pts[Math.min(pts.length - 1, i + 1)]
      let dx = next[0] - prev[0]
      let dy = next[1] - prev[1]
      const len = Math.hypot(dx, dy) || 1
      dx /= len
      dy /= len
      // how square the travel is to the nib: 1 across it, 0 along it
      const across = Math.abs(dx * Math.sin(nib) - dy * Math.cos(nib))
      const along = Math.abs(dx * Math.cos(nib) + dy * Math.sin(nib))
      const r = smoothed[i] * (across + (spec.nibMin ?? 0.1) * along)
      ox = -dy * r
      oy = dx * r
    } else {
      const prev = pts[Math.max(0, i - 1)]
      const next = pts[Math.min(pts.length - 1, i + 1)]
      let dx = next[0] - prev[0]
      let dy = next[1] - prev[1]
      const len = Math.hypot(dx, dy) || 1
      dx /= len
      dy /= len
      let r = smoothed[i]
      if (grain > 0) r *= 1 - grain * 0.22 * rand()
      // perpendicular to travel
      ox = -dy * r
      oy = dx * r
    }

    left.push([p[0] + ox, p[1] + oy])
    right.push([p[0] - ox, p[1] - oy])
  }

  /*
   * Caps. Round nibs get a real half-turn at each end so a slow start reads as
   * a dot rather than a chopped-off rectangle; chisel tips get a butt cap,
   * which is what a highlighter actually leaves.
   */
  const out: Point[] = [...left]
  if (nib !== undefined) {
    /*
     * The terminus of a chisel stroke is the nib itself, so the ends are cut at
     * the nib's own angle rather than square to the travel. Dropping its two
     * corners in at each end is what gives calligraphy its wedge-shaped starts
     * and finishes, and it is also what keeps the stroke visible when travel
     * runs along the nib: the body has collapsed to a hairline by then, and
     * these corners are the only thing still carrying the nib's length.
     */
    const nx = Math.cos(nib)
    const ny = Math.sin(nib)
    const corner = (p: [number, number, number, number], r: number, sign: number): Point => [
      p[0] + nx * r * sign,
      p[1] + ny * r * sign,
    ]
    const gap = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
    // whichever corner is nearer the edge we are leaving goes first, or the
    // outline crosses itself and the fill turns inside out
    const pair = (p: [number, number, number, number], r: number, from: Point): Point[] => {
      const a = corner(p, r, 1)
      const b = corner(p, r, -1)
      return gap(a, from) <= gap(b, from) ? [a, b] : [b, a]
    }
    const endP = pts[pts.length - 1]
    const startP = pts[0]
    out.push(...pair(endP, smoothed[smoothed.length - 1], left[left.length - 1]))
    const back = [...right].reverse()
    out.push(...back)
    out.push(...pair(startP, smoothed[0], back[back.length - 1]))
  } else if (spec.flatCap) {
    out.push(...right.reverse())
  } else {
    const end = pts[pts.length - 1]
    const endR = smoothed[smoothed.length - 1]
    const endA = Math.atan2(left[left.length - 1][1] - end[1], left[left.length - 1][0] - end[0])
    for (let i = 1; i < 8; i++) {
      const a = endA - (Math.PI * i) / 8
      out.push([end[0] + Math.cos(a) * endR, end[1] + Math.sin(a) * endR])
    }
    out.push(...right.reverse())
    const start = pts[0]
    const startR = smoothed[0]
    const startA = Math.atan2(right[right.length - 1][1] - start[1], right[right.length - 1][0] - start[0])
    for (let i = 1; i < 8; i++) {
      const a = startA - (Math.PI * i) / 8
      out.push([start[0] + Math.cos(a) * startR, start[1] + Math.sin(a) * startR])
    }
  }
  return out
}

/**
 * A closed outline as a path string, with every corner rounded off through its
 * neighbours' midpoints. Filling the raw polygon instead leaves visible facets
 * on anything but the finest nib.
 */
export function outlinePath(pts: Point[]): string {
  if (pts.length < 3) return ''
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}Q`
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % pts.length]
    d += `${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)} `
  }
  return d + 'Z'
}

/** The box a set of stroke samples occupies, padded by the widest the nib gets. */
export function strokeBounds(
  pts: [number, number, number, number][],
  size: number,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  const pad = size / 2 + 1
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
}
