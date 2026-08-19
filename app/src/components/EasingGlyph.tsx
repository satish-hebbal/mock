import type { EasingName } from '../types'

/*
 * Easing curves drawn as themselves.
 *
 * A glyph library has no mark that distinguishes "ease in" from "ease out" —
 * they'd both end up as some arrow, and the reader would be back to trusting
 * the label. The curve *is* the meaning here, so each one is its own path:
 * time runs left to right, value bottom to top, and the shape tells you where
 * the motion is slow.
 */
const PATHS: Record<EasingName, string> = {
  linear: 'M2 12 L12 2',
  smooth: 'M2 12 C 5 12, 9 2, 12 2',
  easeIn: 'M2 12 C 7 12, 10 9, 12 2',
  easeOut: 'M2 12 C 4 5, 7 2, 12 2',
  easeInOut: 'M2 12 C 7 12, 7 2, 12 2',
}

export function EasingGlyph({ easing, size = 14 }: { easing: EasingName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d={PATHS[easing] ?? PATHS.smooth}
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  )
}
