/**
 * The panel's pictures, drawn from your own photograph.
 *
 * Fifty-odd styles, forty filters and twenty-six finishing effects: as a wall of
 * names that is a reading exercise, and none of the names says what it will do
 * to *this* picture. So every tile is that picture, put through that one
 * choice, by the same renderer the canvas uses. A tile cannot promise something
 * the tool does not produce, because it is the tool.
 *
 * Drawn once per photograph through Signal's idle-time still cache, so opening
 * the panel never stalls the preview, and only tiles on screen ask for theirs.
 */

import { applyFx, FX_BY_ID, type FxId } from '../lib/postfx'
import { useStudio } from '../store'
import { useStill, thumbPx } from '../signal/thumbs'
import { getFilter, type FilterSpec } from './filters'
import { runLayers } from './layers'
import { defaults } from './params'
import { cover } from './pixels'
import { renderAscii } from './render'
import { getStyle } from './styles'
import { useAscii } from './store'
import { defaultAsciiDoc, type AsciiDoc, type AsciiStyleId } from './types'

/** CSS size a tile is drawn for; the grid squeezes it a little on narrow panels. */
export const TILE_PX = 64

/** The document size a thumbnail pretends to be, so pixel settings keep their proportions. */
const THUMB_DOC = 300

/** A square crop of the photograph, small, made once per photograph. */
const crops = new Map<string, HTMLCanvasElement>()
function cropOf(key: string, bitmap: ImageBitmap, px: number) {
  const k = `${key}:${px}`
  let c = crops.get(k)
  if (!c) {
    c = cover(bitmap, px, px)
    crops.set(k, c)
    if (crops.size > 8) crops.delete(crops.keys().next().value as string)
  }
  return c
}

/** The document a style thumbnail is rendered from: the defaults, with that style on. */
function thumbDoc(style: AsciiStyleId, paper: string): AsciiDoc {
  const spec = getStyle(style)
  const d = defaultAsciiDoc()
  d.style = style
  d.size = { width: THUMB_DOC, height: THUMB_DOC }
  d.grid.aspect = spec.square ? 1 : 1.8
  d.grid.cell = spec.family === 'type' ? 12 : spec.group === 'raster' ? 16 : 11
  d.backdrop = { ...d.backdrop, mode: 'paper', color: paper }
  if (style === 'dither') d.dither.scale = 2
  return d
}

function useSourceKey() {
  const id = useAscii((s) => s.doc.assetId ?? s.loadedId ?? 'none')
  const bitmap = useAscii((s) => s.bitmap)
  return { id, bitmap }
}

function Img({ url }: { url: string | undefined }) {
  return url ? <img src={url} alt="" draggable={false} className="sg-tile-img" /> : null
}

/** A style, on the current photograph. */
export function StyleArt({ id }: { id: AsciiStyleId }) {
  const { id: src, bitmap } = useSourceKey()
  const px = thumbPx(TILE_PX)
  const paper = useStudio((s) => s.theme) === 'light' ? '#f5f6f6' : '#0b0c0d'
  const url = useStill(`ascii-style:${src}:${id}:${px}:${paper}`, () => (canvas) => {
    canvas.width = px
    canvas.height = px
    if (!bitmap) return
    const crop = cropOf(src, bitmap, px * 2)
    const out = renderAscii(thumbDoc(id, paper), crop, px, px, { quality: 'preview', noReveal: true })
    canvas.getContext('2d')!.drawImage(out.canvas, 0, 0)
  })
  return <Img url={url} />
}

/** A filter, on the current photograph, before any style. */
export function FilterArt({ spec }: { spec: FilterSpec }) {
  const { id: src, bitmap } = useSourceKey()
  const px = thumbPx(TILE_PX)
  const url = useStill(`ascii-filter:${src}:${spec.id}:${px}`, () => (canvas) => {
    canvas.width = px
    canvas.height = px
    if (!bitmap) return
    const crop = cropOf(src, bitmap, px)
    const layer = { uid: 'thumb', kind: spec.id, on: true, params: defaults(spec.params) }
    // a little exaggerated, so a thumbnail this small still shows what the filter does
    const out = runLayers(crop, [layer], px, px, px / 320)
    canvas.getContext('2d')!.drawImage(out, 0, 0)
  })
  return <Img url={url} />
}

/** A finishing effect, over a plain character render of the current photograph. */
export function FinishArt({ id }: { id: FxId }) {
  const { id: src, bitmap } = useSourceKey()
  const px = thumbPx(TILE_PX)
  const url = useStill(`ascii-fx:${src}:${id}:${px}`, () => (canvas) => {
    canvas.width = px
    canvas.height = px
    if (!bitmap) return
    const crop = cropOf(src, bitmap, px * 2)
    const base = renderAscii(thumbDoc('characters', '#0b0c0d'), crop, px, px, { noReveal: true }).canvas
    const spec = FX_BY_ID[id]
    applyFx(base, { [id]: { amount: 0.75, color: spec.colors ? '#ff4fd8' : undefined, color2: '#4fe3ff' } }, { scale: px / THUMB_DOC, time: 0.4 })
    canvas.getContext('2d')!.drawImage(base, 0, 0)
  })
  return <Img url={url} />
}

/** For the Flow palette, which lists filters by id. */
export function FilterArtById({ id }: { id: string }) {
  const spec = getFilter(id)
  return spec ? <FilterArt spec={spec} /> : null
}
