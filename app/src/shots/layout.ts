import { getShotsDevice } from './devices'
import type { ShotsFrame, ShotsImage } from './types'

/** Window-chrome bar height as a fraction of card width, per frame style. */
export function barFracFor(frame: ShotsFrame): number {
  if (frame === 'none') return 0
  if (frame === 'browser-light' || frame === 'browser-dark') return 0.085
  return 0.05 // macOS traffic-light bar
}

export interface CardLayout {
  /** outer (device) card size on the canvas, in export pixels */
  cardW: number
  cardH: number
  /** card center on the canvas */
  cx: number
  cy: number
  /** screen rect within the card canvas (equal to the card when device='none') */
  screenX: number
  screenY: number
  screenW: number
  screenH: number
  /** chrome bar height in px (0 when frame === 'none') */
  barH: number
  /** screen corner radius in px */
  screenRadiusPx: number
  /** outer device corner radius in px */
  outerRadiusPx: number
  /** device bezel thickness in px (0 when device='none') */
  bezelPx: number
  borderPx: number
}

/**
 * Deterministic placement shared by the CSS preview and the canvas exporter, so
 * a shot looks identical in both. All inputs are in export pixels; the preview
 * simply multiplies the result by its display scale.
 *
 * When a device is selected the screenshot is wrapped in a uniform bezel; the
 * *outer* device box is what gets fitted into the padded content area.
 */
export function computeLayout(
  img: ShotsImage,
  mediaW: number,
  mediaH: number,
  W: number,
  H: number,
): CardLayout {
  // device bezels are flat placeholders — never combine them with 3D tilt
  const dev = getShotsDevice(img.style3d ? 'none' : img.device)
  const minDim = Math.min(W, H)
  const pad = img.padding * minDim
  const boxW = Math.max(1, W - 2 * pad)
  const boxH = Math.max(1, H - 2 * pad)

  const imgA = mediaW / Math.max(1, mediaH)
  // A selected device dictates the screen shape — you're mocking up an iPhone,
  // not an iPhone-shaped-like-your-screenshot. With no device the screenshot's
  // own aspect wins, so a bare shot is never cropped.
  const screenA = dev.screen ? dev.screen.w / dev.screen.h : imgA
  const barFrac = barFracFor(img.frame)
  // screen aspect once the chrome bar is added on top: screenH = screenW/screenA + barFrac*screenW
  const cardA = screenA / (1 + barFrac * screenA)

  // Outer device box expressed in units of the screen width (s).
  const outerWs = 1 + 2 * dev.bezel
  const outerHs = 1 / cardA + 2 * dev.bezel
  const outerA = outerWs / outerHs

  let cardW = boxW
  let cardH = cardW / outerA
  if (cardH > boxH) {
    cardH = boxH
    cardW = cardH * outerA
  }
  cardW *= img.scale
  cardH *= img.scale

  const s = cardW / outerWs // screen width in px
  const screenW = s
  const screenH = s / cardA
  const bezelPx = dev.bezel * s

  const cx = W / 2 + img.offsetX * boxW
  const cy = H / 2 + img.offsetY * boxH

  const bare = img.style3d || img.device === 'none'
  return {
    cardW,
    cardH,
    cx,
    cy,
    screenX: bezelPx,
    screenY: bezelPx,
    screenW,
    screenH,
    barH: barFrac * screenW,
    screenRadiusPx: (bare ? img.radius : dev.screenRadius) * screenW,
    outerRadiusPx: bare ? img.radius * screenW : dev.outerRadius * cardW,
    bezelPx,
    borderPx: img.border.width * (screenW / 1000),
  }
}

/** Perspective depth used by both CSS `perspective()` and the export warp. */
export function perspectiveFor(cardW: number): number {
  return cardW * 1.8
}
