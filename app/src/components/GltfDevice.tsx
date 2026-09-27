import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { DeviceModel } from '../lib/registry'
import { applyTint, buildTintPlan, disposeTintPlan, type TintPlan } from '../lib/retint'

/**
 * Re-map a screen mesh's UVs to a clean 0..1 planar projection.
 *
 * Source models ship UVs authored for their own baked wallpaper, often an atlas
 * region or an arbitrary layout, so sampling our screenshot through them lands
 * on the wrong part of the image (typically a solid black sliver).
 *
 * The projection is done in *display space*: every vertex is transformed by the
 * same matrix that ends up orienting the device toward the camera, then U/V are
 * read off world X/Y. Projecting in the mesh's own local space instead would
 * inherit whatever arbitrary axis flip the author used, which shows up as a
 * mirrored (or 90°-rotated) screenshot.
 */
function planarReprojectUVs(
  mesh: THREE.Mesh,
  toDisplaySpace: THREE.Matrix4,
  inset: [number, number, number, number] = [0, 0, 0, 0],
) {
  const geo = mesh.geometry
  const pos = geo.getAttribute('position')
  if (!pos) return
  if (geo.userData.__uvReprojected) return // idempotent: effect can re-run

  const v = new THREE.Vector3()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const xs = new Float32Array(pos.count)
  const ys = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toDisplaySpace)
    xs[i] = v.x
    ys[i] = v.y
    if (v.x < minX) minX = v.x
    if (v.x > maxX) maxX = v.x
    if (v.y < minY) minY = v.y
    if (v.y > maxY) maxY = v.y
  }
  // A mesh that also carries the bezel only lights up inside the inset; UVs
  // outside 0..1 land on the bezel and the screen material paints them black.
  const [top, right, bottom, left] = inset
  const fullW = maxX - minX || 1
  const fullH = maxY - minY || 1
  minX += fullW * left
  minY += fullH * bottom
  const w = fullW * (1 - left - right) || 1
  const h = fullH * (1 - top - bottom) || 1

  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (xs[i] - minX) / w // U → screen right
    uv[i * 2 + 1] = (ys[i] - minY) / h // V → screen up
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.userData.__uvReprojected = true
}

/**
 * The axis a screen mesh faces, in root space, without a sign.
 *
 * Each triangle's normal votes with its area into n·nᵀ, and the dominant
 * eigenvector of that sum is the facing axis. Squaring the normals is what makes
 * it sign-free: a double-sided or closed screen mesh has opposing faces that
 * cancel when normals are averaged, but they agree here. It also doesn't care
 * how the author laid the mesh out locally, where a tilted laptop lid or a
 * pre-rotated tablet panel has no thin bounding-box axis to read.
 */
function facingAxis(mesh: THREE.Mesh, toRoot: THREE.Matrix4): THREE.Vector3 | null {
  const geo = mesh.geometry
  const pos = geo.getAttribute('position')
  if (!pos) return null
  const index = geo.getIndex()
  const tris = (index ? index.count : pos.count) / 3
  const step = Math.max(1, Math.floor(tris / 20000))
  const m = new Float64Array(9)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let t = 0; t < tris; t += step) {
    const i = t * 3
    const ia = index ? index.getX(i) : i
    const ib = index ? index.getX(i + 1) : i + 1
    const ic = index ? index.getX(i + 2) : i + 2
    a.fromBufferAttribute(pos, ia).applyMatrix4(toRoot)
    b.fromBufferAttribute(pos, ib).applyMatrix4(toRoot)
    c.fromBufferAttribute(pos, ic).applyMatrix4(toRoot)
    // |cross| is twice the area, so n·nᵀ/|n| weights each face by its area
    const n = b.sub(a).cross(c.sub(a))
    const len = n.length()
    if (len < 1e-12) continue
    const e = [n.x, n.y, n.z]
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) m[r * 3 + k] += (e[r] * e[k]) / len
  }
  // power iteration, from a start that can't be orthogonal to any axis
  const v = new THREE.Vector3(0.577, 0.577, 0.577)
  for (let it = 0; it < 64; it++) {
    const x = m[0] * v.x + m[1] * v.y + m[2] * v.z
    const y = m[3] * v.x + m[4] * v.y + m[5] * v.z
    const z = m[6] * v.x + m[7] * v.y + m[8] * v.z
    v.set(x, y, z)
    if (v.lengthSq() < 1e-30) return null
    v.normalize()
  }
  return v
}

