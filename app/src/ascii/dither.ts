/**
 * The dither engine.
 *
 * Two families, and they are genuinely different algorithms rather than two
 * settings of one:
 *
 *   Error diffusion walks the image in reading order, quantises each pixel to
 *   the nearest palette entry, and pushes the difference it just introduced
 *   onto pixels it has not visited yet. It is sequential by definition, which
 *   is why dithering cannot be a per-cell painter like every other style.
 *
 *   Ordered dithering compares each pixel against a fixed threshold mask and
 *   never looks at its neighbours at all. That makes it stateless, tileable and
 *   stable frame to frame, which is why it is the one that survives animation.
 *
 * Both run on an already-downscaled buffer. `scale` is how many source pixels
 * went into one dithered pixel, and doing the reduction first is what gives the
 * chunky look; dithering at full resolution and then shrinking averages the
 * pattern back out into the grey it was avoiding.
 */

import { nearest, type RGB } from './palettes'

/**
 * An error-diffusion kernel: where the error goes, and how much of it.
 *
 * Written as [dx, dy, weight] with weights already divided by their own total,
 * so the inner loop multiplies rather than divides. `dy` is never negative and
 * a `dy` of 0 never has a negative `dx`, because a kernel that pushed error
 * backwards would be pushing it onto pixels that are already final.
 */
type Kernel = { dx: number; dy: number; w: number }[]

const kernel = (rows: number[][], divisor: number): Kernel => {
  const out: Kernel = []
  for (const [dx, dy, w] of rows) out.push({ dx, dy, w: w / divisor })
  return out
}

export const KERNELS: Record<string, Kernel> = {
  'floyd-steinberg': kernel(
    [
      [1, 0, 7],
      [-1, 1, 3],
      [0, 1, 5],
      [1, 1, 1],
    ],
    16,
  ),
  /*
   * Atkinson passes on only six eighths of the error and lets the other quarter
   * evaporate. That is not an oversight in the original, it is the reason the
   * classic Macintosh look has such clean whites and blacks: throwing error
   * away stops it accumulating across a flat region, at the cost of clipping
   * the extremes of the tonal range.
   */
  atkinson: kernel(
    [
      [1, 0, 1],
      [2, 0, 1],
      [-1, 1, 1],
      [0, 1, 1],
      [1, 1, 1],
      [0, 2, 1],
    ],
    8,
  ),
  stucki: kernel(
    [
      [1, 0, 8],
      [2, 0, 4],
      [-2, 1, 2],
      [-1, 1, 4],
      [0, 1, 8],
      [1, 1, 4],
      [2, 1, 2],
      [-2, 2, 1],
      [-1, 2, 2],
      [0, 2, 4],
      [1, 2, 2],
      [2, 2, 1],
    ],
    42,
  ),
  burkes: kernel(
    [
      [1, 0, 8],
      [2, 0, 4],
      [-2, 1, 2],
      [-1, 1, 4],
      [0, 1, 8],
      [1, 1, 4],
      [2, 1, 2],
    ],
    32,
  ),
  'sierra-lite': kernel(
    [
      [1, 0, 2],
      [-1, 1, 1],
      [0, 1, 1],
    ],
    4,
  ),
}

/**
 * A Bayer threshold matrix of side 2^n, built by recursion.
 *
 * The rule is the whole of ordered dithering: a matrix of side 2n is four
 * copies of the matrix of side n, each scaled up by four and offset by a fixed
 * amount that differs per quadrant. Starting from [[0,2],[3,1]] and applying it
 * repeatedly gives the exact matrices quoted in the literature, which is a
 * better guarantee than four hand-typed tables that agree with them.
 */
export function bayer(size: 2 | 4 | 8 | 16): Float32Array {
  let m = [
    [0, 2],
    [3, 1],
  ]
  while (m.length < size) {
    const n = m.length
    const next: number[][] = Array.from({ length: n * 2 }, () => new Array<number>(n * 2).fill(0))
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = m[y][x] * 4
        next[y][x] = v
        next[y][x + n] = v + 2
        next[y + n][x] = v + 3
        next[y + n][x + n] = v + 1
      }
    }
    m = next
  }
  // normalised to 0..1 and centred on 0.5, so a mid-grey lands half on and half off
  const out = new Float32Array(size * size)
  const denom = size * size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) out[y * size + x] = (m[y][x] + 0.5) / denom
  }
  return out
}

