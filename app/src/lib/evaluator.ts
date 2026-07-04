import { EASINGS } from './easing'
import type { Keyframe, SceneState } from '../types'

/**
 * Sample every keyframed target at `timeMs` (PRD §11.2).
 * Returns a map of target path → interpolated value.
 */
export function sampleKeyframes(keyframes: Keyframe[], timeMs: number): Map<string, number> {
  const byTarget = new Map<string, Keyframe[]>()
  for (const k of keyframes) {
    const arr = byTarget.get(k.target)
    if (arr) arr.push(k)
    else byTarget.set(k.target, [k])
  }
  const out = new Map<string, number>()
  for (const [target, arr] of byTarget) {
    arr.sort((a, b) => a.timeMs - b.timeMs)
    out.set(target, sampleTrack(arr, timeMs))
  }
  return out
}

function sampleTrack(sorted: Keyframe[], t: number): number {
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (t <= first.timeMs) return first.value
  if (t >= last.timeMs) return last.value
  for (let i = 1; i < sorted.length; i++) {
    if (t < sorted[i].timeMs) {
      const a = sorted[i - 1]
      const b = sorted[i]
      const span = b.timeMs - a.timeMs
      const u = span <= 0 ? 1 : (t - a.timeMs) / span
      return a.value + (b.value - a.value) * EASINGS[a.easing](u)
    }
  }
  return last.value
}

/** Read the base (un-animated) value of an animatable target from the scene. */
export function getTargetValue(scene: SceneState, target: string): number {
  const parts = target.split('.')
  if (parts[0] === 'camera') {
    return scene.camera[parts[1] as keyof typeof scene.camera]
  }
  if (parts[0] === 'dev') {
    const dev = scene.devices.find((d) => d.id === parts[1])
    if (!dev) return 0
    switch (parts[2]) {
      case 'posX': return dev.transform.position[0]
      case 'posY': return dev.transform.position[1]
      case 'posZ': return dev.transform.position[2]
      case 'rotX': return dev.transform.rotation[0]
      case 'rotY': return dev.transform.rotation[1]
      case 'rotZ': return dev.transform.rotation[2]
      case 'scale': return dev.transform.scale
      case 'scroll': return dev.screen.scroll
    }
  }
  return 0
}

/** Write the base value of an animatable target into the scene (mutates draft). */
export function setTargetValue(scene: SceneState, target: string, value: number): void {
  const parts = target.split('.')
  if (parts[0] === 'camera') {
    ;(scene.camera as unknown as Record<string, number>)[parts[1]] = value
    return
  }
  if (parts[0] === 'dev') {
    const dev = scene.devices.find((d) => d.id === parts[1])
    if (!dev) return
    switch (parts[2]) {
      case 'posX': dev.transform.position[0] = value; break
      case 'posY': dev.transform.position[1] = value; break
      case 'posZ': dev.transform.position[2] = value; break
      case 'rotX': dev.transform.rotation[0] = value; break
      case 'rotY': dev.transform.rotation[1] = value; break
      case 'rotZ': dev.transform.rotation[2] = value; break
      case 'scale': dev.transform.scale = value; break
      case 'scroll': dev.screen.scroll = value; break
    }
  }
}

const CAMERA_LABELS: Record<string, string> = {
  tiltX: 'Tilt X',
  tiltY: 'Tilt Y',
  roll: 'Roll',
  fov: 'FOV',
  zoom: 'Zoom',
  panX: 'Pan X',
  panY: 'Pan Y',
  rotateX: 'Rotate X',
  rotateY: 'Rotate Y',
}

const DEV_LABELS: Record<string, string> = {
  posX: 'Pos X',
  posY: 'Pos Y',
  posZ: 'Pos Z',
  rotX: 'Rot X',
  rotY: 'Rot Y',
  rotZ: 'Rot Z',
  scale: 'Scale',
  scroll: 'Scroll',
}

/** Human label for a target path, for timeline track rows. */
export function targetLabel(target: string, scene: SceneState): string {
  const parts = target.split('.')
  if (parts[0] === 'camera') return `Camera · ${CAMERA_LABELS[parts[1]] ?? parts[1]}`
  if (parts[0] === 'dev') {
    const idx = scene.devices.findIndex((d) => d.id === parts[1])
    const name = idx >= 0 ? `Device ${idx + 1}` : 'Device'
    return `${name} · ${DEV_LABELS[parts[2]] ?? parts[2]}`
  }
  return target
}
