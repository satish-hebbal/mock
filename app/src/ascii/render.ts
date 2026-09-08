/**
 * The renderer.
 *
 * One function, `renderAscii`, and both the canvas on screen and every exported
 * file go through it. That is the whole parity story: there is no preview
 * renderer to keep in step with an export renderer, because there is only one,
 * and the only thing that changes between the two calls is the number handed in
 * as the output width.
 *
 * Everything positional is derived from `scale`, the ratio of output width to
 * document width, so a blur radius, a scan line gap and a stud highlight all
 * grow with the picture instead of staying a fixed number of pixels and
 * quietly becoming invisible at 4x.
 */

import { paintMeshGradient } from '../lib/meshGradient'
import { ditherImage } from './dither'
import { paletteRGB, type RGB } from './palettes'
import { PAINTERS, type CellCtx, type PainterEnv } from './painters'
import { applyFx, hasFx } from './postfx'
import { rampChars, getRamp } from './ramps'
import { applyToneToPixels, sampleGrid, toInk, type CellGrid, type Levels } from './sample'
import { getStyle } from './styles'
import { gridSize, type AsciiDoc } from './types'

/**
 * The stack a glyph style draws with.
 *
 * Every entry has to be monospaced, because the grid assumes one advance width
 * for every character in the ramp. The block and braille code points are the
 * reason the list runs as long as it does: not every monospace face carries
 * them, and a missing glyph falls back to a proportional face and knocks the
 * whole row out of alignment.
 */
const MONO = 'ui-monospace, "SF Mono", "DejaVu Sans Mono", "Cascadia Mono", Menlo, Consolas, monospace'

export interface AsciiRender {
  canvas: HTMLCanvasElement
  /** the grid the picture was cut on, for the readout under the canvas */
  cols: number
  rows: number
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/** Draw `src` filling `w` x `h`, cropping the overflow. The CSS `cover` rule. */
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number) {
  const sw = 'videoWidth' in src ? (src.videoWidth as number) : ((src as HTMLImageElement).width ?? w)
  const sh = 'videoHeight' in src ? (src.videoHeight as number) : ((src as HTMLImageElement).height ?? h)
  if (!sw || !sh) return
  const k = Math.max(w / sw, h / sh)
  const dw = sw * k
  const dh = sh * k
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

function paintBackdrop(
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

/**
 * The dither path.
 *
 * Reduce first, dither second, enlarge third. The order is the effect: dithering
 * at full resolution and then shrinking averages the pattern straight back into
 * the grey it was invented to avoid, which is the single most common way this
 * comes out looking like noise instead of like a Game Boy.
 */
function renderDither(doc: AsciiDoc, source: CanvasImageSource, w: number, h: number) {
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
  sctx.putImageData(img, 0, 0)

  const art = makeCanvas(w, h)
  const ctx = art.getContext('2d')!
  // nearest neighbour on the way back up, or the whole point is blurred away
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, art.width, art.height)
  return art
}

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

function mix(a: RGB, b: RGB, t: number): string {
  const c = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t)
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`
}

function hexRGB(hex: string): RGB {
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

export function renderAscii(
  doc: AsciiDoc,
  source: CanvasImageSource | null,
  outW: number,
  outH: number,
): AsciiRender {
  const out = makeCanvas(outW, outH)
  const ctx = out.getContext('2d')!
  const scale = outW / Math.max(1, doc.size.width)

  paintBackdrop(ctx, doc, source, out.width, out.height, scale)

  if (!source) {
    if (hasFx(doc.fx)) applyFx(out, doc.fx, scale)
    return { canvas: out, cols: 0, rows: 0 }
  }

  if (doc.style === 'dither') {
    const art = renderDither(doc, source, out.width, out.height)
    colorPass(art, doc)
    ctx.save()
    ctx.globalAlpha = doc.color.opacity
    ctx.drawImage(art, 0, 0)
    ctx.restore()
    if (hasFx(doc.fx)) applyFx(out, doc.fx, scale)
    const px = Math.max(1, doc.dither.scale)
    return {
      canvas: out,
      cols: Math.round(doc.size.width / px),
      rows: Math.round(doc.size.height / px),
    }
  }

  const spec = getStyle(doc.style)
  const { grid, levels, fine, cols, rows } = buildGrid(doc, source)

  const art = makeCanvas(out.width, out.height)
  const actx = art.getContext('2d')!
  const cw = out.width / cols
  const ch = out.height / rows

  const chars = doc.style === 'blocks' ? getRamp('blocks').chars : rampChars(doc.ramp, doc.customRamp)

  if (spec.glyph) {
    /*
     * Size the font from its own advance width rather than guessing a ratio.
     * Monospace faces are not all 0.6em wide, and being wrong by five per cent
     * shows up as the right-hand column of the picture drifting off the canvas.
     */
    actx.font = `100px ${MONO}`
    const advance = actx.measureText('M').width || 60
    let fontPx = (cw / advance) * 100
    /*
     * Solid ramps get sized to the cell height instead, and so overlap
     * slightly. A block character has to tile with its neighbours to read as a
     * fill, and a hairline of backdrop between rows is far more visible than a
     * hairline of overlap.
     */
    if (getRamp(doc.ramp).solid || doc.style === 'blocks') fontPx = Math.max(fontPx, ch * 1.04)
    actx.font = `${fontPx}px ${MONO}`
    actx.textAlign = 'center'
    actx.textBaseline = 'middle'
  }

  const painter = PAINTERS[doc.style]
  const paintsEveryCell = spec.group === 'raster'
  const env: PainterEnv = { chars, jitter: doc.grid.jitter, gap: doc.grid.gap, fine }
  const inkHex = hexRGB(doc.color.ink)
  const ink2Hex = hexRGB(doc.color.ink2)
  const cell: CellCtx = {
    ctx: actx,
    x: 0,
    y: 0,
    w: cw,
    h: ch,
    col: 0,
    row: 0,
    ink: 0,
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

      let r = sr
      let g = sg
      let b = sb
      let color: string

      if (doc.color.mode === 'ink') {
        color = doc.color.ink
        r = inkHex[0]
        g = inkHex[1]
        b = inkHex[2]
      } else if (doc.color.mode === 'duotone') {
        color = mix(ink2Hex, inkHex, ink)
        const t = ink
        r = ink2Hex[0] + (inkHex[0] - ink2Hex[0]) * t
        g = ink2Hex[1] + (inkHex[1] - ink2Hex[1]) * t
        b = ink2Hex[2] + (inkHex[2] - ink2Hex[2]) * t
      } else {
        const lit = relight(sr, sg, sb, grid.lum[i], levels.lum[i])
        r = lit[0]
        g = lit[1]
        b = lit[2]
        color = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
      }

      cell.x = col * cw
      cell.y = row * ch
      cell.col = col
      cell.row = row
      cell.ink = ink
      cell.color = color
      cell.r = r
      cell.g = g
      cell.b = b
      painter(cell, env)
    }
  }

  colorPass(art, doc)

  ctx.save()
  ctx.globalAlpha = doc.color.opacity
  ctx.drawImage(art, 0, 0)
  ctx.restore()

  if (hasFx(doc.fx)) applyFx(out, doc.fx, scale)

  return { canvas: out, cols, rows }
}
