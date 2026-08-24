/*
 * Undo granularity.
 *
 * A slider drag fires a change per pointer move, so committing each one made
 * undo replay a scrub frame by frame: dragging zoom from 20% to 50% cost
 * thirty presses to walk back. What people expect, and what Figma and its peers
 * do, is one entry per *gesture*: the whole drag collapses to a single step.
 *
 * Two things decide where a gesture ends:
 *
 *   1. A label. Consecutive edits to the same thing merge; touching a different
 *      property starts a new entry, so dragging padding and then scale is two
 *      steps even without pausing.
 *   2. A quiet gap. Stop for `WINDOW` and the run closes, so a deliberate second
 *      nudge to the same slider is its own step rather than joining the first.
 *
 * Controls that know when an interaction ends (the scrub handle releasing, a
 * typed value committing) call `endEditRun()` so the next touch always starts
 * fresh, instead of waiting out the timer.
 */

const WINDOW = 600

let runLabel = ''
let runAt = 0

/**
 * Should this edit fold into the entry already on the stack?
 *
 * Pass no label for discrete actions (delete, apply a preset, import), those
 * always earn their own entry.
 */
export function coalesces(label?: string): boolean {
  if (!label) {
    endEditRun()
    return false
  }
  const now = Date.now()
  const same = label === runLabel && now - runAt < WINDOW
  runLabel = label
  runAt = now
  return same
}

/** Close the current run so the next edit starts a new history entry. */
export function endEditRun() {
  runLabel = ''
  runAt = 0
}

/** Label for a patch, so each property coalesces on its own. */
export function patchLabel(prefix: string, patch: object): string {
  return `${prefix}:${Object.keys(patch).sort().join(',')}`
}
