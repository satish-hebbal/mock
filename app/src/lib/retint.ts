import * as THREE from 'three'

/*
 * Recolouring a .glb device.
 *
 * The models ship with their body colour baked into flat PBR materials, and a
 * phone is never one material: the iPhone 16 alone splits into 37, where about
 * fifteen carry the teal body and the rest are camera glass, lenses, the black
 * bezel and internals. Setting every material to the picked colour turns the
 * lenses teal too, so the job is to find the body and leave the hardware alone.
 *
 * Two things make that tractable. None of the phone models are textured, so a
 * material's baseColorFactor IS its colour with nothing to double up against.
 * And the body parts all share one hue, spread across a range of lightness, so
 * they cluster.
 *
 * So: take the largest opaque material as the reference for what "the body"
 * looks like, gather everything that matches it, and move that group onto the
 * new colour while preserving each part's own lightness relative to the
 * reference. Preserving lightness is what keeps the model looking like a
 * rendered object rather than a flat cut-out, because the frame stays darker
 * than the back panel exactly as the artist set it.
 */

/** saturation above which a material counts as carrying colour rather than being hardware */
const CHROMATIC = 0.12
/** how far around the wheel still counts as the same body colour */
const HUE_TOLERANCE = 0.09
/** for grey/white bodies, where hue means nothing, match on lightness instead */
const NEUTRAL_BAND = 0.28
/**
 * Lightness at or below which a part counts as screen furniture: the bezel, the
 * notch or island, and the black glass over them. Sits just above the darkest
 * bezel colours in the shipped models (sRGB 0.09 to 0.15) and well below any
 * body finish that isn't already handled as the tinted body.
 */
const BLACK = 0.18

interface Tinted {
  mat: THREE.MeshStandardMaterial
  /** the colour the model shipped with, kept so "Stock" can put it back */
  base: THREE.Color
  h: number
  s: number
  l: number
}

/** a black part whose gloss has been flattened, with its shipped finish kept for restore */
interface Matted {
  mat: THREE.MeshStandardMaterial
  roughness: number
  metalness: number
  env: number
}

/**
 * Everything this instance owns about how the model is finished: the body
 * materials that follow the colour picker, and the black screen furniture that
 * gets flattened once at build time and never changes after.
 */
