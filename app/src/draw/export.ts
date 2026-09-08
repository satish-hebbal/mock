/**
 * Getting the drawing out.
 *
 * "What you get back matches exactly what was on screen, erasing included."
 * That last clause is the whole difficulty. On the canvas an erase is a
 * destination-out composite, and SVG has no such operator: the closest thing is
 * a mask, and a mask applies to a whole group at once rather than to whatever
 * happened to be underneath at the time.
 *
 * So the element list is turned inside out. Each erase closes the run of ink
 * before it and wraps that run in a mask carrying the erase; the next run
 * starts outside it. Ink laid down after an erase is untouched by it, exactly as
 * on the canvas, and the groups come out nested one inside the next. It is more
 * structure than a flat list of paths, and it is the only arrangement that is
 * actually faithful.
 */

import { geometryFor, sceneBounds, unionBounds } from './geometry'
import { PENS, outlinePath, strokeOutline } from './pens'
import { dashArray } from './rough'
import { marksOn } from './marks'
import { fontFor, fontStack, layoutNote, lineHeightFor, renderScene } from './render'
import {
  lightness,
  noteInk,
  paperIsDark,
  type DrawDoc,
  type DrawElement,
  type TextHighlight,
  type TextStrike,
} from './types'

const PAD = 24

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The transform that puts an element's local frame where it belongs. */
function transformFor(el: DrawElement): string {
  const cx = el.x + el.w / 2
  const cy = el.y + el.h / 2
  if (!el.angle) return `translate(${el.x.toFixed(2)} ${el.y.toFixed(2)})`
  const deg = ((el.angle * 180) / Math.PI).toFixed(2)
  return `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${deg}) translate(${(-el.w / 2).toFixed(2)} ${(-el.h / 2).toFixed(2)})`
}

/**
 * The marker bands under one line, as rects.
 *
 * SVG has no text background, so a highlight has to be drawn as geometry
 * behind the type — which is what it is on the canvas too. Multiplied in on
 * light paper and tinted on over dark, the same two cases the painter makes,
 * so an exported note matches the one on screen.
 */
function highlightRects(
  measureCtx: CanvasRenderingContext2D,
  el: { highlights?: TextHighlight[]; opacity: number },
  line: { text: string; start: number; end: number },
  left: number,
  top: number,
  fontSize: number,
  onDark: boolean,
): string {
  const spans = marksOn(el.highlights, line.start, line.end)
  if (!spans.length) return ''
  const y = (top - fontSize * 0.06).toFixed(2)
  const h = (fontSize * 1.16).toFixed(2)
  const paint = onDark
    ? ` opacity="${(el.opacity * 0.42).toFixed(3)}"`
    : ` style="mix-blend-mode:multiply"${el.opacity < 1 ? ` opacity="${el.opacity}"` : ''}`
  return spans
    .map((s) => {
      const before = measureCtx.measureText(line.text.slice(0, s.start - line.start)).width
      const width = measureCtx.measureText(line.text.slice(s.start - line.start, s.end - line.start)).width
      if (width <= 0) return ''
      return `<rect x="${(left + before).toFixed(2)}" y="${y}" width="${width.toFixed(2)}" height="${h}" fill="${s.color}"${paint}/>`
    })
    .join('')
}

/** The line struck through one line, as rects laid over the type. */
function strikeRects(
  measureCtx: CanvasRenderingContext2D,
  el: { strikes?: TextStrike[]; opacity: number },
  line: { text: string; start: number; end: number },
  left: number,
  top: number,
  fontSize: number,
  ink: string,
): string {
  const spans = marksOn(el.strikes, line.start, line.end)
  if (!spans.length) return ''
  const thickness = Math.max(1, fontSize * 0.07)
  const y = (top + fontSize * 0.56 - thickness / 2).toFixed(2)
  const alpha = el.opacity < 1 ? ` opacity="${el.opacity}"` : ''
  return spans
    .map((s) => {
      const before = measureCtx.measureText(line.text.slice(0, s.start - line.start)).width
      const width = measureCtx.measureText(line.text.slice(s.start - line.start, s.end - line.start)).width
      if (width <= 0) return ''
      return `<rect x="${(left + before).toFixed(2)}" y="${y}" width="${width.toFixed(2)}" height="${thickness.toFixed(2)}" fill="${ink}"${alpha}/>`
    })
    .join('')
}

