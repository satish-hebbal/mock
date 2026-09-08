/**
 * The finishing pass, run over the assembled frame.
 *
 * Everything here works on the output canvas rather than on the grid, because
 * every one of these effects is about the *screen the picture is on* and not
 * about the picture. A scan line that respected cell boundaries would not be a
 * scan line, it would be a stripe pattern.
 *
 * Two rules hold throughout:
 *
 *   Nothing uses `Math.random`. Grain and glitch are hashed from pixel position
 *   so the export is the frame that was on screen, not a second roll of the
 *   dice that happens to look similar.
 *
 *   Every distance is multiplied by `scale`, the ratio of output width to
 *   document width. A 2px scan line gap at preview size is 8px at 4x, so the
 *   file has the same number of stripes across the picture rather than four
 *   times as many hairlines.
 */

import type { AsciiFx } from './types'

const hash = (x: number, y: number, salt: number) => {
  let h = (x * 92837111 + y * 689287499 + salt * 283923481) | 0
  h = (h ^ (h >>> 15)) * 1274126177
  return ((h ^ (h >>> 13)) >>> 0) / 4294967295
}

function copyOf(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = canvas.width
  c.height = canvas.height
  c.getContext('2d')!.drawImage(canvas, 0, 0)
  return c
}

/**
 * Bloom: the light that spills off a bright phosphor.
 *
 * A brightness and contrast filter isolates the highlights, a blur spreads
 * them, and `lighter` adds the result back. Isolating with `contrast` rather
 * than by thresholding in an ImageData loop keeps the whole thing on the
 * compositor, which is the difference between an effect that costs a frame and
 * one that costs a hundred.
 */
function bloom(canvas: HTMLCanvasElement, amount: number, scale: number) {
  const ctx = canvas.getContext('2d')!
  const src = copyOf(canvas)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, amount * 0.85)
  ctx.filter = `brightness(1.35) contrast(2.2) blur(${(6 + amount * 22) * scale}px)`
  ctx.drawImage(src, 0, 0)
  ctx.restore()
}

/**
 * Chromatic aberration: the channels landing a hair apart.
 *
 * Done in an ImageData pass rather than by drawing three tinted copies, because
 * the copy-and-blend approach can only add light and so washes the picture out
 * as the effect comes up. Moving the samples leaves the total energy alone.
 */
function chromatic(canvas: HTMLCanvasElement, amount: number, scale: number) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const img = ctx.getImageData(0, 0, w, h)
  const src = new Uint8ClampedArray(img.data)
  const px = img.data
  const d = Math.max(1, Math.round(amount * 9 * scale))

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const rx = Math.min(w - 1, x + d)
      const bx = Math.max(0, x - d)
      px[i] = src[(y * w + rx) * 4]
      px[i + 2] = src[(y * w + bx) * 4 + 2]
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** Scan lines: the gaps between the rows a tube actually lit. */
function scanlines(canvas: HTMLCanvasElement, amount: number, scale: number) {
  const ctx = canvas.getContext('2d')!
  const gap = Math.max(2, Math.round(3 * scale))
  const thickness = Math.max(1, Math.round(gap / 2))
  ctx.save()
  ctx.globalAlpha = amount * 0.55
  ctx.fillStyle = '#000'
  for (let y = 0; y < canvas.height; y += gap + thickness) {
    ctx.fillRect(0, y, canvas.width, thickness)
  }
  ctx.restore()
}

/**
 * Barrel distortion, the bulge of a glass tube.
 *
 * Sampled backwards: for every destination pixel, work out where it came from
 * and read there. Doing it forwards leaves holes wherever the stretch pulls
 * neighbouring pixels apart, which is why every image warp in existence is
 * written this way round.
 *
 * Bilinear rather than nearest because the subject here is text. Nearest
 * sampling on a curve turns straight character stems into staircases, and the
 * whole point of the effect is that the letters keep their shape while the
 * screen they sit on does not.
 */
