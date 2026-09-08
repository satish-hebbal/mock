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

interface AsciiState {
  hydrated: boolean
  doc: AsciiDoc
  past: AsciiDoc[]
  future: AsciiDoc[]

  /** object URL for the source, kept for the media thumbnail */
  url: string | null
  /** the decoded source, which is what the renderer actually draws from */
  bitmap: ImageBitmap | null
  section: AsciiSection
  dialog: AsciiDialog

  commit: (label?: string) => void
  undo: () => void
  redo: () => void

  patch: (fn: (d: AsciiDoc) => void, label?: string) => void
  setStyle: (id: AsciiDoc['style']) => void
  applyLook: (id: string) => void
  reset: () => void

  importImage: (file: Blob) => Promise<void>
  clearImage: () => void

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
        const { assetId, name } = s.doc
        const size = { ...s.doc.size }
        s.doc = { ...defaultAsciiDoc(), assetId, size, name }
      })
      persist(get().doc)
    },

    importImage: async (file) => {
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
          s.doc.assetId = id
          s.doc.size = { width, height }
        })
        track('media_imported', { editor: 'ascii', kind: 'image' })
        persist(get().doc)
      } catch {
        ui.toast('That image could not be read', 'error')
      }
    },

    clearImage: () => {
      get().commit()
      set((s) => {
        if (s.url) URL.revokeObjectURL(s.url)
        s.bitmap?.close()
        s.url = null
        s.bitmap = null
        s.doc.assetId = null
      })
      persist(get().doc)
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
          if (doc.assetId) {
            const blob = await loadAsset(doc.assetId)
            if (blob) {
              bitmap = await createImageBitmap(blob)
              url = URL.createObjectURL(blob)
            } else {
              // the blob is gone but the document still refers to it: forget the
              // reference rather than leaving a picture that can never load
              doc.assetId = null
            }
          }
          set((s) => {
            s.doc = doc
            s.bitmap = bitmap
            s.url = url
          })
        }
      } catch {
        /* an unreadable document is not a reason to refuse to open the tool */
      }
      set((s) => void (s.hydrated = true))
    },
  })),
)
