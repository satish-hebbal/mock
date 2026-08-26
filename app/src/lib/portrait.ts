/*
 * Portrait: depth of field and stage light over a finished frame.
 *
 * Shared by both editors and by both renderers within each of them. Shots
 * composes its picture on a 2D canvas and the studio renders one in WebGL, but
 * by the time this runs each has a flat frame, so the same geometry, the same
 * circles and the same blur radii serve all four paths. Neither renderer gets
 * to invent its own or the export stops matching what was framed.
 *
 * Everything is expressed against min(surface), so a shot looks the same at
 * 640px on screen and 3200px in the file.
 *
 * It used to live in src/shots. Nothing about it was ever specific to Shots
 * beyond where it happened to be written.
 */

export type PortraitMode = 'none' | 'lens' | 'stage' | 'both'

export interface Portrait {
  mode: PortraitMode
  /** focal centre in normalized surface coordinates (0..1) */
  x: number
  y: number
  /** radius of the fully sharp core, as a fraction of min(surface) */
  radius: number
  /** width of the falloff ring outside the core, same units */
  feather: number
  /**
   * 0..1 peak defocus. Separate from `shade` so that switching between modes,
   * or running both at once, never makes one of them overwrite the other's
   * setting.
   */
  strength: number
  /** 0..1 darkness outside the focus */
  shade: number
}

export function defaultPortrait(): Portrait {
  return { mode: 'none', x: 0.5, y: 0.5, radius: 0.22, feather: 0.18, strength: 0.5, shade: 0.6 }
}

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

/** Peak blur at strength 1, as a fraction of min(surface). */
const MAX_BLUR = 0.06

/**
 * A complete portrait record, whatever the document happens to carry.
 *
 * Fields are backfilled rather than only substituted wholesale, so a document
 * saved before `shade` was split out of `strength`, or before the studio had
 * this at all, still hands the sliders a number instead of `undefined`. Never
 * call this inside a zustand selector: it builds a new object, and selector
 * results are compared by identity.
 */
export function portraitOf(p: Portrait | undefined): Portrait {
  return p ? { ...defaultPortrait(), ...p } : defaultPortrait()
}

export function portraitGeometry(p: Portrait, W: number, H: number): PortraitGeometry {
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

/**
 * Blur a canvas with its edges held, rather than fading into nothing.
 *
 * `ctx.filter` samples transparent black past the bitmap, so a straight blur
 * eats a soft transparent band all the way round the frame, exactly where the
 * out-of-focus region is. Padding the source and stretching its edge pixels
 * outward first gives the kernel something real to reach into, so the border
 * comes back the colour it started.
 */
function blurCanvas(src: HTMLCanvasElement, px: number): HTMLCanvasElement {
  const W = src.width
  const H = src.height
  const P = Math.max(1, Math.ceil(px * 1.5))

  const pad = document.createElement('canvas')
  pad.width = W + P * 2
  pad.height = H + P * 2
  const pg = pad.getContext('2d')!
  pg.drawImage(src, P, P)
  pg.drawImage(src, 0, 0, 1, H, 0, P, P, H)
  pg.drawImage(src, W - 1, 0, 1, H, W + P, P, P, H)
  pg.drawImage(src, 0, 0, W, 1, P, 0, W, P)
  pg.drawImage(src, 0, H - 1, W, 1, P, H + P, W, P)
  pg.drawImage(src, 0, 0, 1, 1, 0, 0, P, P)
  pg.drawImage(src, W - 1, 0, 1, 1, W + P, 0, P, P)
  pg.drawImage(src, 0, H - 1, 1, 1, 0, H + P, P, P)
  pg.drawImage(src, W - 1, H - 1, 1, 1, W + P, H + P, P, P)

  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const og = out.getContext('2d')!
  og.filter = `blur(${px}px)`
  og.drawImage(pad, -P, -P)
  /*
   * Hand the canvas back with a clean context.
   *
   * `getContext` returns the same object every time, so a filter left set here
   * is still set when the caller masks this canvas, and `ctx.filter` applies to
   * fills as much as to images. The mask gradient would come out blurred, and
   * blurring a fill that covers the whole canvas drags transparency in from
   * beyond its edges, so the mask thinned out around the border and let the
   * sharp original show through exactly there.
   */
  og.filter = 'none'
  return out
}

/**
 * Defocus the composed frame around the focal point, in place.
 *
 * Runs last, on everything: background, devices, shadows. That is the whole
 * point of it, since a lens does not know which parts of a scene you consider
 * the subject, and a blur that skipped the phone would give away that the
 * picture was assembled rather than taken.
 *
 * The passes are applied in order, each over the result of the last, matching
 * how the preview's stacked `backdrop-filter` layers compose.
 */
export function applyPortrait(canvas: HTMLCanvasElement, p: Portrait | undefined) {
  if (!p || p.mode === 'none') return
  const W = canvas.width
  const H = canvas.height
  const ctx = canvas.getContext('2d')!
  const g = portraitGeometry(p, W, H)

  // defocus first, then shade what is left: the shadow is cast onto the
  // finished picture, not blurred along with it
  for (const pass of portraitPasses(g)) {
    const soft = blurCanvas(canvas, pass.blur)
    const sg = soft.getContext('2d')!
    // keep only the out-of-focus ring of the blurred copy, then lay it back on
    sg.globalCompositeOperation = 'destination-in'
    sg.fillStyle = portraitMaskGradient(sg, g, pass.inner, pass.outer)
    sg.fillRect(0, 0, W, H)
    ctx.drawImage(soft, 0, 0)
  }

  if (g.darkness > 0) {
    const mask = document.createElement('canvas')
    mask.width = W
    mask.height = H
    const mg = mask.getContext('2d')!
    mg.fillStyle = `rgba(0,0,0,${g.darkness})`
    mg.fillRect(0, 0, W, H)
    mg.globalCompositeOperation = 'destination-in'
    mg.fillStyle = portraitMaskGradient(mg, g, g.inner, g.outer)
    mg.fillRect(0, 0, W, H)

    ctx.save()
    // 'source-atop', so the shade only lands on pixels that are already there.
    // A transparent background has to survive this pass with its alpha intact,
    // the same way the vignette leaves it alone.
    ctx.globalCompositeOperation = 'source-atop'
    ctx.drawImage(mask, 0, 0)
    ctx.restore()
  }
}
