/**
 * Painting the scene.
 *
 * The whole drawing goes through an offscreen layer before it reaches the
 * canvas, which looks like an indulgence until you ask what the eraser is
 * supposed to do. Drawesome's eraser "takes away area rather than whole
 * strokes", and taking away area means compositing destination-out. Do that
 * straight onto the visible canvas and the eraser punches through the paper and
 * the grid as well, leaving a hole in the page. So the ink is composited among
 * itself on its own transparent layer, and only the finished layer is laid down
 * on the paper.
 *
 * That layer is also what makes the highlighter work. Multiply against a
 * transparent backdrop is a no-op, so a highlighter stroke over bare paper
 * keeps its colour, while one crossing existing ink darkens it. Which is what a
 * highlighter does.
 */

import { geometryFor } from './geometry'
import { dashArray } from './rough'
import { PENS } from './pens'
import { FONT_STACKS, paperIsDark, type DrawDoc, type DrawElement, type GridStyle, type Viewport } from './types'

/** Path2D is not cheap to build, and the string it is built from is cached anyway. */
const pathCache = new Map<string, Path2D[]>()

function paths(key: string, ds: string[]): Path2D[] {
  const hit = pathCache.get(key)
  if (hit) return hit
  const built = ds.map((d) => new Path2D(d))
  if (pathCache.size > 8000) pathCache.clear()
  pathCache.set(key, built)
  return built
}

export interface SceneImages {
  get(assetId: string): CanvasImageSource | undefined
}

/** Font shorthand for a text element, resolved against the app's stacks. */
export function fontFor(el: { fontSize: number; fontFamily: keyof typeof FONT_STACKS }): string {
  return `${el.fontSize}px ${FONT_STACKS[el.fontFamily]}`
}

export const lineHeightFor = (fontSize: number) => fontSize * 1.25

/** Measure a text element's box. Wrapping is by explicit newline only. */
export function measureText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  fontFamily: keyof typeof FONT_STACKS,
): { w: number; h: number; lines: string[] } {
  const lines = text.split('\n')
  ctx.save()
  ctx.font = fontFor({ fontSize, fontFamily })
  let w = 0
  for (const line of lines) w = Math.max(w, ctx.measureText(line || ' ').width)
  ctx.restore()
  return { w: Math.max(w, fontSize * 0.6), h: lines.length * lineHeightFor(fontSize), lines }
}

/**
 * One element, in scene coordinates.
 *
 * The context arrives already scaled for zoom and scrolled, so everything below
 * is written as though the scene were the only thing that existed. Stroke
 * widths and dash lengths are in scene units and scale with it, which is what
 * makes zooming in show you a *bigger* drawing rather than a more detailed one.
 */
export function paintElement(
  ctx: CanvasRenderingContext2D,
  el: DrawElement,
  images?: SceneImages,
) {
  const g = geometryFor(el)
  const key = `${el.id}:${el.version}`

  ctx.save()
  ctx.translate(el.x + el.w / 2, el.y + el.h / 2)
  if (el.angle) ctx.rotate(el.angle)
  ctx.translate(-el.w / 2, -el.h / 2)
  ctx.globalAlpha = el.opacity
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (el.kind === 'erase') {
    /*
     * The whole reason for the layer. Alpha has to be full here: a
     * half-transparent destination-out leaves a ghost of the ink behind, which
     * reads as a smudge rather than an erase.
     */
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000'
    for (const p of paths(key, g.inkD)) ctx.fill(p)
    ctx.restore()
    return
  }

  if (el.kind === 'freedraw') {
    const spec = PENS[el.pen]
    if (spec.blend === 'multiply') ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = el.opacity * spec.opacity
    ctx.fillStyle = el.stroke
    for (const p of paths(key, g.inkD)) ctx.fill(p)
    ctx.restore()
    return
  }

  if (el.kind === 'image') {
    const img = images?.get(el.assetId)
    if (img) {
      ctx.drawImage(img, 0, 0, el.w, el.h)
    } else {
      // a placeholder while the bitmap is still coming out of the database
      ctx.strokeStyle = el.stroke
      ctx.lineWidth = el.strokeWidth
      ctx.setLineDash([6, 6])
      ctx.strokeRect(0, 0, el.w, el.h)
    }
    ctx.restore()
    return
  }

  if (el.kind === 'text') {
    ctx.fillStyle = el.stroke
    ctx.font = fontFor(el)
    ctx.textBaseline = 'top'
    ctx.textAlign = el.textAlign
    const lh = lineHeightFor(el.fontSize)
    const x = el.textAlign === 'center' ? el.w / 2 : el.textAlign === 'right' ? el.w : 0
    el.text.split('\n').forEach((line, i) => ctx.fillText(line, x, i * lh))
    ctx.restore()
    return
  }

  // ----- shapes and lines -----
  if (g.fillD.length) {
    if (g.fillSolid) {
      ctx.fillStyle = el.fill
      for (const p of paths(`${key}:f`, g.fillD)) ctx.fill(p)
    } else {
      // hatching is drawn, not filled: thin strokes at the fill colour
      ctx.strokeStyle = el.fill
      ctx.lineWidth = Math.max(0.5, el.strokeWidth / 2)
      ctx.setLineDash([])
      for (const p of paths(`${key}:f`, g.fillD)) ctx.stroke(p)
    }
  }

  if (g.lineD.length) {
    ctx.strokeStyle = el.stroke
    ctx.lineWidth = el.strokeWidth
    ctx.setLineDash(el.strokeStyle === 'solid' ? [] : dashArray(el.strokeStyle, el.strokeWidth))
    for (const p of paths(key, g.lineD)) ctx.stroke(p)
    ctx.setLineDash([])
  }

  // solid arrowheads: filled with the stroke colour, never dashed
  if (g.inkD.length) {
    ctx.fillStyle = el.stroke
    for (const p of paths(`${key}:i`, g.inkD)) ctx.fill(p)
  }
  ctx.restore()
}

