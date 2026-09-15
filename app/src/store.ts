import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { loadAsset, loadProjectJSON, saveAsset, saveProjectJSON } from './lib/db'
import { ui } from './lib/ui'
import { track } from './lib/analytics'
import { getTargetValue, sampleKeyframes, setTargetValue } from './lib/evaluator'
import { getDevice } from './lib/registry'
import { ANIMATION_PRESETS, TEMPLATES } from './lib/presets'
import { getLook } from './lib/studio'
import { NEUTRAL_GRADE } from './lib/grade'
import { coalesces, endEditRun, patchLabel } from './lib/history'
import { framingForDevices, rt } from './lib/runtime'
import { defaultPortrait, type Portrait } from './lib/portrait'
import {
  defaultProject,
  defaultScene,
  makeShot,
  migrateProject,
  repairShots,
} from './lib/project'
import {
  activeShot,
  defaultTransition,
  MAX_SHOTS,
  MAX_TRANSITION_MS,
  MIN_SHOT_MS,
  resolveSequence,
  sequenceDuration,
  shotStart,
} from './lib/sequence'
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
  ProjectDocV2,
  Shot,
  SweepSpec,
  Transition,
  Vec3,
} from './types'

const uid = () => crypto.randomUUID()

/**
 * The shot every scene edit lands on.
 *
 * Scene state used to live on the document, so the whole store wrote to
 * `project.scene`. It now lives on the active shot and this is the one hop
 * that gets it: every setter goes through here rather than reaching for a shot
 * by index, so "which take am I editing" has exactly one answer.
 */
const cur = activeShot

/** How many files the media tray holds. */
export const MAX_SCREEN_MEDIA = 5

/**
 * The files the tray offers, which is every asset that was imported to go on a
 * screen. Assets saved before the tray existed carry no role and are read as
 * screen media, which is what hydrate backfills them as.
 */
export const screenMedia = (assets: AssetMeta[]) => assets.filter((a) => a.role !== 'scene')

export type DialogKind = 'export' | 'templates' | 'shortcuts' | null

export interface ExportProgress {
  label: string
  done: number
  total: number
}

export type AppMode = 'home' | 'studio' | 'shots' | 'draw' | 'ascii' | 'signal'

/** Sections of the left tool rail in Studio; each one opens the panel beside it. */
export type ToolSection = 'devices' | 'camera' | 'frame' | 'background' | 'add'

/** Sections of the left tool rail in Shots, the subject, and the canvas it sits on. */
export type ShotsSection = 'mockup' | 'frame'

/** Transform-gizmo mode, mirroring Blender's move/rotate/scale tools. */
export type GizmoMode = 'off' | 'translate' | 'rotate' | 'scale'

/** Whether the transport runs one shot or the whole compiled film. */
export type ScrubMode = 'shot' | 'sequence'

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
  /** the focal rings are up, so the focus can be dragged on the picture */
  focusGuide: boolean
  selectedOverlayId: string | null
  selectedKeyframeIds: string[]
  /** playhead *within the active shot*; the film's own clock is derived */
  timeMs: number
  playing: boolean
  loop: boolean
  /**
   * What the transport moves through: one shot, or the whole compiled film.
   * Editor state, never saved, because it is a way of looking rather than
   * anything about the project.
   */
  scrubMode: ScrubMode
  /**
   * Last frame seen of each shot, as a small data URL, keyed by shot id.
   * Runtime only: these are re-taken as you work, and baking them into the
   * document would multiply its size for something a render gives back free.
   */
  shotThumbs: Record<string, string>
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
  setPortrait: (patch: Partial<Portrait>) => void
  /** show the focal rings over the viewport; editor state, never saved */
  setFocusGuide: (visible: boolean) => void

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
  /**
   * Bring a file in as an asset.
   *
   * `bind` (the default) also drops it onto the selected device's screen,
   * which is what an upload from the Source panel or a drop on the canvas
   * means. Backgrounds and logos pass `false`: they are not screen media, and
   * binding them first only to unbind them afterwards destroyed whatever
   * screenshot the device was already showing.
   */
  importMedia: (file: Blob, mime?: string, opts?: { bind?: boolean }) => Promise<void>
  /** drop a file from the tray, unbinding whatever was pointing at it */
  removeAsset: (id: string) => void
  importMediaFromURL: (url: string, opts?: { bind?: boolean }) => Promise<void>

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

  // shots
  /** add a shot after the active one; copies it unless `blank` */
  addShot: (opts?: { blank?: boolean }) => void
  duplicateShot: (id: string) => void
  removeShot: (id: string) => void
  renameShot: (id: string, name: string) => void
  /** move a shot to another slot in the film */
  moveShot: (id: string, toIndex: number) => void
  /** make a shot the one being edited, parking the playhead at `atMs` into it */
  selectShot: (id: string, atMs?: number) => void
  setShotDuration: (id: string, ms: number) => void
  setTransition: (id: string, patch: Partial<Transition>) => void
  /** take a still of the live viewport for the ribbon; no-op without a renderer */
  captureShotThumb: (id?: string) => void
  /** switch shots for a render pass: no history, no playhead reset */
  activateForRender: (id: string) => void

  // playback
  setTime: (ms: number) => void
  /** scrub the film: picks the shot showing at `ms` and seeks inside it */
  setGlobalTime: (ms: number) => void
  setScrubMode: (m: ScrubMode) => void
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

