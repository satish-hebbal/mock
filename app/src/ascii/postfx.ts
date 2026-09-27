/**
 * ASCII's finishing pass, which is a view onto the shared one.
 *
 * The implementations live in `lib/postfx.ts`, which Signal uses too, and there
 * is deliberately no copy of them here: one bloom in the app, and every effect
 * added for one tool is available to the other.
 *
 * What stays is the adapter. The document names seven effects directly in
 * `fx`, the ones the Looks set, and carries the rest of the chain in `finish`.
 * This merges the two into the shared chain's shape, so documents saved before
 * `finish` existed keep working untouched and the order the effects run in is
 * the shared order rather than a second opinion about it.
 *
 * A still has no clock, so `time` defaults to 0. That is what makes grain and
 * glitch reproducible for a picture that is only ever rendered once; a motion
 * export passes the frame's own time instead.
 */

import { applyFx as applyChain, hasFx as chainHasFx, type FxChain } from '../lib/postfx'
import type { AsciiDoc, AsciiFx } from './types'

/** The keys that live in `doc.fx` rather than in `doc.finish`. */
export const NAMED_FX: (keyof AsciiFx)[] = ['bloom', 'chromatic', 'scanlines', 'glitch', 'grain', 'curvature', 'vignette']

/** The whole chain for a document, in the shared chain's own vocabulary. */
export function chainOf(doc: Pick<AsciiDoc, 'fx' | 'finish'>): FxChain {
  const chain: FxChain = { ...(doc.finish ?? {}) }
  for (const k of NAMED_FX) {
    const amount = doc.fx[k]
    chain[k] = { ...(chain[k] ?? {}), amount }
  }
  return chain
}

/** True when the frame would come back untouched, so the caller can skip the copy. */
export function hasFx(doc: Pick<AsciiDoc, 'fx' | 'finish'>): boolean {
  return chainHasFx(chainOf(doc))
}

export function applyFx(canvas: HTMLCanvasElement, doc: Pick<AsciiDoc, 'fx' | 'finish'>, scale: number, time = 0) {
  applyChain(canvas, chainOf(doc), { scale, time })
}
