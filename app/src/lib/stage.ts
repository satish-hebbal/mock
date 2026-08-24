import { BASE_DIST } from './runtime'
import { dimsFor } from './dims'
import { getDevice } from './registry'
import { CAMERA_LIMITS } from './camera'
import type { CameraState, DeviceInstance } from '../types'

/*
 * The maths behind the camera stage: a little schematic of the set, drawn from
 * outside it, showing where the lens is standing relative to the product.
 *
 * Deliberately not a second WebGL canvas. Everything the stage has to draw is
 * a dozen boxes and a frustum (a few hundred line segments) and a second GL
 * context next to the live viewport would cost a whole extra renderer, render
 * targets and frame loop to draw them. Projecting the points here and handing
 * an SVG the results costs one render pass of React per pointer move, stays
 * crisp at any pixel ratio, and takes its colours from the app's own theme.
 *
 * The projection is orthographic on purpose. This is a plan of the set, not a
 * photograph of it: parallel edges stay parallel, so distances read honestly
 * and a device six units back doesn't shrink into ambiguity.
 */

export interface Vec {
  x: number
  y: number
  z: number
}

/** Where the *stage* is observed from. Nothing to do with the scene camera. */
export interface StageView {
  /** degrees about world Y; 0 looks along -Z, the way the scene camera does at tiltY 0 */
  yaw: number
  /** degrees above the horizon; 90 is straight down */
  pitch: number
}

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

const v = (x: number, y: number, z: number): Vec => ({ x, y, z })
const sub = (a: Vec, b: Vec): Vec => v(a.x - b.x, a.y - b.y, a.z - b.z)
const add = (a: Vec, b: Vec): Vec => v(a.x + b.x, a.y + b.y, a.z + b.z)
const scale = (a: Vec, k: number): Vec => v(a.x * k, a.y * k, a.z * k)
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z
const len = (a: Vec) => Math.sqrt(dot(a, a))
const norm = (a: Vec): Vec => {
  const l = len(a) || 1
  return scale(a, 1 / l)
}
const cross = (a: Vec, b: Vec): Vec =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)

/** Rodrigues: rotate `p` about the unit axis `n` by `deg`. */
function rotateAbout(p: Vec, n: Vec, deg: number): Vec {
  const a = deg * D2R
  const c = Math.cos(a)
  const s = Math.sin(a)
  return add(add(scale(p, c), scale(cross(n, p), s)), scale(n, dot(n, p) * (1 - c)))
}

// ----- the stage's own projection -----

/** World → view space. The observer looks down -Z from +Z, so bigger z is nearer. */
export function toView(p: Vec, view: StageView): Vec {
  const y = view.yaw * D2R
  const t = view.pitch * D2R
  // yaw first (about world Y), then pitch (about the resulting X)
  const x1 = p.x * Math.cos(y) - p.z * Math.sin(y)
  const z1 = p.x * Math.sin(y) + p.z * Math.cos(y)
  return v(x1, p.y * Math.cos(t) - z1 * Math.sin(t), p.y * Math.sin(t) + z1 * Math.cos(t))
}

/** View → world. The exact inverse of `toView`, used to turn a drag into a ray. */
export function toWorld(p: Vec, view: StageView): Vec {
  const y = view.yaw * D2R
  const t = view.pitch * D2R
  const y1 = p.y * Math.cos(t) + p.z * Math.sin(t)
  const z1 = -p.y * Math.sin(t) + p.z * Math.cos(t)
  return v(p.x * Math.cos(y) + z1 * Math.sin(y), y1, -p.x * Math.sin(y) + z1 * Math.cos(y))
}

export interface Projector {
  /** world point → svg pixels, plus a depth for painter-order sorting */
  (p: Vec): { x: number; y: number; depth: number }
}

export interface Stage {
  project: Projector
  /** svg pixels per world unit */
  ppu: number
  /** what the widget is centred on, in world space */
  center: Vec
}

export function makeStage(
  view: StageView,
  center: Vec,
  radius: number,
  width: number,
  height: number,
  pad: number,
): Stage {
  const ppu = (Math.min(width, height) / 2 - pad) / Math.max(0.6, radius)
  const project: Projector = (p) => {
    const vw = toView(sub(p, center), view)
    return { x: width / 2 + vw.x * ppu, y: height / 2 - vw.y * ppu, depth: vw.z }
  }
  return { project, ppu, center }
}

/** The world-space ray under a pointer, for an orthographic observer. */
export function rayAt(stage: Stage, view: StageView, sx: number, sy: number, width: number, height: number) {
  const vx = (sx - width / 2) / stage.ppu
  const vy = (height / 2 - sy) / stage.ppu
  // start far enough back that the whole set is in front of the ray
  const origin = add(stage.center, toWorld(v(vx, vy, 1000), view))
  return { origin, dir: toWorld(v(0, 0, -1), view) }
}

