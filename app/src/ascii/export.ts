/**
 * Getting the work out.
 *
 * Four destinations, and the last one is the reason this tool sits inside
 * Ribbit rather than beside it:
 *
 *   an image file    PNG or JPG, at 1x to 4x
 *   a text file      .txt, .ans, .html or .svg
 *   the clipboard    the picture, or the characters
 *   a mockup         straight into Shots or the 3D Studio as a screen
 *
 * Nothing here re-implements the picture. Every path calls `renderAscii` or
 * `textGrid`, which are the same two functions the canvas on screen calls.
 */

import { useShots } from '../shots/store'
import { useStudio } from '../store'
import { track } from '../lib/analytics'
import { ui } from '../lib/ui'
import { renderAscii } from './render'
import { canExportText, textGrid, toText, TEXT_FORMATS, type TextFormat } from './text'
import type { AsciiDoc } from './types'

export type ImageFormat = 'png' | 'jpg'

export function exportSize(doc: AsciiDoc, scale: number) {
  return {
    w: Math.round(doc.size.width * scale),
    h: Math.round(doc.size.height * scale),
  }
}

function safeName(name: string) {
  return name.replace(/[^\w-]+/g, '_') || 'ascii'
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

async function toBlob(canvas: HTMLCanvasElement, format: ImageFormat): Promise<Blob> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, 0.92))
  if (!blob) throw new Error('Encoding failed')
  return blob
}

/** Render at an export scale. The one place that turns a multiplier into pixels. */
export function renderAtScale(doc: AsciiDoc, source: CanvasImageSource | null, scale: number) {
  const { w, h } = exportSize(doc, scale)
  return renderAscii(doc, source, w, h)
}

export async function downloadImage(
  doc: AsciiDoc,
  source: CanvasImageSource | null,
  format: ImageFormat,
  scale: number,
) {
  const { canvas } = renderAtScale(doc, source, scale)
  /*
   * A JPG has no alpha, and a transparent backdrop encoded as one comes out
   * black, which reads as a broken export rather than as a format limitation.
   * Filling the paper colour first is the honest answer to a request that
   * cannot be granted literally.
   */
  if (format === 'jpg' && doc.backdrop.mode === 'transparent') {
    const ctx = canvas.getContext('2d')!
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = doc.backdrop.color
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'source-over'
  }
  downloadBlob(await toBlob(canvas, format), `${safeName(doc.name)}.${format}`)
}

export async function copyImage(doc: AsciiDoc, source: CanvasImageSource | null, scale: number) {
  const { canvas } = renderAtScale(doc, source, scale)
  // PNG only: every browser's clipboard image support is PNG, and asking for
  // a JPEG on the clipboard fails silently on most of them
  const blob = await toBlob(canvas, 'png')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

function buildText(doc: AsciiDoc, source: CanvasImageSource, format: TextFormat) {
  return toText(textGrid(doc, source), doc, format)
}

export function downloadText(doc: AsciiDoc, source: CanvasImageSource, format: TextFormat) {
  const spec = TEXT_FORMATS.find((f) => f.id === format)!
  const text = buildText(doc, source, format)
  downloadBlob(new Blob([text], { type: `${spec.mime};charset=utf-8` }), `${safeName(doc.name)}.${spec.ext}`)
  return text.length
}

export async function copyText(doc: AsciiDoc, source: CanvasImageSource, format: TextFormat) {
  await navigator.clipboard.writeText(buildText(doc, source, format))
}

/**
 * Hand the picture to one of the mockup editors.
 *
 * Both of them already know how to take a Blob and treat it as a screen, so
 * this is a render, an encode, and a mode switch. Rendered at 2x rather than at
 * document size because whatever receives it is going to sit it on a device and
 * then export that at 2x again, and a screen that has been resampled twice is
 * the one place ASCII art falls apart.
 */
export async function sendToMockup(
  doc: AsciiDoc,
  source: CanvasImageSource | null,
  target: 'shots' | 'studio',
) {
  const { canvas } = renderAtScale(doc, source, 2)
  const blob = await toBlob(canvas, 'png')
  const file = new File([blob], `${safeName(doc.name)}.png`, { type: 'image/png' })

  if (target === 'shots') await useShots.getState().importMedia(file, 'image/png')
  else await useStudio.getState().importMedia(file, 'image/png', { bind: true })

  useStudio.getState().setMode(target)
  ui.toast(target === 'shots' ? 'Sent to Shots' : 'Sent to the 3D Studio')
}

/** The shape every export event reports, so the funnel is one chart. */
export function exportShape(doc: AsciiDoc, extra: Record<string, string | number | boolean>) {
  return {
    editor: 'ascii',
    style: doc.style,
    ramp: doc.ramp,
    color_mode: doc.color.mode,
    ...extra,
  }
}

export function trackExport(
  phase: 'export_started' | 'export_completed' | 'export_failed',
  shape: Record<string, string | number | boolean>,
) {
  track(phase, shape)
}

export { canExportText, TEXT_FORMATS }
export type { TextFormat }
