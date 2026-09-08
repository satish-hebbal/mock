/**
 * SVG export.
 *
 * The whole document as vector: backdrop, art, and the two finishing effects
 * that are expressible as shapes. The art itself costs almost nothing to write
 * here, because `paintArt` already knows how to draw every style and this only
 * has to hand it a different surface.
 *
 * Two things are genuinely raster and are handled honestly rather than faked:
 *
 *   A photographic backdrop is a photograph. It gets embedded as a raster
 *   `<image>`, because a vector file containing a picture is normal and a
 *   vector file pretending a picture is paths is a hundred megabytes.
 *
 *   The pixel effects (bloom, chromatic, grain, glitch, curvature) have no
 *   vector expression at all. They are dropped, and the export dialog says so
 *   rather than shipping a file that quietly differs from the preview.
 */

import { getStyle } from './styles'
import { ditherPixels, glyphFontSize, makeCanvas, paintArt, paintBackdrop } from './render'
import { MONO, SvgSurface } from './surface'
import { gridSize, type AsciiDoc } from './types'

const n = (v: number) => {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

/** Which parts of a document SVG cannot carry, so the dialog can say so up front. */
export function svgOmissions(doc: AsciiDoc): string[] {
  const out: string[] = []
  const fx = doc.fx
  if (fx.bloom > 0 || fx.chromatic > 0 || fx.grain > 0 || fx.glitch > 0 || fx.curvature > 0) {
    out.push('bloom, chromatic, grain, glitch and curvature')
  }
  if (doc.color.tintOpacity > 0) out.push('the tint blend')
  if (doc.backdrop.mode === 'blurred' || doc.backdrop.mode === 'source') {
    out.push('the photo backdrop, which is embedded as an image')
  }
  return out
}

/**
 * The backdrop, as markup.
 *
 * Paper and mesh are shapes, so they stay shapes. Anything involving the source
 * photograph is rendered once to a canvas and embedded, which is the only
 * truthful option: the alternative is dropping it and producing a file that
 * does not look like the thing on screen.
 */
function backdropSvg(doc: AsciiDoc, source: CanvasImageSource | null, w: number, h: number): string {
  const bd = doc.backdrop
  if (bd.mode === 'transparent') return ''
  if (bd.mode === 'paper') return `<rect width="${n(w)}" height="${n(h)}" fill="${bd.color}"/>`

  /*
   * Mesh gradients are radial stacks and could in principle be written as SVG
   * gradients, but they are built by a canvas painter shared with the rest of
   * the app, and reimplementing it here would be exactly the duplication this
   * whole file exists to avoid. Rasterising the backdrop keeps one description
   * of a mesh; the art on top of it stays vector, which is the part that
   * matters.
   */
  const scratch = makeCanvas(w, h)
  paintBackdrop(scratch.getContext('2d')!, doc, source, w, h, w / Math.max(1, doc.size.width))
  return `<image x="0" y="0" width="${n(w)}" height="${n(h)}" href="${scratch.toDataURL('image/png')}"/>`
}

/**
 * A dithered document, as merged rectangles.
 *
 * One rect per pixel would be 60,000 elements on a modest document. Merging
 * runs of identical colour along each row typically cuts that by an order of
 * magnitude, because a dithered picture is mostly flat regions with texture at
 * the tonal boundaries, and the flat regions collapse to a single rect each.
 *
 * The result is genuinely vector: it scales to any size with hard pixel edges,
 * which is what anybody exporting a dithered picture to SVG actually wants.
 */
function ditherSvg(doc: AsciiDoc, source: CanvasImageSource, w: number, h: number): string {
  const { img, cols, rows } = ditherPixels(doc, source)
  const px = img.data
  const sx = w / cols
  const sy = h / rows
  const parts: string[] = []

  for (let y = 0; y < rows; y++) {
    let runStart = 0
    let runKey = ''
    const flush = (end: number) => {
      if (!runKey || end <= runStart) return
      parts.push(
        `<rect x="${n(runStart * sx)}" y="${n(y * sy)}" width="${n((end - runStart) * sx + 0.5)}" height="${n(sy + 0.5)}" fill="${runKey}"/>`,
      )
    }
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4
      // a fully transparent pixel is a hole in the picture, not a black one
      const key = px[i + 3] < 8 ? '' : `rgb(${px[i]},${px[i + 1]},${px[i + 2]})`
      if (key !== runKey) {
        flush(x)
        runKey = key
        runStart = x
      }
    }
    flush(cols)
  }
  return parts.join('')
}

