/**
 * Elements to paths, and the questions you can ask about where they are.
 *
 * Two jobs live together here because they need the same answer. Painting an
 * element and asking whether the pointer is on it both come down to "what shape
 * is this, exactly", and computing that twice from two bits of code is how a
 * drawing tool ends up selecting things you cannot see.
 *
 * Generating a hand-drawn rectangle is a few hundred random numbers, and a
 * repaint touches every element on screen, so results are memoised on the
 * element's id and version. Anything that changes the geometry bumps the
 * version; anything that only changes paint (colour, opacity) does not, and
 * gets to reuse the cached wobble.
 */

import {
  cornerRadius,
  Rand,
  roughCurve,
  roughEllipse,
  roughHachure,
  roughLine,
  roughPolyline,
  roughRoundRect,
  roughOptions,
  polygonPath,
  type Point,
  type RoughOptions,
} from './rough'
import { PENS, outlinePath, strokeOutline } from './pens'
import { isLinear, isStroke, type Arrowhead, type DrawElement } from './types'

export interface Geometry {
  /** stroked with the element's stroke colour at its stroke width */
  lineD: string[]
  /** the fill: hatching to be stroked, or one polygon to be filled */
  fillD: string[]
  fillSolid: boolean
  /** filled with the stroke colour: freehand ink, which has no centre line */
  inkD: string[]
  /** the outline, in element-local coordinates, for hit testing */
  polygon: Point[]
}

const cache = new Map<string, Geometry>()
const CACHE_LIMIT = 4000

/** roughjs's roughness scale for Excalidraw's three sloppiness steps. */
const ROUGHNESS = [0, 1, 2.2]

function optionsFor(el: DrawElement, preserveVertices = false): RoughOptions {
  const dashed = el.strokeStyle !== 'solid'
  return roughOptions({
    seed: el.seed,
    roughness: ROUGHNESS[el.sloppiness] ?? 1,
    // a dashed line drawn twice reads as a smudge, so it gets a single pass
    disableMultiStroke: dashed,
    strokeWidth: dashed ? el.strokeWidth + 0.5 : el.strokeWidth,
    hachureGap: el.strokeWidth * 4,
    fillWeight: el.strokeWidth / 2,
    preserveVertices,
  })
}

/**
 * A polygon with its corners taken off, as straight runs plus quarter turns.
 *
 * Used for the rounded diamond. Rounding a shape by running one spline through
 * its vertices is the tempting shortcut and it bows the flat edges, so the
 * straights and the corners are generated separately and joined with pinned
 * endpoints.
 */
function roundPolygon(pts: Point[], radius: number, o: RoughOptions, r: Rand): { stroke: string[]; polygon: Point[] } {
  const stroke: string[] = []
  const polygon: Point[] = []
  const pinned = { ...o, preserveVertices: true }
  const len = pts.length

  const corners = pts.map((v, i) => {
    const p = pts[(i - 1 + len) % len]
    const q = pts[(i + 1) % len]
    const toP = Math.hypot(p[0] - v[0], p[1] - v[1]) || 1
    const toQ = Math.hypot(q[0] - v[0], q[1] - v[1]) || 1
    const rad = Math.min(radius, toP / 2, toQ / 2)
    return {
      a: [v[0] + ((p[0] - v[0]) / toP) * rad, v[1] + ((p[1] - v[1]) / toP) * rad] as Point,
      v,
      b: [v[0] + ((q[0] - v[0]) / toQ) * rad, v[1] + ((q[1] - v[1]) / toQ) * rad] as Point,
    }
  })

  for (let i = 0; i < len; i++) {
    const c = corners[i]
    const next = corners[(i + 1) % len]
    // the quarter turn
    const samples: Point[] = []
    for (let s = 0; s <= 4; s++) {
      const t = s / 4
      const u = 1 - t
      samples.push([
        u * u * c.a[0] + 2 * u * t * c.v[0] + t * t * c.b[0],
        u * u * c.a[1] + 2 * u * t * c.v[1] + t * t * c.b[1],
      ])
    }
    stroke.push(...roughCurve(samples, pinned, r))
    polygon.push(...samples)
    // the straight run to the next corner
    stroke.push(...roughLine(c.b[0], c.b[1], next.a[0], next.a[1], pinned, r))
    polygon.push(next.a)
  }
  return { stroke, polygon }
}

