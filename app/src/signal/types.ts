/**
 * The Signal document.
 *
 * Signal is the one tool in the suite with no source material. Everything on
 * screen is computed, every frame, from a field function and a clock. That one
 * fact is what makes it a separate document rather than a mode of ASCII next
 * door: there is no asset to hold, no grid cut from an image, and a time axis
 * that the ASCII doc deliberately does not have.
 *
 * The pipeline is three stages, and the document is organised as those stages
 * rather than as a flat bag of sliders:
 *
 *   generate   a `field` writes a Float32Array of 0..1 luminance, or a
 *              `figure` draws vectors straight to the canvas
 *   quantize   the field is dithered to one bit and mapped onto ink, paper
 *              and accent
 *   finish     the assembled frame goes through the post chain
 *
 * Only the first stage differs between the two effect families, which is why
 * `source.kind` sits at the top: it decides which half of the pipeline runs,
 * and the panel hides the controls the other half would have wanted.
 */

import type { FxChain } from '../lib/postfx'

/**
 * Which generator makes the frame.
 *
 * 'field' effects are pure functions over a luminance buffer, so they can be
 * dithered, recoloured, exported as a still, and serialised into an embed. They
 * are the reason the tool exists.
 *
 * 'figure' effects draw with the 2D context directly: strokes, glyphs, points.
 * They cannot be dithered because there is no buffer to dither, so the whole
 * quantize stage is skipped and they take their colours from the same palette
 * by drawing with it.
 */
export type SourceKind = 'field' | 'figure'

/**
 * The ordered masks a field is thresholded against.
 *
 * Deliberately a smaller set than the thirteen algorithms in
 * `ascii/dither.ts`. Every one of these is a *pure function of position*, which
 * is what lets a field be dithered without a serial pass over the frame. Error
 * diffusion is excluded on purpose: Floyd-Steinberg has to walk the buffer in
 * order, carrying a remainder, and at 1920x1080x60fps that is the difference
 * between a tool that runs and one that stutters. The ASCII tool, which renders
 * one still frame, is where diffusion belongs.
 */
export type MaskId =
  | 'bayer2'
  | 'bayer4'
  | 'bayer8'
  | 'halftone'
  | 'blue-noise'
  | 'crosshatch'
  | 'diamond'
  | 'spiral'
  | 'lines'
  | 'none'

/**
 * How the accent colour is worked into a two-tone picture.
 *
 * The accent lives in a band of luminance around the midpoint rather than being
 * painted somewhere specific, which is what makes it read as part of the image
 * instead of a sticker on top of it. `mix` is the width of that band.
 *
 *   blend    the accent fades in and out across the band, quadratically
 *   hard     the whole band becomes flat accent, which posterises the midtones
 *   pattern  only the lit dither pixels take the accent, so the accent
 *            inherits the mask's texture and the paper shows between
 */
export type AccentMode = 'blend' | 'hard' | 'pattern'

/** What a cell becomes when the mask is 'none' and glyphs are asked for instead. */
export type GlyphMode = 'off' | 'ramp' | 'custom'

export interface SignalSource {
  kind: SourceKind
  /** stable id into FIELDS or FIGURES, never a display name */
  id: string
  /** 0..100, how hard the generator is driven; every effect reads it */
  intensity: number
  /** 0.5..12, the spatial frequency of the generator */
  scale: number
  /** 0..4, multiplier on the clock */
  speed: number
  /**
   * The current generator's own controls.
   *
   * Three shared knobs is what the reference tool gives every effect, and it
   * is why half of its library barely responds to any of them: a Chladni plate
   * wants its two mode numbers, an attractor wants its four coefficients, and
   * neither has any use for a single "scale". So a generator declares the
   * controls it actually has and the panel draws those, keyed by name.
   *
   * Kept sparse. Absent means "the generator's default", so a document only
   * carries what has been moved, switching generator does not have to
   * migrate anything, and a preset patch stays small.
   */
  params: Record<string, number>
}

/**
 * The parameters only some generators want.
 *
 * DotForge, which this tool learns from, gates these behind a hardcoded list of
 * effect display names near the top of its app file. Rename an effect and the
 * text box silently stops appearing. Here every generator declares what it
 * reads (see `uses` in `fields.ts` and `figures.ts`) and the panel asks the
 * generator, so the two can never disagree.
 */
export interface SignalMotion {
  /** degrees */
  rotateX: number
  rotateY: number
  rotateZ: number
  /** degrees per second added to Y while playing */
  autoSpin: number
  /** 0..1, collapses the Z axis toward a flat projection */
  flatten: number
  text: string
}

export interface SignalQuantize {
  mask: MaskId
  /** 0..255, the luminance a cell has to beat to light up */
  threshold: number
  /** 0..100, how far the mask is allowed to push a value either side */
  spread: number
  /** 1..16, source pixels per dithered block */
  pixelSize: number
  /**
   * 0..100, per-block variation in pixel size.
   *
   * Hashed from block coordinates rather than rolled, so the irregular grid is
   * the same irregular grid in the export as it was in the preview.
   */
  randomness: number
  glyphs: GlyphMode
  /** used when `glyphs` is 'custom', darkest character last */
  ramp: string
  /**
   * 1..4. How coarsely the luminance field is sampled before it is dithered.
   *
   * The single most useful performance control in the tool, and it costs almost
   * nothing visually, because of what a dither actually is. The *mask* is what
   * you see: a hard grid of lit and unlit pixels, and that always runs at full
   * resolution. The *field* underneath it is a smooth, low-frequency thing, and
   * sampling it every second or third pixel and interpolating between changes
   * almost nothing about where the threshold lands.
   *
   * At 2 it is a quarter of the field arithmetic, at 3 a ninth. On a per-pixel
   * generator at 1080p that is the difference between a preview at six frames a
   * second and one at forty.
   *
   * It applies to the export too, deliberately. A control that quietly made the
   * file different from the preview would be the one thing this tool has been
   * careful not to do anywhere else.
   */
  detail: number
}

