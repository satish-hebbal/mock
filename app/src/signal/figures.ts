/**
 * The figure generators.
 *
 * Where a field writes luminance and lets `quantize.ts` decide what colour that
 * becomes, a figure draws straight onto the 2D context with strokes, arcs and
 * glyphs. It skips the whole quantize stage, because there is no buffer to
 * threshold: the marks are already the picture.
 *
 * That is a real difference and not an implementation detail, so the panel says
 * so. A figure cannot be dithered, and the mask, threshold and spread controls
 * are hidden rather than shown doing nothing.
 *
 * Every figure declares what it reads in `uses`. Two of them want a line of
 * text and two want the rotation controls, and the panel decides what to show
 * by asking the generator. The tool this borrows from keeps that knowledge in a
 * hardcoded array of display names near the top of its app file, which means a
 * rename silently removes a control from an effect that still needs it.
 */

import { hexRgb, type RGB } from './quantize'
import type { SignalInk, SignalMotion } from './types'
import { fbm, rand, vnoise, param, type Params, type ParamSpec, type SourceParam } from './fields'

export type FigureFn = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  intensity: number,
  scale: number,
  ink: { fg: RGB; bg: RGB; accent: RGB },
  motion: SignalMotion,
  p: Params,
) => void

export interface FigureSpec {
  id: string
  label: string
  group: string
  hint: string
  uses: SourceParam[]
  /** this generator's own controls, on top of the shared ones */
  params?: ParamSpec[]
  fn: FigureFn
}

const BASE: SourceParam[] = ['intensity', 'scale']
const WITH_TEXT: SourceParam[] = ['intensity', 'scale', 'text']
const WITH_ROTATE: SourceParam[] = ['intensity', 'scale', 'rotate']

const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

/**
 * The one trig hash these all share.
 *
 * `sin(n * k) * 43758` and take the fraction. It is not a good hash by any
 * statistical measure, and it is the right one here: every figure needs stable
 * pseudo-random layout that is identical in the preview and in frame 400 of an
 * export, and this gives that with no table, no state and no seeding ritual.
 */
function thash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

function thash2(n: number) {
  const s = Math.sin(n * 269.5 + 183.3) * 43758.5453
  return s - Math.floor(s)
}

/** Rx then Ry then Rz, written out rather than assembled into a matrix. */
function rotate3D(
  px: number,
  py: number,
  pz: number,
  rx: number,
  ry: number,
  rz: number,
): [number, number, number] {
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const y1 = py * cx - pz * sx
  const z1 = py * sx + pz * cx
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const x1 = px * cy + z1 * sy
  const z2 = -px * sy + z1 * cy
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  return [x1 * cz - y1 * sz, x1 * sz + y1 * cz, z2]
}

function ground(ctx: CanvasRenderingContext2D, w: number, h: number, bg: RGB) {
  ctx.fillStyle = rgb(bg)
  ctx.fillRect(0, 0, w, h)
}

// ----- Points -----

const dotTunnel: FigureFn = (ctx, w, h, t, intensity, scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const cx = w / 2
  const cy = h / 2
  const rings = Math.max(2, Math.round(p.rings))
  const maxR = Math.min(w, h) * 0.48
  const amp = intensity / 50

  for (let ring = 0; ring < rings; ring++) {
    const k = ring / rings
    const radius = maxR * (0.08 + k * 0.92)
    const count = Math.floor(p.dots * (0.4 + k * 0.6))
    const rotSpeed = (1 - k) * p.shear * amp
    const size = (1 + k * 3) * (scale / 4)
    ctx.fillStyle = rgba(ink.fg, 0.3 + k * 0.7)
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + t * rotSpeed
      const wobble = Math.sin(t * 3 + ring * 0.5 + i * 0.2) * 3 * amp
      ctx.beginPath()
      ctx.arc(cx + Math.cos(angle) * (radius + wobble), cy + Math.sin(angle) * (radius + wobble), size, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

const dotGrid: FigureFn = (ctx, w, h, t, intensity, scale, ink) => {
  ground(ctx, w, h, ink.bg)
  const gap = Math.max(8, scale * 4)
  const cols = Math.floor(w / gap)
  const rows = Math.floor(h / gap)
  const maxSize = gap * 0.4
  const amp = intensity / 50
  const cx = w / 2
  const cy = h / 2
  const phase = t * 0.5
  // the shape the enlarged dots spell out morphs between a circle and a square
  const shapeR = 0.25 + Math.sin(phase) * 0.1
  const squareness = Math.sin(phase * 2) * 0.5 + 0.5

  for (let r = 0; r < rows; r++) {
    const y = gap / 2 + r * gap
    const dy = (y - cy) / h
    for (let c = 0; c < cols; c++) {
      const x = gap / 2 + c * gap
      const dx = (x - cx) / w
      const dist = Math.sqrt(dx * dx + dy * dy)
      const test = dist * (1 - squareness) + Math.max(Math.abs(dx), Math.abs(dy)) * squareness
      const inside = test < shapeR
      const wave = Math.sin(dist * 20 - t * 3) * 0.5 + 0.5
      const size = inside ? 1.5 + (maxSize - 1.5) * wave * amp : 1.5 + wave * amp
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fillStyle = rgba(ink.fg, inside ? 0.8 + wave * 0.2 : 0.3)
      ctx.fill()
    }
  }
}

const dotBloom: FigureFn = (ctx, w, h, t, intensity, scale, ink) => {
  ground(ctx, w, h, ink.bg)
  const cx = w / 2
  const cy = h / 2
  const amp = intensity / 50
  const rings = Math.floor(8 + scale * 2)
  const maxR = Math.min(w, h) * 0.44

  for (let ring = 1; ring <= rings; ring++) {
    const radius = (ring / rings) * maxR
    const count = Math.floor(ring * 6)
    const bloom = Math.sin(t * 2 * amp - ring * 0.4) * 0.5 + 0.5
    const maxSize = (3 + (rings - ring) * 0.5) * (scale / 4)
    const size = 1 + bloom * maxSize
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + ring * 0.2
      const x = cx + Math.cos(angle) * radius
      const y = cy + Math.sin(angle) * radius
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fillStyle = rgba(ink.fg, 0.3 + bloom * 0.7)
      ctx.fill()
      if (size > 2) {
        ctx.beginPath()
        ctx.arc(x, y, size + 2, 0, Math.PI * 2)
        ctx.strokeStyle = rgba(ink.fg, (1 - bloom) * 0.4)
        ctx.lineWidth = 0.5
        ctx.stroke()
      }
    }
  }
}

/**
 * A sphere shaded by dot size rather than by tone.
 *
 * The lit fraction of each cell stands in for brightness, which is what a
 * halftone screen does and what makes this read as printed rather than
 * rendered. The surface normal is exact (z from the unit sphere), so the
 * terminator lands where it should as the light swings round.
 */
const ditherSphere: FigureFn = (ctx, w, h, t, intensity, scale, ink) => {
  ground(ctx, w, h, ink.bg)
  const cx = w / 2
  const cy = h / 2
  const radius = Math.min(w, h) * 0.35
  const gap = Math.max(4, Math.floor(scale * 1.5))
  const amp = intensity / 50
  const lx = Math.cos(t * 0.8) * 0.6
  const ly = Math.sin(t * 0.8) * 0.6 - 0.3
  const maxDot = gap * 0.45

  ctx.fillStyle = rgb(ink.fg)
  for (let y = 0; y < h; y += gap) {
    const dy = (y - cy) / radius
    for (let x = 0; x < w; x += gap) {
      const dx = (x - cx) / radius
      const d2 = dx * dx + dy * dy
      if (d2 > 1) continue
      const nz = Math.sqrt(1 - d2)
      const lit = Math.max(0, dx * lx + dy * ly + nz * 0.8) * amp
      const size = maxDot * lit
      if (size <= 0.3) continue
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// ----- Lines -----

const network: FigureFn = (ctx, w, h, t, intensity, _scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const cx = w / 2
  const cy = h / 2
  const amp = intensity / 50
  const count = Math.max(3, Math.round(p.nodes))
  const xs: number[] = []
  const ys: number[] = []
  const sizes: number[] = []
  const pulses: number[] = []

  for (let i = 0; i < count; i++) {
    const baseAngle = thash(i) * Math.PI * 2
    const baseDist = thash2(i) * 0.4 + 0.05
    const angle = baseAngle + t * 0.3 * (i % 2 === 0 ? 1 : -1) * amp
    const dist = baseDist + Math.sin(t * 0.5 + i) * 0.05 * amp
    xs.push(cx + Math.cos(angle) * dist * w)
    ys.push(cy + Math.sin(angle) * dist * h)
    sizes.push(2 + (1 - baseDist) * 6)
    pulses.push(Math.sin(t * 2 + i * 0.5) * 0.5 + 0.5)
  }

  ctx.lineWidth = 1
  for (let i = 0; i < count; i++) {
    ctx.strokeStyle = rgba(ink.fg, 0.2 + pulses[i] * 0.15)
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(xs[i], ys[i])
    ctx.stroke()
  }

  // near neighbours get their own thread; O(n^2) is fine at this node count
  const near = w * p.reach
  ctx.strokeStyle = rgba(ink.fg, 0.08)
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dx = xs[i] - xs[j]
      const dy = ys[i] - ys[j]
      if (Math.sqrt(dx * dx + dy * dy) >= near) continue
      ctx.moveTo(xs[i], ys[i])
      ctx.lineTo(xs[j], ys[j])
    }
  }
  ctx.stroke()

  for (let i = 0; i < count; i++) {
    ctx.beginPath()
    ctx.arc(xs[i], ys[i], sizes[i] * (0.8 + pulses[i] * 0.4), 0, Math.PI * 2)
    ctx.fillStyle = rgba(ink.fg, 0.6 + pulses[i] * 0.4)
    ctx.fill()
  }

  ctx.beginPath()
  ctx.arc(cx, cy, 6 + Math.sin(t * 2) * 2, 0, Math.PI * 2)
  ctx.fillStyle = rgb(ink.fg)
  ctx.fill()
}

const constellation: FigureFn = (ctx, w, h, t, intensity, _scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const amp = intensity / 50
  const count = Math.max(4, Math.round(p.stars))
  const connect = w * p.reach
  const xs: number[] = []
  const ys: number[] = []
  const sizes: number[] = []
  const twinkles: number[] = []

  for (let i = 0; i < count; i++) {
    xs.push(thash(i) * w + Math.sin(t * 0.3 + i * 0.7) * 15 * amp)
    ys.push(thash2(i) * h + Math.cos(t * 0.4 + i * 0.5) * 15 * amp)
    sizes.push(1 + ((i * 7) % 4))
    twinkles.push(Math.sin(t * 3 + i * 2) * 0.5 + 0.5)
  }

  ctx.lineWidth = 0.5
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dx = xs[i] - xs[j]
      const dy = ys[i] - ys[j]
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist >= connect) continue
      ctx.strokeStyle = rgba(ink.fg, (1 - dist / connect) * 0.3)
      ctx.beginPath()
      ctx.moveTo(xs[i], ys[i])
      ctx.lineTo(xs[j], ys[j])
      ctx.stroke()
    }
  }

  for (let i = 0; i < count; i++) {
    ctx.beginPath()
    ctx.arc(xs[i], ys[i], sizes[i] * (0.6 + twinkles[i] * 0.6), 0, Math.PI * 2)
    ctx.fillStyle = rgba(ink.fg, 0.5 + twinkles[i] * 0.5)
    ctx.fill()
  }
}

