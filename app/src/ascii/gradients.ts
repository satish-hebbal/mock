/**
 * Gradient maps: brightness in, colour out.
 *
 * Used in three places that would otherwise each keep their own list: the
 * Gradient colour mode, the Thermal and Cyanotype styles, and the Map layer.
 * Each gradient is written dark end first, as a few stops, and turned into a
 * 256-entry table once, because the callers look colours up per pixel and
 * interpolating stops a million times a frame is the whole cost of the pass.
 */

export interface Gradient {
  id: string
  label: string
  /** dark to light */
  stops: string[]
}

export const GRADIENTS: Gradient[] = [
  { id: 'thermal', label: 'Thermal', stops: ['#000004', '#2c0b5e', '#8a1f8e', '#e2442f', '#fca50a', '#fcffa4'] },
  { id: 'flir', label: 'Infrared', stops: ['#050505', '#3b0f70', '#b4135a', '#f76e1c', '#fde047', '#ffffff'] },
  { id: 'lava', label: 'Lava', stops: ['#050000', '#3d0500', '#9c1400', '#ff4d00', '#ffb300', '#fff6c2'] },
  { id: 'arctic', label: 'Arctic', stops: ['#020617', '#0c2d5a', '#1b6fa8', '#5fc3e4', '#d8f3ff'] },
  { id: 'nightvision', label: 'Night vision', stops: ['#000800', '#013d0c', '#0a8f2a', '#5cff6e', '#e9ffe6'] },
  { id: 'amber', label: 'Amber CRT', stops: ['#0a0500', '#4a2600', '#a65c00', '#ffae00', '#fff0c2'] },
  { id: 'cyber', label: 'Cyber', stops: ['#07001a', '#3a0ca3', '#f72585', '#4cc9f0', '#f8f9ff'] },
  { id: 'sunset', label: 'Sunset', stops: ['#120024', '#5b0e5e', '#c2255c', '#ff7849', '#ffd07a'] },
  { id: 'ocean', label: 'Ocean', stops: ['#00111c', '#003b5c', '#00798c', '#30c5b5', '#e0fff7'] },
  { id: 'forest', label: 'Moss', stops: ['#0b1406', '#23391a', '#4f7a28', '#a3c65b', '#f0f7d4'] },
  { id: 'copper', label: 'Copper', stops: ['#0d0602', '#40200e', '#8c4a22', '#d98c52', '#ffe2c2'] },
  { id: 'gold', label: 'Gilded', stops: ['#0c0800', '#3e2c00', '#9a7400', '#e6c34a', '#fff7d6'] },
  { id: 'cyanotype', label: 'Cyanotype', stops: ['#06173d', '#0b3a78', '#2e6fb3', '#9cc3e6', '#f4f8fb'] },
  { id: 'blueprint', label: 'Blueprint', stops: ['#0a2a66', '#1646a0', '#4f7fd0', '#b7cdf2', '#ffffff'] },
  { id: 'rose', label: 'Rose', stops: ['#1a0610', '#5c1235', '#b83b6b', '#f28bb0', '#ffe6f0'] },
  { id: 'mono', label: 'Mono', stops: ['#000000', '#ffffff'] },
]

const BY_ID = new Map(GRADIENTS.map((g) => [g.id, g]))

export function getGradient(id: string): Gradient {
  return BY_ID.get(id) ?? GRADIENTS[0]
}

function hex(h: string): [number, number, number] {
  const s = h.replace('#', '')
  const f = s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s
  const n = parseInt(f, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const luts = new Map<string, Uint8ClampedArray>()

/** A 256-entry RGB lookup table for stops written dark to light. */
export function lutFromStops(stops: string[]): Uint8ClampedArray {
  const key = stops.join(',')
  const hit = luts.get(key)
  if (hit) return hit
  const rgb = stops.map(hex)
  const out = new Uint8ClampedArray(256 * 3)
  const segs = Math.max(1, rgb.length - 1)
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * segs
    const k = Math.min(segs - 1, Math.floor(t))
    const f = t - k
    const a = rgb[k]
    const b = rgb[Math.min(rgb.length - 1, k + 1)]
    out[i * 3] = a[0] + (b[0] - a[0]) * f
    out[i * 3 + 1] = a[1] + (b[1] - a[1]) * f
    out[i * 3 + 2] = a[2] + (b[2] - a[2]) * f
  }
  luts.set(key, out)
  return out
}

export function gradientLut(id: string): Uint8ClampedArray {
  return lutFromStops(getGradient(id).stops)
}

/** CSS for a swatch of the gradient, for the pickers. */
export function gradientCss(id: string): string {
  return `linear-gradient(90deg, ${getGradient(id).stops.join(', ')})`
}

/** HSL to RGB, 0..360 and 0..1 in, 0..255 out. For the spectrum colour mode. */
export function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g] = [c, x]
  else if (hp < 2) [r, g] = [x, c]
  else if (hp < 3) [g, b] = [c, x]
  else if (hp < 4) [g, b] = [x, c]
  else if (hp < 5) [r, b] = [x, c]
  else [r, b] = [c, x]
  const m = l - c / 2
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}