/** A checkerboard, the transparent-background convention everywhere else. */
function paintChecker(ctx: CanvasRenderingContext2D, w: number, h: number, dark: boolean) {
  const size = 12
  ctx.fillStyle = dark ? '#2a2b2e' : '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = dark ? '#1f2022' : '#e9ecef'
  for (let y = 0; y < h; y += size) {
    for (let x = ((y / size) % 2) * size; x < w; x += size * 2) ctx.fillRect(x, y, size, size)
  }
}

/**
 * The grid, ruled or dotted.
 *
 * Two things were wrong with the first version and both made it invisible.
 *
 * It took its colour from the *app theme* rather than from the paper, so a
 * cream page in a dark-themed app got a white grid on a near-white sheet. What
 * the grid has to contrast with is the thing it is drawn on, which is the
 * paper, so that is what it reads.
 *
 * And it was pinned to 20 scene units, so it vanished under about a third zoom
 * and turned into a solid wash of lines above about six times. Stepping the
 * spacing by fives keeps the on-screen gap inside one comfortable band at any
 * zoom, which is what every CAD grid does and the reason they stay legible.
 * Every fifth line is drawn a little stronger, so the grid reads as measured
 * rather than as texture.
 */
function paintGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  vp: Viewport,
  style: GridStyle,
  onDark: boolean,
) {
  if (style === 'off') return

  /* keep the spacing between roughly 9 and 110 screen pixels */
  let step = 20
  while (step * vp.zoom < 9) step *= 5
  while (step * vp.zoom > 110 && step > 1) step /= 5

  const px = step * vp.zoom
  const ink = onDark ? '255,255,255' : '0,0,0'
  // dots are sparse, so they need a touch more presence than a continuous line
  const minor = style === 'dots' ? 0.15 : 0.055
  const major = style === 'dots' ? 0.26 : 0.1

  // where the scene origin lands, so the grid is anchored to the drawing
  const ox = ((vp.scrollX * vp.zoom) % px + px) % px
  const oy = ((vp.scrollY * vp.zoom) % px + px) % px
  // which grid index the first visible line is, for the every-fifth test
  const i0 = Math.round((ox - vp.scrollX * vp.zoom) / px)
  const j0 = Math.round((oy - vp.scrollY * vp.zoom) / px)

  ctx.save()

  if (style === 'dots') {
    const r = Math.min(1.6, Math.max(0.7, vp.zoom * 0.9))
    for (let x = ox, i = i0; x < w; x += px, i++) {
      for (let y = oy, j = j0; y < h; y += px, j++) {
        const strong = i % 5 === 0 && j % 5 === 0
        ctx.fillStyle = `rgba(${ink},${strong ? major : minor})`
        ctx.beginPath()
        ctx.arc(x, y, strong ? r * 1.35 : r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
    return
  }

  ctx.lineWidth = 1
  for (const strong of [false, true]) {
    ctx.strokeStyle = `rgba(${ink},${strong ? major : minor})`
    ctx.beginPath()
    for (let x = ox, i = i0; x < w; x += px, i++) {
      if ((i % 5 === 0) !== strong) continue
      ctx.moveTo(Math.round(x) + 0.5, 0)
      ctx.lineTo(Math.round(x) + 0.5, h)
    }
    for (let y = oy, j = j0; y < h; y += px, j++) {
      if ((j % 5 === 0) !== strong) continue
      ctx.moveTo(0, Math.round(y) + 0.5)
      ctx.lineTo(w, Math.round(y) + 0.5)
    }
    ctx.stroke()
  }
  ctx.restore()
}

export interface RenderArgs {
  ctx: CanvasRenderingContext2D
  /** CSS pixels */
  width: number
  height: number
  viewport: Viewport
  doc: DrawDoc
  images?: SceneImages
  /** the element under the pointer right now, painted along with the rest */
  live?: DrawElement | null
  /**
   * An element the DOM is drawing instead of us, i.e. the label being typed.
   *
   * Its textarea sits over the canvas showing the same string, so painting it
   * here as well renders it twice: two copies of the text a few pixels apart,
   * because canvas and CSS do not agree about where a line of type sits inside
   * its line box. Whoever is editing it owns it until they are done.
   */
  hideId?: string | null
  dark: boolean
  /** skip the paper and the grid, for exporting with a transparent background */
  skipBackground?: boolean
}

/**
 * The ink, composited among itself on its own surface.
 *
 * Kept between frames rather than allocated per repaint: at a laptop's
 * resolution this is a several-megabyte buffer and churning one every frame of
 * a drag is exactly the sort of thing that turns a smooth stroke into a
 * stuttering one.
 */
let layer: HTMLCanvasElement | null = null

function inkLayer(w: number, h: number): CanvasRenderingContext2D {
  if (!layer) layer = document.createElement('canvas')
  if (layer.width !== w || layer.height !== h) {
    layer.width = w
    layer.height = h
  }
  const ctx = layer.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return ctx
}

export function renderScene(args: RenderArgs) {
  const { ctx, width, height, viewport: vp, doc, images, live, hideId, dark, skipBackground } = args
  const dpr = ctx.canvas.width / width || 1

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  if (!skipBackground) {
    if (doc.background === 'checker') paintChecker(ctx, width, height, dark)
    else if (doc.background !== 'transparent') {
      ctx.fillStyle = doc.background
      ctx.fillRect(0, 0, width, height)
    }
    // the grid contrasts with the paper it is drawn on, not with the app
    paintGrid(ctx, width, height, vp, doc.grid, paperIsDark(doc.background, dark))
  }

  const elements = live ? [...doc.elements, live] : doc.elements
  if (elements.length) {
    const lctx = inkLayer(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)))
    lctx.setTransform(dpr * vp.zoom, 0, 0, dpr * vp.zoom, dpr * vp.scrollX * vp.zoom, dpr * vp.scrollY * vp.zoom)

    // only what is actually on screen; a big board is mostly off it
    const pad = 64 / vp.zoom
    const minX = -vp.scrollX - pad
    const minY = -vp.scrollY - pad
    const maxX = minX + width / vp.zoom + pad * 2
    const maxY = minY + height / vp.zoom + pad * 2

    for (const el of elements) {
      if (el.id === hideId) continue
      /*
       * Two exemptions from culling. An erase always runs, because one starting
       * off screen can still reach ink that is on it. And the element under the
       * pointer always runs, because its box is only fitted to its contents when
       * the gesture ends, so up to then the box says nothing useful about where
       * it reaches.
       */
      if (el.kind !== 'erase' && el !== live) {
        if (el.x > maxX || el.y > maxY || el.x + el.w < minX || el.y + el.h < minY) continue
      }
      lctx.globalCompositeOperation = 'source-over'
      paintElement(lctx, el, images)
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(layer!, 0, 0)
  }
  ctx.restore()
}

/*
 * ----- Coordinates -----
 * screen = (scene + scroll) * zoom, and back again. Written out rather than
 * inlined because getting one of the two directions subtly wrong is the classic
 * way a canvas tool ends up drawing a few pixels from the cursor at high zoom.
 */

export const toScene = (x: number, y: number, vp: Viewport) => ({
  x: x / vp.zoom - vp.scrollX,
  y: y / vp.zoom - vp.scrollY,
})

export const toScreen = (x: number, y: number, vp: Viewport) => ({
  x: (x + vp.scrollX) * vp.zoom,
  y: (y + vp.scrollY) * vp.zoom,
})
