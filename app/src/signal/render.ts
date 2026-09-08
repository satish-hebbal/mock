/**
 * One frame.
 *
 * This is the only function in the tool that turns a document and a time into
 * pixels, and the preview, the still export and every frame of a video all call
 * it. There is no second path, so there is nothing for the preview and the file
 * to disagree about.
 *
 * The canvas is always the document's own size. Nothing is rendered at a
 * preview resolution and scaled up for export, and there is no export
 * multiplier: a dither pattern is measured in pixels, so drawing the same
 * document at twice the size is a different picture, not a bigger copy of the
 * same one. The preview handles this by rendering at full size and letting CSS
 * scale the element down, which means what is on screen is the export at 1:1.
 *
 * The field buffer is module state, reused between calls and regrown only when
 * the document changes size. At 1080p it is eight megabytes, and allocating
 * that sixty times a second is not something a garbage collector forgives.
 */

import { applyFx, type FxContext } from '../lib/postfx'
import { FIELD_BY_ID, resolveParams, type FieldFn } from './fields'
import { FIGURE_BY_ID, figureInk } from './figures'
import { ditherAndPaint, paintGlyphs, releaseBuffers } from './quantize'
import type { SignalDoc } from './types'

let field = new Float32Array(0)
let fieldW = 0
let fieldH = 0

/** The full-size luminance buffer the dither reads. */
function fieldBuffer(w: number, h: number) {
  if (fieldW !== w || fieldH !== h) {
    field = new Float32Array(w * h)
    fieldW = w
    fieldH = h
    // the dither and image buffers next door are sized to the same frame, so
    // they are stale for exactly the same reason
    releaseBuffers()
  }
  return field
}

let coarse = new Float32Array(0)
let coarseW = 0
let coarseH = 0

/** The reduced buffer a field is actually generated into when detail > 1. */
function coarseBuffer(w: number, h: number) {
  if (coarseW !== w || coarseH !== h) {
    coarse = new Float32Array(w * h)
    coarseW = w
    coarseH = h
  }
  return coarse
}

/**
 * Generate the field, coarsely if asked, and leave it full size.
 *
 * The generator is handed a smaller buffer and smaller dimensions, which works
 * because a field describes a picture rather than a bitmap: almost every one of
 * them normalises by w and h, so asking for a third of the width gives the same
 * image at a third of the resolution rather than a third of the image.
 *
 * The fill back up is bilinear, on purpose. Nearest-neighbour would step the
 * luminance in blocks, the threshold would land on those block edges, and the
 * dither would grow a visible grid of exactly the wrong period. Interpolating
 * keeps the field smooth, which is the one property the dither depends on.
 */
