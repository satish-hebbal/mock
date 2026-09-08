/**
 * Text output.
 *
 * The gap in every tool like this: they will sell you a PNG of characters and
 * no way to get the characters. Which is backwards, because the characters are
 * the only part of ASCII art that can go in a README, a commit message, a
 * terminal banner or a `<pre>` without being an image of text.
 *
 * Four formats, and they are four genuinely different jobs rather than one
 * string with different wrappers:
 *
 *   txt    the glyphs alone, which is the one that pastes anywhere
 *   ansi   the glyphs with 24-bit colour escapes, for a terminal
 *   html   a <pre> with a span per run of colour, for a web page
 *   svg    one <text> per row, which stays sharp at any size and stays text
 *
 * All four are cut from the same grid the canvas used, so what leaves as a file
 * is what was on screen, column for column.
 */

import { brailleFor, glyphFor } from './painters'
import { rampChars, getRamp } from './ramps'
import { buildGrid } from './render'
import { getStyle } from './styles'
import type { AsciiDoc } from './types'

export type TextFormat = 'txt' | 'ansi' | 'html' | 'svg'

export interface TextGrid {
  cols: number
  rows: number
  /** one string per row */
  lines: string[]
  /** 'r,g,b' per cell, row-major, empty when the document is single-ink */
  colors: string[] | null
}

/** True when the current style has characters to give. */
export function canExportText(doc: AsciiDoc): boolean {
  return getStyle(doc.style).glyph
}

/**
 * The characters, and the colour of each one.
 *
 * Colours come back as a flat array rather than woven into the lines because
 * three of the four formats want the two separated, and the one that does not
 * (ANSI) has to walk them in lockstep anyway to coalesce runs.
 */
export function textGrid(doc: AsciiDoc, source: CanvasImageSource): TextGrid {
  const { grid, levels, fine, cols, rows } = buildGrid(doc, source)
  const chars = doc.style === 'blocks' ? getRamp('blocks').chars : rampChars(doc.ramp, doc.customRamp)
  const wantsColor = doc.color.mode !== 'ink'

  const lines: string[] = []
  const colors: string[] | null = wantsColor ? [] : null

  for (let row = 0; row < rows; row++) {
    let line = ''
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      const ink = levels.ink[i]
      const blank = grid.alpha[i] <= 0.004

      line += blank
        ? ' '
        : doc.style === 'braille'
          ? brailleFor(col, row, fine)
          : glyphFor(chars, ink, col, row, doc.grid.jitter)

      if (colors) {
        if (blank) {
          colors.push('')
        } else if (doc.color.mode === 'duotone') {
          const t = ink
          const a = hex(doc.color.ink2)
          const b = hex(doc.color.ink)
          colors.push(
            `${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)}`,
          )
        } else {
          /*
           * Re-lit exactly the way the canvas re-lights it. Reaching for the
           * raw source colour here instead would make the .txt and the .png
           * disagree about the picture the moment anybody touched contrast.
           */
          const from = grid.lum[i]
          const to = levels.lum[i]
          const k = from < 0.004 ? 0 : to / from
          const r = from < 0.004 ? to * 255 : Math.min(255, grid.rgb[i * 3] * k)
          const g = from < 0.004 ? to * 255 : Math.min(255, grid.rgb[i * 3 + 1] * k)
          const b = from < 0.004 ? to * 255 : Math.min(255, grid.rgb[i * 3 + 2] * k)
          colors.push(`${Math.round(r)},${Math.round(g)},${Math.round(b)}`)
        }
      }
    }
    // trailing spaces are invisible and still count against every line length
    lines.push(line.replace(/\s+$/, ''))
  }

  return { cols, rows, lines, colors }
}

