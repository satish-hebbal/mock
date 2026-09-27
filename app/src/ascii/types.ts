/**
 * The ASCII document.
 *
 * One source image, one grid laid over it, and one painter that decides what a
 * cell becomes. Everything in this file is a *description* of the picture, not
 * a picture: the renderer in `render.ts` is the only thing that turns it into
 * pixels, and it is the same function for the preview and for the export, so
 * there is no second implementation to drift.
 *
 * The grid is deliberately resolution-free. `size` is the document's own
 * canvas, `grid.cell` is measured in that space, and the column and row counts
 * fall out of the two. Exporting at 3x does not re-cut the grid, it draws the
 * same characters larger, which is why a 4x PNG is the picture you framed
 * rather than a different one with four times as many glyphs in it.
 */

import { defaultMesh, type MeshSpec } from '../lib/meshGradient'
import type { FxChain } from '../lib/postfx'
import type { ParamBag } from './params'

/**
 * What a cell becomes.
 *
 * Four families, and the family is what decides which controls apply:
 *
 *   glyph   text drawn from a ramp, so it can also leave as .txt or ANSI
 *   shape   a mark drawn per cell, sized by how dark the cell is
 *   raster  a solid tile, coloured from the source rather than from a ramp
 *   process the whole frame at once, because error diffusion is sequential
 */
export type AsciiStyleId =
  | 'characters'
  | 'blocks'
  | 'braille'
  | 'dots'
  | 'lines'
  | 'diagonals'
  | 'cross'
  | 'diamond'
  | 'mixed'
  | 'pixel'
  | 'mosaic'
  | 'lego'
  | 'voxel'
  | 'dither'
  // type
  | 'contour'
  | 'rain'
  | 'typeset'
  // marks
  | 'rings'
  | 'hexes'
  | 'triangles'
  | 'stipple'
  | 'hatch'
  | 'waves'
  | 'strokes'
  | 'weave'
  | 'stars'
  | 'hearts'
  | 'bars'
  // tiles
  | 'honeycomb'
  | 'led'
  | 'facets'
  | 'leadlight'
  | 'neon'
  | 'knit'
  | 'beads'
  | 'terrace'
  // print and paint, whole-frame
  | 'halftone'
  | 'riso'
  | 'mezzotint'
  | 'engrave'
  | 'woodcut'
  | 'sketch'
  | 'comic'
  | 'oil'
  | 'watercolor'
  | 'crystal'
  | 'topo'
  | 'pointil'
  | 'popart'
  | 'poster'
  | 'thermal'
  | 'cyanotype'
  | 'pixelsort'
  | 'relief'
  | 'glowedge'
  | 'anaglyph'
  | 'blueprint'

export type RampId =
  | 'standard'
  | 'detailed'
  | 'minimal'
  | 'blocks'
  | 'shades'
  | 'binary'
  | 'ink'
  | 'dots'
  | 'bars'
  | 'numeric'
  | 'alpha'
  | 'hacker'
  | 'math'
  | 'arrows'
  | 'geometric'
  | 'box'
  | 'stars'
  | 'katakana'
  | 'runes'
  | 'custom'

/**
 * Where a cell's colour comes from.
 *
 * 'ink' is one colour for the whole picture, which is the terminal look and the
 * only mode where the result is honestly monochrome. 'source' takes each cell's
 * own average, which is what makes a photograph still read as that photograph.
 * 'duotone' ramps between two colours by brightness, which is the poster look.
 */
export type ColorMode = 'ink' | 'source' | 'duotone' | 'gradient' | 'spectrum'

/**
 * How the finished marks land on the backdrop.
 *
 * Distinct from the tint's blend, which colours the marks themselves. This is
 * the marks *against* what is behind them, which is where "glowing type on a
 * photograph" comes from: screen them and the dark cells vanish into the
 * picture instead of sitting on it.
 */
export type CompositeId =
  | 'source-over'
  | 'screen'
  | 'lighter'
  | 'overlay'
  | 'soft-light'
  | 'multiply'
  | 'color-dodge'
  | 'difference'

/** What sits behind the art. */
export type BackdropMode = 'paper' | 'source' | 'blurred' | 'mesh' | 'transparent'

export type DitherAlgo =
  | 'floyd-steinberg'
  | 'atkinson'
  | 'stucki'
  | 'sierra-lite'
  | 'burkes'
  | 'bayer2'
  | 'bayer4'
  | 'bayer8'
  | 'bayer16'
  | 'blue-noise'
  | 'halftone'
  | 'hatch'
  | 'threshold'

export type PaletteId =
  | 'bw'
  | 'gameboy'
  | 'c64'
  | 'nes'
  | 'pico8'
  | 'cga'
  | 'amber'
  | 'phosphor'
  | 'gray4'
  | 'gray8'
  | 'rgb8'
  | 'cga1'
  | 'arcade'
  | 'vapor'
  | 'sepia'
  | 'ice'
  | 'ember'
  | 'source'