function generateField(
  spec: { params?: unknown; fn: FieldFn },
  doc: SignalDoc,
  w: number,
  h: number,
  t: number,
  step: number,
) {
  const full = fieldBuffer(w, h)
  const p = resolveParams(spec.params as never, doc.source.params)
  const { intensity, scale } = doc.source

  if (step <= 1) {
    spec.fn(full, w, h, t, intensity, scale, p)
    return full
  }

  const cw = Math.max(2, Math.ceil(w / step))
  const ch = Math.max(2, Math.ceil(h / step))
  const small = coarseBuffer(cw, ch)
  spec.fn(small, cw, ch, t, intensity, scale, p)

  // map full-resolution pixels back onto the coarse grid and interpolate
  const sx = (cw - 1) / Math.max(1, w - 1)
  const sy = (ch - 1) / Math.max(1, h - 1)
  for (let y = 0; y < h; y++) {
    const gy = y * sy
    const j0 = Math.min(ch - 2, gy | 0)
    const fy = gy - j0
    const row = j0 * cw
    const next = row + cw
    for (let x = 0; x < w; x++) {
      const gx = x * sx
      const i0 = Math.min(cw - 2, gx | 0)
      const fx = gx - i0
      const a = small[row + i0]
      const b = small[row + i0 + 1]
      const c = small[next + i0]
      const d = small[next + i0 + 1]
      full[y * w + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
    }
  }
  return full
}

/**
 * A canvas to draw a frame into.
 *
 * Exported so the video encoder can hold one canvas for the whole run rather
 * than making a new one per frame, which matters: `CanvasSource` in mediabunny
 * binds to a specific element.
 */
export function makeFrameCanvas(doc: SignalDoc) {
  const canvas = document.createElement('canvas')
  canvas.width = doc.canvas.width
  canvas.height = doc.canvas.height
  return canvas
}

export interface RenderOptions {
  /**
   * Render at this size instead of the document's own.
   *
   * The preview uses it to draw at the size the canvas is actually displayed
   * at, which is where most of the frame budget went before: a 1080p document
   * shown in a 700px box was computing four pixels for every one anybody could
   * see. Nothing else passes it, so every export is the document's own size.
   */
  size?: { width: number; height: number }
  /**
   * Skip the post chain.
   *
   * Used by the embed-code preview, which has no way to run the chain in the
   * snippet it generates and should not show a picture the snippet cannot
   * produce.
   */
  skipFx?: boolean
}

/**
 * Draw `doc` at time `t` (seconds) into `canvas`.
 *
 * `t` is the already-scaled clock: the caller multiplies elapsed time by
 * `source.speed`, so that speed is a property of playback rather than something
 * every one of fifty-one generators has to remember to apply.
 */
export function renderSignal(
  doc: SignalDoc,
  t: number,
  canvas: HTMLCanvasElement,
  opts: RenderOptions = {},
) {
  const w = Math.max(1, Math.round(opts.size?.width ?? doc.canvas.width))
  const h = Math.max(1, Math.round(opts.size?.height ?? doc.canvas.height))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const { source, quantize, ink, motion } = doc

  if (source.kind === 'figure') {
    const spec = FIGURE_BY_ID.get(source.id)
    if (spec) {
      const p = resolveParams(spec.params, source.params)
      spec.fn(ctx, w, h, t, source.intensity, source.scale, figureInk(ink), motion, p)
    } else {
      // an unknown id means a preset from a future version, or a hand-edited
      // document. Paint the paper rather than leaving whatever was there.
      ctx.fillStyle = ink.paper
      ctx.fillRect(0, 0, w, h)
    }
  } else {
    const spec = FIELD_BY_ID.get(source.id)
    let buf: Float32Array
    if (spec) {
      /*
       * The preview may be drawing smaller than the document, and the detail
       * step is expressed against the document. Scaling it down keeps the
       * field's own resolution the same fraction of the picture either way, so
       * a fitted preview is a smaller copy rather than a coarser one.
       */
      const step = Math.max(1, Math.round(quantize.detail * (w / doc.canvas.width)))
      buf = generateField(spec, doc, w, h, t, step)
    } else {
      buf = fieldBuffer(w, h)
      buf.fill(0)
    }

    if (quantize.glyphs !== 'off') {
      paintGlyphs(ctx, buf, w, h, quantize, ink)
    } else {
      ctx.putImageData(ditherAndPaint(buf, w, h, quantize, ink), 0, 0)
    }
  }

  if (!opts.skipFx) {
    /*
     * `scale` is the ratio of what is being drawn to what the document says,
     * which is 1 for every export and less than 1 for a fitted preview. It is
     * what keeps a scan line the same thickness relative to the picture at both
     * sizes, so the preview is a smaller copy rather than a differently
     * textured one.
     */
    const fxCtx: FxContext = { scale: w / doc.canvas.width, time: t }
    applyFx(canvas, doc.fx, fxCtx)
  }
}

/** Seconds of document time at frame `i` of an export, honouring speed. */
export function frameTime(doc: SignalDoc, i: number, fps: number) {
  return (i / fps) * doc.source.speed
}

/** How many frames an export of this document produces. */
export function frameCount(doc: SignalDoc, fps: number) {
  return Math.max(1, Math.round(doc.canvas.duration * fps))
}
