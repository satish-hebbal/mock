/**
 * The style registry.
 *
 * A style is not a mode with its own code path, it is a painter plus a short
 * list of facts about what that painter needs. The panel reads those facts to
 * decide which controls to show, the renderer reads them to decide how to cut
 * the grid, and the exporter reads `glyph` to decide whether text output is
 * even meaningful. Everything asking one table means a new style is a row here
 * and a function in `painters.ts`, and nothing else in the app has to learn
 * about it.
 */

import {
  Binary,
  Blocks,
  Box,
  Diamond,
  Grip,
  GripVertical,
  LayoutGrid,
  Menu,
  Plus,
  Shapes,
  Slash,
  Squircle,
  Table,
  Type,
  type LucideIcon,
} from 'lucide-react'
import type { AsciiStyleId } from './types'

export type StyleGroup = 'glyph' | 'shape' | 'raster' | 'process'

export interface StyleSpec {
  id: AsciiStyleId
  label: string
  group: StyleGroup
  /**
   * The glyph on the style's button.
   *
   * Chosen to depict what the painter actually draws rather than to label the
   * category, which is why Dots and Braille take two different dot grids: one
   * three wide, one two wide, the same difference the two styles have. The set
   * is deliberately monochrome and inherits the button's ink. The Looks row
   * above is where colour carries identity; fourteen coloured chips underneath
   * it would be noise competing with the eight that mean something.
   */
  icon: LucideIcon
  /** draws characters from a ramp, so .txt, ANSI, HTML and SVG all work */
  glyph: boolean
  /** forces square cells: a LEGO brick with a 1.8 aspect is not a LEGO brick */
  square: boolean
  /** honours the grout slider */
  gap: boolean
  /** a one line description, shown on the button and in the section's info dot */
  hint: string
}

export const STYLES: StyleSpec[] = [
  {
    id: 'characters',
    label: 'Characters',
    icon: Type,
    group: 'glyph',
    glyph: true,
    square: false,
    gap: false,
    hint: 'Text from a ramp, darkest character for the darkest cell.',
  },
  {
    id: 'blocks',
    label: 'Blocks',
    icon: Squircle,
    group: 'glyph',
    glyph: true,
    square: false,
    gap: false,
    hint: 'Shade blocks instead of letters. Solid, and it tiles without seams.',
  },
  {
    id: 'braille',
    label: 'Braille',
    icon: GripVertical,
    group: 'glyph',
    glyph: true,
    square: false,
    gap: false,
    hint: 'Eight dots per cell, so it resolves four times the vertical detail.',
  },
  {
    id: 'dots',
    label: 'Dots',
    icon: Grip,
    group: 'shape',
    glyph: false,
    square: true,
    gap: true,
    hint: 'A disc per cell, sized by how dark the cell is. Halftone by hand.',
  },
  {
    id: 'lines',
    label: 'Lines',
    icon: Menu,
    group: 'shape',
    glyph: false,
    square: false,
    gap: true,
    hint: 'A horizontal rule per cell, thickening into the shadows.',
  },
  {
    id: 'diagonals',
    label: 'Diagonals',
    icon: Slash,
    group: 'shape',
    glyph: false,
    square: true,
    gap: true,
    hint: 'Forty-five degree hatching, the way an engraving shades.',
  },
  {
    id: 'cross',
    label: 'Cross',
    icon: Plus,
    group: 'shape',
    glyph: false,
    square: true,
    gap: true,
    hint: 'A plus per cell. Reads as a technical grid.',
  },
  {
    id: 'diamond',
    label: 'Diamond',
    icon: Diamond,
    group: 'shape',
    glyph: false,
    square: true,
    gap: true,
    hint: 'A rotated square per cell, which packs tighter than a disc.',
  },
  {
    id: 'mixed',
    label: 'Mixed',
    icon: Shapes,
    group: 'shape',
    glyph: false,
    square: true,
    gap: true,
    hint: 'A different mark in every cell, chosen by position rather than at random.',
  },
  {
    id: 'pixel',
    label: 'Pixel art',
    icon: LayoutGrid,
    group: 'raster',
    glyph: false,
    square: true,
    gap: false,
    hint: 'Solid tiles in the source colours. The grid, with nothing drawn on it.',
  },
  {
    id: 'mosaic',
    label: 'Mosaic',
    icon: Table,
    group: 'raster',
    glyph: false,
    square: true,
    gap: true,
    hint: 'Tiles with grout between them, each one lit slightly differently.',
  },
  {
    id: 'lego',
    label: 'LEGO',
    icon: Blocks,
    group: 'raster',
    glyph: false,
    square: true,
    gap: false,
    hint: 'A studded brick per cell, lit from above.',
  },
  {
    id: 'voxel',
    label: 'Voxel',
    icon: Box,
    group: 'raster',
    glyph: false,
    square: true,
    gap: false,
    hint: 'Isometric cubes, standing taller the denser the cell. Invert to flip it.',
  },
  {
    id: 'dither',
    label: 'Dither',
    icon: Binary,
    group: 'process',
    glyph: false,
    square: true,
    gap: false,
    hint: 'Error diffusion or an ordered mask, quantised to a retro palette.',
  },
]

const BY_ID = new Map(STYLES.map((s) => [s.id, s]))

export function getStyle(id: AsciiStyleId): StyleSpec {
  return BY_ID.get(id) ?? STYLES[0]
}

export const STYLE_GROUPS: { id: StyleGroup; label: string }[] = [
  { id: 'glyph', label: 'Text' },
  { id: 'shape', label: 'Marks' },
  { id: 'raster', label: 'Tiles' },
  { id: 'process', label: 'Process' },
]
