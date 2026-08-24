/**
 * The wobble.
 *
 * Excalidraw's whole personality is that a rectangle is drawn the way a person
 * draws a rectangle: four strokes that miss their corners, gone over twice, and
 * shaded in with slanted pencil hatching rather than filled. It gets that from
 * roughjs. Drawesome's headline is "no dependencies beyond React", and taking
 * that seriously is more interesting than installing a library, so the
 * algorithm is reimplemented here, following roughjs's approach closely enough
 * that the output is recognisably the same hand.
 *
 * Everything below emits SVG path strings rather than painting. That one
 * decision is what lets the same geometry serve the canvas renderer (via
 * `new Path2D(d)`) and the SVG exporter (via `<path d>`) with no second code
 * path, which is how the export can promise "exactly what is on screen".
 *
 * Two ideas do most of the work:
 *
 *   1. A *seeded* random. Roughness has to be a stable property of an element,
 *      not of a repaint. Panning the canvas regenerates every path on screen,
 *      and with an unseeded random the whole drawing would boil.
 *   2. Every straight line is drawn *twice*, as two bowed cubics that diverge
 *      and rejoin. The overlap is the entire trick: it reads as a pen going
 *      back over its own line, which is what a hand does.
 */

export interface RoughOptions {
  /** fixes the wobble for this element */
  seed: number
  /** roughjs roughness: 0 = ruled, 1 = artist, 2 = cartoonist */
  roughness: number
  /** how much a line bows away from true */
  bowing: number
  strokeWidth: number
  /** one pass instead of two, used for dashed and dotted where doubling muddies */
  disableMultiStroke: boolean
  hachureAngle: number
  hachureGap: number
  fillWeight: number
  /** keep the endpoints exactly where they were asked for */
  preserveVertices: boolean
}

export type Point = [number, number]

const MAX_OFFSET = 2
const CURVE_FITTING = 0.95
const CURVE_TIGHTNESS = 0
const CURVE_STEP_COUNT = 9

export function roughOptions(o: Partial<RoughOptions> & { seed: number }): RoughOptions {
  const strokeWidth = o.strokeWidth ?? 1
  return {
    seed: o.seed || 1,
    roughness: o.roughness ?? 1,
    bowing: o.bowing ?? 1,
    strokeWidth,
    disableMultiStroke: o.disableMultiStroke ?? false,
    hachureAngle: o.hachureAngle ?? -41,
    hachureGap: o.hachureGap ?? strokeWidth * 4,
    fillWeight: o.fillWeight ?? strokeWidth / 2,
    preserveVertices: o.preserveVertices ?? false,
  }
}

/**
 * roughjs's PRNG: one multiply and a mask, seeded per element.
 *
 * Deliberately not a good generator. It only has to be repeatable and cheap,
 * and it is called a few hundred times per shape per repaint.
 */
class Rand {
  private s: number
  constructor(seed: number) {
    this.s = seed || 1
  }
  next(): number {
    this.s = Math.imul(48271, this.s)
    return ((2 ** 31 - 1) & this.s) / 2 ** 31
  }
}

const n = (v: number) => (Math.round(v * 100) / 100).toString()

function offset(min: number, max: number, o: RoughOptions, r: Rand, gain = 1): number {
  return o.roughness * gain * (r.next() * (max - min) + min)
}

function offsetOpt(x: number, o: RoughOptions, r: Rand, gain = 1): number {
  return offset(-x, x, o, r, gain)
}

/**
 * One pass of a hand-drawn straight line, as a single cubic.
 *
 * The two control points sit at roughly a third and two thirds along, each
 * displaced sideways by `bowing` and jittered by `roughness`. Long lines are
 * damped (`gain`): without that, a 900px line wanders so far off true that it
 * stops reading as a line at all, while a 40px one needs the full amount to
 * look drawn rather than printed.
 *
 * `overlay` is the second pass. It uses half the jitter, so the two strokes
 * stay close enough to read as one line gone over twice rather than as two
 * separate lines.
 */
