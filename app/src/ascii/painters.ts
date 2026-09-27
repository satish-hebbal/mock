/**
 * Cell painters.
 *
 * One function per style, each handed a cell rectangle, an ink level and a
 * colour, and asked to draw exactly one cell. They know nothing about the
 * document, the grid, the output size, or even what they are drawing onto:
 * every mark goes through the `Surface` handed to them, so the same function
 * fills pixels on a canvas and emits elements into an SVG. That is what makes
 * adding a style a self-contained job, and what makes vector export possible
 * without a second description of what a LEGO brick looks like.
 *
 * A recurring detail worth stating once: where a mark's *area* should carry the
 * tone (discs, diamonds, studs) the size goes as the square root of the ink.
 * Radius proportional to ink looks correct in a slider and wrong on the page,
 * because doubling a radius quadruples the ink actually on the paper, and the
 * midtones come out far too heavy.
 */

import { hash2 } from './sample'
import type { Surface } from './surface'
import { BRAILLE_BASE, BRAILLE_DOTS } from './ramps'
import type { AsciiStyleId } from './types'

export interface CellCtx {
  /** where the marks go: pixels on a canvas, or elements in an SVG */
  s: Surface
  /** cell rectangle in output pixels */
  x: number
  y: number
  w: number
  h: number
  col: number
  row: number
  /** 0..1, how much of this cell should be covered */
  ink: number
  /** 0..1 Sobel magnitude, before any edge emphasis */
  edge: number
  /** radians, the direction the contour runs through this cell */
  angle: number
  /** 0..1 tone-mapped brightness */
  lum: number
  /** the cell's resolved colour, tone already applied */
  color: string
  r: number
  g: number
  b: number
}

export interface PainterEnv {
  /** ramp characters, lightest first */
  chars: string
  /** 0..1, how often a glyph is nudged off its own step */
  jitter: number
  /** 0..0.5 of the cell left unpainted */
  gap: number
  /**
   * The finer grid braille needs: ink at 2x horizontal and 4x vertical, so one
   * cell can ask about each of its eight dots. Absent for every other style.
   */
  fine?: { ink: Float32Array; cols: number; rows: number }
  /** the style's own settings, already resolved against its specs */
  p?: Record<string, number | string | boolean>
  /** columns in the grid, for styles that read the grid as a page of text */
  cols?: number
}

export type Painter = (c: CellCtx, env: PainterEnv) => void

/** The character a glyph cell draws, ramp position with optional jitter. */
export function glyphFor(chars: string, ink: number, col: number, row: number, jitter: number): string {
  const last = chars.length - 1
  let idx = Math.round(ink * last)
  if (jitter > 0 && hash2(col, row, 11) < jitter) {
    // one step either way, never off the end of the ramp
    const dir = hash2(col, row, 12) < 0.5 ? -1 : 1
    idx = Math.min(last, Math.max(0, idx + dir))
  }
  return chars[idx] ?? ' '
}

/**
 * The braille cell for a grid position.
 *
 * Each of the eight dots is a separate question asked of the fine grid, so a
 * braille cell carries eight independent decisions where a character cell
 * carries one. Shared with the text exporter, which is the point: the .txt file
 * has to contain the same code points the canvas drew.
 */
export function brailleFor(col: number, row: number, fine: PainterEnv['fine']): string {
  if (!fine) return ' '
  let bits = 0
  for (const d of BRAILLE_DOTS) {
    const fx = col * 2 + d.x
    const fy = row * 4 + d.y
    if (fx >= fine.cols || fy >= fine.rows) continue
    // half ink turns a dot on, which is what makes braille a 1-bit medium
    if (fine.ink[fy * fine.cols + fx] > 0.5) bits |= d.bit
  }
  return String.fromCharCode(BRAILLE_BASE + bits)
}

