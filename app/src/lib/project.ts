import { DEFAULT_DEVICE_ID, getDevice } from './registry'
import { DEFAULT_LOOK } from './studio'
import { WALLPAPERS } from './wallpapers'
import { PRESET_PHOTOS } from './presetPhotos'
import { defaultTransition, MIN_SHOT_MS } from './sequence'
import type {
  AssetRuntime,
  DeviceInstance,
  ProjectDoc,
  ProjectDocV2,
  SceneState,
  Shot,
} from '../types'

/*
 * What a project is made of, and how an older one becomes a current one.
 *
 * Kept out of the store on purpose: none of it touches the browser, so the
 * migration can be run and checked without one, which is the only way to be
 * sure that somebody's saved work still opens.
 */

const uid = () => crypto.randomUUID()

function defaultDevice(): DeviceInstance {
  const spec = getDevice(DEFAULT_DEVICE_ID)
  return {
    id: `dev_${uid()}`,
    modelId: spec.id,
    colorVariant: spec.colors[0]?.id ?? 'stock',
    orientation: 'portrait',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    screen: { assetId: null, fit: 'cover', scroll: 0 },
  }
}

/** The set a fresh shot opens on: one device, lit, on the studio sweep. */
export function defaultScene(): SceneState {
  // A new project opens on a lit set rather than a flat gradient: the
  // three-point rig, its sweep, and the framing that setup was built around.
  const look = DEFAULT_LOOK
  return {
    devices: [defaultDevice()],
    camera: { ...look.camera, panX: 0, panY: 0, rotateX: 0, rotateY: 0 },
    background: {
      type: 'studio',
      color: '#b8c4e8',
      gradient: { kind: 'linear', angle: 135, from: '#c7b9f0', to: '#9fc4ee' },
      mesh: { seed: 7, colors: ['#a18cd1', '#fbc2eb', '#8ec5fc', '#e0c3fc'] },
      sweep: { ...look.sweep },
      imageAssetId: null,
      blur: 0,
      brightness: 1,
      wallpaperId: WALLPAPERS[0].id,
      photoId: PRESET_PHOTOS[0].id,
    },
    environment: { ...look.env },
    ground: { ...look.ground },
    effects: {
      bloom: 0,
      noise: 0,
      vignette: 0,
      chromatic: 0,
      grade: { exposure: 1, contrast: 1, saturation: 1, temperature: 0 },
    },
  }
}

/** A shot around a scene, named for where it lands in the film. */
export function makeShot(scene: SceneState, index: number, durationMs = 3000): Shot {
  return {
    id: `shot_${uid()}`,
    name: `Shot ${index + 1}`,
    durationMs,
    scene,
    overlays: [],
    keyframes: [],
    transition: defaultTransition(),
  }
}

export function defaultProject(): ProjectDoc {
  const shot = makeShot(defaultScene(), 0)
  return {
    version: 3,
    name: 'Untitled Mockup',
    fps: 30,
    exportSize: { width: 1920, height: 1080 },
    shots: [shot],
    activeShotId: shot.id,
    assets: [],
  }
}

/**
 * Fold a pre-shots project into a one-shot film.
 *
 * Everything that used to sit on the document, the scene, its animation, its
 * overlays and its length, was always describing a single take; this gives that
 * take a name and a place in a sequence without changing a pixel of it.
 */
export function migrateProject(doc: ProjectDoc | ProjectDocV2): ProjectDoc {
  if ((doc as ProjectDoc).version === 3) return doc as ProjectDoc
  const old = doc as ProjectDocV2
  const shot: Shot = {
    id: `shot_${uid()}`,
    name: 'Shot 1',
    durationMs: old.durationMs ?? 3000,
    scene: old.scene,
    overlays: old.overlays ?? [],
    keyframes: old.keyframes ?? [],
    transition: defaultTransition(),
  }
  return {
    version: 3,
    name: old.name,
    fps: old.fps ?? 30,
    exportSize: old.exportSize ?? { width: 1920, height: 1080 },
    shots: [shot],
    activeShotId: shot.id,
    assets: old.assets ?? [],
  }
}

/**
 * Bring a loaded document up to the shape the app expects, shot by shot.
 *
 * Two jobs at once: fields that arrived after a save was written get their
 * fallback, and anything pointing at a file that no longer exists is unhooked,
 * so a project whose media was cleared opens on empty screens rather than on a
 * texture loader failing. Every shot gets the same treatment, because a
 * migrated project's second shot is as old as its first.
 */
export function repairShots(doc: ProjectDoc, runtime: Record<string, AssetRuntime>) {
  if (doc.shots.length === 0) doc.shots.push(makeShot(defaultScene(), 0))
  doc.shots.forEach((shot, i) => {
    shot.id ||= `shot_${uid()}`
    shot.name ||= `Shot ${i + 1}`
    shot.overlays ??= []
    shot.keyframes ??= []
    shot.transition ??= defaultTransition()
    shot.durationMs = Math.min(30000, Math.max(MIN_SHOT_MS, Math.round(shot.durationMs || 3000)))

    const scene = shot.scene
    // backfill color grade on projects saved before §6.6 landed
    if (!scene.effects.grade)
      scene.effects.grade = { exposure: 1, contrast: 1, saturation: 1, temperature: 0 }
    // drop the removed depth-of-field state from older saves
    delete (scene as { blur?: unknown }).blur
    // projects saved before the studio rig only carried the four intensities,
    // and had no sweep to fall back on
    scene.environment = { ...DEFAULT_LOOK.env, ...scene.environment }
    if (!scene.background.sweep) scene.background.sweep = { ...DEFAULT_LOOK.sweep }
    for (const dev of scene.devices)
      if (dev.screen.assetId && !runtime[dev.screen.assetId]) dev.screen.assetId = null
    if (scene.background.imageAssetId && !runtime[scene.background.imageAssetId])
      scene.background.imageAssetId = null
    if (scene.devices.length === 0) scene.devices.push(defaultDevice())
  })
  // the first shot has nothing to blend from
  doc.shots[0].transition = defaultTransition()
  if (!doc.shots.some((s) => s.id === doc.activeShotId)) doc.activeShotId = doc.shots[0].id
}
