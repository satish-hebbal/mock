import {
  applyPortrait,
  paintShadowScene,
  buildCardLayer,
  compositeCard,
  computeLayout,
  paintShotBackground,
  renderCard,
} from './render'
import { loadBezelImage } from './bezels'
import { getShadowScene } from './shadows'
import { getPresetPhoto } from './presetPhotos'
import type { AssetRuntime } from '../types'
import { paintOrder } from './types'
import type { ShotsDoc } from './types'

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  return img
}

async function loadMediaSource(
  runtime: AssetRuntime,
): Promise<{ source: CanvasImageSource; w: number; h: number }> {
  if (runtime.kind === 'video') {
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.src = runtime.url
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res()
      v.onerror = () => rej(new Error('video load failed'))
    })
    await new Promise<void>((res) => {
      v.onseeked = () => res()
      v.currentTime = 0
      setTimeout(res, 300)
    })
    return { source: v, w: v.videoWidth, h: v.videoHeight }
  }
  const img = await loadImage(runtime.url)
  return { source: img, w: img.naturalWidth, h: img.naturalHeight }
}

/** Render a shot to a canvas at the given output size (source of truth for export). */
export async function renderShotToCanvas(
  doc: ShotsDoc,
  runtime: Record<string, AssetRuntime>,
  outW: number,
  outH: number,
): Promise<HTMLCanvasElement> {
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ctx = out.getContext('2d')!

  const bgImages: Record<string, HTMLImageElement> = {}
  if (doc.background.type === 'image' && doc.background.imageAssetId) {
    const rt = runtime[doc.background.imageAssetId]
    if (rt) bgImages[doc.background.imageAssetId] = await loadImage(rt.url)
  }
  if (doc.background.type === 'photo') {
    const photo = getPresetPhoto(doc.background.photoId)
    if (photo) bgImages[doc.background.photoId] = await loadImage(photo.src)
  }
  paintShotBackground(ctx, outW, outH, doc.background, bgImages, Math.max(1, doc.zoom ?? 1))

  /*
   * The shadow scene is drawn twice over, in the sense that its placement
   * decides *when*: under the screens it goes down now, on the background
   * alone; over them it waits until every card is composited.
   */
  const gobo = doc.gobo
  const scene = gobo && gobo.id !== 'none' ? getShadowScene(gobo.id) : null
  const goboArt = scene ? await loadImage(scene.src).catch(() => null) : null
  const paintGobo = () => {
    if (!gobo || !goboArt) return
    paintShadowScene(ctx, outW, outH, gobo, goboArt, goboArt.naturalWidth, goboArt.naturalHeight)
  }
  if (gobo?.placement === 'under') paintGobo()

  for (const img of paintOrder(doc.images)) {
    const meta = doc.assets.find((a) => a.id === img.assetId)
    const rt = runtime[img.assetId]
    if (!meta || !rt) continue
    const media = await loadMediaSource(rt)
    const L = computeLayout(img, meta.w, meta.h, outW, outH, doc.zoom ?? 1)
    // a frame that won't decode is skipped rather than failing the whole export
    const frame = L.bezel ? await loadBezelImage(L.bezel).catch(() => undefined) : undefined
    const card = renderCard(media.source, L, img, media.w, media.h, frame)
    const layer = buildCardLayer(outW, outH, card, L, img)
    compositeCard(ctx, layer, L, img, Math.min(outW, outH))
  }

  if (gobo?.placement === 'over') paintGobo()

  // last, over the whole assembled frame: the lens does not know which parts of
  // the picture were drawn separately
  applyPortrait(out, doc.portrait)
  return out
}

export interface ShotExportOptions {
  width: number
  height: number
  format: 'png' | 'jpg' | 'webp'
  quality: number
}

export async function exportShot(
  doc: ShotsDoc,
  runtime: Record<string, AssetRuntime>,
  opts: ShotExportOptions,
) {
  const out = await renderShotToCanvas(doc, runtime, opts.width, opts.height)
  const mime = opts.format === 'png' ? 'image/png' : opts.format === 'jpg' ? 'image/jpeg' : 'image/webp'
  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, mime, opts.quality))
  if (!blob) throw new Error('Encoding failed')
  downloadBlob(blob, `${safeName(doc.name)}.${opts.format}`)
}

/** Quick capture at the document's own size. */
export async function quickCaptureShot(doc: ShotsDoc, runtime: Record<string, AssetRuntime>) {
  await exportShot(doc, runtime, { width: doc.size.width, height: doc.size.height, format: 'png', quality: 1 })
}

function safeName(name: string) {
  return name.replace(/[^\w-]+/g, '_') || 'shot'
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