/**
 * Where a ray meets the sphere the camera orbits on.
 *
 * A miss is common and completely normal (you drag past the silhouette all
 * the time) so instead of failing it falls back to the point on the sphere
 * nearest the ray. The camera then slides around the limb rather than sticking,
 * which is what makes a grazing drag still feel connected to the pointer.
 *
 * Of the two real roots it keeps whichever is nearer the camera's current
 * position, so a drag never teleports the lens through the subject to the
 * hemisphere behind.
 */
export function raySphere(origin: Vec, dir: Vec, centre: Vec, radius: number, near: Vec): Vec {
  const oc = sub(origin, centre)
  const b = dot(oc, dir)
  const c = dot(oc, oc) - radius * radius
  const disc = b * b - c
  if (disc <= 0) {
    const closest = add(origin, scale(dir, -b))
    return add(centre, scale(norm(sub(closest, centre)), radius))
  }
  const root = Math.sqrt(disc)
  const a = add(origin, scale(dir, -b - root))
  const z = add(origin, scale(dir, -b + root))
  return len(sub(a, near)) <= len(sub(z, near)) ? a : z
}

/** Where a ray meets the z = 0 plane the pan target lives on, or null edge-on. */
export function rayPlaneZ0(origin: Vec, dir: Vec): Vec | null {
  if (Math.abs(dir.z) < 1e-4) return null
  return add(origin, scale(dir, -origin.z / dir.z))
}

// ----- the scene camera, as geometry -----

const clampTo = (prop: keyof typeof CAMERA_LIMITS, n: number) => {
  const [min, max] = CAMERA_LIMITS[prop]
  return Math.min(max, Math.max(min, n))
}

export const cameraTarget = (cam: CameraState): Vec => v(cam.panX, cam.panY, 0)

export const cameraDistance = (cam: CameraState) => BASE_DIST / Math.max(0.2, cam.zoom)

/**
 * Where the lens sits, in world space.
 *
 * The same spherical placement `applyAtTime` writes into the three.js camera,
 * repeated here rather than read off the live scene: the stage has to be able
 * to draw a pose the renderer has not applied yet (mid-drag, or with the panel
 * open before the canvas has mounted), and a formula that agrees is simpler
 * than a handle that might be stale.
 */
export function cameraPosition(cam: CameraState): Vec {
  const dist = cameraDistance(cam)
  const phi = Math.min(179, Math.max(1, 90 + cam.tiltX)) * D2R
  const theta = cam.tiltY * D2R
  const t = cameraTarget(cam)
  return v(
    t.x + dist * Math.sin(phi) * Math.sin(theta),
    t.y + dist * Math.cos(phi),
    t.z + dist * Math.sin(phi) * Math.cos(theta),
  )
}

/** Turn a world position back into the tilt pair that would put the lens there. */
export function tiltForPosition(pos: Vec, target: Vec): { tiltX: number; tiltY: number } {
  const d = sub(pos, target)
  const r = len(d) || 1
  const phi = Math.acos(Math.min(1, Math.max(-1, d.y / r))) * R2D
  return {
    tiltX: clampTo('tiltX', phi - 90),
    tiltY: clampTo('tiltY', Math.atan2(d.x, d.z) * R2D),
  }
}

/** The lens basis: where it points, and which way is up through the roll. */
export function cameraBasis(cam: CameraState) {
  const pos = cameraPosition(cam)
  const forward = norm(sub(cameraTarget(cam), pos))
  // straight up the barrel is degenerate for a right vector; the top-down
  // preset sits within a degree of it, so nudge rather than divide by zero
  const worldUp = Math.abs(forward.y) > 0.999 ? v(0, 0, -Math.sign(forward.y)) : v(0, 1, 0)
  let right = norm(cross(forward, worldUp))
  let up = cross(right, forward)
  if (cam.roll !== 0) {
    // three rotates the camera about its own +Z, which points back down the
    // barrel, so a positive roll turns the basis the other way about `forward`
    right = rotateAbout(right, forward, -cam.roll)
    up = rotateAbout(up, forward, -cam.roll)
  }
  return { pos, forward, right, up }
}

/**
 * The four corners of what the lens actually frames, laid on the plane the
 * target sits in.
 *
 * Drawn at the target rather than at some arbitrary throw so the rectangle is
 * literally the crop: whatever falls inside it is in the picture.
 */
export function frustumCorners(cam: CameraState, aspect: number): Vec[] {
  const { pos, forward, right, up } = cameraBasis(cam)
  const dist = cameraDistance(cam)
  const halfH = Math.tan((cam.fov * D2R) / 2) * dist
  const halfW = halfH * aspect
  const middle = add(pos, scale(forward, dist))
  return [
    add(add(middle, scale(right, -halfW)), scale(up, halfH)),
    add(add(middle, scale(right, halfW)), scale(up, halfH)),
    add(add(middle, scale(right, halfW)), scale(up, -halfH)),
    add(add(middle, scale(right, -halfW)), scale(up, -halfH)),
  ]
}

