import * as THREE from 'three'
import type {
  CameraState,
  EffectsState,
  EnvironmentState,
  GradeState,
  GroundState,
  SweepSpec,
} from '../types'

/*
 * Studio looks — complete photographic setups, not just slider values.
 *
 * Each one is a real product-photography lighting plan translated into the
 * scene: where the key sits relative to the lens, how far the fill is pulled
 * down from it (the "ratio"), whether a rim separates the subject from the
 * paper, what the seamless sweep behind it is doing, and what lens the shot
 * would have been taken on. The recipe line travels with the preset so the
 * setup is legible rather than a magic number soup.
 *
 * Reference practice:
 *  - key 15–70° off the lens axis, 45° being the workhorse; slightly above the
 *    subject and angled down
 *  - fill on the opposite side, always weaker: 3:1 reads natural, 2:1 soft,
 *    1.3:1 is the near-shadowless e-commerce packshot
 *  - rim/back light behind and above, aimed back at the camera, to peel the
 *    subject off the backdrop
 *  - white card bounces light back into the shadow side; black card deepens it
 *  - white seamless paper curved from wall to table so there's no horizon line
 */

export interface StudioLook {
  id: string
  name: string
  /** the setup in photographer's shorthand, shown on the preset card */
  recipe: string
  env: EnvironmentState
  ground: GroundState
  sweep: SweepSpec
  /** framing the setup was designed around */
  camera: Pick<CameraState, 'tiltX' | 'tiltY' | 'roll' | 'fov' | 'zoom'>
  effects?: Partial<Pick<EffectsState, 'bloom' | 'vignette' | 'noise' | 'chromatic'>>
  grade?: Partial<GradeState>
}

/**
 * 35mm-equivalent focal length for a vertical FOV — the number a photographer
 * actually thinks in. 24mm tall frame, so f = 12 / tan(fov/2).
 */
export function focalFromFov(fov: number): number {
  return Math.round(12 / Math.tan((fov * Math.PI) / 360))
}

const env = (e: Partial<EnvironmentState>): EnvironmentState => ({
  keyIntensity: 2.3,
  fillIntensity: 0.8,
  rimIntensity: 0.9,
  ambient: 0.32,
  keyAzimuth: 45,
  keyElevation: 34,
  softness: 0.7,
  temperature: 0,
  reflection: 1,
  bounce: 0.35,
  ...e,
})

