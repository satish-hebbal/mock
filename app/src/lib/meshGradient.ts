/*
 * Mesh gradient backgrounds.
 *
 * The shape is the one mesh-gradient tools converge on (mshr.app among them):
 * a flat base colour with a handful of radial blobs laid over it, each pinned
 * to a point in the frame and fading to nothing over its own radius.
 *
 *   background-color: <base>
 *   background-image:
 *     radial-gradient(circle at 4% 96%, <color> 0%, transparent 67%),
 *     radial-gradient(circle at 92% 8%,  <color> 0%, transparent 150%), …
 *
 * Two details do most of the work, and the earlier version had neither. Blobs
 * are pinned near the *edges and corners*, so the picture reads as light
 * coming into the frame rather than as circles floating in the middle of it;
 * and each carries its own reach, so a wide wash and a tight highlight can sit
 * in the same image. A deep, nearly black colour thrown in at a large radius
 * is what gives these their depth.
 *
 * One definition drives both renderers: CSS for every preview, canvas for the
 * export, computed from the same numbers so the two cannot drift.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One radial blob: where it sits, what colour, and how far it reaches. */
export interface MeshStop {
  /** position in the frame, 0..1 */
  x: number
  y: number
  /** solid hex, `#rrggbb` */
  color: string
  /**
   * Reach, as a fraction of the distance from this blob to the frame's
   * farthest corner. That is what a CSS percentage stop means on a
   * `circle at x% y%`, so the canvas can match it exactly. Above 1 is
   * allowed and useful: it makes a blob that never fully fades inside
   * the frame, which is how the darkest colour usually behaves.
   */
  spread: number
}

export interface MeshSpec {
  /** re-scatters a generated mesh */
  seed: number
  /** the colours a generated mesh is built from */
  colors: string[]
  /** flat colour behind every blob; falls back to the first colour */
  base?: string
  /** the blobs themselves; generated from `colors` + `seed` when absent */
  stops?: MeshStop[]
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** The same colour at zero alpha, so a blob fades out without greying first. */
const fade = (hex: string) => `${hex}00`

/*
 * Where generated blobs go: the corners and the middle of each edge. Keeping
 * them off the centre is the difference between a mesh and a smudge.
 */
const ANCHORS: [number, number][] = [
  [0.04, 0.96],
  [0.5, 0.97],
  [0.96, 0.93],
  [0.93, 0.06],
  [0.5, 0.03],
  [0.06, 0.08],
]

/**
 * Build a mesh out of an arbitrary palette, for the paths where the colours
 * are not ours to choose: "Magic" sampling a screenshot, and Randomize.
 */
export function meshFromColors(colors: string[], seed: number): { base: string; stops: MeshStop[] } {
  const pool = colors.length > 0 ? colors : ['#8b9dc3']
  const rnd = mulberry32(seed || 1)
  const offset = Math.floor(rnd() * ANCHORS.length)

  const stops = pool.slice(0, 5).map((color, i) => {
    const [ax, ay] = ANCHORS[(i + offset) % ANCHORS.length]
    return {
      x: clamp01(ax + (rnd() - 0.5) * 0.2),
      y: clamp01(ay + (rnd() - 0.5) * 0.2),
      color,
      spread: 0.6 + rnd() * 0.6,
    }
  })
  // the last colour reaches right across, which is what gives the set a floor
  if (stops.length > 1) stops[stops.length - 1].spread = 1.3 + rnd() * 0.3
  return { base: pool[0], stops }
}

/** A mesh's concrete blobs, generating them when the spec only carries colours. */
export function resolveMesh(mesh: MeshSpec): { base: string; stops: MeshStop[] } {
  if (mesh.stops && mesh.stops.length > 0) {
    return { base: mesh.base ?? mesh.stops[0].color, stops: mesh.stops }
  }
  return meshFromColors(mesh.colors, mesh.seed)
}

/** The `background-image` half, as CSS. */
export function meshCssImage(mesh: MeshSpec): string {
  const { stops } = resolveMesh(mesh)
  return stops
    .map(
      (s) =>
        `radial-gradient(circle at ${(s.x * 100).toFixed(1)}% ${(s.y * 100).toFixed(1)}%, ` +
        `${s.color} 0%, ${fade(s.color)} ${(s.spread * 100).toFixed(1)}%)`,
    )
    .join(', ')
}

/** Everything a preview needs to paint a mesh, with no canvas or data URL. */
export function meshCss(mesh: MeshSpec): {
  backgroundColor: string
  backgroundImage: string
} {
  return { backgroundColor: resolveMesh(mesh).base, backgroundImage: meshCssImage(mesh) }
}

/** Paint a mesh onto a 2D context, matching `meshCss` pixel for pixel. */
export function paintMeshGradient(ctx: CanvasRenderingContext2D, w: number, h: number, mesh: MeshSpec) {
  const { base, stops } = resolveMesh(mesh)
  ctx.save()
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)
  /*
   * Back to front. CSS paints the *first* `background-image` layer on top, so
   * a list read front-to-back here would inverte the stack: the deep grounding
   * colour, which is listed last precisely so it sits behind everything, would
   * end up covering the picture instead.
   */
  for (const s of [...stops].reverse()) {
    const cx = s.x * w
    const cy = s.y * h
    // CSS sizes a `circle at x% y%` to its farthest corner by default, and the
    // percentage stop is read against that, so the same maths lands here
    const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy))
    const r = Math.max(1, s.spread * far)
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, s.color)
    g.addColorStop(1, fade(s.color))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  ctx.restore()
}

