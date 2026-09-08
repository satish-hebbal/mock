/**
 * The field generators.
 *
 * Thirty pure functions, each of which fills a Float32Array with luminance in
 * 0..1 and returns nothing. That signature is the entire contract, and keeping
 * it that narrow is what buys the rest of the tool: a field can be dithered,
 * recoloured, exported as a still, encoded into a video and serialised into a
 * standalone embed without any of those four knowing what it draws.
 *
 * Three notes on the shape of these:
 *
 * `id` is stable and `label` is not. The tool this borrows from keys its
 * effects by display name, so renaming "Dithered Swirl" to "Swirl" silently
 * breaks every saved preset that referenced it. Presets here reference the id,
 * and the label is free to change.
 *
 * A negative value is a sentinel, not a mistake. It means "this pixel is
 * accent", and `quantize.ts` reads it before it reads anything else. Nothing
 * currently ships that uses it, but the path is live so a field can opt in
 * without a change anywhere downstream.
 *
 * Nothing allocates inside a pixel loop. These are called sixty times a second
 * over a buffer that can be two million elements, and a single `new Array` per
 * pixel is the difference between a tool that runs and one that spends its life
 * in the garbage collector. The few generators that need per-frame state build
 * it once above the loop, in a local typed array of a dozen doubles rather than
 * in a module-level scratch buffer: the cost is nil, and staying free of
 * outside state is what lets the embed exporter lift these out of the bundle.
 */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The standard integer hash, used wherever a generator needs a stable roll. */
export const rand = (seed: number) => ((seed * 2654435761) >>> 0) / 4294967296

/**
 * Two-dimensional value noise, and the base of half the fields below.
 *
 * A hashed lattice with a smoothstep between the corners. Not gradient noise:
 * Perlin would cost a dot product per corner and a permutation table, and at
 * two million pixels times four octaves times sixty frames that table lookup is
 * the whole frame budget. Value noise has a slightly blockier character, which
 * a dither pattern hides completely.
 */
export const vnoise = (x: number, y: number) => {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const c = (a: number, b: number) => rand((a * 374761393 + b * 668265263) | 0)
  const a00 = c(xi, yi)
  const a10 = c(xi + 1, yi)
  const a01 = c(xi, yi + 1)
  const a11 = c(xi + 1, yi + 1)
  return (a00 * (1 - u) + a10 * u) * (1 - v) + (a01 * (1 - u) + a11 * u) * v
}

/** Fractal Brownian motion: octaves of `vnoise`, each half the amplitude. */
export const fbm = (x: number, y: number, octaves: number, lacunarity: number, gain: number) => {
  let sum = 0
  let amp = 1
  let norm = 0
  let f = 1
  const n = Math.max(1, Math.round(octaves))
  for (let o = 0; o < n; o++) {
    sum += vnoise(x * f, y * f) * amp
    norm += amp
    amp *= gain
    f *= lacunarity
  }
  return norm > 0 ? sum / norm : 0
}

/** The resolved control values a generator is handed, keyed by its own names. */
export type Params = Record<string, number>

export type FieldFn = (
  buf: Float32Array,
  w: number,
  h: number,
  t: number,
  intensity: number,
  scale: number,
  p: Params,
) => void

export type SourceParam = 'intensity' | 'scale' | 'text' | 'rotate'

/**
 * One control a generator offers, drawn by the panel and stored on the document.
 *
 * `key` is what the generator reads out of its params and is stable; `label` is
 * what the panel shows and is not, exactly as with generator ids. A generator
 * that declares nothing gets the three shared knobs and no more, which is right
 * for the simple ones and wrong for most of the interesting ones.
 */
export interface ParamSpec {
  key: string
  label: string
  min: number
  max: number
  step: number
  value: number
  hint?: string
  /** render as a whole number rather than to two places */
  integer?: boolean
}

export interface FieldSpec {
  id: string
  label: string
  group: string
  hint: string
  /**
   * Which of the shared controls this generator actually reads.
   *
   * The panel asks the generator rather than consulting a list kept somewhere
   * else, so a control can never be shown for an effect that ignores it, and a
   * new effect cannot forget to declare itself.
   */
  uses: SourceParam[]
  /** this generator's own controls, on top of the shared ones */
  params?: ParamSpec[]
  fn: FieldFn
}

const BASE: SourceParam[] = ['intensity', 'scale']

/** Terse constructor, so a parameter table reads as a table. */
export const param = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  hint?: string,
): ParamSpec => ({ key, label, min, max, step, value, hint, integer: step >= 1 })

/** Local alias, so the tables below stay narrow. */
const P = param

// ----- Flow -----

const swirl: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const cx = w / 2
  const cy = h / 2
  const maxR = Math.sqrt(cx * cx + cy * cy)
  const twist = (intensity / 50) * p.twist
  const arms = scale * p.arms
  const fall = p.falloff
  const wobble = Math.sin(t * p.breathe)
  for (let y = 0; y < h; y++) {
    const dy = y - cy
    for (let x = 0; x < w; x++) {
      const dx = x - cx
      const dist = Math.sqrt(dx * dx + dy * dy) / maxR
      const angle = Math.atan2(dy, dx) + dist * twist * wobble
      buf[y * w + x] = clamp01((Math.sin(angle * arms + t * 3) * 0.5 + 0.5) * (1 - dist * fall))
    }
  }
}

const liquid: FieldFn = (buf, w, h, t, intensity, scale) => {
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const ny = (y / h) * scale
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * scale
      const a = Math.sin(nx * 3 + t * 1.5) * Math.cos(ny * 2 - t * 0.7)
      const b = Math.sin((nx + ny) * 2 - t * 1.2) * 0.5
      const c = Math.cos(nx * 1.5 - ny * 3 + t * 0.8) * 0.3
      buf[y * w + x] = clamp01((a + b + c) * amp * 0.4 + 0.5)
    }
  }
}

const mirage: FieldFn = (buf, w, h, t, intensity, scale) => {
  const amp = intensity / 100
  for (let y = 0; y < h; y++) {
    const ny = y / h
    const distort = Math.sin(ny * scale * 8 + t * 3) * amp * 0.04
    const fade = 1 - Math.abs(ny - 0.5) * 0.8
    for (let x = 0; x < w; x++) {
      const sx = x / w + distort
      const heat =
        Math.sin(sx * scale * 6 + t * 2) * 0.3 + Math.sin(ny * scale * 4 - t * 1.5) * 0.3 + 0.4
      buf[y * w + x] = clamp01(heat * fade)
    }
  }
}

const plasma: FieldFn = (buf, w, h, t, intensity, scale) => {
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const ny = (y / h) * scale
    const v2 = Math.sin(ny * 4 + t * 1.3)
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * scale
      const v1 = Math.sin(nx * 4 + t)
      const v3 = Math.sin((nx + ny) * 3 + t * 0.7)
      const v4 = Math.sin(Math.sqrt(nx * nx + ny * ny) * 6 - t * 2)
      buf[y * w + x] = clamp01(((v1 + v2 + v3 + v4) / 4) * amp * 0.5 + 0.5)
    }
  }
}

const aurora: FieldFn = (buf, w, h, t, intensity, scale) => {
  const amp = intensity / 40
  for (let y = 0; y < h; y++) {
    const ny = y / h
    const vertFade = Math.exp(-((ny - 0.3) ** 2) * 4)
    const bend1 = Math.sin(ny * 4 + t * 0.3) * 2
    const bend2 = Math.cos(ny * 3 + t * 0.5) * 1.5
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * scale
      const w1 = Math.sin(nx * 3 + t * 0.8 + bend1)
      const w2 = Math.sin(nx * 5 - t * 0.6 + bend2)
      const w3 = Math.sin(nx * 2 + t * 1.2 + ny * 6)
      buf[y * w + x] = clamp01((((w1 + w2 + w3) / 3) * 0.5 + 0.5) * vertFade * amp)
    }
  }
}

