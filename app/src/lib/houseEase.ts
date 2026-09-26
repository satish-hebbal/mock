/**
 * The house easing curves, for motion driven from script.
 *
 * The same control points as the `--ease-*` tokens in `index.css`, which stay
 * the source of truth: anything CSS can animate should use those. This is for
 * the motion CSS cannot reach, such as a canvas redrawn per frame, so that it
 * still moves on the app's curves rather than on a one-off.
 *
 * Not the same thing as `easing.ts`, which holds the curves a user can pick for
 * a keyframe.
 */

export type Ease = (t: number) => number

/** A CSS `cubic-bezier()` as a function of progress, solved by Newton then bisection. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u
  const sy = (u: number) => ((ay * u + by) * u + cy) * u
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx

  const solve = (x: number) => {
    let u = x
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - x
      if (Math.abs(err) < 1e-5) return u
      const d = dx(u)
      if (Math.abs(d) < 1e-6) break
      u -= err / d
    }
    let lo = 0
    let hi = 1
    u = x
    for (let i = 0; i < 20; i++) {
      const v = sx(u)
      if (Math.abs(v - x) < 1e-5) break
      if (v < x) lo = u
      else hi = u
      u = (lo + hi) / 2
    }
    return u
  }

  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : sy(solve(t)))
}

export const EASE = {
  settle: cubicBezier(0.22, 0.9, 0.16, 1),
  smooth: cubicBezier(0.19, 1, 0.22, 1),
  snappy: cubicBezier(0.175, 0.885, 0.32, 1.1),
  bloom: cubicBezier(0.4, 0, 0.6, 1),
} satisfies Record<string, Ease>