function linePass(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: RoughOptions,
  r: Rand,
  overlay: boolean,
): string {
  const lenSq = (x1 - x2) ** 2 + (y1 - y2) ** 2
  const len = Math.sqrt(lenSq)

  let gain = 1
  if (len > 500) gain = 0.4
  else if (len > 200) gain = -0.0016668 * len + 1.233334

  let off = MAX_OFFSET
  if (off * off * 100 > lenSq) off = len / 10
  const half = off / 2

  const diverge = 0.2 + r.next() * 0.2

  let midX = (o.bowing * MAX_OFFSET * (y2 - y1)) / 200
  let midY = (o.bowing * MAX_OFFSET * (x1 - x2)) / 200
  midX = offsetOpt(midX, o, r, gain)
  midY = offsetOpt(midY, o, r, gain)

  const j = () => offset(-off, off, o, r, gain)
  const jh = () => offset(-half, half, o, r, gain)
  const w = overlay ? jh : j
  // preserveVertices pins the ends, for paths that have to meet up exactly
  const end = o.preserveVertices ? () => 0 : w

  const sx = x1 + end()
  const sy = y1 + end()
  const c1x = midX + x1 + (x2 - x1) * diverge + w()
  const c1y = midY + y1 + (y2 - y1) * diverge + w()
  const c2x = midX + x1 + 2 * (x2 - x1) * diverge + w()
  const c2y = midY + y1 + 2 * (y2 - y1) * diverge + w()
  const ex = x2 + end()
  const ey = y2 + end()

  return `M${n(sx)} ${n(sy)}C${n(c1x)} ${n(c1y)},${n(c2x)} ${n(c2y)},${n(ex)} ${n(ey)}`
}

/** A straight line, drawn the way a hand draws one: twice. */
export function roughLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: RoughOptions,
  r = new Rand(o.seed),
): string[] {
  const out = [linePass(x1, y1, x2, y2, o, r, false)]
  if (!o.disableMultiStroke) out.push(linePass(x1, y1, x2, y2, o, r, true))
  return out
}

/** A run of connected straight lines, optionally closed. */
export function roughPolyline(
  pts: Point[],
  close: boolean,
  o: RoughOptions,
  r = new Rand(o.seed),
): string[] {
  if (pts.length < 2) return []
  const out: string[] = []
  const list = close ? [...pts, pts[0]] : pts
  for (let i = 0; i < list.length - 1; i++) {
    out.push(...roughLine(list[i][0], list[i][1], list[i + 1][0], list[i + 1][1], o, r))
  }
  return out
}

/**
 * A curve through a list of points, as roughjs draws one: a Catmull-Rom spline
 * converted to cubics, with the tangents scaled by `curveTightness`.
 *
 * This is what gives ellipses and freehand-shaped paths their character. It is
 * fed already-jittered points, so the curve itself is exact; the wobble is in
 * where the points are.
 */
function curvePath(pts: Point[]): string {
  if (pts.length < 3) {
    if (pts.length === 2) return `M${n(pts[0][0])} ${n(pts[0][1])}L${n(pts[1][0])} ${n(pts[1][1])}`
    return ''
  }
  const s = 1 - CURVE_TIGHTNESS
  let d = `M${n(pts[1][0])} ${n(pts[1][1])}`
  for (let i = 1; i + 2 < pts.length; i++) {
    const c = pts[i]
    const c1: Point = [
      c[0] + (s * pts[i + 1][0] - s * pts[i - 1][0]) / 6,
      c[1] + (s * pts[i + 1][1] - s * pts[i - 1][1]) / 6,
    ]
    const c2: Point = [
      pts[i + 1][0] + (s * pts[i][0] - s * pts[i + 2][0]) / 6,
      pts[i + 1][1] + (s * pts[i][1] - s * pts[i + 2][1]) / 6,
    ]
    d += `C${n(c1[0])} ${n(c1[1])},${n(c2[0])} ${n(c2[1])},${n(pts[i + 1][0])} ${n(pts[i + 1][1])}`
  }
  return d
}

/** A hand-drawn curve through the given points, jittered and gone over twice. */
export function roughCurve(pts: Point[], o: RoughOptions, r = new Rand(o.seed)): string[] {
  if (pts.length < 2) return []
  const jitter = (amount: number): Point[] =>
    pts.map((p, i) => {
      // the ends stay put where asked, so joined segments still meet
      const pin = o.preserveVertices && (i === 0 || i === pts.length - 1)
      const a = pin ? 0 : amount
      return [p[0] + offset(-a, a, o, r), p[1] + offset(-a, a, o, r)] as Point
    })
  // duplicate the ends so the spline actually reaches them
  const pad = (list: Point[]): Point[] => [list[0], ...list, list[list.length - 1]]
  const out = [curvePath(pad(jitter(1)))]
  if (!o.disableMultiStroke) out.push(curvePath(pad(jitter(1.5))))
  return out
}

