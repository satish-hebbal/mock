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
  deviceGroups: new Map<string, THREE.Group>(),
  screens: new Map<string, ScreenHandle>(),
  videos: new Map<string, HTMLVideoElement>(),
  setFrameloop: undefined as ((mode: 'always' | 'never' | 'demand') => void) | undefined,
  exportCancelled: false,
}

const BASE_DIST = 7
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