/** Two short strokes off the end of a line, Excalidraw's arrowhead geometry. */
function arrowhead(
  kind: Arrowhead,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: RoughOptions,
  r: Rand,
): { line: string[]; ink: string[] } {
  if (kind === 'none') return { line: [], ink: [] }
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < 0.5) return { line: [], ink: [] }
  const size = Math.min(kind === 'arrow' ? 30 : 15, len / 2)
  const nx = dx / len
  const ny = dy / len

  if (kind === 'dot') {
    const e = roughEllipse(x2, y2, size, size, { ...o, disableMultiStroke: true }, r)
    return { line: e.stroke, ink: [polygonPath(e.polygon)] }
  }

  const bx = x2 - nx * size
  const by = y2 - ny * size
  const spread = ((kind === 'arrow' ? 20 : 30) * Math.PI) / 180
  const rot = (a: number): Point => [
    x2 + (bx - x2) * Math.cos(a) - (by - y2) * Math.sin(a),
    y2 + (bx - x2) * Math.sin(a) + (by - y2) * Math.cos(a),
  ]
  const p1 = rot(-spread)
  const p2 = rot(spread)
  const barbs = { ...o, preserveVertices: true }
  const line = [
    ...roughLine(p1[0], p1[1], x2, y2, barbs, r),
    ...roughLine(p2[0], p2[1], x2, y2, barbs, r),
  ]
  /*
   * A triangle head is the same two barbs with the base closed, and then
   * *filled*. Leaving it in the stroke list draws a hollow chevron, which is
   * the open arrowhead it is meant to be an alternative to.
   */
  return { line, ink: kind === 'triangle' ? [polygonPath([p1, [x2, y2], p2])] : [] }
}

function build(el: DrawElement): Geometry {
  const g: Geometry = { lineD: [], fillD: [], fillSolid: false, inkD: [], polygon: [] }
  const o = optionsFor(el)
  const r = new Rand(el.seed)
  const { w, h } = el

  if (isStroke(el)) {
    const spec = el.kind === 'freedraw' ? PENS[el.pen] : PENS.marker
    const outline = strokeOutline(el.points, spec, el.size, el.seed)
    g.inkD = [outlinePath(outline)]
    g.polygon = outline
    return g
  }

  if (el.kind === 'text' || el.kind === 'image' || el.kind === 'note') {
    g.polygon = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ]
    return g
  }

  if (isLinear(el)) {
    const pts = el.points
    if (pts.length >= 2) {
      /*
       * Two points is a straight line and gets the line generator, which bows
       * it once. Three or more is a drawn path and gets the curve generator:
       * running a chain of separate rough lines through the same points leaves
       * a visible kink at every joint.
       */
      if (pts.length === 2) {
        g.lineD.push(...roughLine(pts[0][0], pts[0][1], pts[1][0], pts[1][1], o, r))
      } else {
        g.lineD.push(...roughCurve(pts, { ...o, preserveVertices: true }, r))
      }
      const a = pts[0]
      const b = pts[1]
      const y = pts[pts.length - 1]
      const z = pts[pts.length - 2]
      if (el.kind === 'arrow') {
        for (const head of [
          arrowhead(el.startArrow, b[0], b[1], a[0], a[1], o, r),
          arrowhead(el.endArrow, z[0], z[1], y[0], y[1], o, r),
        ]) {
          g.lineD.push(...head.line)
          g.inkD.push(...head.ink)
        }
      }
      g.polygon = pts.map((p) => [p[0], p[1]] as Point)
    }
    return g
  }

  // ----- closed shapes -----
  let polygon: Point[]
  if (el.kind === 'ellipse') {
    const e = roughEllipse(w / 2, h / 2, w, h, o, r)
    g.lineD.push(...e.stroke)
    polygon = e.polygon
  } else if (el.kind === 'rect') {
    if (el.edges === 'round') {
      const rr = roughRoundRect(0, 0, w, h, cornerRadius(Math.min(Math.abs(w), Math.abs(h))), o, r)
      g.lineD.push(...rr.stroke)
      polygon = rr.polygon
    } else {
      polygon = [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ]
      g.lineD.push(...roughPolyline(polygon, true, o, r))
    }
  } else {
    const corners: Point[] = [
      [w / 2, 0],
      [w, h / 2],
      [w / 2, h],
      [0, h / 2],
    ]
    if (el.edges === 'round') {
      const rp = roundPolygon(corners, cornerRadius(Math.min(Math.abs(w), Math.abs(h))) * 0.75, o, r)
      g.lineD.push(...rp.stroke)
      polygon = rp.polygon
    } else {
      polygon = corners
      g.lineD.push(...roughPolyline(corners, true, o, r))
    }
  }
  g.polygon = polygon

  if (el.fill !== 'transparent') {
    if (el.fillStyle === 'solid') {
      g.fillD = [polygonPath(polygon)]
      g.fillSolid = true
    } else {
      g.fillD = roughHachure(polygon, o, el.fillStyle === 'cross-hatch', new Rand(el.seed + 1))
      g.fillSolid = false
    }
  }
  return g
}