function curvature(canvas: HTMLCanvasElement, amount: number) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const img = ctx.getImageData(0, 0, w, h)
  const src = new Uint8ClampedArray(img.data)
  const px = img.data
  const k = amount * 0.28

  for (let y = 0; y < h; y++) {
    // normalised to -1..1 so the distortion is about the centre of the screen
    const ny = (y / h) * 2 - 1
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * 2 - 1
      const r2 = nx * nx + ny * ny
      const f = 1 + k * r2
      const sx = ((nx * f + 1) / 2) * w
      const sy = ((ny * f + 1) / 2) * h
      const i = (y * w + x) * 4

      if (sx < 0 || sy < 0 || sx >= w - 1 || sy >= h - 1) {
        // past the edge of the glass there is nothing to show
        px[i] = px[i + 1] = px[i + 2] = 0
        px[i + 3] = 255
        continue
      }

      const x0 = sx | 0
      const y0 = sy | 0
      const fx = sx - x0
      const fy = sy - y0
      const i00 = (y0 * w + x0) * 4
      const i10 = i00 + 4
      const i01 = i00 + w * 4
      const i11 = i01 + 4
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx
        const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx
        px[i + c] = top * (1 - fy) + bot * fy
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** Film grain, hashed so the file matches the preview. */
function grain(canvas: HTMLCanvasElement, amount: number) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const img = ctx.getImageData(0, 0, w, h)
  const px = img.data
  const strength = amount * 64

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const n = (hash(x, y, 1) - 0.5) * strength
      px[i] += n
      px[i + 1] += n
      px[i + 2] += n
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** Horizontal tear: a few bands of the frame sliding sideways. */
function glitch(canvas: HTMLCanvasElement, amount: number, scale: number) {
  const ctx = canvas.getContext('2d')!
  const src = copyOf(canvas)
  const { width: w, height: h } = canvas
  const bands = Math.round(3 + amount * 14)
  const maxShift = amount * 0.06 * w

  for (let i = 0; i < bands; i++) {
    // the band picked, its height and its shift all come from the same index,
    // so the tear is in the same place in the export as it was on screen
    const y = Math.floor(hash(i, 0, 2) * h)
    const bh = Math.max(2 * scale, hash(i, 1, 3) * 0.05 * h)
    const dx = (hash(i, 2, 4) - 0.5) * 2 * maxShift
    ctx.clearRect(0, y, w, bh)
    ctx.drawImage(src, 0, y, w, bh, dx, y, w, bh)
  }
}

/** The darkening at the edge of a lens, or of a tube. */
function vignette(canvas: HTMLCanvasElement, amount: number) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) / 2)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, `rgba(0,0,0,${Math.min(1, amount)})`)
  ctx.save()
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

/** True when the frame would come back untouched, so the caller can skip the copy. */
export function hasFx(fx: AsciiFx): boolean {
  return (
    fx.bloom > 0 ||
    fx.chromatic > 0 ||
    fx.scanlines > 0 ||
    fx.glitch > 0 ||
    fx.grain > 0 ||
    fx.curvature > 0 ||
    fx.vignette > 0
  )
}

/**
 * Run the whole chain.
 *
 * The order is a physical one, read outwards from the picture to the eye: light
 * spills inside the tube, the beam lands slightly apart per channel, the tube
 * only lit alternate rows, the signal tore, the film it was shot on had grain,
 * the glass in front bulged, and the corners of that glass fell away. Reordering
 * it is not a refactor, it changes the result: grain before the curve gets
 * stretched by the curve, grain after it stays even across the frame.
 */
export function applyFx(canvas: HTMLCanvasElement, fx: AsciiFx, scale: number) {
  if (fx.bloom > 0) bloom(canvas, fx.bloom, scale)
  if (fx.chromatic > 0) chromatic(canvas, fx.chromatic, scale)
  if (fx.scanlines > 0) scanlines(canvas, fx.scanlines, scale)
  if (fx.glitch > 0) glitch(canvas, fx.glitch, scale)
  if (fx.grain > 0) grain(canvas, fx.grain)
  if (fx.curvature > 0) curvature(canvas, fx.curvature)
  if (fx.vignette > 0) vignette(canvas, fx.vignette)
}
