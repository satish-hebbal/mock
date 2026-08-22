import type { MeshSpec } from './lib/meshGradient'

export type Vec3 = [number, number, number]

export type EasingName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'smooth'

/** One animatable value at a point in time (PRD §5.1, §8). */
export interface Keyframe {
  id: string
  /** Dotted path, e.g. `camera.tiltY`, `dev.<id>.rotY`, `dev.<id>.scroll` */
  target: string
  timeMs: number
  value: number
  easing: EasingName
}

export interface Transform {
  position: Vec3
  /** Euler degrees */
  rotation: Vec3
  scale: number
}

export interface ScreenBinding {
  assetId: string | null
  fit: 'cover' | 'contain'
  /** 0..1 scroll offset for tall media (PRD §6.1) */
  scroll: number
}

export interface DeviceInstance {
  id: string
  modelId: string
  colorVariant: string
  /** set when colorVariant is 'custom': a raw hex from the picker */
  customColor?: string
  orientation: 'portrait' | 'landscape'
  transform: Transform
  screen: ScreenBinding
}

export interface CameraState {
  tiltX: number
  tiltY: number
  roll: number
  fov: number
  zoom: number
  panX: number
  panY: number
  rotateX: number
  rotateY: number
}

export type BackgroundType = 'solid' | 'gradient' | 'mesh' | 'image' | 'studio' | 'transparent'

export interface GradientSpec {
  kind: 'linear' | 'radial'
  angle: number
  from: string
  to: string
}

/**
 * A seamless studio sweep — the curved roll of paper behind a product shot.
 * It reads as one continuous surface: the key throws a hotspot on the paper
 * behind the subject, the sweep falls off toward the floor, and the corners
 * are held down so the eye stays on the product.
 */
export interface SweepSpec {
  /** the paper itself */
  color: string
  /** colour of the pool of light the key throws on it */
  hot: string
  /** hotspot centre, as a fraction of frame height (0 = top) */
  hotY: number
  /** hotspot radius, as a fraction of frame width */
  spread: number
  /** how far the paper darkens toward the bottom edge, 0..1 */
  floor: number
  /** corner darkening, 0..1 */
  vignette: number
}

export interface BackgroundState {
  type: BackgroundType
  color: string
  gradient: GradientSpec
  mesh: MeshSpec
  sweep: SweepSpec
  imageAssetId: string | null
  /** blur px applied to image/mesh backgrounds */
  blur: number
  brightness: number
}

/**
 * A photographic lighting rig (PRD §6.4, extended for the studio looks).
 *
 * The three lamps are the standard product-photography setup: a key that
 * defines the form, a weaker fill that opens the shadows it casts, and a rim
 * behind the subject that separates it from the backdrop. Angles are measured
 * off the *camera* axis, not the world, so the rig travels with the lens the
 * way a photographer swings a whole setup around the product.
 */
export interface EnvironmentState {
  keyIntensity: number
  fillIntensity: number
  rimIntensity: number
  ambient: number
  /** key azimuth off the camera axis in degrees (+ = camera right) */
  keyAzimuth: number
  /** key elevation above the subject's horizon, degrees */
  keyElevation: number
  /** apparent source size: 0 = bare bulb (hard), 1 = big softbox (soft) */
  softness: number
  /** key colour: -1 cool strobe … 0 neutral … +1 tungsten warm */
  temperature: number
  /** how strongly the softboxes show up as reflections in glossy surfaces */
  reflection: number
  /** white bounce card below the product, lifting the underside */
  bounce: number

  /*
   * Everything below is optional so projects saved before these existed still
   * load. Each reader falls back to the value that reproduces the old rig, so
   * an old file opens looking exactly as it did.
   */

  /** procedural environment mood id (lib/moods.ts); absent means 'studio' */
  mood?: string
  /** how strongly the mood's dome shows up; absent means 1 */
  moodIntensity?: number

  /*
   * Explicit lamp colours. Absent means "follow the warmth slider", which is
   * the easier control for a photographic look, so setting one of these is an
   * opt-out of that rather than the default way to drive the rig.
   */
  keyColor?: string
  fillColor?: string
  rimColor?: string
  ambientColor?: string

  /** sky-to-ground bounce; absent or 0 means no hemisphere lamp */
  hemiIntensity?: number
  hemiSky?: string
  hemiGround?: string
}

export interface GroundState {
  shadow: boolean
  shadowOpacity: number
  shadowBlur: number
}

/** Color grade (PRD §6.6). Neutral = { exposure:1, contrast:1, saturation:1, temperature:0 }. */
export interface GradeState {
  exposure: number
  contrast: number
  saturation: number
  /** -1 (cool) … 0 (neutral) … 1 (warm) */
  temperature: number
}

export interface EffectsState {
  bloom: number
  noise: number
  vignette: number
  chromatic: number
  grade: GradeState
}

interface OverlayBase {
  id: string
  /** normalized center 0..1 of the export frame */
  x: number
  y: number
  opacity: number
  /** degrees */
  rotation: number
}

export interface TextOverlay extends OverlayBase {
  type: 'text'
  text: string
  /** font size as fraction of frame height */
  size: number
  weight: number
  color: string
  font: string
  align: 'left' | 'center' | 'right'
  /** pill background color or null */
  bg: string | null
}

export interface ImageOverlay extends OverlayBase {
  type: 'image'
  assetId: string
  /** width as fraction of frame width */
  width: number
}

export interface ShapeOverlay extends OverlayBase {
  type: 'shape'
  shape: 'rect' | 'ellipse'
  /** fractions of frame width/height */
  width: number
  height: number
  color: string
  /** corner radius as fraction of frame height (rect only) */
  radius: number
}

export type Overlay = TextOverlay | ImageOverlay | ShapeOverlay

export interface AssetMeta {
  id: string
  kind: 'image' | 'video'
  mime: string
  w: number
  h: number
}

export interface SceneState {
  devices: DeviceInstance[]
  camera: CameraState
  background: BackgroundState
  environment: EnvironmentState
  ground: GroundState
  effects: EffectsState
}

export interface ProjectDoc {
  version: 2
  name: string
  durationMs: number
  fps: number
  exportSize: { width: number; height: number }
  scene: SceneState
  overlays: Overlay[]
  keyframes: Keyframe[]
  assets: AssetMeta[]
}

/** Runtime-only asset handle (object URL). */
export interface AssetRuntime {
  url: string
  kind: 'image' | 'video'
}

export const CAMERA_ANIMATABLE = [
  'tiltX',
  'tiltY',
  'roll',
  'fov',
  'zoom',
  'panX',
  'panY',
  'rotateX',
  'rotateY',
] as const satisfies readonly (keyof CameraState)[]

export type CameraProp = (typeof CAMERA_ANIMATABLE)[number]