const smoke: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 40
  const oct = Math.max(1, Math.round(p.octaves))
  for (let y = 0; y < h; y++) {
    const ny = (y / h) * scale
    const rise = ny + t * p.rise
    const vertFade = Math.exp(-((y / h - 0.5) ** 2) * 3)
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * scale
      let v = 0
      let a = 1
      let f = 1
      for (let o = 0; o < oct; o++) {
        v += Math.sin(nx * f * 4 + rise * f * 3 + o) * Math.cos(nx * f * 3 - rise * f * 2 + o * 1.7) * a
        a *= 0.5
        f *= p.lacunarity
      }
      buf[y * w + x] = clamp01((v * 0.4 + 0.5) * vertFade * amp)
    }
  }
}

const particleFlow: FieldFn = (buf, w, h, t, intensity, scale) => {
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const ny = (y / h) * scale * 2
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * scale * 2
      const angle = Math.sin(nx * 2 + t) * Math.cos(ny * 3 - t * 0.5) * Math.PI * 2
      const streamline = Math.sin((nx * Math.cos(angle) + ny * Math.sin(angle)) * 20 + t * 3)
      buf[y * w + x] = clamp01((streamline * 0.5 + 0.5) * amp)
    }
  }
}

/*
 * Five balls, three numbers each, laid out flat rather than as objects.
 *
 * Built per frame rather than into a module-level scratch buffer. Fifteen
 * doubles is nothing next to the pixel loop below it, and keeping the function
 * free of outside state is what lets the embed exporter serialise it: a
 * generator that reaches for a module variable cannot be lifted out of the
 * bundle and dropped into somebody's page.
 */
const metaballs: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const n = Math.max(1, Math.round(p.count))
  const spread = p.spread
  const balls = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    balls[i * 3] = w * 0.5 + Math.sin(t * (0.5 + i * 0.3) + i * 2) * w * spread
    balls[i * 3 + 1] = h * 0.5 + Math.cos(t * (0.4 + i * 0.2) + i * 3) * h * spread
    const r = ((30 + i * 10) * scale * p.size) / 4
    balls[i * 3 + 2] = r * r
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let i = 0; i < n; i++) {
        const dx = x - balls[i * 3]
        const dy = y - balls[i * 3 + 1]
        sum += balls[i * 3 + 2] / (dx * dx + dy * dy + 1)
      }
      buf[y * w + x] = clamp01((sum > 1 ? 1 : sum * sum) * amp)
    }
  }
}

const gravity: FieldFn = (buf, w, h, t, intensity, scale) => {
  const amp = intensity / 50
  const ax = w * 0.5 + Math.sin(t * 0.7) * w * 0.15
  const ay = h * 0.5 + Math.cos(t * 0.5) * h * 0.15
  const bx = w * 0.5 - Math.sin(t * 0.7) * w * 0.15
  const by = h * 0.5 - Math.cos(t * 0.5) * h * 0.15
  const m1 = w * 0.5
  const m2 = 0.7 * w * 0.5
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d1 = Math.sqrt((x - ax) ** 2 + (y - ay) ** 2) + 1
      const d2 = Math.sqrt((x - bx) ** 2 + (y - by) ** 2) + 1
      const force = m1 / d1 + m2 / d2
      buf[y * w + x] = clamp01((Math.sin(force * scale * 0.5 - t * 3) * 0.5 + 0.5) * amp)
    }
  }
}

// ----- Rings -----

const ripple: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const cx = w / 2
  const cy = h / 2
  const rings = scale * p.rings
  const period = w / rings
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const dy = y - cy
    for (let x = 0; x < w; x++) {
      const dx = x - cx
      const dist = Math.sqrt(dx * dx + dy * dy)
      const r = Math.sin((dist / period) * Math.PI * 2 - t * p.rate) * 0.5 + 0.5
      buf[y * w + x] = clamp01(r * Math.exp(-dist / (w * p.decay)) * amp)
    }
  }
}

const concentric: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const cx = w / 2
  const cy = h / 2
  const pulse = Math.sin(t * p.breathe) * p.depth + (1 - p.depth)
  const amp = intensity / 50
  const freq = scale * p.rings
  const t5 = t * 5
  const halfW = w * 0.5
  for (let y = 0; y < h; y++) {
    const dy = y - cy
    for (let x = 0; x < w; x++) {
      const dx = x - cx
      const norm = Math.sqrt(dx * dx + dy * dy) / halfW
      const rings = Math.sin(norm * freq - t5) * 0.5 + 0.5
      buf[y * w + x] = clamp01(rings * Math.max(0, 1 - norm) * pulse * amp)
    }
  }
}

const heartbeat: FieldFn = (buf, w, h, t, intensity, scale) => {
  const cx = w / 2
  const cy = h / 2
  const amp = intensity / 50
  const beat = Math.pow(Math.sin(t * 3) * 0.5 + 0.5, 3)
  const pulse = 1 + beat * 0.3 * amp
  const rx = w * 0.3 * pulse
  const ry = h * 0.3 * pulse
  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / ry
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / rx
      const dist = Math.sqrt(dx * dx + dy * dy)
      const ring = Math.sin(dist * scale * 8 - t * 5) * 0.5 + 0.5
      const glow = Math.exp(-dist * 2)
      const shock = Math.exp(-Math.abs(dist - beat * 2) * 10) * beat
      buf[y * w + x] = clamp01((ring * 0.4 + glow * 0.4 + shock * 0.4) * amp)
    }
  }
}

/* Four wave sources, flat: x, y, freq, phase. Built per frame, for the same
   reason metaballs builds its own above. */
const interference: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const spacing = w / scale / 8
  const n = Math.max(2, Math.round(p.sources))
  const orbit = p.orbit
  /*
   * The sources sit on a ring and drift round it. The original picked four
   * fixed positions, which meant the count could not be a control at all:
   * a fifth source has nowhere obvious to go. On a ring, turning the count up
   * rearranges nothing and the pattern stays recognisable while it densifies.
   */
  const src = new Float64Array(n * 4)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283185 + t * orbit * 0.15
    src[i * 4] = w * (0.5 + Math.cos(a) * p.spread)
    src[i * 4 + 1] = h * (0.5 + Math.sin(a) * p.spread)
    src[i * 4 + 2] = 0.8 + (i % 3) * 0.25
    src[i * 4 + 3] = (i * Math.PI) / n
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let i = 0; i < n; i++) {
        const dx = x - src[i * 4]
        const dy = y - src[i * 4 + 1]
        const d = Math.sqrt(dx * dx + dy * dy)
        sum += Math.sin((d / spacing) * Math.PI * 2 * src[i * 4 + 2] - t * 3 + src[i * 4 + 3])
      }
      buf[y * w + x] = clamp01((sum / n) * 0.5 * amp + 0.5)
    }
  }
}

const diamond: FieldFn = (buf, w, h, t, intensity, scale) => {
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const ny = (y / h - 0.5) * scale
    for (let x = 0; x < w; x++) {
      const nx = (x / w - 0.5) * scale
      const d = Math.abs(nx) + Math.abs(ny)
      const wave = Math.sin(d * 12 - t * 4) * 0.5 + 0.5
      buf[y * w + x] = clamp01(wave * Math.exp(-d * 0.5) * amp)
    }
  }
}

// ----- Depth -----

const tunnel: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const cx = w / 2
  const cy = h / 2
  const amp = intensity / 50
  const half = w * 0.5
  for (let y = 0; y < h; y++) {
    const dy = y - cy
    for (let x = 0; x < w; x++) {
      const dx = x - cx
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 1) {
        buf[y * w + x] = 0
        continue
      }
      const depth = half / dist
      const u = Math.atan2(dy, dx) / Math.PI
      const v = depth * scale - t * p.rush
      const checker = Math.sin(u * p.spokes) * Math.sin(v * p.rings) * 0.5 + 0.5
      buf[y * w + x] = clamp01(checker * Math.min(1, depth * 2) * amp)
    }
  }
}

const drift: FieldFn = (buf, w, h, t, intensity, scale) => {
  const cx = w / 2
  const cy = h / 2
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / h
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / w
      const dist = Math.sqrt(dx * dx + dy * dy)
      const angle = Math.atan2(dy, dx)
      const z1 = 0.5 / (dist + 0.01) - t * 2
      const z2 = 0.3 / (dist + 0.01) - t * 1.3
      const l1 = Math.sin(angle * scale + z1 * 3) * 0.5 + 0.5
      const l2 = Math.sin(angle * (scale + 2) + z2 * 4) * 0.3
      buf[y * w + x] = clamp01((l1 + l2) * Math.min(1, 1 / (dist * 4 + 0.1)) * amp)
    }
  }
}

