/**
 * The PDF, downloaded straight to a file.
 *
 * The print dialog was the honest way out and the wrong experience: asking
 * somebody to find "Save as PDF" in a system dialog to get the one file this
 * tool exists to make is a step too many. So the file is built here instead,
 * and it still does not lay the page out a second time. The page is drawn by
 * the same component, with editing off, and photographed by the browser's own
 * renderer, which is the only way the watercolour, the stamp's misprint and a
 * zigzag rule come out exactly as they looked.
 *
 * ----- keeping it a document -----
 *
 * A photograph of a page on its own is a worse file than the print dialog's:
 * nothing in it can be searched, copied or read aloud, and an accountant who
 * cannot paste the invoice number out of a PDF will notice. So an invisible
 * text layer is laid over the image, word runs at the positions the browser
 * set them, the way a scanned document is made searchable. Selecting text in
 * the PDF selects the real figures, and a search for the invoice number finds
 * it.
 *
 * Both libraries are loaded on the first download rather than with the app:
 * together they are larger than this whole editor, and most sessions never
 * export at all.
 */

import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ui } from '../lib/ui'
import { track } from '../lib/analytics'
import { InvoicePaper, PAPER_ID } from './InvoicePaper'
import { fileStem } from './export'
import { useInvoice } from './store'
import { PAGE_SIZE, type InvoiceDoc } from './types'

/** Device pixels per CSS pixel in the image: about 290dpi on an A4 page. */
const RESOLUTION = 3
/** PDF points per CSS pixel: 72 to the inch against 96. */
const PT = 0.75

/**
 * Inter, as CSS the snapshot can carry inside itself.
 *
 * The photograph is taken of an SVG image, and an image cannot reach the
 * page's fonts: every face it uses has to travel inside it. html-to-image tries
 * to do that by reading the document's stylesheets, but the app loads its
 * faces from Google Fonts, whose stylesheet a page may not read, so the scan
 * fails with a console error and the PDF quietly falls back to whatever sans
 * the machine has. So the one face the paper uses is fetched here instead,
 * Latin subsets only (the rest are scripts no invoice in this build prints),
 * with each file inlined, once per session.
 *
 * An empty string when any of that fails, offline say: the PDF then uses the
 * system face rather than not being made at all.
 */
const INTER_CSS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
let interCSS: Promise<string> | null = null
function embeddedInter(): Promise<string> {
  interCSS ??= (async () => {
    const css = await (await fetch(INTER_CSS)).text()
    const faces = css
      .split('/* ')
      .filter((block) => /^latin(-ext)? \*\//.test(block))
      .map((block) => block.slice(block.indexOf('@font-face')))
    const inlined = await Promise.all(
      faces.map(async (face) => {
        const url = /url\(([^)]+)\)/.exec(face)?.[1]
        if (!url) return face
        const blob = await (await fetch(url)).blob()
        const data = await new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res(String(r.result))
          r.onerror = rej
          r.readAsDataURL(blob)
        })
        return face.replace(url, data)
      }),
    )
    return inlined.join('\n')
  })().catch(() => '')
  return interCSS
}

/**
 * Every run of text on the page, as the browser set it: the words that sit on
 * one line of one text node, with the box they occupy and the size they are
 * set at. Measured a character at a time, because a text node that wraps is
 * one node and several lines, and the line breaks are only visible in the
 * boxes.
 */
function textRuns(root: HTMLElement) {
  const origin = root.getBoundingClientRect()
  const runs: { text: string; x: number; y: number; w: number; h: number; size: number }[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? ''
    if (!text.trim()) continue
    const parent = node.parentElement
    if (!parent) continue
    const style = getComputedStyle(parent)
    if (style.visibility === 'hidden' || style.opacity === '0') continue
    const size = parseFloat(style.fontSize) || 12

    let run: (typeof runs)[number] | null = null
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      const r = range.getBoundingClientRect()
      if (!r.width && !r.height) continue
      const x = r.left - origin.left
      const y = r.top - origin.top
      // a new line starts wherever the next glyph drops below the last one
      if (!run || Math.abs(y - run.y) > r.height * 0.5) {
        if (run && run.text.trim()) runs.push(run)
        run = { text: '', x, y, w: 0, h: r.height, size }
      }
      run.text += text[i]
      run.w = x + r.width - run.x
    }
    if (run && run.text.trim()) runs.push(run)
  }
  range.detach()
  return runs
}

export async function downloadInvoicePDF(doc: InvoiceDoc) {
  const page = PAGE_SIZE[doc.look.page]
  ui.toast('Making the PDF…')

  /*
   * Off-screen but laid out, at its true size and not scaled: the photograph
   * and the text layer are both measured in page pixels, and a page drawn
   * inside the zoomed canvas would be measured at whatever the zoom was.
   */
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-${page.w * 2}px;top:0;width:${page.w}px;height:${page.h}px;pointer-events:none`
  document.body.appendChild(host)
  const root = createRoot(host)

  try {
    flushSync(() =>
      root.render(
        createElement(InvoicePaper, { doc, logoUrl: useInvoice.getState().logoUrl, flat: true }),
      ),
    )
    const node = host.querySelector<HTMLElement>(`#${PAPER_ID}`)
    if (!node) throw new Error('no page')

    // nothing is photographed until everything it draws has arrived: an
    // unloaded logo comes out as a blank box, and only in the file
    await Promise.all([
      ...Array.from(node.querySelectorAll('img')).map((img) => img.decode().catch(() => {})),
      document.fonts?.ready,
    ])

    const [{ toCanvas }, { jsPDF }, fontCSS] = await Promise.all([
      import('html-to-image'),
      import('jspdf'),
      doc.look.type === 'sans' ? embeddedInter() : Promise.resolve(''),
    ])

    const canvas = await toCanvas(node, {
      pixelRatio: RESOLUTION,
      width: page.w,
      height: page.h,
      backgroundColor: doc.look.paper,
      cacheBust: false,
      // the serif and mono stacks are system faces and need nothing embedded
      ...(fontCSS ? { fontEmbedCSS: fontCSS } : { skipFonts: true }),
    })

    const w = page.w * PT
    const h = page.h * PT
    const pdf = new jsPDF({ unit: 'pt', format: [w, h], orientation: 'portrait', compress: true })
    pdf.setProperties({
      title: `Invoice ${doc.number}`,
      subject: doc.to.name ? `Invoice to ${doc.to.name}` : 'Invoice',
      author: doc.from.name,
      creator: 'Mock',
    })
    // JPEG at high quality: a fraction of the PNG's size for a page that is
    // mostly paper, with no visible loss at this resolution
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h, undefined, 'FAST')

    // the invisible layer: every run stretched to exactly the width the
    // browser gave it, so a selection lines up with the words under it
    pdf.setFont('helvetica', 'normal')
    for (const run of textRuns(node)) {
      const size = run.size * PT
      pdf.setFontSize(size)
      const natural = pdf.getTextWidth(run.text)
      pdf.text(run.text, run.x * PT, (run.y + run.h * 0.8) * PT, {
        renderingMode: 'invisible',
        horizontalScale: natural > 0 ? (run.w * PT) / natural : 1,
      })
    }

    pdf.save(`${fileStem(doc)}.pdf`)
    track('export_completed', { editor: 'invoice', format: 'pdf' })
  } catch (err) {
    // the toast is for the user; the cause is for whoever opens the console
    console.error('invoice pdf:', err)
    ui.error('The PDF could not be made')
  } finally {
    root.unmount()
    host.remove()
  }
}