/**
 * A blue-noise threshold mask.
 *
 * Blue noise is random with the low frequencies removed, so it has no visible
 * clumps and no visible grid, which is what makes it the one ordered mask that
 * does not stamp a texture of its own onto a photograph. A true void-and-cluster
 * mask is expensive to build; this is the cheap approximation that gets most of
 * the way there, high-pass filtering white noise by repeatedly subtracting a
 * blurred copy of itself and re-ranking the result.
 *
 * Built once and cached, because it is the same mask every time.
 */
let blueNoiseCache: Float32Array | null = null

export function blueNoise(size = 64): Float32Array {
  if (blueNoiseCache) return blueNoiseCache
  const n = size * size
  let field = new Float32Array(n)
  for (let i = 0; i < n; i++) field[i] = Math.random()

  const at = (a: Float32Array, x: number, y: number) =>
    a[((y + size) % size) * size + ((x + size) % size)]

  // three passes of "subtract the local average", which is a high-pass filter
  for (let pass = 0; pass < 3; pass++) {
    const blurred = new Float32Array(n)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) sum += at(field, x + dx, y + dy)
        }
        blurred[y * size + x] = sum / 25
      }
    }
    const next = new Float32Array(n)
    for (let i = 0; i < n; i++) next[i] = field[i] - blurred[i]
    field = next
  }

  /*
   * Rank rather than rescale. The filtered field has a lumpy distribution, and
   * a threshold mask has to be uniform across 0..1 or whole tonal bands snap on
   * at once. Sorting the indices and writing back each one's position in the
   * order forces exactly that uniformity while keeping the spatial arrangement.
   */
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => field[a] - field[b])
  const out = new Float32Array(n)
  for (let rank = 0; rank < n; rank++) out[order[rank]] = (rank + 0.5) / n
  blueNoiseCache = out
  return out
}

/** Ordered masks that are not simple matrices, expressed as a function of position. */
function proceduralThreshold(algo: string, x: number, y: number): number {
  if (algo === 'halftone') {
    /*
     * A classic halftone screen: a dot grid rotated 45 degrees, because an
     * unrotated one lines up with the pixel grid and reads as a plaid. The
     * threshold rises with distance from the centre of the nearest cell, so a
     * dark area grows one solid dot per cell rather than scattering.
     */
    const s = 6
    const u = (x + y) % s
    const v = (x - y + s * 1000) % s
    const dx = u / s - 0.5
    const dy = v / s - 0.5
    return Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2.4)
  }
  if (algo === 'hatch') {
    // engraved lines: one axis carries the whole threshold, so tone becomes stroke weight
    const s = 5
    return ((x + y * 2) % s) / s
  }
  return 0.5
}

/**
 * How far an ordered mask may push a channel before it looks for a neighbour.
 *
 * This is the number that makes ordered dithering work, and getting it wrong is
 * invisible at mid grey and catastrophic everywhere else. Too small and a
 * quarter-tone can never reach the next palette entry, so a flat 25% grey comes
 * out solid black; too large and the mask stops being a threshold and starts
 * being added noise.
 *
 * The right value is the gap between adjacent palette entries, because that is
 * exactly the distance a pixel has to be nudged to change its answer. Measured
 * rather than assumed: palettes are not evenly spaced cubes, so the mean
 * distance from each entry to its nearest neighbour is taken directly, and
 * divided by sqrt(3) to turn a distance through RGB space back into a
 * per-channel one.
 *
 * For 1-bit that lands on 255, which is the textbook "compare the pixel against
 * the mask" rule falling out of the general case rather than being special.
 */
function paletteSpread(pal: RGB[]): number {
  if (pal.length < 2) return 0
  let total = 0
  for (let i = 0; i < pal.length; i++) {
    let best = Infinity
    for (let j = 0; j < pal.length; j++) {
      if (i === j) continue
      const dr = pal[i][0] - pal[j][0]
      const dg = pal[i][1] - pal[j][1]
      const db = pal[i][2] - pal[j][2]
      const d = dr * dr + dg * dg + db * db
      if (d < best) best = d
    }
    total += Math.sqrt(best)
  }
  return total / pal.length / Math.sqrt(3)
}

export interface DitherOptions {
  algo: string
  palette: RGB[]
  serpentine: boolean
  /** 0..1, how much of the error is passed on */
  amount: number
}

/**
 * Quantise `data` in place to the palette, using the chosen algorithm.
 *
 * `data` is RGBA in an ImageData buffer and comes back RGBA, so this drops
 * straight into a canvas without a second copy. Alpha is left exactly as it
 * arrived: dithering decides colour, not what is see-through, and a transparent
 * backdrop has to survive the pass.
 */
