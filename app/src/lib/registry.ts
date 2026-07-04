// Device registry — source of truth for every device (PRD §9).
export type DeviceKind =
  | 'phone'
  | 'tablet'
  | 'laptop'
  | 'monitor'
  | 'watch'
  | 'browser'
  | 'card'

export type ScreenMask = 'island' | 'punch' | 'none'

export interface DeviceColor {
  id: string
  name: string
  value: string
}

export interface DeviceSpec {
  id: string
  name: string
  category: 'Phones' | 'Tablets' | 'Laptops' | 'Desktops' | 'Watches' | 'Frames'
  kind: DeviceKind
  /** natural screen aspect (w/h) in default orientation */
  screenAspect: number
  canRotate: boolean
  mask: ScreenMask
  colors: DeviceColor[]
  pro?: boolean
}

const PHONE_COLORS: DeviceColor[] = [
  { id: 'titanium', name: 'Titanium', value: '#c9c4bc' },
  { id: 'black', name: 'Space Black', value: '#3a3a3e' },
  { id: 'silver', name: 'Silver', value: '#dfe0e2' },
  { id: 'blue', name: 'Deep Blue', value: '#3a4a5a' },
  { id: 'gold', name: 'Desert Gold', value: '#e8d9b8' },
]

const METAL_COLORS: DeviceColor[] = [
  { id: 'silver', name: 'Silver', value: '#d7d8da' },
  { id: 'black', name: 'Space Black', value: '#3c3c40' },
  { id: 'starlight', name: 'Starlight', value: '#e9e3d8' },
]

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
    pro: true,
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
    pro: true,
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
    id: 'monitor_studio',
    name: 'Studio Monitor 5K',
    category: 'Desktops',
    kind: 'monitor',
    screenAspect: 16 / 9,
    canRotate: false,
    mask: 'none',
    colors: METAL_COLORS,
    pro: true,
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
]

export function getDevice(id: string): DeviceSpec {
  return DEVICES.find((d) => d.id === id) ?? DEVICES[0]
}

export const DEVICE_CATEGORIES = ['Phones', 'Tablets', 'Laptops', 'Desktops', 'Watches', 'Frames'] as const

/** Effective screen aspect (w/h) for a device instance orientation. */
export function screenAspectFor(spec: DeviceSpec, orientation: 'portrait' | 'landscape'): number {
  if (!spec.canRotate) return spec.screenAspect
  const natural = spec.screenAspect
  const naturalIsPortrait = natural < 1
  const wantPortrait = orientation === 'portrait'
  return naturalIsPortrait === wantPortrait ? natural : 1 / natural
}
