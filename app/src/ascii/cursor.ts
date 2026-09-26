/**
 * The pointer's wake.
 *
 * Scatter throws the cells near the pointer to random places inside its reach,
 * and the throw heals once the pointer has moved on. Two parts make that work:
 *
 *   the head   where the pointer is now, eased in on entry so the cloud grows
 *              rather than appearing at full size
 *   the trail  points the head has passed, each healing on the settle curve,
 *              so a fast stroke leaves a wake behind it instead of the grid
 *              snapping straight back behind the pointer
 *
 * A cell takes the strongest influence acting on it, not the sum. Summing lets
 * a slow stroke stack dozens of trail points on one cell and fling it off the
 * picture; the max keeps every cell inside the reach whatever the stroke did.
 *
 * Each cell's throw direction and distance come from `hash2` of its grid
 * position, so the same cell always lands in the same place for the same
 * influence. That is what makes the cloud move with the pointer as one piece
 * rather than boiling.
 */

import { EASE } from '../lib/houseEase'
import type { CellCtx } from './painters'
import { hash2 } from './sample'
import type { AsciiCursor } from './types'

/** Moves a cell before it is painted. */
export type CellField = (c: CellCtx) => void

/** How long a spot the pointer left takes to fall back into the grid. */
const HEAL_MS = 900
/** How long the cloud takes to grow on entry. `--dur-out`, on `--ease-smooth`. */
const ENTER_MS = 180
/** Trail points are dropped this far apart, as a share of the radius. */
const SPACING = 0.18
/** Enough trail for a fast stroke across the whole picture, and no more. */
const MAX_STAMPS = 64

interface Stamp {
  x: number
  y: number
  t: number
}

export class CursorTrail {
  private stamps: Stamp[] = []
  private head: { x: number; y: number } | null = null
  private dropped = { x: 0, y: 0 }
  private enteredAt = 0
  private heal = HEAL_MS

  constructor() {
    // no wake for people who asked for less motion: the cloud still follows
    // the pointer, but nothing lingers or drifts back after it
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.heal = 0
    }
  }

  /** Pointer position in document pixels. */
  move(x: number, y: number, radius: number, now: number) {
    if (!this.head) {
      this.enteredAt = now
      this.dropped = { x, y }
    } else if (this.heal > 0 && Math.hypot(x - this.dropped.x, y - this.dropped.y) >= radius * SPACING) {
      /*
       * Measured from the last drop, not the last move, so a pointer resting or
       * creeping leaves nothing behind and the redraw loop is allowed to stop.
       */
      this.stamps.push({ x: this.dropped.x, y: this.dropped.y, t: now })
      if (this.stamps.length > MAX_STAMPS) this.stamps.shift()
      this.dropped = { x, y }
    }
    this.head = { x, y }
  }

  leave(now: number) {
    if (this.head && this.heal > 0) this.stamps.push({ x: this.head.x, y: this.head.y, t: now })
    this.head = null
  }

  /** Whether another frame would look different from this one. */
  animating(now: number): boolean {
    if (this.head && now - this.enteredAt < ENTER_MS) return true
    return this.stamps.length > 0
  }

  /**
   * The field for one frame, in output pixels, or undefined when nothing is
   * disturbed and the frame should draw the plain grid.
   */
  field(now: number, scale: number, spec: AsciiCursor): CellField | undefined {
    // one frame past the heal, so the last frame drawn is the settled grid
    this.stamps = this.stamps.filter((s) => now - s.t <= this.heal + 34)

    const R = Math.max(1, spec.radius * scale)
    const sources: { x: number; y: number; a: number }[] = []
    for (const s of this.stamps) {
      const a = 1 - EASE.settle((now - s.t) / Math.max(1, this.heal))
      if (a > 0.002) sources.push({ x: s.x * scale, y: s.y * scale, a })
    }
    if (this.head) {
      const a = EASE.smooth((now - this.enteredAt) / ENTER_MS)
      sources.push({ x: this.head.x * scale, y: this.head.y * scale, a })
    }
    if (!sources.length || spec.strength <= 0) return undefined

    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const s of sources) {
      x0 = Math.min(x0, s.x - R)
      y0 = Math.min(y0, s.y - R)
      x1 = Math.max(x1, s.x + R)
      y1 = Math.max(y1, s.y + R)
    }
    const R2 = R * R
    const throwMax = spec.strength * R

    return (c) => {
      const cx = c.x + c.w / 2
      const cy = c.y + c.h / 2
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) return
      let k = 0
      for (const s of sources) {
        const dx = cx - s.x
        const dy = cy - s.y
        const d2 = dx * dx + dy * dy
        if (d2 >= R2) continue
        // smooth at both ends: full at the centre, no crease at the rim
        const f = 1 - d2 / R2
        k = Math.max(k, s.a * f * f)
      }
      if (k <= 0.002) return
      const angle = hash2(c.col, c.row, 31) * Math.PI * 2
      // square root, so the thrown cells fill the disc evenly instead of bunching at its middle
      const dist = Math.sqrt(hash2(c.col, c.row, 32)) * throwMax * k
      c.x += Math.cos(angle) * dist
      c.y += Math.sin(angle) * dist
    }
  }
}
