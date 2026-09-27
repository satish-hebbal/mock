/**
 * ASCII state.
 *
 * The same shape as Shots and Draw next door: one document, a past and a future
 * around it, and everything that is not the document kept outside it. The
 * source bitmap is the clearest case of that split. It lives in `bitmap`, not
 * in `doc`, because it is decoded from a blob that IndexedDB already holds, and
 * putting a decoded image in an undo stack would mean a hundred copies of the
 * same photograph in memory to support a hundred slider moves.
 *
 * `doc.size` follows the image on import rather than being a canvas the picture
 * is fitted into. Everything downstream is expressed against it, so letting it
 * take the source's own aspect ratio is what stops the first thing anybody sees
 * being a stretched face.
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { loadAsset, loadJSON, saveAsset, saveJSON } from '../lib/db'
import { coalesces, endEditRun } from '../lib/history'
import { track } from '../lib/analytics'
import { getPresetPhoto, loadPresetPhotoBlob } from '../lib/presetPhotos'
import { ui } from '../lib/ui'
import { getFilter } from './filters'
import { GRADIENTS } from './gradients'
import { defaults, type ParamValue } from './params'
import { applyRecipe, RECIPES, type DeepPatch } from './presets'
import { RAMPS } from './ramps'
import { getStyle, STYLES } from './styles'
import { defaultAsciiDoc, normalizeDoc, type AsciiDoc, type AsciiStyleId } from './types'

const DOC_KEY = 'ascii-current'
const uid = () => crypto.randomUUID()
const clone = (d: AsciiDoc): AsciiDoc => JSON.parse(JSON.stringify(d)) as AsciiDoc

/**
 * The longest edge a document canvas is allowed to take from an imported image.
 *
 * Not a quality cap: the export re-renders from the source at up to 4x this, so
 * nothing is thrown away. It is a *grid* cap. Cell size is measured in document
 * pixels, so a 6000px document at the default cell size would cut a grid of
 * 545 columns before anybody had touched a control, and the first render would
 * take a second and look like grey soup.
 */
const MAX_DOC_EDGE = 1600

export type AsciiSection = 'art' | 'layers' | 'look'
export type AsciiDialog = 'export' | 'recipes' | null
export type AsciiWorkspace = 'studio' | 'flow'

/**
 * A look somebody saved: the whole treatment and none of the picture.
 *
 * Everything that describes the photograph (which asset, its size, its name)
 * is stripped on the way in, so applying a recipe to a different photograph
 * restyles that photograph instead of swapping it back for the old one.
 */
export interface SavedLook {
  id: string
  name: string
  at: number
  look: Omit<AsciiDoc, 'assetId' | 'presetId' | 'size' | 'name' | 'version'>
}

const FAVS_KEY = 'ms-ascii-favs'
const SAVED_KEY = 'ms-ascii-recipes'
const WS_KEY = 'ms-ascii-workspace'

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode or full storage: the feature just does not persist */
  }
}

/** The treatment of a document, without the picture. */
export function lookOf(doc: AsciiDoc): SavedLook['look'] {
  const { assetId: _a, presetId: _p, size: _s, name: _n, version: _v, ...look } = clone(doc)
  return look
}

/**
 * A look as a short string that pastes anywhere: a chat message, an issue, a
 * post. Base64 of the JSON, with a prefix so a paste of something else is
 * recognised and refused rather than half-applied.
 */
export function lookCode(doc: AsciiDoc): string {
  const bytes = new TextEncoder().encode(JSON.stringify(lookOf(doc)))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return 'rbt1.' + btoa(bin)
}

export function parseLookCode(code: string): SavedLook['look'] | null {
  const t = code.trim()
  if (!t.startsWith('rbt1.')) return null
  try {
    const bin = atob(t.slice(5))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const look = JSON.parse(new TextDecoder().decode(bytes)) as SavedLook['look']
    return look && typeof look === 'object' && 'style' in look ? look : null
  } catch {
    return null
  }
}

function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]
}

/** What the picture being imported is, for the document name and the event. */
interface SourceMeta {
  name?: string
  from?: 'file' | 'preset'
  /** set only when `from` is 'preset', so the picker can tick it */
  presetId?: string
}

interface AsciiState {
  hydrated: boolean
  doc: AsciiDoc
  past: AsciiDoc[]
  future: AsciiDoc[]