/**
 * An ellipse, as a ring of jittered points closed with a deliberate overlap.
 *
 * The overlap at the end is the detail that sells it: the pen carries past
 * where it started and crosses its own line, which is exactly what happens when
 * you draw a circle freehand and is the single most recognisable thing about
 * a roughjs ellipse.
 *
 * Returns the polygon too, because the hachure filler needs an outline to
 * scan and an ellipse has no vertices of its own.
 */
export function roughEllipse(
  cx: number,
  cy: number,
  w: number,
  h: number,
  o: RoughOptions,
  r = new Rand(o.seed),
): { stroke: string[]; polygon: Point[] } {
  const psq = Math.sqrt(Math.PI * 2 * Math.sqrt(((w / 2) ** 2 + (h / 2) ** 2) / 2))
  const stepCount = Math.max(CURVE_STEP_COUNT, (CURVE_STEP_COUNT / Math.sqrt(200)) * psq)
  const increment = (Math.PI * 2) / stepCount

  const fit = 1 - CURVE_FITTING
  let rx = Math.abs(w / 2)
  let ry = Math.abs(h / 2)
  rx += offset(-rx * fit, rx * fit, o, r)
  ry += offset(-ry * fit, ry * fit, o, r)

  const ring = (off: number, overlap: number) => {
    const all: Point[] = []
    const core: Point[] = []
    const start = offset(-0.5, 0.5, o, r) - Math.PI / 2
    const j = () => offset(-off, off, o, r)

    all.push([j() + cx + 0.9 * rx * Math.cos(start - increment), j() + cy + 0.9 * ry * Math.sin(start - increment)])
    for (let a = start; a < Math.PI * 2 + start - 0.01; a += increment) {
      const p: Point = [j() + cx + rx * Math.cos(a), j() + cy + ry * Math.sin(a)]
      core.push(p)
      all.push(p)
    }
    // carry past the start and cross the line, three times, closing the ring
    all.push([j() + cx + rx * Math.cos(start + Math.PI * 2 + overlap * 0.5), j() + cy + ry * Math.sin(start + Math.PI * 2 + overlap * 0.5)])
    all.push([j() + cx + 0.98 * rx * Math.cos(start + overlap), j() + cy + 0.98 * ry * Math.sin(start + overlap)])
    all.push([j() + cx + 0.9 * rx * Math.cos(start + overlap * 0.5), j() + cy + 0.9 * ry * Math.sin(start + overlap * 0.5)])
    return { all, core }
  }

  const first = ring(1, (increment * r.next() + increment / 2) as number)
  const stroke = [curvePath(first.all)]
  if (!o.disableMultiStroke) {
    const second = ring(1.5, 0)
    stroke.push(curvePath(second.all))
  }
  return { stroke, polygon: first.core }
}

/**
 * A rounded rectangle, corner by corner.
 *
 * The straight runs go through the line generator and the corners through the
 * curve generator, rather than roughening one long path. Doing it in one pass
 * is what a naive implementation reaches for, and it bulges the straight edges:
 * a spline through four corners and four midpoints has no way to know which
 * spans are meant to be flat.
 */
export function roughRoundRect(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  o: RoughOptions,
  r = new Rand(o.seed),
): { stroke: string[]; polygon: Point[] } {
  const rad = Math.max(0, Math.min(radius, Math.min(Math.abs(w), Math.abs(h)) / 2))
  const x2 = x + w
  const y2 = y + h
  const stroke: string[] = []
  const polygon: Point[] = []

  // the four straight runs, drawn with the ends pinned so they meet the corners
  const edgeOpts = { ...o, preserveVertices: true }
  const edges: [number, number, number, number][] = [
    [x + rad, y, x2 - rad, y],
    [x2, y + rad, x2, y2 - rad],
    [x2 - rad, y2, x + rad, y2],
    [x, y2 - rad, x, y + rad],
  ]
  // quarter-turns, sampled from the quadratic Excalidraw uses, then roughened
  const corners: [Point, Point, Point][] = [
    [[x2 - rad, y], [x2, y], [x2, y + rad]],
    [[x2, y2 - rad], [x2, y2], [x2 - rad, y2]],
    [[x + rad, y2], [x, y2], [x, y2 - rad]],
    [[x, y + rad], [x, y], [x + rad, y]],
  ]

  for (let i = 0; i < 4; i++) {
    const [ax, ay, bx, by] = edges[i]
    stroke.push(...roughLine(ax, ay, bx, by, edgeOpts, r))
    polygon.push([ax, ay], [bx, by])

    if (rad > 0.5) {
      const [p0, c, p1] = corners[i]
      const samples: Point[] = []
      for (let s = 0; s <= 4; s++) {
        const t = s / 4
        const u = 1 - t
        samples.push([
          u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
          u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1],
        ])
      }
      stroke.push(...roughCurve(samples, { ...o, preserveVertices: true }, r))
      polygon.push(...samples)
    }
  }
  return { stroke, polygon }
}

