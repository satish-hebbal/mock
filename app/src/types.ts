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

export type BackgroundType = 'solid' | 'gradient' | 'mesh' | 'image' | 'transparent'

export interface GradientSpec {
  kind: 'linear' | 'radial'
  angle: number
  from: string
  to: string
}

export interface BackgroundState {
  type: BackgroundType
  color: string
  gradient: GradientSpec
  mesh: { seed: number; colors: string[] }
  imageAssetId: string | null
  /** blur px applied to image/mesh backgrounds */
  blur: number
  brightness: number
}

export interface EnvironmentState {
  keyIntensity: number
  fillIntensity: number
  rimIntensity: number
  ambient: number
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
