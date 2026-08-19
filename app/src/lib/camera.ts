/**
 * Limits for every camera property, in one place.
 *
 * The inspector sliders and the canvas gestures both write the same values, and
 * they used to carry their own numbers: the Pan sliders stopped at ±3 while the
 * right-drag gesture clamped nothing at all, so a long drag could push pan past
 * 14 and shove the whole scene out of frame with the slider pinned at its end,
 * giving no hint how far past it had gone. One table, both readers.
 */
export const CAMERA_LIMITS = {
  tiltX: [-88, 88],
  tiltY: [-180, 180],
  roll: [-45, 45],
  fov: [8, 90],
  zoom: [0.3, 8],
  panX: [-3, 3],
  panY: [-3, 3],
  rotateX: [-90, 90],
  rotateY: [-180, 180],
} as const satisfies Record<string, readonly [number, number]>

export type CameraProp = keyof typeof CAMERA_LIMITS

export function clampCamera(prop: CameraProp, value: number): number {
  const [min, max] = CAMERA_LIMITS[prop]
  return Math.min(max, Math.max(min, value))
}