/** The element's paths, generated once and kept until its version moves on. */
export function geometryFor(el: DrawElement): Geometry {
  const key = `${el.id}:${el.version}`
  const hit = cache.get(key)
  if (hit) return hit
  const g = build(el)
  // crude but sufficient: a drawing big enough to hit this is re-generating a
  // handful of shapes per pan, which is cheaper than tracking exact liveness
  if (cache.size > CACHE_LIMIT) cache.clear()
  cache.set(key, g)
  return g
}

export function dropGeometry(el: DrawElement) {
  cache.delete(`${el.id}:${el.version}`)
}

/*
 * ----- Where things are -----
 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Rotate (x, y) about (cx, cy). */
export function rotate(x: number, y: number, cx: number, cy: number, a: number): Point {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const dx = x - cx
  const dy = y - cy
  return [cx + dx * c - dy * s, cy + dx * s + dy * c]
}

/** The element's own box, before rotation. */
export const localBox = (el: DrawElement): Box => ({ x: el.x, y: el.y, w: el.w, h: el.h })

/** The axis-aligned box the element actually occupies on the scene. */
export function sceneBounds(el: DrawElement): Box {
  const { x, y, w, h } = el
  if (!el.angle) return { x, y, w, h }
  const cx = x + w / 2
  const cy = y + h / 2
  const pts = [
    rotate(x, y, cx, cy, el.angle),
    rotate(x + w, y, cx, cy, el.angle),
    rotate(x + w, y + h, cx, cy, el.angle),
    rotate(x, y + h, cx, cy, el.angle),
  ]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
}