export interface SignalInk {
  /** what the lit pixels become */
  ink: string
  /** what the unlit pixels become */
  paper: string
  accent: string
  /** 0..100, the width of the luminance band the accent occupies */
  mix: number
  mode: AccentMode
  /** id into PALETTES, or 'none' when the colours were set by hand */
  palette: string
}

export interface SignalCanvasSpec {
  width: number
  height: number
  /**
   * Frames per second the preview is allowed to run at.
   *
   * A cap, not a target. The whole pipeline is on the main thread, and at 1080p
   * with a long post chain a machine will happily spend every millisecond it
   * has on this and leave none for the panel to respond in. 0 means uncapped.
   */
  fpsCap: number
  /** seconds of video an export produces */
  duration: number
  /**
   * How the preview is sized.
   *
   * 'exact' renders the preview at the document's own resolution, so what is on
   * screen is the exported frame pixel for pixel. That is the honest default
   * and it is unaffordable at scale: the canvas is CSS-scaled down to fit the
   * window anyway, so a 1920x1080 document spends four times the work of what
   * the screen can show, and a per-pixel field lands at single-digit frames.
   *
   * 'fit' renders at the size the canvas is actually displayed at. Four times
   * cheaper at 1080p, and the difference is only ever in the dither: the mask
   * is measured in pixels, so a preview at half size lays down a coarser grid
   * than the file will. The panel says so rather than hiding it.
   *
   * The export is unaffected either way. It always renders at the document's
   * own size, through the same function.
   */
  preview: 'exact' | 'fit'
}

export interface SignalDoc {
  version: 1
  name: string
  source: SignalSource
  motion: SignalMotion
  quantize: SignalQuantize
  ink: SignalInk
  canvas: SignalCanvasSpec
  fx: FxChain
}

export function defaultSignalDoc(): SignalDoc {
  return {
    version: 1,
    name: 'Untitled',
    source: { kind: 'field', id: 'warp', intensity: 55, scale: 4, speed: 0.6, params: {} },
    motion: { rotateX: 30, rotateY: 0, rotateZ: 0, autoSpin: 30, flatten: 0, text: 'RIBBIT' },
    quantize: {
      mask: 'bayer4',
      threshold: 128,
      spread: 50,
      pixelSize: 2,
      randomness: 0,
      glyphs: 'off',
      ramp: ' .:-=+*#%@',
      detail: 2,
    },
    ink: {
      ink: '#f7f8f8',
      paper: '#08090a',
      accent: '#5e6ad2',
      mix: 0,
      mode: 'blend',
      palette: 'none',
    },
    canvas: { width: 1024, height: 1024, fpsCap: 60, duration: 6, preview: 'fit' },
    fx: {},
  }
}

/**
 * Bring a saved document up to the shape this build expects.
 *
 * Every group on the document is flat, so one level of spreading over the
 * defaults is enough: anything the saved copy has wins, anything it lacks
 * arrives from `defaultSignalDoc()`.
 *
 * This exists because it was needed, and the failure it prevents is worth
 * writing down. Adding `source.params` shipped a build where a document saved
 * an hour earlier had no `params` key, the panel read `params.arms` off
 * undefined during render, and React unmounted the whole app: a black screen
 * for the entire suite, from one stale field in one tool's document. A
 * try/catch in `hydrate` would not have caught it, because nothing threw until
 * the first render.
 *
 * So the rule is that a document is normalised on the way in, once, rather than
 * every reader being asked to tolerate a missing key. New fields can be added
 * to `SignalDoc` without a thought after this.
 */
export function migrateDoc(saved: unknown): SignalDoc | null {
  if (!saved || typeof saved !== 'object') return null
  const d = saved as Partial<SignalDoc>
  // a document from a future major version is not something to guess at
  if (d.version !== 1) return null

  const base = defaultSignalDoc()
  return {
    ...base,
    ...d,
    version: 1,
    source: {
      ...base.source,
      ...(d.source ?? {}),
      params: { ...(d.source?.params ?? {}) },
    },
    motion: { ...base.motion, ...(d.motion ?? {}) },
    quantize: { ...base.quantize, ...(d.quantize ?? {}) },
    ink: { ...base.ink, ...(d.ink ?? {}) },
    canvas: { ...base.canvas, ...(d.canvas ?? {}) },
    fx: { ...(d.fx ?? {}) },
  }
}

/**
 * The resolutions offered, and the only place they are written down.
 *
 * The canvas backing store is set to the true output size and scaled down with
 * CSS to fit the viewport, so what is on screen is the export at 1:1 rather
 * than a preview of it. There is no export-scale multiplier anywhere in this
 * tool for that reason: changing the resolution changes the picture, because a
 * dither pattern is measured in pixels and always has been.
 */
export const CANVAS_PRESETS: { id: string; label: string; width: number; height: number }[] = [
  { id: 'sq-512', label: '512 square', width: 512, height: 512 },
  { id: 'sq-800', label: '800 square', width: 800, height: 800 },
  { id: 'sq-1024', label: '1024 square', width: 1024, height: 1024 },
  { id: 'hd', label: '1920 × 1080', width: 1920, height: 1080 },
  { id: 'story', label: '1080 × 1920', width: 1080, height: 1920 },
  { id: 'wide', label: '1600 × 900', width: 1600, height: 900 },
]

/** Total pixels a frame costs, which is what the panel warns about. */
export function frameCost(doc: SignalDoc) {
  return doc.canvas.width * doc.canvas.height
}
