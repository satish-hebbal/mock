import { defaultPortrait, type ShotsPortrait } from './types'

/*
 * Depth of field, shared by the CSS preview and the canvas exporter.
 *
 * Both sides need the same circles and the same blur radii or the export stops
 * matching what you framed, so the geometry lives here and neither renderer
 * gets to invent its own. Everything is expressed against min(canvas), so a
 * shot looks the same at 640px on screen and 3200px in the file.
 */

export interface PortraitGeometry {
  /** focal centre, in the pixels of whatever surface is being drawn */
  cx: number
  cy: number
  /** radius of the fully sharp core */
  inner: number
  /** radius at which the effect reaches full strength */
  outer: number
  /** peak blur radius in px ('lens'), or 0 */
  blur: number
  /** peak darkness 0..1 ('stage'), or 0 */
  darkness: number
}

/** Peak blur at strength 1, as a fraction of min(canvas). */
const MAX_BLUR = 0.06

/**
 * A complete portrait record, whatever the document happens to carry.
 *
 * Fields are backfilled rather than only substituted wholesale, so a shot saved
 * before `shade` was split out of `strength` still hands the sliders a number
 * instead of `undefined`. Never call this inside a zustand selector: it builds
 * a new object, and selector results are compared by identity.
 */
export function portraitOf(p: ShotsPortrait | undefined): ShotsPortrait {
  return p ? { ...defaultPortrait(), ...p } : defaultPortrait()
}

export function portraitGeometry(p: ShotsPortrait, W: number, H: number): PortraitGeometry {
  const minDim = Math.min(W, H)
  const inner = p.radius * minDim
  return {
    cx: p.x * W,
    cy: p.y * H,
    inner,
    // a zero-width falloff would cut the picture with a hard circle, so the
    // ring always keeps a little softness even at feather 0
    outer: inner + Math.max(0.015, p.feather) * minDim,
    // the two effects are independent, so 'both' simply switches on each of them
    blur: p.mode === 'lens' || p.mode === 'both' ? p.strength * minDim * MAX_BLUR : 0,
    darkness:
      p.mode === 'stage' || p.mode === 'both' ? Math.min(0.95, 0.25 + (p.shade ?? 0.6) * 0.7) : 0,
  }
}

export interface PortraitPass {
  blur: number
  inner: number
  outer: number
}

/**
 * The defocus is two rings, not one.
 *
 * A single mask steps from sharp to fully blurred across one gradient, which
 * reads as a sticker pasted onto a smeared photograph. Splitting it into a
 * light ring and a heavier one that starts inside it approximates the way a
 * real lens gives up focus gradually.
 *
 * The passes stack: each one is applied to the result of the last, which is
 * exactly how the preview's `backdrop-filter` layers compose, so the two
 * renderers agree without either of them special-casing the other.
 */
export function portraitPasses(g: PortraitGeometry): PortraitPass[] {
  if (g.blur <= 0.5) return []
  const span = Math.max(1, g.outer - g.inner)
  return [
    { blur: g.blur * 0.35, inner: g.inner, outer: g.inner + span * 0.55 },
    { blur: g.blur * 0.75, inner: g.inner + span * 0.45, outer: g.outer + span * 0.7 },
  ]
}

/**
 * A radial mask that is transparent over the focal core and opaque outside it,
 * so whatever carries it only affects the out-of-focus region.
 *
 * The CSS and canvas forms below are the same ramp written twice, because one
 * takes a gradient string and the other takes colour stops.
 */
export function portraitMaskCss(g: PortraitGeometry, inner: number, outer: number): string {
  const stop = Math.max(0, Math.min(99, (inner / Math.max(1, outer)) * 100))
  return `radial-gradient(circle ${outer}px at ${g.cx}px ${g.cy}px, transparent ${stop}%, #000 100%)`
}

export function portraitMaskGradient(
  ctx: CanvasRenderingContext2D,
  g: PortraitGeometry,
  inner: number,
  outer: number,
): CanvasGradient {
  const grad = ctx.createRadialGradient(g.cx, g.cy, inner, g.cx, g.cy, Math.max(inner + 1, outer))
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,1)')
  return grad
}
