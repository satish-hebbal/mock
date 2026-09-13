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
import { PALETTE_BY_ID, PALETTES, type Palette } from './palettes'
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
  /** `via` is how it was reached, for analytics only; a hand-picked one omits it. */
  applyPalette: (id: string, via?: 'shuffle') => void
  swapInk: () => void
  shufflePalette: () => void
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

/*
 * Surprise me lays out a whole lap in advance and then deals it.
 *
 * Two different things make this button feel repetitive, and only one of them
 * is repetition.
 *
 * The first is the arithmetic one. A fresh uniform draw over a hundred and
 * twelve looks hands you one you have already seen inside ten presses about a
 * third of the time, and excluding only the picture currently on screen fixes
 * the single case a user can prove and none of the ones they notice. Dealing a
 * lap of a shuffled list, rather than drawing with replacement, settles that
 * half: nothing comes back until the lap it belongs to is finished.
 *
 * The second is the one that actually got noticed, and no amount of shuffling
 * ids would have fixed it. A hundred and twelve looks are built on seventy-one
 * generators: Truchet is three of them, Liquid is four. A plain permutation is
 * perfectly happy to deal two Truchets back to back, and while those are two
 * different documents by every field the code compares, to the eye they are one
 * picture in two colourways. The shape is what people remember. A shuffle that
 * only guarantees distinct ids guarantees nothing anybody can see.
 *
 * So a lap is one preset per generator, seventy-one of them, and no shape can
 * come back until every other shape has had its turn. A generator with several
 * presets sends a different one each lap, so all hundred and twelve looks still
 * get seen, just spread over four laps instead of crammed into one.
 *
 * Within a lap the order is spread as well as shuffled. It is laid down one
 * slot at a time, and each slot takes whichever of the remaining looks is
 * furthest in character from what was just dealt: a different family, and
 * different paper, so a press lands on a new picture rather than a variation on
 * the last one. Ties go to a coin toss, so no two laps run in the same order.
 *
 * The lap is module state, not document state: it belongs to this sitting with
 * the tool, and a reload starting from a clean deal is right.
 */
const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]))

/**
 * How far apart two looks sharing a generator are held across the seam.
 *
 * Inside a lap a generator appears once and the question does not arise. The
 * seam between two laps is the one place it does, because the end of one and
 * the start of the next are neighbours in time that were shuffled apart, so the
 * first slots of a new lap keep clear of what the old one just finished with.
 */
const SOURCE_GAP = 20
/** Families are broad and overlap, so they only have to avoid clumping. */
const GROUP_GAP = 4
/** Light paper after dark paper is the cheapest way to make a press land. */
const TONE_GAP = 3

/**
 * True for a look on light paper.
 *
 * Signal draws two-tone, so the paper is the whole mood of the picture, and
 * alternating it is most of what makes consecutive presses feel unalike.
 */
function onLightPaper(p: Preset) {
  const hex = p.paper.replace('#', '')
  if (hex.length < 6) return false
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
}

/** Ids left in this lap, dealt from the end. */
let lap: string[] = []
/** What was dealt lately, oldest first, kept to the longest gap that matters. */
const recent: Preset[] = []

/**
 * The colourways of each generator, and which one it is that generator's turn
 * to send.
 *
 * A generator gets one slot a lap, so the choice of which of its presets fills
 * that slot is a rotation: the three Truchets take turns rather than competing,
 * which is how every look still gets seen without any of them doubling up.
 */
const BY_SOURCE = new Map<string, Preset[]>()
for (const p of PRESETS) {
  const list = BY_SOURCE.get(p.source)
  if (list) list.push(p)
  else BY_SOURCE.set(p.source, [p])
}
const rotation = new Map<string, Preset[]>()

function nextOfSource(source: string): Preset {
  let queue = rotation.get(source)
  if (!queue?.length) {
    queue = [...(BY_SOURCE.get(source) ?? [])]
    // a two-preset generator would otherwise alternate forever in the order it
    // was written, which is a pattern people do notice over a long sitting
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[queue[i], queue[j]] = [queue[j], queue[i]]
    }
    rotation.set(source, queue)
  }
  return queue.pop()!
}

/** Presses since this generator was last dealt, or Infinity if it is fresh. */
function sinceSource(history: Preset[], source: string) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].source === source) return history.length - i
  }
  return Infinity
}

/**
 * What it would cost to deal this look next. Lower is better.
 *
 * The terms are orders of magnitude apart on purpose. Repeating a generator is
 * not a worse version of repeating a family, it is a different kind of mistake,
 * and no amount of family variety should ever be able to buy it.
 */
function clash(p: Preset, history: Preset[]) {
  // the jitter is the tie-break: without it the pool order decides, and the
  // pool order is the order the presets happen to be written in
  let cost = Math.random()

  const back = sinceSource(history, p.source)
  if (back <= SOURCE_GAP) cost += 1e6 * (SOURCE_GAP - back + 1)

  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    const gap = history.length - i // 1 is the look dealt most recently
    if (gap > GROUP_GAP) break
    // the same family twice running is the one people read as a repeat, so it
    // costs more than the rest of the window put together
    if (h.group === p.group) cost += gap === 1 ? 400 : 20 * (GROUP_GAP - gap + 1)
    if (gap <= TONE_GAP) {
      if (onLightPaper(h) === onLightPaper(p)) cost += 8 * (TONE_GAP - gap + 1)
      if (h.kind === p.kind) cost += 3
    }
  }
  return cost
}