const orbits: FigureFn = (ctx, w, h, t, intensity, _scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const cx = w / 2
  const cy = h / 2
  const amp = intensity / 50
  const count = Math.max(1, Math.round(p.orbits))

  for (let o = 0; o < count; o++) {
    const radius = 30 + (o * (Math.min(w, h) * 0.4 * p.spread)) / count
    const tilt = p.tilt + o * 0.1
    const angle = t * (1 + o * 0.2) * amp + (o * Math.PI) / count
    const cosR = Math.cos(o * 0.3)
    const sinR = Math.sin(o * 0.3)

    ctx.beginPath()
    ctx.ellipse(cx, cy, radius, radius * tilt, o * 0.3, 0, Math.PI * 2)
    ctx.strokeStyle = rgba(ink.fg, 0.12)
    ctx.lineWidth = 0.5
    ctx.stroke()

    const size = 3 + (count - o) * 0.5
    // the head, then a trail behind it: eight steps back along the same orbit,
    // each smaller and fainter, which reads as motion without any history
    for (let trail = 0; trail < 8; trail++) {
      const a = angle - trail * 0.15
      const dx = Math.cos(a) * radius
      const dy = Math.sin(a) * radius * tilt
      ctx.beginPath()
      ctx.arc(cx + dx * cosR - dy * sinR, cy + dx * sinR + dy * cosR, size * (1 - trail * 0.12), 0, Math.PI * 2)
      ctx.fillStyle = trail === 0 ? rgb(ink.fg) : rgba(ink.fg, 0.4 - trail * 0.05)
      ctx.fill()
    }
  }
}

