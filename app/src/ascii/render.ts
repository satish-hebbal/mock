/**
 * The renderer.
 *
 * `paintArt` is the one description of what a cell style looks like, and it
 * draws onto a `Surface` rather than onto a canvas. Everything else here is the
 * canvas path: `renderAscii` gives it a canvas backend and gets pixels, and
 * `svg.ts` gives it a vector backend and gets elements. Neither knows anything
 * the other does not.
 *
 * The pipeline, in order, and the order is the result:
 *
 *   layers    the filter stack over the photograph (`layers.ts`)
 *   style     cells through a painter, or the whole frame through a process
 *   colour    saturation, grayscale and tint, on the art layer alone
 *   composite the art over the backdrop, in the chosen blend
 *   reveal    the untreated photograph shown back through outside a region
 *   finish    the shared post chain, over everything
 *
 * Everything positional is derived from `scale`, the ratio of output width to
 * document width, so a blur radius, a scan line gap and a stud highlight all
 * grow with the picture instead of staying a fixed number of pixels and
 * quietly becoming invisible at 4x.
 */

import { paintMeshGradient } from '../lib/meshGradient'
import { ditherImage } from './dither'
import { gradientLut, hsl } from './gradients'
import { prepareSource } from './layers'
import { paletteRGB, type RGB } from './palettes'
import { PAINTERS, type CellCtx, type PainterEnv } from './painters'
import type { CellField } from './cursor'
import { resolve } from './params'
import { cover } from './pixels'
import { applyFx, hasFx } from './postfx'
import { PROCESSES } from './process'
import { rampChars, getRamp } from './ramps'
import { applyToneToPixels, sampleGrid, toInk, type CellGrid, type Levels } from './sample'
import { getStyle } from './styles'
import { CanvasSurface, MONO, type Surface } from './surface'
import { gridSize, type AsciiDoc } from './types'

export interface AsciiRender {
  canvas: HTMLCanvasElement
  /** the grid the picture was cut on, for the readout under the canvas */
  cols: number
  rows: number
}

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/** Draw `src` filling `w` x `h`, cropping the overflow. The CSS `cover` rule. */
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number) {
  const s = src as { videoWidth?: number; videoHeight?: number; width?: number; height?: number }
  const sw = s.videoWidth || (s.width as number) || w
  const sh = s.videoHeight || (s.height as number) || h
  if (!sw || !sh) return
  const k = Math.max(w / sw, h / sh)
  const dw = sw * k
  const dh = sh * k
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

export function paintBackdrop(
  ctx: CanvasRenderingContext2D,
  doc: AsciiDoc,
  source: CanvasImageSource | null,
  w: number,
  h: number,
  scale: number,
) {
  const bd = doc.backdrop
  if (bd.mode === 'transparent') return

  if (bd.mode === 'mesh') {
    paintMeshGradient(ctx, w, h, bd.mesh)
    return
  }

  // paper goes down under everything else, so a part-transparent image still
  // has something to sit on rather than showing the checkerboard through
  ctx.fillStyle = bd.color
  ctx.fillRect(0, 0, w, h)

  if (!source || bd.mode === 'paper') return

  ctx.save()
  ctx.globalAlpha = bd.opacity
  if (bd.mode === 'blurred') {
    /*
     * The blur is drawn from a canvas scaled up past the frame, because a
     * `blur()` filter samples transparent black from outside the source and
     * leaves a soft dark border all the way round. Overdrawing by twice the
     * radius pushes that border off the edge of the picture.
     */
    const over = bd.blur * scale * 2
    ctx.filter = `blur(${bd.blur * scale}px)`
    ctx.translate(-over, -over)
    drawCover(ctx, source, w + over * 2, h + over * 2)
  } else {
    drawCover(ctx, source, w, h)
  }
  ctx.restore()
}

/** A uniformly quantised RGB cube, used when the dither palette is 'source'. */
function cubePalette(levels = 4): RGB[] {
  const out: RGB[] = []
  const step = 255 / (levels - 1)
  for (let r = 0; r < levels; r++) {
    for (let g = 0; g < levels; g++) {
      for (let b = 0; b < levels; b++) out.push([r * step, g * step, b * step])
    }
  }
  return out
}

/** The reduced buffer a dither document is really made of, before it is enlarged. */
export function ditherPixels(doc: AsciiDoc, source: CanvasImageSource) {
  const px = Math.max(1, doc.dither.scale)
  const dw = Math.max(1, Math.round(doc.size.width / px))
  const dh = Math.max(1, Math.round(doc.size.height / px))

  const small = makeCanvas(dw, dh)
  const sctx = small.getContext('2d', { willReadFrequently: true })!
  sctx.imageSmoothingEnabled = true
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(source, 0, 0, dw, dh)

  const img = sctx.getImageData(0, 0, dw, dh)
  applyToneToPixels(img, doc.tone)

  /*
   * 'source' is not "no palette", it is a uniformly quantised RGB cube. Which
   * is what makes it useful: dithering against it is a posterise that keeps the
   * picture's own colours, rather than the no-op that skipping the pass would
   * give and that nobody would recognise as a dither setting.
   */
  ditherImage(img, {
    algo: doc.dither.algo,
    palette: doc.dither.palette === 'source' ? cubePalette() : paletteRGB(doc.dither.palette),
    serpentine: doc.dither.serpentine,
    amount: doc.dither.amount,
  })
  return { img, cols: dw, rows: dh }
}

/**
 * The dither path.
 *
 * Reduce first, dither second, enlarge third. The order is the effect: dithering
 * at full resolution and then shrinking averages the pattern straight back into
 * the grey it was invented to avoid, which is the single most common way this
 * comes out looking like noise instead of like a Game Boy.
 */
function renderDither(doc: AsciiDoc, source: CanvasImageSource, w: number, h: number) {
  const { img, cols, rows } = ditherPixels(doc, source)
  const small = makeCanvas(cols, rows)
  small.getContext('2d')!.putImageData(img, 0, 0)

  const art = makeCanvas(w, h)
  const ctx = art.getContext('2d')!
  // nearest neighbour on the way back up, or the whole point is blurred away
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, art.width, art.height)
  return art
}

