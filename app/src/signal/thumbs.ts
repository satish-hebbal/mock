/**
 * The panel's pictures.
 *
 * Every choice in the pattern panel used to be a word: a hundred and five looks,
 * sixty-eight generators, ten masks and twenty-six effects, each a name in a
 * chip. A name is the one thing about a pattern nobody is choosing by. So each
 * of those choices is now drawn as what it makes, by the same `renderSignal`
 * and the same generator functions as the canvas, which means a thumbnail
 * cannot promise a picture the tool does not produce.
 *
 * Drawing two hundred small frames is not free, so they are drawn once, in idle
 * time a few at a time, and kept as data URLs for the rest of the session. Only
 * the tiles on screen ask for theirs, so a closed section or an unopened group
 * costs nothing. The one exception is the tile under the pointer, which plays
 * live (see `LiveThumb`), because a pattern is a moving thing and a still of it
 * is half the story.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { applyFx, type FxChain, type FxId } from '../lib/postfx'
import { FIELD_BY_ID, resolveParams, type FieldFn, type Params } from './fields'
import { FIGURE_BY_ID } from './figures'
import { PRESETS, applyPreset } from './presets'
import { ditherField, hexRgb, type RGB } from './quantize'
import { renderSignal } from './render'
import { useSignal } from './store'
import { defaultSignalDoc, type MaskId, type SignalDoc, type SourceKind } from './types'

/**
 * Draw one frame of a thumbnail into `canvas`, `elapsed` seconds into playing it.
 *
 * The cached still is frame 0; the live tile calls it every frame. Each painter
 * sets the canvas size itself, so a caller only has to supply the element.
 */
export type Paint = (canvas: HTMLCanvasElement, elapsed: number) => void

/**
 * Where on the clock the stills are taken.
 *
 * Not zero, because a good many generators start from nothing and grow: a
 * cascade of type with no type on it yet, a tunnel that has not started
 * rushing. Three seconds in, every one of them is showing what it is.
 */
const STILL_AT = 3

/** Device pixels for a tile `css` wide, capped at 2x like the preview. */
export function thumbPx(css: number) {
  const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1)
  return Math.round(css * dpr)
}

/** The CSS width each kind of tile is drawn for: four looks to a row, five of the rest. */
export const LOOK_PX = 64
export const SOURCE_PX = 48
export const FX_PX = 48

/** The painters the live tiles use, at the same sizes as the stills. */
export const lookLive = (id: string) => paintLook(id, thumbPx(LOOK_PX))
export const sourceLive = (kind: SourceKind, id: string) =>
  paintSource(kind, id, thumbPx(SOURCE_PX), () => useSignal.getState().doc.ink)
export const fxLive = (id: FxId) => paintFx(id, thumbPx(FX_PX))

// ----- looks -----

const lookDocs = new Map<string, SignalDoc>()

/**
 * A preset as a document sized to the thumbnail.
 *
 * The canvas block is the thumbnail's own size so the post chain's scale comes
 * out at 1, and the pixel size is halved: a mask is measured in pixels, and at
 * the preset's own pixel size a sixty-pixel tile is a dozen blocks across, which
 * is a picture of the dither rather than of the look.
 */
function lookDoc(id: string, size: number) {
  const key = `${id}@${size}`
  let doc = lookDocs.get(key)
  if (!doc) {
    const preset = PRESETS.find((p) => p.id === id)
    doc = defaultSignalDoc()
    if (preset) applyPreset(doc, preset)
    doc.canvas.width = size
    doc.canvas.height = size
    doc.quantize.pixelSize = Math.max(1, Math.round(doc.quantize.pixelSize / 2))
    lookDocs.set(key, doc)
  }
  return doc
}

export function paintLook(id: string, size: number): Paint {
  return (canvas, elapsed) => {
    const doc = lookDoc(id, size)
    renderSignal(doc, STILL_AT + elapsed * doc.source.speed, canvas)
  }
}

/** A whole saved document, square, the same way a look is drawn. */
export function paintDoc(saved: SignalDoc, size: number): Paint {
  const doc: SignalDoc = {
    ...saved,
    canvas: { ...saved.canvas, width: size, height: size },
    quantize: { ...saved.quantize, pixelSize: Math.max(1, Math.round(saved.quantize.pixelSize / 2)) },
  }
  return (canvas, elapsed) => renderSignal(doc, STILL_AT + elapsed * doc.source.speed, canvas)
}

// ----- generators -----

let scratch = new Float32Array(0)
let big = new Float32Array(0)

/** [how many times larger to draw, seconds further on, scale] for each retry of a flat frame. */
const RETRIES: [number, number, number][] = [
  [4, 0, 1],
  [1, 2.5, 4],
  [1, 5.5, 4],
  [1, 9, 2],
]

function extent(buf: Float32Array, n: number): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < n; i++) {
    const v = buf[i]
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return [lo, hi]
}

const range = (buf: Float32Array, n: number) => {
  const [lo, hi] = extent(buf, n)
  return hi - lo
}

