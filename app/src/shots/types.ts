import type { AssetMeta } from '../types'
import type { ShotsDeviceId } from './devices'
import { defaultMesh, type MeshSpec } from '../lib/meshGradient'
import { defaultPortrait, type Portrait } from '../lib/portrait'

// ----- Flat 2D "Shots" editor document (shots.so-class) -----

export type ShotsBgType = 'solid' | 'gradient' | 'mesh' | 'image' | 'wallpaper' | 'photo' | 'transparent'

export type ShotsFrame =
  | 'none'
  | 'macos-light'
  | 'macos-dark'
  | 'browser-light'
  | 'browser-dark'

/**
 * Depth of field over the finished picture.
 *
 * 'lens' defocuses everything outside a focal circle, background and devices
 * alike, the way a camera does. 'stage' keeps the same focus geometry but drops
 * the surroundings into shadow instead. 'both' runs them together, defocusing
 * first and then shading what is left.
 */
/*
 * Portrait is shared with the 3D studio now, so it is declared in
 * src/lib/portrait.ts next to the geometry that reads it. The local name stays
 * so nothing in this folder has to be renamed to follow it.
 */
export type { PortraitMode } from '../lib/portrait'
export { defaultPortrait }
export type ShotsPortrait = Portrait

/**
 * A shadow scene: light shaped by something off-camera, falling across the shot.
 *
 * 'under' lays it on the background only, so the screens sit on top of it and
 * stay perfectly readable. 'over' lets it fall across the devices too, which is
 * what sells the illusion and what costs legibility.
 */
export interface ShotsGobo {
  /** id into SHADOW_SCENES, or 'none' */
  id: string
  opacity: number
  placement: 'under' | 'over'
  /** zoom on the pattern, 0.5..3 */
  scale: number
  /** degrees */
  rotate: number
  /** slide across the frame, as a fraction of its width and height (-0.5..0.5) */
  x: number
  y: number
}

export interface ShotsGradient {
  kind: 'linear' | 'radial'
  angle: number
  from: string
  to: string
}

export interface ShotsBackground {
  type: ShotsBgType
  color: string
  gradient: ShotsGradient
  mesh: MeshSpec
  imageAssetId: string | null
  /** id into WALLPAPERS */
  wallpaperId: string
  /** id into PRESET_PHOTOS */
  photoId: string
  /** background blur px @1280w reference */
  blur: number
  brightness: number
  /** 0..1 vignette darkness */
  vignette: number
  /** 0..1 film grain */
  noise: number
}

export interface ShotsShadow {
  /** blur as fraction of min(canvas) */
  blur: number
  /** vertical offset as fraction of min(canvas) */
  y: number
  /** horizontal offset as fraction of min(canvas) */
  x: number
  opacity: number
  color: string
}

export interface ShotsImage {
  /** stable id for selection / list keys (independent of the asset it shows) */
  id: string
  assetId: string
  /** dominant colors sampled from the screenshot (shots.so "Magic") */
  palette: string[]
  /** 0.3..1.6 multiplier over the contain-fit size */
  scale: number
  /** normalized offset within the padded content box (-0.5..0.5) */
  offsetX: number
  offsetY: number
  /** in-plane rotation, degrees */
  rotate: number
  /**
   * Paint order, low to high, independent of this screen's place in `images`.
   *
   * Array order is *authoring* order: it drives the media strip, the 1-5
   * shortcuts and which slot the next upload lands in. An arrangement that
   * wants a different screen in front (Fan puts the middle one there) must
   * not reshuffle that to get it, so the depth lives here instead. Optional,
   * and absent means 0, so documents saved before it existed still stack the
   * way they always did.
   */
  z?: number
  /** device bezel wrapped around the screenshot ('none' = bare screen) */
  device: ShotsDeviceId
  /** when false the screen is flat and pseudo-3D tilt (rotateX/Y) is ignored */
  style3d: boolean
  /** pseudo-3D tilt, degrees (only applied when style3d) */
  rotateX: number
  rotateY: number
  /** corner radius as fraction of card width (0..0.12) */
  radius: number
  /** inset around the image as fraction of min(canvas) (0..0.45), the "balance" */
  padding: number
  shadow: ShotsShadow
  border: { width: number; color: string }
  frame: ShotsFrame
  /**
   * Card style: the mount the screenshot sits in, id into CARD_STYLES.
   *
   * Only meaningful on a bare screenshot or a window. A device frame is a
   * photograph of a real object, so wrapping a border or a paper stack round
   * its silhouette reads as a mistake, and the renderers skip it there.
   */
  cardStyle?: string
  glow: { strength: number; color: string }
  /** 0..1 mirror reflection height under the card */
  reflection: number
}