/** rgba() from the cell's own colour components, for painters that shade per face. */
function shade(c: CellCtx, k: number, alpha = 1): string {
  const f = (v: number) => Math.round(Math.min(255, Math.max(0, v * k)))
  return `rgba(${f(c.r)}, ${f(c.g)}, ${f(c.b)}, ${alpha})`
}

/** The painted box inside a cell once the grout is taken off. */
function inset(c: CellCtx, gap: number) {
  const mx = (c.w * gap) / 2
  const my = (c.h * gap) / 2
  return { x: c.x + mx, y: c.y + my, w: c.w - mx * 2, h: c.h - my * 2 }
}

const glyph: Painter = (c, env) => {
  c.s.text(
    c.x + c.w / 2,
    c.y + c.h / 2,
    glyphFor(env.chars, c.ink, c.col, c.row, env.jitter),
    c.color,
  )
}

const braille: Painter = (c, env) => {
  const ch = brailleFor(c.col, c.row, env.fine)
  if (ch === String.fromCharCode(BRAILLE_BASE)) return // the blank cell, not worth a draw call
  c.s.text(c.x + c.w / 2, c.y + c.h / 2, ch, c.color)
}

const dots: Painter = (c, env) => {
  const box = inset(c, env.gap)
  const r = (Math.min(box.w, box.h) / 2) * Math.sqrt(c.ink)
  if (r < 0.1) return
  c.s.circle(c.x + c.w / 2, c.y + c.h / 2, r, c.color)
}

const lines: Painter = (c, env) => {
  const box = inset(c, env.gap)
  const t = box.h * c.ink
  if (t < 0.1) return
  c.s.rect(box.x, c.y + c.h / 2 - t / 2, box.w, t, c.color)
}

const diagonals: Painter = (c, env) => {
  const box = inset(c, env.gap)
  const t = Math.min(box.w, box.h) * c.ink
  if (t < 0.1) return
  c.s.line(box.x, box.y + box.h, box.x + box.w, box.y, t, c.color)
}

const cross: Painter = (c, env) => {
  const box = inset(c, env.gap)
  // the arms carry the area between them, and they overlap in the middle, so
  // each one is sized from half the ink rather than all of it
  const t = Math.min(box.w, box.h) * Math.sqrt(c.ink) * 0.5
  if (t < 0.1) return
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  c.s.rect(box.x, cy - t / 2, box.w, t, c.color)
  c.s.rect(cx - t / 2, box.y, t, box.h, c.color)
}

const diamond: Painter = (c, env) => {
  const box = inset(c, env.gap)
  const s = Math.sqrt(c.ink)
  const rx = (box.w / 2) * s
  const ry = (box.h / 2) * s
  if (rx < 0.1) return
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  c.s.polygon(
    [
      [cx, cy - ry],
      [cx + rx, cy],
      [cx, cy + ry],
      [cx - rx, cy],
    ],
    c.color,
  )
}

/*
 * Mixed picks its mark from the cell's position rather than from a running
 * random stream. Two reasons, and the second is the one that matters: a stream
 * would hand the same cell a different mark on the export pass, and a hash
 * keeps the picture you framed.
 */
const MIXED_MARKS: Painter[] = [dots, lines, diagonals, cross, diamond]
const mixed: Painter = (c, env) => {
  MIXED_MARKS[Math.floor(hash2(c.col, c.row, 3) * MIXED_MARKS.length) % MIXED_MARKS.length](c, env)
}

const pixel: Painter = (c) => {
  // half a pixel of overlap, because adjacent fills on fractional boundaries
  // leave a hairline of backdrop showing between them
  c.s.rect(c.x, c.y, c.w + 0.5, c.h + 0.5, c.color)
}

const mosaic: Painter = (c, env) => {
  const box = inset(c, Math.max(0.08, env.gap))
  // each tile catches the light a little differently, which is the whole
  // difference between a mosaic and a grid of squares
  const lit = 0.88 + hash2(c.col, c.row, 5) * 0.24
  c.s.rect(box.x, box.y, box.w, box.h, shade(c, lit))
}

