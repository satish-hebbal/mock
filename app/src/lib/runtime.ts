import * as THREE from 'three'
import { sampleKeyframes } from './evaluator'
import type { ProjectDoc } from '../types'

export interface ScreenHandle {
  texture: THREE.Texture
  /** available UV scroll range (1 - repeat.y); 0 = nothing to scroll */
  scrollRange: number
}

/**
 * Live handles into the R3F scene, registered by viewport components.
 * The same deterministic `applyAtTime` drives both the edit-mode RAF loop and
 * the offline export loop (PRD §5.4, §11.3) — guaranteeing WYSIWYG.
 */
export const rt = {
  gl: undefined as THREE.WebGLRenderer | undefined,
  scene: undefined as THREE.Scene | undefined,
  camera: undefined as THREE.PerspectiveCamera | undefined,
  composer: undefined as { render(dt?: number): void; setSize(w: number, h: number): void } | undefined,
  sceneRoot: undefined as THREE.Group | undefined,
  /** the lighting rig, yawed to stay put relative to the lens */
  lightRig: undefined as THREE.Group | undefined,
  deviceGroups: new Map<string, THREE.Group>(),
  screens: new Map<string, ScreenHandle>(),
  videos: new Map<string, HTMLVideoElement>(),
  setFrameloop: undefined as ((mode: 'always' | 'never' | 'demand') => void) | undefined,
  exportCancelled: false,
  /** true while a transform-gizmo handle is held, so camera gestures stand down */
  gizmoDragging: false,
  /**
   * Objects that live in the scene purely for editing — the transform gizmo and
   * anything like it. They share the scene the exporter renders, so unless they
   * are hidden for the duration they get baked into the picture.
   */
  editorOnly: new Set<THREE.Object3D>(),
}

/**
 * Hide (or restore) every editor-only object. The exporter wraps its whole run
 * in this: `renderFrame()` draws whatever is in the scene, and React can't be
 * relied on to have unmounted the gizmo by then — the export renders
 * synchronously, well before any re-render would land.
 */
export function setEditorObjectsVisible(visible: boolean) {
  for (const o of rt.editorOnly) o.visible = visible
}

/**
 * How far the camera sits from its target at zoom 1. Every reader of the
 * orbital camera — the render loop here, and the camera stage's schematic —
 * measures dolly as `BASE_DIST / zoom`, so the two cannot disagree about where
 * the lens is.
 */
export const BASE_DIST = 7

/**
 * Pan + zoom that brings every device into frame, leaving the angle alone.
 *
 * Recovery, not a reset: losing the subject usually means the pan wandered, and
 * the tilt you'd dialled in is the part worth keeping. Reads the live scene
 * rather than the document so it accounts for whatever the devices' own
 * transforms and the scene rotation have done to them.
 */
export function framingForDevices(fovDeg: number): { panX: number; panY: number; zoom: number } | null {
  const groups = [...rt.deviceGroups.values()]
  if (groups.length === 0 || !rt.camera) return null
  rt.scene?.updateMatrixWorld(true)

  const box = new THREE.Box3()
  for (const g of groups) box.expandByObject(g)
  if (box.isEmpty()) return null

  const center = box.getCenter(new THREE.Vector3())
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius
  if (!(radius > 0)) return null

  // fit on whichever axis is tighter — a portrait frame runs out of width first
  const vFov = degToRad(fovDeg)
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (rt.camera.aspect || 1))
  const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.12 // a little air

  return {
    panX: clamp(center.x, -3, 3),
    panY: clamp(center.y, -3, 3),
    zoom: clamp(BASE_DIST / dist, 0.3, 8),
  }
}
const tmpTarget = new THREE.Vector3()
const { degToRad, clamp } = THREE.MathUtils

export function applyAtTime(project: ProjectDoc, timeMs: number) {
  const kf = sampleKeyframes(project.keyframes, timeMs)
  const v = (target: string, base: number) => kf.get(target) ?? base
  const c = project.scene.camera

  const cam = rt.camera
  if (cam) {
    const tiltX = v('camera.tiltX', c.tiltX)
    const tiltY = v('camera.tiltY', c.tiltY)
    const roll = v('camera.roll', c.roll)
    const fov = clamp(v('camera.fov', c.fov), 5, 120)
    const zoom = Math.max(0.2, v('camera.zoom', c.zoom))
    const panX = v('camera.panX', c.panX)
    const panY = v('camera.panY', c.panY)

    const dist = BASE_DIST / zoom
    const phi = degToRad(clamp(90 + tiltX, 1, 179))
    const theta = degToRad(tiltY)
    tmpTarget.set(panX, panY, 0)
    cam.position.setFromSphericalCoords(dist, phi, theta).add(tmpTarget)
    cam.up.set(0, 1, 0)
    cam.lookAt(tmpTarget)
    if (roll !== 0) cam.rotateZ(degToRad(roll))
    if (cam.fov !== fov) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }
  }

  /*
   * Swing the lighting rig with the lens. A photographer walking around a
   * product takes the lights with them, so a 45° key stays 45° off the camera
   * instead of sliding behind the subject when the shot orbits. Driven here
   * rather than in a useFrame so the export loop — which renders without R3F's
   * frame loop — lights every frame exactly like the preview.
   */
  const yaw = degToRad(v('camera.tiltY', c.tiltY))
  if (rt.lightRig) rt.lightRig.rotation.y = yaw
  if (rt.scene) rt.scene.environmentRotation.y = yaw

  if (rt.sceneRoot) {
    rt.sceneRoot.rotation.set(
      degToRad(v('camera.rotateX', c.rotateX)),
      degToRad(v('camera.rotateY', c.rotateY)),
      0,
    )
  }

  for (const dev of project.scene.devices) {
    const g = rt.deviceGroups.get(dev.id)
    if (!g) continue
    const t = dev.transform
    const p = `dev.${dev.id}`
    g.position.set(v(`${p}.posX`, t.position[0]), v(`${p}.posY`, t.position[1]), v(`${p}.posZ`, t.position[2]))
    g.rotation.set(
      degToRad(v(`${p}.rotX`, t.rotation[0])),
      degToRad(v(`${p}.rotY`, t.rotation[1])),
      degToRad(v(`${p}.rotZ`, t.rotation[2])),
    )
    g.scale.setScalar(Math.max(0.05, v(`${p}.scale`, t.scale)))

    const sc = rt.screens.get(dev.id)
    if (sc && sc.scrollRange > 0.0005) {
      const scroll = clamp(v(`${p}.scroll`, dev.screen.scroll), 0, 1)
      sc.texture.offset.y = (1 - scroll) * sc.scrollRange
    }
  }
}

/** Render one frame with the current renderer state (composer if active). */
export function renderFrame() {
  if (!rt.gl || !rt.scene || !rt.camera) return
  if (rt.composer) rt.composer.render(1 / 60)
  else rt.gl.render(rt.scene, rt.camera)
}
