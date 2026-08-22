import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { loadAsset, loadProjectJSON, saveAsset, saveProjectJSON } from './lib/db'
import { getTargetValue, sampleKeyframes, setTargetValue } from './lib/evaluator'
import { DEFAULT_DEVICE_ID, getDevice } from './lib/registry'
import { ANIMATION_PRESETS, TEMPLATES } from './lib/presets'
import { DEFAULT_LOOK, getLook } from './lib/studio'
import { NEUTRAL_GRADE } from './lib/grade'
import { coalesces, endEditRun } from './lib/history'
import { framingForDevices } from './lib/runtime'
import type {
  AssetMeta,
  AssetRuntime,
  BackgroundState,
  CameraState,
  DeviceInstance,
  EasingName,
  EffectsState,
  EnvironmentState,
  GradeState,
  GroundState,
  Keyframe,
  Overlay,
  ProjectDoc,
  SweepSpec,
  Vec3,
} from './types'

const uid = () => crypto.randomUUID()

export type DialogKind = 'export' | 'templates' | 'shortcuts' | null

export interface ExportProgress {
  label: string
  done: number
  total: number
}

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

export function defaultProject(): ProjectDoc {
  // A new project opens on a lit set rather than a flat gradient: the
  // three-point rig, its sweep, and the framing that setup was built around.
  const look = DEFAULT_LOOK
  return {
    version: 2,
    name: 'Untitled Mockup',
    durationMs: 3000,
    fps: 30,
    exportSize: { width: 1920, height: 1080 },
    scene: {
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
    },
    overlays: [],
    keyframes: [],
    assets: [],
  }
}

export type AppMode = 'home' | 'studio' | 'shots'

/** Sections of the left tool rail in Studio; each one opens the panel beside it. */
export type ToolSection = 'devices' | 'camera' | 'frame' | 'background' | 'add'

/** Sections of the left tool rail in Shots — the subject, and the canvas it sits on. */
export type ShotsSection = 'mockup' | 'frame'

/** Transform-gizmo mode, mirroring Blender's move/rotate/scale tools. */
export type GizmoMode = 'off' | 'translate' | 'rotate' | 'scale'

interface StudioState {
  hydrated: boolean
  theme: 'dark' | 'light'
  mode: AppMode
  /** left tool panel (the section chosen on the rail) visible */
  toolPanelOpen: boolean
  /** which rail section the tool panel is showing in Studio */
  toolSection: ToolSection
  /** which rail section the tool panel is showing in Shots */
  shotsSection: ShotsSection
  /** app menu sheet dropped down from the top (tools, theme, shortcuts) */
  sheetOpen: boolean
  /** right inspector panel visible */
  panelOpen: boolean
  /** bottom timeline expanded past its transport bar (collapsed by default) */
  timelineOpen: boolean
  /** Blender-style transform gizmo on the selected device ('off' = hidden) */
  gizmo: GizmoMode
  project: ProjectDoc
  assets: Record<string, AssetRuntime>
  selectedDeviceId: string | null
  selectedOverlayId: string | null
  selectedKeyframeIds: string[]
  timeMs: number
  playing: boolean
  loop: boolean
  dialog: DialogKind
  exportProgress: ExportProgress | null
  past: ProjectDoc[]
  future: ProjectDoc[]

  // history
  commit: (label: string) => void
  undo: () => void
  redo: () => void

  // project-level
  setProjectName: (name: string) => void
  setDuration: (ms: number) => void
  setFps: (fps: number) => void
  setExportSize: (width: number, height: number) => void
  newProject: () => void
  loadProjectDoc: (doc: ProjectDoc, assets: Record<string, AssetRuntime>) => void

  // animatable + scene setters
  setAnimatable: (target: string, value: number, label?: string) => void
  setCamera: (patch: Partial<CameraState>, label?: string) => void
  setBackground: (patch: Partial<BackgroundState>) => void
  /** apply a whole photographic setup: lights, sweep, shadow, grade, framing */
  applyStudioLook: (lookId: string, withCamera?: boolean) => void
  setSweep: (patch: Partial<SweepSpec>) => void
  setEnvironment: (patch: Partial<EnvironmentState>) => void
  setGround: (patch: Partial<GroundState>) => void
  setEffects: (patch: Partial<EffectsState>) => void
  setGrade: (patch: Partial<GradeState>) => void