// ----- whole-frame styles -----

/** Working-resolution ceilings for the whole-frame styles. */
const PROCESS_CAP = { preview: 1400, export: 3200 }

const processCache: { source: CanvasImageSource; key: string; canvas: HTMLCanvasElement }[] = []

/**
 * The process path.
 *
 * Run at a working width rather than at the output width, capped, and then
 * scaled: an oil painting at 6400px would take most of a minute and look the
 * same as one at 3200 enlarged. The tone curve goes on first, the same as it
 * does for dither, so brightness and contrast mean the same thing on every
 * style in the tool.
 */
export function renderProcess(
  doc: AsciiDoc,
  source: CanvasImageSource,
  outW: number,
  outH: number,
  quality: 'preview' | 'export' = 'export',
) {
  const spec = getStyle(doc.style)
  const fn = PROCESSES[doc.style]
  const cap = PROCESS_CAP[quality]
  const k0 = Math.min(1, cap / Math.max(outW, outH))
  const ww = Math.max(1, Math.round(outW * k0))
  const wh = Math.max(1, Math.round(outH * k0))
  const params = resolve(spec.params ?? [], doc.styleParams[doc.style])
  const key = JSON.stringify([doc.style, params, doc.tone, ww, wh, doc.size.width])

  let art = processCache.find((e) => e.source === source && e.key === key)?.canvas
  if (!art) {
    const work = cover(source, ww, wh)
    const wctx = work.getContext('2d', { willReadFrequently: true })!
    const img = wctx.getImageData(0, 0, ww, wh)
    applyToneToPixels(img, doc.tone)
    wctx.putImageData(img, 0, 0)
    art = fn ? fn(work, { k: ww / Math.max(1, doc.size.width), p: params }) : work
    processCache.unshift({ source, key, canvas: art })
    if (processCache.length > 3) processCache.length = 3
  }

  const out = makeCanvas(outW, outH)
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(art, 0, 0, out.width, out.height)
  return out
}

