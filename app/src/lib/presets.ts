import { DEFAULT_DEVICE_ID, isPickable } from './registry'
import type { CameraState, Keyframe, ProjectDoc } from '../types'

// ————— Social / platform export sizes (PRD §6.8) —————
export interface SizePreset {
  name: string
  width: number
  height: number
}

export const SIZE_PRESETS: SizePreset[] = [
  { name: 'Full HD 1920×1080', width: 1920, height: 1080 },
  { name: '4K 3840×2160', width: 3840, height: 2160 },
  { name: 'Square 1080×1080', width: 1080, height: 1080 },
  { name: 'Story / Reel 1080×1920', width: 1080, height: 1920 },
  { name: 'App Store 6.9″ 1290×2796', width: 1290, height: 2796 },
  { name: 'App Store 6.5″ 1242×2688', width: 1242, height: 2688 },
  { name: 'Play Store 1080×1920', width: 1080, height: 1920 },
  { name: 'Product Hunt 1270×760', width: 1270, height: 760 },
  { name: 'X / Twitter 1600×900', width: 1600, height: 900 },
  { name: 'LinkedIn 1200×627', width: 1200, height: 627 },
  { name: 'Open Graph 1200×630', width: 1200, height: 630 },
  { name: 'YouTube Thumb 1280×720', width: 1280, height: 720 },
  { name: 'Dribbble 1600×1200', width: 1600, height: 1200 },
]

// ————— Frame shape —————

/** An aspect the frame can be set to, independent of its pixel size. */
export interface AspectPreset {
  id: string
  label: string
  w: number
  h: number
  note?: string
}

export const ASPECT_PRESETS: AspectPreset[] = [
  { id: '16:9', label: '16:9', w: 16, h: 9, note: 'Landscape — slides, YouTube, site heroes' },
  { id: '21:9', label: '21:9', w: 21, h: 9, note: 'Ultra-wide banner' },
  { id: '3:2', label: '3:2', w: 3, h: 2, note: 'Classic photo landscape' },
  { id: '4:3', label: '4:3', w: 4, h: 3 },
  { id: '1:1', label: '1:1', w: 1, h: 1, note: 'Square — feed posts' },
  { id: '4:5', label: '4:5', w: 4, h: 5, note: 'Portrait — the tallest Instagram allows in-feed' },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
  { id: '2:3', label: '2:3', w: 2, h: 3, note: 'Classic photo portrait' },
  { id: '9:16', label: '9:16', w: 9, h: 16, note: 'Story / Reel / TikTok' },
  { id: '9:19.5', label: '9:19.5', w: 9, h: 19.5, note: 'Modern phone screen — App Store shots' },
]

/** Video encoders reject odd dimensions, so every frame lands on even pixels. */
const even = (n: number) => Math.min(7680, Math.max(64, Math.round(n / 2) * 2))

/**
 * Reshape the frame to an aspect while holding its longest side, so switching
 * 16:9 → 9:16 re-orients the canvas without quietly changing its resolution.
 */
export function frameForAspect(
  current: { width: number; height: number },
  w: number,
  h: number,
): { width: number; height: number } {
  const long = Math.max(current.width, current.height)
  return w >= h
    ? { width: even(long), height: even((long * h) / w) }
    : { width: even((long * w) / h), height: even(long) }
}

/** "16:9" where it reduces cleanly, "1.85:1" where it doesn't. */
export function ratioLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b < 1 ? a : gcd(b, a % b))
  const g = gcd(width, height) || 1
  const w = Math.round(width / g)
  const h = Math.round(height / g)
  if (w <= 40 && h <= 40) return `${w}:${h}`
  return `${(width / height).toFixed(2)}:1`
}

// ————— Camera angle presets (PRD §6.3) —————
export interface CameraPreset {
  name: string
  cam: Partial<CameraState>
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { name: 'Front', cam: { tiltX: 0, tiltY: 0, roll: 0, panX: 0, panY: 0 } },
  { name: 'Hero', cam: { tiltX: -12, tiltY: 32, roll: 0 } },
  { name: 'Angled L', cam: { tiltX: -6, tiltY: -35, roll: 0 } },
  { name: 'Angled R', cam: { tiltX: -6, tiltY: 35, roll: 0 } },
  { name: 'Isometric', cam: { tiltX: -30, tiltY: 45, roll: 0 } },
  { name: 'Top-down', cam: { tiltX: -78, tiltY: 0, roll: 0 } },
  { name: 'Low Hero', cam: { tiltX: 10, tiltY: 24, roll: 0 } },
  { name: 'Dutch', cam: { tiltX: -8, tiltY: 22, roll: -8 } },
]

// ————— Animation presets (PRD §6.9) — drop keyframes on the timeline —————
export interface AnimationPreset {
  id: string
  name: string
  /** Returns camera keyframes for the given duration & current camera. */
  build: (cam: CameraState, durationMs: number) => Omit<Keyframe, 'id'>[]
}