  // devices
  addDevice: (modelId: string) => void
  removeDevice: (id: string) => void
  duplicateDevice: (id: string) => void
  updateDevice: (id: string, patch: Partial<Omit<DeviceInstance, 'transform' | 'screen'>>) => void
  updateDeviceScreen: (id: string, patch: Partial<DeviceInstance['screen']>) => void
  setDeviceTransform: (id: string, patch: { position?: Vec3; rotation?: Vec3; scale?: number }) => void
  selectDevice: (id: string | null) => void
  arrangeDevices: (mode: 'row' | 'fan' | 'stack') => void

  // media
  importMedia: (file: Blob, mime?: string) => Promise<void>
  importMediaFromURL: (url: string) => Promise<void>

  // overlays
  addOverlay: (o: Overlay) => void
  updateOverlay: (id: string, patch: Partial<Overlay>) => void
  removeOverlay: (id: string) => void
  selectOverlay: (id: string | null) => void

  // keyframes
  toggleTrack: (target: string) => void
  addKeyframeAt: (target: string, timeMs?: number) => void
  removeKeyframes: (ids: string[]) => void
  moveKeyframe: (id: string, timeMs: number) => void
  /** shift a whole selection, keeping relative spacing and staying in range */
  moveKeyframesBy: (ids: string[], deltaMs: number) => void
  setKeyframeEasing: (ids: string[], easing: EasingName) => void
  clearAllKeyframes: () => void
  selectKeyframes: (ids: string[]) => void
  applyAnimationPreset: (presetId: string) => void
  makeLoopFriendly: () => void

  // templates
  applyTemplate: (templateId: string) => void

  // playback
  setTime: (ms: number) => void
  setPlaying: (playing: boolean) => void
  setLoop: (loop: boolean) => void

  // ui
  setDialog: (d: DialogKind) => void
  setExportProgress: (p: ExportProgress | null) => void
  setTheme: (t: 'dark' | 'light') => void
  setMode: (m: AppMode) => void
  setToolPanelOpen: (v: boolean) => void
  /** click a rail section: focus it, or close the panel if it's already showing */
  toggleToolSection: (id: ToolSection) => void
  toggleShotsSection: (id: ShotsSection) => void
  /** move to a section without the toggle-shut behaviour, for the swipe pager */
  setShotsSection: (id: ShotsSection) => void
  setSheetOpen: (v: boolean) => void
  setPanelOpen: (v: boolean) => void
  setTimelineOpen: (v: boolean) => void
  setGizmo: (m: GizmoMode) => void
  /** bring every device back into frame, keeping the current angle */
  frameDevices: () => void

  hydrate: () => Promise<void>
}

const clone = (p: ProjectDoc): ProjectDoc => JSON.parse(JSON.stringify(p)) as ProjectDoc