// ----- the subject, as boxes -----

/** One slab of a device: a box in the device's own space. */
export interface ProxyPart {
  /** full extents, not half */
  size: [number, number, number]
  center: [number, number, number]
  /** lean about local X, in radians: the laptop lid */
  tilt?: number
  /** the face carrying the screen, so the schematic shows which way it looks */
  screen?: boolean
}

/**
 * A device reduced to the boxes it occupies.
 *
 * Matched to how `DeviceMesh` lays each kind out, so the schematic agrees with
 * the render about where a laptop's lid is and how far a monitor stands off
 * its base. Stands and watch bands are left out: they say nothing about
 * framing and only clutter a widget this size.
 */
export function deviceProxy(device: DeviceInstance): ProxyPart[] {
  const spec = getDevice(device.modelId)
  const d = dimsFor(spec, device.orientation)
  const body: [number, number, number] = [d.bodyW, d.bodyH, d.bodyD]

  if (spec.kind === 'laptop' && !spec.model) {
    const baseD = 1.95
    return [
      { size: [d.bodyW, d.bodyD, baseD], center: [0, -1.0, 0] },
      {
        size: body,
        center: [0, -0.98 + Math.cos(0.24) * (d.bodyH / 2), -baseD / 2 + 0.06 - Math.sin(0.24) * (d.bodyH / 2)],
        tilt: -0.24,
        screen: true,
      },
    ]
  }
  const lift = spec.kind === 'monitor' ? 0.25 : spec.kind === 'tv' ? 0.35 : 0
  return [{ size: body, center: [0, lift, 0], screen: true }]
}

/** The eight corners of a part, in world space, after the device's transform. */
export function partCorners(part: ProxyPart, device: DeviceInstance): Vec[] {
  const [sx, sy, sz] = part.size
  const out: Vec[] = []
  for (const ix of [-0.5, 0.5])
    for (const iy of [-0.5, 0.5])
      for (const iz of [-0.5, 0.5])
        out.push(v(ix * sx, iy * sy, iz * sz))
  return out.map((p) => partToWorld(p, part, device))
}

/** A point in part space → world, through the part's lean and the device's transform. */
export function partToWorld(p: Vec, part: ProxyPart, device: DeviceInstance): Vec {
  let q = p
  if (part.tilt) {
    const c = Math.cos(part.tilt)
    const s = Math.sin(part.tilt)
    q = v(q.x, q.y * c - q.z * s, q.y * s + q.z * c)
  }
  q = add(q, v(part.center[0], part.center[1], part.center[2]))

  const t = device.transform
  q = scale(q, Math.max(0.05, t.scale))
  const [rx, ry, rz] = t.rotation.map((deg) => deg * D2R)
  // three's default Euler order is XYZ, which composes as Rx·Ry·Rz, so the
  // roll goes on first and the pitch last, not the order they're written in
  q = v(q.x * Math.cos(rz) - q.y * Math.sin(rz), q.x * Math.sin(rz) + q.y * Math.cos(rz), q.z)
  q = v(q.x * Math.cos(ry) + q.z * Math.sin(ry), q.y, -q.x * Math.sin(ry) + q.z * Math.cos(ry))
  q = v(q.x, q.y * Math.cos(rx) - q.z * Math.sin(rx), q.y * Math.sin(rx) + q.z * Math.cos(rx))
  return add(q, v(t.position[0], t.position[1], t.position[2]))
}

/**
 * Apply the scene's own rotation.
 *
 * `rotateX`/`rotateY` turn the whole set under a fixed camera, so a device
 * that has been spun by them is somewhere else relative to the lens and the
 * schematic has to say so.
 */
export function applySceneRotation(p: Vec, rotateX: number, rotateY: number): Vec {
  const rx = rotateX * D2R
  const ry = rotateY * D2R
  const a = v(p.x * Math.cos(ry) + p.z * Math.sin(ry), p.y, -p.x * Math.sin(ry) + p.z * Math.cos(ry))
  return v(a.x, a.y * Math.cos(rx) - a.z * Math.sin(rx), a.y * Math.sin(rx) + a.z * Math.cos(rx))
}

/** The 12 edges of a box, as index pairs into the corner order `partCorners` emits. */
export const BOX_EDGES: [number, number][] = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
]

/** Corner indices of the +Z face, in winding order, the face the screen is on. */
export const SCREEN_FACE = [1, 3, 7, 5]

export { add, sub, scale, len, norm, v as vec }
