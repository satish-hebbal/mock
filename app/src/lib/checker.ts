import type { CSSProperties } from 'react'

/*
 * The alpha checkerboard, drawn only in previews: exports keep true alpha.
 *
 * Its whole job is to say "there is nothing here", so it has to lose to the
 * artwork sitting on top of it. It's built from theme tokens rather than fixed
 * greys: the studio viewport used to hardcode a pair left over from the old
 * warm palette, which on the near-black canvas read as a bright slab rather
 * than absence.
 *
 * The squares are a whisper of `--tx3` over the canvas, enough to see the grid
 * if you look for it, not enough to compete with a screenshot.
 */
/*
 * Its own token rather than a percentage of `--tx3`.
 *
 * Mixing a percentage out of a colour that is itself translucent multiplies the
 * two alphas, so once the ink ladder became "white at low strength" this square
 * quietly dropped to a third of the weight it was drawn at and the grid all but
 * vanished. The token is defined next to the ink it belongs with.
 */
const SQUARE = 'var(--checker-square)'
const TILE = 22

export const ALPHA_CHECKER: CSSProperties = {
  backgroundColor: 'var(--panel2)',
  backgroundImage:
    `linear-gradient(45deg, ${SQUARE} 25%, transparent 25%, transparent 75%, ${SQUARE} 75%),` +
    `linear-gradient(45deg, ${SQUARE} 25%, transparent 25%, transparent 75%, ${SQUARE} 75%)`,
  backgroundSize: `${TILE}px ${TILE}px`,
  backgroundPosition: `0 0, ${TILE / 2}px ${TILE / 2}px`,
}