/**
 * The shipped meshes.
 *
 * Each is a base plus four blobs: two bright ones low or to one side, a
 * saturated mid, and a near-black at a wide radius that grounds the whole
 * thing. The first is the arrangement mshr.app exports for its own preview,
 * converted from hsla; the rest follow its shape with different palettes.
 */
export const MESH_PRESETS: { id: string; name: string; base: string; stops: MeshStop[] }[] = [
  {
    id: 'blaze',
    name: 'Blaze',
    base: '#ff3b00',
    stops: [
      { x: 0.0, y: 0.99, color: '#fff600', spread: 0.67 },
      { x: 0.46, y: 0.94, color: '#ff3b00', spread: 0.81 },
      { x: 0.93, y: 0.95, color: '#540075', spread: 0.66 },
      { x: 0.89, y: 0.08, color: '#0a002e', spread: 1.5 },
    ],
  },
  {
    id: 'aurora',
    name: 'Aurora',
    base: '#00243f',
    stops: [
      { x: 0.08, y: 0.12, color: '#00ffd5', spread: 0.7 },
      { x: 0.88, y: 0.18, color: '#0066ff', spread: 0.8 },
      { x: 0.48, y: 0.96, color: '#7b00ff', spread: 0.9 },
      { x: 0.95, y: 0.92, color: '#00112b', spread: 1.4 },
    ],
  },
  {
    id: 'candy',
    name: 'Candy',
    base: '#ff2d95',
    stops: [
      { x: 0.05, y: 0.06, color: '#ffe600', spread: 0.62 },
      { x: 0.92, y: 0.14, color: '#ff2d95', spread: 0.78 },
      { x: 0.5, y: 0.98, color: '#7a00ff', spread: 0.88 },
      { x: 0.08, y: 0.94, color: '#2b0057', spread: 1.45 },
    ],
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    base: '#0077b6',
    stops: [
      { x: 0.02, y: 0.22, color: '#90e0ef', spread: 0.7 },
      { x: 0.82, y: 0.05, color: '#00b4d8', spread: 0.8 },
      { x: 0.58, y: 0.99, color: '#023e8a', spread: 0.9 },
      { x: 0.98, y: 0.88, color: '#03045e', spread: 1.35 },
    ],
  },
  {
    id: 'ember',
    name: 'Ember',
    base: '#4a0e0e',
    stops: [
      { x: 0.14, y: 0.92, color: '#ffb700', spread: 0.68 },
      { x: 0.62, y: 0.86, color: '#ff5400', spread: 0.8 },
      { x: 0.95, y: 0.38, color: '#9d0208', spread: 0.75 },
      { x: 0.18, y: 0.04, color: '#12000a', spread: 1.4 },
    ],
  },
  {
    id: 'meadow',
    name: 'Meadow',
    base: '#06d6a0',
    stops: [
      { x: 0.03, y: 0.05, color: '#e6f9c9', spread: 0.65 },
      { x: 0.87, y: 0.24, color: '#06d6a0', spread: 0.8 },
      { x: 0.44, y: 0.98, color: '#118ab2', spread: 0.85 },
      { x: 0.97, y: 0.96, color: '#04303d', spread: 1.35 },
    ],
  },
  {
    id: 'dusk',
    name: 'Dusk',
    base: '#6a00f4',
    stops: [
      { x: 0.1, y: 0.14, color: '#f72585', spread: 0.7 },
      { x: 0.92, y: 0.08, color: '#7209b7', spread: 0.8 },
      { x: 0.5, y: 0.96, color: '#3a0ca3', spread: 0.9 },
      { x: 0.04, y: 0.95, color: '#10002b', spread: 1.45 },
    ],
  },
  {
    id: 'peach',
    name: 'Peach',
    base: '#ff9e7d',
    stops: [
      { x: 0.06, y: 0.08, color: '#fff1e6', spread: 0.66 },
      { x: 0.9, y: 0.2, color: '#ffb4a2', spread: 0.8 },
      { x: 0.5, y: 0.99, color: '#e5989b', spread: 0.85 },
      { x: 0.94, y: 0.9, color: '#4a2545', spread: 1.3 },
    ],
  },
]

/** Re-scatter a mesh's blobs, keeping its colours. */
export function reshuffleMesh(mesh: MeshSpec): MeshSpec {
  const seed = Math.floor(Math.random() * 1e6)
  const { base, stops } = meshFromColors(mesh.colors, seed)
  return { ...mesh, seed, base, stops }
}

/** The default mesh a new document starts on. */
export function defaultMesh(): MeshSpec {
  const p = MESH_PRESETS[0]
  return { seed: 7, colors: p.stops.map((s) => s.color), base: p.base, stops: p.stops }
}