export function ditherImage(data: ImageData, opts: DitherOptions) {
  const { width: w, height: h } = data
  const px = data.data
  const pal = opts.palette
  if (pal.length === 0) return

  const ordered = !KERNELS[opts.algo]
  if (ordered) {
    const mask =
      opts.algo === 'bayer2'
        ? bayer(2)
        : opts.algo === 'bayer4'
          ? bayer(4)
          : opts.algo === 'bayer8'
            ? bayer(8)
            : opts.algo === 'bayer16'
              ? bayer(16)
              : opts.algo === 'blue-noise'
                ? blueNoise()
                : null
    const side = mask ? Math.round(Math.sqrt(mask.length)) : 1
    const spread = paletteSpread(pal)

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const t = mask ? mask[(y % side) * side + (x % side)] : proceduralThreshold(opts.algo, x, y)
        const bump = (t - 0.5) * spread * opts.amount
        const c = nearest(pal, px[i] + bump, px[i + 1] + bump, px[i + 2] + bump)
        px[i] = c[0]
        px[i + 1] = c[1]
        px[i + 2] = c[2]
      }
    }
    return
  }

  const k = KERNELS[opts.algo] ?? KERNELS['floyd-steinberg']

  /*
   * The error buffer is float and separate from the pixels.
   *
   * Accumulating error back into the Uint8ClampedArray is the classic bug: it
   * rounds to an integer and clamps to 0..255 after every single addition, so
   * the fractions that make diffusion work are thrown away and the highlights
   * bloom. Carrying it at full precision alongside costs three floats a pixel
   * and is the difference between Floyd-Steinberg and a mess.
   */
  const err = new Float32Array(w * h * 3)

  for (let y = 0; y < h; y++) {
    const rtl = opts.serpentine && y % 2 === 1
    for (let step = 0; step < w; step++) {
      const x = rtl ? w - 1 - step : step
      const i = (y * w + x) * 4
      const e = (y * w + x) * 3

      const r = px[i] + err[e]
      const g = px[i + 1] + err[e + 1]
      const b = px[i + 2] + err[e + 2]

      const c = nearest(pal, r, g, b)
      px[i] = c[0]
      px[i + 1] = c[1]
      px[i + 2] = c[2]

      const dr = (r - c[0]) * opts.amount
      const dg = (g - c[1]) * opts.amount
      const db = (b - c[2]) * opts.amount

      for (const { dx, dy, w: weight } of k) {
        // on a right-to-left row the kernel is mirrored, or the error trails
        // behind the scan instead of ahead of it
        const nx = x + (rtl ? -dx : dx)
        const ny = y + dy
        if (nx < 0 || nx >= w || ny >= h) continue
        const ne = (ny * w + nx) * 3
        err[ne] += dr * weight
        err[ne + 1] += dg * weight
        err[ne + 2] += db * weight
      }
    }
  }
}

export const DITHER_ALGOS: { id: string; label: string; family: 'diffusion' | 'ordered'; hint: string }[] = [
  { id: 'floyd-steinberg', label: 'Floyd-Steinberg', family: 'diffusion', hint: 'The default. Faithful tone, fine grain.' },
  { id: 'atkinson', label: 'Atkinson', family: 'diffusion', hint: 'Throws a quarter of the error away. Clean, contrasty, classic Mac.' },
  { id: 'stucki', label: 'Stucki', family: 'diffusion', hint: 'A wide kernel. The smoothest of the four, and the slowest.' },
  { id: 'burkes', label: 'Burkes', family: 'diffusion', hint: 'Stucki without the third row. Nearly as smooth, twice as quick.' },
  { id: 'sierra-lite', label: 'Sierra Lite', family: 'diffusion', hint: 'Three taps. Fast, and grainier for it.' },
  { id: 'bayer2', label: 'Bayer 2', family: 'ordered', hint: 'A four-step checker. Very coarse.' },
  { id: 'bayer4', label: 'Bayer 4', family: 'ordered', hint: 'The recognisable crosshatch of early PC graphics.' },
  { id: 'bayer8', label: 'Bayer 8', family: 'ordered', hint: 'Fine ordered pattern. Tiles seamlessly.' },
  { id: 'bayer16', label: 'Bayer 16', family: 'ordered', hint: 'The finest ordered mask, close to a smooth ramp.' },
  { id: 'blue-noise', label: 'Blue noise', family: 'ordered', hint: 'Random with no clumps. Natural, and it leaves no grid behind.' },
  { id: 'halftone', label: 'Halftone', family: 'ordered', hint: 'A rotated dot screen. Newsprint and comics.' },
  { id: 'hatch', label: 'Hatch', family: 'ordered', hint: 'Diagonal rules that thicken with tone. Engraved.' },
  { id: 'threshold', label: 'Threshold', family: 'ordered', hint: 'No dithering at all. A hard cut at mid grey.' },
]
