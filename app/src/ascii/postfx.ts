/**
 * ASCII's finishing pass, which is now a view onto the shared one.
 *
 * The implementations moved to `lib/postfx.ts` when Signal needed the same
 * chain, and there is deliberately no copy of them left here: one bloom in the
 * app, and every effect added for one tool is available to the other.
 *
 * What stays is the adapter. `AsciiFx` is seven named numbers on the document,
 * which is the right shape for a panel of seven sliders and the wrong shape for
 * a chain of twenty-six, so this maps one onto the other. Documents already
 * saved keep working untouched, and the order the effects run in is the shared
 * order rather than a second opinion about it.
 *
 * A still has no clock, so `time` is fixed at 0. That is not a placeholder: it
 * is what makes grain and glitch reproducible for a picture that is only ever
 * rendered once, and it is the same value the export and the preview both pass.
 */

import { applyFx as applyChain, hasFx as chainHasFx, type FxChain } from '../lib/postfx'
import type { AsciiFx } from './types'

/** The seven the ASCII document exposes, in the shared chain's own vocabulary. */
function toChain(fx: AsciiFx): FxChain {
  return {
    bloom: { amount: fx.bloom },
    chromatic: { amount: fx.chromatic },
    scanlines: { amount: fx.scanlines },
    glitch: { amount: fx.glitch },
    grain: { amount: fx.grain },
    curvature: { amount: fx.curvature },
    vignette: { amount: fx.vignette },
  }
}

/** True when the frame would come back untouched, so the caller can skip the copy. */
export function hasFx(fx: AsciiFx): boolean {
  return chainHasFx(toChain(fx))
}

export function applyFx(canvas: HTMLCanvasElement, fx: AsciiFx, scale: number) {
  applyChain(canvas, toChain(fx), { scale, time: 0 })
}
