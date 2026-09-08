/**
 * Signal state.
 *
 * The same shape as the three tools next door: one document, a past and a
 * future around it, and everything that is not the document kept outside it.
 *
 * The clock is the interesting case of that split. `time` and `playing` are
 * state, they change sixty times a second, and neither belongs in the document:
 * putting the clock in `doc` would mean every frame pushed an undo entry and
 * every frame wrote to IndexedDB. So playback lives beside the document, and
 * what gets saved is a picture you can return to rather than the moment you
 * left it at.
 *
 * `time` is also not React state. The canvas reads it from the store on each
 * animation frame without subscribing, because a `set` per frame would
 * re-render the whole panel sixty times a second to move a number no panel
 * shows. The one thing that does need re-rendering, the FPS readout, is
 * throttled to once a second in the canvas itself.
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { loadJSON, saveJSON } from '../lib/db'
import { coalesces, endEditRun } from '../lib/history'
import { track } from '../lib/analytics'
import { ui } from '../lib/ui'
import { applyPreset, PRESETS, type Preset } from './presets'
import { PALETTE_BY_ID } from './palettes'
import { findSource } from './sources'
import { defaultSignalDoc, migrateDoc, type SignalDoc } from './types'

const DOC_KEY = 'signal-current'
const SLOTS_KEY = 'ms-signal-slots'
const MAX_SLOTS = 8

const clone = (d: SignalDoc): SignalDoc => JSON.parse(JSON.stringify(d)) as SignalDoc

export type SignalDialog = 'export' | null

/** A saved look, kept in localStorage rather than in the document store. */
export interface Slot {
  id: string
  name: string
  doc: SignalDoc
}

interface SignalState {
  hydrated: boolean
  doc: SignalDoc
  past: SignalDoc[]
  future: SignalDoc[]

  playing: boolean
  /** seconds of document time, advanced by the canvas, never by React */
  time: number
  dialog: SignalDialog
  slots: Slot[]

  commit: (label?: string) => void
  undo: () => void
  redo: () => void
  patch: (fn: (d: SignalDoc) => void, label?: string) => void
  setSource: (kind: SignalDoc['source']['kind'], id: string) => void
  setParam: (key: string, value: number) => void
  resetParams: () => void
  setName: (v: string) => void

  setPlaying: (v: boolean) => void
  togglePlay: () => void
  restart: () => void

  applyLook: (id: string) => void
  applyPalette: (id: string) => void
  swapInk: () => void
  shuffle: () => void
  reset: () => void

  saveSlot: (name: string) => void
  loadSlot: (id: string) => void
  deleteSlot: (id: string) => void

  setDialog: (d: SignalDialog) => void
  hydrate: () => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function persist(doc: SignalDoc) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveJSON(DOC_KEY, doc), 400)
}

/**
 * Write the document now rather than in four hundred milliseconds.
 *
 * The inspector header offers an explicit Save, and "saved" has to mean saved
 * by the time the toast appears, not shortly afterwards.
 */
export async function persistSignal() {
  clearTimeout(saveTimer)
  await saveJSON(DOC_KEY, useSignal.getState().doc)
}

function readSlots(): Slot[] {
  try {
    const raw = localStorage.getItem(SLOTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Slot[]
    if (!Array.isArray(parsed)) return []
    // a saved look carries a whole document, so it needs the same treatment
    return parsed
      .slice(0, MAX_SLOTS)
      .map((s) => ({ ...s, doc: migrateDoc(s?.doc) }))
      .filter((s): s is Slot => s.doc !== null && typeof s.id === 'string')
  } catch {
    // a corrupt slot list is not worth a dialog: start clean
    return []
  }
}

function writeSlots(slots: Slot[]) {
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(slots))
  } catch {
    ui.toast('There was no room to save that look', 'error')
  }
}