  /** object URL for the source, kept for the media thumbnail */
  url: string | null
  /** the decoded source, which is what the renderer actually draws from */
  bitmap: ImageBitmap | null
  /** which asset `bitmap` was decoded from, so a history move can spot a drift */
  loadedId: string | null
  section: AsciiSection
  dialog: AsciiDialog
  workspace: AsciiWorkspace
  /** the layer whose settings are open and whose centre the canvas shows */
  activeLayer: string | null
  favs: AsciiStyleId[]
  saved: SavedLook[]

  commit: (label?: string) => void
  undo: () => void
  redo: () => void

  patch: (fn: (d: AsciiDoc) => void, label?: string) => void
  setStyle: (id: AsciiDoc['style']) => void
  applyLook: (id: string) => void
  setStyleParam: (key: string, v: ParamValue) => void
  addLayer: (kind: string) => void
  removeLayer: (uid: string) => void
  toggleLayer: (uid: string) => void
  duplicateLayer: (uid: string) => void
  moveLayer: (uid: string, to: number) => void
  setLayerParam: (uid: string, key: string, v: ParamValue, label?: string) => void
  setActiveLayer: (uid: string | null) => void
  toggleFav: (id: AsciiStyleId) => void
  saveLook: (name: string) => void
  applySaved: (look: SavedLook['look']) => void
  deleteSaved: (id: string) => void
  renameSaved: (id: string, name: string) => void
  shuffle: () => void
  cycleStyle: (dir: 1 | -1) => void
  setWorkspace: (w: AsciiWorkspace) => void
  reset: () => void
  startOver: () => void

  importImage: (file: Blob, meta?: SourceMeta) => Promise<void>
  importPreset: (id: string) => Promise<void>
  clearImage: () => void
  syncSource: () => Promise<void>

  setSection: (s: AsciiSection) => void
  setDialog: (d: AsciiDialog) => void
  hydrate: () => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function persist(doc: AsciiDoc) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveJSON(DOC_KEY, doc), 400)
}