// ----- colour -----

/** Re-light a source colour to a target luminance, keeping its hue and saturation. */
function relight(r: number, g: number, b: number, from: number, to: number): [number, number, number] {
  if (from < 0.004) {
    // black has no hue to preserve, so it lifts to neutral grey rather than staying black
    const v = to * 255
    return [v, v, v]
  }
  const k = to / from
  return [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)]
}

export function hexRGB(hex: string): RGB {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * The colour pass, run on the art layer alone.
 *
 * Deliberately not on the whole frame. Desaturating the finished picture would
 * take the backdrop with it, and a black and white photograph on a coloured
 * ground is a thing people want; a black and white photograph that also drained
 * the ground is a bug report.
 *
 * The tint is the fiddly half. A blend mode composites over the entire layer,
 * transparent regions included, so painting it straight on fills the gaps
 * between characters with flat colour. Blending on a copy and then intersecting
 * that copy with the art's own alpha is what keeps the tint inside the marks.
 */
function colorPass(art: HTMLCanvasElement, doc: AsciiDoc) {
  const c = doc.color
  const ctx = art.getContext('2d')!

  if (c.saturation !== 1 || c.grayscale > 0) {
    const copy = makeCanvas(art.width, art.height)
    copy.getContext('2d')!.drawImage(art, 0, 0)
    ctx.save()
    ctx.globalCompositeOperation = 'copy'
    ctx.filter = `saturate(${c.saturation}) grayscale(${c.grayscale})`
    ctx.drawImage(copy, 0, 0)
    ctx.restore()
  }

  if (c.tintOpacity > 0 && c.blend !== 'normal') {
    const tinted = makeCanvas(art.width, art.height)
    const tctx = tinted.getContext('2d')!
    tctx.drawImage(art, 0, 0)
    tctx.globalCompositeOperation = c.blend
    tctx.fillStyle = c.tint
    tctx.fillRect(0, 0, tinted.width, tinted.height)
    // put the marks' own silhouette back, so the tint never leaves them
    tctx.globalCompositeOperation = 'destination-in'
    tctx.drawImage(art, 0, 0)

    ctx.save()
    ctx.globalAlpha = c.tintOpacity
    ctx.drawImage(tinted, 0, 0)
    ctx.restore()
  }
}

export interface GridResult {
  grid: CellGrid
  levels: Levels
  fine?: PainterEnv['fine']
  cols: number
  rows: number
}

/**
 * Cut the grid for a document.
 *
 * Exported because the text exporters need exactly this and nothing else: they
 * want the characters, not the pixels, and re-deriving the grid in a second
 * place is how a .txt file ends up one column narrower than the PNG beside it.
 */
export function buildGrid(doc: AsciiDoc, source: CanvasImageSource): GridResult {
  /*
   * Remembered for the last few documents and sources. The cursor redraws the
   * preview every frame while nothing about the picture has changed, and
   * resampling the source sixty times a second for the same answer was most of
   * the cost of a frame. A few rather than one, because the style thumbnails
   * cut their own small grids between preview frames.
   */
  const key = JSON.stringify([doc.style, doc.size, doc.grid.cell, doc.grid.aspect, doc.tone])
  const hit = gridCache.find((e) => e.source === source && e.key === key)
  if (hit) return hit.result
  const result = cutGrid(doc, source)
  gridCache.unshift({ source, key, result })
  if (gridCache.length > 4) gridCache.length = 4
  return result
}

const gridCache: { source: CanvasImageSource; key: string; result: GridResult }[] = []

function cutGrid(doc: AsciiDoc, source: CanvasImageSource): GridResult {
  const spec = getStyle(doc.style)
  const { cols, rows } = gridSize(doc, spec.square)
  const grid = sampleGrid(source, cols, rows)
  const levels = toInk(grid, doc.tone)

  /*
   * Braille asks eight questions of every cell, so it needs a grid at two
   * columns and four rows per cell. Sampled separately rather than by
   * subdividing the coarse one, because the whole reason braille is worth
   * having is that it sees detail the coarse grid threw away.
   */
  let fine: PainterEnv['fine']
  if (doc.style === 'braille') {
    const fg = sampleGrid(source, cols * 2, rows * 4)
    fine = { ink: toInk(fg, doc.tone).ink, cols: fg.cols, rows: fg.rows }
  }

  return { grid, levels, fine, cols, rows }
}

/**
 * The advance width of one character at 100px, in the app's monospace stack.
 *
 * Measured rather than assumed, because monospace faces are not all 0.6em wide
 * and being wrong by five per cent shows up as the right-hand column of the
 * picture drifting off the canvas. Cached, because it is a property of the
 * font stack and the machine, and measuring it per render meant creating a
 * canvas on every slider frame.
 */
let advanceCache = 0
function monoAdvance(): number {
  if (advanceCache) return advanceCache
  const ctx = makeCanvas(8, 8).getContext('2d')!
  ctx.font = `100px ${MONO}`
  advanceCache = ctx.measureText('M').width || 60
  return advanceCache
}

/** The type size a glyph style draws at, for a given cell. */
export function glyphFontSize(doc: AsciiDoc, cw: number, ch: number): number {
  const fontPx = (cw / monoAdvance()) * 100
  /*
   * Solid ramps get sized to the cell height instead, and so overlap slightly.
   * A block character has to tile with its neighbours to read as a fill, and a
   * hairline of backdrop between rows is far more visible than a hairline of
   * overlap.
   */
  if (getRamp(doc.ramp).solid || doc.style === 'blocks') return Math.max(fontPx, ch * 1.04)
  return fontPx
}

/** The characters a glyph style draws from, lightest first. */
export function styleChars(doc: AsciiDoc): string {
  return doc.style === 'blocks' ? getRamp('blocks').chars : rampChars(doc.ramp, doc.customRamp)
}

/** The style's own settings, resolved against its specs. */
export function styleParams(doc: AsciiDoc) {
  const spec = getStyle(doc.style)
  return spec.params ? resolve(spec.params, doc.styleParams[doc.style]) : {}
}

/**
 * Draw the document's cells onto a surface.
 *
 * The single description of what every cell style looks like. Called once with
 * a canvas backend for the preview and the raster exports, and once with a
 * vector backend for SVG, which is why there is no separate SVG idea of a
 * mosaic tile to fall out of step with this one.
 */
export function paintArt(
  surface: Surface,
  doc: AsciiDoc,
  source: CanvasImageSource,
  outW: number,
  outH: number,
  field?: CellField,
): { cols: number; rows: number } {
  const spec = getStyle(doc.style)
  const painter = PAINTERS[doc.style]
  const { grid, levels, fine, cols, rows } = buildGrid(doc, source)
  if (!painter) return { cols, rows }

  const cw = outW / cols
  const ch = outH / rows
  const chars = styleChars(doc)

  if (spec.glyph) surface.font(glyphFontSize(doc, cw, ch))

  const paintsEveryCell = spec.group === 'raster'
  const env: PainterEnv = {
    chars,
    jitter: doc.grid.jitter,
    gap: doc.grid.gap,
    fine,
    p: styleParams(doc),
    cols,
  }
  const mode = doc.color.mode
  const inkHex = hexRGB(doc.color.ink)
  const ink2Hex = hexRGB(doc.color.ink2)
  const lut = mode === 'gradient' ? gradientLut(doc.color.gradient) : null
  const cell: CellCtx = {
    s: surface,
    x: 0,
    y: 0,
    w: cw,
    h: ch,
    col: 0,
    row: 0,
    ink: 0,
    edge: 0,
    angle: 0,
    lum: 0,
    color: doc.color.ink,
    r: 0,
    g: 0,
    b: 0,
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      const ink = levels.ink[i]
      /*
       * An empty cell is the common case on any picture with a sky in it, and
       * skipping it is worth more than any micro-optimisation inside a painter.
       *
       * The tile styles are the exception, and have to be: they cover the frame
       * rather than mark it, so a cell with no ink is a bright tile, not an
       * absent one. Skipping those would punch holes in the highlights.
       */
      if (ink <= 0 && !paintsEveryCell) continue
      if (grid.alpha[i] <= 0.004) continue

      const sr = grid.rgb[i * 3]
      const sg = grid.rgb[i * 3 + 1]
      const sb = grid.rgb[i * 3 + 2]
      const lum = levels.lum[i]

      let r = sr
      let g = sg
      let b = sb

      if (mode === 'ink') {
        r = inkHex[0]
        g = inkHex[1]
        b = inkHex[2]
      } else if (mode === 'duotone') {
        const t = ink
        r = ink2Hex[0] + (inkHex[0] - ink2Hex[0]) * t
        g = ink2Hex[1] + (inkHex[1] - ink2Hex[1]) * t
        b = ink2Hex[2] + (inkHex[2] - ink2Hex[2]) * t
      } else if (lut) {
        const li = Math.round(Math.min(1, Math.max(0, lum)) * 255) * 3
        r = lut[li]
        g = lut[li + 1]
        b = lut[li + 2]
      } else if (mode === 'spectrum') {
        /*
         * A rainbow laid diagonally across the grid, lit by the cell's own
         * brightness. Position rather than the source hue, so a grey
         * photograph still comes out in colour, which is the point of it.
         */
        const hue = doc.color.hue + ((col + row) / Math.max(1, cols + rows)) * 360
        ;[r, g, b] = hsl(hue, 0.9, 0.3 + lum * 0.45)
      } else {
        ;[r, g, b] = relight(sr, sg, sb, grid.lum[i], lum)
      }

      cell.x = col * cw
      cell.y = row * ch
      cell.col = col
      cell.row = row
      cell.ink = ink
      cell.edge = grid.edge[i]
      cell.angle = grid.angle[i]
      cell.lum = lum
      cell.color =
        mode === 'ink' ? doc.color.ink : `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
      cell.r = r
      cell.g = g
      cell.b = b
      field?.(cell)
      painter(cell, env)
    }
  }

  return { cols, rows }
}

/**
 * The last few backdrops the preview painted.
 *
 * Only the preview asks for them. A blurred backdrop is the costliest thing in a
 * frame and the cursor never changes it, but holding an export-sized copy of
 * one would pin a hundred megabytes for a picture already downloaded.
 */
const backdropCache: { source: CanvasImageSource | null; key: string; canvas: HTMLCanvasElement }[] = []

function backdropLayer(
  doc: AsciiDoc,
  source: CanvasImageSource | null,
  w: number,
  h: number,
  scale: number,
): HTMLCanvasElement {
  const key = JSON.stringify([doc.backdrop, w, h])
  const hit = backdropCache.find((e) => e.source === source && e.key === key)
  if (hit) return hit.canvas
  const canvas = makeCanvas(w, h)
  paintBackdrop(canvas.getContext('2d')!, doc, source, w, h, scale)
  backdropCache.unshift({ source, key, canvas })
  if (backdropCache.length > 2) backdropCache.length = 2
  return canvas
}

// ----- reveal -----

/**
 * The untreated photograph, drawn back over the frame outside the reveal.
 *
 * Built as a mask rather than a clip, so the boundary can be feathered: the
 * photograph is drawn whole, then intersected with a gradient that is opaque
 * where the plain picture should show and clear where the art should.
 */
function applyReveal(out: HTMLCanvasElement, doc: AsciiDoc, raw: CanvasImageSource) {
  const rv = doc.reveal
  if (rv.mode === 'off') return
  const w = out.width
  const h = out.height
  const plain = makeCanvas(w, h)
  const pc = plain.getContext('2d')!
  drawCover(pc, raw, w, h)

  const diag = Math.hypot(w, h)
  const size = Math.max(1, rv.size * diag)
  const soft = Math.min(0.999, Math.max(0.001, rv.feather))
  const show = 'rgba(0,0,0,1)'
  const hide = 'rgba(0,0,0,0)'
  const [inside, outside] = rv.invert ? [show, hide] : [hide, show]

  let fill: CanvasGradient
  if (rv.mode === 'spot') {
    fill = pc.createRadialGradient(rv.x * w, rv.y * h, size * (1 - soft), rv.x * w, rv.y * h, size)
    fill.addColorStop(0, inside)
    fill.addColorStop(1, outside)
  } else {
    const a = (rv.angle * Math.PI) / 180
    const nx = Math.cos(a)
    const ny = Math.sin(a)
    const cx = rv.x * w
    const cy = rv.y * h
    if (rv.mode === 'split') {
      const f = Math.max(1, soft * size)
      fill = pc.createLinearGradient(cx - nx * f, cy - ny * f, cx + nx * f, cy + ny * f)
      fill.addColorStop(0, inside)
      fill.addColorStop(1, outside)
    } else {
      // a strip `size` either side of the line through the centre, softened
      // over `feather` of its width at each edge
      fill = pc.createLinearGradient(cx - nx * size, cy - ny * size, cx + nx * size, cy + ny * size)
      const ramp = Math.min(0.49, soft / 2)
      fill.addColorStop(0, outside)
      fill.addColorStop(ramp, inside)
      fill.addColorStop(1 - ramp, inside)
      fill.addColorStop(1, outside)
    }
  }
  pc.globalCompositeOperation = 'destination-in'
  pc.fillStyle = fill
  pc.fillRect(0, 0, w, h)
  out.getContext('2d')!.drawImage(plain, 0, 0)
}

export interface RenderOptions {
  /** moves cells before they are painted; the cursor's scatter */
  field?: CellField
  /** keep the backdrop between calls, for a preview redrawn every frame */
  reuse?: boolean
  /** seconds, for the finishing effects that move */
  time?: number
  /** how hard the whole-frame styles may work */
  quality?: 'preview' | 'export'
  /**
   * Document pixels per layer pixel, for callers drawing a document at a
   * different size from the one its settings were written against. The style
   * thumbnails pass their own shrink here so a 48px ripple stays a ripple.
   */
  layerScale?: number
  /** leave out the reveal, for callers that want the treatment everywhere */
  noReveal?: boolean
}

export function renderAscii(
  doc: AsciiDoc,
  rawSource: CanvasImageSource | null,
  outW: number,
  outH: number,
  opts: RenderOptions = {},
): AsciiRender {
  const out = makeCanvas(outW, outH)
  const ctx = out.getContext('2d')!
  const scale = outW / Math.max(1, doc.size.width)
  const source = rawSource ? prepareSource(doc, rawSource, opts.layerScale ?? 1) : null

  if (opts.reuse) ctx.drawImage(backdropLayer(doc, source, out.width, out.height, scale), 0, 0)
  else paintBackdrop(ctx, doc, source, out.width, out.height, scale)

  if (!source) {
    if (hasFx(doc)) applyFx(out, doc, scale, opts.time ?? 0)
    return { canvas: out, cols: 0, rows: 0 }
  }

  const spec = getStyle(doc.style)
  let art: HTMLCanvasElement
  let cols = 0
  let rows = 0
  if (doc.style === 'dither') {
    art = renderDither(doc, source, out.width, out.height)
    const px = Math.max(1, doc.dither.scale)
    cols = Math.round(doc.size.width / px)
    rows = Math.round(doc.size.height / px)
  } else if (spec.group === 'process') {
    // a whole-frame style has no grid, so it reports none
    art = renderProcess(doc, source, out.width, out.height, opts.quality ?? 'export')
  } else {
    art = makeCanvas(out.width, out.height)
    const grid = paintArt(
      new CanvasSurface(art.getContext('2d')!),
      doc,
      source,
      out.width,
      out.height,
      opts.field,
    )
    cols = grid.cols
    rows = grid.rows
  }

  colorPass(art, doc)

  ctx.save()
  ctx.globalAlpha = doc.color.opacity
  ctx.globalCompositeOperation = doc.color.composite ?? 'source-over'
  ctx.drawImage(art, 0, 0)
  ctx.restore()

  if (!opts.noReveal && rawSource) applyReveal(out, doc, rawSource)

  if (hasFx(doc)) applyFx(out, doc, scale, opts.time ?? 0)

  return { canvas: out, cols, rows }
}
