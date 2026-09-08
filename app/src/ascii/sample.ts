/**
 * Source image to cell grid, and cell grid to ink.
 *
 * The whole renderer downstream of this file works on numbers per cell and
 * never touches the source image again, which is what keeps a 4x export honest:
 * the grid is cut once from the document, not from the output resolution, so
 * every painter is handed exactly the same array whether it is drawing a
 * 900px preview or a 6400px file.
 *
 * The one thing worth being careful about is that nothing in here may use
 * `Math.random`. Preview and export are two separate calls, and any style with
 * a random element (jitter, Mixed, mosaic lighting) would come out different in
 * the file than on screen. `hash2` below is the substitute: same cell, same
 * number, every time, forever.
 */

export interface CellGrid {
  cols: number
  rows: number
  /** average colour per cell, three entries per cell */
  rgb: Uint8ClampedArray
  /** 0..1 relative luminance per cell, before any tone mapping */
  lum: Float32Array
  /** 0..1 Sobel gradient magnitude per cell */
  edge: Float32Array
  /** 0..1 coverage, so a transparent PNG does not paint its empty corners */
  alpha: Float32Array
}

/**
 * A stable pseudo-random number for a cell.
 *
 * Integer hash rather than a seeded PRNG because the callers want random
 * *access*: painter loops do not run in a fixed order once a style draws back
 * to front, so a stream would hand a given cell a different value depending on
 * when it was reached.
 */
export function hash2(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return ((h >>> 0) % 100000) / 100000
}

/** Rec. 709 luminance, which is what the eye actually weights the channels at. */
export function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * Reduce `source` to a cols x rows grid.
 *
 * The reduction is done by the browser's own image scaler at high quality,
 * which is a box filter over exactly the source rectangle each cell covers.
 * Sampling one pixel per cell instead is the difference between ASCII art that
 * holds together when you squint and ASCII art that shimmers with whatever
 * happened to land under the sample points.
 */
export function sampleGrid(source: CanvasImageSource, cols: number, rows: number): CellGrid {
  const c = document.createElement('canvas')
  c.width = cols
  c.height = rows
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, cols, rows)

  const data = ctx.getImageData(0, 0, cols, rows).data
  const n = cols * rows
  const rgb = new Uint8ClampedArray(n * 3)
  const lum = new Float32Array(n)
  const alpha = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    const p = i * 4
    const a = data[p + 3] / 255
    /*
     * Un-premultiply against the transparent black the canvas cleared to.
     * Without this, a half-transparent cell reports a colour half way to black
     * and the edges of a cut-out come out with a dark fringe of characters.
     */
    const inv = a > 0.004 ? 1 / a : 0
    const r = data[p] * inv
    const g = data[p + 1] * inv
    const b = data[p + 2] * inv
    rgb[i * 3] = r
    rgb[i * 3 + 1] = g
    rgb[i * 3 + 2] = b
    lum[i] = luma(r, g, b)
    alpha[i] = a
  }

  return { cols, rows, rgb, lum, edge: sobel(lum, cols, rows), alpha }
}

/**
 * Sobel gradient magnitude over the luminance grid.
 *
 * Run on the reduced grid rather than the source on purpose. An edge detector
 * on a full-resolution photograph finds the texture of the fabric; run at cell
 * resolution it finds the edges the finished picture actually has cells to
 * describe, which is the only thing "edge emphasis" can usefully act on.
 */
function sobel(lum: Float32Array, cols: number, rows: number): Float32Array {
  const out = new Float32Array(cols * rows)
  const at = (x: number, y: number) =>
    lum[Math.min(rows - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))]

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const tl = at(x - 1, y - 1)
      const tc = at(x, y - 1)
      const tr = at(x + 1, y - 1)
      const ml = at(x - 1, y)
      const mr = at(x + 1, y)
      const bl = at(x - 1, y + 1)
      const bc = at(x, y + 1)
      const br = at(x + 1, y + 1)
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl)
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr)
      // the magnitude of a Sobel pair maxes out around 4 on 0..1 input
      out[y * cols + x] = Math.min(1, Math.hypot(gx, gy) / 2)
    }
  }
  return out
}

export interface ToneInput {
  brightness: number
  contrast: number
  gamma: number
  coverage: number
  density: number
  edge: number
  invert: boolean
}

/**
 * Cell grid to ink: 0 is "leave this cell empty", 1 is "as dense as it gets".
 *
 * The order of operations is the whole of it, and it is the same order a
 * darkroom would use. Exposure first, because everything after it assumes a
 * centred image. Contrast around the midpoint, because contrast around zero is
 * just brightness with extra steps. Gamma last of the tonal three, so it bends
 * a range that has already been placed rather than one that is about to move.
 *
 * Only then does luminance become ink, and the two adjustments that are about
 * *drawing* rather than about tone are applied to the ink instead: edges add to
 * it, and coverage scales it, so turning coverage down lightens the picture
 * without also flattening the edges you turned up.
 */
export interface Levels {
  /** 0..1 coverage per cell */
  ink: Float32Array
  /**
   * The tone-mapped luminance the ink came from.
   *
   * Kept because the tile styles need it: a LEGO brick is not drawn *with* ink,
   * it is drawn in the source colour re-lit to the brightness the tone
   * controls asked for, and reconstructing that from the ink would have to undo
   * coverage, density and edge emphasis to get back to a number they already
   * had here.
   */
  lum: Float32Array
}

export function toInk(grid: CellGrid, tone: ToneInput): Levels {
  const n = grid.cols * grid.rows
  const out = new Float32Array(n)
  const mapped = new Float32Array(n)
  const b = tone.brightness / 100
  const k = tone.contrast / 100
  const invGamma = 1 / Math.max(0.05, tone.gamma)

  for (let i = 0; i < n; i++) {
    let l = grid.lum[i] + b
    l = (l - 0.5) * k + 0.5
    l = Math.min(1, Math.max(0, l))
    l = Math.pow(l, invGamma)
    mapped[i] = tone.invert ? 1 - l : l

    let ink = tone.invert ? l : 1 - l
    if (tone.edge > 0) ink = Math.min(1, ink + grid.edge[i] * tone.edge)
    ink *= tone.coverage
    /*
     * Transparent cells never get ink, whatever the tone settings say. This is
     * after coverage rather than before so that fading the whole picture out
     * still leaves a cut-out cut out.
     */
    ink *= grid.alpha[i]
    out[i] = ink <= tone.density ? 0 : ink
  }
  return { ink: out, lum: mapped }
}

/**
 * The same tonal curve, applied to an ImageData buffer.
 *
 * The dither path never builds a cell grid, so it needs the curve applied to
 * pixels instead. Same order, same arithmetic, deliberately duplicated rather
 * than abstracted: the two loops have different shapes (one reads a Float32
 * array, one reads and writes RGBA) and folding them together produced a helper
 * with a callback per pixel that cost more than the maths it saved.
 */
export function applyToneToPixels(img: ImageData, tone: ToneInput) {
  const px = img.data
  const b = tone.brightness * 2.55
  const k = tone.contrast / 100
  const invGamma = 1 / Math.max(0.05, tone.gamma)

  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = px[i + c] + b
      v = (v - 128) * k + 128
      v = Math.min(255, Math.max(0, v))
      v = Math.pow(v / 255, invGamma) * 255
      px[i + c] = tone.invert ? 255 - v : v
    }
  }
}
