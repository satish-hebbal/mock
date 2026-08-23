/*
 * The bite taken out of the canvas.
 *
 * The transform tools have to sit within reach of the thing they transform,
 * which put them on a floating bar over the top of the shot — close, but still
 * a slab of chrome laid on the picture. Cutting them *into* the panel instead
 * means they cost the shot nothing: the tools live in the hole rather than on
 * top of the image, the way a phone's front camera lives in its island.
 *
 * One path does the whole job. It is handed to the canvas as a `clip-path`,
 * so the panel really is that shape and nothing can paint into the notch, and
 * to an SVG overlay as a stroke, so the hairline border follows the cut
 * instead of stopping at a rectangle.
 *
 * ————— the geometry —————
 *
 * Two rules decide every number below; nothing here is eyeballed.
 *
 * 1. CONCENTRIC RADII. A rounded thing inside another rounded thing only looks
 *    right when the two curves share a centre, which means the outer radius
 *    has to be the inner radius plus the gap between them. An 8pt button with
 *    6pt of air round it needs a 14pt pocket: at 16 the gap opens up round the
 *    corners, at 12 it pinches. Get it exact and the button's corner and the
 *    notch's corner stay precisely 6pt apart the whole way round the arc.
 *
 * 2. ONE RADIUS PER DIRECTION OF CURVE. Every corner that bulges outward — the
 *    panel's four, and the two where the notch flares open at the top edge —
 *    is the same 12. Every corner that cuts inward is the same 14. So the
 *    outline reads as one shape cut by one tool, rather than a collection of
 *    corners that each got their own guess.
 */

/*
 * These two are read off the app's own radius scale, which is Linear's and
 * *not* Tailwind's defaults — index.css redefines the namespace, so `rounded-md`
 * here is 8 where stock Tailwind would give 6, and `rounded-lg` is 12 where
 * stock would give 8. Hard-coding the stock numbers is how you end up with a
 * canvas whose corner quietly disagrees with every other panel's.
 */

/** `--radius-lg`: every convex corner — the panel's four and the notch's two. */
export const FRAME_RADIUS = 12

/**
 * A step down from the rail's 36, on purpose: the rail is primary navigation
 * and this is a compact mode switch riding over the picture. They share the
 * corner radius, so the two groups still read as the same family of control.
 */
export const NOTCH_BUTTON = 32
/** `--radius-md`, the same corner the rail buttons carry. */
const BUTTON_RADIUS = 8

/** The 4pt step the whole app spaces on. */
export const NOTCH_GAP = 4
/** Air between the button row and the walls of the pocket it sits in. */
export const NOTCH_PAD = 6

const BUTTONS = 4

export const NOTCH = {
  /** width of the straight-walled part; the mouth is this plus two fillets */
  width: BUTTONS * NOTCH_BUTTON + (BUTTONS - 1) * NOTCH_GAP + 2 * NOTCH_PAD,
  /** how far it hangs into the canvas */
  depth: NOTCH_BUTTON + 2 * NOTCH_PAD,
  /** concentric with the button corners it wraps: 8 of button + 6 of air */
  radius: BUTTON_RADIUS + NOTCH_PAD,
  /** the roll where the notch meets the top edge, flaring the mouth open */
  fillet: FRAME_RADIUS,
} as const

/*
 * The lone button in the top-right corner, derived rather than placed by eye.
 *
 * Two things have to be true at once, and only one size makes both. It has to
 * sit on the same centre line as the tools in the notch, so the top of the
 * canvas reads as a single band rather than two things that nearly line up.
 * And its corner has to be concentric with the panel's, or the gap round the
 * corner visibly opens and pinches while the straight edges stay parallel.
 *
 *   centred in the band  →  inset = (depth − size) / 2
 *   concentric corner    →  inset = FRAME_RADIUS − its own radius = 12 − 8 = 4
 *
 * Solve those together and size = depth − 2 × 4 = 36. A 32 would satisfy the
 * first and miss the second by 2pt each way. 36 is also the tool rail's button
 * size, so the shape this control had before it moved is the shape it keeps.
 */
export const FRAME_BUTTON = NOTCH.depth - 2 * (FRAME_RADIUS - BUTTON_RADIUS)
export const FRAME_INSET = FRAME_RADIUS - BUTTON_RADIUS

/**
 * How narrow the panel can get before the notch stops fitting.
 *
 * The editor is gated to 1024px and up so this never fires in practice, but a
 * path with a notch wider than its own box would fold inside out, and silently
 * drawing that is worse than dropping the flourish.
 */
const MIN_WIDTH = NOTCH.width + 2 * (NOTCH.fillet + FRAME_RADIUS) + 48

export const fitsNotch = (w: number, h: number) => w >= MIN_WIDTH && h >= NOTCH.depth * 3

/**
 * Where the notch is centred, snapped to a whole pixel.
 *
 * The buttons and the path are laid out from this one number rather than each
 * working out its own middle, so an odd-width panel can't leave the icons half
 * a pixel off the hole they sit in.
 */
export const notchCenter = (w: number) => Math.round(w / 2)

/**
 * The outline of the canvas panel, clockwise from the top-left corner.
 *
 * `inset` offsets the whole boundary into the material, which is how the
 * stroked copy is kept crisp: a 1px line centred on the panel's true edge
 * spills half its width outside the SVG and renders as a washed-out hairline,
 * so the stroke is drawn half a pixel in and lands on the pixel exactly. Note
 * which way each radius moves under that offset — convex corners tighten,
 * and the notch's concave ones open up, because the material is receding from
 * them rather than advancing.
 */
export function framePath(w: number, h: number, inset = 0): string {
  const r = Math.max(0, FRAME_RADIUS - inset)
  const left = inset
  const top = inset
  const right = w - inset
  const bottom = h - inset

  return [
    `M ${left + r} ${top}`,
    ...(fitsNotch(w, h) ? notchSegments(w, inset) : []),
    `H ${right - r}`,
    `A ${r} ${r} 0 0 1 ${right} ${top + r}`,
    `V ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `H ${left + r}`,
    `A ${r} ${r} 0 0 1 ${left} ${bottom - r}`,
    `V ${top + r}`,
    `A ${r} ${r} 0 0 1 ${left + r} ${top}`,
    'Z',
  ].join(' ')
}

function notchSegments(w: number, inset: number): string[] {
  const nr = NOTCH.radius + inset
  const f = Math.max(0, NOTCH.fillet - inset)
  const top = inset
  const a = notchCenter(w) - NOTCH.width / 2 - inset
  const b = notchCenter(w) + NOTCH.width / 2 + inset
  const floor = NOTCH.depth + inset

  return [
    `H ${a - f}`,
    `A ${f} ${f} 0 0 1 ${a} ${top + f}`,
    `V ${floor - nr}`,
    `A ${nr} ${nr} 0 0 0 ${a + nr} ${floor}`,
    `H ${b - nr}`,
    `A ${nr} ${nr} 0 0 0 ${b} ${floor - nr}`,
    `V ${top + f}`,
    `A ${f} ${f} 0 0 1 ${b + f} ${top}`,
  ]
}
