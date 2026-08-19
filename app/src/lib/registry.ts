import deviceModels from './deviceModels.json'
import type { DeviceInstance } from '../types'

// Device registry — source of truth for every device (PRD §9).
export type DeviceKind =
  | 'phone'
  | 'tablet'
  | 'laptop'
  | 'monitor'
  | 'tv'
  | 'watch'
  | 'browser'
  | 'card'

export type ScreenMask = 'island' | 'punch' | 'none'

export interface DeviceColor {
  id: string
  name: string
  value: string
  /** the model's own finish: picked means "don't tint at all" */
  stock?: boolean
}

/** A real 3D model backing a device, instead of the procedural slab meshes. */
export interface DeviceModel {
  /** path under /public, served as a static asset and lazy-loaded on demand */
  url: string
  /**
   * Mesh/node name of the display surface. The screenshot is mapped onto this
   * mesh; every other mesh keeps the model's own materials.
   */
  screenMesh: string
  /** target on-screen HEIGHT of the display, in scene units */
  fitHeight: number
  /**
   * Extra rotation in degrees, applied after auto-orientation. Escape hatch for
   * models whose geometry defeats the automatic normal detection (e.g. a laptop
   * whose lid and base are separate sub-scenes).
   */
  rotationEuler?: [number, number, number]
}

export interface DeviceSpec {
  id: string
  name: string
  category: 'Phones' | 'Tablets' | 'Laptops' | 'Desktops' | 'TV' | 'Watches' | 'Frames'
  kind: DeviceKind
  /** natural screen aspect (w/h) in default orientation */
  screenAspect: number
  canRotate: boolean
  mask: ScreenMask
  colors: DeviceColor[]
  /** present → render the real GLB instead of the procedural body */
  model?: DeviceModel
}

const PHONE_COLORS: DeviceColor[] = [
  { id: 'titanium', name: 'Titanium', value: '#c9c4bc' },
  { id: 'black', name: 'Space Black', value: '#3a3a3e' },
  { id: 'silver', name: 'Silver', value: '#dfe0e2' },
  { id: 'blue', name: 'Deep Blue', value: '#3a4a5a' },
  { id: 'gold', name: 'Desert Gold', value: '#e8d9b8' },
]

/*
 * Finishes offered for the .glb devices. Unlike the procedural slabs, where the
 * swatch IS the body colour, these are targets the model gets retinted toward
 * (see lib/retint.ts) so the value here is the finish you're aiming at rather
 * than a literal fill. "Stock" leaves the model exactly as its author shipped
 * it, and stays first because it's the one nobody should have to hunt for.
 */
const BODY_COLORS: DeviceColor[] = [
  { id: 'stock', name: 'As modelled', value: '#3a3a3e', stock: true },
  { id: 'graphite', name: 'Graphite', value: '#4a4a4f' },
  { id: 'silver', name: 'Silver', value: '#d8dade' },
  { id: 'gold', name: 'Desert Gold', value: '#d9c39a' },
  { id: 'teal', name: 'Teal', value: '#4d8f8d' },
  { id: 'blue', name: 'Deep Blue', value: '#3f5c85' },
  { id: 'purple', name: 'Deep Purple', value: '#6a5a86' },
  { id: 'orange', name: 'Cosmic Orange', value: '#d1662f' },
  { id: 'red', name: 'Red', value: '#b23b3b' },
]

const METAL_COLORS: DeviceColor[] = [
  { id: 'silver', name: 'Silver', value: '#d7d8da' },
  { id: 'black', name: 'Space Black', value: '#3c3c40' },
  { id: 'starlight', name: 'Starlight', value: '#e9e3d8' },
]

/**
 * Devices backed by real .glb models. Generated from the shared manifest so the
 * asset pipeline (scripts/optimize-models.mjs) and the app can never disagree
 * about which mesh is the display.
 */
const CATEGORY_FOR: Record<string, DeviceSpec['category']> = {
  phone: 'Phones',
  tablet: 'Tablets',
  laptop: 'Laptops',
  desktop: 'Desktops',
  watch: 'Watches',
}

