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
 *
 * Two rows use it at two sizes, so the geometry is a parameter rather than a
 * constant. Everything the CSS needs to agree with rides along as a custom
 * property on the row, which is what keeps the padding that holds text clear of
 * the cut measured from the same number the cut is.
 */

export interface Metrics {
  /** the row's gap, and so the width of the seam */
  gutter: number
  /** how far the seam steps sideways, and so how much width changes hands */
  step: number
  /** the card's corner radius */
  radius: number
  /** the card's padding, which the step is added to on the side it cuts */
  pad: number
}

/**
 * The run from a corner's vertex to where a fillet of radius 1 leaves the edge,
 * for the 135 degree turns a 45 degree jog makes. Every tangent length and
 * every offset below is some multiple of it.
 */
const K = Math.SQRT2 - 1

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
function shrink({ radius }: Metrics, inset: number) {
  const r = radius - inset
  const hollow = radius + inset
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

/** The left card: full width down to the jog, then `step` narrower. */
function steppedIn(m: Metrics, inset: number): string {
  const { r, hollow, t, d, tv, dv } = shrink(m, inset)
  const step = m.step
  const top = -step / 2 - K * inset
  const bottom = step / 2 - K * inset
  return [
    `from ${px(inset + r)} ${px(inset)}`,
    `line to ${fromRight(inset + r)} ${px(inset)}`,
    `arc to ${fromRight(inset)} ${px(inset + r)} of ${px(r)} cw small`,
    // down the tall edge, then the jog: convex out of the vertical, concave
    // back into it
    `line to ${fromRight(inset)} ${fromMiddle(top - t)}`,
    `arc to ${fromRight(inset + d)} ${fromMiddle(top + d)} of ${px(r)} cw small`,
    `line to ${fromRight(step + inset - dv)} ${fromMiddle(bottom - dv)}`,
    `arc to ${fromRight(step + inset)} ${fromMiddle(bottom + tv)} of ${px(hollow)} ccw small`,
    `line to ${fromRight(step + inset)} ${fromBottom(inset + r)}`,
    `arc to ${fromRight(step + inset + r)} ${fromBottom(inset)} of ${px(r)} cw small`,
    `line to ${px(inset + r)} ${fromBottom(inset)}`,
    `arc to ${px(inset)} ${fromBottom(inset + r)} of ${px(r)} cw small`,
    `line to ${px(inset)} ${px(inset + r)}`,
    `arc to ${px(inset + r)} ${px(inset)} of ${px(r)} cw small`,
    'close',
  ].join(', ')
}

/**
 * The right card: it starts `step` in from its own left edge and reaches back
 * out to it below the jog, so the width the left card gave up arrives here.
 * Traversed clockwise, which means up the left side, so the corners come in the
 * opposite order to the card above.
 *
 * Its jog also sits a little lower. The two outlines are the same polyline
 * offset half a gutter to either side; offsetting a vertical edge is a sideways
 * move, but offsetting the diagonal is a diagonal move, so this one lands both
 * further right AND further down. Without that lag the gap would pinch to
 * `gutter / sqrt(2)` across the diagonal while staying `gutter` above and below
 * it, and the seam would read as a mistake.
 */
function steppedOut(m: Metrics, inset: number): string {
  const { r, hollow, t, d, tv, dv } = shrink(m, inset)
  const step = m.step
  const lag = m.gutter * K
  const top = -step / 2 + lag + K * inset
  const bottom = step / 2 + lag + K * inset
  return [
    `from ${px(step + inset + r)} ${px(inset)}`,
    `line to ${fromRight(inset + r)} ${px(inset)}`,
    `arc to ${fromRight(inset)} ${px(inset + r)} of ${px(r)} cw small`,
    `line to ${fromRight(inset)} ${fromBottom(inset + r)}`,
    `arc to ${fromRight(inset + r)} ${fromBottom(inset)} of ${px(r)} cw small`,
    `line to ${px(inset + r)} ${fromBottom(inset)}`,
    `arc to ${px(inset)} ${fromBottom(inset + r)} of ${px(r)} cw small`,
    `line to ${px(inset)} ${fromMiddle(bottom + t)}`,
    `arc to ${px(inset + d)} ${fromMiddle(bottom - d)} of ${px(r)} cw small`,
    `line to ${px(step + inset - dv)} ${fromMiddle(top + dv)}`,
    `arc to ${px(step + inset)} ${fromMiddle(top - tv)} of ${px(hollow)} ccw small`,
    `line to ${px(step + inset)} ${px(inset + r)}`,
    `arc to ${px(step + inset + r)} ${px(inset)} of ${px(r)} cw small`,
    'close',
  ].join(', ')
}

/** The class and the three outlines for one half of the seam. */
interface Half {
  className: string
  style: CSSProperties
}

export interface Seam {
  /** goes on the row: the metrics the CSS reads back */
  row: CSSProperties
  /** the first two cards, in order; anything past them is a plain rectangle */
  parts: Half[]
}

function half(m: Metrics, side: 'in' | 'out'): Half {
  const outline = (inset: number) =>
    `shape(${side === 'in' ? steppedIn(m, inset) : steppedOut(m, inset)})`
  return {
    className: side === 'in' ? 'tool-step-in' : 'tool-step-out',
    style: {
      '--tool-clip': outline(0),
      '--tool-clip-fill': outline(1),
      '--tool-clip-focus': outline(2),
    } as CSSProperties,
  }
}

export function seam(m: Metrics): Seam {
  return {
    row: {
      '--tool-step': px(m.step),
      '--tool-gutter': px(m.gutter),
      '--tool-radius': px(m.radius),
      '--tool-pad': px(m.pad),
    } as CSSProperties,
    parts: [half(m, 'in'), half(m, 'out')],
  }
}

/** the home screen's row: `gap-3`, `rounded-xl`, `p-5` */
export const HOME_SEAM = seam({ gutter: 12, step: 28, radius: 16, pad: 20 })

/** the app menu's row, which runs smaller: `gap-2`, `rounded-lg`, `p-3` */
export const SHEET_SEAM = seam({ gutter: 8, step: 20, radius: 12, pad: 12 })