/**
 * Saturation and grayscale, as a filter.
 *
 * Two `feColorMatrix` stages in the order the canvas applies them, so a
 * document that desaturates and then drains to grey lands in the same place in
 * both outputs. Returns an empty string when neither is doing anything, because
 * an identity filter still forces the renderer to rasterise the group it is on.
 */
function colorFilter(doc: AsciiDoc): { def: string; attr: string } {
  const c = doc.color
  if (c.saturation === 1 && c.grayscale <= 0) return { def: '', attr: '' }
  const stages = [
    c.saturation !== 1 ? `<feColorMatrix type="saturate" values="${n(c.saturation)}"/>` : '',
    c.grayscale > 0 ? `<feColorMatrix type="saturate" values="${n(1 - c.grayscale)}"/>` : '',
  ].join('')
  return {
    def: `<filter id="grade" color-interpolation-filters="sRGB">${stages}</filter>`,
    attr: ' filter="url(#grade)"',
  }
}

/** The two effects that are shapes rather than pixel operations. */
function fxSvg(doc: AsciiDoc, w: number, h: number): { defs: string; body: string } {
  const defs: string[] = []
  const body: string[] = []
  const fx = doc.fx

  if (fx.scanlines > 0) {
    const gap = Math.max(2, Math.round(3 * (w / Math.max(1, doc.size.width))))
    const thickness = Math.max(1, Math.round(gap / 2))
    defs.push(
      `<pattern id="scan" width="1" height="${n(gap + thickness)}" patternUnits="userSpaceOnUse">` +
        `<rect x="0" y="0" width="1" height="${n(thickness)}" fill="#000" opacity="${n(fx.scanlines * 0.55)}"/>` +
        `</pattern>`,
    )
    body.push(`<rect width="${n(w)}" height="${n(h)}" fill="url(#scan)"/>`)
  }

  if (fx.vignette > 0) {
    // the same geometry the canvas uses: clear to about a third of the short
    // edge, then falling to the corner distance
    const inner = (Math.min(w, h) * 0.32) / (Math.hypot(w, h) / 2)
    defs.push(
      `<radialGradient id="vig" cx="50%" cy="50%" r="50%" gradientUnits="objectBoundingBox">` +
        `<stop offset="${n(inner)}" stop-color="#000" stop-opacity="0"/>` +
        `<stop offset="1" stop-color="#000" stop-opacity="${n(Math.min(1, fx.vignette))}"/>` +
        `</radialGradient>`,
    )
    /*
     * A radial gradient in bounding-box units is an ellipse stretched to the
     * element's aspect, which is what a vignette on a wide picture should be,
     * and matches the canvas pass reaching the corner distance in both axes.
     */
    body.push(`<rect width="${n(w)}" height="${n(h)}" fill="url(#vig)"/>`)
  }

  return { defs: defs.join(''), body: body.join('') }
}

/**
 * The document, as one SVG string.
 *
 * Written at document size rather than at an export scale, because that is what
 * vector means: the `viewBox` carries the proportions and the consumer picks
 * the size. There is no 2x SVG.
 */
export function renderAsciiSvg(doc: AsciiDoc, source: CanvasImageSource | null): string {
  const w = doc.size.width
  const h = doc.size.height
  const spec = getStyle(doc.style)

  const parts: string[] = [backdropSvg(doc, source, w, h)]

  if (source) {
    const grade = colorFilter(doc)
    let art = ''
    let font = ''

    if (doc.style === 'dither') {
      art = ditherSvg(doc, source, w, h)
    } else {
      const { cols, rows } = gridSize(doc, spec.square)
      const cw = w / cols
      const surface = new SvgSurface(cw)
      paintArt(surface, doc, source, w, h)
      art = surface.body()
      /*
       * The face and size go on the group, not on every run. The size has to
       * be the one `paintArt` just sized the grid with, so it is asked for
       * here rather than recomputed: a five per cent disagreement between the
       * two is a row that no longer fits its columns.
       */
      if (spec.glyph) {
        const size = glyphFontSize(doc, cw, h / rows)
        font = ` font-family="${MONO.replace(/"/g, "'")}" font-size="${n(size)}"`
      }
    }

    const opacity = doc.color.opacity < 1 ? ` opacity="${n(doc.color.opacity)}"` : ''
    if (grade.def) parts.push(`<defs>${grade.def}</defs>`)
    parts.push(`<g${font}${grade.attr}${opacity}>${art}</g>`)
  }

  const fx = fxSvg(doc, w, h)
  if (fx.defs) parts.push(`<defs>${fx.defs}</defs>`)
  parts.push(fx.body)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}">`,
    parts.join(''),
    '</svg>',
  ].join('')
}