const MODEL_DEVICES: DeviceSpec[] = deviceModels.models
  // Only ship models whose screen mesh has been confirmed by rendering — an
  // unverified one shows the screenshot on the wrong face (or not at all).
  .filter((m) => m.verified)
  .map((m) => ({
  id: m.id,
  name: m.name,
  category: CATEGORY_FOR[m.kind] ?? 'Frames',
  kind: m.kind as DeviceKind,
  screenAspect: m.screenAspect,
  canRotate: m.kind !== 'laptop',
  mask: 'none', // the model geometry already has its own notch/punch-hole
  colors: BODY_COLORS,
  model: {
    url: `/models/optimized/${m.file}`,
    screenMesh: m.screenMesh,
    fitHeight: m.fitHeight,
    rotationEuler: (m as { rotationEuler?: [number, number, number] }).rotationEuler,
  },
  }))

export const DEVICES: DeviceSpec[] = [
  {
    id: 'phone_pro',
    name: 'Pro Phone 6.9″',
    category: 'Phones',
    kind: 'phone',
    screenAspect: 1290 / 2796,
    canRotate: true,
    mask: 'island',
    colors: PHONE_COLORS,
  },
  {
    id: 'phone_air',
    name: 'Slim Phone (Air)',
    category: 'Phones',
    kind: 'phone',
    screenAspect: 1179 / 2556,
    canRotate: true,
    mask: 'island',
    colors: PHONE_COLORS,
  },
  {
    id: 'phone_pro_prev',
    name: 'Pro Phone (prev-gen)',
    category: 'Phones',
    kind: 'phone',
    screenAspect: 1179 / 2556,
    canRotate: true,
    mask: 'island',
    colors: PHONE_COLORS,
  },
  {
    id: 'phone_android',
    name: 'Android Flagship',
    category: 'Phones',
    kind: 'phone',
    screenAspect: 1080 / 2400,
    canRotate: true,
    mask: 'punch',
    colors: PHONE_COLORS,
  },
  {
    id: 'phone_pixel',
    name: 'Pixel Phone',
    category: 'Phones',
    kind: 'phone',
    screenAspect: 1080 / 2424,
    canRotate: true,
    mask: 'punch',
    colors: PHONE_COLORS,
  },
  {
    id: 'phone_classic',
    name: 'Classic Phone (16:9)',
    category: 'Phones',
    kind: 'phone',
    screenAspect: 9 / 16,
    canRotate: true,
    mask: 'none',
    colors: PHONE_COLORS,
  },
  {
    id: 'tablet_pro',
    name: 'Pro Tablet 13″',
    category: 'Tablets',
    kind: 'tablet',
    screenAspect: 3 / 4,
    canRotate: true,
    mask: 'none',
    colors: METAL_COLORS,
  },
  {
    id: 'tablet_mini',
    name: 'Mini Tablet',
    category: 'Tablets',
    kind: 'tablet',
    screenAspect: 1488 / 2266,
    canRotate: true,
    mask: 'none',
    colors: METAL_COLORS,
  },
  {
    id: 'tablet_android',
    name: 'Android Tablet',
    category: 'Tablets',
    kind: 'tablet',
    screenAspect: 1600 / 2560,
    canRotate: true,
    mask: 'none',
    colors: METAL_COLORS,
  },
  {
    id: 'laptop_pro',
    name: 'Pro Laptop 16″',
    category: 'Laptops',
    kind: 'laptop',
    screenAspect: 3456 / 2234,
    canRotate: false,
    mask: 'none',
    colors: METAL_COLORS,
  },
  {
    id: 'laptop_air',
    name: 'Air Laptop 13″',
    category: 'Laptops',
    kind: 'laptop',
    screenAspect: 2560 / 1664,
    canRotate: false,
    mask: 'none',
    colors: METAL_COLORS,
  },
  {
    id: 'laptop_windows',
    name: 'Windows Laptop',
    category: 'Laptops',
    kind: 'laptop',
    screenAspect: 16 / 10,
    canRotate: false,
    mask: 'none',
    colors: [
      { id: 'graphite', name: 'Graphite', value: '#4a4a50' },
      { id: 'silver', name: 'Silver', value: '#c8cace' },
    ],
  },
  {
    id: 'imac',
    name: 'iMac 24″',
    category: 'Desktops',
    kind: 'monitor',
    screenAspect: 4480 / 2520,
    canRotate: false,
    mask: 'none',
    colors: [
      { id: 'silver', name: 'Silver', value: '#d7d8da' },
      { id: 'blue', name: 'Blue', value: '#6c8fb8' },
      { id: 'green', name: 'Green', value: '#7fae8f' },
      { id: 'pink', name: 'Pink', value: '#e0a3ad' },
    ],
  },
  {
    id: 'monitor_studio',
    name: 'Studio Monitor 5K',
    category: 'Desktops',
    kind: 'monitor',
    screenAspect: 16 / 9,
    canRotate: false,
    mask: 'none',
    colors: METAL_COLORS,
  },
  {
    id: 'monitor_generic',
    name: 'Generic Monitor',
    category: 'Desktops',
    kind: 'monitor',
    screenAspect: 16 / 9,
    canRotate: false,
    mask: 'none',
    colors: [{ id: 'black', name: 'Black', value: '#26262a' }],
  },
  {
    id: 'tv_4k',
    name: '4K TV 16:9',
    category: 'TV',
    kind: 'tv',
    screenAspect: 16 / 9,
    canRotate: false,
    mask: 'none',
    colors: [{ id: 'black', name: 'Black', value: '#141416' }],
  },
  {
    id: 'watch_pro',
    name: 'Smart Watch',
    category: 'Watches',
    kind: 'watch',
    screenAspect: 396 / 484,
    canRotate: false,
    mask: 'none',
    colors: METAL_COLORS,
  },
  {
    id: 'watch_wear',
    name: 'Wear Watch (round)',
    category: 'Watches',
    kind: 'watch',
    screenAspect: 1 / 1,
    canRotate: false,
    mask: 'none',
    colors: [
      { id: 'black', name: 'Black', value: '#2a2a2e' },
      { id: 'steel', name: 'Steel', value: '#c4c6ca' },
    ],
  },
  {
    id: 'browser_light',
    name: 'Browser — Light',
    category: 'Frames',
    kind: 'browser',
    screenAspect: 16 / 10,
    canRotate: false,
    mask: 'none',
    colors: [{ id: 'light', name: 'Light', value: '#f2f2f5' }],
  },
  {
    id: 'browser_dark',
    name: 'Browser — Dark',
    category: 'Frames',
    kind: 'browser',
    screenAspect: 16 / 10,
    canRotate: false,
    mask: 'none',
    colors: [{ id: 'dark', name: 'Dark', value: '#28282d' }],
  },
  {
    id: 'card_flat',
    name: 'Screen Card (flat)',
    category: 'Frames',
    kind: 'card',
    screenAspect: 16 / 10,
    canRotate: true,
    mask: 'none',
    colors: [{ id: 'none', name: 'None', value: '#000000' }],
  },
  ...MODEL_DEVICES,
]

