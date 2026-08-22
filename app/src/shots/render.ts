import { paintMeshGradient } from '../lib/meshGradient'
import { getWallpaper } from './wallpapers'
import { computeLayout, perspectiveFor, type CardLayout } from './layout'
import { portraitGeometry, portraitMaskGradient, portraitPasses } from './portrait'
import { getCardStyle, stackShade } from './cardStyles'
import { goboCover, goboTransform } from './shadows'
import type {
  ShotsBackground,
  ShotsGobo,
  ShotsGradient,
  ShotsImage,
  ShotsPortrait,
} from './types'

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
  /**
   * Camera zoom, clamped to >= 1 by the caller. The backdrop magnifies with the
   * camera so a push-in enlarges the whole picture, not just the devices.
   */
  zoom = 1,
) {
  ctx.save()
  const over = (bg.blur > 0 ? 0.08 : 0) + (zoom - 1) / 2
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
      paintMeshGradient(ctx, gw, gh, bg.mesh)
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
    case 'photo': {
      // keyed by photoId in the same map the 'image' case uses for imageAssetId
      const img = images[bg.photoId]
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
  /** decoded frame PNG for `L.bezel`; omit to render the screen bare */
  frame?: CanvasImageSource,
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(L.cardW))
  c.height = Math.max(1, Math.round(L.cardH))
  const g = c.getContext('2d')!
  const dark = img.frame === 'macos-dark' || img.frame === 'browser-dark'
  const browser = img.frame.startsWith('browser')
  const barH = L.barH

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

  /*
   * The inset bevel. Stroked from the card's own edge with the clip still in
   * force, so the outer half of the line falls away and what is left is a band
   * of exactly the intended width lying inside the edge.
   */
  const mount = getCardStyle(img.cardStyle)
  if (!L.bezel && mount.inset) {
    const w = mount.inset.w * L.cardW
    g.save()
    g.beginPath()
    g.roundRect(sx, sy, sw, sh, r)
    g.clip()
    g.lineWidth = w * 2
    g.strokeStyle = mount.inset.color
    g.shadowColor = mount.inset.color
    g.shadowBlur = w * 1.6
    g.shadowOffsetX = w
    g.shadowOffsetY = w
    g.stroke()
    g.restore()
  }

  if (L.borderPx > 0) {
    g.save()
    g.lineWidth = L.borderPx
    g.strokeStyle = img.border.color
    g.beginPath()
    g.roundRect(sx + L.borderPx / 2, sy + L.borderPx / 2, sw - L.borderPx, sh - L.borderPx, Math.max(1, r))
    g.stroke()
    g.restore()
  }

  // The frame goes on last, over the screenshot clipped above: the island and
  // camera are opaque pixels inside the cutout, so they land in place for free.
  if (L.bezel && frame) g.drawImage(frame, 0, 0, c.width, c.height)

  return c
}

// ————— perspective warp of the card onto a full-canvas layer —————

function affineTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s: number[][],
  d: number[][],
) {
  /*
   * Dilate the destination triangle to hide the seams between neighbours.
   *
   * Each triangle is drawn through an antialiased clip, so along a shared edge
   * both sides land at partial alpha and the pair does not add back up to one.
   * The shortfall reads as a fine dark line, and 0.7px of overlap was not
   * quite enough to close it. Overlapping is free here because neighbours
   * carry the same pixels along that edge.
   */
  const cx = (d[0][0] + d[1][0] + d[2][0]) / 3
  const cy = (d[0][1] + d[1][1] + d[2][1]) / 3
  const dd = d.map(([x, y]) => {
    const dx = x - cx
    const dy = y - cy
    const len = Math.hypot(dx, dy) || 1
    return [x + (dx / len) * 1.4, y + (dy / len) * 1.4]
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

  /*
   * No tilt means no perspective, so the mesh below is not needed.
   *
   * Work the projection through with rx = ry = 0 and every z comes out zero,
   * the perspective divide becomes 1, and what is left is an in-plane rotation:
   * exactly what `ctx.rotate` does, in one exact operation.
   *
   * Routing that case through the warp anyway was drawing 648 separately
   * clipped triangles to reproduce a rotation, and each clip edge is
   * antialiased, so the seams between them showed in the export as faint
   * diagonal dotted lines across the screenshot. The preview never had them,
   * because CSS transforms the element in one piece, which is why it only ever
   * turned up in the exported file.
   */
  if (rx === 0 && ry === 0) {
    g.save()
    g.translate(L.cx, L.cy)
    g.rotate(rz)
    g.drawImage(card, -L.cardW / 2, -L.cardH / 2, L.cardW, L.cardH)
    g.restore()
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

  /*
   * The mount, drawn back to front behind the card.
   *
   * Every one of these is the card's own silhouette moved or scaled, which is
   * why they survive rotation for nothing: the silhouette already carries the
   * card's shape and angle, where a reconstructed rounded rect would have to be
   * rotated to match and would drift the moment the layout changed.
   *
   * Rings scale about the card centre with separate x and y factors, so a band
   * meant to be N pixels wide is N pixels on all four sides rather than
   * spreading further along the card's longer axis.
   */
  const mount = getCardStyle(img.cardStyle)
  if (!L.bezel) {
    const at = (sil: HTMLCanvasElement, sx: number, sy: number, dx = 0, dy = 0) => {
      ctx.save()
      ctx.translate(L.cx + dx, L.cy + dy)
      ctx.scale(sx, sy)
      ctx.translate(-L.cx, -L.cy)
      ctx.drawImage(sil, 0, 0)
      ctx.restore()
    }

    if (mount.stack) {
      const st = mount.stack
      const sil = silhouette(layer, st.color)
      // furthest copy first, so nearer ones cover it
      for (let k = st.count; k >= 1; k--) {
        const inset = st.shrink * L.cardW * k
        const sx = (L.cardW - inset * 2) / L.cardW
        const dx = st.dx * L.cardW * k
        const dy = st.dy * L.cardW * k
        // each sheet casts onto the one behind it, or the stack reads as one
        // flat shape with a stepped edge
        const sh = stackShade(k)
        const shade = silhouette(layer, sh.color)
        ctx.filter = `blur(${sh.blur * L.cardW}px)`
        at(shade, sx, 1, dx, dy + sh.dy * L.cardW)
        ctx.filter = 'none'
        at(sil, sx, 1, dx, dy)
      }
    }

    if (mount.hard) {
      at(silhouette(layer, mount.hard.color), 1, 1, mount.hard.x * L.cardW, mount.hard.y * L.cardW)
    }

    /*
     * Outermost first, so each inner band paints over the middle of the one
     * behind it and what is left is a set of annuli. Walking the list forwards
     * would draw the innermost ring at the widest reach and bury the rest.
     */
    const rings = mount.rings ?? []
    let reach = rings.reduce((sum, ring) => sum + ring.w, 0) * L.cardW
    for (let i = rings.length - 1; i >= 0; i--) {
      at(
        silhouette(layer, rings[i].color),
        (L.cardW + reach * 2) / L.cardW,
        (L.cardH + reach * 2) / L.cardH,
      )
      reach -= rings[i].w * L.cardW
    }
  }

  // the card itself
  ctx.drawImage(layer, 0, 0)
}

// ————— shadow scene —————

/**
 * Paint a gobo across the frame.
 *
 * The asset is already flat black with its darkness in alpha, so this is a
 * plain draw rather than a multiply: a shadow that is transparent wherever the
 * light got through composites correctly by definition.
 *
 * 'source-atop' is what keeps a transparent export honest. A shadow has to land
 * on something, and without it the pattern would paint itself into the alpha
 * channel of a background that was meant to stay empty.
 */
export function paintShadowScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  gobo: ShotsGobo,
  art: CanvasImageSource,
  iw: number,
  ih: number,
) {
  const { rad, scale } = goboTransform(gobo)
  const { w, h } = goboCover(W, H, iw, ih)
  ctx.save()
  ctx.globalAlpha = gobo.opacity
  ctx.globalCompositeOperation = 'source-atop'
  // translate before rotate, so the slide reads in frame space rather than
  // being turned along with the pattern. CSS lists the same order right to left.
  ctx.translate(W / 2 + gobo.x * W, H / 2 + gobo.y * H)
  ctx.rotate(rad)
  ctx.scale(scale, scale)
  ctx.drawImage(art, -w / 2, -h / 2, w, h)
  ctx.restore()
}

// ————— portrait (depth of field over the finished frame) —————

/**
 * Blur a canvas with its edges held, rather than fading into nothing.
 *
 * `ctx.filter` samples transparent black past the bitmap, so a straight blur
 * eats a soft transparent band all the way round the frame, exactly where the
 * out-of-focus region is. Padding the source and stretching its edge pixels
 * outward first gives the kernel something real to reach into, so the border
 * comes back the colour it started.
 */
function blurCanvas(src: HTMLCanvasElement, px: number): HTMLCanvasElement {
  const W = src.width
  const H = src.height
  const P = Math.max(1, Math.ceil(px * 1.5))

  const pad = document.createElement('canvas')
  pad.width = W + P * 2
  pad.height = H + P * 2
  const pg = pad.getContext('2d')!
  pg.drawImage(src, P, P)
  pg.drawImage(src, 0, 0, 1, H, 0, P, P, H)
  pg.drawImage(src, W - 1, 0, 1, H, W + P, P, P, H)
  pg.drawImage(src, 0, 0, W, 1, P, 0, W, P)
  pg.drawImage(src, 0, H - 1, W, 1, P, H + P, W, P)
  pg.drawImage(src, 0, 0, 1, 1, 0, 0, P, P)
  pg.drawImage(src, W - 1, 0, 1, 1, W + P, 0, P, P)
  pg.drawImage(src, 0, H - 1, 1, 1, 0, H + P, P, P)
  pg.drawImage(src, W - 1, H - 1, 1, 1, W + P, H + P, P, P)

  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const og = out.getContext('2d')!
  og.filter = `blur(${px}px)`
  og.drawImage(pad, -P, -P)
  /*
   * Hand the canvas back with a clean context.
   *
   * `getContext` returns the same object every time, so a filter left set here
   * is still set when the caller masks this canvas, and `ctx.filter` applies to
   * fills as much as to images. The mask gradient would come out blurred, and
   * blurring a fill that covers the whole canvas drags transparency in from
   * beyond its edges, so the mask thinned out around the border and let the
   * sharp original show through exactly there.
   */
  og.filter = 'none'
  return out
}

/**
 * Defocus the composed frame around the focal point, in place.
 *
 * Runs last, on everything: background, devices, shadows. That is the whole
 * point of it, since a lens does not know which parts of a scene you consider
 * the subject, and a blur that skipped the phone would give away that the
 * picture was assembled rather than taken.
 *
 * The passes are applied in order, each over the result of the last, matching
 * how the preview's stacked `backdrop-filter` layers compose.
 */
export function applyPortrait(canvas: HTMLCanvasElement, p: ShotsPortrait | undefined) {
  if (!p || p.mode === 'none') return
  const W = canvas.width
  const H = canvas.height
  const ctx = canvas.getContext('2d')!
  const g = portraitGeometry(p, W, H)

  // defocus first, then shade what is left: the shadow is cast onto the
  // finished picture, not blurred along with it
  for (const pass of portraitPasses(g)) {
    const soft = blurCanvas(canvas, pass.blur)
    const sg = soft.getContext('2d')!
    // keep only the out-of-focus ring of the blurred copy, then lay it back on
    sg.globalCompositeOperation = 'destination-in'
    sg.fillStyle = portraitMaskGradient(sg, g, pass.inner, pass.outer)
    sg.fillRect(0, 0, W, H)
    ctx.drawImage(soft, 0, 0)
  }

  if (g.darkness > 0) {
    const mask = document.createElement('canvas')
    mask.width = W
    mask.height = H
    const mg = mask.getContext('2d')!
    mg.fillStyle = `rgba(0,0,0,${g.darkness})`
    mg.fillRect(0, 0, W, H)
    mg.globalCompositeOperation = 'destination-in'
    mg.fillStyle = portraitMaskGradient(mg, g, g.inner, g.outer)
    mg.fillRect(0, 0, W, H)

    ctx.save()
    // 'source-atop', so the shade only lands on pixels that are already there.
    // A transparent background has to survive this pass with its alpha intact,
    // the same way the vignette leaves it alone.
    ctx.globalCompositeOperation = 'source-atop'
    ctx.drawImage(mask, 0, 0)
    ctx.restore()
  }
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