export const STUDIO_LOOKS: StudioLook[] = [
  {
    id: 'three_point',
    name: 'Three-Point Classic',
    recipe: '45° key · 3:1 fill · rim behind · grey seamless',
    env: env({}),
    ground: { shadow: true, shadowOpacity: 0.5, shadowBlur: 2 },
    sweep: { color: '#33363d', hot: '#7e8593', hotY: 0.4, spread: 0.62, floor: 0.34, vignette: 0.22 },
    camera: { tiltX: -8, tiltY: 28, roll: 0, fov: 28, zoom: 1.45 },
  },
  {
    id: 'softbox_packshot',
    name: 'Softbox Packshot',
    recipe: 'Big frontal softbox at 28° · 1.6:1 fill · white sweep',
    env: env({
      keyIntensity: 2.6,
      fillIntensity: 1.6,
      rimIntensity: 0.5,
      ambient: 0.6,
      keyAzimuth: 28,
      keyElevation: 42,
      softness: 0.95,
      reflection: 1.35,
      bounce: 0.6,
    }),
    ground: { shadow: true, shadowOpacity: 0.3, shadowBlur: 2.4 },
    sweep: { color: '#eef0f3', hot: '#ffffff', hotY: 0.38, spread: 0.72, floor: 0.16, vignette: 0.06 },
    camera: { tiltX: -6, tiltY: 16, roll: 0, fov: 24, zoom: 1.4 },
  },
  {
    id: 'high_key',
    name: 'High Key',
    recipe: 'Near-shadowless 1.3:1 · lifted ambient · pure white paper',
    env: env({
      keyIntensity: 3,
      fillIntensity: 2.3,
      rimIntensity: 0.6,
      ambient: 0.9,
      keyAzimuth: 20,
      keyElevation: 40,
      softness: 1,
      temperature: -0.05,
      reflection: 1.2,
      bounce: 0.8,
    }),
    ground: { shadow: true, shadowOpacity: 0.18, shadowBlur: 2.8 },
    sweep: { color: '#ffffff', hot: '#ffffff', hotY: 0.4, spread: 0.8, floor: 0.08, vignette: 0 },
    camera: { tiltX: -4, tiltY: 10, roll: 0, fov: 26, zoom: 1.4 },
    effects: { bloom: 0.15 },
  },
  {
    id: 'low_key',
    name: 'Low Key',
    recipe: 'Single hard key at 68° · no fill · black paper · deep shadow',
    env: env({
      keyIntensity: 2.7,
      fillIntensity: 0.12,
      rimIntensity: 1.8,
      ambient: 0.06,
      keyAzimuth: 68,
      keyElevation: 26,
      softness: 0.3,
      temperature: 0.1,
      reflection: 0.9,
      bounce: 0.05,
    }),
    ground: { shadow: true, shadowOpacity: 0.72, shadowBlur: 1.1 },
    sweep: { color: '#0b0c0f', hot: '#2c3444', hotY: 0.42, spread: 0.5, floor: 0.5, vignette: 0.45 },
    camera: { tiltX: -10, tiltY: 34, roll: 0, fov: 30, zoom: 1.5 },
    effects: { bloom: 0.12, vignette: 0.35 },
    grade: { contrast: 1.12 },
  },
  {
    id: 'rim_tech',
    name: 'Rim-Lit Tech',
    recipe: 'Backlit: cool rims carry the edges, key pulled to 0.9',
    env: env({
      keyIntensity: 0.9,
      fillIntensity: 0.25,
      rimIntensity: 2.6,
      ambient: 0.1,
      keyAzimuth: 55,
      keyElevation: 20,
      softness: 0.5,
      temperature: -0.5,
      reflection: 1.5,
      bounce: 0.1,
    }),
    ground: { shadow: true, shadowOpacity: 0.55, shadowBlur: 1.6 },
    sweep: { color: '#0d1117', hot: '#1e2c40', hotY: 0.44, spread: 0.55, floor: 0.45, vignette: 0.4 },
    camera: { tiltX: -6, tiltY: 30, roll: 0, fov: 30, zoom: 1.5 },
    effects: { bloom: 0.25, vignette: 0.28 },
  },
  {
    id: 'window_light',
    name: 'Window Light',
    recipe: 'One big window at 62° · white reflector opposite · warm paper',
    env: env({
      keyIntensity: 2,
      fillIntensity: 0.5,
      rimIntensity: 0.5,
      ambient: 0.4,
      keyAzimuth: 62,
      keyElevation: 24,
      softness: 0.9,
      temperature: 0.45,
      reflection: 0.8,
      bounce: 0.6,
    }),
    ground: { shadow: true, shadowOpacity: 0.42, shadowBlur: 2.2 },
    sweep: { color: '#e7e0d5', hot: '#fff7ea', hotY: 0.36, spread: 0.68, floor: 0.24, vignette: 0.14 },
    camera: { tiltX: -10, tiltY: 24, roll: 0, fov: 32, zoom: 1.42 },
    grade: { temperature: 0.06 },
  },
  {
    id: 'clamshell',
    name: 'Clamshell Beauty',
    recipe: 'Key overhead at 58° · bounce card underneath · even and clean',
    env: env({
      keyIntensity: 2.4,
      fillIntensity: 1,
      rimIntensity: 0.7,
      ambient: 0.55,
      keyAzimuth: 8,
      keyElevation: 58,
      softness: 1,
      reflection: 1.2,
      bounce: 0.95,
    }),
    ground: { shadow: true, shadowOpacity: 0.26, shadowBlur: 2.6 },
    sweep: { color: '#e9ebef', hot: '#ffffff', hotY: 0.42, spread: 0.74, floor: 0.14, vignette: 0.05 },
    camera: { tiltX: -2, tiltY: 8, roll: 0, fov: 24, zoom: 1.38 },
  },
  {
    id: 'editorial_glow',
    name: 'Editorial Glow',
    recipe: 'Warm key against a cool rim · coloured sweep · gentle bloom',
    env: env({
      keyIntensity: 2.2,
      fillIntensity: 0.4,
      rimIntensity: 1.6,
      ambient: 0.2,
      keyAzimuth: 48,
      keyElevation: 30,
      softness: 0.6,
      temperature: 0.6,
      reflection: 1.3,
      bounce: 0.2,
    }),
    ground: { shadow: true, shadowOpacity: 0.6, shadowBlur: 1.8 },
    sweep: { color: '#1a1230', hot: '#ff9d6c', hotY: 0.4, spread: 0.55, floor: 0.42, vignette: 0.34 },
    camera: { tiltX: -12, tiltY: 36, roll: 0, fov: 28, zoom: 1.48 },
    effects: { bloom: 0.3, vignette: 0.3 },
    grade: { saturation: 1.08 },
  },
]

export const DEFAULT_LOOK: StudioLook = STUDIO_LOOKS[0]

export function getLook(id: string): StudioLook | undefined {
  return STUDIO_LOOKS.find((l) => l.id === id)
}

/** Card preview for a look — the sweep it puts behind the product. */
export function lookSwatch(l: StudioLook): string {
  return `radial-gradient(120% 90% at 50% ${l.sweep.hotY * 100}%, ${l.sweep.hot}, ${l.sweep.color} 72%)`
}

/** Paper stocks for the sweep, swapped without touching the lighting. */
export const SWEEP_PAPERS: { name: string; color: string; hot: string }[] = [
  { name: 'White seamless', color: '#f4f5f7', hot: '#ffffff' },
  { name: 'Warm white', color: '#eee7dc', hot: '#fff8ee' },
  { name: 'Studio grey', color: '#33363d', hot: '#7e8593' },
  { name: 'Charcoal', color: '#17191d', hot: '#3c4450' },
  { name: 'Black', color: '#08090b', hot: '#242a34' },
  { name: 'Steel blue', color: '#101a26', hot: '#2f5273' },
  { name: 'Sand', color: '#c9b79c', hot: '#f3e6d2' },
  { name: 'Ink violet', color: '#1a1230', hot: '#ff9d6c' },
]

const KEY_WARM = new THREE.Color('#ffd2a1') // tungsten
const KEY_COOL = new THREE.Color('#cfe0ff') // daylight strobe

/**
 * Key colour for a -1 (cool) … +1 (warm) temperature dial.
 *
 * Lives here rather than in the viewport because the panel needs it too: the
 * lamp colour pickers show what warmth is currently producing, so opening them
 * starts from the colour on screen instead of jumping to white.
 */
export function keyColor(t: number) {
  const c = new THREE.Color('#ffffff')
  return t >= 0 ? c.lerp(KEY_WARM, t) : c.lerp(KEY_COOL, -t)
}
