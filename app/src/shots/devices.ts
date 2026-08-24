import { BEZELS, getBezel, type Bezel, type BezelCategory } from './bezels'
import type { ShotsFrame } from './types'

/*
 * The Shots device catalog. "Screenshot" (a bare capture with its own corner
 * radius) plus one entry per real frame in `bezels.ts`: there are no drawn
 * bezels any more, so the picker, the preview and the exporter all read the
 * same measured geometry and can't drift apart.
 *
 * Window chrome (a browser, a macOS window) is in the same list. It is the
 * enclosure a desktop capture wears, so it belongs where you pick an enclosure,
 * not in a control of its own.
 */

/** `'none'` for a bare screenshot, otherwise a `Bezel.id` or a `ShotsFrame`. */
export type ShotsDeviceId = string

export type DeviceCategory = 'none' | BezelCategory | 'window'

export const NO_DEVICE = 'none'

export interface DeviceSpec {
  id: ShotsDeviceId
  label: string
  category: DeviceCategory
  /** the frame asset, or null for a bare screenshot */
  bezel: Bezel | null
  /** screen size in logical points, the frame's cutout, or null when bare */
  screen: { w: number; h: number } | null
  /**
   * Window chrome this entry wears in place of a bezel. A screen has one
   * enclosure or none, so a device and a chrome are alternatives in one list
   * rather than two settings that can contradict each other.
   */
  chrome: ShotsFrame
}

const BARE: DeviceSpec = {
  id: NO_DEVICE,
  label: 'Screenshot',
  category: 'none',
  bezel: null,
  screen: null,
  chrome: 'none',
}

/*
 * The window entries. These used to be a "Scene" control on the Frame tab,
 * which had two problems: it let you draw a macOS title bar inside an iPhone,
 * and it split one decision ("what is this screenshot sitting in?") across two
 * tabs. Picking a window here clears the bezel and picking a phone clears the
 * chrome, so the contradiction can't be expressed any more.
 *
 * No `screen`: a window has no fixed resolution. It takes the shape of whatever
 * was captured, so the picker says that instead of quoting numbers.
 */
const WINDOW_CHROME: [ShotsFrame, string][] = [
  ['browser-light', 'Browser'],
  ['browser-dark', 'Browser Dark'],
  ['macos-light', 'macOS Window'],
  ['macos-dark', 'macOS Window Dark'],
]

const WINDOWS: DeviceSpec[] = WINDOW_CHROME.map(([chrome, label]) => ({
  id: chrome,
  label,
  category: 'window' as DeviceCategory,
  bezel: null,
  screen: null,
  chrome,
}))

const HARDWARE: DeviceSpec[] = BEZELS.map((b) => ({
  id: b.id,
  label: b.label,
  category: b.category as DeviceCategory,
  bezel: b,
  screen: { w: b.screen.w, h: b.screen.h },
  chrome: 'none' as ShotsFrame,
}))

/*
 * Order is priority, and the bare screenshot leads: it's the plainest choice
 * and the one that needs no picking at all, so it sits first rather than
 * making everyone scroll past every phone and window style to reach "just my
 * screenshot, no frame". Real hardware follows (phones, then tablets, in the
 * order `bezels.ts` lists them), then window chrome. The "All" tab renders
 * this list verbatim, so the array is the hierarchy.
 */
export const DEVICES: DeviceSpec[] = [BARE, ...HARDWARE, ...WINDOWS]

const BY_ID = new Map(DEVICES.map((d) => [d.id, d]))

export function getShotsDevice(id: ShotsDeviceId): DeviceSpec {
  return BY_ID.get(id) ?? BARE
}

/** The frame asset for a screen, or null when it should render bare. */
export function bezelFor(id: ShotsDeviceId): Bezel | null {
  return id === NO_DEVICE ? null : getBezel(id)
}

/**
 * The catalog entry a screen is currently wearing.
 *
 * `device` and `frame` stay separate fields on the document, because the
 * renderer treats them differently: one is a PNG laid over the screen, the
 * other is chrome drawn above it. The picker offers them as a single choice, so
 * it needs to read the pair back as one entry. Chrome wins when a document
 * saved by an older build carries both.
 */
export function deviceEntryFor(device: ShotsDeviceId, frame: ShotsFrame): DeviceSpec {
  if (frame !== 'none') return DEVICES.find((d) => d.chrome === frame) ?? BARE
  return getShotsDevice(device)
}

/** The `{ device, frame }` pair that puts a screen in this catalog entry. */
export function devicePatchFor(d: DeviceSpec): { device: ShotsDeviceId; frame: ShotsFrame } {
  return { device: d.bezel ? d.id : NO_DEVICE, frame: d.chrome }
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
