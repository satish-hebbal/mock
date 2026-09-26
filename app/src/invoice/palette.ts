/**
 * The logo's colours, for the Wash template to paint with.
 *
 * A logo is mostly one or two brand colours on a background, so the job is not
 * "every colour in the image" but "the few a person would name if asked what
 * colour the logo is". That rules out three kinds of pixel before anything is
 * counted: transparent ones (the background of a PNG), near-white and
 * near-black ones (the background of a JPEG, and outlines), and greys (which
 * paint a wash the colour of dishwater).
 *
 * What is left is binned coarsely by hue and lightness, each bin keeps the
 * average of what fell into it, and the bins are ranked by how much of the
 * logo they cover, with a thumb on the scale for saturation, because the brand
 * colour is usually the vivid one even when it is the smaller area. The winners
 * must be a real hue apart from one another, or a logo in two greens paints a
 * wash in one.
 */

const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
const toHex = (r: number, g: number, b: number) => `#${hex(r)}${hex(g)}${hex(b)}`

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60
  return [h, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255)
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Up to four colours from an image, most characteristic first. */
export async function extractPalette(src: Blob | string): Promise<string[]> {
  /*
   * Decoded through an <img> rather than `createImageBitmap`, which will not
   * take an SVG in most engines, and an SVG is exactly what a logo usually is.
   * An SVG with no width or height of its own reports 0 x 0, so the long side
   * falls back to the target size.
   */
  const url = typeof src === 'string' ? src : URL.createObjectURL(src)
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  try {
    await img.decode()
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url)
  }
  const iw = img.naturalWidth || 64
  const ih = img.naturalHeight || 64
  // 64 on the long side is plenty to find the colours of a logo, and keeps the
  // count to a few thousand pixels whatever was uploaded
  const scale = 64 / Math.max(iw, ih, 1)
  const w = Math.max(1, Math.round(iw * scale))
  const h = Math.max(1, Math.round(ih * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(img, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)

  const bins = new Map<string, { r: number; g: number; b: number; n: number; s: number; h: number }>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    const [hh, ss, ll] = rgbToHsl(r, g, b)
    if (ll > 0.93 || ll < 0.06 || ss < 0.16) continue
    const key = `${Math.round(hh / 24)}:${Math.round(ll * 4)}`
    const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, n: 0, s: 0, h: hh }
    bin.r += r
    bin.g += g
    bin.b += b
    bin.s += ss
    bin.n += 1
    bins.set(key, bin)
  }

  const ranked = [...bins.values()]
    .map((b) => {
      const r = b.r / b.n
      const g = b.g / b.n
      const bl = b.b / b.n
      const [hh, ss] = rgbToHsl(r, g, bl)
      return { color: toHex(r, g, bl), hue: hh, score: b.n * (0.4 + ss) }
    })
    .sort((a, b) => b.score - a.score)

  const picked: typeof ranked = []
  for (const c of ranked) {
    if (picked.every((p) => hueGap(p.hue, c.hue) > 22)) picked.push(c)
    if (picked.length === 4) break
  }
  return picked.map((p) => p.color)
}

/**
 * What the wash paints with: the logo's colours when there are any, and
 * otherwise the accent with two neighbours either side of it on the wheel, so
 * an invoice with no logo still gets a wash that belongs to it.
 */
export function washColors(palette: string[], accent: string): string[] {
  if (palette.length >= 2) return palette
  const base = palette[0] ?? accent
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(base)
  if (!m) return [base]
  const [h, s, l] = rgbToHsl(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16))
  const sat = Math.max(0.45, s)
  return [base, hslToHex((h + 38) % 360, sat, Math.min(0.62, l + 0.08)), hslToHex((h + 322) % 360, sat, l)]
}