/*
 * ----- Fills -----
 *
 * A filled shape in this world is not a filled shape. It is a set of parallel
 * pencil strokes clipped to the outline, which is what hatching is, and it is
 * why an Excalidraw drawing reads as pencil on paper even at a glance.
 */

/** Scan-line hachure: rotate into the hatching frame, slice, rotate back. */
function hachureSegments(polygon: Point[], angleDeg: number, gap: number): [Point, Point][] {
  if (polygon.length < 3) return []
  const a = (angleDeg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  // into hachure space, where the strokes are horizontal
  const rot = polygon.map(([px, py]): Point => [px * cos + py * sin, -px * sin + py * cos])

  let minY = Infinity
  let maxY = -Infinity
  for (const [, py] of rot) {
    if (py < minY) minY = py
    if (py > maxY) maxY = py
  }
  const step = Math.max(gap, 0.1)
  const out: [Point, Point][] = []
  // start on a multiple of the gap so neighbouring shapes hatch in register
  for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
    const xs: number[] = []
    for (let i = 0; i < rot.length; i++) {
      const p = rot[i]
      const q = rot[(i + 1) % rot.length]
      // half-open test, so a vertex landing exactly on the line counts once
      if (p[1] <= y === q[1] <= y) continue
      const t = (y - p[1]) / (q[1] - p[1])
      xs.push(p[0] + t * (q[0] - p[0]))
    }
    xs.sort((m, n2) => m - n2)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] < 0.5) continue
      // back out of hachure space
      out.push([
        [xs[i] * cos - y * sin, xs[i] * sin + y * cos],
        [xs[i + 1] * cos - y * sin, xs[i + 1] * sin + y * cos],
      ])
    }
  }
  return out
}

/** Hatching, as rough strokes. `cross` lays a second set at ninety degrees. */
export function roughHachure(
  polygon: Point[],
  o: RoughOptions,
  cross: boolean,
  r = new Rand(o.seed),
): string[] {
  const gap = Math.max(o.hachureGap, 0.5)
  const segs = hachureSegments(polygon, o.hachureAngle, gap)
  if (cross) segs.push(...hachureSegments(polygon, o.hachureAngle + 90, gap))
  const out: string[] = []
  // single pass: hatching gone over twice reads as a solid fill, not as shading
  const fillOpts = { ...o, disableMultiStroke: true, preserveVertices: false }
  for (const [p, q] of segs) out.push(...roughLine(p[0], p[1], q[0], q[1], fillOpts, r))
  return out
}

/** A plain filled polygon, for fillStyle: solid. */
export function polygonPath(polygon: Point[]): string {
  if (polygon.length < 3) return ''
  let d = `M${n(polygon[0][0])} ${n(polygon[0][1])}`
  for (let i = 1; i < polygon.length; i++) d += `L${n(polygon[i][0])} ${n(polygon[i][1])}`
  return d + 'Z'
}

/** Excalidraw's dash patterns, both scaled by the stroke width. */
export const dashArray = (style: 'dashed' | 'dotted', strokeWidth: number): number[] =>
  style === 'dashed' ? [8, 8 + strokeWidth] : [1.5, 6 + strokeWidth]

/**
 * Excalidraw's adaptive corner radius: a proportional quarter on small shapes
 * so a tiny box does not look like a pill, flattening to a fixed 32 once the
 * shape is big enough that a quarter would be a stadium.
 */
export function cornerRadius(size: number): number {
  const FIXED = 32
  const PROPORTION = 0.25
  return size <= FIXED / PROPORTION ? size * PROPORTION : FIXED
}

export { Rand }