/** A field at `size` square, drawn `up` times larger and box-averaged down when up > 1. */
function fieldAt(fn: FieldFn, size: number, up: number, t: number, scale: number, params: Params) {
  const n = size * size
  if (scratch.length < n) scratch = new Float32Array(n)
  const out = scratch.subarray(0, n)
  if (up <= 1) {
    fn(out, size, size, t, 55, scale, params)
    return out
  }
  const bs = size * up
  if (big.length < bs * bs) big = new Float32Array(bs * bs)
  const src = big.subarray(0, bs * bs)
  fn(src, bs, bs, t, 55, scale, params)
  const k = 1 / (up * up)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0
      for (let j = 0; j < up; j++) {
        const row = (y * up + j) * bs + x * up
        for (let i = 0; i < up; i++) sum += src[row + i]
      }
      out[y * size + x] = sum * k
    }
  }
  return out
}

const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]
const MOTION = defaultSignalDoc().motion

/**
 * A generator on its own, with none of a look's colour or dither.
 *
 * Without `tint` it is drawn as white with the light as alpha, so the panel can
 * lay it over the document's paper and fill it with the document's ink in CSS.
 * That is what lets sixty-eight cached stills follow every colour change for
 * nothing: the picture is a mask, and the colour is a background behind it.
 *
 * With `tint` it is painted in those colours directly, which is what the live
 * tile under the pointer does, since a canvas cannot be a CSS mask.
 */
export function paintSource(
  kind: SourceKind,
  id: string,
  size: number,
  tint?: () => { ink: string; paper: string; accent: string },
): Paint {
  return (canvas, elapsed) => {
    if (canvas.width !== size) canvas.width = size
    if (canvas.height !== size) canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: !tint })
    if (!ctx) return
    const t = STILL_AT + elapsed * 0.6
    const colours = tint?.()

    if (kind === 'figure') {
      const spec = FIGURE_BY_ID.get(id)
      if (!spec) return
      const ink = colours
        ? { fg: hexRgb(colours.ink), bg: hexRgb(colours.paper), accent: hexRgb(colours.accent) }
        : { fg: WHITE, bg: BLACK, accent: WHITE }
      spec.fn(ctx, size, size, t, 55, 4, ink, MOTION, resolveParams(spec.params))
      if (colours) return
      // brightness becomes coverage: white where the figure drew, clear where it did not
      const img = ctx.getImageData(0, 0, size, size)
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        d[i + 3] = Math.max(d[i], d[i + 1], d[i + 2])
        d[i] = d[i + 1] = d[i + 2] = 255
      }
      ctx.putImageData(img, 0, 0)
      return
    }

    const spec = FIELD_BY_ID.get(id)
    if (!spec) return
    const n = size * size
    const params = resolveParams(spec.params)

    /*
     * A few generators come out as one flat tone at tile size, for reasons
     * that never show on the canvas. Metaballs are sized in pixels, so at
     * forty-eight pixels one ball covers the tile; the Julia set spends some
     * moments zoomed into its own interior. So a flat frame is tried again,
     * first drawn four times larger and averaged down, then further along the
     * clock, and the first one with a shape in it is the thumbnail.
     */
    let buf = fieldAt(spec.fn, size, 1, t, 4, params)
    for (const [up, later, scale] of RETRIES) {
      if (range(buf, n) > 0.05) break
      buf = fieldAt(spec.fn, size, up, t + later, scale, params)
    }

    // stretched to its own range, so a field that lives between 0.4 and 0.6
    // still shows its shape rather than a grey square
    const [lo, hi] = extent(buf, n)
    const span = hi - lo > 1e-4 ? hi - lo : 1
    const floor = hi - lo > 1e-4 ? lo : 0
    for (let i = 0; i < n; i++) buf[i] = (buf[i] - floor) / span

    const img = ctx.createImageData(size, size)
    const d = img.data
    const fg = colours ? hexRgb(colours.ink) : WHITE
    const bg = colours ? hexRgb(colours.paper) : WHITE
    for (let i = 0; i < n; i++) {
      const v = buf[i] < 0 ? 0 : buf[i] > 1 ? 1 : buf[i]
      const o = i * 4
      if (colours) {
        d[o] = bg[0] + (fg[0] - bg[0]) * v
        d[o + 1] = bg[1] + (fg[1] - bg[1]) * v
        d[o + 2] = bg[2] + (fg[2] - bg[2]) * v
        d[o + 3] = 255
      } else {
        d[o] = d[o + 1] = d[o + 2] = 255
        d[o + 3] = v * 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }
}

// ----- masks -----

/**
 * A lit sphere, dithered through one mask, in the document's own ink.
 *
 * The sphere is the oldest picture in dithering for a reason: it runs every
 * tone from full light to none across one smooth curve, so each mask shows how
 * it spends its pattern on a highlight, a midtone and a shadow in a single
 * glance, where a flat ramp only shows the tones and not the shape.
 *
 * Drawn fresh rather than cached. Ten of them at tile size is a few thousand
 * pixels, cheaper than keeping a still per colour the document has been.
 */
