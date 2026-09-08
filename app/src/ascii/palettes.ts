/**
 * Retro palettes, and the nearest-colour search that quantises to them.
 *
 * Every palette is stored pre-split into RGB triples rather than as hex, because
 * quantisation runs per pixel and parsing '#8bac0f' a million times a frame is
 * the whole cost of the pass. `PALETTES` is the display list; `paletteRGB` is
 * what the dither engine actually holds.
 */

import type { PaletteId } from './types'

export interface Palette {
  id: PaletteId
  label: string
  /** hex, in the order a person would want to see them in a swatch row */
  colors: string[]
  hint: string
}

export const PALETTES: Palette[] = [
  {
    id: 'bw',
    label: '1-bit',
    colors: ['#000000', '#ffffff'],
    hint: 'Pure black and white. The original, and still the most graphic.',
  },
  {
    id: 'gray4',
    label: '4 greys',
    colors: ['#000000', '#555555', '#aaaaaa', '#ffffff'],
    hint: 'Two bits of grey. Keeps tone without letting colour back in.',
  },
  {
    id: 'gameboy',
    label: 'Game Boy',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
    hint: 'The four greens of a 1989 dot-matrix screen.',
  },
  {
    id: 'cga',
    label: 'CGA',
    colors: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
    hint: 'Mode 4 palette 1: black, cyan, magenta, white.',
  },
  {
    id: 'c64',
    label: 'C64',
    colors: [
      '#000000',
      '#ffffff',
      '#880000',
      '#aaffee',
      '#cc44cc',
      '#00cc55',
      '#0000aa',
      '#eeee77',
      '#dd8855',
      '#664400',
      '#ff7777',
      '#333333',
      '#777777',
      '#aaff66',
      '#0088ff',
      '#bbbbbb',
    ],
    hint: 'All sixteen Commodore 64 colours.',
  },
  {
    id: 'pico8',
    label: 'PICO-8',
    colors: [
      '#000000',
      '#1d2b53',
      '#7e2553',
      '#008751',
      '#ab5236',
      '#5f574f',
      '#c2c3c7',
      '#fff1e8',
      '#ff004d',
      '#ffa300',
      '#ffec27',
      '#00e436',
      '#29adff',
      '#83769c',
      '#ff77a8',
      '#ffccaa',
    ],
    hint: 'Sixteen modern indie-game colours, balanced to sit together.',
  },
  {
    id: 'nes',
    label: 'NES',
    colors: [
      '#000000',
      '#fcfcfc',
      '#f8f8f8',
      '#bcbcbc',
      '#7c7c7c',
      '#a4e4fc',
      '#3cbcfc',
      '#0078f8',
      '#0000fc',
      '#b8b8f8',
      '#6888fc',
      '#0058f8',
      '#d8b8f8',
      '#9878f8',
      '#6844fc',
      '#f8b8f8',
      '#f878f8',
      '#d800cc',
      '#f8a4c0',
      '#f85898',
      '#e40058',
      '#f0d0b0',
      '#f87858',
      '#f83800',
      '#fce0a8',
      '#fca044',
      '#e45c10',
      '#f8d878',
      '#f8b800',
      '#ac7c00',
      '#d8f878',
      '#b8f818',
      '#00b800',
      '#b8f8b8',
      '#58d854',
      '#00a800',
      '#b8f8d8',
      '#58f898',
      '#00a844',
      '#00fcfc',
      '#00e8d8',
      '#008888',
    ],
    hint: 'A working subset of the NES master palette.',
  },
  {
    id: 'amber',
    label: 'Amber',
    colors: ['#0d0700', '#5c3600', '#b37000', '#ffb000'],
    hint: 'An amber phosphor terminal, in four steps.',
  },
  {
    id: 'phosphor',
    label: 'Phosphor',
    colors: ['#001100', '#00380d', '#00a63a', '#4dff88'],
    hint: 'Green phosphor, the colour every terminal was before they were beige.',
  },
  {
    id: 'source',
    label: 'Source',
    colors: [],
    hint: "No palette. Dithers against the image's own colours.",
  },
]

const BY_ID = new Map(PALETTES.map((p) => [p.id, p]))

export function getPalette(id: PaletteId): Palette {
  return BY_ID.get(id) ?? PALETTES[0]
}

export type RGB = [number, number, number]

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** A palette as flat RGB triples, ready for the inner loop. */
export function paletteRGB(id: PaletteId, custom?: string[]): RGB[] {
  if (custom && custom.length > 0) return custom.map(hexToRgb)
  return getPalette(id).colors.map(hexToRgb)
}

/**
 * Nearest palette entry to a colour.
 *
 * Squared distance in plain RGB, deliberately. Perceptual spaces pick a
 * "better" neighbour by the numbers and a worse one by eye here, because
 * dithering is not trying to match a colour, it is trying to leave an error
 * small enough for the next pixel to carry. Plain RGB keeps that error in the
 * same space the diffusion arithmetic is done in, which is what stops the
 * classic magenta cast on skin tones.
 */
export function nearest(pal: RGB[], r: number, g: number, b: number): RGB {
  let best = pal[0]
  let bestD = Infinity
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i]
    const dr = r - p[0]
    const dg = g - p[1]
    const db = b - p[2]
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}
