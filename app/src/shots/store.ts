import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { loadAsset, loadJSON, saveAsset, saveJSON } from '../lib/db'
import type { AssetMeta, AssetRuntime } from '../types'
import { coalesces, endEditRun, patchLabel } from '../lib/history'
import { ui } from '../lib/ui'
import { migrateDeviceId } from './devices'
import { applyLayoutToDoc, getLayoutPreset } from './layouts'
import {
  alignedCenter,
  allScreenRects,
  distributedCenters,
  groupBounds,
  matchedHeightScales,
  offsetForCenter,
  type AlignMode,
} from './align'
import { PALETTE_FULL_SIZE, extractPalette, magicBackgrounds, randomBackground } from './palette'
import {
  defaultGobo,
  defaultPortrait,
  defaultShotsDoc,
  defaultShotsImage,
  MAX_SHOTS,
  selectedShotsImage,
  type ShotsBackground,
  type ShotsDoc,
  type ShotsGobo,
  type ShotsImage,
  type ShotsPortrait,
} from './types'

const uid = () => crypto.randomUUID()
const SHOTS_KEY = 'shots-current'

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

const clone = (d: ShotsDoc): ShotsDoc => JSON.parse(JSON.stringify(d)) as ShotsDoc

/**
 * Re-run the doc's active layout over its screens.
 *
 * Called whenever the set of screens changes, so adding or removing media keeps
 * the arrangement you picked instead of silently snapping back to a row. Only
 * placement is rewritten; per-screen device, media and finish are left alone.
 */
function reflow(doc: ShotsDoc) {
  applyLayoutToDoc(doc, doc.layout ?? 'row')
}

/**
 * Re-run the active preset because the frame it was measured against changed.
 *
 * Presets work out their spacing from the box aspect and the device aspect, so
 * a new canvas size, padding, or device leaves the stored offsets stale, which
 * is why changing the frame used to mean going back and clicking the same
 * preset again. Does nothing once the arrangement has been edited by hand:
 * those offsets are already relative to the box and survive a resize, and
 * re-running would throw the edits away.
 */
function remeasure(doc: ShotsDoc) {
  if (!doc.layout) return
  applyLayoutToDoc(doc, doc.layout)
}

/** Placement the presets own: touching these by hand makes the layout custom. */
const HAND_PLACED = ['scale', 'offsetX', 'offsetY', 'rotate'] as const

/**
 * Keys that stay with the screen they were set on, even in "apply to all".
 *
 * Where a screen sits is the one thing that cannot be shared: copy one
 * screen's offset onto its neighbours and they stack into a single pile. So
 * broadcasting covers how a screen *looks* (device, frame, corner, shadow,
 * border, glow) and never where it *is*.
 */
const PER_SCREEN = [...HAND_PLACED, 'z', 'rotateX', 'rotateY'] as const

/** Which screens an appearance edit lands on: every one, or just the selected. */
function styleTargets(s: { doc: ShotsDoc; applyToAll: boolean }): ShotsImage[] {
  if (s.applyToAll) return s.doc.images
  const img = selectedShotsImage(s.doc)
  return img ? [img] : []
}
/** Changes that alter the frame a preset measured, so it has to be re-run. */
const RESHAPES = ['device', 'padding', 'style3d'] as const

/**
 * Migrate a persisted doc from the single-`image` shape to the multi-`images`
 * array shape. Safe to call on already-migrated docs.
 */