/**
 * How brightness becomes ink.
 *
 * These are the whole mapping, applied in the order written: level the
 * exposure, bend the midtones, decide how much of the ramp is allowed to be
 * used, then let edges push cells darker than their brightness alone would.
 * `density` is the one that surprises people, so it is worth naming plainly:
 * it is the floor under which a cell is left empty, which is what keeps a
 * bright sky from filling with faint punctuation.
 */
export interface AsciiTone {
  /** -100..100, added to luminance */
  brightness: number
  /** 0..200, 100 is neutral */
  contrast: number
  /** 0.2..3, midtone bend */
  gamma: number
  /** 0..1, how much of the ramp the darkest cell is allowed to reach */
  coverage: number
  /** 0..1, ink level below which a cell stays blank */
  density: number
  /** 0..1, how hard a Sobel edge darkens its cell */
  edge: number
  /** swap which end of the ramp the light goes to */
  invert: boolean
}

export interface AsciiGrid {
  /** cell width, in document pixels */
  cell: number
  /**
   * cell height / cell width.
   *
   * A monospace character cell is about 1.8 times as tall as it is wide, and
   * ignoring that is the single most common way ASCII art comes out stretched.
   * Square styles (pixel, mosaic, LEGO) override it to 1 in `styles.ts` rather
   * than asking the document to remember two numbers.
   */
  aspect: number
  /** 0..1, how often a cell takes a neighbouring glyph instead of its own */
  jitter: number
  /** 0..0.5 of the cell left unpainted, the grout between tiles */
  gap: number
}

export type BlendId =
  | 'normal'
  | 'multiply'
  | 'overlay'
  | 'screen'
  | 'color'
  | 'hue'
  | 'saturation'
  | 'luminosity'
  | 'soft-light'
  | 'hard-light'
  | 'color-burn'
  | 'color-dodge'

export interface AsciiColor {
  mode: ColorMode
  ink: string
  paper: string
  /** the bright end of a duotone; `ink` is the dark end */
  ink2: string
  tint: string
  /** 0..1 */
  tintOpacity: number
  blend: BlendId
  /** 0..2 */
  saturation: number
  /** 0..1 */
  grayscale: number
  /** 0..1, how solid the marks are over whatever is behind them */
  opacity: number
  /** id into COLOR_PRESETS, or 'none' */
  preset: string
  /** id into GRADIENTS, for the 'gradient' mode */
  gradient: string
  /** 0..360, where the spectrum mode starts its wheel */
  hue: number
  /** how the art layer composites over the backdrop */
  composite: CompositeId
}

export interface AsciiDither {
  algo: DitherAlgo
  palette: PaletteId
  /** every other row scanned right to left, which hides the diagonal drift */
  serpentine: boolean
  /** 0..1, how much of each cell's error is passed on */
  amount: number
  /** 1..12, source pixels per dithered pixel */
  scale: number
}

export interface AsciiBackdrop {
  mode: BackdropMode
  /** blur radius in document pixels, for 'blurred' */
  blur: number
  /** 0..1 */
  opacity: number
  color: string
  mesh: MeshSpec
}

/**
 * The finishing pass.
 *
 * Every one of these is 0..1 and every one of them is off at 0, so a document
 * with no effects costs nothing: `render.ts` skips the whole stage rather than
 * running seven no-ops over the frame.
 */
export interface AsciiFx {
  vignette: number
  scanlines: number
  curvature: number
  bloom: number
  chromatic: number
  grain: number
  glitch: number
}

/**
 * What the pointer does to the preview.
 *
 * Preview only. None of the exporters read this: a PNG has no cursor, and
 * baking one pointer position into a still would be a different feature. It
 * lives on the document anyway so a look that depends on it travels with the
 * look, through undo, presets and the saved file.
 */
export interface AsciiCursor {
  mode: 'off' | 'scatter'
  /** reach of the disturbance, in document pixels */
  radius: number
  /** 0..1, how far a cell at the centre can be thrown, as a share of the radius */
  strength: number
}

export function defaultCursor(): AsciiCursor {
  return { mode: 'off', radius: 180, strength: 0.5 }
}

/**
 * One filter in the stack run over the source before the style sees it.
 *
 * The reference tools make every treatment a style of its own, so a twirl and a
 * halftone can never meet. Here they are layers: warp the photograph, blur its
 * background, grade it, and *then* cut it into characters. `uid` is the layer's
 * identity for reordering and for React, not the filter; two twirls are fine.
 */
export interface AsciiLayer {
  uid: string
  /** id into FILTERS */
  kind: string
  on: boolean
  params: ParamBag
}

/**
 * Where the treatment shows.
 *
 * 'spot' is a circle you drag round the picture, 'split' a straight wipe, and
 * 'band' a strip across it. Outside the region the untreated photograph shows
 * through, which is how a before-and-after is made in one frame, and `invert`
 * swaps which side is which.
 */
