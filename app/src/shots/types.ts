import type { AssetMeta } from '../types'
import type { ShotsDeviceId } from './devices'

// ————— Flat 2D "Shots" editor document (shots.so-class) —————

export type ShotsBgType = 'solid' | 'gradient' | 'mesh' | 'image' | 'wallpaper' | 'transparent'

export type ShotsFrame =
  | 'none'
  | 'macos-light'
  | 'macos-dark'
  | 'browser-light'
  | 'browser-dark'

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
  mesh: { seed: number; colors: string[] }
  imageAssetId: string | null
  /** id into WALLPAPERS */
  wallpaperId: string
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
  /** device bezel wrapped around the screenshot ('none' = bare screen) */
  device: ShotsDeviceId
  /** when false the screen is flat and pseudo-3D tilt (rotateX/Y) is ignored */
  style3d: boolean
  /** pseudo-3D tilt, degrees (only applied when style3d) */
  rotateX: number
  rotateY: number
  /** corner radius as fraction of card width (0..0.12) */
  radius: number
  /** inset around the image as fraction of min(canvas) (0..0.45) — the "balance" */
  padding: number
  shadow: ShotsShadow
  border: { width: number; color: string }
  frame: ShotsFrame
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
      mesh: { seed: 7, colors: ['#a18cd1', '#fbc2eb', '#8ec5fc', '#e0c3fc'] },
      imageAssetId: null,
      wallpaperId: 'sunset',
      blur: 0,
      brightness: 1,
      vignette: 0,
      noise: 0,
    },
    images: [],
    selectedId: null,
    assets: [],
  }
}
