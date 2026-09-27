/**
 * The layer stack, run over the source before any style sees it.
 *
 * The output is a canvas at the document's own size, which then stands in for
 * the source everywhere downstream: the grid is cut from it, the backdrop is
 * drawn from it, and the text exporters read it. So a twirl layer twirls the
 * characters *and* the photograph behind them, which is the only reading of
 * "twirl the picture" that does not look like a bug.
 *
 * Kept for the last few sources and stacks. A slider on a colour or an effect
 * redraws the frame without touching the stack, and re-running a warp for a
 * change it cannot see was most of the cost of dragging anything once a layer
 * was on.
 */

import { getFilter } from './filters'
import { resolve } from './params'
import { cover } from './pixels'
import type { AsciiDoc, AsciiLayer } from './types'

interface Entry {
  source: CanvasImageSource
  key: string
  canvas: HTMLCanvasElement
}

const cache: Entry[] = []
const KEEP = 6

export function activeLayers(doc: AsciiDoc): AsciiLayer[] {
  return doc.layers.filter((l) => l.on && getFilter(l.kind))
}

/**
 * Run `layers` over `source` at `w` x `h`. `k` is working pixels per document
 * pixel, which is 1 for the document itself and smaller for a thumbnail.
 */
export function runLayers(
  source: CanvasImageSource,
  layers: AsciiLayer[],
  w: number,
  h: number,
  k: number,
): HTMLCanvasElement {
  let frame = cover(source, w, h)
  for (const layer of layers) {
    const spec = getFilter(layer.kind)
    if (!spec) continue
    try {
      frame = spec.fn(frame, { k, p: resolve(spec.params, layer.params) })
    } catch {
      /* a filter that throws on an odd size leaves the frame as it was */
    }
  }
  return frame
}

/** The source as the style should see it: the photograph with the stack applied. */
export function prepareSource(doc: AsciiDoc, source: CanvasImageSource, k = 1): CanvasImageSource {
  const layers = activeLayers(doc)
  if (layers.length === 0) return source
  const w = Math.max(1, Math.round(doc.size.width))
  const h = Math.max(1, Math.round(doc.size.height))
  const key = JSON.stringify([layers.map((l) => [l.kind, l.params]), w, h, k])
  const hit = cache.find((e) => e.source === source && e.key === key)
  if (hit) {
    // most recently used goes to the front
    cache.splice(cache.indexOf(hit), 1)
    cache.unshift(hit)
    return hit.canvas
  }
  const canvas = runLayers(source, layers, w, h, k)
  cache.unshift({ source, key, canvas })
  if (cache.length > KEEP) cache.length = KEEP
  return canvas
}
