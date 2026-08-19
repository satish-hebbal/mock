import { BEZELS, getBezel, type Bezel, type BezelCategory } from './bezels'

/*
 * The Shots device catalog. "No device" (a bare screenshot with its own corner
 * radius) plus one entry per real frame in `bezels.ts` — there are no drawn
 * bezels any more, so the picker, the preview and the exporter all read the
 * same measured geometry and can't drift apart.
 */

/** `'none'` for a bare screenshot, otherwise a `Bezel.id`. */
export type ShotsDeviceId = string

export type DeviceCategory = 'none' | BezelCategory

export const NO_DEVICE = 'none'

export interface DeviceSpec {
  id: ShotsDeviceId
  label: string
  category: DeviceCategory
  /** the frame asset, or null for a bare screenshot */
  bezel: Bezel | null
  /** screen size in logical points — the frame's cutout, or null when bare */
  screen: { w: number; h: number } | null
}

const BARE: DeviceSpec = {
  id: NO_DEVICE,
  label: 'No device',
  category: 'none',
  bezel: null,
  screen: null,
}

export const DEVICES: DeviceSpec[] = [
  BARE,
  ...BEZELS.map((b) => ({
    id: b.id,
    label: b.label,
    category: b.category as DeviceCategory,
    bezel: b,
    screen: { w: b.screen.w, h: b.screen.h },
  })),
]

const BY_ID = new Map(DEVICES.map((d) => [d.id, d]))

export function getShotsDevice(id: ShotsDeviceId): DeviceSpec {
  return BY_ID.get(id) ?? BARE
}

/** The frame asset for a screen, or null when it should render bare. */
export function bezelFor(id: ShotsDeviceId): Bezel | null {
  return id === NO_DEVICE ? null : getBezel(id)
}

/**
 * Docs saved against the old placeholder catalog ('iphone', 'android', …).
 * Phones and tablets map onto the closest real frame; the drawn laptop, desktop
 * and watch had no equivalent asset, so those fall back to a bare screenshot
 * rather than silently becoming a phone.
 */
const LEGACY: Record<string, ShotsDeviceId> = {
  iphone: 'iphone-16-plus', // the old placeholder was 430×932
  android: 'iphone-16',
  ipad: 'ipad-pro-13',
  macbook: NO_DEVICE,
  imac: NO_DEVICE,
  watch: NO_DEVICE,
}

/** Normalize a persisted device id to one this build can render. */
export function migrateDeviceId(id: string | undefined): ShotsDeviceId {
  if (!id) return NO_DEVICE
  if (BY_ID.has(id)) return id
  return LEGACY[id] ?? NO_DEVICE
}