const vortex: FieldFn = (buf, w, h, t, intensity, scale) => {
  const cx = w / 2
  const cy = h / 2
  const maxR = w * 0.5
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const dy = y - cy
    for (let x = 0; x < w; x++) {
      const dx = x - cx
      const dist = Math.sqrt(dx * dx + dy * dy)
      const norm = dist / maxR
      const spin = Math.atan2(dy, dx) + (1 - norm) * t * 3 * amp
      const pattern = Math.sin(spin * scale) * 0.5 + 0.5
      const radial = Math.sin(norm * scale * 6 - t * 2) * 0.3 + 0.7
      buf[y * w + x] = clamp01(pattern * radial * Math.max(0, 1 - norm))
    }
  }
}

const galaxy: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const cx = w / 2
  const cy = h / 2
  const maxR = Math.sqrt(cx * cx + cy * cy)
  const arms = Math.max(1, Math.round(p.arms))
  const amp = intensity / 50
  const wind = p.wind
  for (let y = 0; y < h; y++) {
    const dy = y - cy
    for (let x = 0; x < w; x++) {
      const dx = x - cx
      const dist = Math.sqrt(dx * dx + dy * dy) / maxR
      const angle = Math.atan2(dy, dx)
      const spiral = Math.sin(angle * arms + dist * wind - t * 2) * 0.5 + 0.5
      const core = Math.exp(-dist * p.core)
      const dust = Math.sin(dist * scale * 6 + angle * 5 - t) * p.dust
      buf[y * w + x] = clamp01((spiral * 0.6 + core * 0.4) * amp + dust)
    }
  }
}

const kaleidoscope: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const cx = w / 2
  const cy = h / 2
  const segments = Math.max(2, Math.round(p.mirrors))
  const sector = (2 * Math.PI) / segments
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const dy = y - cy
    for (let x = 0; x < w; x++) {
      const dx = x - cx
      const dist = Math.sqrt(dx * dx + dy * dy) / w
      // fold the angle into one wedge, then mirror it: that fold is the mirror
      // in the tube, and doing it on the angle alone is what keeps the seams
      // meeting exactly rather than nearly
      const raw = Math.atan2(dy, dx) + t * 0.5
      const angle = Math.abs((((raw % sector) + sector) % sector) - sector / 2)
      const px = dist * Math.cos(angle)
      const py = dist * Math.sin(angle)
      const pattern = Math.sin(px * scale * 7 + t * 2) * Math.cos(py * scale * 7 - t * 1.5)
      buf[y * w + x] = clamp01((pattern * 0.5 + 0.5) * amp * Math.max(0, 1 - dist * 1.2))
    }
  }
}

/**
 * A Julia set, orbiting its own parameter.
 *
 * Capped at twenty iterations, which is low for a still and right for sixty
 * frames a second: the extra bands a deeper escape count would draw are finer
 * than the dither grid can resolve anyway, so they cost time and land on the
 * same side of the threshold.
 */
const fractal: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const cx = w / 2
  const cy = h / 2
  const zoom = Math.exp(Math.sin(t * 0.5) * p.breathe) * scale * 0.5
  const sin03 = Math.sin(t * 0.3)
  const cos03 = Math.cos(t * 0.3)
  const panX = sin03 * 0.5 - 0.5
  const panY = cos03 * 0.5
  const cr = -0.7 + Math.sin(t * 0.2) * 0.1
  const ci = 0.27 + cos03 * 0.05
  const amp = intensity / 50
  const stepX = 3 / (zoom * w)
  const stepY = 3 / (zoom * h)

  for (let y = 0; y < h; y++) {
    const zi0 = (y - cy) * stepY + panY
    for (let x = 0; x < w; x++) {
      let zr = (x - cx) * stepX + panX
      let zi = zi0
      let iter = 0
      const maxIter = Math.max(2, Math.round(p.iters))
      while (zr * zr + zi * zi < 4 && iter < maxIter) {
        const tmp = zr * zr - zi * zi + cr
        zi = 2 * zr * zi + ci
        zr = tmp
        iter++
      }
      buf[y * w + x] = clamp01((iter / maxIter) * amp)
    }
  }
}

// ----- Grid -----

const warpGrid: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const size = scale * p.cells
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const ny = y / h
    for (let x = 0; x < w; x++) {
      const nx = x / w
      const wx = nx + Math.sin(ny * 8 + t * 2) * p.bend * amp
      const wy = ny + Math.cos(nx * 8 + t * 1.7) * p.bend * amp
      const gx = Math.abs(Math.sin(wx * size * Math.PI))
      const gy = Math.abs(Math.sin(wy * size * Math.PI))
      const g = Math.min(gx, gy)
      buf[y * w + x] = g < p.weight ? 1 : g < p.weight * 1.9 ? 0.5 : 0
    }
  }
}

const checker: FieldFn = (buf, w, h, t, intensity, scale) => {
  const amp = intensity / 50
  const cell = scale * 4
  for (let y = 0; y < h; y++) {
    const ny = y / h - 0.5
    for (let x = 0; x < w; x++) {
      const nx = x / w - 0.5
      const dist = Math.sqrt(nx * nx + ny * ny)
      const wx = x + Math.sin(dist * 10 - t * 3) * 10 * amp
      const wy = y + Math.cos(dist * 10 - t * 3) * 10 * amp
      const cx = Math.floor(wx / cell)
      const cy = Math.floor(wy / cell)
      buf[y * w + x] = (cx + cy) % 2 === 0 ? 0.9 : 0.1
    }
  }
}

const topographic: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const ny = (y / h) * scale
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * scale
      const elevation =
        Math.sin(nx * 3 + t * 0.5) * Math.cos(ny * 2 + t * 0.3) * 0.5 +
        Math.sin(nx * 7 + ny * 5 + t * 0.2) * 0.25 +
        Math.sin((nx + ny) * 4 - t * 0.4) * 0.25
      const contour = Math.abs(Math.sin(elevation * p.levels))
      buf[y * w + x] = clamp01(((contour < p.weight ? 1 : 0) * 0.8 + (elevation * 0.5 + 0.5) * p.fill) * amp)
    }
  }
}

/**
 * A cell grid flipping on a rule that reads its four neighbours.
 *
 * Not a real automaton: there is no previous generation, only a hash of the
 * cell and of the frame index, so nothing evolves and nothing can be seeded.
 * That is deliberate. A true automaton needs the last frame's buffer, which
 * would make the export path stateful and mean scrubbing to a time no longer
 * gives the frame that was there. This looks like Life and is a function of t.
 */
const cellular: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const cell = Math.max(2, Math.floor(scale * 2))
  const phase = Math.floor(t * p.rate)
  const amp = intensity / 50
  const at = (cx: number, cy: number) => rand((cx * 48271 + cy * 16807 + phase * 65521) | 0)

  for (let y = 0; y < h; y++) {
    const cy = Math.floor(y / cell)
    for (let x = 0; x < w; x++) {
      const cx = Math.floor(x / cell)
      const self = at(cx, cy)
      const neighbours = (at(cx - 1, cy) + at(cx + 1, cy) + at(cx, cy - 1) + at(cx, cy + 1)) / 4
      // clamped, unlike every other line here that multiplies by amp: a live
      // cell is already 1, so above 50 intensity this would write 2 and hand
      // the dither a value it has no way to represent
      buf[y * w + x] = (self > p.bias) !== (neighbours > 0.55) ? clamp01(amp) : 0
    }
  }
}

// ----- Signal -----

const matrixField: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const cols = Math.max(1, Math.floor(w / (scale * 2 + 2)))
  const cellW = w / cols
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const ny = y / h
    for (let x = 0; x < w; x++) {
      const col = Math.floor(x / cellW)
      const seed = col * 7919 + 1013
      const speed = ((seed * 2654435761) >>> 0) % 100 / 50 + 0.5
      const offset = ((seed * 2246822519) >>> 0) % 1000 / 1000
      const drop = (ny + t * speed * p.fall + offset) % 1
      const flicker = Math.sin(y * 0.5 + t * 10 + col) * p.flicker + (1 - p.flicker)
      buf[y * w + x] = clamp01(Math.exp(-drop * p.trail) * amp * flicker)
    }
  }
}