/**
 * What the picker offers: real .glb models only. The procedural slab bodies
 * stay in DEVICES so projects saved against them still resolve and render —
 * they're just not something you can reach for any more. Verify another model
 * in deviceModels.json and it shows up here on its own.
 */
export const PICKABLE_DEVICES: DeviceSpec[] = DEVICES.filter((d) => d.model)

export function isPickable(id: string): boolean {
  return PICKABLE_DEVICES.some((d) => d.id === id)
}

/** The device new projects start on, and the fallback for unknown ids. */
const DEFAULT_DEVICE: DeviceSpec =
  PICKABLE_DEVICES.find((d) => d.id === 'iphone_17_pro_max') ?? PICKABLE_DEVICES[0] ?? DEVICES[0]

export const DEFAULT_DEVICE_ID = DEFAULT_DEVICE.id

/**
 * The body colour for an instance, or null to leave the model as authored.
 *
 * Both render paths go through here so a custom hex behaves identically on a
 * procedural slab and on a retinted .glb, and so an unknown variant id from an
 * older save falls back to stock instead of rendering an off-white default.
 */
export function resolveDeviceColor(spec: DeviceSpec, device: DeviceInstance): string | null {
  if (device.colorVariant === 'custom') return device.customColor ?? null
  const found = spec.colors.find((c) => c.id === device.colorVariant)
  if (!found) return spec.colors[0]?.stock ? null : (spec.colors[0]?.value ?? null)
  return found.stock ? null : found.value
}

export function getDevice(id: string): DeviceSpec {
  return DEVICES.find((d) => d.id === id) ?? DEFAULT_DEVICE
}

export const DEVICE_CATEGORIES = ['Phones', 'Tablets', 'Laptops', 'Desktops', 'TV', 'Watches', 'Frames'] as const

/** Effective screen aspect (w/h) for a device instance orientation. */
export function screenAspectFor(spec: DeviceSpec, orientation: 'portrait' | 'landscape'): number {
  if (!spec.canRotate) return spec.screenAspect
  const natural = spec.screenAspect
  const naturalIsPortrait = natural < 1
  const wantPortrait = orientation === 'portrait'
  return naturalIsPortrait === wantPortrait ? natural : 1 / natural
}
