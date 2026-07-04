import type { EasingName } from '../types'

export const EASINGS: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  // quintic smoothstep — the "cinematic" default
  smooth: (t) => t * t * t * (t * (6 * t - 15) + 10),
}

export const EASING_NAMES: { id: EasingName; label: string }[] = [
  { id: 'smooth', label: 'Smooth' },
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease in' },
  { id: 'easeOut', label: 'Ease out' },
  { id: 'easeInOut', label: 'Ease in-out' },
]