const pixelRain: FieldFn = (buf, w, h, t, intensity, scale) => {
  const colW = Math.max(1, Math.floor(scale))
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const ny = y / h
    for (let x = 0; x < w; x++) {
      const seed = Math.floor(x / colW) * 1013
      const h1 = rand(seed)
      const h2 = rand(seed + 777)
      const len = h2 * 0.3 + 0.05
      const pos = ((t * (h1 * 2 + 0.5) * 0.5 + h1 * 10) % 1.5) - 0.25
      const inDrop = ny > pos && ny < pos + len
      const fade = inDrop ? Math.exp((-(ny - pos) / len) * 2) : 0
      const bg = Math.sin(x * 0.1 + y * 0.05 + t) * 0.05 + 0.05
      buf[y * w + x] = clamp01(fade * amp + bg)
    }
  }
}

const scanField: FieldFn = (buf, w, h, t, intensity, scale) => {
  const gap = Math.max(2, scale * 2)
  const amp = intensity / 50
  for (let y = 0; y < h; y++) {
    const line = Math.sin(((y + t * 100) / gap) * Math.PI) * 0.5 + 0.5
    const sweep = Math.sin((y / h - t * 0.3) * Math.PI * 2) * 0.5 + 0.5
    const flicker = Math.sin(t * 30 + y * 0.1) * 0.05
    for (let x = 0; x < w; x++) {
      const hScan = Math.sin((x / w) * 3 + t * 0.5) * 0.2 + 0.8
      buf[y * w + x] = clamp01((line * hScan * (sweep * 0.5 + 0.5) + flicker) * amp)
    }
  }
}

const glitchBlocks: FieldFn = (buf, w, h, t, intensity, scale) => {
  const blockH = Math.max(2, Math.floor(scale * 3))
  const blockW = Math.max(4, Math.floor(scale * 6))
  const step = Math.floor(t * 8)
  const chance = intensity / 200
  for (let y = 0; y < h; y++) {
    const by = Math.floor(y / blockH)
    for (let x = 0; x < w; x++) {
      const bx = Math.floor(x / blockW)
      const roll = rand((bx * 31337 + by * 7919 + step * 4987) | 0)
      if (roll < chance) {
        const sx = x + (Math.floor(roll * 20) - 10) * scale
        buf[y * w + x] = ((sx * 17 + y * 31 + step * 53) & 255) / 255 > 0.5 ? 1 : 0
      } else {
        buf[y * w + x] = clamp01(Math.sin((x / w) * 4 + t) * 0.3 + 0.4)
      }
    }
  }
}

const electric: FieldFn = (buf, w, h, t, intensity, scale) => {
  const amp = intensity / 50
  const p1x = w * 0.3 + Math.sin(t * 1.3) * w * 0.1
  const p1y = h * 0.4 + Math.cos(t * 0.9) * h * 0.1
  const p2x = w * 0.7 + Math.sin(t * 0.7 + 2) * w * 0.1
  const p2y = h * 0.6 + Math.cos(t * 1.1 + 1) * h * 0.1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d1 = Math.sqrt((x - p1x) ** 2 + (y - p1y) ** 2) / w
      const d2 = Math.sqrt((x - p2x) ** 2 + (y - p2y) ** 2) / w
      const field = 1 / (d1 * scale + 0.1) + 1 / (d2 * scale + 0.1)
      const norm = (field * 0.1) / 2
      const lines = Math.sin(Math.atan2(y - p1y, x - p1x) * 8 + d1 * scale * 20 - t * 4)
      buf[y * w + x] = clamp01((norm * 0.3 + lines * 0.3 + 0.3) * amp)
    }
  }
}

/**
 * Layered value noise, standing in for a terrain height map.
 *
 * The octaves are built from a sine-and-fract hash rather than from real
 * gradient noise. It is not Perlin and does not tile, but it is four multiplies
 * per octave with no lookup table, which at four octaves over two million
 * pixels is the difference between this being usable at 1080p and not.
 */
const terrain: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const freq = scale * 0.5
  const amp = intensity / 50
  const oct = Math.max(1, Math.round(p.octaves))
  const gain = p.gain
  const lac = p.lacunarity
  for (let y = 0; y < h; y++) {
    const ny = (y / h) * freq
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * freq + t * p.drift
      let v = 0
      let a = 1
      let f = 1
      let norm = 0
      for (let o = 0; o < oct; o++) {
        const s = Math.sin(nx * f * 3.17 + ny * f * 2.71 + o * 5.13) * 43758.5453
        v += (s - Math.floor(s)) * a
        norm += a
        a *= gain
        f *= lac
      }
      buf[y * w + x] = clamp01((v / norm) * amp)
    }
  }
}

// ----- Structure -----

/**
 * Domain warping: noise whose *coordinates* are themselves noise.
 *
 * Inigo Quilez's construction. `fbm(p)` is a cloud; `fbm(p + fbm(p))` is a
 * cloud that has been dragged through another cloud, and one more round of it
 * gives the marbled, rope-like filaments that no amount of octaves on a plain
 * fbm will produce. The whole trick is three nested calls, and it is the single
 * best return on arithmetic in generative imaging.
 *
 * Three nested calls is twelve noise lookups a sample, which is more than a
 * megapixel a frame can afford at full resolution. The renderer is what pays
 * for that, through the shared Detail control: the field is sampled coarsely
 * and interpolated, and only the dither runs at full size.
 */
const warp: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const oct = p.octaves
  const k = p.warp
  const gain = p.gain
  const sx = scale / w
  const sy = scale / h
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x * sx
      const ny = y * sy
      const q1 = fbm(nx + t * 0.12, ny, oct, 2, gain)
      const q2 = fbm(nx + 5.2, ny + 1.3 - t * 0.09, oct, 2, gain)
      const r1 = fbm(nx + k * q1 * 4 + 1.7, ny + k * q2 * 4 + 9.2, oct, 2, gain)
      const v = fbm(nx + k * r1 * 4, ny + k * q2 * 4 + 3.1, oct, 2, gain)
      buf[y * w + x] = clamp01((v - 0.5) * 2 * amp + 0.5)
    }
  }
}

/**
 * A quasicrystal: N plane waves at equally spaced angles, summed.
 *
 * With three waves you get a hex lattice and with four a square one, but at
 * five and above no translation maps the pattern onto itself and it never
 * repeats, exactly as a Penrose tiling never repeats. It is the cheapest way to
 * get genuine aperiodic order out of arithmetic: one cosine per wave, and the
 * interference does the rest.
 *
 * The angles drift with the clock, which is what turns a still lattice into
 * something that breathes without ever settling into a loop.
 */
const quasicrystal: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const n = Math.max(2, Math.round(p.waves))
  const freq = scale * 4
  // the wave normals are the same for every pixel, so they are resolved once
  const dirs = new Float64Array(n * 2)
  for (let i = 0; i < n; i++) {
    const a = (i * Math.PI) / n + t * p.drift * 0.1
    dirs[i * 2] = Math.cos(a)
    dirs[i * 2 + 1] = Math.sin(a)
  }
  const phase = t * p.rate
  for (let y = 0; y < h; y++) {
    const ny = (y / h - 0.5) * freq
    for (let x = 0; x < w; x++) {
      const nx = (x / w - 0.5) * freq
      let sum = 0
      for (let i = 0; i < n; i++) sum += Math.cos(nx * dirs[i * 2] + ny * dirs[i * 2 + 1] + phase)
      buf[y * w + x] = clamp01((sum / n) * amp * 0.9 + 0.5)
    }
  }
}

/**
 * Chladni figures: the nodal lines of a vibrating square plate.
 *
 * Sand scattered on a bowed plate collects where the plate is not moving, and
 * those curves are the zero set of cos(nπx)cos(mπy) - cos(mπx)cos(nπy). Two
 * integers pick the mode, and the whole family of shapes falls out of them.
 *
 * The separable form is the reason this is fast: every term depends on x alone
 * or y alone, so two tables of width w and two scalars per row replace four
 * cosines per pixel.
 */
