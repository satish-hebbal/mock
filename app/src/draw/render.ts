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
import { marksOn } from './marks'
import { dashArray } from './rough'
import { PENS } from './pens'
import {
  FONT_STACKS,
  lightness,
  noteInk,
  type FontFamily,
  paperIsDark,
  type DrawDoc,
  type DrawElement,
  type GridStyle,
  type NoteElement,
  type TextHighlight,
  type TextStrike,
  type Viewport,
} from './types'

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

/**
 * A font stack that canvas can actually parse.
 *
 * `ctx.font` looks like CSS and is not: it runs the string through the font
 * shorthand parser with no element to resolve custom properties against, so a
 * stack naming `var(--font-text)` is not a stack it can read. The assignment
 * is rejected outright and the context silently keeps the font it already
 * had, which is 10px sans-serif — so those faces came out tiny rather than
 * wrong, which is a much harder thing to notice. An exported SVG has the same
 * problem for the same reason: the file has no such variable to look up.
 *
 * So the variables are read off the document once and folded in. The
 * stylesheet stays the one place the app's faces are named.
 */
const stackCache = new Map<FontFamily, string>()

export function fontStack(family: FontFamily): string {
  const hit = stackCache.get(family)
  if (hit) return hit
  const raw = FONT_STACKS[family]
  if (!raw.includes('var(')) {
    stackCache.set(family, raw)
    return raw
  }
  let complete = true
  const resolved = raw.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const value =
      typeof document === 'undefined'
        ? ''
        : getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (!value) complete = false
    return value
  })
  const stack = resolved.replace(/^\s*,\s*/, '').trim()
  // only remembered once the stylesheet has actually answered, so a first
  // paint that beat the CSS does not cache a crippled stack forever
  if (complete) stackCache.set(family, stack)
  return stack
}