export function paintMask(canvas: HTMLCanvasElement, mask: MaskId, ink: string, paper: string) {
  const size = canvas.width
  const n = size * size
  if (scratch.length < n) scratch = new Float32Array(n)
  const field = scratch.subarray(0, n)
  const r = size * 0.4
  const c = size / 2
  // light from the upper left and a little in front
  const lx = -0.5
  const ly = -0.6
  const lz = 0.62
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - c) / r
      const dy = (y + 0.5 - c) / r
      const q = dx * dx + dy * dy
      field[y * size + x] = q >= 1 ? 0 : Math.max(0, dx * lx + dy * ly + Math.sqrt(1 - q) * lz)
    }
  }
  const lit = ditherField(field, size, size, {
    mask,
    threshold: 128,
    spread: 100,
    pixelSize: 1,
    randomness: 0,
    glyphs: 'off',
    ramp: '',
    detail: 1,
  })
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.createImageData(size, size)
  const d = img.data
  const fg = hexRgb(ink)
  const bg = hexRgb(paper)
  for (let i = 0; i < n; i++) {
    const col = lit[i] ? fg : bg
    d[i * 4] = col[0]
    d[i * 4 + 1] = col[1]
    d[i * 4 + 2] = col[2]
    d[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

// ----- effects -----

const samples = new Map<number, HTMLCanvasElement>()

/**
 * The one picture every effect is shown on.
 *
 * A look with its own finish taken off, so the only difference between two
 * effect tiles is the effect. One bright ring on a dark ground, picked from a
 * contact sheet of eight candidates: bloom, rays and fog need light against
 * dark to show at all, the chromatic and emboss passes need a hard edge, and a
 * single simple shape is what lets a glitch, a bulge or a pixel grid read at
 * forty-eight pixels. Busier pictures turned every tile into the same noise.
 */
function sample(size: number) {
  let c = samples.get(size)
  if (!c) {
    c = document.createElement('canvas')
    const doc = lookDoc('m-orbit-ring', size)
    renderSignal({ ...doc, fx: {} }, STILL_AT, c)
    samples.set(size, c)
  }
  return c
}

export function paintFx(id: FxId, size: number): Paint {
  const chain: FxChain = { [id]: { amount: 0.75 } }
  return (canvas, elapsed) => {
    if (canvas.width !== size) canvas.width = size
    if (canvas.height !== size) canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(sample(size), 0, 0)
    // the effects are tuned for a frame several hundred pixels across; at a
    // tile's size the same amount would be a block or a streak filling it
    applyFx(canvas, chain, { scale: size / 320, time: STILL_AT + elapsed })
  }
}

// ----- the cache -----

const stills = new Map<string, string>()
const waiting = new Map<string, Paint>()
const listeners = new Set<() => void>()
let booked = false
let work: HTMLCanvasElement | null = null

type Idle = (cb: () => void) => void
const whenIdle: Idle =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (cb) => window.requestIdleCallback(cb, { timeout: 120 })
    : (cb) => setTimeout(cb, 16)

/**
 * Draw what is waiting, a slice at a time.
 *
 * Eight milliseconds per slice, then back to the browser: the preview is
 * running its own loop beside this, and a panel that fills in a little slower
 * is far better than a canvas that stutters while it does.
 */
function drain() {
  booked = false
  const start = performance.now()
  for (const [key, paint] of waiting) {
    waiting.delete(key)
    work ??= document.createElement('canvas')
    try {
      paint(work, 0)
      stills.set(key, work.toDataURL())
    } catch {
      // a generator that throws gets a blank tile, not a broken panel
      stills.set(key, '')
    }
    if (performance.now() - start > 8) break
  }
  for (const fn of listeners) fn()
  if (waiting.size) book()
}

function book() {
  if (booked) return
  booked = true
  whenIdle(drain)
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/**
 * The cached still for `key`, drawn by `paint` the first time anything asks.
 *
 * Undefined until it has been drawn. `paint` is only called once per key, so
 * a caller can hand in a fresh closure every render without it mattering.
 */
export function useStill(key: string, paint: () => Paint): string | undefined {
  const url = useSyncExternalStore(subscribe, () => stills.get(key))
  const painter = useRef(paint)
  useEffect(() => {
    painter.current = paint
  })
  useEffect(() => {
    if (stills.has(key) || waiting.has(key)) return
    waiting.set(key, painter.current())
    book()
  }, [key])
  return url
}

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Play a thumbnail into `canvas` while it is mounted, at up to 30 frames a second.
 *
 * Mounted only for the tile under the pointer, so there is never more than one
 * of these running. People who have asked for less motion get the still.
 */
export function useLive(canvas: React.RefObject<HTMLCanvasElement | null>, paint: Paint) {
  const painter = useRef(paint)
  useEffect(() => {
    painter.current = paint
  })
  useEffect(() => {
    const el = canvas.current
    if (!el || reduceMotion()) return
    let raf = 0
    let last = 0
    const start = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 33) return
      last = now
      painter.current(el, (now - start) / 1000)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [canvas])
}
