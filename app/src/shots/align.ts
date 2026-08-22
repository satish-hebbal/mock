import { computeLayout } from './layout'
import type { AssetMeta } from '../types'
import type { ShotsDoc, ShotsImage } from './types'

/*
 * Alignment and distribution across every screen in the shot.
 *
 * There's no multi-select in this editor — a shot only ever has up to five
 * screens, and `computeLayout` already treats each one independently, so
 * "align" and "distribute" operate on the whole set rather than needing a
 * selection to gather first. That matches what these tools are for anyway:
 * tidying an arrangement, not picking two things out of a crowd.
 */

export interface ScreenRect {
  cx: number
  cy: number
  w: number
  h: number
  left: number
  right: number
  top: number
  bottom: number
}

/** A screen's on-canvas bounding box, in export pixels — same numbers the renderer draws. */
export function screenRect(
  img: ShotsImage,
  meta: AssetMeta | undefined,
  W: number,
  H: number,
  zoom: number,
): ScreenRect {
  const L = computeLayout(img, meta?.w ?? 1, meta?.h ?? 1, W, H, zoom)
  return {
    cx: L.cx,
    cy: L.cy,
    w: L.cardW,
    h: L.cardH,
    left: L.cx - L.cardW / 2,
    right: L.cx + L.cardW / 2,
    top: L.cy - L.cardH / 2,
    bottom: L.cy + L.cardH / 2,
  }
}

/**
 * The `{ offsetX, offsetY }` that puts a screen's centre at `(cx, cy)`.
 *
 * Inverts the same arithmetic `computeLayout` uses to go the other way
 * (`cx = W/2 + offsetX * boxW * zoom`), using this screen's own padding —
 * padding can differ screen to screen, so the box it's normalized against
 * isn't shared.
 */
export function offsetForCenter(
  img: ShotsImage,
  W: number,
  H: number,
  zoom: number,
  cx: number,
  cy: number,
): { offsetX: number; offsetY: number } {
  const minDim = Math.min(W, H)
  const pad = img.padding * minDim
  const boxW = Math.max(1, W - 2 * pad)
  const boxH = Math.max(1, H - 2 * pad)
  return {
    offsetX: (cx - W / 2) / (boxW * zoom),
    offsetY: (cy - H / 2) / (boxH * zoom),
  }
}

export type AlignMode = 'left' | 'center-h' | 'right' | 'top' | 'middle-v' | 'bottom'

/** The target centre for one screen under an alignment mode, given the group's bounds. */
export function alignedCenter(
  mode: AlignMode,
  rect: ScreenRect,
  bounds: { left: number; right: number; top: number; bottom: number },
): { cx: number; cy: number } {
  switch (mode) {
    case 'left':
      return { cx: bounds.left + rect.w / 2, cy: rect.cy }
    case 'center-h':
      return { cx: (bounds.left + bounds.right) / 2, cy: rect.cy }
    case 'right':
      return { cx: bounds.right - rect.w / 2, cy: rect.cy }
    case 'top':
      return { cx: rect.cx, cy: bounds.top + rect.h / 2 }
    case 'middle-v':
      return { cx: rect.cx, cy: (bounds.top + bounds.bottom) / 2 }
    case 'bottom':
      return { cx: rect.cx, cy: bounds.bottom - rect.h / 2 }
  }
}

/**
 * New centres for every screen so the *gaps* between their edges — not their
 * centre-to-centre distance — come out equal along `axis`.
 *
 * Gap-based rather than centre-based because screens are not always the same
 * size (a hero shot scaled up next to two smaller ones, say), and centring
 * them at equal intervals would leave visibly uneven whitespace between the
 * big one and its neighbours. The first and last screen anchor the span;
 * only the ones between them move.
 */
export function distributedCenters(
  axis: 'x' | 'y',
  rects: { id: string; rect: ScreenRect }[],
): Map<string, number> {
  const out = new Map<string, number>()
  if (rects.length < 3) return out

  const lo = axis === 'x' ? 'left' : 'top'
  const hi = axis === 'x' ? 'right' : 'bottom'
  const size = axis === 'x' ? 'w' : 'h'
  const sorted = [...rects].sort((a, b) => a.rect[lo] - b.rect[lo])

  const span = sorted[sorted.length - 1].rect[hi] - sorted[0].rect[lo]
  const totalSize = sorted.reduce((sum, r) => sum + r.rect[size], 0)
  const gap = Math.max(0, span - totalSize) / (sorted.length - 1)

  let cursor = sorted[0].rect[lo]
  for (const { id, rect } of sorted) {
    out.set(id, cursor + rect[size] / 2)
    cursor += rect[size] + gap
  }
  return out
}

/**
 * New `scale` for every screen so their rendered heights come out equal —
 * for undoing the case where scaling one screen by hand (a hero shot bigger
 * than its neighbours, say) leaves the row uneven.
 *
 * Targets the group's *average* height rather than the largest or smallest,
 * so the set settles toward the middle instead of two extremes: every other
 * screen ballooning up to match a scaled-up hero shot, or that hero shrinking
 * down to match the smallest thumbnail.
 */
export function matchedHeightScales(
  screens: { id: string; rect: ScreenRect; scale: number }[],
): Map<string, number> {
  const out = new Map<string, number>()
  if (screens.length < 2) return out

  const target = screens.reduce((sum, s) => sum + s.rect.h, 0) / screens.length
  for (const { id, rect, scale } of screens) {
    if (scale <= 0 || rect.h <= 0) continue
    // rect.h scales linearly with img.scale, so this scale's "unscaled" height
    // gives the multiplier that lands exactly on the target
    const unscaledH = rect.h / scale
    out.set(id, target / unscaledH)
  }
  return out
}

/** The union of every screen's bounding box. */
export function groupBounds(rects: ScreenRect[]) {
  return {
    left: Math.min(...rects.map((r) => r.left)),
    right: Math.max(...rects.map((r) => r.right)),
    top: Math.min(...rects.map((r) => r.top)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  }
}

/** Every screen's rect, keyed by id, against the doc's current size and assets. */
export function allScreenRects(doc: ShotsDoc): { id: string; rect: ScreenRect }[] {
  const { width: W, height: H } = doc.size
  // unclamped, matching the exact value both the preview and the exporter
  // hand to computeLayout — anything else and "align left" would target a
  // bounding box that doesn't match what's actually on screen
  const zoom = doc.zoom ?? 1
  return doc.images.map((im) => ({
    id: im.id,
    rect: screenRect(im, doc.assets.find((a) => a.id === im.assetId), W, H, zoom),
  }))
}
