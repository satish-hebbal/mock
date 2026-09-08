/**
 * What a painter draws onto.
 *
 * Six operations, which is every mark any of the fourteen styles makes. The
 * point of naming them is that a painter then has no idea what it is drawing
 * into: hand it the canvas backend and it fills pixels, hand it the SVG backend
 * and the same function emits vector elements.
 *
 * That indirection is the only honest way to offer SVG export. The alternative
 * is a second set of painters that emit SVG, and two implementations of "what a
 * LEGO brick looks like" will disagree within a week of anybody touching
 * either. Here there is still exactly one description of every style, and the
 * backend decides what it becomes.
 *
 * Every coordinate is in output pixels, and the SVG backend uses the same
 * numbers as its user units, so the two outputs are the same picture at the
 * same size rather than two drawings that resemble each other.
 */

/**
 * The monospace stack, shared by both backends.
 *
 * It has to be one list. The canvas measures a real font to size the grid, and
 * the SVG names a font the viewer will resolve later, so if the two lists
 * disagree the SVG lands in a face with a different advance width and every row
 * runs long.
 */
export const MONO =
  'ui-monospace, "SF Mono", "DejaVu Sans Mono", "Cascadia Mono", Menlo, Consolas, monospace'

export interface Surface {
  /** set the type size for every `text` call that follows */
  font(px: number): void
  rect(x: number, y: number, w: number, h: number, fill: string): void
  circle(cx: number, cy: number, r: number, fill: string): void
  polygon(points: [number, number][], fill: string): void
  line(x1: number, y1: number, x2: number, y2: number, width: number, stroke: string): void
  /** angles in radians, swept the way canvas sweeps them with `anticlockwise` false */
  arc(cx: number, cy: number, r: number, from: number, to: number, width: number, stroke: string): void
  /** one glyph, centred on (cx, cy) */
  text(cx: number, cy: number, ch: string, fill: string): void
}

// ----- canvas -----

export class CanvasSurface implements Surface {
  private ctx: CanvasRenderingContext2D

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx
    // centred once here rather than per call: every painter that draws a glyph
    // wants the cell's middle, and no painter wants anything else
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
  }

  font(px: number) {
    this.ctx.font = `${px}px ${MONO}`
  }

  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.ctx.fillStyle = fill
    this.ctx.fillRect(x, y, w, h)
  }

  circle(cx: number, cy: number, r: number, fill: string) {
    this.ctx.fillStyle = fill
    this.ctx.beginPath()
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2)
    this.ctx.fill()
  }

  polygon(points: [number, number][], fill: string) {
    if (points.length < 3) return
    this.ctx.fillStyle = fill
    this.ctx.beginPath()
    this.ctx.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i++) this.ctx.lineTo(points[i][0], points[i][1])
    this.ctx.closePath()
    this.ctx.fill()
  }

  line(x1: number, y1: number, x2: number, y2: number, width: number, stroke: string) {
    this.ctx.strokeStyle = stroke
    this.ctx.lineWidth = width
    this.ctx.beginPath()
    this.ctx.moveTo(x1, y1)
    this.ctx.lineTo(x2, y2)
    this.ctx.stroke()
  }

  arc(cx: number, cy: number, r: number, from: number, to: number, width: number, stroke: string) {
    this.ctx.strokeStyle = stroke
    this.ctx.lineWidth = width
    this.ctx.beginPath()
    this.ctx.arc(cx, cy, r, from, to)
    this.ctx.stroke()
  }

  text(cx: number, cy: number, ch: string, fill: string) {
    this.ctx.fillStyle = fill
    this.ctx.fillText(ch, cx, cy)
  }
}

// ----- svg -----

const n = (v: number) => {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

const XML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESCAPE[c])

/**
 * The vector backend.
 *
 * The only complication is text, and it is worth spending the code on. A glyph
 * style draws one character per cell, and a photograph at a readable cell size
 * is seven thousand of them; emitting seven thousand `<text>` elements produces
 * a file most editors open slowly and some refuse to open at all.
 *
 * So runs are coalesced. Consecutive cells on the same row that share a colour
 * become one `<tspan>` with a single starting x, and the monospace advance does
 * the rest, which is exactly how the characters were positioned in the first
 * place. On a single-ink document that collapses a row of 145 elements into
 * one; on a full-colour one it still merges every flat region.
 */