const lego: Painter = (c) => {
  c.s.rect(c.x, c.y, c.w + 0.5, c.h + 0.5, shade(c, 1))

  const r = Math.min(c.w, c.h) * 0.29
  if (r < 1.2) return
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2

  // the stud's own shadow on the brick below it, then the stud, then the
  // highlight on the side the light comes from: three arcs is all a brick is
  c.s.circle(cx + r * 0.12, cy + r * 0.14, r, shade(c, 0.72))
  c.s.circle(cx, cy, r, shade(c, 1.06))
  c.s.arc(cx, cy, r * 0.82, Math.PI * 0.75, Math.PI * 1.6, Math.max(0.6, r * 0.16), shade(c, 1.3, 0.7))
}

/**
 * An isometric cube standing on the cell.
 *
 * Drawn from the base up, so the caller only has to iterate rows top to bottom
 * for the occlusion to come out right: a cube in a nearer row is drawn later
 * and covers the one behind it, which is the painter's algorithm doing the
 * depth sorting for free.
 */
const voxel: Painter = (c) => {
  const w = c.w
  const half = w / 2
  // the top face is a rhombus half as tall as it is wide, the classic 2:1 iso
  const q = w / 4
  const lift = c.ink * c.h * 1.6
  const bx = c.x + half
  const by = c.y + c.h - lift
  const body = lift + c.h * 0.5

  // left wall, right wall, then the lid: back to front within the cube itself
  c.s.polygon(
    [
      [bx - half, by + q],
      [bx, by + q * 2],
      [bx, by + q * 2 + body],
      [bx - half, by + q + body],
    ],
    shade(c, 0.62),
  )
  c.s.polygon(
    [
      [bx + half, by + q],
      [bx, by + q * 2],
      [bx, by + q * 2 + body],
      [bx + half, by + q + body],
    ],
    shade(c, 0.82),
  )
  c.s.polygon(
    [
      [bx, by],
      [bx + half, by + q],
      [bx, by + q * 2],
      [bx - half, by + q],
    ],
    shade(c, 1.12),
  )
}


// ----- helpers for the styles below -----

/** A style setting, with a fallback for callers that hand in no params at all. */
function P(env: PainterEnv, key: string, def: number): number {
  const v = env.p?.[key]
  return typeof v === 'number' ? v : def
}

function rgba(c: CellCtx, a: number, k = 1): string {
  const f = (v: number) => Math.round(Math.min(255, Math.max(0, v * k)))
  return `rgba(${f(c.r)}, ${f(c.g)}, ${f(c.b)}, ${Math.max(0, Math.min(1, a))})`
}

/** The cell's colour pushed away from grey, the way stained glass holds colour. */
function saturated(c: CellCtx, amount: number, k = 1): string {
  const m = (c.r + c.g + c.b) / 3
  const f = (v: number) => Math.round(Math.min(255, Math.max(0, (m + (v - m) * amount) * k)))
  return `rgb(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`
}

const safeAngle = (a: number) => (Number.isFinite(a) ? a : 0)

// ----- type -----

/**
 * The glyph a contour cell draws: a stroke character that runs the way the
 * edge does, or a light fill character inside flat regions.
 *
 * Exported for the text exporter, for the same reason `glyphFor` is: the .txt
 * has to be made of the characters the canvas drew.
 */
export function contourGlyph(
  chars: string,
  ink: number,
  edge: number,
  angle: number,
  threshold: number,
  fill: boolean,
): string {
  if (edge >= threshold) {
    // fold to 0..π, then pick the nearest of the four strokes a font has
    let a = safeAngle(angle) % Math.PI
    if (a < 0) a += Math.PI
    const k = Math.round(a / (Math.PI / 4)) % 4
    return ['-', '\\', '|', '/'][k]
  }
  if (!fill) return ' '
  // inside a shape: only the light half of the ramp, so outlines stay loudest
  const light = chars.slice(0, Math.max(2, Math.ceil(chars.length / 2)))
  return light[Math.min(light.length - 1, Math.round(ink * (light.length - 1)))] ?? ' '
}