async function dataUrl(objectUrl: string): Promise<string> {
  const blob = await (await fetch(objectUrl)).blob()
  return await new Promise<string>((res) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.readAsDataURL(blob)
  })
}

function elementSvg(
  el: DrawElement,
  images: Record<string, string>,
  measureCtx: CanvasRenderingContext2D,
  onDark: boolean,
): string {
  const g = geometryFor(el)
  const t = transformFor(el)
  const alpha = el.opacity < 1 ? ` opacity="${el.opacity}"` : ''
  const parts: string[] = []

  if (el.kind === 'freedraw') {
    const spec = PENS[el.pen]
    const blend = spec.blend === 'multiply' ? ' style="mix-blend-mode:multiply"' : ''
    const op = el.opacity * spec.opacity
    parts.push(`<path d="${g.inkD[0] ?? ''}" fill="${el.stroke}" opacity="${op.toFixed(3)}"${blend}/>`)
  } else if (el.kind === 'note') {
    const layout = layoutNote(measureCtx, el)
    const ink = noteInk(el.noteColor)
    const align = el.bulleted ? 'left' : el.textAlign
    // a bulleted line is always left-set, so its indent only ever shifts x
    // rightward from the left edge; an unbulleted line's x is the same for
    // every line in the note, so it is computed once outside the loop
    const baseX =
      align === 'center' ? layout.pad + layout.contentWidth / 2 : align === 'right' ? layout.pad + layout.contentWidth : layout.pad
    const spans = layout.lines
      .map((line, i) => {
        const y = (layout.pad + i * layout.lineHeight + layout.fontSize * 0.86).toFixed(2)
        const bullet = line.bullet ? `<tspan x="${layout.pad.toFixed(2)}" y="${y}">•</tspan>` : ''
        const x = line.indent ? layout.pad + line.indent : baseX
        return `${bullet}<tspan x="${x.toFixed(2)}" y="${y}">${esc(line.text)}</tspan>`
      })
      .join('')

    /*
     * Marks are geometry, not text decoration, so they need each line's real
     * left edge — which `text-anchor` hides. Measured back out here with the
     * same font the layout was fitted at.
     */
    measureCtx.font = fontFor({ fontSize: layout.fontSize, fontFamily: el.fontFamily })
    const noteDark = lightness(el.noteColor) < 0.5
    const leftOf = (line: (typeof layout.lines)[number]) => {
      const width = measureCtx.measureText(line.text).width
      if (align === 'center')
        return layout.pad + line.indent + Math.max(0, (layout.contentWidth - line.indent - width) / 2)
      if (align === 'right') return layout.pad + Math.max(line.indent, layout.contentWidth - width)
      return layout.pad + line.indent
    }
    const bands = layout.lines
      .map((line, i) =>
        highlightRects(measureCtx, el, line, leftOf(line), layout.pad + i * layout.lineHeight, layout.fontSize, noteDark),
      )
      .join('')
    const strikes = layout.lines
      .map((line, i) =>
        strikeRects(measureCtx, el, line, leftOf(line), layout.pad + i * layout.lineHeight, layout.fontSize, ink),
      )
      .join('')
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
    const shadowId = `note-shadow-${el.id}`
    parts.push(
      `<defs><filter id="${shadowId}" x="-60%" y="-60%" width="220%" height="220%">` +
        `<feDropShadow dx="3" dy="11" stdDeviation="8" flood-color="#000" flood-opacity="${onDark ? 0.6 : 0.18}"/>` +
        `<feDropShadow dx="1" dy="3" stdDeviation="2.2" flood-color="#000" flood-opacity="${onDark ? 0.7 : 0.24}"/>` +
        `</filter></defs>`,
    )
    // square corners, the same guillotined-paper edge the canvas painter draws
    parts.push(
      `<rect width="${el.w.toFixed(2)}" height="${el.h.toFixed(2)}" fill="${el.noteColor}" filter="url(#${shadowId})"${alpha}/>`,
    )
    parts.push(
      `<rect x="0.5" y="0.5" width="${Math.max(0, el.w - 1).toFixed(2)}" height="${Math.max(0, el.h - 1).toFixed(2)}" ` +
        `fill="none" stroke="${onDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}"/>`,
    )
    if (bands) parts.push(bands)
    parts.push(
      `<text font-family="${esc(fontStack(el.fontFamily))}" font-size="${layout.fontSize}" fill="${ink}" text-anchor="${anchor}"${alpha}>${spans}</text>`,
    )
    if (strikes) parts.push(strikes)
  } else if (el.kind === 'text') {
    const lh = lineHeightFor(el.fontSize)
    const anchor = el.textAlign === 'center' ? 'middle' : el.textAlign === 'right' ? 'end' : 'start'
    const x = el.textAlign === 'center' ? el.w / 2 : el.textAlign === 'right' ? el.w : 0
    const lines = el.text.split('\n')
    const spans = lines
      .map(
        (line, i) =>
          `<tspan x="${x.toFixed(2)}" y="${(i * lh + el.fontSize * 0.86).toFixed(2)}">${esc(line)}</tspan>`,
      )
      .join('')

    measureCtx.font = fontFor(el)
    let base = 0
    const marks = lines
      .map((text, i) => {
        const width = measureCtx.measureText(text).width
        const left = el.textAlign === 'center' ? (el.w - width) / 2 : el.textAlign === 'right' ? el.w - width : 0
        const line = { text, start: base, end: base + text.length }
        base += text.length + 1
        return {
          band: highlightRects(measureCtx, el, line, left, i * lh, el.fontSize, onDark),
          strike: strikeRects(measureCtx, el, line, left, i * lh, el.fontSize, el.stroke),
        }
      })
      .reduce((acc, m) => ({ band: acc.band + m.band, strike: acc.strike + m.strike }), { band: '', strike: '' })

    if (marks.band) parts.push(marks.band)
    parts.push(
      `<text font-family="${esc(fontStack(el.fontFamily))}" font-size="${el.fontSize}" fill="${el.stroke}" text-anchor="${anchor}"${alpha}>${spans}</text>`,
    )
    if (marks.strike) parts.push(marks.strike)
  } else if (el.kind === 'image') {
    const href = images[el.assetId]
    if (href) parts.push(`<image href="${esc(href)}" width="${el.w.toFixed(2)}" height="${el.h.toFixed(2)}"${alpha}/>`)
  } else {
    if (g.fillD.length) {
      if (g.fillSolid) {
        parts.push(`<path d="${g.fillD[0]}" fill="${el.fill}"${alpha}/>`)
      } else {
        const w = Math.max(0.5, el.strokeWidth / 2)
        for (const d of g.fillD)
          parts.push(`<path d="${d}" fill="none" stroke="${el.fill}" stroke-width="${w}" stroke-linecap="round"${alpha}/>`)
      }
    }
    const dash =
      el.strokeStyle === 'solid' ? '' : ` stroke-dasharray="${dashArray(el.strokeStyle, el.strokeWidth).join(' ')}"`
    for (const d of g.lineD)
      parts.push(
        `<path d="${d}" fill="none" stroke="${el.stroke}" stroke-width="${el.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${dash}${alpha}/>`,
      )
    // solid arrowheads
    for (const d of g.inkD) parts.push(`<path d="${d}" fill="${el.stroke}"${alpha}/>`)
  }
  return parts.length ? `<g transform="${t}">${parts.join('')}</g>` : ''
}

