import type { CSSProperties } from 'react'
import { AURORA_BLUR, auroraBands } from '../lib/aurora'
import type { Tool } from '../lib/tools'

/**
 * The light under a tool card, as shapes rather than as gradients.
 *
 * Seven curtains from `aurora.ts`, stacked faint, blurred once as a group. One
 * filter for the whole stack rather than one per curtain is both cheaper and
 * more correct: cheaper because a Gaussian is the expensive thing on this card
 * and there are now five of them on the page instead of thirty-five, and more
 * correct because blurring the composite is what smooths the joins between
 * curtains, which is where the softness is supposed to come from.
 *
 * `preserveAspectRatio="none"` deliberately lets the whole thing stretch, so
 * every number in `aurora.ts` is a percentage of whatever card it lands on and
 * one set of curtains fits both the 190px home card and the 100px menu one.
 *
 * Nothing here knows about hover. The layer's opacity is `--glow` and each
 * curtain's climb is `--au-lift` times its own `k`, both registered properties
 * that the card animates, so this renders once and the stylesheet moves it.
 */
export function ToolAurora({ tool }: { tool: Tool }) {
  const id = `au-${tool.id}`
  return (
    <svg
      className="tool-card-aurora"
      viewBox="0 0 200 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* the filter region has to be opened well past the default -10%/120%
            or the blur is cut off square at the edge of the stack's box, and a
            curtain with a straight edge is worse than no curtain */}
        <filter
          id={id}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation={AURORA_BLUR} />
        </filter>
      </defs>
      <g filter={`url(#${id})`}>
        {auroraBands(tool).map((b, i) => (
          <path
            key={i}
            d={b.d}
            fill={`rgb(${b.color})`}
            opacity={b.opacity}
            style={{ '--k': b.k, '--s': b.s } as CSSProperties}
          />
        ))}
      </g>
    </svg>
  )
}