const contour: Painter = (c, env) => {
  const ch = contourGlyph(env.chars, c.ink, c.edge, c.angle, P(env, 'threshold', 0.18), env.p?.fill !== false)
  if (ch === ' ') return
  c.s.text(c.x + c.w / 2, c.y + c.h / 2, ch, c.color)
}

/**
 * Falling code: the ramp's glyphs, lit brightest at a head that sits at a
 * different height in every column and fading up the column behind it.
 */
const rain: Painter = (c, env) => {
  const len = Math.max(4, P(env, 'trail', 14))
  const head = Math.floor(hash2(c.col, 0, 41) * 997)
  const pos = (((head - c.row) % len) + len) % len
  const trail = 1 - pos / len
  const a = Math.min(1, 0.15 + c.ink * 0.55 + trail * trail * 0.6)
  if (a < 0.08) return
  const ch = glyphFor(env.chars, Math.max(c.ink, hash2(c.col, c.row, 43)), c.col, c.row, 0)
  c.s.text(c.x + c.w / 2, c.y + c.h / 2, ch, pos === 0 ? rgba(c, 1, 1.9) : rgba(c, a))
}

/** The character a typeset cell draws: your phrase, read left to right through the grid. */
export function typesetGlyph(text: string, col: number, row: number, cols: number): string {
  const t = text.replace(/\s+/g, ' ') || 'RIBBIT'
  return t[(row * cols + col) % t.length]
}

const typeset: Painter = (c, env) => {
  const cols = env.cols ?? 80
  const ch = typesetGlyph(String(env.p?.text ?? 'RIBBIT'), c.col, c.row, cols)
  if (ch === ' ') return
  c.s.text(c.x + c.w / 2, c.y + c.h / 2, ch, rgba(c, 0.15 + c.ink * 0.85))
}

// ----- marks -----

const rings: Painter = (c, env) => {
  const box = inset(c, env.gap)
  const r = (Math.min(box.w, box.h) / 2) * Math.sqrt(c.ink) * 0.92
  if (r < 0.3) return
  const wgt = Math.max(0.5, Math.min(r, Math.min(box.w, box.h) * P(env, 'weight', 0.14)))
  c.s.ring(c.x + c.w / 2, c.y + c.h / 2, Math.max(0.1, r - wgt / 2), wgt, c.color)
}

function hexPoints(cx: number, cy: number, rx: number, ry: number): [number, number][] {
  return [
    [cx, cy - ry],
    [cx + rx, cy - ry / 2],
    [cx + rx, cy + ry / 2],
    [cx, cy + ry],
    [cx - rx, cy + ry / 2],
    [cx - rx, cy - ry / 2],
  ]
}

const hexes: Painter = (c, env) => {
  const box = inset(c, env.gap)
  const s = Math.sqrt(c.ink)
  const rx = (box.w / 2) * s
  if (rx < 0.2) return
  c.s.polygon(hexPoints(c.x + c.w / 2, c.y + c.h / 2, rx, (box.h / 2) * s * 1.1), c.color)
}

const triangles: Painter = (c, env) => {
  const box = inset(c, env.gap)
  const s = Math.sqrt(c.ink)
  const hw = (box.w / 2) * s
  const hh = (box.h / 2) * s
  if (hw < 0.2) return
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  // alternate up and down, so neighbours nest instead of stacking
  const up = (c.col + c.row) % 2 === 0
  c.s.polygon(
    up
      ? [
          [cx, cy - hh],
          [cx + hw, cy + hh],
          [cx - hw, cy + hh],
        ]
      : [
          [cx - hw, cy - hh],
          [cx + hw, cy - hh],
          [cx, cy + hh],
        ],
    c.color,
  )
}

/**
 * Stippling: tone carried by how many dots there are rather than how big.
 * Positions are hashed per cell, so the export is the dot pattern you saw.
 */