const chladni: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const sweep = Math.sin(t * 0.25) * p.sweep
  const m = p.m + sweep
  const n = p.n - sweep
  const sharp = p.sharp

  const cmx = new Float64Array(w)
  const cnx = new Float64Array(w)
  for (let x = 0; x < w; x++) {
    const u = (x / w) * scale * 0.5
    cmx[x] = Math.cos(m * Math.PI * u)
    cnx[x] = Math.cos(n * Math.PI * u)
  }

  for (let y = 0; y < h; y++) {
    const v = (y / h) * scale * 0.5
    const cmy = Math.cos(m * Math.PI * v)
    const cny = Math.cos(n * Math.PI * v)
    for (let x = 0; x < w; x++) {
      const s = cnx[x] * cmy - cmx[x] * cny
      // sand piles up where the plate is still, so brightness is the *inverse*
      // of how far this point is from a node
      buf[y * w + x] = clamp01(Math.pow(1 - Math.min(1, Math.abs(s)), sharp) * amp)
    }
  }
}

/**
 * Worley noise: distance to scattered feature points.
 *
 * Steven Worley's 1996 construction. Each cell of a lattice holds one site;
 * a pixel finds the nearest (F1) and second nearest (F2) across its own cell
 * and the eight around it. F1 alone gives soft blobs, and F2 minus F1 gives the
 * crisp Voronoi edges, which is why `Edges` blends between them rather than
 * picking one: the interesting images are in the middle.
 *
 * The sites orbit their cells, so the cell walls slide and re-form rather than
 * the whole field sliding past.
 */
const worley: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const cells = Math.max(1, scale * p.density)
  const edges = p.edges
  const jitter = p.jitter

  /*
   * The sites are built once, into a grid, before a single pixel is touched.
   *
   * Where each site sits depends on its cell and on the clock, and on nothing
   * else. Computing it inside the sample loop meant two sines and two cosines
   * per neighbour per pixel: eighteen trig calls to place about forty points,
   * a million times over, which made this the most expensive generator in the
   * tool by a factor of two. There are `cols * rows` sites and there are a
   * million pixels, and the two numbers are nowhere near each other.
   *
   * The grid is padded by one cell on every side so the neighbour lookup never
   * needs a bounds test in the inner loop.
   */
  const cols = Math.ceil(cells) + 3
  const rows = Math.ceil(cells) + 3
  const sites = new Float64Array(cols * rows * 2)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = i - 1
      const cy = j - 1
      const rx = rand((cx * 73856093 + cy * 19349663) | 0)
      const ry = rand((cx * 83492791 + cy * 29399371) | 0)
      const k = (j * cols + i) * 2
      sites[k] = cx + 0.5 + Math.sin(t * 0.6 + rx * 6.283) * 0.5 * jitter
      sites[k + 1] = cy + 0.5 + Math.cos(t * 0.5 + ry * 6.283) * 0.5 * jitter
    }
  }

  const kx = cells / w
  const ky = cells / h
  for (let y = 0; y < h; y++) {
    const fy = y * ky
    const iy = Math.floor(fy)
    for (let x = 0; x < w; x++) {
      const fx = x * kx
      const ix = Math.floor(fx)
      let f1 = 9
      let f2 = 9
      for (let j = -1; j <= 1; j++) {
        const gy = iy + j + 1
        if (gy < 0 || gy >= rows) continue
        const row = gy * cols
        for (let i = -1; i <= 1; i++) {
          const gx = ix + i + 1
          if (gx < 0 || gx >= cols) continue
          const k = (row + gx) * 2
          const dx = fx - sites[k]
          const dy = fy - sites[k + 1]
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < f1) {
            f2 = f1
            f1 = d
          } else if (d < f2) f2 = d
        }
      }
      buf[y * w + x] = clamp01(((1 - edges) * (1 - f1) + edges * (f2 - f1)) * amp)
    }
  }
}

/**
 * Newton's method on z^k - 1, coloured by how long it takes to land.
 *
 * Every starting point falls into one of k roots, and the boundary between the
 * basins is a fractal with k-fold symmetry. Cayley asked which point goes where
 * in 1879 and the answer turned out to be one of the first fractals anybody
 * drew.
 *
 * The complex power is done by repeated multiplication rather than through
 * polar form. Two `pow` calls and four trig calls per iteration, times fifteen
 * iterations, is not affordable; eight multiplications is.
 */
const newton: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const k = Math.max(2, Math.round(p.roots))
  const iters = Math.max(1, Math.round(p.iters))
  const zoom = 3 / Math.max(0.2, scale * 0.35)
  const spin = t * p.spin * 0.2
  const cs = Math.cos(spin)
  const sn = Math.sin(spin)
  const aspect = h / w

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x / w - 0.5) * zoom
      const v = (y / h - 0.5) * zoom * aspect
      let zr = u * cs - v * sn
      let zi = u * sn + v * cs
      let hit = iters

      for (let i = 0; i < iters; i++) {
        // zp = z^(k-1), by k-2 multiplications
        let pr = 1
        let pi = 0
        for (let j = 0; j < k - 1; j++) {
          const nr = pr * zr - pi * zi
          pi = pr * zi + pi * zr
          pr = nr
        }
        const kr = pr * zr - pi * zi
        const ki = pr * zi + pi * zr
        const nr2 = kr - 1
        const dr = k * pr
        const di = k * pi
        const dd = dr * dr + di * di
        if (dd < 1e-12) break
        const sx = (nr2 * dr + ki * di) / dd
        const sy = (ki * dr - nr2 * di) / dd
        zr -= sx
        zi -= sy
        if (sx * sx + sy * sy < 1e-8) {
          hit = i
          break
        }
      }
      buf[y * w + x] = clamp01((1 - hit / iters) * amp)
    }
  }
}

/**
 * A Julia set coloured by orbit traps rather than by escape time.
 *
 * Escape time gives the familiar banded rings. An orbit trap asks a different
 * question: as the point iterates, how close does its path ever come to some
 * shape? Trapping on a cross draws the filaments as sharp threads, trapping on
 * a circle draws them as bubbles, and the result looks nothing like the escape
 * time picture of the same set.
 *
 * `Trap` blends the two shapes, which is not a standard thing to do and is
 * where most of the good images turn out to be.
 */
const orbitTrap: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const iters = Math.max(2, Math.round(p.iters))
  const trap = p.trap
  const ring = p.ring
  const sharp = p.sharp
  // the parameter orbits, which walks the set through its whole family of shapes
  const cr = Math.cos(t * 0.15) * p.orbit - 0.4
  const ci = Math.sin(t * 0.21) * p.orbit
  const zoom = 3 / Math.max(0.2, scale * 0.5)
  const aspect = h / w

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let zr = (x / w - 0.5) * zoom
      let zi = (y / h - 0.5) * zoom * aspect
      let best = 1e9
      for (let i = 0; i < iters; i++) {
        const nr = zr * zr - zi * zi + cr
        zi = 2 * zr * zi + ci
        zr = nr
        const mag2 = zr * zr + zi * zi
        if (mag2 > 16) break
        const cross = Math.min(Math.abs(zr), Math.abs(zi))
        const circle = Math.abs(Math.sqrt(mag2) - ring)
        const d = cross * (1 - trap) + circle * trap
        if (d < best) best = d
      }
      buf[y * w + x] = clamp01((1 - Math.min(1, best * sharp)) * amp)
    }
  }
}

/**
 * Curl noise: a flow field that cannot have sources or sinks.
 *
 * Take the gradient of a scalar potential and rotate it a quarter turn, and the
 * result is divergence free by construction: nothing piles up and nothing drains
 * away. Bridson's 2007 trick, and the reason smoke in films looks like smoke.
 *
 * The flow is shown by displacing a stripe field along it rather than by
 * advecting particles, because particles need memory of where they were and
 * these generators are not allowed any.
 */
