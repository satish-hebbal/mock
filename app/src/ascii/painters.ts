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

/**
 * Dither has no entry here on purpose.
 *
 * Error diffusion is sequential over the whole frame, so it cannot be expressed
 * as "draw one cell" without lying about what it does. `render.ts` branches for
 * it, and this map staying honest is what makes that branch obvious rather than
 * a special case hidden inside a painter.
 */
export const PAINTERS: Record<Exclude<AsciiStyleId, 'dither'>, Painter> = {
  characters: glyph,
  blocks: glyph,
  braille,
  dots,
  lines,
  diagonals,
  cross,
  diamond,
  mixed,
  pixel,
  mosaic,
  lego,
  voxel,
}