const stipple: Painter = (c, env) => {
  const most = Math.max(1, Math.round(P(env, 'dots', 6)))
  const n = Math.round(c.ink * most)
  if (n <= 0) return
  const r = Math.max(0.4, Math.min(c.w, c.h) * P(env, 'size', 0.09))
  for (let i = 0; i < n; i++) {
    const x = c.x + r + hash2(c.col, c.row, 100 + i) * Math.max(0, c.w - 2 * r)
    const y = c.y + r + hash2(c.col, c.row, 200 + i) * Math.max(0, c.h - 2 * r)
    c.s.circle(x, y, r, c.color)
  }
}

/**
 * Crosshatching, the way an etcher builds tone: one direction of strokes for
 * the light greys, a second across it for the midtones, then the level and the
 * upright for the deepest shadow.
 */
const hatch: Painter = (c, env) => {
  const w = Math.max(0.4, Math.min(c.w, c.h) * P(env, 'weight', 0.12))
  const { x, y } = c
  const x2 = c.x + c.w
  const y2 = c.y + c.h
  if (c.ink > 0.12) c.s.line(x, y2, x2, y, w, c.color)
  if (c.ink > 0.38) c.s.line(x, y, x2, y2, w, c.color)
  if (c.ink > 0.62) c.s.line(x, c.y + c.h / 2, x2, c.y + c.h / 2, w, c.color)
  if (c.ink > 0.84) c.s.line(c.x + c.w / 2, y, c.x + c.w / 2, y2, w, c.color)
}

/**
 * A wave through every row, phased by absolute x so neighbouring cells join
 * into one continuous line, and swelling with the ink.
 */
const waves: Painter = (c, env) => {
  const amp = (c.h / 2) * c.ink * P(env, 'height', 0.9)
  const wgt = Math.max(0.4, (c.h * 0.08) + c.ink * c.h * 0.22)
  const period = Math.max(2, c.w * P(env, 'period', 3))
  const cy = c.y + c.h / 2
  const steps = 6
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const px = c.x + (c.w * i) / steps
    pts.push([px, cy + Math.sin((px / period) * Math.PI * 2) * amp])
  }
  c.s.polyline(pts, wgt, c.color)
}

/**
 * Brush strokes laid along the picture's own contours: the flow field look.
 * Where there is no edge to follow, the angle wanders by a hashed amount.
 */
const strokes: Painter = (c, env) => {
  const len = Math.max(c.w, c.h) * (0.5 + c.ink * P(env, 'length', 1.1))
  const wander = (hash2(c.col, c.row, 61) - 0.5) * Math.PI * P(env, 'wander', 0.25) * (1 - c.edge)
  const a = safeAngle(c.angle) + wander
  const dx = (Math.cos(a) * len) / 2
  const dy = (Math.sin(a) * len) / 2
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  c.s.line(cx - dx, cy - dy, cx + dx, cy + dy, Math.max(0.4, Math.min(c.w, c.h) * (0.08 + c.ink * 0.3)), c.color)
}

/**
 * Truchet tiles: two quarter arcs per cell, turned by a hash so the arcs join
 * across cells into long winding paths, thicker where the picture is darker.
 */
const weave: Painter = (c, env) => {
  const wgt = Math.max(0.4, Math.min(c.w, c.h) * (0.05 + c.ink * P(env, 'weight', 0.4)))
  const r = Math.min(c.w, c.h) / 2
  const flip = hash2(c.col, c.row, 71) < 0.5
  const { x, y, w, h } = c
  if (flip) {
    c.s.arc(x, y, r, 0, Math.PI / 2, wgt, c.color)
    c.s.arc(x + w, y + h, r, Math.PI, Math.PI * 1.5, wgt, c.color)
  } else {
    c.s.arc(x + w, y, r, Math.PI / 2, Math.PI, wgt, c.color)
    c.s.arc(x, y + h, r, Math.PI * 1.5, Math.PI * 2, wgt, c.color)
  }
}