export interface TintPlan {
  mats: Tinted[]
  ref: { h: number; s: number; l: number }
  matte: Matted[]
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/*
 * All HSL maths runs in sRGB rather than three's linear working space, so the
 * numbers line up with the hex the user actually picked. Reading HSL in linear
 * space would report a lightness far from what the swatch looks like.
 */
function hslOf(c: THREE.Color) {
  const out = { h: 0, s: 0, l: 0 }
  c.getHSL(out, THREE.SRGBColorSpace)
  return out
}

/**
 * Work out which materials make up the body, and clone them so this instance
 * owns them. The clone matters: `scene.clone()` copies the graph but shares
 * material references, both with every other copy of the device in the scene
 * and with the cached GLTF that drei hands out, so tinting in place would
 * repaint all of them at once.
 *
 * Returns null when nothing is tintable, which is the honest answer for a model
 * whose body is a texture rather than a colour.
 */
export function buildTintPlan(
  root: THREE.Object3D,
  isScreen: (obj: THREE.Object3D) => boolean,
): TintPlan | null {
  const slots: { mesh: THREE.Mesh; index: number; mat: THREE.MeshStandardMaterial }[] = []
  const verts = new Map<string, number>()

  // Bounds are gathered in root space so the screen, the model and every
  // candidate part can be compared on one set of axes.
  root.updateWorldMatrix(true, true)
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const boxOf = (mesh: THREE.Mesh) => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    return mesh.geometry
      .boundingBox!.clone()
      .applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld))
  }
  const screenBox = new THREE.Box3()
  const modelBox = new THREE.Box3()
  const bounds = new Map<THREE.Mesh, THREE.Box3>()

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const box = boxOf(obj)
    modelBox.union(box)
    if (isScreen(obj)) {
      screenBox.union(box)
      return
    }
    bounds.set(obj, box)
    const list = Array.isArray(obj.material) ? obj.material : [obj.material]
    const count = obj.geometry.getAttribute('position')?.count ?? 0
    list.forEach((m, i) => {
      if (!(m instanceof THREE.MeshStandardMaterial)) return
      slots.push({ mesh: obj, index: Array.isArray(obj.material) ? i : -1, mat: m })
      verts.set(m.uuid, (verts.get(m.uuid) ?? 0) + count)
    })
  })
  if (!slots.length) return null

  /*
   * Is this part sitting on the display face?
   *
   * Colour cannot answer that on its own. A black phone has a black body AND a
   * black bezel, so matching by colour pulls the bezel into the body set and
   * the picker turns the bezel red along with the back. Depth separates them
   * cleanly: the bezel and the island are pressed flat against the screen,
   * while the back panel is a device-thickness away and the side frame spans
   * the whole depth. So the test is where a part sits along the screen's normal.
   */
  const screenSize = new THREE.Vector3()
  const modelSize = new THREE.Vector3()
  screenBox.getSize(screenSize)
  modelBox.getSize(modelSize)
  const axis: 'x' | 'y' | 'z' =
    screenSize.x <= screenSize.y && screenSize.x <= screenSize.z
      ? 'x'
      : screenSize.y <= screenSize.z
        ? 'y'
        : 'z'
  const face = screenBox.getCenter(new THREE.Vector3())[axis]
  const depth = Math.max(modelSize[axis], 1e-6)
  const onDisplayFace = (mesh: THREE.Mesh) => {
    const box = bounds.get(mesh)
    if (!box || screenBox.isEmpty()) return false
    const c = box.getCenter(new THREE.Vector3())
    const size = new THREE.Vector3()
    box.getSize(size)
    // near the screen plane, and thin enough to be a facing rather than the body
    return Math.abs(c[axis] - face) <= depth * 0.2 && size[axis] <= depth * 0.5
  }

  // The body is the biggest thing you can't see through. Skipping the glassy
  // materials matters because a phone's front cover is often the single largest
  // surface on the model, and it is not the colour anyone means.
  let dominant: THREE.MeshStandardMaterial | null = null
  let best = -1
  for (const { mat } of slots) {
    if (mat.transparent && mat.opacity < 0.9) continue
    const v = verts.get(mat.uuid) ?? 0
    if (v > best) {
      best = v
      dominant = mat
    }
  }
  if (!dominant) return null
  const ref = hslOf(dominant.color)

  const matches = (m: THREE.MeshStandardMaterial) => {
    const c = hslOf(m.color)
    if (ref.s > CHROMATIC) {
      if (c.s <= CHROMATIC) return false // a grey part of a coloured phone is hardware
      const d = Math.abs(c.h - ref.h)
      return Math.min(d, 1 - d) <= HUE_TOLERANCE
    }
    // A white or graphite body has no hue to match on, so anything near it in
    // lightness is body and the far-off blacks are still hardware.
    return c.s <= CHROMATIC && Math.abs(c.l - ref.l) <= NEUTRAL_BAND
  }

  /*
   * Decide furniture per material rather than per mesh. The Galaxy's body is a
   * single black material shared by six meshes, so judging each slot as it came
   * would let whichever one happened to be scanned first decide the fate of the
   * whole body: one mesh near the display plane and the entire phone stops
   * taking colour. A material only counts as furniture if every mesh using it
   * sits on the display face.
   */
  const furniture = new Set<string>()
  for (const uuid of new Set(slots.map((s) => s.mat.uuid))) {
    const mine = slots.filter((s) => s.mat.uuid === uuid)
    if (hslOf(mine[0].mat.color).l > BLACK) continue
    if (mine.every((s) => onDisplayFace(s.mesh))) furniture.add(uuid)
  }

  const clones = new Map<string, THREE.MeshStandardMaterial>()
  const mats: Tinted[] = []
  const matte: Matted[] = []

  const own = (slot: (typeof slots)[number]) => {
    let clone = clones.get(slot.mat.uuid)
    const fresh = !clone
    if (!clone) {
      clone = slot.mat.clone()
      clones.set(slot.mat.uuid, clone)
    }
    if (slot.index >= 0) (slot.mesh.material as THREE.Material[])[slot.index] = clone
    else slot.mesh.material = clone
    return { clone, fresh }
  }

  for (const slot of slots) {
    const isBody = matches(slot.mat)
    /*
     * Screen furniture: the bezel, the notch or island, and the black glass
     * sitting over them. In the source models these are near-black but ship
     * with a mirror finish (roughness 0.01, metalness up to 1), so the studio
     * key lands on them as a hard grey highlight and the bezel stops reading as
     * black. Real glass over a black mask shows almost nothing, so the gloss is
     * removed rather than dimmed.
     *
     * This wins over the body test rather than deferring to it. On a black
     * phone the bezel matches the body colour exactly, so letting the body test
     * go first is what turned the Galaxy's bezel red along with its back.
     */
    const isFurniture = furniture.has(slot.mat.uuid)
    if (!isBody && !isFurniture) continue

    const { clone, fresh } = own(slot)
    if (!fresh) continue

    if (isFurniture) {
      matte.push({
        mat: clone,
        roughness: clone.roughness,
        metalness: clone.metalness,
        env: clone.envMapIntensity,
      })
      clone.roughness = 1
      clone.metalness = 0
      clone.envMapIntensity = 0
    } else {
      mats.push({ mat: clone, base: clone.color.clone(), ...hslOf(clone.color) })
    }
  }
  return mats.length || matte.length ? { mats, ref, matte } : null
}

/** Paint the plan's materials. `null` restores the colours the model shipped with. */
export function applyTint(plan: TintPlan, target: string | null) {
  if (!target) {
    for (const m of plan.mats) m.mat.color.copy(m.base)
    return
  }

  const t = hslOf(new THREE.Color(target))

  for (const m of plan.mats) {
    /*
     * Offset, don't replace. Each part keeps its own distance from the body
     * colour, so the camera plateau stays exactly as much darker than the back
     * panel as the artist made it, and the model still reads as a lit object
     * rather than a flat cut-out.
     *
     * Offsetting beats scaling here because two of the shipped models have a
     * body that is essentially pure black (the Galaxy S26 Ultra reads L=0.00),
     * and a ratio against that either divides by zero or multiplies everything
     * to white. Measured over all nine models and a spread of targets, offsets
     * clip at the ends 5% of the time against 23% for ratios.
     */
    const l = clamp01(t.l + (m.l - plan.ref.l))
    const s = clamp01(t.s + (m.s - plan.ref.s))
    m.mat.color.setHSL(t.h, s, l, THREE.SRGBColorSpace)
  }
}

/**
 * Put the model back the way it arrived, then free the clones.
 *
 * Restoring first matters because the plan is rebuilt from whatever the meshes
 * currently carry. Freeing a tinted material and then cloning from it would
 * bake that tint in as the new "as modelled" colour, so the original would be
 * unrecoverable after one swatch click.
 */
export function disposeTintPlan(plan: TintPlan | null) {
  if (!plan) return
  for (const m of plan.mats) {
    m.mat.color.copy(m.base)
    m.mat.dispose()
  }
  for (const m of plan.matte) {
    m.mat.roughness = m.roughness
    m.mat.metalness = m.metalness
    m.mat.envMapIntensity = m.env
    m.mat.dispose()
  }
}
