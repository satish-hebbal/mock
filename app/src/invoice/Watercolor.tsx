/**
 * A watercolour wash across the head of the page, for the Wash template.
 *
 * SVG and nothing else, for the same reason the rest of the page is DOM: the
 * print path draws this component again inside the print frame, and an SVG
 * filter renders there exactly as it does on screen. A canvas would have to be
 * painted asynchronously and could be caught blank by the print call.
 *
 * ----- how it reads as paint -----
 *
 * A pale underwash of big, fully softened shapes, and then a handful of
 * smaller glazes over it, each put through a filter that does three things
 * real watercolour does:
 *
 *   bleed    low-frequency noise pushes every edge around by tens of pixels,
 *            so the blotches have the wandering outline of pigment spreading
 *            through wet paper rather than the edge of an ellipse
 *   pooling  a sharp copy of the blotch minus a blurred one, which leaves the
 *            rim darker than the middle: pigment is carried to the edge of a
 *            wet patch as it dries, and that dark rim is the single most
 *            recognisable thing about a wash
 *   grain    fine noise knocks the colour back in specks, the paper's tooth
 *            showing through
 *
 * The blotches multiply where they overlap, like glazes laid over one another.
 *
 * Everything random comes from a generator seeded by the palette, so a given
 * logo always paints the same wash: on every render, in the PDF, and on the
 * next invoice.
 */

import { memo, useId } from 'react'

/** A tiny seeded generator (mulberry32): the same palette, the same painting. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export const Watercolor = memo(function Watercolor({
  colors,
  width,
  height,
}: {
  colors: string[]
  width: number
  /** how far down the page the paint may reach */
  height: number
}) {
  // useId's colons are not legal in a url(#...) fragment
  const id = `inv-wash-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const seed = hash(colors.join())
  const rand = rng(seed)

  /*
   * Two passes, the way a wash is actually laid. First a wide, pale
   * underwash, wet-in-wet: big shapes, heavily softened, no hard edge anywhere.
   * Then the glazes on top once that has "dried": smaller, a little stronger,
   * with the pooled rims that only form on a dry page.
   */
  const under = Array.from({ length: 4 }, (_, i) => ({
    color: colors[(i + 1) % colors.length],
    cx: (width * (i + 0.5)) / 4 + (rand() - 0.5) * 120,
    cy: -50 + rand() * 40,
    rx: 190 + rand() * 120,
    ry: 110 + rand() * 50,
    opacity: 0.16 + rand() * 0.1,
  }))
  const glazes = Array.from({ length: 6 }, (_, i) => ({
    color: colors[i % colors.length],
    cx: (width * (i + 0.5)) / 6 + (rand() - 0.5) * 80,
    cy: -40 + rand() * 50,
    rx: 80 + rand() * 90,
    ry: 55 + rand() * 60,
    opacity: 0.16 + rand() * 0.14,
  }))

  return (
    <svg
      width={width}
      height={height}
      aria-hidden
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    >
      {/* wet-in-wet: bled and softened, no rim */}
      <filter id={`${id}-wet`} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves={3} seed={seed % 1000} result="flow" />
        <feDisplacementMap in="SourceGraphic" in2="flow" scale={90} xChannelSelector="R" yChannelSelector="G" result="bled" />
        <feGaussianBlur in="bled" stdDeviation={16} />
      </filter>
      {/* the glaze: bled, pooled at the rim, broken by the paper's tooth */}
      <filter id={id} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves={4} seed={(seed % 1000) + 3} result="flow" />
        <feDisplacementMap in="SourceGraphic" in2="flow" scale={55} xChannelSelector="R" yChannelSelector="G" result="bled" />
        <feGaussianBlur in="bled" stdDeviation={1.4} result="sharp" />
        <feGaussianBlur in="bled" stdDeviation={7} result="wide" />
        {/* sharp minus wide: the rim, where the pigment was carried as it dried */}
        <feComposite in="sharp" in2="wide" operator="arithmetic" k2={1.35} k3={-0.45} result="pooled" />
        <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves={2} seed={(seed % 1000) + 7} result="tooth" />
        <feColorMatrix
          in="tooth"
          type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.45 0 0 0 1.12"
          result="grain"
        />
        <feComposite in="pooled" in2="grain" operator="in" />
      </filter>
      {under.map((b, i) => (
        <ellipse
          key={`u${i}`}
          cx={b.cx}
          cy={b.cy}
          rx={b.rx}
          ry={b.ry}
          fill={b.color}
          fillOpacity={b.opacity}
          filter={`url(#${id}-wet)`}
          style={{ mixBlendMode: 'multiply' }}
        />
      ))}
      {glazes.map((b, i) => (
        <ellipse
          key={`g${i}`}
          cx={b.cx}
          cy={b.cy}
          rx={b.rx}
          ry={b.ry}
          fill={b.color}
          fillOpacity={b.opacity}
          filter={`url(#${id})`}
          style={{ mixBlendMode: 'multiply' }}
        />
      ))}
    </svg>
  )
})