function hex(h: string): [number, number, number] {
  const s = h.replace('#', '')
  const full = s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/* The escape byte, written as a sequence rather than as a raw control
   character, so the source survives every editor and copy-paste on the way
   to the file that gets downloaded. */
const ESC = '\x1b'

/**
 * ANSI, with 24-bit colour.
 *
 * The escape run is coalesced: a colour code is only emitted when the colour
 * actually changes, which on a photograph is often every cell and on a poster
 * is almost never. Emitting one per character regardless can multiply the file
 * size by twenty for no visible difference.
 *
 * The reset at the end of every line matters more than it looks. Without it the
 * last colour on a row bleeds into the terminal's own prompt, and whoever cats
 * the file is left with a magenta shell.
 */
function toAnsi(t: TextGrid): string {
  const out: string[] = []
  for (let row = 0; row < t.rows; row++) {
    let line = ''
    let last = ''
    for (let col = 0; col < t.lines[row].length; col++) {
      const ch = t.lines[row][col]
      const c = t.colors?.[row * t.cols + col] ?? ''
      if (c && c !== last) {
        line += `${ESC}[38;2;${c.split(',').join(';')}m`
        last = c
      }
      line += ch
    }
    out.push(line + (t.colors ? `${ESC}[0m` : ''))
  }
  return out.join('\n')
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function toHtml(t: TextGrid, doc: AsciiDoc): string {
  const bg = doc.backdrop.mode === 'transparent' ? 'transparent' : doc.backdrop.color
  const body: string[] = []

  for (let row = 0; row < t.rows; row++) {
    const line = t.lines[row]
    if (!t.colors) {
      body.push(escapeHtml(line))
      continue
    }
    // one span per run of identical colour, same reasoning as the ANSI writer
    let html = ''
    let run = ''
    let runColor = ''
    const flush = () => {
      if (!run) return
      html += runColor ? `<span style="color:rgb(${runColor})">${escapeHtml(run)}</span>` : escapeHtml(run)
      run = ''
    }
    for (let col = 0; col < line.length; col++) {
      const c = t.colors[row * t.cols + col] ?? ''
      if (c !== runColor) {
        flush()
        runColor = c
      }
      run += line[col]
    }
    flush()
    body.push(html)
  }

  return [
    `<pre style="`,
    `background:${bg};`,
    `color:${doc.color.ink};`,
    `font:${doc.grid.cell}px/${(doc.grid.cell * doc.grid.aspect).toFixed(2)}px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;`,
    `letter-spacing:0;margin:0;padding:1em;overflow:auto">`,
    body.join('\n'),
    '</pre>',
  ].join('')
}

/**
 * SVG, with the text left as text.
 *
 * Which is the point of offering it: an SVG of paths would just be a vector
 * picture of characters, and this one can still be selected, searched and
 * restyled. `xml:space="preserve"` is load-bearing, because SVG collapses runs
 * of whitespace by default and every blank cell in the picture is a space.
 */
function toSvg(t: TextGrid, doc: AsciiDoc): string {
  const cw = doc.grid.cell
  const ch = cw * doc.grid.aspect
  const w = Math.round(t.cols * cw)
  const h = Math.round(t.rows * ch)
  const rows: string[] = []

  for (let row = 0; row < t.rows; row++) {
    const line = t.lines[row]
    if (!line) continue
    const y = (row + 0.72) * ch
    if (!t.colors) {
      rows.push(`<text x="0" y="${y.toFixed(2)}" xml:space="preserve">${escapeHtml(line)}</text>`)
      continue
    }
    let spans = ''
    let run = ''
    let runColor = ''
    let runStart = 0
    const flush = (end: number) => {
      if (!run) return
      spans += `<tspan x="${(runStart * cw).toFixed(2)}" fill="rgb(${runColor || '255,255,255'})" xml:space="preserve">${escapeHtml(run)}</tspan>`
      runStart = end
      run = ''
    }
    for (let col = 0; col < line.length; col++) {
      const c = t.colors[row * t.cols + col] ?? ''
      if (c !== runColor) {
        flush(col)
        runColor = c
      }
      run += line[col]
    }
    flush(line.length)
    rows.push(`<text y="${y.toFixed(2)}" xml:space="preserve">${spans}</text>`)
  }

  const bg =
    doc.backdrop.mode === 'transparent'
      ? ''
      : `<rect width="${w}" height="${h}" fill="${doc.backdrop.color}"/>`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    bg,
    `<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${(cw / 0.6).toFixed(2)}" fill="${doc.color.ink}">`,
    rows.join(''),
    '</g></svg>',
  ].join('')
}

export function toText(t: TextGrid, doc: AsciiDoc, format: TextFormat): string {
  if (format === 'txt') return t.lines.join('\n')
  if (format === 'ansi') return toAnsi(t)
  if (format === 'html') return toHtml(t, doc)
  return toSvg(t, doc)
}

export const TEXT_FORMATS: { id: TextFormat; label: string; ext: string; mime: string; hint: string }[] = [
  { id: 'txt', label: 'Plain text', ext: 'txt', mime: 'text/plain', hint: 'The glyphs alone. Pastes into anything.' },
  { id: 'ansi', label: 'ANSI', ext: 'ans', mime: 'text/plain', hint: '24-bit colour escapes. `cat` it in a terminal.' },
  { id: 'html', label: 'HTML', ext: 'html', mime: 'text/html', hint: 'A <pre> block with the colours inline.' },
  { id: 'svg', label: 'SVG', ext: 'svg', mime: 'image/svg+xml', hint: 'Vector, and the text is still text.' },
]