/** The box around several elements, or null for none. */
export function unionBounds(els: DrawElement[]): Box | null {
  if (els.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of els) {
    const b = sceneBounds(el)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Scene point into the element's own unrotated frame. */
function toLocal(el: DrawElement, x: number, y: number): Point {
  const cx = el.x + el.w / 2
  const cy = el.y + el.h / 2
  const [rx, ry] = el.angle ? rotate(x, y, cx, cy, -el.angle) : [x, y]
  return [rx - el.x, ry - el.y]
}

/** Shortest distance from a point to a segment. */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function pointInPolygon(px: number, py: number, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function nearPolygon(px: number, py: number, poly: Point[], tol: number, closed: boolean): boolean {
  const last = closed ? poly.length : poly.length - 1
  for (let i = 0; i < last; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (distToSegment(px, py, a[0], a[1], b[0], b[1]) <= tol) return true
  }
  return false
}

/**
 * Is the pointer on this element?
 *
 * An unfilled shape is hit on its *outline* only, so you can click through the
 * middle of a big empty rectangle to reach what is behind it. Filling it makes
 * the inside solid to the pointer as well, which is what you would expect from
 * something you can now see through no longer being see-through.
 */
export function hitTest(el: DrawElement, x: number, y: number, tolerance: number): boolean {
  const [lx, ly] = toLocal(el, x, y)
  const g = geometryFor(el)

  if (isStroke(el)) {
    const tol = el.size / 2 + tolerance
    for (const [px, py] of el.points) {
      if (Math.hypot(lx - px, ly - py) <= tol) return true
    }
    for (let i = 0; i + 1 < el.points.length; i++) {
      const a = el.points[i]
      const b = el.points[i + 1]
      if (distToSegment(lx, ly, a[0], a[1], b[0], b[1]) <= tol) return true
    }
    return false
  }

  if (el.kind === 'text' || el.kind === 'image' || el.kind === 'note') {
    return lx >= -tolerance && ly >= -tolerance && lx <= el.w + tolerance && ly <= el.h + tolerance
  }

  if (isLinear(el)) return nearPolygon(lx, ly, g.polygon, tolerance + el.strokeWidth, false)

  if (el.fill !== 'transparent' && pointInPolygon(lx, ly, g.polygon)) return true
  return nearPolygon(lx, ly, g.polygon, tolerance + el.strokeWidth, true)
}

/** Every element whose box falls inside the marquee. */
export function inBox(els: DrawElement[], box: Box): DrawElement[] {
  const x2 = box.x + box.w
  const y2 = box.y + box.h
  return els.filter((el) => {
    const b = sceneBounds(el)
    return b.x >= box.x && b.y >= box.y && b.x + b.w <= x2 && b.y + b.h <= y2
  })
}

/** The eight resize grips, in scene coordinates. */
export type ResizeHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
/** A resize grip, or the ring just outside a corner grip that means "rotate instead". */
export type HandleId = ResizeHandleId | 'rotate'
export type CornerHandleId = 'nw' | 'ne' | 'se' | 'sw'

export function handlePositions(box: Box, angle: number): Record<ResizeHandleId, Point> {
  const { x, y, w, h } = box
  const cx = x + w / 2
  const cy = y + h / 2
  const at = (px: number, py: number): Point => (angle ? rotate(px, py, cx, cy, angle) : [px, py])
  return {
    nw: at(x, y),
    n: at(cx, y),
    ne: at(x + w, y),
    e: at(x + w, cy),
    se: at(x + w, y + h),
    s: at(cx, y + h),
    sw: at(x, y + h),
    w: at(x, cy),
  }
}

export const CURSOR_FOR_HANDLE: Record<ResizeHandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

/** The four corners eligible for the "hover just outside to rotate" ring. */
export const CORNER_HANDLES: CornerHandleId[] = ['nw', 'ne', 'se', 'sw']

/**
 * Each corner's cursor before the element's own rotation is folded in. The
 * icon is drawn nose-up; these are how far it turns to lean into that corner.
 */
const ROTATE_BASE_DEG: Record<CornerHandleId, number> = { ne: 0, se: 90, sw: 180, nw: 270 }

const ROTATE_CURSOR_CACHE = new Map<string, string>()

/**
 * A small curved-arrow cursor for "drag to rotate", rotated to lean into the
 * corner it's hovering and to account for the element's current angle — so
 * the cursor keeps pointing the way the corner will actually move, the way
 * Figma's does, rather than sitting at one fixed compass angle forever.
 */
export function rotateCursor(corner: CornerHandleId, elementAngleRad: number): string {
  // snapped to the nearest degree: a cache key that never grows unboundedly,
  // and a degree of precision nobody's eye can tell from the exact float
  const deg = Math.round(ROTATE_BASE_DEG[corner] + (elementAngleRad * 180) / Math.PI)
  const key = `${corner}:${deg}`
  const cached = ROTATE_CURSOR_CACHE.get(key)
  if (cached) return cached
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'>` +
    `<g transform='rotate(${deg} 10 10)'>` +
    `<path d='M13.5 7A5 5 0 1 0 14.6 13' fill='none' stroke='white' stroke-width='3' stroke-linecap='round'/>` +
    `<path d='M11.3,4.3 14,7 10.9,9.1Z' fill='white'/>` +
    `<path d='M13.5 7A5 5 0 1 0 14.6 13' fill='none' stroke='black' stroke-width='1.3' stroke-linecap='round'/>` +
    `<path d='M11.3,4.3 14,7 10.9,9.1Z' fill='black'/>` +
    `</g></svg>`
  const css = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 10 10, grab`
  ROTATE_CURSOR_CACHE.set(key, css)
  return css
}
