/**
 * The finishing pass, run over an assembled frame.
 *
 * This started life inside the ASCII tool and moved here when Signal needed the
 * same chain. The move is the whole point: there is one implementation of
 * bloom in this app, and both tools get every effect added to it.
 *
 * Everything here works on the output canvas rather than on whatever drew it,
 * because every one of these effects is about the *screen the picture is on*
 * and not about the picture. A scan line that respected cell boundaries would
 * not be a scan line, it would be a stripe pattern.
 *
 * Three rules hold throughout:
 *
 *   Nothing uses `Math.random`. Grain, dust and glitch are hashed from pixel
 *   position and from the frame's own time, so the export is the frame that was
 *   on screen rather than a second roll of the dice that happens to look
 *   similar. For a video that is not a nicety: an unhashed grain flickers at
 *   the encoder's frame rate and destroys the bitrate.
 *
 *   Every distance is multiplied by `scale`, the ratio of output width to
 *   document width. A 2px scan line gap at preview size is 8px at 4x, so the
 *   file has the same number of stripes across the picture rather than four
 *   times as many hairlines.
 *
 *   Order is fixed by FX_ORDER and is not a preference. It reads outwards from
 *   the picture to the eye, and reordering it changes the result rather than
 *   tidying it: grain before a lens curve gets stretched by the curve, grain
 *   after it stays even across the frame.
 */

export type FxId =
  | 'bloom'
  | 'chromatic'
  | 'rgbSplit'
  | 'sharpen'
  | 'emboss'
  | 'posterize'
  | 'pixelate'
  | 'halftone'
  | 'colorOverlay'
  | 'fog'
  | 'godRays'
  | 'lightLeak'
  | 'blur'
  | 'zoomBlur'
  | 'noiseBlur'
  | 'waveDistort'
  | 'gridLines'
  | 'scanlines'
  | 'crtPhosphor'
  | 'matrixRain'
  | 'glitch'
  | 'invert'
  | 'grain'
  | 'filmDust'
  | 'curvature'
  | 'vignette'

/**
 * One effect's settings.
 *
 * `amount` is 0..1 everywhere, and 0 means the effect is skipped rather than
 * run as a no-op, so a document with an empty chain costs nothing at all. The
 * colour fields are only read by the handful of effects that tint, and are
 * declared here rather than per-effect so the chain stays one serialisable
 * shape that a preset can carry.
 */
export interface FxSettings {
  amount: number
  color?: string
  color2?: string
  /** 0..1 positions for the two light-leak blobs, as fractions of the frame */
  x?: number
  y?: number
}

/** A whole chain. Absent keys are off, which is why a fresh document is `{}`. */
export type FxChain = Partial<Record<FxId, FxSettings>>

export interface FxContext {
  /** output width / document width, so distances survive a resolution change */
  scale: number
  /** seconds, for the effects that move */
  time: number
}

// ----- shared helpers -----

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

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/**
 * A 3x3 convolution, used by sharpen and emboss.
 *
 * Edge pixels clamp to the nearest in-bounds sample rather than wrapping or
 * going black, because a one-pixel dark border round every sharpened frame is
 * the kind of artefact nobody notices until it is in an export.
 */
function convolve(canvas: HTMLCanvasElement, kernel: number[], bias: number, mix: number) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const img = ctx.getImageData(0, 0, w, h)
  const src = new Uint8ClampedArray(img.data)
  const px = img.data

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        let sum = 0
        let k = 0
        for (let ky = -1; ky <= 1; ky++) {
          const sy = Math.min(h - 1, Math.max(0, y + ky))
          for (let kx = -1; kx <= 1; kx++) {
            const sx = Math.min(w - 1, Math.max(0, x + kx))
            sum += src[(sy * w + sx) * 4 + c] * kernel[k++]
          }
        }
        const out = clamp255(sum + bias)
        px[i + c] = src[i + c] + (out - src[i + c]) * mix
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

function hexRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const full = s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// ----- the effects -----

/**
 * Bloom: the light that spills off a bright phosphor.
 *
 * A brightness and contrast filter isolates the highlights, a blur spreads
 * them, and `lighter` adds the result back. Isolating with `contrast` rather
 * than by thresholding in an ImageData loop keeps the whole thing on the
 * compositor, which is the difference between an effect that costs a frame and
 * one that costs a hundred.
 */