const curl: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const oct = p.octaves
  const push = p.push
  const freq = p.stripes
  const sx = scale / w
  const sy = scale / h
  const e = 0.03

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x * sx
      const ny = y * sy
      const dpdy = fbm(nx + t * 0.1, ny + e, oct, 2, 0.5) - fbm(nx + t * 0.1, ny - e, oct, 2, 0.5)
      const dpdx = fbm(nx + e + t * 0.1, ny, oct, 2, 0.5) - fbm(nx - e + t * 0.1, ny, oct, 2, 0.5)
      // the quarter turn: (dp/dy, -dp/dx)
      const vx = dpdy / (2 * e)
      const vy = -dpdx / (2 * e)
      const s = Math.sin((nx + vx * push) * freq + (ny + vy * push) * freq * 0.6 + t)
      buf[y * w + x] = clamp01((s * 0.5 + 0.5) * amp)
    }
  }
}

/**
 * Moiré: two rulings laid over each other, turning slowly.
 *
 * The beat between two gratings a few degrees apart is enormously lower in
 * frequency than either grating, which is why a tiny change in angle sweeps a
 * huge change across the frame. Multiplying rather than adding is what gives
 * the hard interference fringes instead of a soft blur.
 *
 * `Shape` bends each ruling from straight lines toward concentric rings, which
 * is the same effect a printer gets by rotating a halftone screen.
 */
const moire: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const pitch = scale * p.pitch * 6.283
  const a1 = t * p.spin * 0.1
  const a2 = a1 + (p.angle * Math.PI) / 180
  const c1 = Math.cos(a1)
  const s1 = Math.sin(a1)
  const c2 = Math.cos(a2)
  const s2 = Math.sin(a2)
  const shape = p.shape
  const off = p.offset

  for (let y = 0; y < h; y++) {
    const v = (y - h / 2) / w
    for (let x = 0; x < w; x++) {
      const u = (x - w / 2) / w
      const r1 = Math.sqrt((u - off) * (u - off) + v * v)
      const r2 = Math.sqrt((u + off) * (u + off) + v * v)
      const l1 = u * c1 + v * s1
      const l2 = (u - off) * c2 + v * s2
      const g1 = Math.cos((l1 * (1 - shape) + r1 * shape) * pitch)
      const g2 = Math.cos((l2 * (1 - shape) + r2 * shape) * pitch)
      buf[y * w + x] = clamp01((g1 * g2 * 0.5 + 0.5) * amp)
    }
  }
}

/**
 * Gerstner waves: the standard model of a deep water surface.
 *
 * Real swell is not a sine. Water particles move in circles rather than up and
 * down, which piles the crests into sharp peaks and stretches the troughs flat,
 * and Gerstner's 1802 solution captures that with a steepness term. Summing a
 * few at different headings gives a sea rather than a corrugation.
 */
const swell: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const n = Math.max(1, Math.round(p.waves))
  const steep = p.steepness
  const spread = p.spread
  const base = scale * 2

  const wav = new Float64Array(n * 4)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * spread + p.heading * 0.0174
    wav[i * 4] = Math.cos(a)
    wav[i * 4 + 1] = Math.sin(a)
    wav[i * 4 + 2] = base * (1 + i * 0.6)
    wav[i * 4 + 3] = 1 / (1 + i * 0.5)
  }

  for (let y = 0; y < h; y++) {
    const ny = y / h
    for (let x = 0; x < w; x++) {
      const nx = x / w
      let sum = 0
      let norm = 0
      for (let i = 0; i < n; i++) {
        const k = wav[i * 4 + 2]
        const phase = (nx * wav[i * 4] + ny * wav[i * 4 + 1]) * k - t * Math.sqrt(k) * 0.6
        const c = Math.cos(phase)
        // the steepness term sharpens crests and flattens troughs
        sum += (c + steep * c * Math.abs(c)) * wav[i * 4 + 3]
        norm += (1 + steep) * wav[i * 4 + 3]
      }
      buf[y * w + x] = clamp01((sum / norm) * amp * 0.8 + 0.5)
    }
  }
}

/**
 * Ridged multifractal terrain.
 *
 * Musgrave's variant: fold each octave about zero and square it, so the smooth
 * humps of ordinary fbm become sharp creases, and weight each octave by the one
 * above so ridges only branch where the coarse shape is already high. That
 * feedback is what separates a mountain range from a noisy blanket.
 */
const ridge: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const oct = Math.max(1, Math.round(p.octaves))
  const lac = p.lacunarity
  const gain = p.gain
  const offset = p.offset
  const sx = scale / w
  const sy = scale / h

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let f = 1
      let a = 0.5
      let weight = 1
      let sum = 0
      let norm = 0
      for (let o = 0; o < oct; o++) {
        let n = vnoise(x * sx * f + t * 0.08, y * sy * f)
        n = offset - Math.abs(n * 2 - 1)
        n *= n
        n *= weight
        // each octave is gated by the one above it, so detail follows the ridges
        weight = Math.min(1, n * gain * 2)
        sum += n * a
        norm += a
        a *= gain
        f *= lac
      }
      buf[y * w + x] = clamp01((sum / norm) * amp)
    }
  }
}

/**
 * Repeated circle inversion, coloured by how many reflections it took.
 *
 * Reflect a point through a circle, then through the next, and keep going until
 * it lands outside all of them. Points near the limit set of the group take
 * many reflections and points far away take none, so the count alone draws the
 * fractal. This is how Kleinian and Apollonian pictures are made, and it is
 * about fifteen lines of arithmetic.
 */
const inversion: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const n = Math.max(2, Math.round(p.circles))
  const ring = p.spread
  const rad = p.radius
  const r2 = rad * rad
  const passes = Math.max(1, Math.round(p.passes))
  const zoom = 3 / Math.max(0.2, scale * 0.5)
  const aspect = h / w

  const cs = new Float64Array(n * 2)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283185 + t * p.spin * 0.1
    cs[i * 2] = Math.cos(a) * ring
    cs[i * 2 + 1] = Math.sin(a) * ring
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let px = (x / w - 0.5) * zoom
      let py = (y / h - 0.5) * zoom * aspect
      let count = 0
      for (let it = 0; it < passes; it++) {
        let moved = false
        for (let i = 0; i < n; i++) {
          const dx = px - cs[i * 2]
          const dy = py - cs[i * 2 + 1]
          const d2 = dx * dx + dy * dy
          if (d2 < r2 && d2 > 1e-9) {
            const k = r2 / d2
            px = cs[i * 2] + dx * k
            py = cs[i * 2 + 1] + dy * k
            count++
            moved = true
          }
        }
        if (!moved) break
      }
      buf[y * w + x] = clamp01((count / passes) * amp * p.contrast)
    }
  }
}

/**
 * A Fresnel zone plate: cos of the squared radius.
 *
 * Because the phase grows with r squared, the rings get finer the further out
 * they go, and at some radius they pass what the pixel grid can carry and alias
 * into a second, coarser set of rings running the other way. That aliasing is
 * usually a bug. Here the dither is going to quantise everything anyway, so it
 * is the point: a zone plate over a dither mask is one of the few places where
 * two sampling grids fight and the result is worth keeping.
 */
const zonePlate: FieldFn = (buf, w, h, t, intensity, scale, p) => {
  const amp = intensity / 50
  const k = scale * p.focal * 40
  const wander = p.wander
  const cx = w / 2 + Math.sin(t * 0.3) * w * wander
  const cy = h / 2 + Math.cos(t * 0.23) * h * wander
  const phase = t * p.rate
  const squeeze = p.squeeze

  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / w
    for (let x = 0; x < w; x++) {
      const dx = ((x - cx) / w) * squeeze
      buf[y * w + x] = clamp01((Math.cos((dx * dx + dy * dy) * k - phase) * 0.5 + 0.5) * amp)
    }
  }
}

/**
 * The catalogue.
 *
 * Grouped by what the pattern *is*, not by how it is computed, because that is
 * how anybody looks for one. Structure holds the six that come out of a piece
 * of named mathematics rather than out of a stack of sine waves, and they are
 * the ones worth reaching for first.
 */
