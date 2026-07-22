import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { loadAsset, loadJSON, saveAsset, saveJSON } from '../lib/db'
import type { AssetMeta, AssetRuntime } from '../types'
import { extractPalette, magicBackgrounds, randomBackground } from './palette'
import {
  defaultShotsDoc,
  defaultShotsImage,
  MAX_SHOTS,
  selectedShotsImage,
  type ShotsBackground,
  type ShotsDoc,
  type ShotsImage,
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
 * Tile the screens into a centered horizontal row so each stays visible and
 * clickable. Only positional properties (offset + scale) are re-laid-out;
 * per-screen tilt/rotation the user dialed in is preserved.
 */
function arrangeRow(images: ShotsImage[]) {
  const n = images.length
  images.forEach((im, i) => {
    const c = i - (n - 1) / 2
    im.offsetX = n === 1 ? 0 : c * (0.9 / n)
    im.offsetY = 0
    im.scale = n === 1 ? 1 : Math.min(1, 1.35 / n)
  })
}

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
  // backfill fields on screens saved before they existed
  for (const im of doc.images) {
    if (!im.id) im.id = `shot_${uid()}`
    if (im.device === undefined) im.device = 'none'
    if (im.style3d === undefined) im.style3d = false
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
  past: ShotsDoc[]
  future: ShotsDoc[]

  commit: () => void
  undo: () => void
  redo: () => void

  setName: (name: string) => void
  setSize: (width: number, height: number) => void
  setBackground: (patch: Partial<ShotsBackground>) => void
  randomizeBackground: () => void
  applyMagicBackground: (index: number) => void
  setImage: (patch: Partial<ShotsImage>) => void
  setShadow: (patch: Partial<ShotsImage['shadow']>) => void
  setBorder: (patch: Partial<ShotsImage['border']>) => void
  setGlow: (patch: Partial<ShotsImage['glow']>) => void
  removeImage: () => void
  selectImage: (id: string) => void

  /** append a screen (replace: true swaps the selected screen's media instead) */
  importMedia: (file: Blob, mime?: string, opts?: { replace?: boolean }) => Promise<void>
  importMediaFromURL: (url: string, opts?: { replace?: boolean }) => Promise<void>
  /** import an image purely as the canvas background (leaves screens untouched) */
  importBackgroundImage: (file: Blob, mime?: string) => Promise<void>
  setExporting: (v: boolean) => void
  setDialog: (d: 'export' | null) => void
  hydrate: () => Promise<void>
}

export const useShots = create<ShotsState>()(
  immer((set, get) => ({
    hydrated: false,
    doc: defaultShotsDoc(),
    assets: {},
    exporting: false,
    dialog: null,
    past: [],
    future: [],

    commit: () =>
      set((s) => {
        s.past.push(clone(s.doc))
        if (s.past.length > 50) s.past.shift()
        s.future = []
      }),

    undo: () =>
      set((s) => {
        const prev = s.past.pop()
        if (!prev) return
        s.future.push(clone(s.doc))
        s.doc = prev
      }),

    redo: () =>
      set((s) => {
        const next = s.future.pop()
        if (!next) return
        s.past.push(clone(s.doc))
        s.doc = next
      }),

    setName: (name) => set((s) => void (s.doc.name = name)),

    setSize: (width, height) => {
      get().commit()
      set((s) => {
        s.doc.size = {
          width: Math.min(7680, Math.max(64, Math.round(width))),
          height: Math.min(7680, Math.max(64, Math.round(height))),
        }
      })
    },

    setBackground: (patch) => {
      get().commit()
      set((s) => {
        Object.assign(s.doc.background, patch)
      })
    },

    randomizeBackground: () => {
      get().commit()
      set((s) => {
        Object.assign(s.doc.background, randomBackground(selectedShotsImage(s.doc)?.palette))
      })
    },

    applyMagicBackground: (index) => {
      const palette = selectedShotsImage(get().doc)?.palette ?? []
      const options = magicBackgrounds(palette)
      const patch = options[index]
      if (!patch) return
      get().commit()
      set((s) => {
        Object.assign(s.doc.background, patch)
      })
    },

    setImage: (patch) => {
      get().commit()
      set((s) => {
        const img = selectedShotsImage(s.doc)
        if (img) Object.assign(img, patch)
      })
    },
    setShadow: (patch) => {
      get().commit()
      set((s) => {
        const img = selectedShotsImage(s.doc)
        if (img) Object.assign(img.shadow, patch)
      })
    },
    setBorder: (patch) => {
      get().commit()
      set((s) => {
        const img = selectedShotsImage(s.doc)
        if (img) Object.assign(img.border, patch)
      })
    },
    setGlow: (patch) => {
      get().commit()
      set((s) => {
        const img = selectedShotsImage(s.doc)
        if (img) Object.assign(img.glow, patch)
      })
    },

    removeImage: () => {
      get().commit()
      set((s) => {
        const idx = s.doc.images.findIndex((i) => i.id === s.doc.selectedId)
        if (idx < 0) return
        s.doc.images.splice(idx, 1)
        arrangeRow(s.doc.images)
        s.doc.selectedId = s.doc.images[Math.min(idx, s.doc.images.length - 1)]?.id ?? null
      })
    },

    selectImage: (id) => set((s) => void (s.doc.selectedId = id)),

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
          const screen = { ...defaultShotsImage(id), palette }
          s.doc.images.push(screen)
          s.doc.selectedId = screen.id
          arrangeRow(s.doc.images)
        }
        // On the very first upload, dress the background from the image palette.
        if (firstUpload && palette.length > 0) {
          const magic = magicBackgrounds(palette)[0]
          if (magic) Object.assign(s.doc.background, magic)
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
      }
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
