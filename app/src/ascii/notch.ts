/**
 * The pocket cut into the canvas's top-right corner, sized around the row that
 * sits in it: undo, redo, Start over and Export.
 *
 * Export is a pill of its own width rather than another 32pt square, so the
 * hole is measured from the row instead of counted in buttons. Fixing the
 * pill's width is what makes that arithmetic true rather than nearly true, and
 * is the same move Signal's "Surprise me" makes for its own corner.
 *
 * It lives in a module of its own because two files need it and they already
 * point at each other: the editor cuts the hole, and the canvas keeps the
 * picture clear of it by the pocket's own depth.
 */

import { NOTCH_BUTTON, NOTCH_GAP, notchForPill } from '../lib/notch'

export const EXPORT_W = 92

/**
 * Start over is a hold rather than a click, so it is a labelled pill like the
 * one in every other editor's header, not a third glyph.
 *
 * It is handed to the button as a CSS variable rather than written twice: the
 * pocket's width is arithmetic on these numbers, and a pill that disagreed with
 * the hole by a few points would leave the gap round it visibly uneven.
 */
export const START_W = 112

/*
 * No divider before Export. The pill is already a different colour, a different
 * shape and twice the width of the two squares beside it, so a hairline was
 * separating things nothing could confuse in the first place.
 */
const ROW_W = 2 * NOTCH_BUTTON + 3 * NOTCH_GAP + START_W + EXPORT_W

export const ASCII_NOTCH = notchForPill(ROW_W, NOTCH_BUTTON, 'corner')