export const FIELDS: FieldSpec[] = [
  // ----- Structure -----
  {
    id: 'warp',
    label: 'Warp',
    group: 'Structure',
    hint: 'Noise dragged through noise. Marbled filaments.',
    uses: BASE,
    params: [
      P('warp', 'Warp', 0, 2.5, 0.01, 0.9, 'How far each layer drags the next'),
      P('octaves', 'Octaves', 1, 5, 1, 3),
      P('gain', 'Gain', 0.2, 0.8, 0.01, 0.5, 'How much each octave keeps of the last'),
    ],
    fn: warp,
  },
  {
    id: 'quasicrystal',
    label: 'Quasicrystal',
    group: 'Structure',
    hint: 'Plane waves at equal angles. Above four, it never repeats.',
    uses: BASE,
    params: [
      P('waves', 'Waves', 2, 12, 1, 5, 'Three is hexagonal, four square, five and up aperiodic'),
      P('drift', 'Drift', 0, 2, 0.01, 0.35, 'How fast the angles turn'),
      P('rate', 'Rate', 0, 4, 0.01, 1),
    ],
    fn: quasicrystal,
  },
  {
    id: 'chladni',
    label: 'Chladni',
    group: 'Structure',
    hint: 'Where sand settles on a vibrating plate.',
    uses: BASE,
    params: [
      P('m', 'Mode m', 1, 16, 1, 4),
      P('n', 'Mode n', 1, 16, 1, 7),
      P('sweep', 'Sweep', 0, 6, 0.05, 1.5, 'How far the modes drift either side'),
      P('sharp', 'Sharpness', 1, 24, 0.5, 8, 'How tightly the sand hugs the nodes'),
    ],
    fn: chladni,
  },
  {
    id: 'worley',
    label: 'Worley',
    group: 'Structure',
    hint: 'Distance to scattered points. Cells, or the walls between them.',
    uses: BASE,
    params: [
      P('density', 'Density', 0.4, 6, 0.05, 1.4),
      P('edges', 'Edges', 0, 1, 0.01, 0.65, 'Blobs at 0, Voronoi walls at 1'),
      P('jitter', 'Jitter', 0, 1, 0.01, 0.6, 'How far the sites orbit their cells'),
    ],
    fn: worley,
  },
  {
    id: 'newton',
    label: 'Newton',
    group: 'Structure',
    hint: 'Which root a point falls into. The boundary is a fractal.',
    uses: BASE,
    params: [
      P('roots', 'Roots', 3, 9, 1, 5, 'The k in z^k minus 1, and the symmetry you get'),
      P('iters', 'Steps', 4, 40, 1, 18),
      P('spin', 'Spin', 0, 3, 0.01, 0.5),
    ],
    fn: newton,
  },
  {
    id: 'orbit',
    label: 'Orbit Trap',
    group: 'Structure',
    hint: 'A Julia set drawn by how close its path comes to a shape.',
    uses: BASE,
    params: [
      P('trap', 'Trap', 0, 1, 0.01, 0.35, 'A cross at 0, a circle at 1'),
      P('ring', 'Ring', 0.1, 2, 0.01, 0.6, 'Radius of the circular trap'),
      P('sharp', 'Sharpness', 0.5, 20, 0.1, 6),
      P('iters', 'Steps', 4, 60, 1, 24),
      P('orbit', 'Wander', 0, 1, 0.01, 0.35, 'How far the parameter travels'),
    ],
    fn: orbitTrap,
  },
  {
    id: 'inversion',
    label: 'Inversion',
    group: 'Structure',
    hint: 'Reflected through circles until it escapes. Apollonian.',
    uses: BASE,
    params: [
      P('circles', 'Circles', 2, 8, 1, 4),
      P('radius', 'Radius', 0.3, 1.6, 0.01, 0.85),
      P('spread', 'Spread', 0.2, 1.6, 0.01, 0.8, 'How far the circles sit from centre'),
      P('passes', 'Passes', 2, 30, 1, 14),
      P('contrast', 'Contrast', 0.5, 6, 0.05, 2.2),
      P('spin', 'Spin', 0, 3, 0.01, 0.6),
    ],
    fn: inversion,
  },

  // ----- Flow -----
  {
    id: 'curl',
    label: 'Curl',
    group: 'Flow',
    hint: 'Flow with no sources and no sinks. Smoke behaves like this.',
    uses: BASE,
    params: [
      P('push', 'Push', 0, 1.5, 0.01, 0.35, 'How far the flow drags the stripes'),
      P('stripes', 'Stripes', 1, 24, 0.1, 7),
      P('octaves', 'Octaves', 1, 4, 1, 2),
    ],
    fn: curl,
  },
  {
    id: 'swell',
    label: 'Swell',
    group: 'Flow',
    hint: 'Gerstner waves: sharp crests, flat troughs, like real water.',
    uses: BASE,
    params: [
      P('waves', 'Waves', 1, 8, 1, 4),
      P('steepness', 'Steepness', 0, 1, 0.01, 0.55, 'How far from a sine it leans'),
      P('spread', 'Spread', 0, 3.14, 0.01, 1.1, 'How much the headings fan out'),
      P('heading', 'Heading', 0, 360, 1, 30),
    ],
    fn: swell,
  },
  {
    id: 'ridge',
    label: 'Ridge',
    group: 'Flow',
    hint: 'Folded noise. Mountain ranges rather than hills.',
    uses: BASE,
    params: [
      P('octaves', 'Octaves', 1, 7, 1, 5),
      P('lacunarity', 'Lacunarity', 1.5, 3.2, 0.01, 2.1, 'Frequency step per octave'),
      P('gain', 'Gain', 0.3, 1, 0.01, 0.65),
      P('offset', 'Offset', 0.6, 1.4, 0.01, 1, 'Raises or drowns the ridge lines'),
    ],
    fn: ridge,
  },
  { id: 'swirl', label: 'Swirl', group: 'Flow', hint: 'A twist that winds tighter toward the edge.', uses: BASE,
    params: [P('arms', 'Arms', 0.5, 8, 0.1, 1), P('twist', 'Twist', 0, 12, 0.1, 4), P('falloff', 'Falloff', 0, 1, 0.01, 0.3), P('breathe', 'Breathe', 0, 5, 0.01, 2)], fn: swirl },
  { id: 'liquid', label: 'Liquid', group: 'Flow', hint: 'Three waves crossing, slowly.', uses: BASE, fn: liquid },
  { id: 'mirage', label: 'Mirage', group: 'Flow', hint: 'Heat shimmer over a horizon.', uses: BASE, fn: mirage },
  { id: 'plasma', label: 'Plasma', group: 'Flow', hint: 'The demoscene classic. Reads well at every scale.', uses: BASE, fn: plasma },
  { id: 'aurora', label: 'Aurora', group: 'Flow', hint: 'Curtains bending across the upper third.', uses: BASE, fn: aurora },
  { id: 'smoke', label: 'Smoke', group: 'Flow', hint: 'Octaves rising through the frame.', uses: BASE,
    params: [P('octaves', 'Octaves', 1, 7, 1, 5), P('rise', 'Rise', 0, 2, 0.01, 0.5), P('lacunarity', 'Lacunarity', 1.5, 3, 0.01, 2.1)], fn: smoke },
  { id: 'particle-flow', label: 'Flow Field', group: 'Flow', hint: 'Streamlines through a turning vector field.', uses: BASE, fn: particleFlow },
  { id: 'metaballs', label: 'Metaballs', group: 'Flow', hint: 'Blobs merging and parting.', uses: BASE,
    params: [P('count', 'Count', 1, 12, 1, 5), P('size', 'Size', 0.3, 3, 0.01, 1), P('spread', 'Spread', 0.05, 0.6, 0.01, 0.3)], fn: metaballs },
  { id: 'gravity', label: 'Gravity', group: 'Flow', hint: 'Space bending round two masses.', uses: BASE, fn: gravity },

  // ----- Rings -----
  {
    id: 'zone',
    label: 'Zone Plate',
    group: 'Rings',
    hint: 'Rings that get finer outward until the pixel grid fights back.',
    uses: BASE,
    params: [
      P('focal', 'Focal', 0.2, 6, 0.01, 1.4, 'How fast the rings tighten'),
      P('rate', 'Rate', 0, 8, 0.01, 2),
      P('wander', 'Wander', 0, 0.4, 0.005, 0.06),
      P('squeeze', 'Squeeze', 0.3, 3, 0.01, 1, 'Circular at 1, elliptical either side'),
    ],
    fn: zonePlate,
  },
  {
    id: 'moire',
    label: 'Moire',
    group: 'Rings',
    hint: 'Two rulings a few degrees apart, beating against each other.',
    uses: BASE,
    params: [
      P('pitch', 'Pitch', 0.5, 20, 0.1, 6),
      P('angle', 'Angle', 0, 45, 0.1, 4, 'Degrees between the two rulings'),
      P('spin', 'Spin', 0, 4, 0.01, 0.5),
      P('shape', 'Shape', 0, 1, 0.01, 0, 'Straight lines at 0, rings at 1'),
      P('offset', 'Offset', 0, 0.5, 0.005, 0.08, 'How far apart their centres sit'),
    ],
    fn: moire,
  },
  { id: 'ripple', label: 'Ripple', group: 'Rings', hint: 'Rings out from the centre, falling away.', uses: BASE,
    params: [P('rings', 'Rings', 0.5, 12, 0.1, 2), P('rate', 'Rate', 0, 12, 0.1, 4), P('decay', 'Decay', 0.05, 2, 0.01, 0.4)], fn: ripple },
  { id: 'concentric', label: 'Pulse', group: 'Rings', hint: 'Rings that breathe as they travel.', uses: BASE,
    params: [P('rings', 'Rings', 1, 24, 0.5, 8), P('breathe', 'Breathe', 0, 8, 0.05, 3), P('depth', 'Depth', 0, 1, 0.01, 0.3)], fn: concentric },
  { id: 'heartbeat', label: 'Heartbeat', group: 'Rings', hint: 'A cubed sine, so the beat has a kick.', uses: BASE, fn: heartbeat },
  { id: 'interference', label: 'Interference', group: 'Rings', hint: 'Sources on a ring, drifting round it.', uses: BASE,
    params: [P('sources', 'Sources', 2, 12, 1, 4), P('spread', 'Spread', 0.05, 0.5, 0.01, 0.25), P('orbit', 'Orbit', 0, 3, 0.01, 1)], fn: interference },
  { id: 'diamond', label: 'Diamond', group: 'Rings', hint: 'Rings on a Manhattan metric, so they square off.', uses: BASE, fn: diamond },

  // ----- Depth -----
  { id: 'tunnel', label: 'Tunnel', group: 'Depth', hint: 'A checkered throat running away from you.', uses: BASE,
    params: [P('spokes', 'Spokes', 2, 40, 1, 12), P('rings', 'Rings', 1, 20, 0.5, 4), P('rush', 'Rush', 0, 10, 0.05, 3)], fn: tunnel },
  { id: 'drift', label: 'Drift', group: 'Depth', hint: 'Two tunnel layers at different speeds.', uses: BASE, fn: drift },
  { id: 'vortex', label: 'Vortex', group: 'Depth', hint: 'Shear: the middle turns faster than the rim.', uses: BASE, fn: vortex },
  { id: 'galaxy', label: 'Galaxy', group: 'Depth', hint: 'Arms winding out of a bright core.', uses: BASE,
    params: [P('arms', 'Arms', 1, 12, 1, 2), P('wind', 'Wind', 0, 40, 0.5, 12), P('core', 'Core', 0.5, 10, 0.1, 3), P('dust', 'Dust', 0, 0.4, 0.005, 0.1)], fn: galaxy },
  { id: 'kaleidoscope', label: 'Kaleidoscope', group: 'Depth', hint: 'The frame folded into mirrored wedges.', uses: BASE,
    params: [P('mirrors', 'Mirrors', 2, 24, 1, 6)], fn: kaleidoscope },
  { id: 'fractal', label: 'Julia', group: 'Depth', hint: 'A Julia set orbiting its own parameter.', uses: BASE,
    params: [P('iters', 'Steps', 4, 80, 1, 20), P('breathe', 'Breathe', 0, 4, 0.01, 2)], fn: fractal },

  // ----- Grid -----
  { id: 'warp-grid', label: 'Warp Grid', group: 'Grid', hint: 'Graph paper pushed out of true.', uses: BASE,
    params: [P('cells', 'Cells', 1, 12, 0.5, 3), P('bend', 'Bend', 0, 0.3, 0.005, 0.05), P('weight', 'Weight', 0.01, 0.4, 0.005, 0.08)], fn: warpGrid },
  { id: 'checker', label: 'Checker', group: 'Grid', hint: 'Squares dragged around by a ripple.', uses: BASE, fn: checker },
  { id: 'topographic', label: 'Contour', group: 'Grid', hint: 'Height lines over a drifting landscape.', uses: BASE,
    params: [P('levels', 'Levels', 3, 60, 1, 15), P('weight', 'Weight', 0.02, 0.4, 0.005, 0.1), P('fill', 'Fill', 0, 1, 0.01, 0.3)], fn: topographic },
  { id: 'cellular', label: 'Cells', group: 'Grid', hint: 'A neighbour rule, stepped a few times a second.', uses: BASE,
    params: [P('rate', 'Rate', 0.2, 20, 0.1, 3), P('bias', 'Bias', 0.2, 0.8, 0.01, 0.5)], fn: cellular },

  // ----- Signal -----
  { id: 'matrix', label: 'Rain', group: 'Signal', hint: 'Columns falling at their own speeds.', uses: BASE,
    params: [P('trail', 'Trail', 0.5, 12, 0.1, 3), P('fall', 'Fall', 0, 3, 0.01, 0.5), P('flicker', 'Flicker', 0, 0.6, 0.01, 0.1)], fn: matrixField },
  { id: 'pixel-rain', label: 'Drops', group: 'Signal', hint: 'Longer streaks, sparser columns.', uses: BASE, fn: pixelRain },
  { id: 'scan', label: 'Scan', group: 'Signal', hint: 'A tube being drawn, one line at a time.', uses: BASE, fn: scanField },
  { id: 'glitch-blocks', label: 'Corrupt', group: 'Signal', hint: 'Blocks of the frame replaced with noise.', uses: BASE, fn: glitchBlocks },
  { id: 'electric', label: 'Arc', group: 'Signal', hint: 'Field lines between two wandering poles.', uses: BASE, fn: electric },
  { id: 'terrain', label: 'Terrain', group: 'Signal', hint: 'Octaves of value noise, scrolling.', uses: BASE,
    params: [P('octaves', 'Octaves', 1, 7, 1, 4), P('gain', 'Gain', 0.2, 0.9, 0.01, 0.5), P('lacunarity', 'Lacunarity', 1.4, 3.2, 0.01, 2), P('drift', 'Drift', 0, 2, 0.01, 0.3)], fn: terrain },
]