export interface ShotsDoc {
  version: 1
  name: string
  size: { width: number; height: number }
  background: ShotsBackground
  /** stacked screens, painted back-to-front; up to MAX_SHOTS */
  images: ShotsImage[]
  /**
   * Screens the count control has set aside, newest first out of the shot.
   * Lowering the count parks them here rather than deleting them, so their
   * media (and their device, shadow and finish) come back untouched when the
   * count goes up again.
   */
  parked?: ShotsImage[]
  /** id of the active layout preset, so the picker can mark it */
  layout?: string
  /**
   * Camera zoom. Magnifies the whole composition about the frame centre,
   * every screen's size *and* its distance from centre, plus the backdrop, so
   * pushing in crops rather than rearranging. Part of the shot, so it exports.
   */
  zoom?: number
  /**
   * Depth of field, applied to the composed frame after every screen is drawn.
   * Optional so documents saved before it existed still load.
   */
  portrait?: ShotsPortrait
  /** shadow scene cast over the shot; optional so older documents still load */
  gobo?: ShotsGobo
  /** id of the screen currently being edited, or null when empty */
  selectedId: string | null
  assets: AssetMeta[]
}

/** Maximum number of screens a single shot can hold. */
export const MAX_SHOTS = 5

const uid = () => crypto.randomUUID()

/** The screen currently targeted by the inspector, or null. */
export function selectedShotsImage(doc: ShotsDoc): ShotsImage | null {
  return doc.images.find((i) => i.id === doc.selectedId) ?? null
}

/**
 * The screens in the order they should be drawn, back to front.
 *
 * Sorting is stable, so screens sharing a `z` (every arrangement that never
 * sets one) keep authoring order and paint exactly as they did before. Both
 * the preview and the exporter go through here, so the two cannot disagree
 * about what is in front.
 */
export function paintOrder(images: ShotsImage[]): ShotsImage[] {
  return [...images].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
}

export function defaultGobo(): ShotsGobo {
  return { id: 'none', opacity: 0.4, placement: 'over', scale: 1, rotate: 0, x: 0, y: 0 }
}

export function defaultShotsImage(assetId: string): ShotsImage {
  return {
    id: `shot_${uid()}`,
    assetId,
    palette: [],
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotate: 0,
    device: 'none',
    style3d: false,
    rotateX: 0,
    rotateY: 0,
    radius: 0.028,
    padding: 0.12,
    shadow: { blur: 0.05, y: 0.03, x: 0, opacity: 0.4, color: '#000000' },
    border: { width: 0, color: '#ffffff' },
    frame: 'none',
    cardStyle: 'default',
    glow: { strength: 0, color: '#ffffff' },
    reflection: 0,
  }
}

export function defaultShotsDoc(): ShotsDoc {
  return {
    version: 1,
    name: 'Untitled Shot',
    size: { width: 1600, height: 1000 },
    background: {
      type: 'wallpaper',
      color: '#6d7cff',
      gradient: { kind: 'linear', angle: 135, from: '#7f7fd5', to: '#86a8e7' },
      mesh: defaultMesh(),
      imageAssetId: null,
      wallpaperId: 'sunset',
      photoId: 'abstract-01',
      blur: 0,
      brightness: 1,
      vignette: 0,
      noise: 0,
    },
    images: [],
    parked: [],
    portrait: defaultPortrait(),
    gobo: defaultGobo(),
    layout: 'row',
    zoom: 1,
    selectedId: null,
    assets: [],
  }
}
