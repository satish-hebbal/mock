/*
 * Squircle clipping.
 *
 * `border-radius` draws a rounded rectangle: straight edges with circular arcs
 * bolted on, and the join between the two is visible as a flat spot at small
 * sizes. A squircle is a superellipse, curving continuously the whole way
 * round, which is why platform icon shapes use one and why it reads as a
 * deliberate shape rather than a softened box.
 *
 * CSS has no superellipse primitive that ships everywhere yet, so this emits
 * the curve as an SVG path in objectBoundingBox units. Being unit-relative, one
 * definition clips an element of any size, so the swatches can be resized
 * without regenerating anything.
 */

/**
 * |2x-1|^n + |2y-1|^n = 1, sampled as a closed polyline.
 *
 * n = 4 is the usual squircle; higher pushes it toward a square, lower toward a
 * circle. 64 steps is well past the point where more segments change the pixels
 * at the sizes this is used at.
 */
function superellipse(n = 4, steps = 64): string {
  const pts: string[] = []
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    const x = 0.5 + 0.5 * Math.sign(c) * Math.abs(c) ** (2 / n)
    const y = 0.5 + 0.5 * Math.sign(s) * Math.abs(s) ** (2 / n)
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(4)},${y.toFixed(4)}`)
  }
  return pts.join(' ') + ' Z'
}

export const SQUIRCLE_ID = 'ribbit-squircle'
export const SQUIRCLE_CLIP = `url(#${SQUIRCLE_ID})`

/**
 * The clip path definition. Mount once anywhere in the tree; every element
 * using SQUIRCLE_CLIP refers back to this by id.
 */
export function SquircleDefs() {
  return (
    <svg width={0} height={0} aria-hidden className="absolute">
      <defs>
        <clipPath id={SQUIRCLE_ID} clipPathUnits="objectBoundingBox">
          <path d={superellipse()} />
        </clipPath>
      </defs>
    </svg>
  )
}