const kf = (target: string, timeMs: number, value: number): Omit<Keyframe, 'id'> => ({
  target,
  timeMs,
  value,
  easing: 'smooth',
})

export const ANIMATION_PRESETS: AnimationPreset[] = [
  {
    id: 'orbit',
    name: 'Orbit',
    build: (c, d) => [
      kf('camera.tiltY', 0, c.tiltY - 40),
      kf('camera.tiltY', d, c.tiltY + 40),
    ],
  },
  {
    id: 'turntable',
    name: 'Turntable 360°',
    build: (c, d) => [
      { ...kf('camera.rotateY', 0, c.rotateY), easing: 'linear' },
      { ...kf('camera.rotateY', d, c.rotateY + 360), easing: 'linear' },
    ],
  },
  {
    id: 'push',
    name: 'Push-in',
    build: (c, d) => [
      kf('camera.zoom', 0, c.zoom * 0.75),
      kf('camera.zoom', d, c.zoom * 1.25),
    ],
  },
  {
    id: 'pull',
    name: 'Pull-out',
    build: (c, d) => [
      kf('camera.zoom', 0, c.zoom * 1.35),
      kf('camera.zoom', d, c.zoom * 0.9),
    ],
  },
  {
    id: 'flyin',
    name: 'Fly-in reveal',
    build: (c, d) => [
      kf('camera.tiltY', 0, c.tiltY - 70),
      kf('camera.tiltY', d * 0.7, c.tiltY),
      kf('camera.zoom', 0, c.zoom * 0.55),
      kf('camera.zoom', d * 0.8, c.zoom),
      kf('camera.tiltX', 0, c.tiltX - 25),
      kf('camera.tiltX', d * 0.7, c.tiltX),
    ],
  },
  {
    id: 'parallax',
    name: 'Parallax pan',
    build: (c, d) => [
      kf('camera.panX', 0, c.panX - 0.45),
      kf('camera.panX', d, c.panX + 0.45),
      kf('camera.tiltY', 0, c.tiltY - 10),
      kf('camera.tiltY', d, c.tiltY + 10),
    ],
  },
]

// ————— Gradient presets (PRD §10.3) —————
export const GRADIENT_PRESETS: { from: string; to: string; angle: number }[] = [
  { from: '#c7b9f0', to: '#9fc4ee', angle: 135 },
  { from: '#fbc2eb', to: '#a6c1ee', angle: 120 },
  { from: '#fddb92', to: '#d1fdff', angle: 135 },
  { from: '#0f2027', to: '#2c5364', angle: 160 },
  { from: '#ff9a9e', to: '#fecfef', angle: 135 },
  { from: '#a8edea', to: '#fed6e3', angle: 135 },
  { from: '#30cfd0', to: '#330867', angle: 135 },
  { from: '#e0eafc', to: '#cfdef3', angle: 135 },
  { from: '#1a1a2e', to: '#533483', angle: 150 },
  { from: '#f5f7fa', to: '#c3cfe2', angle: 135 },
]

// ————— Overlay fonts (curated Google Fonts + system fallbacks, PRD §6.7/§10.4).
// The Google families are loaded via a stylesheet in index.html; exports wait on
// document.fonts before rasterizing text so previews and files match. —————
export const OVERLAY_FONTS = [
  'Inter',
  'Poppins',
  'Montserrat',
  'Roboto',
  'DM Sans',
  'Space Grotesk',
  'Playfair Display',
  'Lora',
  'Roboto Mono',
  'system-ui',
  'Georgia',
  'Impact',
]

// ————— Scene templates (PRD §6.8) —————
export interface Template {
  id: string
  name: string
  desc: string
  /** CSS background for the gallery card */
  swatch: string
  /** device models the layout needs — the template hides while any is missing */
  needs: string[]
  apply: (p: ProjectDoc) => void
}

const uid = () => crypto.randomUUID()

/** The phone every phone template uses, so templates follow the model catalog. */
const PHONE = DEFAULT_DEVICE_ID

function makeDevice(modelId: string, colorVariant: string, x = 0, rotY = 0, scale = 1) {
  return {
    id: `dev_${uid()}`,
    modelId,
    colorVariant,
    orientation: 'portrait' as const,
    transform: {
      position: [x, 0, 0] as [number, number, number],
      rotation: [0, rotY, 0] as [number, number, number],
      scale,
    },
    screen: { assetId: null, fit: 'cover' as const, scroll: 0 },
  }
}

