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
import { applyRecipe, RECIPES, type DeepPatch } from './presets'
import { getStyle } from './styles'
import { defaultAsciiDoc, type AsciiDoc } from './types'

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

export type AsciiSection = 'art' | 'look'
export type AsciiDialog = 'export' | null

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

  commit: (label?: string) => void
  undo: () => void
  redo: () => void

  patch: (fn: (d: AsciiDoc) => void, label?: string) => void
  setStyle: (id: AsciiDoc['style']) => void
  applyLook: (id: string) => void
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
        if (spec.group === 'raster' && was.group !== 'raster') {
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
        if (saved === 'art' || saved === 'look') set((s) => void (s.section = saved))

        const doc = await loadJSON<AsciiDoc>(DOC_KEY)
        if (doc && doc.version === 1) {
          let bitmap: ImageBitmap | null = null
          let url: string | null = null
          // written before presets existed: absent means "not from one"
          doc.presetId = doc.presetId ?? null
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