function migrateDoc(doc: ShotsDoc & { image?: ShotsImage | null }): ShotsDoc {
  if (!Array.isArray(doc.images)) {
    const legacy = doc.image ?? null
    doc.images = legacy ? [legacy] : []
    doc.selectedId = legacy ? legacy.id : null
  }
  if (!Array.isArray(doc.parked)) doc.parked = []
  if (!doc.gobo) doc.gobo = defaultGobo()
  else {
    // a shot saved before the shadow could slide has no offsets, and an
    // undefined one turns every transform that touches it into NaN
    doc.gobo.x ??= 0
    doc.gobo.y ??= 0
  }
  if (!doc.background.photoId) doc.background.photoId = 'abstract-01'
  if (!doc.portrait) doc.portrait = defaultPortrait()
  else if (doc.portrait.shade === undefined) {
    // one number used to mean blur in 'lens' and darkness in 'stage', so a shot
    // saved in stage mode is carrying its shade in the blur field
    doc.portrait.shade = doc.portrait.mode === 'stage' ? doc.portrait.strength : 0.6
    if (doc.portrait.mode === 'stage') doc.portrait.strength = 0.5
  }
  // backfill fields on screens saved before they existed, and re-point any
  // device saved against the old drawn-bezel catalog at a real frame
  for (const im of [...doc.images, ...doc.parked]) {
    if (!im.id) im.id = `shot_${uid()}`
    im.device = migrateDeviceId(im.device)
    if (im.style3d === undefined) im.style3d = false
    im.cardStyle ??= 'default'
  }
  if (!doc.selectedId || !doc.images.some((i) => i.id === doc.selectedId))
    doc.selectedId = doc.images[0]?.id ?? null
  delete doc.image
  return doc
}

interface ShotsState {
  hydrated: boolean
  doc: ShotsDoc
  assets: Record<string, AssetRuntime>
  exporting: boolean
  dialog: 'export' | null
  /**
   * Whether the focal-point rings are drawn on the canvas.
   *
   * Not part of the document: it is a state of the editor, not of the picture,
   * so it never exports and never lands in undo. Touching any portrait control
   * brings it back, clicking the canvas puts it away.
   */
  focusGuide: boolean
  /**
   * When on, an appearance edit lands on every screen at once.
   *
   * On by default. A set of screens in one shot is nearly always meant to look
   * like a set, so matching is the common case and drifting apart is the
   * deliberate one; starting off meant styling four screens took the same
   * edit four times, and any one of them missed showed up as an odd screen
   * out. Placement is exempt either way, so this can never pile the screens
   * on top of each other.
   *
   * A session flag rather than part of the document: it describes how you are
   * working right now, not anything about the shot, so it neither saves nor
   * lands on the undo stack.
   */
  applyToAll: boolean
  setApplyToAll: (v: boolean) => void
  past: ShotsDoc[]
  future: ShotsDoc[]

  /** `label` groups a run of edits into one entry; omit it for discrete actions */
  commit: (label?: string) => void
  undo: () => void
  redo: () => void

  setName: (name: string) => void
  /** back to an empty shot, as one undoable step */
  startOver: () => void
  setSize: (width: number, height: number) => void
  /** dolly the camera in or out, magnifies the whole composition */
  setZoom: (zoom: number) => void
  setBackground: (patch: Partial<ShotsBackground>) => void
  /** depth of field over the whole frame */
  setPortrait: (patch: Partial<ShotsPortrait>) => void
  /** shadow scene cast over the shot */
  setGobo: (patch: Partial<ShotsGobo>) => void
  setFocusGuide: (visible: boolean) => void
  randomizeBackground: () => void
  /** `palette` is whichever of the three Magic groups is showing in the UI right now */
  applyMagicBackground: (index: number, palette: string[]) => void
  setImage: (patch: Partial<ShotsImage>) => void
  setShadow: (patch: Partial<ShotsImage['shadow']>) => void
  setBorder: (patch: Partial<ShotsImage['border']>) => void
  setGlow: (patch: Partial<ShotsImage['glow']>) => void
  removeImage: () => void
  /**
   * Rearrange which media occupies which slot, without touching layout.
   *
   * `order[slot]` names the *current* index whose media should end up in
   * `slot`, so `order` is a permutation of `0..images.length-1`, the same
   * shape a drag-reorder produces as you preview it.
   *
   * Only the media moves: `assetId` and the palette sampled from it. Position,
   * device, shadow, card style, everything a person tunes per screen, stays
   * where it is. Dragging screen 5 to the front is the same fix as opening each
   * slot and hitting Replace in the right order, minus the file picker.
   */
  reorderMedia: (order: number[]) => void
  selectImage: (id: string) => void
  /** arrange the screens with a named layout preset */
  applyLayout: (presetId: string) => void
  /** grow or trim the screen count, then re-apply the active layout */
  setScreenCount: (n: number) => void
  /** snap every screen's edge or centre to the group's shared line, on one axis */
  alignScreens: (mode: AlignMode) => void
  /** equalize the gaps between screens along one axis (needs 3+ to do anything) */
  distributeScreens: (axis: 'x' | 'y') => void
  /** rescale every screen so their rendered heights match (needs 2+ to do anything) */
  matchHeights: () => void