const stars: Painter = (c, env) => {
  const box = inset(c, env.gap)
  const R = (Math.min(box.w, box.h) / 2) * Math.sqrt(c.ink)
  if (R < 0.3) return
  const inner = R * P(env, 'pinch', 0.45)
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  const pts: [number, number][] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 === 0 ? R : inner
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
  }
  c.s.polygon(pts, c.color)
}

const hearts: Painter = (c, env) => {
  const box = inset(c, env.gap)
  const s = (Math.min(box.w, box.h) / 2) * Math.sqrt(c.ink)
  if (s < 0.3) return
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  const pts: [number, number][] = []
  // the classic parametric heart, sampled coarsely: a polygon is enough at cell size
  for (let i = 0; i < 20; i++) {
    const t = (i / 20) * Math.PI * 2
    const hx = 16 * Math.pow(Math.sin(t), 3)
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    pts.push([cx + (hx / 17) * s, cy - (hy / 17) * s])
  }
  c.s.polygon(pts, c.color)
}

/** A level meter per cell: a bar standing on the cell floor. */
const bars: Painter = (c, env) => {
  const box = inset(c, env.gap)
  const h = box.h * c.ink
  if (h < 0.2) return
  const w = box.w * P(env, 'width', 0.7)
  c.s.rect(c.x + (c.w - w) / 2, box.y + box.h - h, w, h, c.color)
}

// ----- tiles -----

/**
 * Honeycomb: pointy hexagons on alternate-row offsets, sized so three rows
 * cover the height of two cells' worth of hexagon and nothing is left bare.
 */
const honeycomb: Painter = (c, env) => {
  const a = c.w / 2
  const R = c.h / 1.5
  const cx = c.x + a + (c.row % 2 ? a : 0)
  const cy = c.y + c.h / 2
  const k = 1 - Math.max(0, env.gap)
  c.s.polygon(hexPoints(cx, cy, a * k + 0.3, R * k + 0.3), shade(c, 0.94 + hash2(c.col, c.row, 5) * 0.12))
}

const led: Painter = (c, env) => {
  c.s.rect(c.x, c.y, c.w + 0.5, c.h + 0.5, String(env.p?.board ?? '#0b0c0d'))
  const r = Math.min(c.w, c.h) * 0.36
  const on = 0.25 + c.lum * 0.95
  c.s.circle(c.x + c.w / 2, c.y + c.h / 2, r * 1.35, rgba(c, 0.18 * c.lum, on))
  c.s.circle(c.x + c.w / 2, c.y + c.h / 2, r, rgba(c, 1, on))
  c.s.circle(c.x + c.w / 2 - r * 0.3, c.y + c.h / 2 - r * 0.3, r * 0.28, `rgba(255, 255, 255, ${0.35 * c.lum})`)
}

/** Low poly: each cell split into two facets along the edge's own direction. */
const facets: Painter = (c) => {
  const { x, y, w, h } = c
  const a = safeAngle(c.angle) % Math.PI
  const rising = (a < 0 ? a + Math.PI : a) < Math.PI / 2
  const e = 0.5
  if (rising) {
    c.s.polygon([[x - e, y - e], [x + w + e, y - e], [x - e, y + h + e]], shade(c, 1.08))
    c.s.polygon([[x + w + e, y - e], [x + w + e, y + h + e], [x - e, y + h + e]], shade(c, 0.9))
  } else {
    c.s.polygon([[x - e, y - e], [x + w + e, y - e], [x + w + e, y + h + e]], shade(c, 1.06))
    c.s.polygon([[x - e, y - e], [x + w + e, y + h + e], [x - e, y + h + e]], shade(c, 0.88))
  }
}