async function metaForBlob(blob: Blob, mime: string): Promise<Pick<AssetMeta, 'kind' | 'w' | 'h'>> {
  if (mime.startsWith('video/')) {
    const url = URL.createObjectURL(blob)
    try {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.src = url
      await new Promise<void>((res, rej) => {
        v.onloadedmetadata = () => res()
        v.onerror = () => rej(new Error('video metadata failed'))
      })
      return { kind: 'video', w: v.videoWidth || 1920, h: v.videoHeight || 1080 }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  try {
    const bmp = await createImageBitmap(blob)
    const meta = { kind: 'image' as const, w: bmp.width, h: bmp.height }
    bmp.close()
    return meta
  } catch {
    // SVG fallback
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return { kind: 'image', w: img.naturalWidth || 1024, h: img.naturalHeight || 1024 }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

export const useStudio = create<StudioState>()(
  immer((set, get) => ({
    hydrated: false,
    theme: 'dark',
    mode: 'studio',
    toolPanelOpen: localStorage.getItem('ms-tool-panel') !== 'closed',
    // 'studio' was its own section before the looks moved in beside the backdrop
    toolSection: ((v) => (v === 'studio' ? 'background' : v) ?? 'devices')(
      localStorage.getItem('ms-tool-section') as ToolSection | 'studio' | null,
    ),
    shotsSection: (localStorage.getItem('ms-shots-section') as ShotsSection | null) ?? 'mockup',
    sheetOpen: false,
    panelOpen: localStorage.getItem('ms-panel') !== 'closed',
    timelineOpen: localStorage.getItem('ms-timeline') === 'open',
    gizmo: 'off',
    project: defaultProject(),
    assets: {},
    selectedDeviceId: null,
    selectedOverlayId: null,
    selectedKeyframeIds: [],
    timeMs: 0,
    playing: false,
    loop: true,
    dialog: null,
    exportProgress: null,
    past: [],
    future: [],

    commit: (label) => {
      // a continuing gesture folds into the entry already on the stack
      if (coalesces(label)) return
      set((s) => {
        s.past.push(clone(s.project))
        if (s.past.length > 60) s.past.shift()
        s.future = []
      })
    },

    undo: () => {
      endEditRun()
      set((s) => {
        const prev = s.past.pop()
        if (!prev) return
        s.future.push(clone(s.project))
        s.project = prev
        s.selectedKeyframeIds = []
        if (s.selectedDeviceId && !prev.scene.devices.some((d) => d.id === s.selectedDeviceId))
          s.selectedDeviceId = prev.scene.devices[0]?.id ?? null
        if (s.selectedOverlayId && !prev.overlays.some((o) => o.id === s.selectedOverlayId))
          s.selectedOverlayId = null
      })
    },

    redo: () => {
      endEditRun()
      set((s) => {
        const next = s.future.pop()
        if (!next) return
        s.past.push(clone(s.project))
        s.project = next
        s.selectedKeyframeIds = []
      })
    },

    setProjectName: (name) => set((s) => void (s.project.name = name)),

    setDuration: (ms) => {
      get().commit('duration')
      set((s) => {
        s.project.durationMs = Math.min(30000, Math.max(500, Math.round(ms)))
        if (s.timeMs > s.project.durationMs) s.timeMs = s.project.durationMs
      })
    },

    setFps: (fps) => set((s) => void (s.project.fps = fps)),

    setExportSize: (width, height) => {
      get().commit('export-size')
      set((s) => {
        s.project.exportSize = {
          width: Math.min(7680, Math.max(64, Math.round(width))),
          height: Math.min(7680, Math.max(64, Math.round(height))),
        }
      })
    },

    newProject: () => {
      get().commit('new-project')
      set((s) => {
        s.project = defaultProject()
        s.selectedDeviceId = s.project.scene.devices[0]?.id ?? null
        s.selectedOverlayId = null
        s.selectedKeyframeIds = []
        s.timeMs = 0
        s.playing = false
      })
    },

    loadProjectDoc: (doc, assets) => {
      get().commit('import-project')
      set((s) => {
        s.project = doc
        s.assets = { ...s.assets, ...assets }
        s.selectedDeviceId = doc.scene.devices[0]?.id ?? null
        s.selectedOverlayId = null
        s.selectedKeyframeIds = []
        s.timeMs = 0
        s.playing = false
      })
    },

    setAnimatable: (target, value, label = target) => {
      get().commit(label)
      set((s) => {
        const kfs = s.project.keyframes.filter((k) => k.target === target)
        if (kfs.length > 0) {
          const t = s.timeMs
          const existing = kfs.find((k) => Math.abs(k.timeMs - t) <= 1)
          if (existing) existing.value = value
          else
            s.project.keyframes.push({
              id: `kf_${uid()}`,
              target,
              timeMs: t,
              value,
              easing: 'smooth',
            })
        }
        // Always write the live scene value too — a keyframe just landed exactly
        // at the current time, so this matches what re-sampling would produce,
        // and it keeps the slider/viewport from freezing on tracked properties.
        setTargetValue(s.project.scene, target, value)
      })
    },

    setCamera: (patch, label = 'camera') => {
      get().commit(label)
      set((s) => {
        Object.assign(s.project.scene.camera, patch)
        // If any of these camera properties are animated, applyAtTime() would
        // re-sample the keyframe and clobber the value we just wrote (making
        // presets look dead). Land a keyframe at the playhead for tracked props.
        const t = s.timeMs
        for (const key of Object.keys(patch)) {
          const target = `camera.${key}`
          const kfs = s.project.keyframes.filter((k) => k.target === target)
          if (kfs.length === 0) continue
          const value = (patch as Record<string, number>)[key]
          const existing = kfs.find((k) => Math.abs(k.timeMs - t) <= 1)
          if (existing) existing.value = value
          else s.project.keyframes.push({ id: `kf_${uid()}`, target, timeMs: t, value, easing: 'smooth' })
        }
      })
    },

    setBackground: (patch) => {
      get().commit('background')
      set((s) => {
        Object.assign(s.project.scene.background, patch)
      })
    },
    setEnvironment: (patch) => {
      get().commit('environment')
      set((s) => {
        Object.assign(s.project.scene.environment, patch)
      })
    },

    applyStudioLook: (lookId, withCamera = true) => {
      const look = getLook(lookId)
      if (!look) return
      get().commit(`look-${lookId}`)
      set((s) => {
        s.project.scene.environment = { ...look.env }
        s.project.scene.ground = { ...look.ground }
        s.project.scene.background.type = 'studio'
        s.project.scene.background.sweep = { ...look.sweep }
        // a look owns the mood effects, so switching setups never leaves the
        // last one's bloom behind; grain and fringe stay as the user set them
        Object.assign(s.project.scene.effects, {
          bloom: 0,
          vignette: 0,
          ...look.effects,
        })
        s.project.scene.effects.grade = { ...NEUTRAL_GRADE, ...look.grade }
        if (withCamera) Object.assign(s.project.scene.camera, look.camera)
      })
    },

    setSweep: (patch) => {
      get().commit('sweep')
      set((s) => {
        Object.assign(s.project.scene.background.sweep, patch)
        s.project.scene.background.type = 'studio'
      })
    },
    setGround: (patch) => {
      get().commit('ground')
      set((s) => {
        Object.assign(s.project.scene.ground, patch)
      })
    },
    setEffects: (patch) => {
      get().commit('effects')
      set((s) => {
        Object.assign(s.project.scene.effects, patch)
      })
    },
    setGrade: (patch) => {
      get().commit('grade')
      set((s) => {
        Object.assign(s.project.scene.effects.grade, patch)
      })
    },

    addDevice: (modelId) => {
      get().commit('add-device')
      set((s) => {
        const spec = getDevice(modelId)
        const n = s.project.scene.devices.length
        const dev: DeviceInstance = {
          id: `dev_${uid()}`,
          modelId,
          colorVariant: spec.colors[0]?.id ?? 'black',
          orientation: spec.screenAspect < 1 ? 'portrait' : 'landscape',
          transform: { position: [n * 1.3, 0, -n * 0.15], rotation: [0, 0, 0], scale: 1 },
          screen: { assetId: null, fit: 'cover', scroll: 0 },
        }
        s.project.scene.devices.push(dev)
        s.selectedDeviceId = dev.id
      })
    },

    removeDevice: (id) => {
      get().commit('remove-device')
      set((s) => {
        if (s.project.scene.devices.length <= 1) return
        s.project.scene.devices = s.project.scene.devices.filter((d) => d.id !== id)
        s.project.keyframes = s.project.keyframes.filter((k) => !k.target.startsWith(`dev.${id}.`))
        if (s.selectedDeviceId === id) s.selectedDeviceId = s.project.scene.devices[0]?.id ?? null
      })
    },

    duplicateDevice: (id) => {
      get().commit('duplicate-device')
      set((s) => {
        const src = s.project.scene.devices.find((d) => d.id === id)
        if (!src) return
        const copy: DeviceInstance = JSON.parse(JSON.stringify(src))
        copy.id = `dev_${uid()}`
        copy.transform.position = [
          src.transform.position[0] + 0.9,
          src.transform.position[1],
          src.transform.position[2] - 0.2,
        ]
        s.project.scene.devices.push(copy)
        s.selectedDeviceId = copy.id
      })
    },

    updateDevice: (id, patch) => {
      get().commit('update-device')
      set((s) => {
        const dev = s.project.scene.devices.find((d) => d.id === id)
        if (dev) Object.assign(dev, patch)
      })
    },

    updateDeviceScreen: (id, patch) => {
      get().commit('device-screen')
      set((s) => {
        const dev = s.project.scene.devices.find((d) => d.id === id)
        if (dev) Object.assign(dev.screen, patch)
      })
    },

    setDeviceTransform: (id, patch) => {
      get().commit('device-transform')
      set((s) => {
        const dev = s.project.scene.devices.find((d) => d.id === id)
        if (!dev) return
        if (patch.position) dev.transform.position = patch.position
        if (patch.rotation) dev.transform.rotation = patch.rotation
        if (patch.scale !== undefined) dev.transform.scale = patch.scale
      })
    },

    selectDevice: (id) => set((s) => void (s.selectedDeviceId = id)),

    arrangeDevices: (mode) => {
      get().commit('arrange')
      set((s) => {
        const devs = s.project.scene.devices
        const n = devs.length
        devs.forEach((d, i) => {
          const c = i - (n - 1) / 2
          if (mode === 'row') {
            d.transform.position = [c * 1.35, 0, 0]
            d.transform.rotation = [0, 0, 0]
          } else if (mode === 'fan') {
            d.transform.position = [c * 1.2, 0, -Math.abs(c) * 0.35]
            d.transform.rotation = [0, -c * 16, 0]
          } else {
            d.transform.position = [c * 0.45, 0, -i * 0.5]
            d.transform.rotation = [0, c * 6, 0]
          }
        })
      })
    },

    importMedia: async (file, mime) => {
      const type = mime ?? (file instanceof File ? file.type : 'image/png')
      const meta = await metaForBlob(file, type)
      const id = `asset_${uid()}`
      await saveAsset(id, file)
      const url = URL.createObjectURL(file)
      get().commit('import-media')
      set((s) => {
        s.project.assets.push({ id, kind: meta.kind, mime: type, w: meta.w, h: meta.h })
        s.assets[id] = { url, kind: meta.kind }
        const dev =
          s.project.scene.devices.find((d) => d.id === s.selectedDeviceId) ??
          s.project.scene.devices[0]
        if (dev) {
          dev.screen.assetId = id
          dev.screen.scroll = 0
        }
      })
    },

    importMediaFromURL: async (url) => {
      const res = await fetch(url, { mode: 'cors' })
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
      const blob = await res.blob()
      if (!/^(image|video)\//.test(blob.type)) throw new Error('URL is not an image or video')
      await get().importMedia(blob, blob.type)
    },

    addOverlay: (o) => {
      get().commit('add-overlay')
      set((s) => {
        s.project.overlays.push(o)
        s.selectedOverlayId = o.id
      })
    },

    updateOverlay: (id, patch) => {
      get().commit('update-overlay')
      set((s) => {
        const o = s.project.overlays.find((x) => x.id === id)
        if (o) Object.assign(o, patch)
      })
    },

    removeOverlay: (id) => {
      get().commit('remove-overlay')
      set((s) => {
        s.project.overlays = s.project.overlays.filter((o) => o.id !== id)
        if (s.selectedOverlayId === id) s.selectedOverlayId = null
      })
    },

    selectOverlay: (id) => set((s) => void (s.selectedOverlayId = id)),

    toggleTrack: (target) => {
      get().commit('toggle-track')
      set((s) => {
        const kfs = s.project.keyframes.filter((k) => k.target === target)
        if (kfs.length > 0) {
          // bake evaluated value at playhead into base, then remove the track
          const sampled = sampleKeyframes(kfs, s.timeMs).get(target)
          if (sampled !== undefined) setTargetValue(s.project.scene, target, sampled)
          s.project.keyframes = s.project.keyframes.filter((k) => k.target !== target)
          s.selectedKeyframeIds = s.selectedKeyframeIds.filter((id) =>
            s.project.keyframes.some((k) => k.id === id),
          )
        } else {
          s.project.keyframes.push({
            id: `kf_${uid()}`,
            target,
            timeMs: s.timeMs,
            value: getTargetValue(s.project.scene, target),
            easing: 'smooth',
          })
        }
      })
    },

    addKeyframeAt: (target, timeMs) => {
      get().commit('add-kf')
      set((s) => {
        const t = timeMs ?? s.timeMs
        const kfs = s.project.keyframes.filter((k) => k.target === target)
        const value =
          kfs.length > 0
            ? (sampleKeyframes(kfs, t).get(target) ?? getTargetValue(s.project.scene, target))
            : getTargetValue(s.project.scene, target)
        const existing = kfs.find((k) => Math.abs(k.timeMs - t) <= 1)
        if (existing) existing.value = value
        else s.project.keyframes.push({ id: `kf_${uid()}`, target, timeMs: t, value, easing: 'smooth' })
      })
    },

    removeKeyframes: (ids) => {
      get().commit('remove-kf')
      set((s) => {
        s.project.keyframes = s.project.keyframes.filter((k) => !ids.includes(k.id))
        s.selectedKeyframeIds = s.selectedKeyframeIds.filter((id) => !ids.includes(id))
      })
    },

    moveKeyframe: (id, timeMs) => {
      get().commit('move-kf')
      set((s) => {
        const kf = s.project.keyframes.find((k) => k.id === id)
        if (kf) kf.timeMs = Math.min(s.project.durationMs, Math.max(0, Math.round(timeMs)))
      })
    },

    moveKeyframesBy: (ids, deltaMs) => {
      if (ids.length === 0 || deltaMs === 0) return
      get().commit('move-kf')
      set((s) => {
        const moving = s.project.keyframes.filter((k) => ids.includes(k.id))
        if (moving.length === 0) return
        // clamp the delta against the group's own bounds so the shape of a
        // multi-keyframe selection survives a drag into either end
        const lo = Math.min(...moving.map((k) => k.timeMs))
        const hi = Math.max(...moving.map((k) => k.timeMs))
        const d = Math.round(Math.min(s.project.durationMs - hi, Math.max(-lo, deltaMs)))
        for (const k of moving) k.timeMs += d
      })
    },

    setKeyframeEasing: (ids, easing) => {
      get().commit('kf-easing')
      set((s) => {
        for (const k of s.project.keyframes) if (ids.includes(k.id)) k.easing = easing
      })
    },

    clearAllKeyframes: () => {
      get().commit('clear-kf')
      set((s) => {
        s.project.keyframes = []
        s.selectedKeyframeIds = []
      })
    },

    selectKeyframes: (ids) => set((s) => void (s.selectedKeyframeIds = ids)),

    applyAnimationPreset: (presetId) => {
      const preset = ANIMATION_PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      get().commit('anim-preset')
      set((s) => {
        const cam = s.project.scene.camera
        const built = preset.build({ ...cam }, s.project.durationMs)
        const targets = new Set(built.map((k) => k.target))
        s.project.keyframes = s.project.keyframes.filter((k) => !targets.has(k.target))
        for (const k of built) s.project.keyframes.push({ ...k, id: `kf_${uid()}` })
      })
    },

    makeLoopFriendly: () => {
      get().commit('loopify')
      set((s) => {
        const byTarget = new Map<string, Keyframe[]>()
        for (const k of s.project.keyframes) {
          const arr = byTarget.get(k.target) ?? []
          arr.push(k)
          byTarget.set(k.target, arr)
        }
        for (const [target, arr] of byTarget) {
          arr.sort((a, b) => a.timeMs - b.timeMs)
          const first = arr[0]
          const last = arr[arr.length - 1]
          if (last.timeMs >= s.project.durationMs - 1) last.value = first.value
          else
            s.project.keyframes.push({
              id: `kf_${uid()}`,
              target,
              timeMs: s.project.durationMs,
              value: first.value,
              easing: first.easing,
            })
        }
      })
    },

    applyTemplate: (templateId) => {
      const tpl = TEMPLATES.find((t) => t.id === templateId)
      if (!tpl) return
      get().commit('template')
      set((s) => {
        const currentAsset =
          s.project.scene.devices.find((d) => d.id === s.selectedDeviceId)?.screen.assetId ??
          s.project.scene.devices.find((d) => d.screen.assetId)?.screen.assetId ??
          null
        tpl.apply(s.project)
        if (currentAsset && s.project.scene.devices[0])
          s.project.scene.devices[0].screen.assetId = currentAsset
        s.selectedDeviceId = s.project.scene.devices[0]?.id ?? null
        s.selectedKeyframeIds = []
        s.timeMs = 0
        s.dialog = null
      })
    },

    setTime: (ms) =>
      set((s) => {
        s.timeMs = Math.min(s.project.durationMs, Math.max(0, ms))
      }),
    setPlaying: (playing) => set((s) => void (s.playing = playing)),
    setLoop: (loop) => set((s) => void (s.loop = loop)),

    setDialog: (d) => set((s) => void (s.dialog = d)),
    setExportProgress: (p) => set((s) => void (s.exportProgress = p)),
    setTheme: (t) => {
      localStorage.setItem('ms-theme', t)
      set((s) => void (s.theme = t))
    },
    setMode: (m) => {
      localStorage.setItem('ms-mode', m)
      set((s) => void (s.mode = m))
    },
    setToolPanelOpen: (v) => {
      localStorage.setItem('ms-tool-panel', v ? 'open' : 'closed')
      set((s) => void (s.toolPanelOpen = v))
    },
    toggleToolSection: (id) => {
      const close = get().toolPanelOpen && get().toolSection === id
      localStorage.setItem('ms-tool-panel', close ? 'closed' : 'open')
      localStorage.setItem('ms-tool-section', id)
      set((s) => {
        s.toolSection = id
        s.toolPanelOpen = !close
      })
    },
    setShotsSection: (id) => {
      if (get().shotsSection === id) return
      localStorage.setItem('ms-shots-section', id)
      set((s) => void (s.shotsSection = id))
    },

    toggleShotsSection: (id) => {
      const close = get().toolPanelOpen && get().shotsSection === id
      localStorage.setItem('ms-tool-panel', close ? 'closed' : 'open')
      localStorage.setItem('ms-shots-section', id)
      set((s) => {
        s.shotsSection = id
        s.toolPanelOpen = !close
      })
    },
    setSheetOpen: (v) => set((s) => void (s.sheetOpen = v)),
    setPanelOpen: (v) => {
      localStorage.setItem('ms-panel', v ? 'open' : 'closed')
      set((s) => void (s.panelOpen = v))
    },
    setTimelineOpen: (v) => {
      localStorage.setItem('ms-timeline', v ? 'open' : 'closed')
      set((s) => void (s.timelineOpen = v))
    },
    setGizmo: (m) => set((s) => void (s.gizmo = m)),

    frameDevices: () => {
      const fit = framingForDevices(get().project.scene.camera.fov)
      if (!fit) return
      get().setCamera(fit, 'cam-frame')
    },

    hydrate: async () => {
      try {
        const theme = localStorage.getItem('ms-theme') === 'light' ? 'light' : 'dark'
        const savedMode = localStorage.getItem('ms-mode')
        const mode: AppMode = savedMode === 'shots' || savedMode === 'studio' ? savedMode : 'home'
        set((s) => {
          s.theme = theme
          s.mode = mode
        })
        const saved = await loadProjectJSON<ProjectDoc & { version: number }>()
        if (saved && saved.version === 2) {
          const runtime: Record<string, AssetRuntime> = {}
          const alive: AssetMeta[] = []
          for (const meta of saved.assets) {
            const blob = await loadAsset(meta.id)
            if (blob) {
              runtime[meta.id] = { url: URL.createObjectURL(blob), kind: meta.kind }
              alive.push(meta)
            }
          }
          saved.assets = alive
          // migration: backfill color grade on projects saved before §6.6 landed
          if (!saved.scene.effects.grade)
            saved.scene.effects.grade = { exposure: 1, contrast: 1, saturation: 1, temperature: 0 }
          // drop the removed depth-of-field state from older saves
          delete (saved.scene as { blur?: unknown }).blur
          // migration: projects saved before the studio rig only carried the
          // four intensities, and had no sweep to fall back on
          saved.scene.environment = { ...DEFAULT_LOOK.env, ...saved.scene.environment }
          if (!saved.scene.background.sweep)
            saved.scene.background.sweep = { ...DEFAULT_LOOK.sweep }
          for (const dev of saved.scene.devices)
            if (dev.screen.assetId && !runtime[dev.screen.assetId]) dev.screen.assetId = null
          if (saved.scene.background.imageAssetId && !runtime[saved.scene.background.imageAssetId])
            saved.scene.background.imageAssetId = null
          if (saved.scene.devices.length === 0) saved.scene.devices.push(defaultDevice())
          set((s) => {
            s.project = saved
            s.assets = runtime
            s.selectedDeviceId = saved.scene.devices[0]?.id ?? null
          })
        }
      } catch (err) {
        console.warn('hydrate failed, starting fresh', err)
      } finally {
        set((s) => {
          s.hydrated = true
          s.selectedDeviceId ??= s.project.scene.devices[0]?.id ?? null
        })
      }
    },
  })),
)

export async function persistProject() {
  const s = useStudio.getState()
  await saveProjectJSON(JSON.parse(JSON.stringify(s.project)))
}

// Debounced autosave (PRD §6.11)
let autosaveTimer: ReturnType<typeof setTimeout> | undefined
let lastProject: ProjectDoc | null = null
useStudio.subscribe((state) => {
  if (!state.hydrated || state.project === lastProject) return
  lastProject = state.project
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => void persistProject(), 600)
})

/** Same picker, but hands back every file chosen. */
export function pickMediaFiles(onFiles: (files: File[]) => void, acceptVideo = true) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = acceptVideo
    ? 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm'
    : 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'
  input.onchange = () => {
    const files = Array.from(input.files ?? [])
    if (files.length > 0) onFiles(files)
  }
  input.click()
}

export function pickMediaFile(onFile: (file: File) => void, acceptVideo = true) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = acceptVideo
    ? 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm'
    : 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'
  input.onchange = () => {
    const f = input.files?.[0]
    if (f) onFile(f)
  }
  input.click()
}

/** Serialize project + asset blobs to a portable .mockup.json (PRD §6.11). */
export async function exportProjectFile() {
  const s = useStudio.getState()
  const blobs: Record<string, string> = {}
  for (const meta of s.project.assets) {
    const blob = await loadAsset(meta.id)
    if (!blob) continue
    blobs[meta.id] = await new Promise<string>((res) => {
      const r = new FileReader()
      r.onload = () => res(r.result as string)
      r.readAsDataURL(blob)
    })
  }
  const payload = JSON.stringify({ project: s.project, blobs })
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${s.project.name.replace(/[^\w-]+/g, '_') || 'project'}.mockup.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function importProjectFile(file: File) {
  const text = await file.text()
  const parsed = JSON.parse(text) as { project: ProjectDoc; blobs: Record<string, string> }
  if (parsed.project?.version !== 2) throw new Error('Unsupported project file')
  if (!parsed.project.scene.effects.grade)
    parsed.project.scene.effects.grade = { exposure: 1, contrast: 1, saturation: 1, temperature: 0 }
  delete (parsed.project.scene as { blur?: unknown }).blur
  const runtime: Record<string, AssetRuntime> = {}
  for (const meta of parsed.project.assets) {
    const dataUrl = parsed.blobs[meta.id]
    if (!dataUrl) continue
    const blob = await (await fetch(dataUrl)).blob()
    await saveAsset(meta.id, blob)
    runtime[meta.id] = { url: URL.createObjectURL(blob), kind: meta.kind }
  }
  useStudio.getState().loadProjectDoc(parsed.project, runtime)
}
