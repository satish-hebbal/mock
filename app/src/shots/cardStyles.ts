/*
 * Card styles: what the screenshot is mounted in.
 *
 * Every style is a recipe built from four primitives, chosen because each one
 * survives the trip to the canvas exporter:
 *
 *   rings  concentric bands outside the card edge
 *   hard   an unblurred shadow at an offset, the sticker look
 *   stack  copies of the card behind it, offset and shrunk
 *   inset  a bevel just inside the edge
 *
 * The first three are all the same operation on the canvas side: take the
 * card's own silhouette, move or scale it, and draw it behind. That is why they
 * are the vocabulary. A style expressed as "a 3px black outline" would need the
 * exporter to reconstruct the card's outline, rotation and all, whereas a
 * silhouette already is one.
 *
 * Lengths are fractions of the card's width, so a style looks the same on a
 * thumbnail and in a 4K export.
 */

export interface CardStyle {
  id: string
  label: string
  /** bands outside the edge, innermost first */
  rings?: { w: number; color: string }[]
  /** hard offset shadow */
  hard?: { x: number; y: number; color: string }
  /** copies behind the card */
  stack?: { count: number; dx: number; dy: number; shrink: number; color: string }
  /** bevel inside the edge, lit from the top left */
  inset?: { w: number; color: string }
}

export const CARD_STYLES: CardStyle[] = [
  { id: 'default', label: 'Default' },
  {
    id: 'glass-light',
    label: 'Glass Light',
    rings: [{ w: 0.02, color: 'rgba(255,255,255,0.72)' }],
  },
  {
    id: 'glass-dark',
    label: 'Glass Dark',
    rings: [{ w: 0.022, color: 'rgba(24,24,28,0.82)' }],
  },
  { id: 'inset-light', label: 'Inset Light', inset: { w: 0.016, color: 'rgba(255,255,255,0.95)' } },
  { id: 'inset-dark', label: 'Inset Dark', inset: { w: 0.016, color: 'rgba(0,0,0,0.5)' } },
  /*
   * A single hairline, not a line held off the card by a gap.
   *
   * The gap version needs the ring between card and line to be painted in
   * whatever is behind, and neither renderer knows that: a box-shadow spread of
   * `transparent` lets the ring behind it show through rather than cutting a
   * hole, and the canvas side would have to erase the drop shadow to make one.
   * A thin bright ring is the part of the look that survives honestly.
   */
  { id: 'outline', label: 'Outline', rings: [{ w: 0.006, color: 'rgba(255,255,255,0.9)' }] },
  { id: 'border', label: 'Border', rings: [{ w: 0.028, color: '#0d0d11' }] },
  {
    id: 'retro',
    label: 'Retro',
    rings: [{ w: 0.011, color: '#0d0d11' }],
    hard: { x: 0.032, y: 0.032, color: '#0d0d11' },
  },
  {
    id: 'card',
    label: 'Card',
    stack: { count: 1, dx: 0, dy: 0.032, shrink: 0.03, color: '#ffffff' },
  },
  {
    id: 'stack',
    label: 'Stack',
    stack: { count: 2, dx: 0, dy: 0.026, shrink: 0.032, color: '#f4f4f6' },
  },
  {
    id: 'stack-2',
    label: 'Stack 2',
    stack: { count: 3, dx: 0.024, dy: 0.014, shrink: 0.018, color: '#f7f7f9' },
  },
]

export const DEFAULT_CARD_STYLE = 'default'

export function getCardStyle(id: string | undefined): CardStyle {
  return CARD_STYLES.find((s) => s.id === id) ?? CARD_STYLES[0]
}

/**
 * The rings, hard shadow and inset as one CSS `box-shadow`.
 *
 * Spread rings follow `border-radius` exactly, and listing them innermost first
 * paints each one behind the last, which is what makes concentric bands out of
 * a flat list. The stack is not here: copies of the card are elements, not
 * shadows, so both renderers draw those separately.
 */
export function cardStyleCss(style: CardStyle, cardW: number): string | undefined {
  const parts: string[] = []
  let spread = 0
  for (const ring of style.rings ?? []) {
    spread += ring.w * cardW
    parts.push(`0 0 0 ${spread.toFixed(2)}px ${ring.color}`)
  }
  if (style.hard) {
    parts.push(
      `${(style.hard.x * cardW).toFixed(2)}px ${(style.hard.y * cardW).toFixed(2)}px 0 ${style.hard.color}`,
    )
  }
  if (style.inset) {
    const w = style.inset.w * cardW
    parts.push(`inset ${w.toFixed(2)}px ${w.toFixed(2)}px ${(w * 1.6).toFixed(2)}px ${style.inset.color}`)
  }
  return parts.length ? parts.join(', ') : undefined
}

/**
 * The shadow under stack copy `k`, in card-width fractions.
 *
 * Shared so the preview and the exporter separate the sheets by the same
 * amount. Absolute pixels would work at one size only, and a stack is exactly
 * the style where losing the shadow collapses the whole effect: without it the
 * copies read as one flat shape with a stepped edge.
 */
export function stackShade(k: number): { dy: number; blur: number; color: string } {
  return { dy: 0.005 * k, blur: 0.018 * k, color: 'rgba(0,0,0,0.16)' }
}

/** Total outward reach of the rings, as a fraction of card width. */
export function ringReach(style: CardStyle): number {
  return (style.rings ?? []).reduce((sum, r) => sum + r.w, 0)
}