const ALL_TEMPLATES: Template[] = [
  {
    id: 'hero_phone',
    name: 'Hero Phone',
    desc: 'Single angled phone, soft gradient',
    swatch: 'linear-gradient(135deg,#c7b9f0,#9fc4ee)',
    needs: [PHONE],
    apply: (p) => {
      p.scene.devices = [makeDevice(PHONE, 'stock')]
      p.scene.camera = { ...p.scene.camera, tiltX: -12, tiltY: 32, roll: 0, fov: 26, zoom: 1.5, panX: 0, panY: 0, rotateX: 0, rotateY: 0 }
      p.scene.background = { ...p.scene.background, type: 'gradient', gradient: { kind: 'linear', angle: 135, from: '#c7b9f0', to: '#9fc4ee' } }
      p.keyframes = []
    },
  },
  {
    id: 'duo_fan',
    name: 'Duo Fan',
    desc: 'Two phones fanned out',
    swatch: 'linear-gradient(120deg,#fbc2eb,#a6c1ee)',
    needs: [PHONE],
    apply: (p) => {
      p.scene.devices = [
        makeDevice(PHONE, 'stock', -0.75, 16, 0.95),
        makeDevice(PHONE, 'stock', 0.75, -14, 1),
      ]
      p.scene.camera = { ...p.scene.camera, tiltX: -8, tiltY: 12, roll: 0, fov: 28, zoom: 1.25, panX: 0, panY: 0, rotateX: 0, rotateY: 0 }
      p.scene.background = { ...p.scene.background, type: 'gradient', gradient: { kind: 'linear', angle: 120, from: '#fbc2eb', to: '#a6c1ee' } }
      p.keyframes = []
    },
  },
  {
    id: 'laptop_hero',
    name: 'Laptop Hero',
    desc: 'Open laptop, low 3/4 angle',
    swatch: 'linear-gradient(160deg,#0f2027,#2c5364)',
    needs: ['macbook_pro_16'],
    apply: (p) => {
      p.scene.devices = [makeDevice('macbook_pro_16', 'stock')]
      p.scene.camera = { ...p.scene.camera, tiltX: -14, tiltY: 24, roll: 0, fov: 30, zoom: 1.1, panX: 0, panY: 0.1, rotateX: 0, rotateY: 0 }
      p.scene.background = { ...p.scene.background, type: 'gradient', gradient: { kind: 'linear', angle: 160, from: '#0f2027', to: '#2c5364' } }
      p.keyframes = []
    },
  },
  {
    id: 'flat_lay',
    name: 'Flat Lay',
    desc: 'Top-down phone on mesh gradient',
    swatch: 'linear-gradient(135deg,#a18cd1,#8ec5fc)',
    needs: [PHONE],
    apply: (p) => {
      p.scene.devices = [makeDevice(PHONE, 'stock')]
      p.scene.camera = { ...p.scene.camera, tiltX: -76, tiltY: 8, roll: -14, fov: 24, zoom: 1.35, panX: 0, panY: 0, rotateX: 0, rotateY: 0 }
      p.scene.background = { ...p.scene.background, type: 'mesh', mesh: { seed: 7, colors: ['#a18cd1', '#fbc2eb', '#8ec5fc', '#e0c3fc'] } }
      p.keyframes = []
    },
  },
  {
    id: 'browser_shot',
    name: 'Browser Shot',
    desc: 'Flat browser frame, subtle angle',
    swatch: 'linear-gradient(135deg,#e0eafc,#cfdef3)',
    needs: ['browser_light'],
    apply: (p) => {
      p.scene.devices = [makeDevice('browser_light', 'light')]
      p.scene.camera = { ...p.scene.camera, tiltX: -4, tiltY: 14, roll: 0, fov: 24, zoom: 1.05, panX: 0, panY: 0, rotateX: 0, rotateY: 0 }
      p.scene.background = { ...p.scene.background, type: 'gradient', gradient: { kind: 'linear', angle: 135, from: '#e0eafc', to: '#cfdef3' } }
      p.keyframes = []
    },
  },
  {
    id: 'promo_orbit',
    name: 'Animated Promo',
    desc: 'Phone with a 4s orbit + push-in',
    swatch: 'linear-gradient(150deg,#1a1a2e,#533483)',
    needs: [PHONE],
    apply: (p) => {
      p.scene.devices = [makeDevice(PHONE, 'stock')]
      p.scene.camera = { ...p.scene.camera, tiltX: -10, tiltY: 30, roll: 0, fov: 26, zoom: 1.5, panX: 0, panY: 0, rotateX: 0, rotateY: 0 }
      p.scene.background = { ...p.scene.background, type: 'gradient', gradient: { kind: 'linear', angle: 150, from: '#1a1a2e', to: '#533483' } }
      p.durationMs = 4000
      p.keyframes = [
        { id: `kf_${uid()}`, target: 'camera.tiltY', timeMs: 0, value: -10, easing: 'smooth' },
        { id: `kf_${uid()}`, target: 'camera.tiltY', timeMs: 4000, value: 60, easing: 'smooth' },
        { id: `kf_${uid()}`, target: 'camera.zoom', timeMs: 0, value: 1.1, easing: 'smooth' },
        { id: `kf_${uid()}`, target: 'camera.zoom', timeMs: 4000, value: 1.8, easing: 'smooth' },
      ]
    },
  },
]

/**
 * Only the templates whose devices are actually available. A layout for a model
 * that isn't shipped yet (the laptop, the browser frame) stays out of the
 * gallery rather than dropping a device you can't add by hand.
 */
export const TEMPLATES: Template[] = ALL_TEMPLATES.filter((t) => t.needs.every(isPickable))