export const useSignal = create<SignalState>()(
  immer((set, get) => ({
    hydrated: false,
    doc: defaultSignalDoc(),
    past: [],
    future: [],
    playing: true,
    time: 0,
    dialog: null,
    slots: [],

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
     * Point at a different generator.
     *
     * The controls go with it. They are keyed by name and two generators can
     * both have a `spread` that means different things, so carrying the old
     * values across would leave somebody looking at a slider whose position
     * came from a pattern they are no longer looking at.
     */
    setSource: (kind, id) => {
      get().commit()
      set((s) => {
        s.doc.source.kind = kind
        s.doc.source.id = id
        s.doc.source.params = {}
      })
      track('studio_look_applied', { editor: 'signal', source: id })
      persist(get().doc)
    },

    setParam: (key, value) => {
      // labelled per key, so dragging one slider coalesces into one undo step
      // and moving to the next one starts a new step
      get().patch((d) => void (d.source.params[key] = value), `signal-p-${key}`)
    },

    /* Deleting rather than writing defaults: absent already means default, and
       an empty object is how a fresh document starts. */
    resetParams: () => {
      get().commit()
      set((s) => void (s.doc.source.params = {}))
      persist(get().doc)
    },

    setName: (v) => {
      set((s) => void (s.doc.name = v))
      persist(get().doc)
    },

    setPlaying: (v) => set((s) => void (s.playing = v)),
    togglePlay: () => set((s) => void (s.playing = !s.playing)),

    /*
     * Restarting sets the clock rather than the document, so it is not undoable
     * and does not touch the saved file. Going back to zero is a way of looking
     * at something, not a change to it.
     */
    restart: () =>
      set((s) => {
        s.time = 0
      }),

    applyLook: (id) => {
      const preset = PRESETS.find((p) => p.id === id)
      if (!preset) return
      get().commit()
      set((s) => {
        applyPreset(s.doc, preset)
      })
      track('studio_look_applied', { editor: 'signal', recipe: id })
      persist(get().doc)
    },

    applyPalette: (id) => {
      const pal = PALETTE_BY_ID.get(id)
      if (!pal) return
      get().commit()
      set((s) => {
        s.doc.ink.ink = pal.ink
        s.doc.ink.paper = pal.paper
        s.doc.ink.accent = pal.accent
        s.doc.ink.mix = pal.mix
        s.doc.ink.palette = id
      })
      track('studio_look_applied', { editor: 'signal', palette: id })
      persist(get().doc)
    },

    /*
     * Swapping ink and paper is the single most useful colour control in a
     * two-tone tool, and it is one press rather than two colour pickers,
     * because the pair is what matters and not either half.
     */
    swapInk: () => {
      get().commit()
      set((s) => {
        const { ink, paper } = s.doc.ink
        s.doc.ink.ink = paper
        s.doc.ink.paper = ink
        s.doc.ink.palette = 'none'
      })
      persist(get().doc)
    },

    /**
     * A different picture, at random.
     *
     * Never the one already on screen. Landing on your own document is the one
     * outcome that makes the button look broken, and it is the outcome a naive
     * random index gives roughly one time in eighty.
     */
    shuffle: () => {
      const current = get().doc
      const pool = PRESETS.filter(
        (p) => !(p.source === current.source.id && p.ink === current.ink.ink),
      )
      const pick: Preset = pool[Math.floor(Math.random() * pool.length)] ?? PRESETS[0]
      get().commit()
      set((s) => {
        applyPreset(s.doc, pick)
      })
      track('studio_look_applied', { editor: 'signal', recipe: pick.id, via: 'shuffle' })
      persist(get().doc)
    },

    reset: () => {
      get().commit()
      set((s) => {
        // the canvas survives a reset; only the treatment goes back, for the
        // same reason ASCII keeps its picture
        const canvas = { ...s.doc.canvas }
        const name = s.doc.name
        s.doc = { ...defaultSignalDoc(), canvas, name }
      })
      persist(get().doc)
    },

    saveSlot: (name) => {
      const doc = clone(get().doc)
      set((s) => {
        const slot: Slot = { id: crypto.randomUUID(), name: name.trim() || 'Untitled', doc }
        s.slots.unshift(slot)
        if (s.slots.length > MAX_SLOTS) s.slots.pop()
        writeSlots(s.slots)
      })
      track('studio_look_applied', { editor: 'signal', saved: true })
    },

    loadSlot: (id) => {
      const slot = get().slots.find((s) => s.id === id)
      if (!slot) return
      get().commit()
      set((s) => {
        s.doc = clone(slot.doc)
      })
      persist(get().doc)
    },

    deleteSlot: (id) => {
      set((s) => {
        s.slots = s.slots.filter((slot) => slot.id !== id)
        writeSlots(s.slots)
      })
    },

    setDialog: (dialog) => set((s) => void (s.dialog = dialog)),

    hydrate: async () => {
      if (get().hydrated) return
      try {
        const slots = readSlots()
        const doc = migrateDoc(await loadJSON<unknown>(DOC_KEY))
        set((s) => {
          s.slots = slots
          if (doc && sourceExists(doc)) s.doc = doc
        })
      } catch {
        /* an unreadable document is not a reason to refuse to open the tool */
      }
      set((s) => void (s.hydrated = true))
    },
  })),
)

/**
 * True when the saved document names a generator this build still has.
 *
 * A document that survives a release where an effect was removed would open on
 * a blank canvas with every control apparently doing nothing, which reads as
 * the tool being broken rather than as the document being stale. Better to
 * start fresh and lose one draft than to hand somebody a dead editor.
 */
function sourceExists(doc: SignalDoc) {
  return findSource(doc.source.kind, doc.source.id) !== undefined
}