/**
 * The material the screenshot is painted with. An inset screen gets a small
 * shader patch that turns everything outside the display rect into bezel. The
 * test runs on the raw UV, before the texture's own offset/repeat (cover fit,
 * scroll), which would otherwise move the bezel along with the picture.
 */
function screenMaterial(texture: THREE.Texture | null, emptyColor: string, inset: boolean) {
  const mat = new THREE.MeshBasicMaterial({
    map: texture ?? null,
    color: texture ? '#ffffff' : emptyColor,
    toneMapped: false,
  })
  if (inset && texture) {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'varying vec2 vScreenUv;\nvoid main() {\n  vScreenUv = uv;')
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'varying vec2 vScreenUv;\nvoid main() {')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
  if (any(lessThan(vScreenUv, vec2(0.0))) || any(greaterThan(vScreenUv, vec2(1.0)))) diffuseColor.rgb = vec3(0.004);`,
        )
    }
    mat.customProgramCacheKey = () => 'screen-inset'
  }
  return mat
}

/**
 * Renders a real .glb device and paints the app's screenshot onto its display
 * mesh. Everything except that one mesh keeps the model's own materials, so the
 * body/bezel/buttons look exactly as authored.
 */
export function GltfDevice({
  model,
  texture,
  emptyColor,
  tint,
  onPick,
}: {
  model: DeviceModel
  texture: THREE.Texture | null
  emptyColor: string
  /** body colour to retint toward, or null for the model's own finish */
  tint: string | null
  onPick: (e: ThreeEvent<PointerEvent>) => void
}) {
  const { scene } = useGLTF(model.url)

  // Clone so multiple instances of the same device don't share one mutated graph.
  const root = useMemo(() => scene.clone(true), [scene])

  /**
   * three.js sanitizes glTF node names on import (THREE.PropertyBinding:
   * whitespace → "_", and ".[]:/" stripped entirely), so a manifest name copied
   * straight out of the file, "Cylinder.003_screen_0", never matches the
   * runtime object. Compare both sides in sanitized form.
   */
  const key = (s: string | undefined) =>
    (s ?? '').replace(/\s/g, '_').replace(/[[\]./:]/g, '').toLowerCase()

  const wanted = key(model.screenMesh)
  const screenOf = (obj: THREE.Object3D) =>
    obj instanceof THREE.Mesh &&
    (key(obj.name) === wanted || key((obj.material as THREE.Material | undefined)?.name) === wanted)

  // Normalize facing, scale and position. Source models arrive at wildly
  // different scales (1.9 to 35 units) with no shared convention for which way
  // the screen points, so everything is derived from the model itself.
  const { scale, offset, quat } = useMemo(() => {
    root.updateWorldMatrix(true, true)
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert()

    // Bounds of the screen mesh, and of the whole device, in root space.
    const screenBox = new THREE.Box3()
    const modelBox = new THREE.Box3()
    const v = new THREE.Vector3()
    const screenPts: THREE.Vector3[] = []
    let screenNormal: THREE.Vector3 | null = null
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      const toRoot = new THREE.Matrix4().multiplyMatrices(rootInv, obj.matrixWorld)
      const pos = obj.geometry.getAttribute('position')
      if (!pos) return
      const isScreen = screenOf(obj)

      if (isScreen && !screenNormal) screenNormal = facingAxis(obj, toRoot)

      const step = Math.max(1, Math.floor(pos.count / 400))
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(toRoot)
        modelBox.expandByPoint(v)
        if (isScreen) {
          screenBox.expandByPoint(v)
          screenPts.push(v.clone())
        }
      }
    })

    const q = new THREE.Quaternion()
    // the display's true height, measured up its own face; only a lid needs it
    let lidScreenH = 0
    if (screenNormal && !screenBox.isEmpty()) {
      const axis = (screenNormal as THREE.Vector3).clone()

      // Which way along that axis is "out of the front"? A phone's screen sits
      // on its front, so model-centre → screen-centre points forward. A laptop
      // is the other way round: the display sits at the back edge on the lid
      // and faces forward over the keyboard, towards the middle of the model.
      const screenC = new THREE.Vector3()
      const modelC = new THREE.Vector3()
      screenBox.getCenter(screenC)
      modelBox.getCenter(modelC)
      const outward = screenC.clone().sub(modelC).dot(axis) >= 0
      if (outward === !!model.lid) axis.negate()

      if (model.lid) {
        // Turn only about the vertical, so the base stays level on the floor
        // with the lid at whatever angle the author opened it to. Squaring the
        // lid up to the camera instead tips the whole laptop onto its nose.
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(axis.x, axis.z)).invert()
        const up = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize()
        let lo = Infinity
        let hi = -Infinity
        for (const p of screenPts) {
          const d = p.dot(up)
          if (d < lo) lo = d
          if (d > hi) hi = d
        }
        lidScreenH = hi - lo
      } else {
        q.setFromUnitVectors(axis, new THREE.Vector3(0, 0, 1))
      }
    }

    // manual escape hatch for models auto-detection can't get right
    if (model.rotationEuler) {
      const [rx, ry, rz] = model.rotationEuler.map(THREE.MathUtils.degToRad)
      q.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)))
    }

    // Scale from the *screen*, not the whole model: a watch strap or a laptop
    // base would otherwise dominate the bounds and shrink the actual display.
    const orient = new THREE.Matrix4().makeRotationFromQuaternion(q)
    const screenOriented = screenBox.clone().applyMatrix4(orient)
    const sSize = new THREE.Vector3()
    screenOriented.getSize(sSize)
    // A tilted lid's projected height undersells the display, so it measures
    // up the face instead. An inset mesh is bezel and display together, and
    // it's the display that gets fitted.
    const [top, , bottom] = model.screenInset ?? [0, 0, 0, 0]
    const meshH = Math.max(lidScreenH || sSize.y, 1e-6)
    const screenH = meshH * (1 - top - bottom)

    // Centre on the screen, since that's the subject of the mockup.
    const centre = new THREE.Vector3()
    screenOriented.getCenter(centre)
    centre.y += ((bottom - top) / 2) * sSize.y

    return {
      scale: screenBox.isEmpty() ? 1 : model.fitHeight / screenH,
      offset: centre,
      quat: q,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, model.fitHeight, model.screenMesh, model.rotationEuler, model.lid, model.screenInset])

  /*
   * Body colour. The plan is built once per loaded model (it clones the
   * materials this instance will own), then repainting on every swatch click is
   * just writing uniforms, with no re-clone and no shader recompile.
   */
  const [tintPlan, setTintPlan] = useState<TintPlan | null>(null)
  useEffect(() => {
    const plan = buildTintPlan(root, screenOf)
    setTintPlan(plan)
    return () => disposeTintPlan(plan)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, model.screenMesh])
  useEffect(() => {
    if (tintPlan) applyTint(tintPlan, tint)
  }, [tintPlan, tint])

  // Swap the display mesh's material for our screenshot; leave the rest alone.
  useEffect(() => {
    // mesh-local → display space (device upright, screen facing +Z)
    root.updateWorldMatrix(true, true)
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert()
    const orient = new THREE.Matrix4().makeRotationFromQuaternion(quat)

    root.traverse((obj) => {
      if (!screenOf(obj)) return
      const mesh = obj as THREE.Mesh
      const toDisplay = new THREE.Matrix4()
        .multiplyMatrices(orient, rootInv)
        .multiply(mesh.matrixWorld)
      planarReprojectUVs(mesh, toDisplay, model.screenInset)
      mesh.material = screenMaterial(texture, emptyColor, !!model.screenInset)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, model.screenMesh, model.screenInset, texture, emptyColor, quat])

  return (
    <group onPointerDown={onPick} scale={scale}>
      {/* centre after rotating, so the device sits on the scene origin */}
      <group position={[-offset.x, -offset.y, -offset.z]}>
        {/* orientation lives on a wrapper: writing it onto the loaded root would
            clobber the model's own root transform (FBX-derived exports commonly
            carry a -90° X there), leaving the device lying on its side */}
        <group quaternion={quat}>
          <primitive object={root} />
        </group>
      </group>
    </group>
  )
}
