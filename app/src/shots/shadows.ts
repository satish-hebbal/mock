import type { ShotsGobo } from './types'

/*
 * Shadow scenes: a gobo laid over the shot, the way a light shaped by a plant
 * or a blind falls across a wall.
 *
 * Each asset is already the shadow *alone*, flat black with its darkness stored
 * in alpha, produced by `scripts/optimize-shadows.mjs` from a greyscale source.
 * That is why nothing here blends: a shadow that is already transparent where
 * the light got through just gets drawn, and the same file works in the CSS
 * preview and the canvas exporter without either of them doing colour maths.
 *
 * Adding one is a row here plus a file in `assets-src/shadows/`.
 */

export interface ShadowScene {
  id: string
  label: string
  /** public URL of the processed WebP */
  src: string
  /**
   * A small copy for the picker. The grid draws every scene at once, so
   * pointing those tiles at the full files would pull the whole catalog, over a
   * megabyte of it, to fill squares a hundred pixels wide.
   */
  thumb: string
}

export const NO_SHADOW_SCENE = 'none'

/*
 * Ordered the way you would reach for them: the architectural light first,
 * then big simple leaves, then progressively finer foliage. Fine detail is the
 * riskiest over a screenshot, so it sits furthest from the default.
 */
const SCENES: [string, string][] = [
  ['blinds-01', 'Blinds'],
  ['window-grid-01', 'Window'],
  ['monstera-01', 'Monstera'],
  ['palm-frond-01', 'Palm Frond'],
  ['palm-cluster-01', 'Palms'],
  ['fern-01', 'Fern'],
  ['grass-01', 'Grass'],
  ['eucalyptus-01', 'Eucalyptus'],
  ['ivy-01', 'Ivy'],
  ['branch-leafy-01', 'Leafy Branch'],
  ['canopy-01', 'Canopy'],
  ['blossom-01', 'Blossom'],
  ['branch-bare-01', 'Bare Branch'],
]

export const SHADOW_SCENES: ShadowScene[] = SCENES.map(([id, label]) => ({
  id,
  label,
  src: `/shadows/${id}.webp`,
  thumb: `/shadows/${id}-thumb.webp`,
}))

export function getShadowScene(id: string): ShadowScene | null {
  return SHADOW_SCENES.find((s) => s.id === id) ?? null
}

/**
 * Where the pattern lands, shared by the preview and the exporter.
 *
 * The image covers the frame, takes the user's zoom, and then two corrections
 * that exist for the same reason: a cover-fit image covers *exactly*, so any
 * transform that moves it also uncovers an edge.
 *
 *   - rotating needs |cos| + |sin|, or the layer swings its own corners into
 *     view and the shadow stops at a diagonal line across the picture
 *   - sliding by `x` needs 1 + 2|x|, since the far edge has to reach the same
 *     distance past the frame that the near edge just travelled inward
 *
 * Both are no-ops at rest, so nothing about the default look depends on them.
 * The pattern does grow a little as you slide it, which is the honest price of
 * never showing a hard cut edge across the picture.
 */
export function goboTransform(gobo: ShotsGobo): { rad: number; scale: number } {
  const rad = (gobo.rotate * Math.PI) / 180
  const spin = Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad))
  const slide = 1 + 2 * Math.max(Math.abs(gobo.x), Math.abs(gobo.y))
  return { rad, scale: gobo.scale * spin * slide }
}

/** Cover-fit size for an image of `iw`x`ih` filling `W`x`H`, before zoom. */
export function goboCover(W: number, H: number, iw: number, ih: number) {
  const s = Math.max(W / Math.max(1, iw), H / Math.max(1, ih))
  return { w: iw * s, h: ih * s }
}
