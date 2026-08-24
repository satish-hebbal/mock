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
function planarReprojectUVs(mesh: THREE.Mesh, toDisplaySpace: THREE.Matrix4) {
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
  const w = maxX - minX || 1
  const h = maxY - minY || 1

  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (xs[i] - minX) / w // U → screen right
    uv[i * 2 + 1] = (ys[i] - minY) / h // V → screen up
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.userData.__uvReprojected = true
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
    const screenNormal: { v: THREE.Vector3 | null } = { v: null }
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      const toRoot = new THREE.Matrix4().multiplyMatrices(rootInv, obj.matrixWorld)
      const pos = obj.geometry.getAttribute('position')
      if (!pos) return
      const isScreen = screenOf(obj)

      if (isScreen && !screenNormal.v) {
        obj.geometry.computeBoundingBox()
        const lb = obj.geometry.boundingBox!
        const ls = new THREE.Vector3()
        lb.getSize(ls)
        const thin = ls.x <= ls.y && ls.x <= ls.z ? 'x' : ls.y <= ls.z ? 'y' : 'z'
        const n = new THREE.Vector3(thin === 'x' ? 1 : 0, thin === 'y' ? 1 : 0, thin === 'z' ? 1 : 0)
        screenNormal.v = n.applyMatrix3(new THREE.Matrix3().getNormalMatrix(toRoot))
      }

      const step = Math.max(1, Math.floor(pos.count / 400))
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(toRoot)
        modelBox.expandByPoint(v)
        if (isScreen) screenBox.expandByPoint(v)
      }
    })

    const q = new THREE.Quaternion()
    if (screenNormal.v && !screenBox.isEmpty()) {
      // Derive the screen normal from the mesh's *own* local bounding box, then
      // transform it into root space. Taking the thin axis of the root-space AABB
      // instead breaks on anything not axis-aligned: a laptop's tilted lid has
      // no thin principal axis, so the device came out facing its underside.
      // (Averaging vertex normals is also unreliable: on closed/double-sided
      // screen meshes the opposing faces cancel to zero.)
      const axis = screenNormal.v.clone().normalize()

      // Which way along that axis is "out of the front"? The screen sits on the
      // front of the device, so model-centre → screen-centre points forward.
      const screenC = new THREE.Vector3()
      const modelC = new THREE.Vector3()
      screenBox.getCenter(screenC)
      modelBox.getCenter(modelC)
      if (screenC.clone().sub(modelC).dot(axis) < 0) axis.negate()

      q.setFromUnitVectors(axis, new THREE.Vector3(0, 0, 1))
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
    const screenH = Math.max(sSize.y, 1e-6)

    // Centre on the screen, since that's the subject of the mockup.
    const centre = new THREE.Vector3()
    screenOriented.getCenter(centre)

    return {
      scale: screenBox.isEmpty() ? 1 : model.fitHeight / screenH,
      offset: centre,
      quat: q,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, model.fitHeight, model.screenMesh, model.rotationEuler])

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
      planarReprojectUVs(mesh, toDisplay)
      mesh.material = new THREE.MeshBasicMaterial({
        map: texture ?? null,
        color: texture ? '#ffffff' : emptyColor,
        toneMapped: false,
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, model.screenMesh, texture, emptyColor, quat])

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