/**
 * Deal order for one lap: every generator once, in an order that spreads them.
 *
 * Greedy rather than optimal, which is the right trade: the cost function is a
 * stand-in for taste, and solving it exactly would be a hundred lines spent
 * perfecting a guess. The pool is shuffled first so the greedy run meets equal
 * candidates in a different order every lap.
 */
function buildLap() {
  const pool = [...BY_SOURCE.keys()].map(nextOfSource)
  // Fisher-Yates. The sort-by-random one-liner is shorter and is not uniform.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }

  /* the history carries over from the lap before, which is what keeps the seam
     between two laps as well spread as the middle of one */
  const history = recent.slice()
  const order: string[] = []
  while (pool.length) {
    let best = 0
    let bestCost = Infinity
    for (let i = 0; i < pool.length; i++) {
      const cost = clash(pool[i], history)
      if (cost < bestCost) {
        bestCost = cost
        best = i
      }
    }
    const [chosen] = pool.splice(best, 1)
    order.push(chosen.id)
    history.push(chosen)
    if (history.length > SOURCE_GAP) history.shift()
  }

  lap = order.reverse() // dealt from the end, so the first slot is the last item
}

function noteDealt(p: Preset) {
  recent.push(p)
  if (recent.length > SOURCE_GAP) recent.shift()
}

/**
 * The next look, never the one already on screen.
 *
 * A reload arrives with a document but no memory of what dealt it, so the
 * picture on screen is recognised by what it looks like rather than by an id.
 * Anything skipped for that reason goes back under the deck, not out of the
 * lap, so a lap still shows every generator exactly once.
 */
function dealPreset(doc: SignalDoc): Preset {
  const onScreen = (p: Preset) => p.source === doc.source.id && p.ink === doc.ink.ink
  const skipped: string[] = []
  let pick: Preset | undefined

  // at most two passes: what is left of this lap, then a fresh one
  for (let pass = 0; pass < 2 && !pick; pass++) {
    if (!lap.length) buildLap()
    while (lap.length) {
      const p = PRESET_BY_ID.get(lap.pop()!)
      if (!p) continue
      if (onScreen(p)) {
        skipped.push(p.id)
        continue
      }
      pick = p
      break
    }
  }
  lap.unshift(...skipped)

  const chosen = pick ?? PRESETS[0]
  noteDealt(chosen)
  return chosen
}

/**
 * A look the user picked by hand counts as dealt.
 *
 * Otherwise pressing Surprise me straight after clicking a preset can hand back
 * the preset you just clicked, or its twin on the same generator, which is the
 * same broken-looking outcome from a different direction.
 */
function markDealt(id: string) {
  const p = PRESET_BY_ID.get(id)
  if (!p) return
  // the generator leaves the lap, not just the preset: the shape is what was
  // seen, and its other colourway sitting two slots away is the whole bug
  lap = lap.filter((other) => PRESET_BY_ID.get(other)?.source !== p.source)
  noteDealt(p)
}

/*
 * Palettes get the lap and none of the rest of it.
 *
 * Forty-eight drawn uniformly hand back one you have just seen inside a handful
 * of presses, and colour is the loudest thing on screen, so that repeat is
 * noticed the moment it lands. Dealing a lap settles it on its own: nothing
 * comes back until the other forty-seven have had their turn.
 *
 * The spread scoring above is deliberately not reused here. It exists because a
 * hundred and twelve looks are built on seventy-one generators, so two
 * different ids can be the same picture and distinct ids guarantee nothing
 * anybody can see. Two palettes are never the same palette. The id is the whole
 * of what is being shown, so a plain permutation is already the answer.
 */
let paletteLap: string[] = []

function dealPalette(current: string): Palette {
  if (!paletteLap.length) {
    paletteLap = PALETTES.map((p) => p.id)
    // Fisher-Yates, as above. The sort-by-random one-liner is not uniform.
    for (let i = paletteLap.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[paletteLap[i], paletteLap[j]] = [paletteLap[j], paletteLap[i]]
    }
  }
  /*
   * The one case a user can prove: asking for another palette and being handed
   * the one already applied. Inside a lap it cannot happen, because the current
   * palette was dealt out of this one; at the seam between two laps it can, so
   * the head goes under the deck rather than out of the lap and all forty-eight
   * are still shown.
   */
  if (paletteLap.length > 1 && paletteLap[paletteLap.length - 1] === current) {
    paletteLap.unshift(paletteLap.pop()!)
  }
  return PALETTE_BY_ID.get(paletteLap.pop()!)!
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
      const preset = PRESET_BY_ID.get(id)
      if (!preset) return
      markDealt(id)
      get().commit()
      set((s) => {
        applyPreset(s.doc, preset)
      })
      track('studio_look_applied', { editor: 'signal', recipe: id })
      persist(get().doc)
    },

    applyPalette: (id, via) => {
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
      track('studio_look_applied', { editor: 'signal', palette: id, ...(via && { via }) })
      persist(get().doc)
    },

    /**
     * Another palette, at random, never the one already applied.
     *
     * The dice sit next to the fold rather than inside it because the wall of
     * forty-eight is the thing you open when you have something in mind. Not
     * having something in mind is the commoner case and had no control at all:
     * the alternative was opening the fold and picking by eye, which is a
     * decision the tool can make better than a tired person can.
     */
    shufflePalette: () => {
      get().applyPalette(dealPalette(get().doc.ink.palette).id, 'shuffle')
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
     * Never the one already on screen, never one seen recently, and never the
     * same shape twice in a row: the pick comes off the spread lap above, which
     * is what stops a hundred and twelve looks from feeling like a dozen.
     */
    shuffle: () => {
      const pick: Preset = dealPreset(get().doc)
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