const breath: FigureFn = (ctx, w, h, t, intensity, scale, ink) => {
  ground(ctx, w, h, ink.bg)
  const cx = w / 2
  const cy = h / 2
  const amp = intensity / 50
  const rings = Math.floor(12 + scale * 3)
  const maxR = Math.min(w, h) * 0.45

  for (let i = rings; i >= 1; i--) {
    const k = i / rings
    const r = k * maxR + Math.sin(t * 1.5 * amp - i * 0.3) * maxR * 0.03 * amp
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = rgba(ink.fg, 0.15 + (1 - k) * 0.5)
    ctx.lineWidth = 1 + (1 - k) * 2
    ctx.stroke()
  }

  const glowR = (15 + Math.sin(t * 1.5 * amp) * 5) * 3
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
  g.addColorStop(0, rgba(ink.fg, 0.4))
  g.addColorStop(1, rgba(ink.fg, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Streamlines traced through a vector field.
 *
 * Each line starts at a hashed point and walks forty fixed steps, turning to
 * whatever the field says at its current position. This is Euler integration
 * with a step it has no business getting away with, and it does not matter:
 * the goal is a picture of the field, not a solution to it.
 */
const flowLines: FigureFn = (ctx, w, h, t, intensity, scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const amp = intensity / 50
  const count = Math.max(4, Math.round(p.lines))
  const steps = Math.max(2, Math.round(p.steps))
  const stride = p.stride
  ctx.lineWidth = Math.max(0.3, p.weight)

  for (let i = 0; i < count; i++) {
    let x = thash(i) * w
    let y = thash2(i) * h
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let s = 0; s < steps; s++) {
      const nx = (x / w) * scale * 0.5
      const ny = (y / h) * scale * 0.5
      const angle =
        (Math.sin(nx * 3 + t * amp) * Math.cos(ny * 2 - t * 0.7 * amp) +
          Math.sin((nx + ny) * 2 + t * 0.5 * amp)) *
        Math.PI
      x += Math.cos(angle) * stride
      y += Math.sin(angle) * stride
      ctx.lineTo(x, y)
    }
    ctx.strokeStyle = rgba(ink.fg, Math.max(0.05, 0.1 + 0.15 * Math.sin(i * 0.1 + t)))
    ctx.stroke()
  }
}

const sacredGeo: FigureFn = (ctx, w, h, t, intensity, scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const cx = w / 2
  const cy = h / 2
  const amp = intensity / 50
  const baseR = Math.min(w, h) * 0.15 * (scale / 4)
  const layers = Math.max(1, Math.round(p.layers))
  const petals = Math.max(3, Math.round(p.petals))
  ctx.lineWidth = p.weight

  for (let layer = 0; layer < layers; layer++) {
    const r = baseR * (1 + layer * p.step)
    const rotation = t * 0.3 * amp * (layer % 2 === 0 ? 1 : -1)

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = rgba(ink.fg, 0.15 + layer * 0.1)
    ctx.stroke()

    for (let i = 0; i < petals; i++) {
      const angle = (i / petals) * Math.PI * 2 + rotation
      const px = cx + Math.cos(angle) * r
      const py = cy + Math.sin(angle) * r
      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.strokeStyle = rgba(ink.fg, 0.15 + layer * 0.05)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(px, py, 2, 0, Math.PI * 2)
      ctx.fillStyle = rgba(ink.fg, 0.5)
      ctx.fill()
    }
  }

  ctx.lineWidth = 1
  const triR = baseR * 2.2
  for (let tri = 0; tri < 2; tri++) {
    const rot = t * 0.5 * amp + (tri * Math.PI) / 6
    ctx.beginPath()
    for (let v = 0; v <= 3; v++) {
      const angle = rot + (v / 3) * Math.PI * 2
      const px = cx + Math.cos(angle) * triR
      const py = cy + Math.sin(angle) * triR
      if (v === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.strokeStyle = rgba(ink.fg, 0.25)
    ctx.stroke()
  }
}

const circuit: FigureFn = (ctx, w, h, t, intensity, scale, ink) => {
  ground(ctx, w, h, ink.bg)
  const grid = Math.max(15, scale * 6)
  const cols = Math.floor(w / grid)
  const rows = Math.floor(h / grid)
  const amp = intensity / 50
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * grid + grid / 2
      const y = r * grid + grid / 2
      const roll = (((r * 31337 + c * 7919) * 2654435761) >>> 0) / 4294967296
      const dir = Math.floor(roll * 4)
      const pulse = Math.sin(t * 2 * amp + r * 0.3 + c * 0.5) * 0.5 + 0.5

      if (roll > 0.3) {
        const dx = dir === 0 ? grid : dir === 2 ? -grid : 0
        const dy = dir === 1 ? grid : dir === 3 ? -grid : 0
        ctx.strokeStyle = rgba(ink.fg, 0.15 + pulse * 0.2)
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + dx, y + dy)
        ctx.stroke()
      }

      if (roll < 0.15) {
        const size = 3 + pulse * 2
        ctx.beginPath()
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fillStyle = rgba(ink.fg, 0.5 + pulse * 0.5)
        ctx.fill()
        ctx.strokeStyle = rgba(ink.fg, 0.3)
        ctx.strokeRect(x - size - 1, y - size - 1, (size + 1) * 2, (size + 1) * 2)
      } else if (roll < 0.2) {
        ctx.beginPath()
        ctx.arc(x, y, 1.5, 0, Math.PI * 2)
        ctx.fillStyle = rgba(ink.fg, 0.4)
        ctx.fill()
      }
    }
  }
}

// ----- Bars and tiles -----

const morphGrid: FigureFn = (ctx, w, h, t, intensity, scale, ink) => {
  // inverted on purpose: the tiles are the paper and the ground is the ink,
  // which is what makes this read as a printed sheet rather than as lit shapes
  ctx.fillStyle = rgb(ink.fg)
  ctx.fillRect(0, 0, w, h)

  const cols = Math.max(3, Math.floor(scale * 1.5))
  const pad = 20
  const cellW = (w - pad * 2) / cols
  const cellH = (h - pad * 2) / cols
  const amp = intensity / 50

  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      const x = pad + c * cellW + 4
      const y = pad + r * cellH + 4
      const bw = cellW - 8
      const bh = cellH - 8
      const morph = Math.sin(t * 1.5 * amp + r * 0.7 + c * 0.5) * 0.5 + 0.5
      const k = 0.6 + morph * 0.4
      const fw = bw * k
      const fh = bh * k
      ctx.fillStyle = rgb(ink.bg)
      ctx.beginPath()
      ctx.roundRect(x + (bw - fw) / 2, y + (bh - fh) / 2, fw, fh, morph * Math.min(bw, bh) * 0.5)
      ctx.fill()
    }
  }

  ctx.strokeStyle = rgba(ink.bg, 0.15)
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let r = 0; r <= cols; r++) {
    ctx.moveTo(pad, pad + r * cellH)
    ctx.lineTo(w - pad, pad + r * cellH)
  }
  for (let c = 0; c <= cols; c++) {
    ctx.moveTo(pad + c * cellW, pad)
    ctx.lineTo(pad + c * cellW, h - pad)
  }
  ctx.stroke()
}

const pixelSort: FigureFn = (ctx, w, h, t, intensity, scale, ink) => {
  ground(ctx, w, h, ink.bg)
  const barW = Math.max(1, Math.floor(scale * 0.8))
  const bars = Math.ceil(w / barW)
  const amp = intensity / 50

  for (let i = 0; i < bars; i++) {
    const nx = i / bars
    const w1 = Math.sin(nx * 8 + t * 2 * amp) * 0.3
    const w2 = Math.sin(nx * 15 - t * 3 * amp) * 0.15
    const w3 = Math.sin(nx * 3 + t * 0.5) * 0.2
    const barH = (0.3 + (w1 + w2 + w3) * amp) * h
    ctx.fillStyle = rgba(ink.fg, 0.3 + (w1 + 0.3) * 0.7)
    ctx.fillRect(i * barW, (h - barH) / 2, barW, barH)
  }
}

const waveBars: FigureFn = (ctx, w, h, t, intensity, scale, ink) => {
  ground(ctx, w, h, ink.bg)
  const barH = Math.max(2, Math.floor(scale * 1.5))
  const gap = barH + 2
  const rows = Math.ceil(h / gap)
  const amp = intensity / 50

  for (let i = 0; i < rows; i++) {
    const ny = i / rows
    const wave = Math.sin(ny * 6 + t * 2 * amp) * 0.3 + Math.sin(ny * 10 - t * 3 * amp) * 0.15
    const barW = (0.2 + (wave + 0.45) * 0.7) * w
    ctx.fillStyle = rgba(ink.fg, Math.min(1, 0.3 + (wave + 0.45) * 0.5))
    ctx.fillRect((w - barW) / 2, i * gap, barW, barH)
  }
}

// ----- Type -----

const textWave: FigureFn = (ctx, w, h, t, intensity, scale, ink, motion) => {
  ground(ctx, w, h, ink.bg)
  const text = (motion.text || 'RIBBIT').toUpperCase()
  if (!text.length) return

  const fontSize = Math.max(6, Math.floor((14 * scale) / 4))
  ctx.font = `bold ${fontSize}px ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const amp = intensity / 50
  const rows = Math.floor(h / (fontSize * 1.3))
  const cx = w / 2

  for (let row = 0; row < rows; row++) {
    const y = fontSize + row * fontSize * 1.3
    const phase = row * 0.3 + t * 2
    const curve = Math.sin(phase) * w * 0.15 * amp
    const spacing = fontSize * 0.85 + Math.sin(phase * 0.5) * fontSize * 0.3 * amp

    for (let i = 0; i < text.length; i++) {
      const offset = (i - text.length / 2) * spacing
      const alpha = 0.4 + 0.6 * (1 - Math.abs(offset) / (w * 0.5))
      if (alpha <= 0) continue
      ctx.fillStyle = rgba(ink.fg, Math.max(0, Math.min(1, alpha)))
      ctx.fillText(text[i], cx + offset + curve, y + Math.sin(t * 1.5 + i * 0.4 + row * 0.2) * 5 * amp)
    }
  }
}

/**
 * Words scrolling upward, each letter sliding in on its own delay.
 *
 * The text is split on spaces and commas into lines, so one field can hold a
 * short list. A single word with no separator is repeated down the frame rather
 * than left alone on one row, because one word on a blank canvas is not a
 * composition.
 */
const typeCascade: FigureFn = (ctx, w, h, t, intensity, scale, ink, motion) => {
  ground(ctx, w, h, ink.bg)
  const raw = motion.text || 'RIBBIT'
  const words =
    raw.includes(' ') || raw.includes(',')
      ? raw.split(/[\s,]+/).filter((s) => s.length > 0).map((s) => s.toUpperCase())
      : [raw.toUpperCase()]
  if (!words.length) return

  const fontSize = Math.max(8, Math.floor((18 * scale) / 4))
  ctx.font = `bold ${fontSize}px ui-monospace, monospace`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  const amp = intensity / 50
  const lineH = fontSize * 1.6
  const rows = Math.ceil(h / lineH) + 1
  const scrollY = (t * 60 * amp) % (lineH * words.length)

  for (let row = -1; row < rows; row++) {
    const idx = (((row + Math.floor(scrollY / lineH)) % words.length) + words.length) % words.length
    const word = words[idx]
    const y = row * lineH - (scrollY % lineH) + lineH / 2
    for (let i = 0; i < word.length; i++) {
      const slide = t * 2 * amp - row * 0.15 - i * 0.08
      const alpha = Math.min(1, Math.max(0.2, Math.sin(slide) * 0.5 + 0.5))
      ctx.fillStyle = rgba(ink.fg, alpha)
      ctx.fillText(word[i], 30 + i * fontSize * 0.7 + Math.max(0, Math.sin(slide) * 20), y)
    }
  }
}

const textScatter: FigureFn = (ctx, w, h, t, intensity, scale, ink) => {
  ground(ctx, w, h, ink.bg)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const fontSize = Math.max(6, Math.floor((12 * scale) / 4))
  ctx.font = `${fontSize}px ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const cx = w / 2
  const cy = h / 2
  const amp = intensity / 50
  // the pull breathes, so the field gathers toward the centre and lets go again
  const pull = (Math.sin(t * 0.5) * 0.5 + 0.5) * amp

  for (let i = 0; i < 200; i++) {
    const x = cx + (thash(i) - 0.5) * w * (1 - pull * 0.6) + Math.sin(t + i) * 10 * amp
    const y = cy + (thash2(i) - 0.5) * h * (1 - pull * 0.6) + Math.cos(t * 0.7 + i) * 10 * amp
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / (w * 0.5)
    ctx.fillStyle = rgba(ink.fg, Math.max(0.15, 1 - dist))
    ctx.fillText(chars[(i + Math.floor(t * 2)) % chars.length], x, y)
  }
}