  /** append a screen (replace: true swaps the selected screen's media instead) */
  importMedia: (file: Blob, mime?: string, opts?: { replace?: boolean }) => Promise<void>
  /**
   * Add several files at once, stopping at MAX_SHOTS and saying so.
   *
   * The cap has to be enforced here rather than at each call site: a drop, a
   * paste and the file picker all land here, and `importMedia` on its own
   * would silently swallow the overflow by replacing the selected screen once
   * the shot is full.
   */
  importMediaFiles: (files: File[]) => Promise<void>
  importMediaFromURL: (url: string, opts?: { replace?: boolean }) => Promise<void>
  /** import an image purely as the canvas background (leaves screens untouched) */
  importBackgroundImage: (file: Blob, mime?: string) => Promise<void>
  setExporting: (v: boolean) => void
  setDialog: (d: 'export' | null) => void
  hydrate: () => Promise<void>
  /** re-sample any screen missing the three Magic palette groups; safe to re-run */
  ensurePalettes: () => Promise<void>
}

export const useShots = create<ShotsState>()(
  immer((set, get) => ({
    hydrated: false,
    doc: defaultShotsDoc(),
    assets: {},
    exporting: false,
    dialog: null,
    focusGuide: true,
    applyToAll: true,
    past: [],
    future: [],

    commit: (label) => {
      // a continuing gesture folds into the entry already on the stack
      if (coalesces(label)) return
      set((s) => {
        s.past.push(clone(s.doc))
        if (s.past.length > 50) s.past.shift()
        s.future = []
      })
    },

    undo: () => {
      endEditRun()
      set((s) => {
        /*
         * Skip past entries that would not change anything on screen.
         *
         * Any control that commits before writing can leave a duplicate of
         * the current state behind, re-picking the option already selected,
         * or blurring a field nobody edited. Undo would then consume a press
         * per duplicate while the picture sat still, which is indistinguishable
         * from the shortcut being broken. An undo should always show its work.
         */
        const current = JSON.stringify(s.doc)
        let prev = s.past.pop()
        while (prev && JSON.stringify(prev) === current) prev = s.past.pop()
        if (!prev) return
        s.future.push(clone(s.doc))
        s.doc = prev
      })
    },

    redo: () => {
      endEditRun()
      set((s) => {
        const next = s.future.pop()
        if (!next) return
        s.past.push(clone(s.doc))
        s.doc = next
      })
    },

    setName: (name) => set((s) => void (s.doc.name = name)),

    /*
     * Committed first, so this lands on the undo stack like any other edit.
     * "Start over" is the most destructive button in the app and the one most
     * likely to be hit by accident, so being one Ctrl+Z from your work matters
     * more here than anywhere else. The asset blobs are left alone: they are
     * keyed by id and the next import reuses the store rather than refetching.
     */
    startOver: () => {
      get().commit()
      set((s) => {
        s.doc = defaultShotsDoc()
      })
    },

    setSize: (width, height) => {
      /*
       * The W/H fields commit on blur, so clicking into one and back out
       * without typing used to push an undo step for a size that never
       * changed. Ctrl+Z then spent itself rewinding that invisible step and
       * read as a dead shortcut.
       */
      const cur = get().doc.size
      const w = Math.min(7680, Math.max(64, Math.round(width)))
      const h = Math.min(7680, Math.max(64, Math.round(height)))
      if (cur.width === w && cur.height === h) return

      get().commit('size')
      set((s) => {
        s.doc.size = {
          width: Math.min(7680, Math.max(64, Math.round(width))),
          height: Math.min(7680, Math.max(64, Math.round(height))),
        }
        remeasure(s.doc)
      })
    },

    setZoom: (zoom) => {
      get().commit('zoom')
      set((s) => void (s.doc.zoom = Math.min(2.5, Math.max(0.4, zoom))))
    },

    setBackground: (patch) => {
      get().commit(patchLabel('bg', patch))
      set((s) => {
        Object.assign(s.doc.background, patch)
      })
    },

    setPortrait: (patch) => {
      get().commit(patchLabel('portrait', patch))
      set((s) => {
        if (!s.doc.portrait) s.doc.portrait = defaultPortrait()
        Object.assign(s.doc.portrait, patch)
        // reaching for any portrait control means you want to see what it does
        s.focusGuide = true
      })
    },

    setFocusGuide: (visible) => set((s) => void (s.focusGuide = visible)),

    setGobo: (patch) => {
      get().commit(patchLabel('gobo', patch))
      set((s) => {
        if (!s.doc.gobo) s.doc.gobo = defaultGobo()
        Object.assign(s.doc.gobo, patch)
      })
    },

    randomizeBackground: () => {
      get().commit()
      set((s) => {
        Object.assign(s.doc.background, randomBackground(selectedShotsImage(s.doc)?.palette))
      })
    },

    applyMagicBackground: (index, palette) => {
      const options = magicBackgrounds(palette)
      const patch = options[index]
      if (!patch) return
      get().commit()
      set((s) => {
        Object.assign(s.doc.background, patch)
      })
    },

    setImage: (patch) => {
      get().commit(patchLabel('img', patch))
      set((s) => {
        const img = selectedShotsImage(s.doc)
        if (!img) return
        Object.assign(img, patch)
        if (s.applyToAll) {
          // the look travels to the other screens; the placement stays put
          const look = Object.fromEntries(
            Object.entries(patch).filter(([k]) => !PER_SCREEN.includes(k as never)),
          )
          if (Object.keys(look).length > 0) {
            for (const other of s.doc.images) if (other !== img) Object.assign(other, look)
          }
        }
        if (HAND_PLACED.some((k) => k in patch)) {
          // the arrangement is no longer the preset's, so stop claiming it is
          s.doc.layout = undefined
        } else if (RESHAPES.some((k) => k in patch)) {
          remeasure(s.doc)
        }
      })
    },
    // shadow, border and glow are pure appearance, so they broadcast whole
    setShadow: (patch) => {
      get().commit(patchLabel('shadow', patch))
      set((s) => {
        for (const im of styleTargets(s)) Object.assign(im.shadow, patch)
      })
    },
    setBorder: (patch) => {
      get().commit(patchLabel('border', patch))
      set((s) => {
        for (const im of styleTargets(s)) Object.assign(im.border, patch)
      })
    },
    setGlow: (patch) => {
      get().commit(patchLabel('glow', patch))
      set((s) => {
        for (const im of styleTargets(s)) Object.assign(im.glow, patch)
      })
    },
    setApplyToAll: (v) => set((s) => void (s.applyToAll = v)),

    removeImage: () => {
      get().commit()
      set((s) => {
        const idx = s.doc.images.findIndex((i) => i.id === s.doc.selectedId)
        if (idx < 0) return
        s.doc.images.splice(idx, 1)
        reflow(s.doc)
        s.doc.selectedId = s.doc.images[Math.min(idx, s.doc.images.length - 1)]?.id ?? null
      })
    },

    selectImage: (id) => set((s) => void (s.doc.selectedId = id)),

    reorderMedia: (order) => {
      if (order.every((src, slot) => src === slot)) return
      get().commit()
      set((s) => {
        const media = s.doc.images.map((im) => ({ assetId: im.assetId, palette: im.palette }))
        order.forEach((src, slot) => {
          const from = media[src]
          if (!from) return
          s.doc.images[slot].assetId = from.assetId
          s.doc.images[slot].palette = from.palette
        })
      })
    },

    applyLayout: (presetId) => {
      const preset = getLayoutPreset(presetId)
      if (!preset) return
      get().commit()
      set((s) => {
        s.doc.layout = presetId
        applyLayoutToDoc(s.doc, presetId)
      })
    },

    /*
     * Align and distribute don't need a selection: there's no multi-select in
     * this editor, and a shot only ever holds up to five screens, so "the
     * things being aligned" is unambiguous: it's whatever is in the shot.
     * Both write straight to offsetX/offsetY on every image and, like any
     * other hand placement, that means the doc can no longer claim to be a
     * preset's exact output.
     */
    alignScreens: (mode) => {
      const { doc } = get()
      if (doc.images.length < 2) return
      const rects = allScreenRects(doc)
      const bounds = groupBounds(rects.map((r) => r.rect))
      const { width: W, height: H } = doc.size
      const zoom = doc.zoom ?? 1

      get().commit()
      set((s) => {
        for (const { id, rect } of rects) {
          const img = s.doc.images.find((im) => im.id === id)
          if (!img) continue
          const { cx, cy } = alignedCenter(mode, rect, bounds)
          Object.assign(img, offsetForCenter(img, W, H, zoom, cx, cy))
        }
        s.doc.layout = undefined
      })
    },

    distributeScreens: (axis) => {
      const { doc } = get()
      if (doc.images.length < 3) return
      const rects = allScreenRects(doc)
      const centers = distributedCenters(axis, rects)
      const { width: W, height: H } = doc.size
      const zoom = doc.zoom ?? 1

      get().commit()
      set((s) => {
        for (const { id, rect } of rects) {
          const img = s.doc.images.find((im) => im.id === id)
          const target = centers.get(id)
          if (!img || target === undefined) continue
          const patch =
            axis === 'x'
              ? offsetForCenter(img, W, H, zoom, target, rect.cy)
              : offsetForCenter(img, W, H, zoom, rect.cx, target)
          Object.assign(img, patch)
        }
        s.doc.layout = undefined
      })
    },

    matchHeights: () => {
      const { doc } = get()
      if (doc.images.length < 2) return
      const rects = allScreenRects(doc)
      const scales = matchedHeightScales(
        rects.map((r) => ({
          id: r.id,
          rect: r.rect,
          scale: doc.images.find((im) => im.id === r.id)?.scale ?? 1,
        })),
      )

      get().commit()
      set((s) => {
        for (const [id, scale] of scales) {
          const img = s.doc.images.find((im) => im.id === id)
          if (img) img.scale = Math.min(1.6, Math.max(0.3, scale))
        }
        s.doc.layout = undefined
      })
    },

    setScreenCount: (n) => {
      const count = Math.min(MAX_SHOTS, Math.max(1, n))
      const doc = get().doc
      if (doc.images.length === 0 || doc.images.length === count) return
      get().commit()
      set((s) => {
        if (!s.doc.parked) s.doc.parked = []

        // Trimming sets screens aside instead of destroying them. Dropping to
        // one screen and back used to lose three uploads for good; now the
        // media, device, shadow and finish all come back exactly as they were.
        while (s.doc.images.length > count) {
          const spare = s.doc.images.pop()
          if (spare) s.doc.parked.unshift(spare)
        }

        // Growing takes the most recently parked screen back before falling
        // back to cloning, so raising the count undoes lowering it.
        while (s.doc.images.length < count) {
          const revived = s.doc.parked.shift()
          if (revived) {
            s.doc.images.push(revived)
            continue
          }
          const last = s.doc.images[s.doc.images.length - 1]
          if (!last) break
          s.doc.images.push({ ...JSON.parse(JSON.stringify(last)), id: `shot_${uid()}` })
        }

        if (!s.doc.images.some((i) => i.id === s.doc.selectedId))
          s.doc.selectedId = s.doc.images[0]?.id ?? null
        reflow(s.doc)
      })
    },

    importMedia: async (file, mime, opts) => {
      const type = mime ?? (file instanceof File ? file.type : 'image/png')
      const meta = await metaForBlob(file, type)
      const id = `asset_${uid()}`
      await saveAsset(id, file)
      const url = URL.createObjectURL(file)

      // Sample the screenshot's dominant colors for "Magic" backgrounds.
      let palette: string[] = []
      if (meta.kind === 'image') {
        try {
          const bmp = await createImageBitmap(file)
          palette = extractPalette(bmp, bmp.width, bmp.height, 6)
          bmp.close()
        } catch {
          // palette is best-effort
        }
      }

      get().commit()
      set((s) => {
        s.doc.assets.push({ id, kind: meta.kind, mime: type, w: meta.w, h: meta.h })
        s.assets[id] = { url, kind: meta.kind }
        const firstUpload = s.doc.images.length === 0
        const atCapacity = s.doc.images.length >= MAX_SHOTS
        const selected = selectedShotsImage(s.doc)
        // Replace the selected screen's media when asked, or when we're full.
        if ((opts?.replace || atCapacity) && selected) {
          selected.assetId = id
          selected.palette = palette
        } else {
          /*
           * A new screen matches whatever look the last one settled into (
           * device, style, shadow, finish) rather than resetting to a bare
           * screenshot. Screens the count control adds already did this
           * ("adding a screen copies the last one"); dropping in a new file
           * had quietly been the odd one out, landing bare and making
           * someone re-pick the device by hand every time.
           */
          const last = s.doc.images[s.doc.images.length - 1]
          const screen = last
            ? { ...JSON.parse(JSON.stringify(last)), id: `shot_${uid()}`, assetId: id, palette }
            : { ...defaultShotsImage(id), palette }
          s.doc.images.push(screen)
          s.doc.selectedId = screen.id
          reflow(s.doc)
        }
        // On the very first upload, dress the background from the image palette.
        if (firstUpload && palette.length > 0) {
          const magic = magicBackgrounds(palette)[0]
          if (magic) Object.assign(s.doc.background, magic)
        }
      })
    },

    importMediaFiles: async (files) => {
      const media = files.filter((f) => /^(image|video)\//.test(f.type))
      if (media.length === 0) {
        if (files.length > 0) ui.toast('That file is not an image or video', 'error')
        return
      }

      const used = get().doc.images.length + (get().doc.parked?.length ?? 0)
      const room = Math.max(0, MAX_SHOTS - used)
      if (room === 0) {
        ui.toast(`A shot holds ${MAX_SHOTS} screens. Remove one to add another.`, 'error')
        return
      }

      const taking = media.slice(0, room)
      for (const f of taking) await get().importMedia(f, f.type)

      const dropped = media.length - taking.length
      if (dropped > 0) {
        ui.toast(
          `Added ${taking.length} of ${media.length}. A shot holds ${MAX_SHOTS} screens.`,
          'error',
        )
      }
    },

    importMediaFromURL: async (url, opts) => {
      const res = await fetch(url, { mode: 'cors' })
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
      const blob = await res.blob()
      if (!/^(image|video)\//.test(blob.type)) throw new Error('URL is not an image or video')
      await get().importMedia(blob, blob.type, opts)
    },

    importBackgroundImage: async (file, mime) => {
      const type = mime ?? (file instanceof File ? file.type : 'image/png')
      const meta = await metaForBlob(file, type)
      const id = `asset_${uid()}`
      await saveAsset(id, file)
      const url = URL.createObjectURL(file)
      get().commit()
      set((s) => {
        s.doc.assets.push({ id, kind: meta.kind, mime: type, w: meta.w, h: meta.h })
        s.assets[id] = { url, kind: meta.kind }
        s.doc.background.type = 'image'
        s.doc.background.imageAssetId = id
      })
    },

    setExporting: (v) => set((s) => void (s.exporting = v)),
    setDialog: (d) => set((s) => void (s.dialog = d)),

    hydrate: async () => {
      try {
        const saved = await loadJSON<ShotsDoc & { image?: ShotsImage | null }>(SHOTS_KEY)
        if (saved && saved.version === 1) {
          const doc = migrateDoc(saved)
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
          // drop screens whose media didn't survive, and normalize palettes
          doc.images = doc.images.filter((im) => runtime[im.assetId])
          doc.parked = (doc.parked ?? []).filter((im) => runtime[im.assetId])
          for (const im of doc.images) if (!im.palette) im.palette = []
          if (!doc.images.some((i) => i.id === doc.selectedId))
            doc.selectedId = doc.images[0]?.id ?? null
          if (doc.background.imageAssetId && !runtime[doc.background.imageAssetId])
            doc.background.imageAssetId = null
          set((s) => {
            s.doc = doc
            s.assets = runtime
          })
        }
      } catch (err) {
        console.warn('shots hydrate failed', err)
      } finally {
        set((s) => void (s.hydrated = true))
        void get().ensurePalettes()
      }
    },

    ensurePalettes: async () => {
      const { doc, assets } = get()
      /*
       * A screen samples its palette once, when its media is imported, and
       * carries it from then on. That leaves two ways to end up without the
       * three groups the Magic tabs need: a shot saved before the groups
       * existed, and a screen whose extraction was skipped or failed. Either
       * way the tabs would quietly show one palette three times, so rather
       * than papering over it in the panel, the missing ones are re-sampled
       * from the stored media here.
       *
       * Deliberately not a committed edit: recovering data the document
       * should already have had is not something to undo.
       */
      const stale = doc.images.filter(
        (im) => (im.palette?.length ?? 0) !== PALETTE_FULL_SIZE && assets[im.assetId]?.kind === 'image',
      )
      if (stale.length === 0) return

      const fresh: Record<string, string[]> = {}
      for (const im of stale) {
        if (fresh[im.assetId]) continue
        try {
          const blob = await loadAsset(im.assetId)
          if (!blob) continue
          const bmp = await createImageBitmap(blob)
          fresh[im.assetId] = extractPalette(bmp, bmp.width, bmp.height)
          bmp.close()
        } catch {
          // best effort; a screen that won't decode keeps whatever it had
        }
      }
      if (Object.keys(fresh).length === 0) return

      set((s) => {
        for (const im of [...s.doc.images, ...(s.doc.parked ?? [])]) {
          const p = fresh[im.assetId]
          if (p) im.palette = p
        }
      })
    },
  })),
)

export async function persistShots() {
  await saveJSON(SHOTS_KEY, JSON.parse(JSON.stringify(useShots.getState().doc)))
}

// Debounced autosave to IndexedDB (mirrors the studio store).
let timer: ReturnType<typeof setTimeout> | undefined
let lastDoc: ShotsDoc | null = null
useShots.subscribe((state) => {
  if (!state.hydrated || state.doc === lastDoc) return
  lastDoc = state.doc
  clearTimeout(timer)
  timer = setTimeout(() => void saveJSON(SHOTS_KEY, JSON.parse(JSON.stringify(state.doc))), 600)
})
