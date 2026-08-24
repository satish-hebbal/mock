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
const SQUARE = 'color-mix(in srgb, var(--tx3) 8%, transparent)'
const TILE = 22

export const ALPHA_CHECKER: CSSProperties = {
  backgroundColor: 'var(--panel2)',
  backgroundImage:
    `linear-gradient(45deg, ${SQUARE} 25%, transparent 25%, transparent 75%, ${SQUARE} 75%),` +
    `linear-gradient(45deg, ${SQUARE} 25%, transparent 25%, transparent 75%, ${SQUARE} 75%)`,
  backgroundSize: `${TILE}px ${TILE}px`,
  backgroundPosition: `0 0, ${TILE / 2}px ${TILE / 2}px`,
}