export class SvgSurface implements Surface {
  private parts: string[] = []
  private fontPx = 0
  /** the run being built: same row, same colour, cells so far contiguous */
  private run: { y: number; x: number; nextX: number; fill: string; text: string } | null = null
  private cellW: number

  constructor(cellW: number) {
    this.cellW = cellW
  }

  font(px: number) {
    this.flush()
    this.fontPx = px
  }

  /**
   * Close the open run.
   *
   * Two attributes here are doing more work than they look like they are.
   *
   * `textLength` pins the run to exactly the cells it represents. Without it
   * the file depends on the viewer resolving the same monospace face this
   * machine measured, and any other face has a different advance width, so the
   * rows drift further out of their columns the longer they get. With it, a run
   * of twelve cells is twelve cell widths wide wherever it is opened.
   * `lengthAdjust="spacing"` makes that come out of the gaps rather than by
   * stretching the letterforms.
   *
   * The y offset replaces `dominant-baseline: central`, which browsers honour
   * and several vector editors quietly ignore. A third of the type size below
   * the cell's middle is where the alphabetic baseline sits for the faces in
   * this stack, and it needs no support from the renderer at all.
   */
  private flush() {
    const r = this.run
    if (!r) return
    this.run = null
    this.parts.push(
      `<text x="${n(r.x)}" y="${n(r.y + this.fontPx * 0.35)}" textLength="${n(r.text.length * this.cellW)}" lengthAdjust="spacing" fill="${r.fill}" xml:space="preserve">${esc(r.text)}</text>`,
    )
  }

  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.flush()
    this.parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"/>`)
  }

  circle(cx: number, cy: number, r: number, fill: string) {
    this.flush()
    this.parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"/>`)
  }

  polygon(points: [number, number][], fill: string) {
    if (points.length < 3) return
    this.flush()
    const pts = points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')
    this.parts.push(`<polygon points="${pts}" fill="${fill}"/>`)
  }

  line(x1: number, y1: number, x2: number, y2: number, width: number, stroke: string) {
    this.flush()
    this.parts.push(
      `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${n(width)}"/>`,
    )
  }

  arc(cx: number, cy: number, r: number, from: number, to: number, width: number, stroke: string) {
    this.flush()
    const x1 = cx + r * Math.cos(from)
    const y1 = cy + r * Math.sin(from)
    const x2 = cx + r * Math.cos(to)
    const y2 = cy + r * Math.sin(to)
    // sweep 1 matches canvas drawing an arc with `anticlockwise` left false
    const large = Math.abs(to - from) > Math.PI ? 1 : 0
    this.parts.push(
      `<path d="M${n(x1)} ${n(y1)}A${n(r)} ${n(r)} 0 ${large} 1 ${n(x2)} ${n(y2)}" fill="none" stroke="${stroke}" stroke-width="${n(width)}"/>`,
    )
  }

  /**
   * One glyph, given the centre of its cell.
   *
   * Runs are anchored at the start rather than the middle, so the stored x is
   * the cell's left edge. That is also what makes the glyph land centred: in a
   * monospace face every glyph is already centred inside its own advance, and
   * `textLength` has just pinned that advance to one cell.
   */
  text(cx: number, cy: number, ch: string, fill: string) {
    const r = this.run
    /*
     * The run continues when this cell is the next one along the same row in
     * the same colour. `nextX` is where that cell's centre would be, so the
     * test is one comparison rather than a search, and a blank cell that the
     * painter skipped naturally ends the run instead of being closed over.
     */
    if (r && r.fill === fill && r.y === cy && Math.abs(cx - r.nextX) < 0.01) {
      r.text += ch
      r.nextX += this.cellW
      return
    }
    this.flush()
    this.run = { y: cy, x: cx - this.cellW / 2, nextX: cx + this.cellW, fill, text: ch }
  }

  /** Everything drawn, as markup. */
  body(): string {
    this.flush()
    return this.parts.join('')
  }

  get fontSize() {
    return this.fontPx
  }
}
