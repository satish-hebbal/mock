/*
 * Real device frames, measured straight off the PNGs in `public/bezzles`.
 *
 * Each frame is authored at 1pt = 1px with the screen punched out as a fully
 * transparent, antialiased rounded rect, and the Dynamic Island / camera left
 * as opaque pixels floating inside that hole. Two useful things follow:
 *
 *   1. `screen.w` x `screen.h` IS the device's logical resolution, so the
 *      picker can label a frame without a second source of truth.
 *   2. Drawing the frame *over* the screenshot gets the island and camera for
 *      free — they're opaque pixels sitting inside the cutout.
 *
 * The screenshot must still be clipped to `radius` before the frame goes on.
 * It's tempting to skip that and let the PNG mask it, but the corners of the
 * screen's bounding box fall *outside* the device silhouette (the body is
 * rounded far more generously than the screen), so an unclipped rect leaks its
 * square corners past the frame and onto the background.
 *
 * Geometry is in the PNG's own pixels; `computeLayout` scales it to the canvas.
 * Adding a device is one row here plus the PNG — nothing else needs to change.
 */

export type BezelCategory = 'phone' | 'tablet'

export interface Bezel {
  id: string
  label: string
  category: BezelCategory
  /** public URL of the frame PNG (the screen area is a transparent cutout) */
  src: string
  /** natural size of the PNG, in px */
  frame: { w: number; h: number }
  /** screen cutout within the PNG, in the PNG's own px — also the logical resolution */
  screen: { x: number; y: number; w: number; h: number }
  /** screen corner radius in PNG px — the screenshot is clipped to this */
  radius: number
}

export const BEZELS: Bezel[] = [
  {
    id: 'iphone-17-pro-max',
    label: 'iPhone 17 Pro Max',
    category: 'phone',
    src: '/bezzles/iPhone%2017%20Pro%20Max.png',
    frame: { w: 490, h: 1000 },
    screen: { x: 25, y: 22, w: 440, h: 956 },
    radius: 64,
  },
  {
    id: 'iphone-17-pro',
    label: 'iPhone 17 Pro',
    category: 'phone',
    src: '/bezzles/iPhone%2017%20Pro.png',
    frame: { w: 450, h: 920 },
    screen: { x: 24, y: 23, w: 402, h: 874 },
    radius: 62,
  },
  {
    id: 'iphone-17',
    label: 'iPhone 17',
    category: 'phone',
    src: '/bezzles/iPhone%2017.png',
    frame: { w: 450, h: 920 },
    screen: { x: 24, y: 23, w: 402, h: 874 },
    radius: 62,
  },
  {
    id: 'iphone-air',
    label: 'iPhone Air',
    category: 'phone',
    src: '/bezzles/iPhone%20Air.png',
    frame: { w: 460, h: 960 },
    screen: { x: 20, y: 24, w: 420, h: 912 },
    radius: 62,
  },
  {
    id: 'iphone-16-pro-max',
    label: 'iPhone 16 Pro Max',
    category: 'phone',
    src: '/bezzles/iPhone%2016%20Pro%20Max.png',
    frame: { w: 489, h: 1000 },
    screen: { x: 24, y: 22, w: 440, h: 956 },
    radius: 62,
  },
  {
    id: 'iphone-16-pro',
    label: 'iPhone 16 Pro',
    category: 'phone',
    src: '/bezzles/iPhone%2016%20Pro.png',
    frame: { w: 450, h: 920 },
    screen: { x: 24, y: 23, w: 402, h: 874 },
    radius: 62,
  },
  {
    id: 'iphone-16-plus',
    label: 'iPhone 16 Plus',
    category: 'phone',
    src: '/bezzles/iPhone%2016%20Plus.png',
    frame: { w: 490, h: 990 },
    screen: { x: 30, y: 29, w: 430, h: 932 },
    radius: 55,
  },
  {
    id: 'iphone-16',
    label: 'iPhone 16',
    category: 'phone',
    src: '/bezzles/iPhone%2016.png',
    frame: { w: 453, h: 912 },
    screen: { x: 30, y: 30, w: 393, h: 852 },
    radius: 54,
  },
  {
    id: 'ipad-pro-13',
    label: 'iPad Pro 13"',
    category: 'tablet',
    src: '/bezzles/iPad%20Pro%20M4%2013_.png',
    frame: { w: 1500, h: 1150 },
    screen: { x: 62, y: 59, w: 1376, h: 1032 },
    radius: 26,
  },
]

const BY_ID = new Map(BEZELS.map((b) => [b.id, b]))

export function getBezel(id: string): Bezel | null {
  return BY_ID.get(id) ?? null
}

/** Aspect of the whole device frame (what gets fitted into the padded canvas). */
export function bezelAspect(b: Bezel): number {
  return b.frame.w / b.frame.h
}

// ————— image cache —————
//
// The preview hands the URL to an <img> and lets the browser cache it; the
// exporter needs a decoded element it can drawImage(), so it goes through here.

const decoded = new Map<string, HTMLImageElement>()
const pending = new Map<string, Promise<HTMLImageElement>>()

export function loadBezelImage(b: Bezel): Promise<HTMLImageElement> {
  const hit = decoded.get(b.id)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(b.id)
  if (inflight) return inflight
  const p = (async () => {
    const img = new Image()
    img.src = b.src
    await img.decode()
    decoded.set(b.id, img)
    pending.delete(b.id)
    return img
  })()
  pending.set(b.id, p)
  return p
}