/** Widest a ribbon thumbnail gets drawn; its height follows the frame's aspect. */
const THUMB_W = 192

/**
 * A still of whatever the viewport last drew, small enough to keep in memory.
 *
 * Only the 3D canvas, which is transparent where the backdrop shows through.
 * The ribbon paints each shot's own background behind the image with the same
 * CSS the viewport uses, so a chip stays truthful about the backdrop without
 * this having to re-run the exporter's compositing every time you change shots.
 */
function captureViewportThumb(): string | null {
  const src = rt.gl?.domElement
  if (!src || src.width === 0 || src.height === 0) return null
  try {
    const c = document.createElement('canvas')
    c.width = THUMB_W
    c.height = Math.max(1, Math.round((THUMB_W * src.height) / src.width))
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(src, 0, 0, c.width, c.height)
    return c.toDataURL('image/png')
  } catch {
    // a tainted or lost context is not worth failing a shot switch over
    return null
  }
}

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
    focusGuide: true,
    selectedOverlayId: null,
    selectedKeyframeIds: [],
    timeMs: 0,
    playing: false,
    loop: true,
    scrubMode: 'shot',
    shotThumbs: {},
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
        const shot = cur(prev)
        if (s.selectedDeviceId && !shot.scene.devices.some((d) => d.id === s.selectedDeviceId))
          s.selectedDeviceId = shot.scene.devices[0]?.id ?? null
        if (s.selectedOverlayId && !shot.overlays.some((o) => o.id === s.selectedOverlayId))
          s.selectedOverlayId = null
        if (s.timeMs > shot.durationMs) s.timeMs = shot.durationMs
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

    /** Length of the shot on screen. The film's length is the sum of these. */
    setDuration: (ms) => get().setShotDuration(get().project.activeShotId, ms),

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
      track('project_created')
      get().commit('new-project')
      set((s) => {
        s.project = defaultProject()
        s.selectedDeviceId = cur(s.project).scene.devices[0]?.id ?? null
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
        s.shotThumbs = {}
        s.selectedDeviceId = cur(doc).scene.devices[0]?.id ?? null
        s.selectedOverlayId = null
        s.selectedKeyframeIds = []
        s.timeMs = 0
        s.playing = false
      })
    },

    setAnimatable: (target, value, label = target) => {
      get().commit(label)
      set((s) => {
        const kfs = cur(s.project).keyframes.filter((k) => k.target === target)
        if (kfs.length > 0) {
          const t = s.timeMs
          const existing = kfs.find((k) => Math.abs(k.timeMs - t) <= 1)
          if (existing) existing.value = value
          else
            cur(s.project).keyframes.push({
              id: `kf_${uid()}`,
              target,
              timeMs: t,
              value,
              easing: 'smooth',
            })
        }
        // Always write the live scene value too, a keyframe just landed exactly
        // at the current time, so this matches what re-sampling would produce,
        // and it keeps the slider/viewport from freezing on tracked properties.
        setTargetValue(cur(s.project).scene, target, value)
      })
    },

    setCamera: (patch, label = 'camera') => {
      get().commit(label)
      set((s) => {
        Object.assign(cur(s.project).scene.camera, patch)
        // If any of these camera properties are animated, applyAtTime() would
        // re-sample the keyframe and clobber the value we just wrote (making
        // presets look dead). Land a keyframe at the playhead for tracked props.
        const t = s.timeMs
        for (const key of Object.keys(patch)) {
          const target = `camera.${key}`
          const kfs = cur(s.project).keyframes.filter((k) => k.target === target)
          if (kfs.length === 0) continue
          const value = (patch as Record<string, number>)[key]
          const existing = kfs.find((k) => Math.abs(k.timeMs - t) <= 1)
          if (existing) existing.value = value
          else cur(s.project).keyframes.push({ id: `kf_${uid()}`, target, timeMs: t, value, easing: 'smooth' })
        }
      })
    },

    setBackground: (patch) => {
      get().commit('background')
      set((s) => {
        Object.assign(cur(s.project).scene.background, patch)
      })
    },
    setEnvironment: (patch) => {
      get().commit('environment')
      set((s) => {
        Object.assign(cur(s.project).scene.environment, patch)
      })
    },

    applyStudioLook: (lookId, withCamera = true) => {
      const look = getLook(lookId)
      if (!look) return
      track('studio_look_applied', { look_id: lookId, with_camera: withCamera })
      get().commit(`look-${lookId}`)
      set((s) => {
        cur(s.project).scene.environment = { ...look.env }
        cur(s.project).scene.ground = { ...look.ground }
        /*
         * The look owns the sweep, always, so switching setups and then going
         * back to the paper gets the paper that setup was designed around.
         *
         * It no longer switches the backdrop *to* the sweep, though. Once the
         * catalog grew photos and gradients, forcing the type here meant
         * reaching for a different key light silently threw away the backdrop
         * you had chosen, which is not what relighting means. The Background
         * tab is one click away when you do want the paper back.
         */
        cur(s.project).scene.background.sweep = { ...look.sweep }
        // a look owns the mood effects, so switching setups never leaves the
        // last one's bloom behind; grain and fringe stay as the user set them
        Object.assign(cur(s.project).scene.effects, {
          bloom: 0,
          vignette: 0,
          ...look.effects,
        })
        cur(s.project).scene.effects.grade = { ...NEUTRAL_GRADE, ...look.grade }
        if (withCamera) Object.assign(cur(s.project).scene.camera, look.camera)
      })
    },

    setSweep: (patch) => {
      get().commit('sweep')
      set((s) => {
        Object.assign(cur(s.project).scene.background.sweep, patch)
        cur(s.project).scene.background.type = 'studio'
      })
    },
    setGround: (patch) => {
      get().commit('ground')
      set((s) => {
        Object.assign(cur(s.project).scene.ground, patch)
      })
    },
    setEffects: (patch) => {
      get().commit('effects')
      set((s) => {
        Object.assign(cur(s.project).scene.effects, patch)
      })
    },
    /*
     * Adjusting the focus brings its rings back rather than leaving the user to
     * find the button: every field here is about where the focus sits, and none
     * of them can be judged without seeing it.
     */
    setPortrait: (patch) => {
      // labelled per property, so dragging Focus and then Falloff is two
      // undo entries rather than one merged blur of both
      get().commit(patchLabel('portrait', patch))
      set((s) => {
        const fx = cur(s.project).scene.effects
        fx.portrait = { ...defaultPortrait(), ...fx.portrait, ...patch }
        s.focusGuide = true
      })
    },

    setFocusGuide: (visible) => set((s) => void (s.focusGuide = visible)),

    setGrade: (patch) => {
      get().commit('grade')
      set((s) => {
        Object.assign(cur(s.project).scene.effects.grade, patch)
      })
    },

    addDevice: (modelId) => {
      track('device_added', { model_id: modelId, count: cur(get().project).scene.devices.length + 1 })
      get().commit('add-device')
      set((s) => {
        const spec = getDevice(modelId)
        const n = cur(s.project).scene.devices.length
        const dev: DeviceInstance = {
          id: `dev_${uid()}`,
          modelId,
          colorVariant: spec.colors[0]?.id ?? 'black',
          orientation: spec.screenAspect < 1 ? 'portrait' : 'landscape',
          transform: { position: [n * 1.3, 0, -n * 0.15], rotation: [0, 0, 0], scale: 1 },
          screen: { assetId: null, fit: 'cover', scroll: 0 },
        }
        cur(s.project).scene.devices.push(dev)
        s.selectedDeviceId = dev.id
      })
    },

    removeDevice: (id) => {
      get().commit('remove-device')
      set((s) => {
        if (cur(s.project).scene.devices.length <= 1) return
        cur(s.project).scene.devices = cur(s.project).scene.devices.filter((d) => d.id !== id)
        cur(s.project).keyframes = cur(s.project).keyframes.filter((k) => !k.target.startsWith(`dev.${id}.`))
        if (s.selectedDeviceId === id) s.selectedDeviceId = cur(s.project).scene.devices[0]?.id ?? null
      })
    },

    duplicateDevice: (id) => {
      get().commit('duplicate-device')
      set((s) => {
        const src = cur(s.project).scene.devices.find((d) => d.id === id)
        if (!src) return
        const copy: DeviceInstance = JSON.parse(JSON.stringify(src))
        copy.id = `dev_${uid()}`
        copy.transform.position = [
          src.transform.position[0] + 0.9,
          src.transform.position[1],
          src.transform.position[2] - 0.2,
        ]
        cur(s.project).scene.devices.push(copy)
        s.selectedDeviceId = copy.id
      })
    },

    updateDevice: (id, patch) => {
      get().commit('update-device')
      set((s) => {
        const dev = cur(s.project).scene.devices.find((d) => d.id === id)
        if (dev) Object.assign(dev, patch)
      })
    },

    updateDeviceScreen: (id, patch) => {
      get().commit('device-screen')
      set((s) => {
        const dev = cur(s.project).scene.devices.find((d) => d.id === id)
        if (dev) Object.assign(dev.screen, patch)
      })
    },

    setDeviceTransform: (id, patch) => {
      get().commit('device-transform')
      set((s) => {
        const dev = cur(s.project).scene.devices.find((d) => d.id === id)
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
        const devs = cur(s.project).scene.devices
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

    importMedia: async (file, mime, opts) => {
      /*
       * The tray is deliberately small: five screens is more than any one
       * mockup needs, and an unbounded pile of blobs in IndexedDB is a slow
       * leak nobody goes looking for. Backdrops and logos are scene dressing
       * rather than screen media, so they neither count nor are counted.
       */
      const role: AssetMeta['role'] = opts?.bind === false ? 'scene' : 'screen'
      if (role === 'screen' && screenMedia(get().project.assets).length >= MAX_SCREEN_MEDIA) {
        ui.error(`The media tray holds ${MAX_SCREEN_MEDIA} files. Remove one to add another.`)
        return
      }
      const type = mime ?? (file instanceof File ? file.type : 'image/png')
      const meta = await metaForBlob(file, type)
      track('media_imported', { editor: 'studio', kind: meta.kind, mime: type, role })
      const id = `asset_${uid()}`
      await saveAsset(id, file)
      const url = URL.createObjectURL(file)
      get().commit('import-media')
      set((s) => {
        s.project.assets.push({ id, kind: meta.kind, mime: type, w: meta.w, h: meta.h, role })
        s.assets[id] = { url, kind: meta.kind }
        if (opts?.bind === false) return
        const dev =
          cur(s.project).scene.devices.find((d) => d.id === s.selectedDeviceId) ??
          cur(s.project).scene.devices[0]
        if (dev) {
          dev.screen.assetId = id
          dev.screen.scroll = 0
        }
      })
    },

    /*
     * Take a file out of the tray.
     *
     * The blob stays in IndexedDB and its object URL stays in `assets`, which
     * is deliberate: undo restores the project document, and the document only
     * carries the file's metadata, so an undo that found the bytes gone would
     * hand back a reference to nothing and the screen would come back blank.
     * Keeping them costs a row nothing points at any more, and the saved
     * project stops mentioning the file immediately, so a removal that is never
     * undone is gone for good the next time the app loads.
     */
    removeAsset: (id) => {
      if (!get().project.assets.some((a) => a.id === id)) return
      get().commit('remove-media')
      set((s) => {
        s.project.assets = s.project.assets.filter((a) => a.id !== id)
        /*
         * Every shot, not just the one on screen. The media pool belongs to the
         * project, so dropping a file has to unhook it everywhere: a reference
         * left behind in a shot you are not looking at renders as a blank
         * screen the next time you cut to it, with nothing to explain why.
         */
        for (const shot of s.project.shots) {
          for (const d of shot.scene.devices) if (d.screen.assetId === id) d.screen.assetId = null
          if (shot.scene.background.imageAssetId === id) shot.scene.background.imageAssetId = null
          shot.overlays = shot.overlays.filter((o) => o.type !== 'image' || o.assetId !== id)
        }
      })
    },

    importMediaFromURL: async (url, opts) => {
      const res = await fetch(url, { mode: 'cors' })
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
      const blob = await res.blob()
      if (!/^(image|video)\//.test(blob.type)) throw new Error('URL is not an image or video')
      await get().importMedia(blob, blob.type, opts)
    },

    addOverlay: (o) => {
      get().commit('add-overlay')
      set((s) => {
        cur(s.project).overlays.push(o)
        s.selectedOverlayId = o.id
      })
    },

    updateOverlay: (id, patch) => {
      get().commit('update-overlay')
      set((s) => {
        const o = cur(s.project).overlays.find((x) => x.id === id)
        if (o) Object.assign(o, patch)
      })
    },

    removeOverlay: (id) => {
      get().commit('remove-overlay')
      set((s) => {
        cur(s.project).overlays = cur(s.project).overlays.filter((o) => o.id !== id)
        if (s.selectedOverlayId === id) s.selectedOverlayId = null
      })
    },

    selectOverlay: (id) => set((s) => void (s.selectedOverlayId = id)),

    toggleTrack: (target) => {
      get().commit('toggle-track')
      set((s) => {
        const kfs = cur(s.project).keyframes.filter((k) => k.target === target)
        if (kfs.length > 0) {
          // bake evaluated value at playhead into base, then remove the track
          const sampled = sampleKeyframes(kfs, s.timeMs).get(target)
          if (sampled !== undefined) setTargetValue(cur(s.project).scene, target, sampled)
          cur(s.project).keyframes = cur(s.project).keyframes.filter((k) => k.target !== target)
          s.selectedKeyframeIds = s.selectedKeyframeIds.filter((id) =>
            cur(s.project).keyframes.some((k) => k.id === id),
          )
        } else {
          cur(s.project).keyframes.push({
            id: `kf_${uid()}`,
            target,
            timeMs: s.timeMs,
            value: getTargetValue(cur(s.project).scene, target),
            easing: 'smooth',
          })
        }
      })
    },

    addKeyframeAt: (target, timeMs) => {
      get().commit('add-kf')
      set((s) => {
        const t = timeMs ?? s.timeMs
        const kfs = cur(s.project).keyframes.filter((k) => k.target === target)
        const value =
          kfs.length > 0
            ? (sampleKeyframes(kfs, t).get(target) ?? getTargetValue(cur(s.project).scene, target))
            : getTargetValue(cur(s.project).scene, target)
        const existing = kfs.find((k) => Math.abs(k.timeMs - t) <= 1)
        if (existing) existing.value = value
        else cur(s.project).keyframes.push({ id: `kf_${uid()}`, target, timeMs: t, value, easing: 'smooth' })
      })
    },

    removeKeyframes: (ids) => {
      get().commit('remove-kf')
      set((s) => {
        cur(s.project).keyframes = cur(s.project).keyframes.filter((k) => !ids.includes(k.id))
        s.selectedKeyframeIds = s.selectedKeyframeIds.filter((id) => !ids.includes(id))
      })
    },

    moveKeyframe: (id, timeMs) => {
      get().commit('move-kf')
      set((s) => {
        const kf = cur(s.project).keyframes.find((k) => k.id === id)
        if (kf) kf.timeMs = Math.min(cur(s.project).durationMs, Math.max(0, Math.round(timeMs)))
      })
    },

    moveKeyframesBy: (ids, deltaMs) => {
      if (ids.length === 0 || deltaMs === 0) return
      get().commit('move-kf')
      set((s) => {
        const moving = cur(s.project).keyframes.filter((k) => ids.includes(k.id))
        if (moving.length === 0) return
        // clamp the delta against the group's own bounds so the shape of a
        // multi-keyframe selection survives a drag into either end
        const lo = Math.min(...moving.map((k) => k.timeMs))
        const hi = Math.max(...moving.map((k) => k.timeMs))
        /*
         * The headroom floors at zero. A selection can contain a key that is
         * already past the end, because shortening a shot leaves them there,
         * and "select all" reaches them even though the lane does not draw
         * them. Without the floor that group had negative room to its right,
         * so nudging it forward dragged the whole selection backwards.
         */
        const room = Math.max(0, cur(s.project).durationMs - hi)
        const d = Math.round(Math.min(room, Math.max(-lo, deltaMs)))
        for (const k of moving) k.timeMs += d
      })
    },

    setKeyframeEasing: (ids, easing) => {
      get().commit('kf-easing')
      set((s) => {
        for (const k of cur(s.project).keyframes) if (ids.includes(k.id)) k.easing = easing
      })
    },

    clearAllKeyframes: () => {
      get().commit('clear-kf')
      set((s) => {
        cur(s.project).keyframes = []
        s.selectedKeyframeIds = []
      })
    },

    selectKeyframes: (ids) => set((s) => void (s.selectedKeyframeIds = ids)),

    applyAnimationPreset: (presetId) => {
      const preset = ANIMATION_PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      track('animation_preset_applied', { preset_id: presetId })
      get().commit('anim-preset')
      set((s) => {
        const cam = cur(s.project).scene.camera
        const built = preset.build({ ...cam }, cur(s.project).durationMs)
        const targets = new Set(built.map((k) => k.target))
        cur(s.project).keyframes = cur(s.project).keyframes.filter((k) => !targets.has(k.target))
        for (const k of built) cur(s.project).keyframes.push({ ...k, id: `kf_${uid()}` })
      })
    },

    makeLoopFriendly: () => {
      get().commit('loopify')
      set((s) => {
        const byTarget = new Map<string, Keyframe[]>()
        for (const k of cur(s.project).keyframes) {
          const arr = byTarget.get(k.target) ?? []
          arr.push(k)
          byTarget.set(k.target, arr)
        }
        for (const [target, arr] of byTarget) {
          arr.sort((a, b) => a.timeMs - b.timeMs)
          const first = arr[0]
          const last = arr[arr.length - 1]
          if (last.timeMs >= cur(s.project).durationMs - 1) last.value = first.value
          else
            cur(s.project).keyframes.push({
              id: `kf_${uid()}`,
              target,
              timeMs: cur(s.project).durationMs,
              value: first.value,
              easing: first.easing,
            })
        }
      })
    },

    applyTemplate: (templateId) => {
      const tpl = TEMPLATES.find((t) => t.id === templateId)
      if (!tpl) return
      track('template_applied', { template_id: templateId })
      get().commit('template')
      set((s) => {
        const currentAsset =
          cur(s.project).scene.devices.find((d) => d.id === s.selectedDeviceId)?.screen.assetId ??
          cur(s.project).scene.devices.find((d) => d.screen.assetId)?.screen.assetId ??
          null
        tpl.apply(cur(s.project))
        if (currentAsset && cur(s.project).scene.devices[0])
          cur(s.project).scene.devices[0].screen.assetId = currentAsset
        s.selectedDeviceId = cur(s.project).scene.devices[0]?.id ?? null
        s.selectedKeyframeIds = []
        s.timeMs = 0
        s.dialog = null
      })
    },

    // ----- shots -----

    addShot: (opts) => {
      const s0 = get()
      if (s0.project.shots.length >= MAX_SHOTS) {
        ui.toast(`A project holds up to ${MAX_SHOTS} shots.`, 'error')
        return
      }
      s0.captureShotThumb()
      track('shot_added', { blank: !!opts?.blank, count: s0.project.shots.length + 1 })
      get().commit('add-shot')
      set((s) => {
        const at = s.project.shots.findIndex((x) => x.id === s.project.activeShotId)
        const index = at < 0 ? s.project.shots.length - 1 : at
        /*
         * A new shot is a copy of the one you are standing on, not an empty
         * set. The next shot in a reel is nearly always the same product from
         * a different angle, and rebuilding the lighting to get there is the
         * kind of work a tool should have already done for you. `blank` is
         * there for the times it genuinely is a new scene.
         */
        const source = cur(s.project)
        const shot: Shot = opts?.blank
          ? makeShot(defaultScene(), index + 1)
          : {
              ...(JSON.parse(JSON.stringify(source)) as Shot),
              id: `shot_${uid()}`,
              name: `Shot ${index + 2}`,
            }
        shot.transition = { ...shot.transition }
        s.project.shots.splice(index + 1, 0, shot)
        s.project.activeShotId = shot.id
        s.selectedDeviceId = shot.scene.devices[0]?.id ?? null
        s.selectedKeyframeIds = []
        s.selectedOverlayId = null
        s.timeMs = 0
        /*
         * Show the strip. A second take only means something next to the first
         * one, and the timeline is collapsed by default, so adding a shot from
         * the transport bar would otherwise change the film with nothing on
         * screen to show for it.
         */
        s.timelineOpen = true
      })
      localStorage.setItem('ms-timeline', 'open')
    },

    duplicateShot: (id) => {
      const s0 = get()
      if (s0.project.shots.length >= MAX_SHOTS) {
        ui.toast(`A project holds up to ${MAX_SHOTS} shots.`, 'error')
        return
      }
      // the copy takes over the viewport, so photograph what is there first
      s0.captureShotThumb()
      get().commit('duplicate-shot')
      set((s) => {
        const at = s.project.shots.findIndex((x) => x.id === id)
        if (at < 0) return
        const copy = JSON.parse(JSON.stringify(s.project.shots[at])) as Shot
        copy.id = `shot_${uid()}`
        copy.name = `${s.project.shots[at].name} copy`
        s.project.shots.splice(at + 1, 0, copy)
        s.project.activeShotId = copy.id
        s.selectedDeviceId = copy.scene.devices[0]?.id ?? null
        s.selectedKeyframeIds = []
        s.timeMs = 0
      })
    },

    removeShot: (id) => {
      if (get().project.shots.length <= 1) return
      get().commit('remove-shot')
      set((s) => {
        const at = s.project.shots.findIndex((x) => x.id === id)
        if (at < 0) return
        s.project.shots.splice(at, 1)
        delete s.shotThumbs[id]
        if (s.project.activeShotId === id) {
          const next = s.project.shots[Math.min(at, s.project.shots.length - 1)]
          s.project.activeShotId = next.id
          s.selectedDeviceId = next.scene.devices[0]?.id ?? null
          s.timeMs = 0
        }
        s.selectedKeyframeIds = []
        s.selectedOverlayId = null
      })
    },

    renameShot: (id, name) => {
      get().commit(`rename-shot:${id}`)
      set((s) => {
        const shot = s.project.shots.find((x) => x.id === id)
        if (shot) shot.name = name.slice(0, 40)
      })
    },

    moveShot: (id, toIndex) => {
      const from = get().project.shots.findIndex((x) => x.id === id)
      const to = Math.min(get().project.shots.length - 1, Math.max(0, toIndex))
      if (from < 0 || from === to) return
      get().commit('move-shot')
      set((s) => {
        const [shot] = s.project.shots.splice(from, 1)
        s.project.shots.splice(to, 0, shot)
        /*
         * The first shot has nothing to blend from, so a transition that ends
         * up there would be dead state that comes back to life the moment
         * something else is dragged in front of it. Hand it to the shot that
         * inherited the join instead, which is what reordering a cut means.
         */
        const first = s.project.shots[0]
        if (first.transition.kind !== 'cut') {
          const orphan = first.transition
          first.transition = defaultTransition()
          if (s.project.shots[1] && s.project.shots[1].transition.kind === 'cut')
            s.project.shots[1].transition = orphan
        }
      })
    },

    selectShot: (id, atMs = 0) => {
      const s0 = get()
      if (s0.project.activeShotId === id) {
        s0.setTime(atMs)
        return
      }
      // the outgoing shot is still on screen, so this is the last chance to
      // take its picture for the ribbon
      s0.captureShotThumb()
      set((s) => {
        const shot = s.project.shots.find((x) => x.id === id)
        if (!shot) return
        s.project.activeShotId = id
        s.timeMs = Math.min(shot.durationMs, Math.max(0, atMs))
        s.selectedKeyframeIds = []
        s.selectedOverlayId = null
        if (!shot.scene.devices.some((d) => d.id === s.selectedDeviceId))
          s.selectedDeviceId = shot.scene.devices[0]?.id ?? null
      })
    },

    setShotDuration: (id, ms) => {
      get().commit(`shot-duration:${id}`)
      set((s) => {
        const shot = s.project.shots.find((x) => x.id === id)
        if (!shot) return
        shot.durationMs = Math.min(30000, Math.max(MIN_SHOT_MS, Math.round(ms)))
        /*
         * Keyframes past the new end are left where they are, the way an
         * editor leaves keys past a clip's out point. Squashing them onto the
         * end would destroy the timing of a move while you are still dragging
         * the edge, and the drag is one gesture: pulling back out has to give
         * you what you had, not a stack of keys piled on the last frame.
         */
        if (s.project.activeShotId === id && s.timeMs > shot.durationMs) s.timeMs = shot.durationMs
      })
    },

    setTransition: (id, patch) => {
      get().commit(`transition:${id}`)
      set((s) => {
        const shot = s.project.shots.find((x) => x.id === id)
        if (!shot) return
        Object.assign(shot.transition, patch)
        shot.transition.durationMs = Math.min(
          MAX_TRANSITION_MS,
          Math.max(100, Math.round(shot.transition.durationMs)),
        )
      })
    },

    captureShotThumb: (id) => {
      const s0 = get()
      /*
       * Never mid-export. An export drives the shots past the viewport itself,
       * at export resolution and with the frame loop stopped, so a thumbnail
       * taken then is as likely to be a half-cleared buffer as a picture, and
       * the store write behind it would re-render the editor between frames of
       * a render that is trying to be deterministic.
       */
      if (s0.exportProgress) return
      const shotId = id ?? s0.project.activeShotId
      const url = captureViewportThumb()
      if (!url) return
      set((s) => void (s.shotThumbs[shotId] = url))
    },

    activateForRender: (id) =>
      set((s) => {
        s.project.activeShotId = id
      }),

    // ----- playback -----

    setTime: (ms) =>
      set((s) => {
        s.timeMs = Math.min(cur(s.project).durationMs, Math.max(0, ms))
      }),

    setGlobalTime: (ms) => {
      const s0 = get()
      const slice = resolveSequence(s0.project, ms)
      /*
       * Inside a blend both shots are on screen, and only one of them can be
       * the one you are editing. The frame belongs to whichever side is
       * winning, which is also where a cut would have fallen, so scrubbing
       * across a dissolve hands over at its midpoint rather than at either end.
       */
      const showing = slice.from && slice.mix < 0.5 ? slice.from : slice.to
      const localMs = slice.from && slice.mix < 0.5 ? slice.fromLocalMs : slice.toLocalMs
      if (showing.shot.id !== s0.project.activeShotId) s0.selectShot(showing.shot.id, localMs)
      else s0.setTime(localMs)
    },

    setScrubMode: (m) => set((s) => void (s.scrubMode = m)),
    setPlaying: (playing) => set((s) => void (s.playing = playing)),
    setLoop: (loop) => set((s) => void (s.loop = loop)),

    setDialog: (d) => set((s) => void (s.dialog = d)),
    setExportProgress: (p) => set((s) => void (s.exportProgress = p)),
    setTheme: (t) => {
      track('theme_changed', { theme: t })
      localStorage.setItem('ms-theme', t)
      set((s) => void (s.theme = t))
    },
    setMode: (m) => {
      if (m !== get().mode) track('mode_changed', { mode: m, from: get().mode })
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
      const fit = framingForDevices(cur(get().project).scene.camera.fov)
      if (!fit) return
      get().setCamera(fit, 'cam-frame')
    },

    hydrate: async () => {
      try {
        const theme = localStorage.getItem('ms-theme') === 'light' ? 'light' : 'dark'
        const savedMode = localStorage.getItem('ms-mode')
        const mode: AppMode =
          savedMode === 'shots' ||
          savedMode === 'studio' ||
          savedMode === 'draw' ||
          savedMode === 'ascii' ||
          savedMode === 'signal'
            ? savedMode
            : 'home'
        set((s) => {
          s.theme = theme
          s.mode = mode
        })
        const saved = await loadProjectJSON<(ProjectDoc | ProjectDocV2) & { version: number }>()
        if (saved && (saved.version === 2 || saved.version === 3)) {
          const doc = migrateProject(saved)
          const runtime: Record<string, AssetRuntime> = {}
          const alive: AssetMeta[] = []
          for (const meta of doc.assets) {
            const blob = await loadAsset(meta.id)
            if (blob) {
              runtime[meta.id] = { url: URL.createObjectURL(blob), kind: meta.kind }
              alive.push(meta)
            }
          }
          doc.assets = alive
          /*
           * Saves from before the tray have no roles. What the scene points at
           * is the only evidence of what a file was for, so a backdrop or a
           * logo is scene dressing and everything else is screen media. Read
           * across every shot: one shot using a file as a backdrop is enough to
           * settle what that file is for.
           */
          const dressing = new Set(
            doc.shots
              .flatMap((shot) => [
                shot.scene.background.imageAssetId,
                ...shot.overlays.map((o) => (o.type === 'image' ? o.assetId : null)),
              ])
              .filter((x): x is string => !!x),
          )
          for (const meta of doc.assets) meta.role ??= dressing.has(meta.id) ? 'scene' : 'screen'
          repairShots(doc, runtime)
          set((s) => {
            s.project = doc
            s.assets = runtime
            s.selectedDeviceId = cur(doc).scene.devices[0]?.id ?? null
          })
        }
      } catch (err) {
        console.warn('hydrate failed, starting fresh', err)
      } finally {
        set((s) => {
          s.hydrated = true
          s.selectedDeviceId ??= cur(s.project).scene.devices[0]?.id ?? null
        })
      }
    },
  })),
)