/** The erase, as the black shape that punches a hole in a white mask. */
function eraseMaskPath(el: DrawElement): string {
  if (el.kind !== 'erase') return ''
  const outline = strokeOutline(el.points, PENS.marker, el.size, el.seed)
  return `<g transform="${transformFor(el)}"><path d="${outlinePath(outline)}" fill="#000"/></g>`
}

export interface ExportOptions {
  /** leave the paper out, so the drawing sits on whatever it is placed over */
  transparent?: boolean
  /** multiplies the pixel resolution; 2 or 3 for print */
  scale?: number
  dark?: boolean
}

/** The whole drawing as an SVG string, erasing and all. */
export async function toSvg(
  doc: DrawDoc,
  images: Record<string, string>,
  opts: ExportOptions = {},
): Promise<string> {
  const box = unionBounds(doc.elements) ?? { x: 0, y: 0, w: 640, h: 480 }
  const x = box.x - PAD
  const y = box.y - PAD
  const w = Math.max(1, box.w + PAD * 2)
  const h = Math.max(1, box.h + PAD * 2)
  // a standalone file has no app theme to fall back on for transparent or
  // checkered paper, so opts.dark stands in for it, same as toPng
  const onDark = paperIsDark(doc.background, !!opts.dark)
  const measureCtx = document.createElement('canvas').getContext('2d')!

  // object URLs mean nothing in a file someone opens tomorrow, so bitmaps are
  // inlined; this is why the export is async where Drawesome's is not
  const inlined: Record<string, string> = {}
  for (const el of doc.elements) {
    if (el.kind === 'image' && images[el.assetId] && !inlined[el.assetId]) {
      try {
        inlined[el.assetId] = await dataUrl(images[el.assetId])
      } catch {
        /* an image that will not load is dropped rather than failing the export */
      }
    }
  }

  /*
   * Fold the list into nested groups, one level per erase. `open` counts how
   * many masks are still to be closed at the end.
   */
  const defs: string[] = []
  let body = ''
  let open = 0
  let maskIndex = 0
  for (const el of doc.elements) {
    if (el.kind === 'erase') {
      const id = `erase-${maskIndex++}`
      defs.push(
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}">` +
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff"/>${eraseMaskPath(el)}</mask>`,
      )
      body = `<g mask="url(#${id})">${body}`
      open++
    } else {
      body += elementSvg(el, inlined, measureCtx, onDark)
    }
  }
  body += '</g>'.repeat(open)

  const paper =
    opts.transparent || doc.background === 'transparent'
      ? ''
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${doc.background === 'checker' ? '#ffffff' : doc.background}"/>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${h.toFixed(0)}" ` +
    `viewBox="${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}">` +
    `<defs>${defs.join('')}</defs>${paper}${body}</svg>`
  )
}

/** The drawing as a PNG, rendered through the same painter the screen uses. */
export async function toPng(
  doc: DrawDoc,
  images: Record<string, string>,
  opts: ExportOptions = {},
): Promise<Blob> {
  const scale = opts.scale ?? 2
  const box = unionBounds(doc.elements) ?? { x: 0, y: 0, w: 640, h: 480 }
  const w = Math.max(1, box.w + PAD * 2)
  const h = Math.max(1, box.h + PAD * 2)

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')!

  const loaded: Record<string, CanvasImageSource> = {}
  await Promise.all(
    doc.elements
      .filter((e): e is Extract<DrawElement, { kind: 'image' }> => e.kind === 'image')
      .map(
        (e) =>
          new Promise<void>((res) => {
            const url = images[e.assetId]
            if (!url || loaded[e.assetId]) return res()
            const img = new Image()
            img.onload = () => {
              loaded[e.assetId] = img
              res()
            }
            img.onerror = () => res()
            img.src = url
          }),
      ),
  )

  renderScene({
    ctx,
    width: w,
    height: h,
    viewport: { scrollX: -box.x + PAD, scrollY: -box.y + PAD, zoom: 1 },
    doc,
    images: { get: (id) => loaded[id] },
    dark: !!opts.dark,
    skipBackground: opts.transparent || doc.background === 'transparent',
  })

  return await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'),
  )
}

/** Save it. */
export async function download(
  doc: DrawDoc,
  images: Record<string, string>,
  name = 'drawing',
  format: 'svg' | 'png' = 'png',
  opts: ExportOptions = {},
) {
  const blob =
    format === 'svg'
      ? new Blob([await toSvg(doc, images, opts)], { type: 'image/svg+xml' })
      : await toPng(doc, images, opts)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.${format}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Copy the drawing to the clipboard as a PNG. */
export async function copyToClipboard(doc: DrawDoc, images: Record<string, string>, opts: ExportOptions = {}) {
  const blob = await toPng(doc, images, opts)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

/** Bounds of everything, for showing the export size before it is made. */
export function exportSize(doc: DrawDoc, scale = 2): { w: number; h: number } {
  const box = unionBounds(doc.elements) ?? { x: 0, y: 0, w: 640, h: 480 }
  return { w: Math.round((box.w + PAD * 2) * scale), h: Math.round((box.h + PAD * 2) * scale) }
}

export { sceneBounds }
