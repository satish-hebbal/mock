// ————— Device frame catalog (temporary bezel placeholders) —————
//
// Each device is modeled as a uniform bezel border around the screenshot so the
// CSS preview (ShotsCanvas) and the canvas exporter (render.ts) stay in perfect
// sync. All metrics are fractions of the *screen width* so a device scales with
// the shot. Swap these for realistic PNG/SVG assets later without touching the
// layout math — just keep `bezel`, `outerRadius`, `screenRadius`.

export type ShotsDeviceId =
  | 'none'
  | 'iphone'
  | 'android'
  | 'ipad'
  | 'macbook'
  | 'imac'
  | 'watch'

export type DeviceCategory = 'none' | 'phone' | 'tablet' | 'laptop' | 'desktop' | 'watch'

export type DeviceNotch = 'none' | 'island' | 'punch' | 'camera'

export interface DeviceSpec {
  id: ShotsDeviceId
  label: string
  category: DeviceCategory
  /** bezel thickness on every side, as a fraction of the screen width */
  bezel: number
  /** outer (device) corner radius, as a fraction of the outer width */
  outerRadius: number
  /** screen corner radius, as a fraction of the screen width */
  screenRadius: number
  /** front camera / cutout style drawn over the top of the screen */
  notch: DeviceNotch
  /** bezel fill color */
  color: string
  /** subtle inner edge highlight color (rim light on the bezel) */
  edge: string
  /**
   * Nominal screen size in logical points. Display metadata for the picker
   * (label + preview proportions) — the layout still fits the *screenshot's*
   * own aspect, so this never changes how a shot is composed.
   */
  screen?: { w: number; h: number }
}

export const DEVICES: DeviceSpec[] = [
  {
    id: 'none',
    label: 'No device',
    category: 'none',
    bezel: 0,
    outerRadius: 0,
    screenRadius: 0,
    notch: 'none',
    color: '#000000',
    edge: 'transparent',
  },
  {
    id: 'iphone',
    label: 'iPhone',
    category: 'phone',
    bezel: 0.035,
    outerRadius: 0.16,
    screenRadius: 0.11,
    notch: 'island',
    color: '#0b0b0f',
    edge: '#3a3a42',
    screen: { w: 430, h: 932 },
  },
  {
    id: 'android',
    label: 'Android',
    category: 'phone',
    bezel: 0.028,
    outerRadius: 0.13,
    screenRadius: 0.1,
    notch: 'punch',
    color: '#111114',
    edge: '#33343a',
    screen: { w: 412, h: 915 },
  },
  {
    id: 'ipad',
    label: 'Tablet',
    category: 'tablet',
    bezel: 0.03,
    outerRadius: 0.055,
    screenRadius: 0.028,
    notch: 'camera',
    color: '#101014',
    edge: '#35363c',
    screen: { w: 1024, h: 1366 },
  },
  {
    id: 'macbook',
    label: 'Laptop',
    category: 'laptop',
    bezel: 0.022,
    outerRadius: 0.03,
    screenRadius: 0.012,
    notch: 'camera',
    color: '#1b1c20',
    edge: '#3d3e44',
    screen: { w: 1512, h: 982 },
  },
  {
    id: 'imac',
    label: 'Desktop',
    category: 'desktop',
    bezel: 0.02,
    outerRadius: 0.02,
    screenRadius: 0.008,
    notch: 'camera',
    color: '#1e1f24',
    edge: '#43444a',
    screen: { w: 2240, h: 1260 },
  },
  {
    id: 'watch',
    label: 'Watch',
    category: 'watch',
    bezel: 0.055,
    outerRadius: 0.28,
    screenRadius: 0.2,
    notch: 'none',
    color: '#0a0a0d',
    edge: '#3a3a42',
    screen: { w: 410, h: 502 },
  },
]

const DEVICE_MAP = new Map(DEVICES.map((d) => [d.id, d]))

export function getShotsDevice(id: ShotsDeviceId): DeviceSpec {
  return DEVICE_MAP.get(id) ?? DEVICES[0]
}
