/**
 * Character ramps.
 *
 * Every ramp is written lightest first, so index 0 is what a white cell gets
 * and the last character is what a black one gets. That direction is a choice
 * and it has to be made once: written the other way round, every ramp in the
 * app would have to be reversed at the point of use, and the one that got
 * missed would come out as a photographic negative.
 *
 * The ramps themselves are not arbitrary strings. A ramp works when its
 * characters step evenly in *coverage*, the fraction of the cell the glyph
 * actually inks. `@` covers about three quarters of its cell and `.` about a
 * fortieth, and the ones in between have to land at even intervals or the
 * midtones band. The standard and detailed ramps below are the two that have
 * been in circulation for decades precisely because they do.
 */

import type { RampId } from './types'

export interface Ramp {
  id: RampId
  label: string
  chars: string
  /** a ramp of solid glyphs wants no letter spacing and no anti-aliased gaps */
  solid?: boolean
  hint: string
}

export const RAMPS: Ramp[] = [
  {
    id: 'standard',
    label: 'Standard',
    chars: ' .,:;+=xX80S#@',
    hint: 'A balanced ramp with plenty of steps. The all-rounder for photographs.',
  },
  {
    id: 'detailed',
    label: 'Detailed',
    chars: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
    hint: 'Seventy steps, for the smoothest gradients. Best on faces and fine detail.',
  },
  {
    id: 'minimal',
    label: 'Minimal',
    chars: ' .:-=#',
    hint: 'Six steps. Graphic and poster-like, which suits logos and bold shapes.',
  },
  {
    id: 'blocks',
    label: 'Blocks',
    chars: ' ░▒▓█',
    solid: true,
    hint: 'The four shade blocks. Solid terminal fills with no gaps between cells.',
  },
  {
    id: 'shades',
    label: 'Half blocks',
    chars: ' ▖▗▄▌▚▙█',
    solid: true,
    hint: 'Quadrant blocks, which read as a coarse two-by-two pixel per cell.',
  },
  {
    id: 'binary',
    label: 'Binary',
    chars: ' 01',
    hint: 'Ones and zeroes only. Legible as a texture rather than as tone.',
  },
  {
    id: 'custom',
    label: 'Custom',
    chars: ' .:-=+*#%@',
    hint: 'Your own characters, lightest first.',
  },
]

const BY_ID = new Map(RAMPS.map((r) => [r.id, r]))

export function getRamp(id: RampId): Ramp {
  return BY_ID.get(id) ?? RAMPS[0]
}

/**
 * The characters a document actually draws with.
 *
 * A custom ramp that has been emptied falls back rather than rendering nothing:
 * a blank canvas is indistinguishable from a broken one, and the text field it
 * comes from is empty for a moment every time somebody clears it to retype.
 */
export function rampChars(id: RampId, custom: string): string {
  if (id === 'custom') return custom.length > 0 ? custom : getRamp('custom').chars
  return getRamp(id).chars
}

/**
 * Braille, which is its own alphabet rather than a ramp.
 *
 * One Unicode braille cell carries a 2x4 grid of dots in the low eight bits of
 * its code point, so a cell is not picked by brightness at all: it is assembled
 * from eight sub-samples. That is why braille resolves four times the vertical
 * detail of any character ramp at the same cell size, and why it gets its own
 * painter instead of a string here.
 *
 * The bit order is the awkward part of the standard and the reason this table
 * exists: dots 1-3 run down the left column, 4-6 down the right, and dots 7 and
 * 8 were added underneath later, so they sit in the high two bits out of order.
 */
export const BRAILLE_BASE = 0x2800

/** [x, y] of each dot, paired with the bit it sets. */
export const BRAILLE_DOTS: { x: number; y: number; bit: number }[] = [
  { x: 0, y: 0, bit: 0x01 },
  { x: 0, y: 1, bit: 0x02 },
  { x: 0, y: 2, bit: 0x04 },
  { x: 1, y: 0, bit: 0x08 },
  { x: 1, y: 1, bit: 0x10 },
  { x: 1, y: 2, bit: 0x20 },
  { x: 0, y: 3, bit: 0x40 },
  { x: 1, y: 3, bit: 0x80 },
]