export const useAscii = create<AsciiState>()(
  immer((set, get) => ({
    hydrated: false,
    doc: defaultAsciiDoc(),
    past: [],
    future: [],
    url: null,
    bitmap: null,
    loadedId: null,
    section: 'art',
    dialog: null,
    // Flow is not shipped yet, so every session opens in Studio
    workspace: 'studio',
    activeLayer: null,
    favs: readLocal<AsciiStyleId[]>(FAVS_KEY, []),
    saved: readLocal<SavedLook[]>(SAVED_KEY, []),

    commit: (label) => {
      if (coalesces(label)) return
      set((s) => {
        s.past.push(clone(s.doc))
        if (s.past.length > 100) s.past.shift()
        s.future = []
      })
    },

    undo: () => {
      endEditRun()
      set((s) => {
        const prev = s.past.pop()
        if (!prev) return
        s.future.push(clone(s.doc))
        s.doc = prev
      })
      void get().syncSource()
      persist(get().doc)
    },

    redo: () => {
      endEditRun()
      set((s) => {
        const next = s.future.pop()
        if (!next) return
        s.past.push(clone(s.doc))
        s.doc = next
      })
      void get().syncSource()
      persist(get().doc)
    },

    patch: (fn, label) => {
      get().commit(label)
      set((s) => {
        fn(s.doc)
      })
      persist(get().doc)
    },

    /**
     * Switching style is not just setting a field.
     *
     * A square style with the character aspect still on it draws bricks that
     * are nearly twice as tall as they are wide, and going back to characters
     * with a square aspect gives text stretched flat. So the aspect follows the
     * style unless the style has no opinion, and the cell size steps up for the
     * tile styles, which are unreadable at eleven pixels.
     */
    setStyle: (id) => {
      const spec = getStyle(id)
      get().commit()
      set((s) => {
        const was = getStyle(s.doc.style)
        s.doc.style = id
        if (spec.square !== was.square) s.doc.grid.aspect = spec.square ? 1 : 1.8
        if (spec.cell && spec.cell !== was.cell) {
          s.doc.grid.cell = spec.cell
        } else if (spec.group === 'raster' && was.group !== 'raster') {
          s.doc.grid.cell = Math.max(s.doc.grid.cell, 18)
        } else if (spec.group !== 'raster' && was.group === 'raster') {
          s.doc.grid.cell = Math.min(s.doc.grid.cell, 12)
        }
      })
      track('studio_look_applied', { editor: 'ascii', style: id })
      persist(get().doc)
    },

    applyLook: (id) => {
      const recipe = RECIPES.find((r) => r.id === id)
      if (!recipe) return
      get().commit()
      set((s) => {
        applyRecipe(s.doc, recipe.patch as DeepPatch)
      })
      track('studio_look_applied', { editor: 'ascii', recipe: id })
      persist(get().doc)
    },

    setStyleParam: (key, v) => {
      get().commit(`ascii-sp-${key}`)
      set((s) => {
        const id = s.doc.style
        const bag = (s.doc.styleParams[id] ??= {})
        bag[key] = v
      })
      persist(get().doc)
    },

    addLayer: (kind) => {
      const spec = getFilter(kind)
      if (!spec) return
      const layer = { uid: uid(), kind, on: true, params: defaults(spec.params) }
      get().commit()
      set((s) => {
        s.doc.layers.push(layer)
        s.activeLayer = layer.uid
      })
      track('studio_look_applied', { editor: 'ascii', layer: kind })
      persist(get().doc)
    },

    removeLayer: (id) => {
      get().commit()
      set((s) => {
        s.doc.layers = s.doc.layers.filter((l) => l.uid !== id)
        if (s.activeLayer === id) s.activeLayer = null
      })
      persist(get().doc)
    },

    toggleLayer: (id) => {
      get().commit()
      set((s) => {
        const l = s.doc.layers.find((x) => x.uid === id)
        if (l) l.on = !l.on
      })
      persist(get().doc)
    },

    duplicateLayer: (id) => {
      const src = get().doc.layers.find((l) => l.uid === id)
      if (!src) return
      const copy = { ...(JSON.parse(JSON.stringify(src)) as typeof src), uid: uid() }
      get().commit()
      set((s) => {
        const i = s.doc.layers.findIndex((l) => l.uid === id)
        s.doc.layers.splice(i + 1, 0, copy)
        s.activeLayer = copy.uid
      })
      persist(get().doc)
    },

    moveLayer: (id, to) => {
      const from = get().doc.layers.findIndex((l) => l.uid === id)
      const n = get().doc.layers.length
      const target = Math.max(0, Math.min(n - 1, to))
      if (from < 0 || from === target) return
      get().commit()
      set((s) => {
        const [l] = s.doc.layers.splice(from, 1)
        s.doc.layers.splice(target, 0, l)
      })
      persist(get().doc)
    },

    setLayerParam: (id, key, v, label) => {
      get().commit(label ?? `ascii-layer-${id}-${key}`)
      set((s) => {
        const l = s.doc.layers.find((x) => x.uid === id)
        if (l) l.params[key] = v
      })
      persist(get().doc)
    },

    setActiveLayer: (id) => set((s) => void (s.activeLayer = id)),

    toggleFav: (id) => {
      set((s) => {
        s.favs = s.favs.includes(id) ? s.favs.filter((f) => f !== id) : [...s.favs, id]
      })
      writeLocal(FAVS_KEY, get().favs)
    },

    saveLook: (name) => {
      const entry: SavedLook = {
        id: uid(),
        name: name.trim() || 'My look',
        at: Date.now(),
        look: lookOf(get().doc),
      }
      set((s) => {
        s.saved.unshift(entry)
      })
      writeLocal(SAVED_KEY, get().saved)
      ui.toast('Recipe saved')
    },

    applySaved: (look) => {
      get().commit()
      set((s) => {
        const keep = {
          assetId: s.doc.assetId,
          presetId: s.doc.presetId,
          size: { ...s.doc.size },
          name: s.doc.name,
          version: 1 as const,
        }
        const next = { ...defaultAsciiDoc(), ...(JSON.parse(JSON.stringify(look)) as object), ...keep } as AsciiDoc
        s.doc = normalizeDoc(next)
      })
      track('studio_look_applied', { editor: 'ascii', recipe: 'saved' })
      persist(get().doc)
    },

    deleteSaved: (id) => {
      set((s) => {
        s.saved = s.saved.filter((r) => r.id !== id)
      })
      writeLocal(SAVED_KEY, get().saved)
    },

    renameSaved: (id, name) => {
      set((s) => {
        const r = s.saved.find((x) => x.id === id)
        if (r) r.name = name
      })
      writeLocal(SAVED_KEY, get().saved)
    },

    /**
     * A new look, rolled.
     *
     * Not uniformly random: a uniformly random document is almost always mud.
     * The dice pick a style, then only the settings that style listens to, from
     * the middle of ranges that are known to hold together, and leave tone
     * alone because tone is about the photograph rather than the look.
     */
    shuffle: () => {
      const style = pick(STYLES.filter((x) => x.id !== get().doc.style)).id
      get().setStyle(style)
      const spec = getStyle(style)
      get().patch((d) => {
        if (spec.ramp) d.ramp = pick(RAMPS.filter((r) => r.id !== 'custom')).id
        d.color.mode = pick(['source', 'source', 'ink', 'duotone', 'gradient', 'spectrum'] as const)
        d.color.gradient = pick(GRADIENTS).id
        d.color.hue = Math.round(Math.random() * 360)
        const [a, b] = pick([
          ['#f7f8f8', '#5e6ad2'],
          ['#ffd166', '#ef476f'],
          ['#4dff88', '#003b1a'],
          ['#ff4fd8', '#4fe3ff'],
          ['#1b1f2a', '#f4efe6'],
        ])
        d.color.ink = a
        d.color.ink2 = b
        if (spec.params) {
          const bag: Record<string, ParamValue> = {}
          for (const p of spec.params) {
            if (p.kind === 'range') {
              const v = p.min + (p.max - p.min) * (0.25 + Math.random() * 0.5)
              bag[p.key] = Math.round(v / p.step) * p.step
            } else if (p.kind === 'choice') bag[p.key] = pick(p.options).id
            else bag[p.key] = p.def
          }
          d.styleParams[style] = bag
        }
        d.backdrop.mode = pick(['paper', 'source', 'blurred', 'mesh'] as const)
        d.backdrop.opacity = 0.2 + Math.random() * 0.3
      })
    },

    cycleStyle: (dir) => {
      const favs = get().favs
      const list = favs.length > 1 ? STYLES.filter((x) => favs.includes(x.id)) : STYLES
      const i = list.findIndex((x) => x.id === get().doc.style)
      const next = list[(i + dir + list.length) % list.length]
      if (next) get().setStyle(next.id)
    },

    setWorkspace: (w) => {
      writeLocal(WS_KEY, w)
      set((s) => void (s.workspace = w))
    },

    reset: () => {
      get().commit()
      set((s) => {
        // the picture survives a reset; only the treatment of it goes back.
        // `size` is copied rather than carried across, so no piece of the old
        // draft ends up inside the new document.
        const { assetId, presetId, name } = s.doc
        const size = { ...s.doc.size }
        s.doc = { ...defaultAsciiDoc(), assetId, presetId, size, name }
      })
      persist(get().doc)
    },

    /**
     * An empty document, picture and all.
     *
     * Not the same button as Reset next to the Looks: that one keeps your
     * photograph and puts only the treatment back, which is what you want
     * ninety times out of a hundred. This is the other ten: wrong picture,
     * start again. The history entry goes in first, so a hold you did not mean
     * costs one Ctrl+Z rather than the image.
     */
    startOver: () => {
      get().commit()
      set((s) => {
        if (s.url) URL.revokeObjectURL(s.url)
        s.bitmap?.close()
        s.url = null
        s.bitmap = null
        s.loadedId = null
        s.doc = defaultAsciiDoc()
      })
      ui.toast('Started over. Undo (Ctrl+Z) brings it back')
      persist(get().doc)
    },

    importImage: async (file, meta) => {
      try {
        const bmp = await createImageBitmap(file)
        const id = uid()
        await saveAsset(id, file)
        const url = URL.createObjectURL(file)

        // the document takes the picture's own shape, capped so the first grid
        // is one a browser can cut in a frame
        const k = Math.min(1, MAX_DOC_EDGE / Math.max(bmp.width, bmp.height))
        const width = Math.max(2, Math.round(bmp.width * k))
        const height = Math.max(2, Math.round(bmp.height * k))

        get().commit()
        set((s) => {
          const old = s.url
          if (old) URL.revokeObjectURL(old)
          s.bitmap?.close()
          s.url = url
          s.bitmap = bmp
          s.loadedId = id
          s.doc.assetId = id
          s.doc.presetId = meta?.presetId ?? null
          s.doc.size = { width, height }
          if (meta?.name) s.doc.name = meta.name
        })
        track('media_imported', { editor: 'ascii', kind: 'image', from: meta?.from ?? 'file' })
        persist(get().doc)
      } catch {
        ui.toast('That image could not be read', 'error')
      }
    },

    /**
     * Start from one of the shipped photographs.
     *
     * The blank canvas is the worst place to meet this editor: every control in
     * the panel is about a picture, so with no picture there is nothing to
     * learn anything from, and finding a file that ASCII-ises well is its own
     * small task. The presets are the same ones Shots and Studio offer as
     * backgrounds, which is why there is no second folder of images to ship.
     *
     * It fetches and then goes through `importImage`, so a preset ends up as an
     * ordinary asset: replaceable, undoable, and still there after a reload
     * with no memory of where it came from.
     */
    importPreset: async (id) => {
      const photo = getPresetPhoto(id)
      const blob = await loadPresetPhotoBlob(id)
      if (!blob || !photo) {
        ui.toast('That preset could not be loaded', 'error')
        return
      }
      await get().importImage(blob, { name: photo.name, from: 'preset', presetId: id })
    },

    clearImage: () => {
      get().commit()
      set((s) => {
        if (s.url) URL.revokeObjectURL(s.url)
        s.bitmap?.close()
        s.url = null
        s.bitmap = null
        s.loadedId = null
        s.doc.assetId = null
        s.doc.presetId = null
      })
      persist(get().doc)
    },

    /**
     * Bring the decoded picture back in line with the document.
     *
     * The source deliberately lives outside `doc`, so undo restores a document
     * without restoring what it points at. That was invisible while the only
     * way to change the picture was a file dialog; now that swapping presets is
     * one press, undoing a swap left the previous document's dimensions on
     * screen with the new photograph still in them. So every history move ends
     * here, and this reloads, drops, or leaves the source to match.
     */
    syncSource: async () => {
      const want = get().doc.assetId
      if (want === get().loadedId) return

      if (!want) {
        set((s) => {
          if (s.url) URL.revokeObjectURL(s.url)
          s.bitmap?.close()
          s.url = null
          s.bitmap = null
          s.loadedId = null
        })
        return
      }

      const blob = await loadAsset(want)
      if (!blob) return
      const bmp = await createImageBitmap(blob)
      // a second move can land while the blob is being read; the last one to be
      // asked for is the one that wins, not the last one to finish decoding
      if (get().doc.assetId !== want) {
        bmp.close()
        return
      }
      const url = URL.createObjectURL(blob)
      set((s) => {
        if (s.url) URL.revokeObjectURL(s.url)
        s.bitmap?.close()
        s.url = url
        s.bitmap = bmp
        s.loadedId = want
      })
    },

    setSection: (section) => {
      localStorage.setItem('ms-ascii-section', section)
      set((s) => void (s.section = section))
    },
    setDialog: (dialog) => set((s) => void (s.dialog = dialog)),

    hydrate: async () => {
      if (get().hydrated) return
      try {
        const saved = localStorage.getItem('ms-ascii-section')
        if (saved === 'art' || saved === 'look' || saved === 'layers') set((s) => void (s.section = saved))

        const loaded = await loadJSON<AsciiDoc>(DOC_KEY)
        if (loaded && loaded.version === 1) {
          let bitmap: ImageBitmap | null = null
          let url: string | null = null
          // fills every field added since the document was written
          const doc = normalizeDoc(loaded)
          if (doc.assetId) {
            const blob = await loadAsset(doc.assetId)
            if (blob) {
              bitmap = await createImageBitmap(blob)
              url = URL.createObjectURL(blob)
            } else {
              // the blob is gone but the document still refers to it: forget the
              // reference rather than leaving a picture that can never load
              doc.assetId = null
              doc.presetId = null
            }
          }
          set((s) => {
            s.doc = doc
            s.bitmap = bitmap
            s.url = url
            s.loadedId = bitmap ? doc.assetId : null
          })
        }
      } catch {
        /* an unreadable document is not a reason to refuse to open the tool */
      }
      set((s) => void (s.hydrated = true))
    },
  })),
)