/**
 * Where the playhead sits on the film rather than inside its shot.
 *
 * The store keeps shot-local time, because that is what keyframes, the
 * evaluator and every scene setter are written against. The film's own clock is
 * derived from it, never stored, so the two can never drift apart.
 */
export const globalTimeOf = (s: { project: ProjectDoc; timeMs: number }) =>
  shotStart(s.project, s.project.activeShotId) + s.timeMs

/** Running time of every shot and blend together. */
export const filmDurationOf = (s: { project: ProjectDoc }) => sequenceDuration(s.project)

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
  const parsed = JSON.parse(text) as {
    project: (ProjectDoc | ProjectDocV2) & { version: number }
    blobs: Record<string, string>
  }
  const version = parsed.project?.version
  if (version !== 2 && version !== 3) throw new Error('Unsupported project file')
  const doc = migrateProject(parsed.project)
  const runtime: Record<string, AssetRuntime> = {}
  for (const meta of doc.assets) {
    const dataUrl = parsed.blobs[meta.id]
    if (!dataUrl) continue
    const blob = await (await fetch(dataUrl)).blob()
    await saveAsset(meta.id, blob)
    runtime[meta.id] = { url: URL.createObjectURL(blob), kind: meta.kind }
  }
  repairShots(doc, runtime)
  useStudio.getState().loadProjectDoc(doc, runtime)
}
