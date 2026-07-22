import { paintMeshGradient } from '../lib/meshGradient'
import { getWallpaper } from './wallpapers'
import { getShotsDevice, type DeviceNotch } from './devices'
import { computeLayout, perspectiveFor, type CardLayout } from './layout'
import type { ShotsBackground, ShotsGradient, ShotsImage } from './types'

// ————— small helpers —————

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex)
  if (!m) return `rgba(0,0,0,${a})`
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`
}

function paintGradient(ctx: CanvasRenderingContext2D, w: number, h: number, g: ShotsGradient) {
  if (g.kind === 'radial') {
    const rg = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, Math.max(w, h) * 0.75)
    rg.addColorStop(0, g.from)
    rg.addColorStop(1, g.to)
    ctx.fillStyle = rg
    ctx.fillRect(0, 0, w, h)
    return
  }
  const rad = (g.angle * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const len = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
  const lg = ctx.createLinearGradient(w / 2 - dx * len, h / 2 - dy * len, w / 2 + dx * len, h / 2 + dy * len)
  lg.addColorStop(0, g.from)
  lg.addColorStop(1, g.to)
  ctx.fillStyle = lg
  ctx.fillRect(0, 0, w, h)
}

let noiseTile: HTMLCanvasElement | null = null
function getNoiseTile(): HTMLCanvasElement {
  if (noiseTile) return noiseTile
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const data = g.createImageData(128, 128)
  for (let i = 0; i < data.data.length; i += 4) {
    const v = (Math.random() * 255) | 0
    data.data[i] = data.data[i + 1] = data.data[i + 2] = v
    data.data[i + 3] = 255
  }
  g.putImageData(data, 0, 0)
  noiseTile = c
  return c
}

// ————— background —————

export function paintShotBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  bg: ShotsBackground,
  images: Record<string, HTMLImageElement>,
) {
  ctx.save()
  const over = bg.blur > 0 ? 0.08 : 0
  const ox = -W * over
  const oy = -H * over
  const ow = W * (1 + over * 2)
  const oh = H * (1 + over * 2)
  if (bg.blur > 0 || bg.brightness !== 1)
    ctx.filter = `blur(${(bg.blur * W) / 1280}px) brightness(${bg.brightness})`

  ctx.save()
  ctx.translate(ox, oy)
  const gw = ow
  const gh = oh
  switch (bg.type) {
    case 'transparent':
      break // leave the canvas untouched so the export keeps a real alpha channel
    case 'solid':
      ctx.fillStyle = bg.color
      ctx.fillRect(0, 0, gw, gh)
      break
    case 'gradient':
      paintGradient(ctx, gw, gh, bg.gradient)
      break
    case 'wallpaper':
      paintGradient(ctx, gw, gh, getWallpaper(bg.wallpaperId).gradient)
      break
    case 'mesh':
      paintMeshGradient(ctx, gw, gh, bg.mesh.seed, bg.mesh.colors)
      break
    case 'image': {
      const img = bg.imageAssetId ? images[bg.imageAssetId] : null
      if (img) {
        const scale = Math.max(gw / img.naturalWidth, gh / img.naturalHeight)
        const dw = img.naturalWidth * scale
        const dh = img.naturalHeight * scale
        ctx.drawImage(img, (gw - dw) / 2, (gh - dh) / 2, dw, dh)
      } else {
        ctx.fillStyle = '#15151b'
        ctx.fillRect(0, 0, gw, gh)
      }
      break
    }
  }
  ctx.restore()
  ctx.restore()

  // vignette and grain paint over the whole frame, which would fill the alpha
  if (bg.type === 'transparent') return

  if (bg.vignette > 0) {
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, `rgba(0,0,0,${bg.vignette * 0.65})`)
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, W, H)
  }

  if (bg.noise > 0) {
    const pat = ctx.createPattern(getNoiseTile(), 'repeat')!
    ctx.save()
    ctx.globalAlpha = bg.noise * 0.5
    ctx.globalCompositeOperation = 'overlay'
    ctx.fillStyle = pat
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }
}

// ————— the screenshot "card" (chrome + image + radius + border) —————

function drawNotch(g: CanvasRenderingContext2D, notch: DeviceNotch, L: CardLayout) {
  const { screenX: sx, screenY: sy, screenW: sw } = L
  if (notch === 'island') {
    const w = sw * 0.3
    const h = sw * 0.032
    g.fillStyle = '#000000'
    g.beginPath()
    g.roundRect(sx + (sw - w) / 2, sy + sw * 0.02, w, h, h / 2)
    g.fill()
  } else if (notch === 'punch') {
    const r = sw * 0.016
    g.fillStyle = '#000000'
    g.beginPath()
    g.arc(sx + sw / 2, sy + sw * 0.032, r, 0, Math.PI * 2)
    g.fill()
  } else if (notch === 'camera') {
    const r = Math.max(1.2, sw * 0.006)
    g.fillStyle = '#2a2a30'
    g.beginPath()
    g.arc(sx + sw / 2, sy - L.bezelPx * 0.5, r, 0, Math.PI * 2)
    g.fill()
  }
}

/** Draw `media` filling the rect, cropping the overflow — CSS `object-fit: cover`. */
function drawCover(
  g: CanvasRenderingContext2D,
  media: CanvasImageSource,
  mediaW: number,
  mediaH: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (mediaW <= 0 || mediaH <= 0) {
    g.drawImage(media, x, y, w, h)
    return
  }
  const scale = Math.max(w / mediaW, h / mediaH)
  const dw = mediaW * scale
  const dh = mediaH * scale
  g.drawImage(media, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

export function renderCard(
  media: CanvasImageSource,
  L: CardLayout,
  img: ShotsImage,
  mediaW = 0,
  mediaH = 0,
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(L.cardW))
  c.height = Math.max(1, Math.round(L.cardH))
  const g = c.getContext('2d')!
  const W = c.width
  const H = c.height
  const hasDevice = !img.style3d && img.device !== 'none'
  const dev = getShotsDevice(hasDevice ? img.device : 'none')
  const dark = img.frame === 'macos-dark' || img.frame === 'browser-dark'
  const browser = img.frame.startsWith('browser')
  const barH = L.barH

  // device bezel
  if (hasDevice) {
    const orr = Math.min(L.outerRadiusPx, W / 2, H / 2)
    g.beginPath()
    g.roundRect(0, 0, W, H, orr)
    g.fillStyle = dev.color
    g.fill()
    const lw = Math.max(1, L.bezelPx * 0.12)
    g.lineWidth = lw
    g.strokeStyle = dev.edge
    g.beginPath()
    g.roundRect(lw / 2, lw / 2, W - lw, H - lw, orr)
    g.stroke()
  }

  const sx = L.screenX
  const sy = L.screenY
  const sw = L.screenW
  const sh = L.screenH
  const r = Math.min(L.screenRadiusPx, sw / 2, sh / 2)

  g.save()
  g.beginPath()
  g.roundRect(sx, sy, sw, sh, r)
  g.clip()

  // screen base fill (so letterboxed media / chrome has a backdrop)
  g.fillStyle = dark ? '#0c0c10' : '#ffffff'
  g.fillRect(sx, sy, sw, sh)

  if (barH > 0) {
    g.fillStyle = dark ? '#2b2b31' : '#f4f4f6'
    g.fillRect(sx, sy, sw, barH)
    const dotR = Math.max(2.5, barH * 0.13)
    const lx = sx + barH * 0.75
    const cy = sy + barH / 2
    ;['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
      g.beginPath()
      g.arc(lx + i * dotR * 3.1, cy, dotR, 0, Math.PI * 2)
      g.fillStyle = col
      g.fill()
    })
    if (browser) {
      const pillH = barH * 0.48
      const pillX = lx + 3 * dotR * 3.1 + barH * 0.5
      const pillW = Math.max(20, sx + sw - pillX - barH * 0.6)
      g.fillStyle = dark ? '#3c3c44' : '#e4e4ea'
      g.beginPath()
      g.roundRect(pillX, sy + (barH - pillH) / 2, pillW, pillH, pillH / 2)
      g.fill()
    }
  }

  drawCover(g, media, mediaW, mediaH, sx, sy + barH, sw, sh - barH)
  g.restore()

  if (L.borderPx > 0) {
    g.save()
    g.lineWidth = L.borderPx
    g.strokeStyle = img.border.color
    g.beginPath()
    g.roundRect(sx + L.borderPx / 2, sy + L.borderPx / 2, sw - L.borderPx, sh - L.borderPx, Math.max(1, r))
    g.stroke()
    g.restore()
  }

  drawNotch(g, dev.notch, L)
  return c
}

// ————— perspective warp of the card onto a full-canvas layer —————

function affineTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s: number[][],
  d: number[][],
) {
  // dilate destination triangle slightly to hide inter-triangle seams
  const cx = (d[0][0] + d[1][0] + d[2][0]) / 3
  const cy = (d[0][1] + d[1][1] + d[2][1]) / 3
  const dd = d.map(([x, y]) => {
    const dx = x - cx
    const dy = y - cy
    const len = Math.hypot(dx, dy) || 1
    return [x + (dx / len) * 0.7, y + (dy / len) * 0.7]
  })
  const [sx0, sy0] = s[0]
  const [sx1, sy1] = s[1]
  const [sx2, sy2] = s[2]
  const denom = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1)
  if (Math.abs(denom) < 1e-6) return
  const dx = dd.map((p) => p[0])
  const dy = dd.map((p) => p[1])
  const a = (dx[0] * (sy1 - sy2) + dx[1] * (sy2 - sy0) + dx[2] * (sy0 - sy1)) / denom
  const b = (sx0 * (dx[1] - dx[2]) + sx1 * (dx[2] - dx[0]) + sx2 * (dx[0] - dx[1])) / denom
  const e =
    (sx0 * (sy1 * dx[2] - sy2 * dx[1]) +
      sx1 * (sy2 * dx[0] - sy0 * dx[2]) +
      sx2 * (sy0 * dx[1] - sy1 * dx[0])) /
    denom
  const c = (dy[0] * (sy1 - sy2) + dy[1] * (sy2 - sy0) + dy[2] * (sy0 - sy1)) / denom
  const dcoef = (sx0 * (dy[1] - dy[2]) + sx1 * (dy[2] - dy[0]) + sx2 * (dy[0] - dy[1])) / denom
  const f =
    (sx0 * (sy1 * dy[2] - sy2 * dy[1]) +
      sx1 * (sy2 * dy[0] - sy0 * dy[2]) +
      sx2 * (sy0 * dy[1] - sy1 * dy[0])) /
    denom

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(dd[0][0], dd[0][1])
  ctx.lineTo(dd[1][0], dd[1][1])
  ctx.lineTo(dd[2][0], dd[2][1])
  ctx.closePath()
  ctx.clip()
  ctx.transform(a, c, b, dcoef, e, f)
  ctx.drawImage(img, 0, 0)
  ctx.restore()
}

/** Build a full W×H transparent layer with the card placed (and tilted). */
export function buildCardLayer(
  W: number,
  H: number,
  card: HTMLCanvasElement,
  L: CardLayout,
  img: ShotsImage,
): HTMLCanvasElement {
  const layer = document.createElement('canvas')
  layer.width = W
  layer.height = H
  const g = layer.getContext('2d')!

  // pseudo-3D tilt only applies in 3D style; in-plane rotate always does
  const rx = ((img.style3d ? img.rotateX : 0) * Math.PI) / 180
  const ry = ((img.style3d ? img.rotateY : 0) * Math.PI) / 180
  const rz = (img.rotate * Math.PI) / 180

  if (rx === 0 && ry === 0 && rz === 0) {
    g.drawImage(card, L.cx - L.cardW / 2, L.cy - L.cardH / 2, L.cardW, L.cardH)
    return layer
  }

  const P = perspectiveFor(L.cardW)
  const project = (u: number, v: number): number[] => {
    const x = (u - 0.5) * L.cardW
    const y = (v - 0.5) * L.cardH
    // rotateZ
    const x1 = x * Math.cos(rz) - y * Math.sin(rz)
    const y1 = x * Math.sin(rz) + y * Math.cos(rz)
    // rotateY
    const x2 = x1 * Math.cos(ry)
    const z2 = -x1 * Math.sin(ry)
    const y2 = y1
    // rotateX
    const y3 = y2 * Math.cos(rx) - z2 * Math.sin(rx)
    const z3 = y2 * Math.sin(rx) + z2 * Math.cos(rx)
    const x3 = x2
    const s = P / (P - z3)
    return [L.cx + x3 * s, L.cy + y3 * s]
  }

  const N = 18
  const cw = card.width
  const ch = card.height
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const u0 = i / N
      const u1 = (i + 1) / N
      const v0 = j / N
      const v1 = (j + 1) / N
      const s00 = [u0 * cw, v0 * ch]
      const s10 = [u1 * cw, v0 * ch]
      const s11 = [u1 * cw, v1 * ch]
      const s01 = [u0 * cw, v1 * ch]
      const d00 = project(u0, v0)
      const d10 = project(u1, v0)
      const d11 = project(u1, v1)
      const d01 = project(u0, v1)
      affineTriangle(g, card, [s00, s10, s11], [d00, d10, d11])
      affineTriangle(g, card, [s00, s11, s01], [d00, d11, d01])
    }
  }
  return layer
}

// ————— shadow / glow / reflection compositing —————

function silhouette(layer: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const s = document.createElement('canvas')
  s.width = layer.width
  s.height = layer.height
  const g = s.getContext('2d')!
  g.drawImage(layer, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = color
  g.fillRect(0, 0, s.width, s.height)
  return g.canvas
}

export function compositeCard(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  L: CardLayout,
  img: ShotsImage,
  minDim: number,
) {
  // reflection (drawn first, under everything)
  if (img.reflection > 0) {
    const bottom = L.cy + L.cardH / 2
    const refl = silhouetteReflection(layer)
    ctx.save()
    ctx.globalAlpha = img.reflection * 0.5
    ctx.translate(0, 2 * bottom)
    ctx.scale(1, -1)
    ctx.drawImage(refl, 0, 0)
    ctx.restore()
  }

  // glow
  if (img.glow.strength > 0) {
    const gpx = img.glow.strength * minDim * 0.14
    const sil = silhouette(layer, img.glow.color)
    ctx.save()
    ctx.globalAlpha = Math.min(1, img.glow.strength)
    ctx.filter = `blur(${gpx}px)`
    ctx.drawImage(sil, 0, 0)
    ctx.drawImage(sil, 0, 0)
    ctx.restore()
  }

  // shadow
  if (img.shadow.opacity > 0 && img.shadow.blur > 0) {
    const sil = silhouette(layer, hexToRgba(img.shadow.color, 1))
    ctx.save()
    ctx.globalAlpha = img.shadow.opacity
    ctx.filter = `blur(${img.shadow.blur * minDim}px)`
    ctx.drawImage(sil, img.shadow.x * minDim, img.shadow.y * minDim)
    ctx.restore()
  }

  // the card itself
  ctx.drawImage(layer, 0, 0)
}

/** A vertically-faded copy of the layer, used for the reflection. */
function silhouetteReflection(layer: HTMLCanvasElement): HTMLCanvasElement {
  const s = document.createElement('canvas')
  s.width = layer.width
  s.height = layer.height
  const g = s.getContext('2d')!
  g.drawImage(layer, 0, 0)
  g.globalCompositeOperation = 'destination-in'
  const grad = g.createLinearGradient(0, 0, 0, s.height)
  grad.addColorStop(0, 'rgba(0,0,0,1)')
  grad.addColorStop(0.5, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, s.width, s.height)
  return s
}

export { computeLayout }
