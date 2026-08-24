import { bezelFor } from './devices'
import type { Bezel } from './bezels'
import type { ShotsFrame, ShotsImage } from './types'

/** Window-chrome bar height as a fraction of card width, per frame style. */
export function barFracFor(frame: ShotsFrame): number {
  if (frame === 'none') return 0
  if (frame === 'browser-light' || frame === 'browser-dark') return 0.085
  return 0.05 // macOS traffic-light bar
}

export interface CardLayout {
  /** outer card size on the canvas, in export pixels, the whole device frame */
  cardW: number
  cardH: number
  /** card center on the canvas */
  cx: number
  cy: number
  /** screen rect within the card (equal to the card when there's no frame) */
  screenX: number
  screenY: number
  screenW: number
  screenH: number
  /** chrome bar height in px (0 when frame === 'none') */
  barH: number
  /** screen corner radius in px */
  screenRadiusPx: number
  /** outer card corner radius in px, 0 with a frame, whose PNG shapes itself */
  outerRadiusPx: number
  borderPx: number
  /** the frame asset to paint over the screen, or null for a bare screenshot */
  bezel: Bezel | null
}

/**
 * Deterministic placement shared by the CSS preview and the canvas exporter, so
 * a shot looks identical in both. All inputs are in export pixels; the preview
 * simply multiplies the result by its display scale.
 *
 * With a device frame the *PNG* is what gets fitted into the padded content
 * area, and the screen rect is its cutout scaled by the same factor, so the
 * screenshot always lands exactly in the hole, at any size.
 */
export function computeLayout(
  img: ShotsImage,
  mediaW: number,
  mediaH: number,
  W: number,
  H: number,
  /**
   * Camera zoom. Applied to the card size *and* to its offset from centre,
   * scaling size alone grows each screen about its own middle, which closes the
   * gaps instead of magnifying the arrangement.
   */
  zoom = 1,
): CardLayout {
  const scale = img.scale * zoom
  /*
   * A device frame is a flat photograph of a real phone, lit from one angle. Tilt
   * it in pseudo-3D and the lighting no longer agrees with the pose, so it reads
   * as a picture of a phone rather than a phone. 3D therefore drops the frame and
   * shows the bare screen, both here and, because the exporter reads the same
   * layout, in the file you get out.
   */
  const bezel = img.style3d ? null : bezelFor(img.device)
  const minDim = Math.min(W, H)
  const pad = img.padding * minDim
  const boxW = Math.max(1, W - 2 * pad)
  const boxH = Math.max(1, H - 2 * pad)
  const barFrac = barFracFor(img.frame)

  if (bezel) {
    // Fit the whole frame, then scale its measured geometry by the same factor.
    const outerA = bezel.frame.w / bezel.frame.h
    let cardW = boxW
    let cardH = cardW / outerA
    if (cardH > boxH) {
      cardH = boxH
      cardW = cardH * outerA
    }
    cardW *= scale
    cardH *= scale

    const k = cardW / bezel.frame.w // PNG px -> canvas px
    const screenW = bezel.screen.w * k
    return {
      cardW,
      cardH,
      cx: W / 2 + img.offsetX * boxW * zoom,
      cy: H / 2 + img.offsetY * boxH * zoom,
      screenX: bezel.screen.x * k,
      screenY: bezel.screen.y * k,
      screenW,
      screenH: bezel.screen.h * k,
      barH: barFrac * screenW,
      screenRadiusPx: bezel.radius * k,
      outerRadiusPx: 0,
      borderPx: img.border.width * (screenW / 1000),
      bezel,
    }
  }

  // Bare screenshot: the card *is* the screen and keeps the media's own aspect,
  // so nothing is ever cropped when no device dictates a shape.
  const imgA = mediaW / Math.max(1, mediaH)
  const cardA = imgA / (1 + barFrac * imgA)
  let cardW = boxW
  let cardH = cardW / cardA
  if (cardH > boxH) {
    cardH = boxH
    cardW = cardH * cardA
  }
  cardW *= scale
  cardH *= scale

  return {
    cardW,
    cardH,
    cx: W / 2 + img.offsetX * boxW * zoom,
    cy: H / 2 + img.offsetY * boxH * zoom,
    screenX: 0,
    screenY: 0,
    screenW: cardW,
    screenH: cardH,
    barH: barFrac * cardW,
    screenRadiusPx: img.radius * cardW,
    outerRadiusPx: img.radius * cardW,
    borderPx: img.border.width * (cardW / 1000),
    bezel: null,
  }
}

/** Perspective depth used by both CSS `perspective()` and the export warp. */
export function perspectiveFor(cardW: number): number {
  return cardW * 1.8
}