const gridCounter: FigureFn = (ctx, w, h, t, intensity, scale, ink) => {
  ground(ctx, w, h, ink.bg)
  const chars = '0123456789ABCDEF'
  const cell = Math.max(20, scale * 8)
  const cols = Math.ceil(w / cell)
  const rows = Math.ceil(h / cell)
  const amp = intensity / 50
  ctx.font = `bold ${Math.floor(cell * 0.5)}px ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const phase = Math.floor(t * 3 * amp + r * 0.5 + c * 0.3)
      const idx = (((phase + r * 7 + c * 13) % chars.length) + chars.length) % chars.length
      const wave = Math.sin(t * 2 + r * 0.4 + c * 0.3) * 0.5 + 0.5
      if (wave > 0.7) {
        ctx.fillStyle = rgba(ink.fg, (wave - 0.7) * 0.3)
        ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2)
      }
      ctx.fillStyle = rgba(ink.fg, 0.2 + wave * 0.6)
      ctx.fillText(chars[idx], c * cell + cell / 2, r * cell + cell / 2)
    }
  }

  ctx.strokeStyle = rgba(ink.fg, 0.08)
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let r = 0; r <= rows; r++) {
    ctx.moveTo(0, r * cell)
    ctx.lineTo(w, r * cell)
  }
  for (let c = 0; c <= cols; c++) {
    ctx.moveTo(c * cell, 0)
    ctx.lineTo(c * cell, h)
  }
  ctx.stroke()
}

const matrixRain: FigureFn = (ctx, w, h, t, intensity, scale, ink) => {
  ground(ctx, w, h, ink.bg)
  const amp = intensity / 50
  const fontSize = Math.max(10, Math.floor(8 + scale * 2))
  const cols = Math.ceil(w / fontSize)
  const chars = 'アカサタナハマヤラワ0123456789ABCDEF'
  const trailMax = 8 + Math.floor(amp * 16)
  ctx.font = `bold ${fontSize}px ui-monospace, monospace`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  for (let col = 0; col < cols; col++) {
    const speed = 1.5 + thash(col) * 5
    const trail = 4 + Math.floor(thash(col * 2.3) * trailMax)
    const offset = thash(col * 3.7) * h * 3
    const totalH = h + trail * fontSize
    const headY = (t * speed * fontSize * amp * 0.5 + offset) % totalH

    for (let i = 0; i < trail; i++) {
      const y = headY - i * fontSize
      if (y < -fontSize || y > h) continue
      const fade = 1 - i / trail
      const alpha = fade * fade
      if (alpha < 0.03) continue
      const ci = Math.floor(thash(col * 10 + i * 0.37 + Math.floor(t * 4) * 0.07) * chars.length)
      // the two leading glyphs take the accent, which is the only place a
      // figure reads the accent colour at all
      ctx.fillStyle = i < 2 ? rgba(ink.accent, Math.min(1, alpha * 1.5)) : rgba(ink.fg, alpha)
      ctx.fillText(chars[ci % chars.length], col * fontSize, y)
    }
  }
}

// ----- Dimensional -----

/**
 * A wireframe landscape under a real perspective projection.
 *
 * Points are built in world space, rotated by the document's own Euler angles,
 * then divided through by depth. `flatten` scales the height field toward zero,
 * which turns the landscape into a flat grid seen at an angle rather than
 * flattening the projection, and that is the more useful of the two.
 */
const wireTerrain: FigureFn = (ctx, w, h, t, intensity, scale, ink, motion, p) => {
  ground(ctx, w, h, ink.bg)
  const amp = (intensity / 50) * p.height
  const gridW = Math.max(4, Math.round(p.cols))
  const gridD = Math.max(3, Math.round(p.rows))
  const cx = w / 2
  const cy = h / 2
  const spin = motion.autoSpin / 100
  const rx = (motion.rotateX + t * spin * 20) * (Math.PI / 180)
  const ry = (motion.rotateY + t * spin * 40) * (Math.PI / 180)
  const rz = motion.rotateZ * (Math.PI / 180)
  const flat = 1 - motion.flatten
  const freq = scale * 0.3

  const px = new Float64Array(gridW + 1)
  const py = new Float64Array(gridW + 1)
  const pz = new Float64Array(gridW + 1)

  const project = (gx: number, gz: number) => {
    const wx = (gx - gridW / 2) * 20
    const wz = (gz - gridD / 2) * 25
    const wy =
      (Math.sin(gx * freq * 0.4 + t * 0.8) * Math.cos(gz * freq * 0.3 + t * 0.5) * 40 +
        Math.sin((gx + gz) * freq * 0.2 - t * 0.3) * 20) *
      amp *
      flat
    const [rx3, ry3, rz3] = rotate3D(wx, wy, wz, rx, ry, rz)
    const persp = 600 / (rz3 + 400)
    return { x: cx + rx3 * persp, y: cy - ry3 * persp, z: rz3 }
  }

  ctx.lineWidth = 1

  for (let z = 0; z < gridD; z++) {
    ctx.beginPath()
    let started = false
    for (let x = 0; x <= gridW; x++) {
      const p = project(x, z)
      px[x] = p.x
      py[x] = p.y
      pz[x] = p.z
      if (p.z < -350) continue
      if (!started) {
        ctx.moveTo(p.x, p.y)
        started = true
      } else ctx.lineTo(p.x, p.y)
    }
    ctx.strokeStyle = rgba(ink.fg, 0.2 + 0.5 * (1 - z / gridD))
    ctx.stroke()
  }

  ctx.strokeStyle = rgba(ink.fg, 0.15)
  for (let x = 0; x <= gridW; x++) {
    ctx.beginPath()
    let started = false
    for (let z = 0; z < gridD; z++) {
      const p = project(x, z)
      if (p.z < -350) continue
      if (!started) {
        ctx.moveTo(p.x, p.y)
        started = true
      } else ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }
}

/**
 * A torus of points, depth sorted.
 *
 * The sort is what makes it read as a solid ring rather than as a cloud: drawn
 * in generation order the far side paints over the near side about half the
 * time, and the shape stops being legible. Six hundred points is small enough
 * that sorting them every frame costs less than the arcs do.
 */
const particleRing: FigureFn = (ctx, w, h, t, intensity, scale, ink, motion, p) => {
  ground(ctx, w, h, ink.bg)
  const cx = w / 2
  const cy = h / 2
  const amp = intensity / 50
  const ringR = Math.min(w, h) * 0.28 * p.radius
  const tubeR = ringR * p.tube
  const count = Math.max(50, Math.round(p.points) * 50)
  const spin = motion.autoSpin / 100
  const rotX = (motion.rotateX + t * spin * 30) * (Math.PI / 180)
  const rotY = (motion.rotateY + t * spin * 50) * (Math.PI / 180)
  const rotZ = motion.rotateZ * (Math.PI / 180)
  const flat = 1 - motion.flatten

  const pts: { x: number; y: number; size: number; alpha: number; z: number }[] = []

  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2 + t * 0.5 * amp
    const phi = thash(i) * Math.PI * 2 + t * 1.5 * amp
    const ring = ringR + tubeR * Math.cos(phi)
    const [rx3, ry3, rz3] = rotate3D(
      ring * Math.cos(theta),
      tubeR * Math.sin(phi) * flat,
      ring * Math.sin(theta),
      rotX,
      rotY,
      rotZ,
    )
    const persp = 600 / (600 + rz3)
    if (persp <= 0) continue
    pts.push({
      x: cx + rx3 * persp,
      y: cy - ry3 * persp,
      size: (1 + persp * 1.5) * (scale / 4),
      alpha: Math.min(1, persp * 0.7),
      z: rz3,
    })
  }

  pts.sort((a, b) => b.z - a.z)
  for (const p of pts) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fillStyle = rgba(ink.fg, p.alpha)
    ctx.fill()
  }
}

// ----- Constructed -----

/**
 * Phyllotaxis: the packing a sunflower uses.
 *
 * Place seed n at angle n times the golden angle and radius the square root of
 * n. Vogel's 1979 formula. The golden angle is the one irrational rotation that
 * never lets successive seeds line up, so no matter how many you add the
 * packing stays even, and the spiral arms your eye picks out are always
 * consecutive Fibonacci numbers.
 *
 * The angle is a control, and that is the point: nudge it a hundredth of a
 * degree off 137.507 and the whole arrangement unwinds into visible spokes.
 * Very little else in generative work is that sensitive to one number.
 */
const phyllotaxis: FigureFn = (ctx, w, h, t, intensity, scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const cx = w / 2
  const cy = h / 2
  const n = Math.max(10, Math.round(p.seeds))
  const angle = (p.angle * Math.PI) / 180
  const spread = (Math.min(w, h) * 0.47 * p.spread) / Math.sqrt(n)
  const amp = intensity / 50
  const grow = p.grow

  for (let i = 1; i <= n; i++) {
    const a = i * angle + t * p.spin * 0.1
    const r = spread * Math.pow(i, 0.5 + grow * 0.1)
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue
    const k = i / n
    // seeds swell as they travel outward, which is what gives the arms weight
    const size = (0.6 + k * p.taper) * scale * 0.6 * (1 + Math.sin(t * 2 - i * 0.05) * 0.25 * amp)
    ctx.beginPath()
    ctx.arc(x, y, Math.max(0.4, size), 0, Math.PI * 2)
    ctx.fillStyle = i % Math.max(2, Math.round(p.accent)) === 0 ? rgba(ink.accent, 0.9) : rgba(ink.fg, 0.35 + k * 0.65)
    ctx.fill()
  }
}

/**
 * Truchet tiles, subdivided.
 *
 * Cyril Truchet's 1704 idea: fill a grid with one tile in random orientations
 * and let the edges join up. With a quarter-circle tile every arc meets its
 * neighbour tangentially, so the result is an unbroken maze of curves that no
 * one drew. Christopher Carlson's multi-scale version subdivides some cells
 * again, which breaks the regularity of the grid without breaking the joins.
 *
 * Every orientation and every subdivision comes from a hash of the cell, so the
 * maze is the same maze in the export as it was in the preview.
 */
const truchet: FigureFn = (ctx, w, h, t, intensity, _scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const base = Math.max(2, Math.round(p.cells))
  const depth = Math.max(0, Math.round(p.depth))
  const cell = Math.max(w, h) / base
  const amp = intensity / 50
  ctx.lineCap = 'round'

  const tile = (x: number, y: number, s: number, level: number, seed: number) => {
    // a cell splits when its own hash says so, which keeps the subdivision
    // stable while still varying across the frame
    if (level < depth && thash(seed * 1.7 + level * 31.3) < p.split) {
      const half = s / 2
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++)
          tile(x + i * half, y + j * half, half, level + 1, seed * 4 + j * 2 + i + 1)
      return
    }

    const roll = thash(seed * 2.9)
    const turn = Math.floor(roll * 4)
    const drift = Math.sin(t * p.wave + seed * 0.7) * 0.5 + 0.5
    ctx.lineWidth = Math.max(0.6, s * p.weight * (0.6 + drift * 0.8 * amp))
    ctx.strokeStyle = roll > 0.92 ? rgba(ink.accent, 0.95) : rgba(ink.fg, 0.35 + drift * 0.55)

    // two quarter circles on opposite corners: the classic Truchet arc tile
    const r = s / 2
    const corners: [number, number, number][] = [
      [x, y, 0],
      [x + s, y, Math.PI / 2],
      [x + s, y + s, Math.PI],
      [x, y + s, -Math.PI / 2],
    ]
    const a = corners[turn % 4]
    const b = corners[(turn + 2) % 4]
    ctx.beginPath()
    ctx.arc(a[0], a[1], r, a[2], a[2] + Math.PI / 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(b[0], b[1], r, b[2], b[2] + Math.PI / 2)
    ctx.stroke()
  }

  const cols = Math.ceil(w / cell)
  const rows = Math.ceil(h / cell)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) tile(c * cell, r * cell, cell, 0, c * 131 + r * 977 + 3)
}

/**
 * A de Jong strange attractor, plotted as a density cloud.
 *
 * Four coefficients and two lines of iteration. The orbit never repeats and
 * never escapes, so it traces out a shape that is nowhere continuous but is
 * clearly a shape, and moving any coefficient a tenth reorganises the whole
 * thing into something unrecognisable.
 *
 * Plotted by accumulating hits into a coarse grid and then drawing that grid,
 * rather than by stroking a hundred thousand dots. Overdraw is the whole
 * picture here: the shape is defined by *where the orbit spends its time*, and
 * alpha stacking gets that for a fraction of the fill cost.
 */
const attractor: FigureFn = (ctx, w, h, t, intensity, scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const pts = Math.max(2000, Math.round(p.points) * 1000)
  const amp = intensity / 50
  // the coefficients drift, which walks the attractor through its family
  const wobble = Math.sin(t * 0.2) * p.drift
  const a = p.a + wobble
  const b = p.b - wobble * 0.6
  const c = p.c
  const d = p.d + Math.cos(t * 0.17) * p.drift * 0.5

  const bins = Math.max(60, Math.round(240 / Math.max(1, p.grain)))
  const grid = new Float32Array(bins * bins)
  let x = 0.1
  let y = 0.1
  let peak = 1

  for (let i = 0; i < pts; i++) {
    const nx = Math.sin(a * y) - Math.cos(b * x)
    y = Math.sin(c * x) - Math.cos(d * y)
    x = nx
    // the attractor lives inside about -2..2 on both axes
    const gx = ((x + 2) / 4) * bins
    const gy = ((y + 2) / 4) * bins
    if (gx < 0 || gy < 0 || gx >= bins || gy >= bins) continue
    const idx = (gy | 0) * bins + (gx | 0)
    grid[idx]++
    if (grid[idx] > peak) peak = grid[idx]
  }

  const box = (Math.min(w, h) * 0.92 * scale) / 4
  const step = box / bins
  const ox = (w - box) / 2
  const oy = (h - box) / 2
  const gamma = p.gamma

  for (let j = 0; j < bins; j++) {
    for (let i = 0; i < bins; i++) {
      const v = grid[j * bins + i]
      if (v === 0) continue
      const k = Math.pow(v / peak, gamma) * amp
      if (k < 0.02) continue
      ctx.fillStyle = k > 0.75 ? rgba(ink.accent, Math.min(1, k)) : rgba(ink.fg, Math.min(1, k))
      ctx.fillRect(ox + i * step, oy + j * step, step + 0.6, step + 0.6)
    }
  }
}

/**
 * A harmonograph: two damped pendulums, one per axis.
 *
 * Victorian drawing machines. Each axis is a sum of two decaying sinusoids, and
 * when the frequency ratio is near a simple fraction the curve closes into a
 * rosette; a little off, and it precesses instead, which is what makes the
 * near-misses far more interesting than the exact ratios.
 */
const harmonograph: FigureFn = (ctx, w, h, t, intensity, scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const cx = w / 2
  const cy = h / 2
  const r = Math.min(w, h) * 0.22 * scale * 0.5
  const steps = Math.max(400, Math.round(p.steps) * 100)
  const damp = p.damping * 0.0006
  const f1 = p.ratio
  const f2 = p.ratio + p.detune
  const amp = intensity / 50
  const phase = t * p.drift * 0.2

  ctx.lineWidth = Math.max(0.4, p.weight)
  ctx.strokeStyle = rgba(ink.fg, 0.55 * amp)
  ctx.beginPath()
  for (let i = 0; i < steps; i++) {
    const s = i * 0.02
    const decay = Math.exp(-damp * i)
    const x =
      cx + (Math.sin(s * f1 + phase) + Math.sin(s * f2 * 1.002 + phase * 0.7)) * r * decay
    const y =
      cy + (Math.cos(s * p.ratioY + phase * 1.3) + Math.cos(s * (p.ratioY + p.detune) * 0.998)) * r * decay
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // a second pass in the accent, a quarter turn out of phase, so the figure
  // reads as two pens rather than one line thickened
  ctx.strokeStyle = rgba(ink.accent, 0.4 * amp)
  ctx.beginPath()
  for (let i = 0; i < steps; i++) {
    const s = i * 0.02
    const decay = Math.exp(-damp * i)
    const x = cx + (Math.sin(s * f1 + phase + 1.57) + Math.sin(s * f2 + phase)) * r * decay
    const y = cy + (Math.cos(s * p.ratioY + phase) + Math.cos(s * (p.ratioY + p.detune))) * r * decay
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

/**
 * A hypotrochoid: the Spirograph curve.
 *
 * A small circle rolling inside a big one, with the pen offset from its centre.
 * The number of lobes is the big radius over the greatest common divisor, so
 * the shape is decided by a *ratio of integers* and jumps discontinuously as
 * you turn either radius, which is why this one rewards nudging over sweeping.
 */
const spirograph: FigureFn = (ctx, w, h, t, intensity, scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const cx = w / 2
  const cy = h / 2
  const R = p.outer
  const r = p.inner
  const d = p.pen
  const unit = (Math.min(w, h) * 0.44 * scale) / 5 / Math.max(1, R)
  const amp = intensity / 50
  const layers = Math.max(1, Math.round(p.layers))
  // the curve closes after lcm(R, r) / R turns, so this is generous rather than exact
  const turns = Math.max(2, Math.round(p.turns))
  const steps = turns * 240

  ctx.lineWidth = Math.max(0.4, p.weight)
  for (let l = 0; l < layers; l++) {
    const spin = t * p.spin * 0.2 + (l / layers) * Math.PI * 2 * p.fan
    const shrink = 1 - (l / layers) * p.taper
    ctx.strokeStyle = l === 0 ? rgba(ink.accent, 0.85 * amp) : rgba(ink.fg, (0.5 - l * 0.04) * amp)
    ctx.beginPath()
    for (let i = 0; i <= steps; i++) {
      const a = (i / 240) * Math.PI * 2 + spin
      const k = (R - r) / r
      const x = cx + ((R - r) * Math.cos(a) + d * Math.cos(k * a)) * unit * shrink
      const y = cy + ((R - r) * Math.sin(a) - d * Math.sin(k * a)) * unit * shrink
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

/**
 * String art from modular multiplication on a circle.
 *
 * Put N points round a circle and join point i to point (i times k) mod N. The
 * chords envelope a cardioid at k = 2, a nephroid at k = 3, and one more cusp
 * for every step after that. The curve is never drawn: it is the boundary the
 * straight lines refuse to cross.
 */
const stringArt: FigureFn = (ctx, w, h, t, intensity, scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const cx = w / 2
  const cy = h / 2
  const r = Math.min(w, h) * 0.44 * Math.min(1.4, scale * 0.25)
  const n = Math.max(8, Math.round(p.points))
  const mult = p.multiplier + Math.sin(t * p.drift * 0.2) * p.sweep
  const amp = intensity / 50
  const spin = t * p.spin * 0.1

  ctx.lineWidth = Math.max(0.3, p.weight)
  ctx.strokeStyle = rgba(ink.fg, Math.min(1, (14 / n) * amp))
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const a1 = (i / n) * Math.PI * 2 + spin
    const a2 = (((i * mult) % n) / n) * Math.PI * 2 + spin
    ctx.moveTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r)
    ctx.lineTo(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r)
  }
  ctx.stroke()

  if (p.rim > 0.5) {
    ctx.strokeStyle = rgba(ink.accent, 0.5)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }
}

/**
 * Recursive subdivision: a rectangle split until it stops.
 *
 * The oldest generative layout there is, and still the one that reads as
 * designed rather than as generated, because every edge lines up with another
 * edge by construction. Which way a cell splits and whether it splits at all
 * both come from its own hash, so the layout is stable and the animation lives
 * in the fill rather than in the geometry.
 *
 * The first cuts are not up for a vote, though. Every other decision here is a
 * coin flip against `split`, and when the root lost its flip the picture ended
 * before it began: one rectangle, drawn as an outline, filling the canvas. The
 * root's seed is fixed, so that was not an unlucky draw you could shuffle past
 * but the only thing this generator ever drew at any split chance below 0.92.
 * Two guaranteed levels mean there is always a layout to look at, and the
 * chance still decides everything underneath them.
 */
const subdivide: FigureFn = (ctx, w, h, t, intensity, scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const depth = Math.max(1, Math.round(p.depth))
  const forced = Math.min(2, depth)
  const gap = p.gap
  const amp = intensity / 50
  const bias = p.bias

  const cell = (x: number, y: number, cw: number, ch: number, level: number, seed: number) => {
    const roll = thash(seed)
    const splits = level < forced || roll < p.split
    if (level < depth && splits && Math.min(cw, ch) > p.min) {
      // split across the long axis unless the bias says otherwise, which is
      // what keeps the cells from degenerating into slivers
      const vertical = cw > ch ? bias > thash(seed * 3.1) : bias < thash(seed * 3.1)
      const cut = 0.3 + thash(seed * 5.7) * 0.4
      if (vertical) {
        cell(x, y, cw * cut, ch, level + 1, seed * 2 + 1)
        cell(x + cw * cut, y, cw * (1 - cut), ch, level + 1, seed * 2 + 2)
      } else {
        cell(x, y, cw, ch * cut, level + 1, seed * 2 + 1)
        cell(x, y + ch * cut, cw, ch * (1 - cut), level + 1, seed * 2 + 2)
      }
      return
    }

    const pulse = Math.sin(t * p.rate + seed * 0.9) * 0.5 + 0.5
    const k = pulse * amp
    const inset = gap * Math.min(cw, ch) * 0.5
    const fx = x + inset
    const fy = y + inset
    const fw = Math.max(0, cw - inset * 2)
    const fh = Math.max(0, ch - inset * 2)

    if (roll > 0.93) {
      ctx.fillStyle = rgba(ink.accent, 0.35 + k * 0.65)
      ctx.fillRect(fx, fy, fw, fh)
    } else if (thash(seed * 7.3) < p.filled) {
      ctx.fillStyle = rgba(ink.fg, 0.15 + k * 0.7)
      ctx.fillRect(fx, fy, fw, fh)
    } else {
      ctx.strokeStyle = rgba(ink.fg, 0.2 + k * 0.5)
      ctx.lineWidth = Math.max(0.5, scale * 0.2)
      ctx.strokeRect(fx, fy, fw, fh)
    }
  }

  const pad = Math.min(w, h) * 0.04
  cell(pad, pad, w - pad * 2, h - pad * 2, 0, 7)
}

/**
 * Contour lines traced across a noise field by marching squares.
 *
 * Sample a scalar on a grid, then for each cell look at which corners are above
 * the threshold and join the midpoints of the edges that straddle it. Sixteen
 * cases, of which only two are ambiguous, and out of that falls a proper
 * isoline rather than the stripes a threshold on a smooth function gives.
 *
 * This is the only figure that runs the same value noise the fields use, which
 * is deliberate: it is the outline of a picture the other half of the tool can
 * draw filled.
 */
const isolines: FigureFn = (ctx, w, h, t, intensity, scale, ink, _motion, p) => {
  ground(ctx, w, h, ink.bg)
  const step = Math.max(4, Math.round(p.step))
  const cols = Math.ceil(w / step) + 1
  const rows = Math.ceil(h / step) + 1
  const levels = Math.max(1, Math.round(p.levels))
  const amp = intensity / 50
  const freq = scale * 0.4
  const oct = Math.max(1, Math.round(p.octaves))

  const field = new Float32Array(cols * rows)
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      field[j * cols + i] = fbm((i * step * freq) / w + t * 0.1, (j * step * freq) / h, oct, 2, 0.5)

  ctx.lineWidth = Math.max(0.4, p.weight)
  ctx.lineCap = 'round'

  for (let l = 1; l <= levels; l++) {
    const iso = l / (levels + 1)
    ctx.strokeStyle = l % Math.max(2, Math.round(p.accent)) === 0
      ? rgba(ink.accent, 0.8 * amp)
      : rgba(ink.fg, (0.25 + 0.5 * (l / levels)) * amp)
    ctx.beginPath()
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = field[j * cols + i]
        const b = field[j * cols + i + 1]
        const c = field[(j + 1) * cols + i + 1]
        const d = field[(j + 1) * cols + i]
        const code = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0)
        if (code === 0 || code === 15) continue

        const x0 = i * step
        const y0 = j * step
        // linear interpolation along each straddled edge, which is what stops
        // the contour looking like a staircase at this grid size
        const lerp = (v1: number, v2: number) => (iso - v1) / (v2 - v1 || 1e-6)
        const top: [number, number] = [x0 + lerp(a, b) * step, y0]
        const right: [number, number] = [x0 + step, y0 + lerp(b, c) * step]
        const bottom: [number, number] = [x0 + lerp(d, c) * step, y0 + step]
        const left: [number, number] = [x0, y0 + lerp(a, d) * step]

        const seg = (u: [number, number], v: [number, number]) => {
          ctx.moveTo(u[0], u[1])
          ctx.lineTo(v[0], v[1])
        }
        switch (code) {
          case 1: case 14: seg(left, bottom); break
          case 2: case 13: seg(bottom, right); break
          case 3: case 12: seg(left, right); break
          case 4: case 11: seg(top, right); break
          case 6: case 9: seg(top, bottom); break
          case 7: case 8: seg(left, top); break
          // the two saddles: both diagonals are drawn rather than guessing
          case 5: seg(left, top); seg(bottom, right); break
          case 10: seg(top, right); seg(left, bottom); break
        }
      }
    }
    ctx.stroke()
  }
}

/**
 * The catalogue.
 *
 * Constructed holds the ones built out of a named piece of geometry rather than
 * out of a loop over dots, and they are where the good images are. The rest are
 * arranged by what they are made of, because that is what somebody scanning the
 * list is actually matching against.
 */
export const FIGURES: FigureSpec[] = [
  // ----- Constructed -----
  {
    id: 'phyllotaxis',
    label: 'Phyllotaxis',
    group: 'Constructed',
    hint: 'Sunflower packing. Nudge the angle and it unwinds.',
    uses: BASE,
    params: [
      param('angle', 'Angle', 130, 145, 0.001, 137.507, 'The golden angle. A thousandth either side changes everything.'),
      param('seeds', 'Seeds', 50, 3000, 10, 900),
      param('spread', 'Spread', 0.3, 2.5, 0.01, 1),
      param('taper', 'Taper', 0, 3, 0.01, 1.1, 'How much seeds swell as they travel out'),
      param('grow', 'Growth', -1, 2, 0.01, 0, 'Bends the square-root spacing'),
      param('accent', 'Accent every', 2, 30, 1, 8),
      param('spin', 'Spin', 0, 4, 0.01, 0.6),
    ],
    fn: phyllotaxis,
  },
  {
    id: 'truchet',
    label: 'Truchet',
    group: 'Constructed',
    hint: 'Quarter-circle tiles that always join. A maze nobody drew.',
    uses: BASE,
    params: [
      param('cells', 'Cells', 2, 24, 1, 7),
      param('depth', 'Subdivide', 0, 4, 1, 2, 'How many times a cell may split again'),
      param('split', 'Split chance', 0, 1, 0.01, 0.45),
      param('weight', 'Weight', 0.02, 0.5, 0.005, 0.16),
      param('wave', 'Wave', 0, 4, 0.01, 1, 'How fast the line weight breathes'),
    ],
    fn: truchet,
  },
  {
    id: 'attractor',
    label: 'Attractor',
    group: 'Constructed',
    hint: 'A de Jong orbit, plotted by where it spends its time.',
    uses: BASE,
    params: [
      param('a', 'A', -3, 3, 0.001, 1.641),
      param('b', 'B', -3, 3, 0.001, 1.902),
      param('c', 'C', -3, 3, 0.001, 0.316),
      param('d', 'D', -3, 3, 0.001, 1.525),
      param('drift', 'Drift', 0, 0.6, 0.005, 0.12, 'How far the coefficients wander'),
      param('points', 'Points ×1000', 5, 300, 5, 90),
      param('grain', 'Grain', 1, 6, 0.1, 1.6, 'Bin size. Coarser is faster and blockier.'),
      param('gamma', 'Gamma', 0.15, 1.5, 0.01, 0.42, 'How hard the density is compressed'),
    ],
    fn: attractor,
  },
  {
    id: 'harmonograph',
    label: 'Harmonograph',
    group: 'Constructed',
    hint: 'Two damped pendulums. Near a simple ratio, not on it.',
    uses: BASE,
    params: [
      param('ratio', 'Ratio X', 0.5, 12, 0.001, 3),
      param('ratioY', 'Ratio Y', 0.5, 12, 0.001, 2),
      param('detune', 'Detune', -0.2, 0.2, 0.0005, 0.008, 'How far off the exact ratio it sits'),
      param('damping', 'Damping', 0, 4, 0.01, 1),
      param('steps', 'Length ×100', 4, 120, 1, 40),
      param('weight', 'Weight', 0.2, 3, 0.05, 0.7),
      param('drift', 'Drift', 0, 3, 0.01, 1),
    ],
    fn: harmonograph,
  },
  {
    id: 'spirograph',
    label: 'Spirograph',
    group: 'Constructed',
    hint: 'A hypotrochoid. The lobe count jumps as you turn the radii.',
    uses: BASE,
    params: [
      param('outer', 'Outer R', 3, 40, 1, 13),
      param('inner', 'Inner r', 1, 30, 1, 5),
      param('pen', 'Pen offset', 0.5, 20, 0.1, 6),
      param('turns', 'Turns', 2, 40, 1, 12),
      param('layers', 'Layers', 1, 12, 1, 3),
      param('fan', 'Fan', 0, 1, 0.01, 0.3, 'How far apart the layers are turned'),
      param('taper', 'Taper', 0, 0.8, 0.01, 0.25),
      param('weight', 'Weight', 0.2, 3, 0.05, 0.8),
      param('spin', 'Spin', 0, 4, 0.01, 0.5),
    ],
    fn: spirograph,
  },
  {
    id: 'string-art',
    label: 'String Art',
    group: 'Constructed',
    hint: 'Chords from times-table arithmetic. The curve is never drawn.',
    uses: BASE,
    params: [
      param('points', 'Points', 20, 600, 1, 220),
      param('multiplier', 'Multiplier', 2, 40, 0.01, 2, 'Two gives a cardioid, three a nephroid'),
      param('sweep', 'Sweep', 0, 6, 0.01, 1, 'How far the multiplier drifts'),
      param('drift', 'Drift', 0, 3, 0.01, 1),
      param('weight', 'Weight', 0.1, 2, 0.05, 0.5),
      param('spin', 'Spin', 0, 4, 0.01, 0.3),
      param('rim', 'Rim', 0, 1, 1, 1, 'Draw the circle the chords sit on'),
    ],
    fn: stringArt,
  },
  {
    id: 'subdivide',
    label: 'Subdivide',
    group: 'Constructed',
    hint: 'A rectangle split until it stops. Every edge lines up.',
    uses: BASE,
    params: [
      param('depth', 'Depth', 1, 9, 1, 5),
      param('split', 'Split chance', 0.1, 1, 0.01, 0.72),
      param('bias', 'Bias', 0, 1, 0.01, 0.85, 'How strongly a cell prefers to cut its long axis'),
      param('min', 'Min size', 4, 200, 1, 26),
      param('gap', 'Gap', 0, 0.5, 0.005, 0.08),
      param('filled', 'Filled', 0, 1, 0.01, 0.45, 'How many cells are solid rather than outlined'),
      param('rate', 'Rate', 0, 6, 0.01, 1.2),
    ],
    fn: subdivide,
  },
  {
    id: 'isolines',
    label: 'Isolines',
    group: 'Constructed',
    hint: 'Marching squares over noise. Real contours, not stripes.',
    uses: BASE,
    params: [
      param('levels', 'Levels', 1, 40, 1, 12),
      param('step', 'Grid', 4, 40, 1, 10, 'Sampling step. Lower is smoother and slower.'),
      param('octaves', 'Octaves', 1, 5, 1, 3),
      param('weight', 'Weight', 0.2, 3, 0.05, 0.8),
      param('accent', 'Accent every', 2, 20, 1, 5),
    ],
    fn: isolines,
  },

  // ----- Points -----
  { id: 'dot-tunnel', label: 'Dot Tunnel', group: 'Points', hint: 'Spiral rings of dots winding away.', uses: BASE,
    params: [param('rings', 'Rings', 3, 48, 1, 18), param('dots', 'Dots', 4, 80, 1, 24), param('shear', 'Shear', 0, 8, 0.05, 2)], fn: dotTunnel },
  { id: 'dot-grid', label: 'Dot Grid', group: 'Points', hint: 'An even grid with a shape swelling out of it.', uses: BASE, fn: dotGrid },
  { id: 'dot-bloom', label: 'Bloom', group: 'Points', hint: 'Concentric rings opening and closing.', uses: BASE, fn: dotBloom },
  { id: 'sphere', label: 'Sphere', group: 'Points', hint: 'A ball shaded by dot size, lit from a turning source.', uses: BASE, fn: ditherSphere },

  // ----- Lines -----
  { id: 'network', label: 'Network', group: 'Lines', hint: 'A hub, its nodes, and the threads between them.', uses: BASE,
    params: [param('nodes', 'Nodes', 3, 120, 1, 34), param('reach', 'Reach', 0.03, 0.5, 0.005, 0.15)], fn: network },
  { id: 'constellation', label: 'Constellation', group: 'Lines', hint: 'A star map that drifts and twinkles.', uses: BASE,
    params: [param('stars', 'Stars', 8, 260, 1, 80), param('reach', 'Reach', 0.03, 0.4, 0.005, 0.12)], fn: constellation },
  { id: 'orbits', label: 'Orbits', group: 'Lines', hint: 'Tilted ellipses with trailing bodies.', uses: BASE,
    params: [param('orbits', 'Orbits', 1, 20, 1, 8), param('tilt', 'Tilt', 0, 1, 0.01, 0.3), param('spread', 'Spread', 0.3, 2, 0.01, 1)], fn: orbits },
  { id: 'breath', label: 'Breath', group: 'Lines', hint: 'Rings expanding and settling round a glow.', uses: BASE, fn: breath },
  { id: 'flow-lines', label: 'Flow Lines', group: 'Lines', hint: 'Streamlines traced through a turning field.', uses: BASE,
    params: [param('lines', 'Lines', 8, 600, 1, 140), param('steps', 'Length', 4, 200, 1, 40), param('stride', 'Stride', 1, 14, 0.1, 4), param('weight', 'Weight', 0.2, 3, 0.05, 1)], fn: flowLines },
  { id: 'sacred', label: 'Geometry', group: 'Lines', hint: 'Flower of life, with counter-rotating triangles.', uses: BASE,
    params: [param('layers', 'Layers', 1, 8, 1, 3), param('petals', 'Petals', 3, 20, 1, 6), param('step', 'Step', 0.2, 2, 0.01, 0.8), param('weight', 'Weight', 0.2, 3, 0.05, 0.8)], fn: sacredGeo },
  { id: 'circuit', label: 'Circuit', group: 'Lines', hint: 'Traces, pads and vias, pulsing.', uses: BASE, fn: circuit },

  // ----- Tiles -----
  { id: 'morph-grid', label: 'Morph Grid', group: 'Tiles', hint: 'Tiles rounding off and squaring up. Inverted.', uses: BASE, fn: morphGrid },
  { id: 'pixel-sort', label: 'Sort', group: 'Tiles', hint: 'Vertical bars, centre aligned.', uses: BASE, fn: pixelSort },
  { id: 'wave-bars', label: 'Wave Bars', group: 'Tiles', hint: 'Horizontal bars breathing to two sines.', uses: BASE, fn: waveBars },

  // ----- Type -----
  { id: 'text-wave', label: 'Text Wave', group: 'Type', hint: 'Your line, repeated and bent into an arc.', uses: WITH_TEXT, fn: textWave },
  { id: 'type-cascade', label: 'Cascade', group: 'Type', hint: 'Words scrolling up, letters sliding in.', uses: WITH_TEXT, fn: typeCascade },
  { id: 'text-scatter', label: 'Scatter', group: 'Type', hint: 'Loose characters gathering and letting go.', uses: BASE, fn: textScatter },
  { id: 'grid-counter', label: 'Counter', group: 'Type', hint: 'Hex tiles flipping on a wave.', uses: BASE, fn: gridCounter },
  { id: 'matrix-rain', label: 'Rain', group: 'Type', hint: 'Falling glyphs, the accent on the leading pair.', uses: BASE, fn: matrixRain },

  // ----- Dimensional -----
  { id: 'wire-terrain', label: 'Terrain', group: 'Dimensional', hint: 'A wireframe landscape in perspective.', uses: WITH_ROTATE,
    params: [param('cols', 'Columns', 6, 80, 1, 30), param('rows', 'Rows', 4, 60, 1, 20), param('height', 'Height', 0, 3, 0.01, 1)], fn: wireTerrain },
  { id: 'particle-ring', label: 'Torus', group: 'Dimensional', hint: 'Points on a ring, depth sorted.', uses: WITH_ROTATE,
    params: [param('points', 'Points ×50', 2, 60, 1, 12), param('radius', 'Radius', 0.3, 1.6, 0.01, 1), param('tube', 'Tube', 0.05, 1, 0.01, 0.35)], fn: particleRing },
]

export const FIGURE_BY_ID = new Map(FIGURES.map((f) => [f.id, f]))

/**
 * The module-level names a figure body may reference.
 *
 * The embed exporter lifts a generator out of the bundle with `toString()`, so
 * anything it closes over has to travel with it. These are emitted keyed by
 * `Function.prototype.name`, which is whatever the minifier renamed them to and
 * therefore matches the call sites inside the stringified body.
 *
 * They are all functions on purpose. A bare `const DEG = Math.PI / 180` used to
 * live here and had to go: a number has no name to look up at runtime, so a
 * body referencing one cannot be lifted out at all.
 */
export const FIGURE_HELPERS: Function[] = [rgb, rgba, thash, thash2, rotate3D, ground, rand, vnoise, fbm]

export const FIGURE_GROUPS = ['Constructed', 'Points', 'Lines', 'Tiles', 'Type', 'Dimensional'] as const

/** The ink triple a figure draws with, parsed once per frame rather than per mark. */
export function figureInk(ink: SignalInk) {
  return { fg: hexRgb(ink.ink), bg: hexRgb(ink.paper), accent: hexRgb(ink.accent) }
}
