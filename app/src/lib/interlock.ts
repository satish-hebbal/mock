import type { CSSProperties } from 'react'

/**
 * The stepped seam between the first two tool cards.
 *
 * The pair reads as one object broken in two rather than as two cards parked
 * next to each other: the left card gives up its lower right corner and the
 * right card reaches over and takes it, so the join between them runs down,
 * jogs across at 45 degrees, and carries on down.
 *
 * The whole thing is one outline per card, cut with `clip-path: shape()`. A
 * border cannot follow a shape like this, so the 1px hairline is the card's own
 * background left showing around a fill layer clipped 1px further in, which is
 * why every outline here is generated at three insets: 0 for the card, 1 for
 * the fill it wraps, 2 for the thicker ring focus wants.
 */

/** the gutter the cards already sit in, and so what `gap-3` is set to */
const GUTTER = 12
/** how far the seam steps sideways, and so how much width changes hands */
const STEP = 28
/** the card's corner radius, `rounded-xl` */
const RADIUS = 16
/**
 * The run from a corner's vertex to where a fillet of radius 1 leaves the
 * edge, for the 135 degree turns a 45 degree jog makes. Every tangent length
 * and every offset below is some multiple of it.
 */
const K = Math.SQRT2 - 1
/**
 * How far the right card's jog sits below the left card's.
 *
 * The two outlines are the same polyline offset half a gutter to either side.
 * Offsetting a vertical edge is a sideways move, but offsetting the diagonal is
 * a diagonal move, so the right card's jog lands both further right AND further
 * down. Without this the gap would pinch to `GUTTER / sqrt(2)` across the
 * diagonal while staying `GUTTER` above and below it, and the seam would read
 * as a mistake. With it the gap measures the same everywhere.
 */
const LAG = GUTTER * K

const px = (n: number) => `${Math.round(n * 1000) / 1000}px`
/** x, measured back from the card's right edge */
const fromRight = (n: number) => (n === 0 ? '100%' : `calc(100% - ${px(n)})`)
/** y, measured back from the card's bottom edge */
const fromBottom = (n: number) => (n === 0 ? '100%' : `calc(100% - ${px(n)})`)
/** y, measured out from the card's vertical centre, where the jog is */
const fromMiddle = (n: number) =>
  n === 0 ? '50%' : n < 0 ? `calc(50% - ${px(-n)})` : `calc(50% + ${px(n)})`

/**
 * Both outlines shrink by the same rule: every convex radius loses `inset` and
 * the one concave radius gains it, and the diagonal slides along its own normal
 * rather than sideways, which moves the vertices it meets by `K * inset` in y.
 */
function shrink(inset: number) {
  const r = RADIUS - inset
  const hollow = RADIUS + inset
  return {
    r,
    hollow,
    /** tangent run out of a convex corner, and the same split along a diagonal */
    t: r * K,
    d: (r * K) / Math.SQRT2,
    /** the concave corner's, which is the larger of the two */
    tv: hollow * K,
    dv: (hollow * K) / Math.SQRT2,
  }
}

/** The left card: full width down to the jog, then `STEP` narrower. */
function steppedIn(inset: number): string {
  const { r, hollow, t, d, tv, dv } = shrink(inset)
  const top = -STEP / 2 - K * inset
  const bottom = STEP / 2 - K * inset
  return [
    `from ${px(inset + r)} ${px(inset)}`,
    `line to ${fromRight(inset + r)} ${px(inset)}`,
    `arc to ${fromRight(inset)} ${px(inset + r)} of ${px(r)} cw small`,
    // down the tall edge, then the jog: convex out of the vertical, concave
    // back into it
    `line to ${fromRight(inset)} ${fromMiddle(top - t)}`,
    `arc to ${fromRight(inset + d)} ${fromMiddle(top + d)} of ${px(r)} cw small`,
    `line to ${fromRight(STEP + inset - dv)} ${fromMiddle(bottom - dv)}`,
    `arc to ${fromRight(STEP + inset)} ${fromMiddle(bottom + tv)} of ${px(hollow)} ccw small`,
    `line to ${fromRight(STEP + inset)} ${fromBottom(inset + r)}`,
    `arc to ${fromRight(STEP + inset + r)} ${fromBottom(inset)} of ${px(r)} cw small`,
    `line to ${px(inset + r)} ${fromBottom(inset)}`,
    `arc to ${px(inset)} ${fromBottom(inset + r)} of ${px(r)} cw small`,
    `line to ${px(inset)} ${px(inset + r)}`,
    `arc to ${px(inset + r)} ${px(inset)} of ${px(r)} cw small`,
    'close',
  ].join(', ')
}

/**
 * The right card: it starts `STEP` in from its own left edge and reaches back
 * out to it below the jog, so the width the left card gave up arrives here.
 * Traversed clockwise, which means up the left side, so the corners come in the
 * opposite order to the card above.
 */
function steppedOut(inset: number): string {
  const { r, hollow, t, d, tv, dv } = shrink(inset)
  const top = -STEP / 2 + LAG + K * inset
  const bottom = STEP / 2 + LAG + K * inset
  return [
    `from ${px(STEP + inset + r)} ${px(inset)}`,
    `line to ${fromRight(inset + r)} ${px(inset)}`,
    `arc to ${fromRight(inset)} ${px(inset + r)} of ${px(r)} cw small`,
    `line to ${fromRight(inset)} ${fromBottom(inset + r)}`,
    `arc to ${fromRight(inset + r)} ${fromBottom(inset)} of ${px(r)} cw small`,
    `line to ${px(inset + r)} ${fromBottom(inset)}`,
    `arc to ${px(inset)} ${fromBottom(inset + r)} of ${px(r)} cw small`,
    `line to ${px(inset)} ${fromMiddle(bottom + t)}`,
    `arc to ${px(inset + d)} ${fromMiddle(bottom - d)} of ${px(r)} cw small`,
    `line to ${px(STEP + inset - dv)} ${fromMiddle(top + dv)}`,
    `arc to ${px(STEP + inset)} ${fromMiddle(top - tv)} of ${px(hollow)} ccw small`,
    `line to ${px(STEP + inset)} ${px(inset + r)}`,
    `arc to ${px(STEP + inset + r)} ${px(inset)} of ${px(r)} cw small`,
    'close',
  ].join(', ')
}

/**
 * What the row itself needs to know. The two constants ride on the grid as
 * custom properties: the cards inherit them for the padding that keeps text
 * clear of the cut, and the row uses them to size its own tracks.
 */
export const SEAM_ROW = {
  '--tool-step': px(STEP),
  '--tool-gutter': px(GUTTER),
} as CSSProperties

/** The class and the three outlines for one half of the seam. */
export function stepped(side: 'in' | 'out'): { className: string; style: CSSProperties } {
  const outline = side === 'in' ? steppedIn : steppedOut
  return {
    className: side === 'in' ? 'tool-step-in' : 'tool-step-out',
    style: {
      '--tool-clip': `shape(${outline(0)})`,
      '--tool-clip-fill': `shape(${outline(1)})`,
      '--tool-clip-focus': `shape(${outline(2)})`,
    } as CSSProperties,
  }
}