export interface AsciiReveal {
  mode: 'off' | 'spot' | 'split' | 'band'
  /** 0..1 of the frame */
  x: number
  y: number
  /** 0..1 of the frame's diagonal; the spot's radius or the band's half width */
  size: number
  /** 0..1 of `size`, how soft the boundary is */
  feather: number
  /** degrees, for split and band */
  angle: number
  invert: boolean
}

export function defaultReveal(): AsciiReveal {
  return { mode: 'off', x: 0.5, y: 0.5, size: 0.28, feather: 0.35, angle: 0, invert: false }
}

export interface AsciiDoc {
  version: 1
  name: string
  /** the one source image, by asset id */
  assetId: string | null
  /**
   * Which shipped preset the source came from, if it came from one.
   *
   * The picture itself is already an asset like any other by the time it is
   * here, so this is not how it is loaded: it is only so the picker can tick
   * the one you are looking at. A dropped file clears it.
   */
  presetId: string | null
  size: { width: number; height: number }
  style: AsciiStyleId
  ramp: RampId
  /** used when `ramp` is 'custom', lightest character first */
  customRamp: string
  grid: AsciiGrid
  tone: AsciiTone
  color: AsciiColor
  dither: AsciiDither
  backdrop: AsciiBackdrop
  fx: AsciiFx
  cursor: AsciiCursor
  /** settings for styles that have more than the shared grid, keyed by style */
  styleParams: Partial<Record<AsciiStyleId, ParamBag>>
  /** filters over the source, run top to bottom before the style */
  layers: AsciiLayer[]
  /** the rest of the shared finishing chain, beyond the seven named in `fx` */
  finish: FxChain
  reveal: AsciiReveal
}

export function defaultAsciiDoc(): AsciiDoc {
  return {
    version: 1,
    name: 'Untitled',
    assetId: null,
    presetId: null,
    size: { width: 1600, height: 1200 },
    style: 'characters',
    ramp: 'standard',
    customRamp: ' .:-=+*#%@',
    grid: { cell: 11, aspect: 1.8, jitter: 0, gap: 0 },
    tone: {
      brightness: 0,
      contrast: 100,
      gamma: 1,
      coverage: 0.85,
      density: 0.02,
      edge: 0,
      invert: false,
    },
    color: {
      mode: 'source',
      ink: '#f7f8f8',
      paper: '#08090a',
      ink2: '#5e6ad2',
      tint: '#5e6ad2',
      tintOpacity: 0,
      blend: 'overlay',
      saturation: 1,
      grayscale: 0,
      opacity: 1,
      preset: 'none',
      gradient: 'thermal',
      hue: 0,
      composite: 'source-over',
    },
    dither: {
      algo: 'floyd-steinberg',
      palette: 'bw',
      serpentine: true,
      amount: 1,
      scale: 3,
    },
    /*
     * The source photograph at a third strength, not flat paper.
     *
     * Characters on a plain ground is the austere version of this effect and a
     * poor first impression of it: the grid throws away most of the picture's
     * tone, so a portrait lands as a grey mass with nothing underneath to say
     * what it was. A faint print of the original behind the glyphs puts the
     * subject back without competing with them, and it is the setting almost
     * everybody arrived at by hand anyway. Thirty per cent is where the picture
     * reads and the characters still carry the image rather than decorate it.
     */
    backdrop: { mode: 'source', blur: 24, opacity: 0.3, color: '#08090a', mesh: defaultMesh() },
    fx: { vignette: 0, scanlines: 0, curvature: 0, bloom: 0, chromatic: 0, grain: 0, glitch: 0 },
    cursor: defaultCursor(),
    styleParams: {},
    layers: [],
    finish: {},
    reveal: defaultReveal(),
  }
}

/**
 * Bring a saved or shared document up to the current shape.
 *
 * Every field added since version 1 is optional on the way in and filled here,
 * so a document from before layers existed opens as the same picture with an
 * empty stack rather than failing a type check nobody can see.
 */
export function normalizeDoc(doc: AsciiDoc): AsciiDoc {
  const base = defaultAsciiDoc()
  doc.presetId = doc.presetId ?? null
  doc.cursor = doc.cursor ?? defaultCursor()
  doc.color = { ...base.color, ...doc.color }
  doc.styleParams = doc.styleParams ?? {}
  doc.layers = Array.isArray(doc.layers) ? doc.layers : []
  doc.finish = doc.finish ?? {}
  doc.reveal = { ...defaultReveal(), ...doc.reveal }
  return doc
}

/**
 * Column and row counts implied by the document.
 *
 * Defined here and nowhere else. The renderer, the text exporter and the panel
 * readout all call this, so the number of characters quoted under the canvas is
 * by construction the number of characters in the file.
 */
export function gridSize(doc: AsciiDoc, squareCells: boolean) {
  const cw = Math.max(2, doc.grid.cell)
  const ch = Math.max(2, cw * (squareCells ? 1 : doc.grid.aspect))
  return {
    cols: Math.max(1, Math.round(doc.size.width / cw)),
    rows: Math.max(1, Math.round(doc.size.height / ch)),
  }
}
