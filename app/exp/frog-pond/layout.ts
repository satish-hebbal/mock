// Where everything in the pond goes. Deterministic for a given seed and size, so a resize or a quality
// change rebuilds the same pond rather than reshuffling it.

export type Pad = { x: number; y: number; r: number; angle: number; seed: number; tint: number }
export type Flower = { x: number; y: number; r: number; angle: number; seed: number; pad: number }
export type Stone = { x: number; y: number; length: number; width: number; height: number; angle: number; seed: number; tone: number }
export type Blade = { x: number; y: number; angle: number; length: number; width: number; curl: number; seed: number }
// waterBottom: how far down the visible pond reaches (the page height, or the half layout's shoreline)
export type Layout = { width: number; height: number; waterBottom: number; unit: number; pads: Pad[]; flowers: Flower[]; stones: Stone[]; blades: Blade[] }

// the page content sits in this ellipse (fractions of the viewport); pads mostly keep out of it
export const FOCUS = { x: 0.5, y: 0.56, rx: 0.34, ry: 0.26 }

export function pondUnit(width: number, height: number) {
  return Math.min(1.6, Math.max(0.6, Math.min(width, height) / 900))
}

export function buildLayout(width: number, height: number, seed: number, waterBottom = height): Layout {
  const half = waterBottom < height * 0.95
  const unit = pondUnit(width, height)
  let s = seed
  const rand = () => (s = (s * 16807) % 0x7fffffff) / 0x7fffffff
  const between = (a: number, b: number) => a + rand() * (b - a)
  // the page content over the water: the whole middle for the full pond; for the half pond only the
  // title just above the shoreline, since the cards sit on the black
  const inFocus = (x: number, y: number, pad = 1) =>
    half
      ? Math.hypot((x / width - 0.5) / (0.17 * pad), (y - (waterBottom - height * 0.24)) / (height * 0.1 * pad)) < 1
      : Math.hypot((x / width - FOCUS.x) / (FOCUS.rx * pad), (y / height - FOCUS.y) / (FOCUS.ry * pad)) < 1

  // lily pads grow in clusters, with the odd loner drifting between them
  const pads: Pad[] = []
  const fits = (x: number, y: number, r: number) => pads.every((p) => Math.hypot(p.x - x, p.y - y) > (p.r + r) * 0.84)
  const addPad = (x: number, y: number, r: number) => {
    if (x < -r * 0.5 || y < -r * 0.5 || x > width + r * 0.5 || y > waterBottom + r * 0.3) return false
    if (inFocus(x, y) && rand() > 0.12) return false
    if (!fits(x, y, r)) return false
    pads.push({ x, y, r, angle: rand() * Math.PI * 2, seed: rand(), tint: Math.pow(rand(), 1.6) })
    return true
  }
  const clusters = Math.max(4, Math.round((width * height) / (360 * 360 * unit * unit)))
  for (let c = 0, tries = 0; c < clusters && tries < 200; tries++) {
    const cx = between(0, width)
    const cy = between(0, waterBottom)
    if (inFocus(cx, cy, 1.15)) continue
    c++
    const count = 5 + Math.floor(rand() * 9)
    const rMax = between(46, 66) * unit
    for (let i = 0, t = 0; i < count && t < count * 12; t++) {
      const r = between(0.45, 1) * rMax
      const ang = rand() * Math.PI * 2
      const dist = Math.sqrt(rand()) * rMax * 3.2
      if (addPad(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, r)) i++
    }
  }
  for (let i = 0, t = 0; i < 16 && t < 300; t++) {
    if (addPad(between(0, width), between(0, waterBottom), between(22, 40) * unit)) i++
  }

  // water lilies: about one pad in seven flowers, sitting toward its edge
  const flowers: Flower[] = []
  pads.forEach((p, i) => {
    if (rand() > 0.15 || p.r < 30 * unit) return
    const a = rand() * Math.PI * 2
    flowers.push({
      x: p.x + Math.cos(a) * p.r * 0.35,
      y: p.y + Math.sin(a) * p.r * 0.35,
      r: Math.min(p.r * 0.55, between(17, 24) * unit),
      angle: rand() * Math.PI * 2,
      seed: rand(),
      pad: i,
    })
  })

  const stones: Stone[] = Array.from({ length: 6 }, () => {
    const length = between(18, 44)
    return {
      x: between(0.05, 0.95) * width,
      y: between(0.05, 0.95) * waterBottom,
      length: length * unit,
      width: length * between(0.6, 0.8) * unit,
      height: length * 0.42 * unit,
      angle: rand() * Math.PI,
      seed: rand(),
      tone: Math.floor(rand() * 3),
    }
  })

  // underwater weed in clumps across the bed, baked once, so it costs nothing per frame
  const blades: Blade[] = []
  const clumps = Math.round((width * height) / (260 * 260 * unit * unit))
  for (let c = 0; c < clumps; c++) {
    const cx = between(0, width)
    const cy = between(0, waterBottom)
    const heading = rand() * Math.PI * 2
    const count = 4 + Math.floor(rand() * 7)
    for (let i = 0; i < count; i++) {
      blades.push({
        x: cx + (rand() - 0.5) * 18 * unit,
        y: cy + (rand() - 0.5) * 18 * unit,
        angle: heading + (rand() - 0.5) * 1.8,
        length: between(30, 110) * unit,
        width: between(2.5, 5.5) * unit,
        curl: (rand() - 0.5) * 1.4,
        seed: rand(),
      })
    }
  }

  return { width, height, waterBottom, unit, pads, flowers, stones, blades }
}