const leadlight: Painter = (c, env) => {
  c.s.rect(c.x, c.y, c.w + 0.5, c.h + 0.5, String(env.p?.lead ?? '#141414'))
  const box = inset(c, Math.max(0.1, env.gap))
  c.s.rect(box.x, box.y, box.w, box.h, saturated(c, P(env, 'glow', 1.6), 0.95 + hash2(c.col, c.row, 7) * 0.2))
  // a thin highlight along the top, where the light catches the glass
  c.s.rect(box.x, box.y, box.w, Math.max(0.5, box.h * 0.12), 'rgba(255, 255, 255, 0.16)')
}

const neon: Painter = (c, env) => {
  const box = inset(c, Math.max(0.18, env.gap))
  const lit = 0.35 + c.lum
  const wgt = Math.max(0.5, Math.min(c.w, c.h) * 0.07)
  const sq: [number, number][] = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
    [box.x, box.y],
  ]
  c.s.polyline(sq, wgt * 4, rgba(c, 0.12 * lit, 1.4))
  c.s.polyline(sq, wgt, rgba(c, Math.min(1, lit), 1.5))
}

/** Knitting: a V of two leaves per cell, the stitch every jumper is made of. */
const knit: Painter = (c) => {
  const { x, y, w, h } = c
  const mx = x + w / 2
  const leaf = (dir: 1 | -1, k: number) =>
    c.s.polygon(
      [
        [mx, y + h * 1.05],
        [mx - dir * w * 0.02, y + h * 0.55],
        [mx - dir * w * 0.2, y + h * 0.05],
        [mx - dir * w * 0.5, y - h * 0.1],
        [mx - dir * w * 0.48, y + h * 0.35],
        [mx - dir * w * 0.2, y + h * 0.8],
      ],
      shade(c, k),
    )
  leaf(1, 0.92)
  leaf(-1, 1.08)
}

/** Fuse beads: a ring of plastic with the hole left dark. */
const beads: Painter = (c, env) => {
  c.s.rect(c.x, c.y, c.w + 0.5, c.h + 0.5, String(env.p?.board ?? '#e9e6df'))
  const r = Math.min(c.w, c.h) * 0.46
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  c.s.circle(cx, cy, r, shade(c, 1))
  c.s.circle(cx, cy, r * 0.36, shade(c, 0.45))
  c.s.arc(cx, cy, r * 0.72, Math.PI * 1.05, Math.PI * 1.45, Math.max(0.5, r * 0.18), 'rgba(255, 255, 255, 0.35)')
}

/**
 * Terraces: a slab per cell raised by its ink, drawn front face then lid, so a
 * row of them reads as a skyline or a contour model rather than a bar chart.
 */
const terrace: Painter = (c, env) => {
  const lift = c.ink * c.h * P(env, 'height', 1.4)
  const top = c.y + c.h - lift - c.h * 0.25
  const depth = c.h * 0.25
  c.s.rect(c.x, top + depth, c.w + 0.5, lift + 0.5, shade(c, 0.72))
  c.s.polygon(
    [
      [c.x, top + depth],
      [c.x + c.w * 0.25, top],
      [c.x + c.w * 1.25, top],
      [c.x + c.w, top + depth],
    ],
    shade(c, 1.12),
  )
}

/**
 * The whole-frame styles (dither, and the print and paint processes in
 * `process.ts`) have no entry here on purpose.
 *
 * They are sequential over the frame, or need neighbourhoods far wider than a
 * cell, so they cannot be expressed as "draw one cell" without lying about what
 * they do. `render.ts` branches for them, and this map staying honest is what
 * makes that branch obvious rather than a special case hidden inside a painter.
 */
export const PAINTERS: Partial<Record<AsciiStyleId, Painter>> = {
  characters: glyph,
  blocks: glyph,
  braille,
  contour,
  rain,
  typeset,
  dots,
  lines,
  diagonals,
  cross,
  diamond,
  mixed,
  rings,
  hexes,
  triangles,
  stipple,
  hatch,
  waves,
  strokes,
  weave,
  stars,
  hearts,
  bars,
  pixel,
  mosaic,
  lego,
  voxel,
  honeycomb,
  led,
  facets,
  leadlight,
  neon,
  knit,
  beads,
  terrace,
}