function bloom(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const src = copyOf(canvas)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, s.amount * 0.85)
  ctx.filter = `brightness(1.35) contrast(2.2) blur(${(6 + s.amount * 22) * c.scale}px)`
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
function chromatic(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const img = ctx.getImageData(0, 0, w, h)
  const src = new Uint8ClampedArray(img.data)
  const px = img.data
  const d = Math.max(1, Math.round(s.amount * 9 * c.scale))

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

/**
 * RGB split: the same idea as chromatic aberration, thrown further and on both
 * axes, which is a different look rather than a stronger one. Kept separate for
 * that reason: turning chromatic up to 1 gives a wide fringe, not this.
 */
function rgbSplit(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const img = ctx.getImageData(0, 0, w, h)
  const src = new Uint8ClampedArray(img.data)
  const px = img.data
  const d = Math.max(1, Math.round(s.amount * 22 * c.scale))
  const dy = Math.round(d * 0.4)

  for (let y = 0; y < h; y++) {
    const ry = Math.min(h - 1, y + dy)
    const by = Math.max(0, y - dy)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      px[i] = src[(ry * w + Math.min(w - 1, x + d)) * 4]
      px[i + 2] = src[(by * w + Math.max(0, x - d)) * 4 + 2]
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** Unsharp mask, as a plain 3x3. `mix` keeps it from going crunchy at 1. */
function sharpen(canvas: HTMLCanvasElement, s: FxSettings) {
  convolve(canvas, [0, -1, 0, -1, 5, -1, 0, -1, 0], 0, s.amount * 0.9)
}

/** Emboss: a directional edge filter, biased back to mid grey. */
function emboss(canvas: HTMLCanvasElement, s: FxSettings) {
  convolve(canvas, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 128, s.amount)
}

/**
 * Posterize: fewer levels per channel.
 *
 * The level count runs down as the amount runs up, floored at two, because one
 * level is a flat grey rectangle and there is no reason to let a slider reach
 * it.
 */
function posterize(canvas: HTMLCanvasElement, s: FxSettings) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const img = ctx.getImageData(0, 0, w, h)
  const px = img.data
  const levels = Math.max(2, Math.round(32 - s.amount * 29))
  const step = 255 / (levels - 1)

  for (let i = 0; i < px.length; i += 4) {
    px[i] = Math.round(px[i] / step) * step
    px[i + 1] = Math.round(px[i + 1] / step) * step
    px[i + 2] = Math.round(px[i + 2] / step) * step
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * Pixelate, done by drawing the frame small and back up with smoothing off.
 *
 * Two `drawImage` calls beat an ImageData block-average loop by an order of
 * magnitude, and for a picture that is already quantised the difference in
 * result is nil: nearest-neighbour downscale of a two-tone image is the same
 * answer the averaging loop would round to.
 */
function pixelate(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const block = Math.max(2, Math.round(s.amount * 24 * c.scale))
  const sw = Math.max(1, Math.round(w / block))
  const sh = Math.max(1, Math.round(h / block))

  const small = document.createElement('canvas')
  small.width = sw
  small.height = sh
  const sctx = small.getContext('2d')!
  sctx.imageSmoothingEnabled = false
  sctx.drawImage(canvas, 0, 0, sw, sh)

  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h)
  ctx.restore()
}

/**
 * A halftone screen laid over the frame.
 *
 * Distinct from dithering with a halftone mask: that decides what the picture
 * is, this is a printed texture sitting on top of whatever the picture already
 * was. Dot radius follows local luminance so the screen reads as ink coverage
 * rather than as a flat grid of circles.
 */
function halftone(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const src = ctx.getImageData(0, 0, w, h).data
  const cell = Math.max(3, Math.round(6 * c.scale))
  const max = cell * 0.72

  ctx.save()
  ctx.globalAlpha = s.amount
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#fff'
  ctx.globalCompositeOperation = 'destination-out'
  for (let y = cell / 2; y < h; y += cell) {
    for (let x = cell / 2; x < w; x += cell) {
      const i = ((y | 0) * w + (x | 0)) * 4
      const lum = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255
      const r = lum * max * 0.5
      if (r < 0.3) continue
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** A flat wash of colour, multiplied in so it tints rather than covers. */
function colorOverlay(canvas: HTMLCanvasElement, s: FxSettings) {
  const ctx = canvas.getContext('2d')!
  ctx.save()
  ctx.globalCompositeOperation = 'overlay'
  ctx.globalAlpha = s.amount
  ctx.fillStyle = s.color ?? '#ff4400'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.restore()
}

/** Depth haze: a soft vertical lift toward the horizon. */
function fog(canvas: HTMLCanvasElement, s: FxSettings) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const g = ctx.createLinearGradient(0, 0, 0, h)
  const [r, gr, b] = hexRgb(s.color ?? '#9aa4b2')
  g.addColorStop(0, `rgba(${r},${gr},${b},${s.amount * 0.55})`)
  g.addColorStop(0.55, `rgba(${r},${gr},${b},${s.amount * 0.18})`)
  g.addColorStop(1, `rgba(${r},${gr},${b},0)`)
  ctx.save()
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

/**
 * God rays: the frame's own highlights smeared away from a point.
 *
 * Successive scaled copies drawn with `lighter`, each one a little larger and a
 * little fainter, which is the cheap radial blur every real-time renderer uses.
 * Doing it properly, by marching samples per pixel, costs fifty times as much
 * for a result nobody can tell apart at this strength.
 */
function godRays(canvas: HTMLCanvasElement, s: FxSettings) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const src = copyOf(canvas)
  const cx = (s.x ?? 0.5) * w
  const cy = (s.y ?? 0.3) * h
  const steps = 10

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.filter = 'brightness(1.2) contrast(2.4)'
  for (let i = 1; i <= steps; i++) {
    const k = 1 + (i / steps) * s.amount * 0.35
    ctx.globalAlpha = (s.amount * 0.16 * (steps - i)) / steps
    ctx.drawImage(src, cx - cx * k, cy - cy * k, w * k, h * k)
  }
  ctx.restore()
}

/**
 * Light leak: two soft coloured blobs burned into opposite corners.
 *
 * `screen` rather than `lighter` so the leak sits on top of a bright picture
 * without clipping it to white, which is what separates a leak from a flare.
 */
function lightLeak(canvas: HTMLCanvasElement, s: FxSettings) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const blobs: [number, number, string][] = [
    [s.x ?? 0.85, s.y ?? 0.15, s.color ?? '#ffb43c'],
    [1 - (s.x ?? 0.85), 1 - (s.y ?? 0.15), s.color2 ?? '#6496ff'],
  ]

  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  for (const [fx, fy, color] of blobs) {
    const [r, g, b] = hexRgb(color)
    const grad = ctx.createRadialGradient(fx * w, fy * h, 0, fx * w, fy * h, Math.max(w, h) * 0.55)
    grad.addColorStop(0, `rgba(${r},${g},${b},${s.amount * 0.75})`)
    grad.addColorStop(0.5, `rgba(${r},${g},${b},${s.amount * 0.22})`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }
  ctx.restore()
}

/** Plain defocus, handed to the compositor's own blur. */
function blur(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const src = copyOf(canvas)
  ctx.save()
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.filter = `blur(${s.amount * 14 * c.scale}px)`
  ctx.drawImage(src, 0, 0)
  ctx.restore()
}

/** Zoom blur: the same stacked-copy trick as god rays, without the highlight isolation. */
function zoomBlur(canvas: HTMLCanvasElement, s: FxSettings) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const src = copyOf(canvas)
  const steps = 12

  ctx.save()
  for (let i = 1; i <= steps; i++) {
    const k = 1 + (i / steps) * s.amount * 0.22
    ctx.globalAlpha = 1 / (i + 1)
    ctx.drawImage(src, (w - w * k) / 2, (h - h * k) / 2, w * k, h * k)
  }
  ctx.restore()
}

/**
 * Noise blur: every pixel takes a neighbour picked by hash.
 *
 * Reads like film softness rather than like a lens, because the displacement is
 * uncorrelated between neighbours instead of being a smooth kernel. Cheap, and
 * the hash keeps it stable frame to frame.
 */
function noiseBlur(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const img = ctx.getImageData(0, 0, w, h)
  const src = new Uint8ClampedArray(img.data)
  const px = img.data
  const r = Math.max(1, s.amount * 5 * c.scale)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const sx = Math.min(w - 1, Math.max(0, Math.round(x + (hash(x, y, 11) - 0.5) * 2 * r)))
      const sy = Math.min(h - 1, Math.max(0, Math.round(y + (hash(x, y, 12) - 0.5) * 2 * r)))
      const j = (sy * w + sx) * 4
      px[i] = src[j]
      px[i + 1] = src[j + 1]
      px[i + 2] = src[j + 2]
    }
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * A sine displacement across the rows, drifting with the clock.
 *
 * Done row by row with `drawImage` rather than per pixel: the distortion is
 * constant along a row, so there are h slices to move rather than w*h samples
 * to resolve.
 */
function waveDistort(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const src = copyOf(canvas)
  const amp = s.amount * 0.045 * w
  const freq = 6

  ctx.clearRect(0, 0, w, h)
  for (let y = 0; y < h; y++) {
    const dx = Math.sin((y / h) * Math.PI * 2 * freq + c.time * 2) * amp
    ctx.drawImage(src, 0, y, w, 1, dx, y, w, 1)
  }
}

/** A technical grid, the graph paper under a diagram. */
function gridLines(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const gap = Math.max(8, Math.round(32 * c.scale))

  ctx.save()
  ctx.globalAlpha = s.amount * 0.5
  ctx.strokeStyle = s.color ?? '#ffffff'
  ctx.lineWidth = Math.max(1, c.scale)
  ctx.beginPath()
  for (let x = gap; x < w; x += gap) {
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, h)
  }
  for (let y = gap; y < h; y += gap) {
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(w, y + 0.5)
  }
  ctx.stroke()
  ctx.restore()
}

/** Scan lines: the gaps between the rows a tube actually lit. */
function scanlines(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const gap = Math.max(2, Math.round(3 * c.scale))
  const thickness = Math.max(1, Math.round(gap / 2))
  ctx.save()
  ctx.globalAlpha = s.amount * 0.55
  ctx.fillStyle = '#000'
  for (let y = 0; y < canvas.height; y += gap + thickness) {
    ctx.fillRect(0, y, canvas.width, thickness)
  }
  ctx.restore()
}

/**
 * The phosphor triad, which is a vertical stripe mask rather than a horizontal
 * one. Together with scan lines it gives the shadow-mask grid; alone it is the
 * colour fringing you see with your nose against a CRT.
 */
function crtPhosphor(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const stripe = Math.max(1, Math.round(c.scale))
  const cols = ['rgba(255,0,0,1)', 'rgba(0,255,0,1)', 'rgba(0,0,255,1)']

  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.globalAlpha = s.amount * 0.6
  for (let x = 0, i = 0; x < w; x += stripe, i++) {
    ctx.fillStyle = cols[i % 3]
    ctx.fillRect(x, 0, stripe, h)
  }
  ctx.restore()
}

/**
 * Columns of falling glyphs, over the top of everything.
 *
 * Each column's speed and phase come from a hash of its index, so the rain is
 * the same rain at any resolution and at any point in an export. The characters
 * are drawn from a fixed katakana-and-digits set rather than the document's own
 * ramp, because this is a quotation, not a typographic control.
 */
const RAIN_GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789'

function matrixRain(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const size = Math.max(8, Math.round(14 * c.scale))
  const cols = Math.ceil(w / size)
  const [r, g, b] = hexRgb(s.color ?? '#00ff41')

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.font = `${size}px ui-monospace, monospace`
  ctx.textBaseline = 'top'

  for (let i = 0; i < cols; i++) {
    const speed = 0.4 + hash(i, 0, 21) * 1.6
    const phase = hash(i, 1, 22)
    const head = ((c.time * speed * 0.35 + phase) % 1) * (h + size * 12) - size * 12
    for (let k = 0; k < 12; k++) {
      const y = head - k * size
      if (y < -size || y > h) continue
      const fade = (1 - k / 12) * s.amount
      ctx.fillStyle = `rgba(${r},${g},${b},${fade})`
      const gi = Math.floor(hash(i, k + Math.floor(c.time * 6), 23) * RAIN_GLYPHS.length)
      ctx.fillText(RAIN_GLYPHS[gi], i * size, y)
    }
  }
  ctx.restore()
}

/** Horizontal tear: a few bands of the frame sliding sideways. */
function glitch(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const src = copyOf(canvas)
  const { width: w, height: h } = canvas
  const bands = Math.round(3 + s.amount * 14)
  const maxShift = s.amount * 0.06 * w
  // the tear moves, but in whole steps: a band that slid a pixel per frame
  // would read as a wobble rather than as a broken signal
  const step = Math.floor(c.time * 8)

  for (let i = 0; i < bands; i++) {
    const y = Math.floor(hash(i, step, 2) * h)
    const bh = Math.max(2 * c.scale, hash(i, step + 1, 3) * 0.05 * h)
    const dx = (hash(i, step + 2, 4) - 0.5) * 2 * maxShift
    ctx.clearRect(0, y, w, bh)
    ctx.drawImage(src, 0, y, w, bh, dx, y, w, bh)
  }
}

/** Straight inversion, faded in so it can sit part way. */
function invert(canvas: HTMLCanvasElement, s: FxSettings) {
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = img.data
  const k = s.amount
  for (let i = 0; i < px.length; i += 4) {
    px[i] += (255 - px[i] - px[i]) * k
    px[i + 1] += (255 - px[i + 1] - px[i + 1]) * k
    px[i + 2] += (255 - px[i + 2] - px[i + 2]) * k
  }
  ctx.putImageData(img, 0, 0)
}

/** Film grain, hashed so the file matches the preview. */
function grain(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const img = ctx.getImageData(0, 0, w, h)
  const px = img.data
  const strength = s.amount * 64
  // grain crawls with the frame, otherwise a still pattern sits on a moving
  // picture and reads as dirt on the lens instead of grain in the stock
  const salt = 1 + Math.floor(c.time * 24)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const n = (hash(x, y, salt) - 0.5) * strength
      px[i] += n
      px[i + 1] += n
      px[i + 2] += n
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** Dust and hairs on the gate: sparse, bright, and stepping once per few frames. */
function filmDust(canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const step = Math.floor(c.time * 12)
  const specks = Math.round(s.amount * 90)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < specks; i++) {
    const x = hash(i, step, 31) * w
    const y = hash(i, step, 32) * h
    const long = hash(i, step, 33) > 0.82
    ctx.globalAlpha = 0.25 + hash(i, step, 34) * 0.55
    ctx.fillStyle = '#fff'
    if (long) ctx.fillRect(x, y, Math.max(1, c.scale), (2 + hash(i, step, 35) * 14) * c.scale)
    else ctx.fillRect(x, y, Math.max(1, c.scale), Math.max(1, c.scale))
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
 * Bilinear rather than nearest because the subject here is often text. Nearest
 * sampling on a curve turns straight character stems into staircases, and the
 * whole point of the effect is that the letters keep their shape while the
 * screen they sit on does not.
 */
function curvature(canvas: HTMLCanvasElement, s: FxSettings) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const img = ctx.getImageData(0, 0, w, h)
  const src = new Uint8ClampedArray(img.data)
  const px = img.data
  const k = s.amount * 0.28

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
      for (let ch = 0; ch < 4; ch++) {
        const top = src[i00 + ch] * (1 - fx) + src[i10 + ch] * fx
        const bot = src[i01 + ch] * (1 - fx) + src[i11 + ch] * fx
        px[i + ch] = top * (1 - fy) + bot * fy
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** The darkening at the edge of a lens, or of a tube. */
function vignette(canvas: HTMLCanvasElement, s: FxSettings) {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) / 2)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, `rgba(0,0,0,${Math.min(1, s.amount)})`)
  ctx.save()
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

// ----- the chain -----

type FxFn = (canvas: HTMLCanvasElement, s: FxSettings, c: FxContext) => void

/**
 * Every effect, in the order it runs, with what the panel needs to describe it.
 *
 * `cost` is a coarse hint, not a measurement: 'pixel' effects walk the whole
 * frame in JavaScript and are the ones that decide whether 1080p is playable,
 * 'draw' effects hand the work to the compositor and are near enough free. The
 * panel uses it to warn before somebody stacks six pixel passes at full size.
 */
export interface FxSpec {
  id: FxId
  label: string
  hint: string
  cost: 'draw' | 'pixel'
  /** which colour fields the panel should offer for this effect */
  colors?: ('color' | 'color2')[]
  /** true when the effect has a positionable origin */
  positioned?: boolean
  fn: FxFn
}

export const FX_ORDER: FxSpec[] = [
  { id: 'bloom', label: 'Bloom', hint: 'Light spilling off the bright parts.', cost: 'draw', fn: bloom },
  { id: 'chromatic', label: 'Chromatic', hint: 'Red and blue landing a hair apart.', cost: 'pixel', fn: chromatic },
  { id: 'rgbSplit', label: 'RGB Split', hint: 'The same, thrown much further and on both axes.', cost: 'pixel', fn: rgbSplit },
  { id: 'sharpen', label: 'Sharpen', hint: 'Crisps the edges the dither already made.', cost: 'pixel', fn: sharpen },
  { id: 'emboss', label: 'Emboss', hint: 'Edges lit from one side, on flat grey.', cost: 'pixel', fn: emboss },
  { id: 'posterize', label: 'Posterize', hint: 'Fewer levels per channel.', cost: 'pixel', fn: posterize },
  { id: 'pixelate', label: 'Pixelate', hint: 'Square blocks, on top of whatever grid is underneath.', cost: 'draw', fn: pixelate },
  { id: 'halftone', label: 'Halftone', hint: 'A print screen laid over the frame.', cost: 'pixel', fn: halftone },
  { id: 'colorOverlay', label: 'Colour Wash', hint: 'A tint through the midtones.', cost: 'draw', colors: ['color'], fn: colorOverlay },
  { id: 'fog', label: 'Fog', hint: 'Haze thickening toward the top.', cost: 'draw', colors: ['color'], fn: fog },
  { id: 'godRays', label: 'God Rays', hint: 'Highlights smeared away from a point.', cost: 'draw', positioned: true, fn: godRays },
  { id: 'lightLeak', label: 'Light Leak', hint: 'Two coloured blooms burned into the corners.', cost: 'draw', colors: ['color', 'color2'], positioned: true, fn: lightLeak },
  { id: 'blur', label: 'Blur', hint: 'Plain defocus.', cost: 'draw', fn: blur },
  { id: 'zoomBlur', label: 'Zoom Blur', hint: 'Streaked outward from the centre.', cost: 'draw', fn: zoomBlur },
  { id: 'noiseBlur', label: 'Noise Blur', hint: 'Softness with no smoothness, like fast film.', cost: 'pixel', fn: noiseBlur },
  { id: 'waveDistort', label: 'Wave', hint: 'The rows sliding to a sine.', cost: 'draw', fn: waveDistort },
  { id: 'gridLines', label: 'Grid', hint: 'Graph paper over the picture.', cost: 'draw', colors: ['color'], fn: gridLines },
  { id: 'scanlines', label: 'Scanlines', hint: 'The gaps between the rows a tube lit.', cost: 'draw', fn: scanlines },
  { id: 'crtPhosphor', label: 'Phosphor', hint: 'The vertical RGB stripe of a shadow mask.', cost: 'draw', fn: crtPhosphor },
  { id: 'matrixRain', label: 'Rain', hint: 'Falling glyphs, over the top of everything.', cost: 'draw', colors: ['color'], fn: matrixRain },
  { id: 'glitch', label: 'Glitch', hint: 'Bands of the frame tearing sideways.', cost: 'draw', fn: glitch },
  { id: 'invert', label: 'Invert', hint: 'Ink and paper trading places.', cost: 'pixel', fn: invert },
  { id: 'grain', label: 'Grain', hint: 'Film stock, crawling with the frame.', cost: 'pixel', fn: grain },
  { id: 'filmDust', label: 'Dust', hint: 'Specks and hairs on the gate.', cost: 'draw', fn: filmDust },
  { id: 'curvature', label: 'Curvature', hint: 'The bulge of a glass tube.', cost: 'pixel', fn: curvature },
  { id: 'vignette', label: 'Vignette', hint: 'The corners falling away.', cost: 'draw', fn: vignette },
]

export const FX_BY_ID: Record<FxId, FxSpec> = Object.fromEntries(
  FX_ORDER.map((f) => [f.id, f]),
) as Record<FxId, FxSpec>

/** True when the chain would leave the frame untouched, so the caller can skip the copy. */
export function hasFx(chain: FxChain): boolean {
  for (const spec of FX_ORDER) {
    const s = chain[spec.id]
    if (s && s.amount > 0) return true
  }
  return false
}

/** How many whole-frame JavaScript passes the chain costs, which is what stalls a frame. */
export function pixelPasses(chain: FxChain): number {
  let n = 0
  for (const spec of FX_ORDER) {
    const s = chain[spec.id]
    if (s && s.amount > 0 && spec.cost === 'pixel') n++
  }
  return n
}

/** Run the whole chain, in FX_ORDER, skipping anything at zero. */
export function applyFx(canvas: HTMLCanvasElement, chain: FxChain, ctx: FxContext) {
  for (const spec of FX_ORDER) {
    const s = chain[spec.id]
    if (!s || s.amount <= 0) continue
    spec.fn(canvas, s, ctx)
  }
}