/**
 * Fill in a generator's own defaults for anything the document does not carry.
 *
 * Documents store only the controls that have been moved, so this is what turns
 * a sparse patch into the complete record a generator can read without checking
 * every key. Called once per frame by the renderer, never inside a pixel loop.
 *
 * A value that is not a finite number falls back to the default rather than
 * reaching the generator: a NaN in one control propagates through the whole
 * frame and produces a blank canvas with no clue as to why.
 */
export function resolveParams(specs: ParamSpec[] | undefined, stored?: Params): Params {
  const out: Params = {}
  if (!specs) return out
  for (const ps of specs) {
    // `stored` is optional on purpose. The store normalises documents on the
    // way in so it should always be present, but this runs inside render and a
    // throw here takes the whole app down rather than one control, which is
    // exactly what happened once already.
    const v = stored?.[ps.key]
    out[ps.key] = typeof v === 'number' && Number.isFinite(v) ? v : ps.value
  }
  return out
}

export const FIELD_BY_ID = new Map(FIELDS.map((f) => [f.id, f]))

/**
 * The only two module-level names a field body may reference.
 *
 * The embed exporter lifts a generator out of the bundle with `toString()` and
 * drops it into a standalone page, where nothing else from this module exists.
 * It emits these two alongside it, keyed by `Function.prototype.name` so the
 * declarations match whatever the minifier renamed the call sites to.
 *
 * Adding a third helper and forgetting to list it here produces a field that
 * works in the app and throws in an embed, so `scripts/verify-signal.mjs`
 * checks every generator against this list rather than trusting it.
 */
export const FIELD_HELPERS: Function[] = [clamp01, rand, vnoise, fbm]

export const FIELD_GROUPS = ['Structure', 'Flow', 'Rings', 'Depth', 'Grid', 'Signal'] as const