/** Font shorthand for a text element, resolved against the app's stacks. */
export function fontFor(el: { fontSize: number; fontFamily: FontFamily }): string {
  return `${el.fontSize}px ${fontStack(el.fontFamily)}`
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

/*
 * ----- Sticky notes -----
 *
 * A note's text is laid out fresh rather than measured once: it has to wrap to
 * the card's width, and if it still doesn't fit the card's height at the
 * requested size, the size itself has to give. Both are cached on id and
 * version exactly like `geometryFor`, since the search that finds a fitting
 * size is a handful of measurement passes and every element on screen runs it
 * on every repaint otherwise.
 */

const BULLET = '•'
/** how far in from each edge the text sits, before it is clamped to the card */
const NOTE_PAD = 16
/** the floor the shrink-to-fit search will not go under: past this it is
 * clipped rather than shrunk any further, the way a card that is simply too
 * small for its text has to give up somewhere */
const NOTE_MIN_FONT = 9
/** each retry is 90% of the last; a handful of steps covers S through XL */
const NOTE_SHRINK = 0.9

export interface NoteLine {
  text: string
  /** where this line's text sits in the element's own string, half-open */
  start: number
  end: number
  /** hanging indent for a wrapped continuation line, in scene units */
  indent: number
  /** this is the first line of a bulleted paragraph, i.e. draw the dot */
  bullet: boolean
}

export interface NoteLayout {
  lines: NoteLine[]
  fontSize: number
  lineHeight: number
  pad: number
  /** the text column's width, i.e. the card less its padding */
  contentWidth: number
  /** the bullet's hanging indent at this size, or 0 on an unbulleted note */
  indent: number
}

const noteCache = new Map<string, NoteLayout>()
const NOTE_CACHE_LIMIT = 4000

/** The longest prefix of `s` that fits `maxWidth`, never less than one character. */
function fitPrefix(ctx: CanvasRenderingContext2D, s: string, maxWidth: number): number {
  let lo = 1
  let hi = s.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(s.slice(0, mid)).width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** One wrapped line, as a slice of the string it came out of. */
interface WrapLine {
  text: string
  start: number
  end: number
}

/**
 * Greedy word wrap at the current `ctx.font`, breaking mid-run when a single
 * run is wider than the whole column.
 *
 * That second clause is not a nicety, it is the whole difference between text
 * that stays on the card and text that runs off it. Break only at spaces and
 * one unbroken run — a URL, a hash, a hand mashing the keyboard — never wraps
 * at all: it sits on one line, overflows sideways, and the height-based
 * shrink never fires because one line always "fits". The editor over the card
 * has no such trouble, because a textarea breaks long words by default, so
 * the caret and the glyphs underneath it also stop agreeing about which line
 * you are on. Breaking here is what keeps both honest.
 *
 * Lines come back as *slices* rather than as strings built up from words,
 * which costs nothing and buys the offsets a highlight needs to know which
 * part of which line it covers.
 */
function wrapWords(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): WrapLine[] {
  const lines: WrapLine[] = []
  const push = (s: number, e: number) => lines.push({ text: text.slice(s, e), start: s, end: e })

  const words: { start: number; end: number }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) words.push({ start: m.index, end: m.index + m[0].length })
  // nothing but whitespace is still a line, and still occupies its offsets
  if (!words.length) return [{ text: '', start: 0, end: text.length }]

  let start = words[0].start
  let end = start

  /** Open a fresh line with `w`, chopping it up if it cannot fit on one. */
  const begin = (w: { start: number; end: number }) => {
    let p = w.start
    while (w.end - p > 1 && ctx.measureText(text.slice(p, w.end)).width > maxWidth) {
      const cut = fitPrefix(ctx, text.slice(p, w.end), maxWidth)
      push(p, p + cut)
      p += cut
    }
    start = p
    end = w.end
  }

  begin(words[0])
  for (let i = 1; i < words.length; i++) {
    const w = words[i]
    if (ctx.measureText(text.slice(start, w.end)).width <= maxWidth) {
      end = w.end
    } else {
      push(start, end)
      begin(w)
    }
  }
  push(start, end)
  return lines
}

/** Wrap the whole note at one font size, and say whether it still overflows the card. */
function layoutAt(
  ctx: CanvasRenderingContext2D,
  el: NoteElement,
  fontSize: number,
  pad: number,
): { lines: NoteLine[]; lineHeight: number; indent: number; overflow: boolean } {
  ctx.font = fontFor({ fontSize, fontFamily: el.fontFamily })
  const contentWidth = Math.max(4, el.w - pad * 2)
  const indent = el.bulleted ? ctx.measureText(`${BULLET} `).width : 0

  const lines: NoteLine[] = []
  let widest = 0
  // offsets are tracked through the whole string, newlines included, so a
  // highlight laid over the third paragraph lands on the third paragraph
  let base = 0
  for (const para of el.text.split('\n')) {
    const bulleted = el.bulleted && para.trim().length > 0
    const hang = bulleted ? indent : 0
    for (const [i, ln] of wrapWords(ctx, para, contentWidth - hang).entries()) {
      widest = Math.max(widest, ctx.measureText(ln.text).width + hang)
      lines.push({
        text: ln.text,
        start: base + ln.start,
        end: base + ln.end,
        indent: hang,
        bullet: bulleted && i === 0,
      })
    }
    base += para.length + 1
  }

  const lineHeight = lineHeightFor(fontSize)
  const contentHeight = Math.max(4, el.h - pad * 2)
  /*
   * Both axes. Height is the usual one — more lines than the card is tall —
   * but width has to be asked too: a single character can be wider than a
   * narrow card, and no amount of breaking will wrap it. Only shrinking will.
   */
  return {
    lines,
    lineHeight,
    indent,
    overflow: lines.length * lineHeight > contentHeight + 0.5 || widest > contentWidth + 0.5,
  }
}

/**
 * Fit a note's text to its card, shrinking the type until it stops
 * overflowing or hits the floor. `el.fontSize` is the ceiling — what the size
 * picker asked for — not the fact of the matter, the way a shape's fill is a
 * fact but its hand-drawn wobble is only ever a function of its seed.
 */
export function layoutNote(ctx: CanvasRenderingContext2D, el: NoteElement): NoteLayout {
  const key = `${el.id}:${el.version}`
  const hit = noteCache.get(key)
  if (hit) return hit

  ctx.save()
  const pad = Math.max(6, Math.min(NOTE_PAD, Math.min(el.w, el.h) * 0.12))
  let fontSize = el.fontSize
  let result = layoutAt(ctx, el, fontSize, pad)
  while (result.overflow && fontSize > NOTE_MIN_FONT) {
    fontSize = Math.max(NOTE_MIN_FONT, fontSize * NOTE_SHRINK)
    result = layoutAt(ctx, el, fontSize, pad)
  }
  ctx.restore()

  const layout: NoteLayout = {
    lines: result.lines,
    fontSize,
    lineHeight: result.lineHeight,
    pad,
    contentWidth: Math.max(4, el.w - pad * 2),
    indent: result.indent,
  }
  if (noteCache.size > NOTE_CACHE_LIMIT) noteCache.clear()
  noteCache.set(key, layout)
  return layout
}

/**
 * The marker under a line of type.
 *
 * Laid down *multiplied* into whatever is behind it on light paper, which is
 * what a real highlighter does and the reason the ink underneath survives it
 * rather than being painted over. On a dark sheet that trick collapses —
 * multiply against something already dark is just darker, and the pale ink
 * sitting on top has to stay readable — so there the band is tinted on at low
 * alpha instead. Same swatch, opposite arithmetic.
 *
 * Measured against the line it belongs to rather than the whole string, so a
 * highlight that runs across a wrap comes out as one band per line, each
 * ending where its own line does.
 */
function paintHighlights(
  ctx: CanvasRenderingContext2D,
  highlights: TextHighlight[] | undefined,
  line: { text: string; start: number; end: number },
  x: number,
  y: number,
  fontSize: number,
  opacity: number,
  onDark: boolean,
) {
  const spans = marksOn(highlights, line.start, line.end)
  if (!spans.length) return
  ctx.save()
  if (onDark) {
    ctx.globalAlpha = opacity * 0.42
  } else {
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = opacity
  }
  // a swipe a little taller than the em box, the way a chisel tip covers a word
  const top = y - fontSize * 0.06
  const height = fontSize * 1.16
  for (const s of spans) {
    const before = ctx.measureText(line.text.slice(0, s.start - line.start)).width
    const width = ctx.measureText(line.text.slice(s.start - line.start, s.end - line.start)).width
    if (width <= 0) continue
    ctx.fillStyle = s.color
    ctx.fillRect(x + before, top, width, height)
  }
  ctx.restore()
}

/**
 * The line struck through one line of type.
 *
 * Drawn after the glyphs rather than under them, because a strike is a mark
 * made *on* the writing — crossing something out is an act performed on top of
 * it — and in the same ink, so it reads as the same hand that wrote the words.
 */
function paintStrikes(
  ctx: CanvasRenderingContext2D,
  strikes: TextStrike[] | undefined,
  line: { text: string; start: number; end: number },
  x: number,
  y: number,
  fontSize: number,
  ink: string,
) {
  const spans = marksOn(strikes, line.start, line.end)
  if (!spans.length) return
  ctx.save()
  ctx.fillStyle = ink
  // through the middle of the lowercase, which is where a pen would go
  const mid = y + fontSize * 0.56
  const thickness = Math.max(1, fontSize * 0.07)
  for (const s of spans) {
    const before = ctx.measureText(line.text.slice(0, s.start - line.start)).width
    const width = ctx.measureText(line.text.slice(s.start - line.start, s.end - line.start)).width
    if (width <= 0) continue
    ctx.fillRect(x + before, mid - thickness / 2, width, thickness)
  }
  ctx.restore()
}

/**
 * The card itself: a two-pass layered shadow so it reads as a sheet lifted
 * slightly off the surface — a soft wide throw plus a tight contact shadow
 * right at its edge, the way a real piece of paper casts two shadows at once
 * — a faint top-to-bottom sheen, and text clipped to the card so nothing ever
 * spills past its edge regardless of what the shrink search settled for.
 *
 * The corners are square, because a pad of sticky notes is guillotined paper.
 * Rounding them is the instinct every UI card brings with it and it is the one
 * detail that stops a note reading as paper at all: it turns a sheet into a
 * button. Nothing here is rounded.
 *
 * `onDark` is the paper it is sitting on, not the note's own colour: a pale
 * yellow pad still needs its shadow to read against a near-black chalkboard,
 * which a shadow tuned only for white paper would not do.
 */
function paintNote(ctx: CanvasRenderingContext2D, el: NoteElement, onDark: boolean) {
  const { w, h } = el
  const rect = () => {
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
  }

  ctx.save()
  ctx.fillStyle = el.noteColor
  ctx.shadowColor = onDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.18)'
  ctx.shadowBlur = 22
  ctx.shadowOffsetX = 3
  ctx.shadowOffsetY = 11
  rect()
  ctx.fill()
  // the tighter contact shadow, layered on top of the soft one
  ctx.shadowColor = onDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.24)'
  ctx.shadowBlur = 5
  ctx.shadowOffsetX = 1
  ctx.shadowOffsetY = 3
  ctx.fill()
  ctx.restore()

  // the sheen, clipped to the card so it never shows past its edges
  ctx.save()
  rect()
  ctx.clip()
  const sheen = ctx.createLinearGradient(0, 0, 0, h)
  sheen.addColorStop(0, 'rgba(255,255,255,0.2)')
  sheen.addColorStop(0.45, 'rgba(255,255,255,0.02)')
  sheen.addColorStop(1, 'rgba(0,0,0,0.07)')
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, w, h)
  ctx.restore()

  // a hairline so a pale note still reads crisply against similarly pale paper
  ctx.save()
  ctx.strokeStyle = onDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, Math.max(0, w - 1), Math.max(0, h - 1))
  ctx.restore()

  const layout = layoutNote(ctx, el)
  ctx.save()
  rect()
  ctx.clip()
  const ink = noteInk(el.noteColor)
  ctx.fillStyle = ink
  ctx.font = fontFor({ fontSize: layout.fontSize, fontFamily: el.fontFamily })
  ctx.textBaseline = 'top'
  // a bulleted list reads left-aligned the way every list does, whatever the
  // note's alignment was set to before the bullet went on
  const align = el.bulleted ? 'left' : el.textAlign
  // a marker on a note answers to the note's own paper, not to the board's
  const inkIsPale = lightness(el.noteColor) < 0.5
  layout.lines.forEach((line, i) => {
    const y = layout.pad + i * layout.lineHeight
    const textW = ctx.measureText(line.text).width
    let x = layout.pad + line.indent
    if (align === 'center') x = layout.pad + line.indent + Math.max(0, (layout.contentWidth - line.indent - textW) / 2)
    else if (align === 'right') x = layout.pad + Math.max(line.indent, layout.contentWidth - textW)
    paintHighlights(ctx, el.highlights, line, x, y, layout.fontSize, el.opacity, inkIsPale)
    ctx.fillStyle = ink
    if (line.bullet) ctx.fillText(BULLET, layout.pad, y)
    ctx.fillText(line.text, x, y)
    paintStrikes(ctx, el.strikes, line, x, y, layout.fontSize, ink)
  })
  ctx.restore()
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
  /** whether the paper underneath is dark, for a note's shadow */
  onDark = false,
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

  if (el.kind === 'note') {
    paintNote(ctx, el, onDark)
    ctx.restore()
    return
  }

  if (el.kind === 'text') {
    ctx.fillStyle = el.stroke
    ctx.font = fontFor(el)
    ctx.textBaseline = 'top'
    /*
     * Each line is placed by hand rather than left to `ctx.textAlign`, which
     * comes out identically but hands back the one number a marker band needs:
     * where the line actually starts.
     */
    ctx.textAlign = 'left'
    const lh = lineHeightFor(el.fontSize)
    let base = 0
    for (const [i, text] of el.text.split('\n').entries()) {
      const y = i * lh
      const width = ctx.measureText(text).width
      const x = el.textAlign === 'center' ? (el.w - width) / 2 : el.textAlign === 'right' ? el.w - width : 0
      const line = { text, start: base, end: base + text.length }
      paintHighlights(ctx, el.highlights, line, x, y, el.fontSize, el.opacity, onDark)
      ctx.fillStyle = el.stroke
      ctx.fillText(text, x, y)
      paintStrikes(ctx, el.strikes, line, x, y, el.fontSize, el.stroke)
      base += text.length + 1
    }
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
   *
   * A sticky note is the exception: its card, shadow and text keep painting
   * normally while it is being edited, and the textarea over it draws no
   * visible glyphs of its own — just a caret — so the wrap, shrink-to-fit and
   * bullets you are about to get stay visible while you type them rather than
   * only appearing once you click away.
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
    // the grid's own call, reused so a note's shadow reads against this paper too
    const onDark = paperIsDark(doc.background, dark)

    for (const el of elements) {
      if (el.id === hideId && el.kind !== 'note') continue
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
      paintElement(lctx, el, images, onDark)
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
