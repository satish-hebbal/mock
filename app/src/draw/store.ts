/**
 * Draw's state.
 *
 * Follows the same shape as Shots next door: one document, a past and a future
 * stack around it, and the view state kept outside the document so panning the
 * canvas is not an undoable event.
 *
 * The one thing worth calling out is `style`. There is no separate "defaults"
 * object and "selection" object: the properties panel writes to `style`, and
 * writing to `style` also writes through to whatever is selected. That is why
 * changing the stroke colour with nothing selected changes what you draw next
 * rather than doing nothing at all, and why changing it *with* something
 * selected leaves the panel showing what you just picked. Excalidraw behaves
 * this way and it is the behaviour that stops you setting the same colour
 * twice, once for the selection and once for the next shape.
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { loadAsset, loadJSON, saveAsset, saveJSON } from '../lib/db'
import { coalesces, endEditRun } from '../lib/history'
import { ui } from '../lib/ui'
import { PENS, strokeBounds } from './pens'
import { dropGeometry, sceneBounds, unionBounds, type Box } from './geometry'
import { measureText } from './render'
import {
  DEFAULT_STYLE,
  MAX_ZOOM,
  MIN_ZOOM,
  defaultDrawDoc,
  isLinear,
  isNeutralInk,
  isStroke,
  neutralInk,
  type GridStyle,
  type DrawDoc,
  type DrawElement,
  type DrawStyle,
  type DrawTool,
  type ElementKind,
  type PenId,
  type Viewport,
} from './types'

const DOC_KEY = 'draw-current'
const uid = () => crypto.randomUUID()
const seed = () => Math.floor(Math.random() * 2 ** 31) || 1
const clone = (d: DrawDoc): DrawDoc => JSON.parse(JSON.stringify(d)) as DrawDoc

/**
 * Independent copies of `els`, moved by (dx, dy).
 *
 * New ids because two elements cannot share one, and a new seed because
 * roughness is generated from it rather than stored: leave the seed alone and
 * the copy is the same hand-drawn wobble stroke for stroke, which reads as a
 * rendering fault rather than as two objects.
 *
 * Used by Ctrl+D, by alt-dragging, and by paste, so all three agree on what a
 * copy is.
 */
export function copiesOf(els: DrawElement[], dx = 0, dy = 0): DrawElement[] {
  return els.map((e) => ({
    ...(JSON.parse(JSON.stringify(e)) as DrawElement),
    id: uid(),
    seed: seed(),
    x: e.x + dx,
    y: e.y + dy,
  }))
}

/**
 * Where the pen tray sits and how physical it looks. Drawesome's chrome props.
 *
 * Only bottom and left: the right edge belongs to the tool rail now, and
 * offering a placement that lands the bar on top of it is offering a bug.
 */
export interface TrayConfig {
  placement: 'bottom' | 'left'
  align: 'start' | 'center' | 'end'
  inset: number
  look: 'classic' | 'studio'
  depth: 'flat' | 'soft' | 'regular' | 'strong'
  draggable: boolean
  /** where the user dragged it to, as a fraction of the viewport */
  offset: { x: number; y: number } | null
}

/**
 * Which face the morphing tray is showing.
 *
 * Collapsing is deliberately *not* one of these. Rolling the bar up is a state
 * of the bar; which face it would show if unrolled is a separate question, and
 * conflating them meant expanding always dumped you back on the pens even if
 * you had rolled it up mid-palette.
 */
export type TrayFace = 'tools' | 'ink' | 'size' | 'shape'

export type DrawDialog = 'export' | null

interface DrawState {
  hydrated: boolean
  doc: DrawDoc
  past: DrawDoc[]
  future: DrawDoc[]

  tool: DrawTool
  /** Excalidraw's padlock: keep the tool in hand instead of dropping to select */
  toolLocked: boolean
  pen: PenId
  style: DrawStyle
  /** per-pen ink and barrel size, so picking up the highlighter is picking up *your* highlighter */
  penInk: Record<PenId, string>
  penSize: Record<PenId, number>
  inkMode: 'auto' | 'shared' | 'per-tool'
  eraserSize: number
  /** Drawesome takes away area; Excalidraw takes away objects. Both are useful. */
  eraserMode: 'area' | 'object'
  /**
   * The last solid sheet chosen.
   *
   * Switching to a transparent or checkered surface and back should return the
   * board you were on, not dump you on white. Without this, anyone working on a
   * chalkboard who glanced at the transparent surface lost it.
   */
  lastSheet: string

  viewport: Viewport
  selectedIds: string[]
  editingTextId: string | null
  images: Record<string, string>
  tray: TrayConfig
  trayFace: TrayFace
  /** rolled up into a disc with the tool you are holding still in it */
  trayCollapsed: boolean
  /** print the current size on each pen's barrel */
  trayGauge: boolean
  dialog: DrawDialog

  // history
  commit: (label?: string) => void
  undo: () => void
  redo: () => void

  // elements
  addElement: (el: DrawElement, label?: string) => void
  updateElements: (ids: string[], patch: Partial<DrawElement>, label?: string) => void
  removeElements: (ids: string[]) => void
  /** save after a gesture that mutated the doc directly for speed */
  touch: () => void
  duplicateSelection: () => void
  /** drop clipboard elements onto the board, centred on `at` when given */
  pasteElements: (els: DrawElement[], at?: { x: number; y: number }) => void
  reorder: (dir: 'front' | 'forward' | 'backward' | 'back') => void
  clear: () => void

  // tools & style
  setTool: (t: DrawTool) => void
  setToolLocked: (v: boolean) => void
  setPen: (p: PenId) => void
  setPenSize: (size: number) => void
  setInk: (color: string) => void
  setStyle: (patch: Partial<DrawStyle>, label?: string) => void
  setEraserSize: (v: number) => void
  setEraserMode: (m: 'area' | 'object') => void
  setInkMode: (m: 'auto' | 'shared' | 'per-tool') => void
  setBackground: (bg: string) => void
  setGrid: (v: GridStyle) => void

  /** add a text element at a scene point and begin editing it; returns its id */
  placeText: (x: number, y: number) => string
  /** put the caret into an existing text element */
  editText: (id: string) => void
  /** finish editing; an untouched label is nothing and is dropped */
  endTextEdit: () => void
  /** re-point the neutral inks at whatever is now behind the drawing */
  syncInkToPaper: (appDark: boolean) => void

  // selection
  select: (ids: string[]) => void
  selectAll: () => void
  setEditingText: (id: string | null) => void

  // view
  setViewport: (v: Partial<Viewport>) => void
  zoomBy: (factor: number, anchor?: { x: number; y: number }) => void
  resetZoom: () => void
  zoomToFit: (pad?: number) => void
  scrollToContent: () => void

  // tray
  setTray: (patch: Partial<TrayConfig>) => void
  setTrayFace: (f: TrayFace) => void
  setTrayCollapsed: (v: boolean) => void
  setTrayGauge: (v: boolean) => void

  setDialog: (d: DrawDialog) => void
  importImage: (file: Blob) => Promise<void>
  hydrate: () => Promise<void>
}

/** The size of the canvas element, kept here so view maths can reach it. */
let surface = { w: 1200, h: 800 }
export const setSurfaceSize = (w: number, h: number) => {
  surface = { w, h }
}
export const getSurfaceSize = () => surface

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/** Changes that do not move a single point, so the cached wobble still stands. */
const PAINT_ONLY = new Set(['stroke', 'opacity', 'textAlign'])

function bumpNeeded(patch: object): boolean {
  return Object.keys(patch).some((k) => !PAINT_ONLY.has(k))
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function persist(doc: DrawDoc) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveJSON(DOC_KEY, doc), 400)
}

export const useDraw = create<DrawState>()(
  immer((set, get) => ({
    hydrated: false,
    doc: defaultDrawDoc(),
    past: [],
    future: [],

    tool: 'select',
    toolLocked: false,
    pen: 'pen',
    style: { ...DEFAULT_STYLE },
    penInk: {
      pencil: '#1e1e1e',
      pen: '#1e1e1e',
      fineliner: '#1e1e1e',
      marker: '#e03131',
      // its own colour by default, because a black highlighter is a redaction
      highlighter: '#ffec99',
      brush: '#1e1e1e',
      fountain: '#1971c2',
    },
    penSize: Object.fromEntries(Object.entries(PENS).map(([id, p]) => [id, p.size])) as Record<PenId, number>,
    inkMode: 'auto',
    eraserSize: 24,
    eraserMode: 'area',
    lastSheet: '#ffffff',

    viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
    selectedIds: [],
    editingTextId: null,
    images: {},
    tray: {
      placement: 'bottom',
      align: 'center',
      inset: 20,
      look: 'studio',
      depth: 'regular',
      draggable: true,
      offset: null,
    },
    trayFace: 'tools',
    trayCollapsed: false,
    trayGauge: false,
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
        const alive = new Set(prev.elements.map((e) => e.id))
        s.selectedIds = s.selectedIds.filter((id) => alive.has(id))
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
        const alive = new Set(next.elements.map((e) => e.id))
        s.selectedIds = s.selectedIds.filter((id) => alive.has(id))
      })
      persist(get().doc)
    },

    addElement: (el, label) => {
      get().commit(label)
      set((s) => {
        s.doc.elements.push(el)
      })
      persist(get().doc)
    },

    updateElements: (ids, patch, label) => {
      if (ids.length === 0) return
      get().commit(label)
      const bump = bumpNeeded(patch)
      set((s) => {
        const wanted = new Set(ids)
        for (const el of s.doc.elements) {
          if (!wanted.has(el.id) || el.locked) continue
          Object.assign(el, patch)
          if (bump) el.version++
        }
      })
      persist(get().doc)
    },

    touch: () => persist(get().doc),

    removeElements: (ids) => {
      if (ids.length === 0) return
      get().commit()
      set((s) => {
        const gone = new Set(ids)
        s.doc.elements = s.doc.elements.filter((e) => !gone.has(e.id) || e.locked)
        s.selectedIds = s.selectedIds.filter((id) => !gone.has(id))
      })
      persist(get().doc)
    },

    duplicateSelection: () => {
      const { selectedIds, doc } = get()
      if (selectedIds.length === 0) return
      get().commit()
      const wanted = new Set(selectedIds)
      const copies = copiesOf(doc.elements.filter((e) => wanted.has(e.id)), 12, 12)
      set((s) => {
        s.doc.elements.push(...copies)
        s.selectedIds = copies.map((c) => c.id)
      })
      persist(get().doc)
    },

    /*
     * Elements arriving from the clipboard, which may be this board's own or
     * another tab's.
     *
     * They land centred on `at` when the pointer is over the canvas, so a paste
     * appears where you are looking rather than wherever the copy happened to
     * be sitting when you scrolled away from it. Copies are remade here rather
     * than trusted, since the payload is JSON someone could have edited.
     */
    pasteElements: (els, at) => {
      /*
       * The payload is JSON off the system clipboard, so it may be from an
       * older build or edited by hand. Anything missing the numbers the
       * renderer measures with is dropped rather than drawn, and so is an image
       * whose bitmap did not come with it, which would otherwise paste as an
       * invisible box you can select but never see.
       */
      const usable = els.filter(
        (e) =>
          !!e &&
          typeof e.kind === 'string' &&
          [e.x, e.y, e.w, e.h, e.angle, e.version].every((n) => Number.isFinite(n)) &&
          (e.kind !== 'image' || !!get().images[e.assetId]),
      )
      if (usable.length === 0) return
      get().commit()
      const box = unionBounds(usable)
      const dx = at && box ? at.x - (box.x + box.w / 2) : 12
      const dy = at && box ? at.y - (box.y + box.h / 2) : 12
      const copies = copiesOf(usable, dx, dy)
      set((s) => {
        s.doc.elements.push(...copies)
        s.selectedIds = copies.map((c) => c.id)
      })
      persist(get().doc)
    },

    reorder: (dir) => {
      const { selectedIds } = get()
      if (selectedIds.length === 0) return
      get().commit()
      set((s) => {
        const wanted = new Set(selectedIds)
        const picked = s.doc.elements.filter((e) => wanted.has(e.id))
        const rest = s.doc.elements.filter((e) => !wanted.has(e.id))
        if (dir === 'front') s.doc.elements = [...rest, ...picked]
        else if (dir === 'back') s.doc.elements = [...picked, ...rest]
        else {
          // one place at a time, walking in the direction of travel so a
          // multi-selection keeps its internal order
          const list = s.doc.elements
          const idx = list.map((e, i) => [e, i] as const).filter(([e]) => wanted.has(e.id)).map(([, i]) => i)
          const order = dir === 'forward' ? idx.reverse() : idx
          for (const i of order) {
            const j = dir === 'forward' ? i + 1 : i - 1
            if (j < 0 || j >= list.length || wanted.has(list[j].id)) continue
            ;[list[i], list[j]] = [list[j], list[i]]
          }
        }
      })
      persist(get().doc)
    },

    clear: () => {
      get().commit()
      set((s) => {
        s.doc.elements = []
        s.selectedIds = []
      })
      persist(get().doc)
      ui.toast('Canvas cleared', 'info')
    },

    setTool: (t) => {
      set((s) => {
        s.tool = t
        if (t !== 'select') s.selectedIds = []
        s.editingTextId = null
        // reaching for a pen or the eraser is also reaching for the tray
        if (s.trayCollapsed && (t === 'freedraw' || t === 'eraser')) s.trayCollapsed = false
      })
    },
    setToolLocked: (v) => set((s) => void (s.toolLocked = v)),

    setPen: (p) => {
      set((s) => {
        s.pen = p
        s.tool = 'freedraw'
        s.selectedIds = []
        s.editingTextId = null
        // picking up a pen picks up its ink, unless ink is being shared
        if (s.inkMode !== 'shared') s.style.stroke = s.penInk[p]
      })
    },

    setPenSize: (size) => {
      const { pen, tool } = get()
      if (tool === 'eraser') {
        get().setEraserSize(size)
        return
      }
      const spec = PENS[pen]
      set((s) => {
        s.penSize[pen] = Math.min(spec.range[1], Math.max(spec.range[0], size))
      })
    },

    /**
     * Set the colour in hand.
     *
     * `ink` decides how far that reaches. "shared" is one colour for
     * everything; "per-tool" gives every pen its own; "auto" is the useful
     * middle, sharing across the pens but leaving the highlighter alone,
     * because nobody who picks red for the pen means for the highlighter to
     * turn red too.
     */
    setInk: (color) => {
      set((s) => {
        s.style.stroke = color
        const mode = s.inkMode
        if (mode === 'shared') {
          for (const id of Object.keys(s.penInk) as PenId[]) s.penInk[id] = color
        } else if (mode === 'per-tool') {
          s.penInk[s.pen] = color
        } else {
          if (s.pen === 'highlighter') s.penInk.highlighter = color
          else for (const id of Object.keys(s.penInk) as PenId[]) if (id !== 'highlighter') s.penInk[id] = color
        }
      })
      const { selectedIds } = get()
      if (selectedIds.length) get().updateElements(selectedIds, { stroke: color }, 'draw-stroke')
    },

    setStyle: (patch, label) => {
      set((s) => {
        Object.assign(s.style, patch)
      })
      const { selectedIds } = get()
      if (selectedIds.length) get().updateElements(selectedIds, patch, label)
    },

    setEraserSize: (v) => set((s) => void (s.eraserSize = Math.min(120, Math.max(6, v)))),
    setEraserMode: (m) => set((s) => void (s.eraserMode = m)),
    setInkMode: (m) => set((s) => void (s.inkMode = m)),

    setBackground: (bg) => {
      get().commit('draw-bg')
      set((s) => {
        s.doc.background = bg
        if (bg !== 'transparent' && bg !== 'checker') s.lastSheet = bg
      })
      persist(get().doc)
    },
    setGrid: (v) => {
      set((s) => void (s.doc.grid = v))
      persist(get().doc)
    },

    /**
     * Place a text element and put the caret in it.
     *
     * This exists as one action because the ordering is a trap. `setTool`
     * clears `editingTextId` (reaching for another tool should obviously
     * abandon a half-typed label), so dropping back to the select tool *after*
     * starting the edit closed the editor in the same tick it opened, and text
     * simply could not be typed. Settling the tool first, then placing the
     * caret, is the only order that works, and burying it here means no call
     * site can get it wrong again.
     */
    placeText: (x, y) => {
      if (!get().toolLocked) get().setTool('select')
      const el = newText(x, y)
      get().addElement(el)
      set((s) => {
        s.selectedIds = [el.id]
        s.editingTextId = el.id
      })
      return el.id
    },

    /** Put the caret into an existing text element. */
    editText: (id) =>
      set((s) => {
        s.tool = 'select'
        s.selectedIds = [id]
        s.editingTextId = id
      }),

    /**
     * End a text edit. Lives here rather than in the canvas because Escape can
     * arrive from the global key handler as well as from the textarea, and both
     * routes have to agree about what an abandoned label is worth: nothing.
     */
    endTextEdit: () => {
      const id = get().editingTextId
      if (!id) return
      const el = get().doc.elements.find((e) => e.id === id)
      set((s) => void (s.editingTextId = null))
      if (el && el.kind === 'text' && !el.text.trim()) get().removeElements([id])
    },

    /**
     * Point the neutral inks at whatever is now behind the drawing.
     *
     * Runs when the paper changes and when the app theme flips (which matters
     * for transparent and checkered paper, where what shows through is the
     * app). Anything that is not a neutral is left alone: a colour you chose is
     * a decision, not a default.
     */
    syncInkToPaper: (appDark) => {
      const want = neutralInk(get().doc.background, appDark)
      set((s) => {
        if (isNeutralInk(s.style.stroke)) s.style.stroke = want
        for (const id of Object.keys(s.penInk) as PenId[]) {
          // the highlighter is never neutral and never should be
          if (id !== 'highlighter' && isNeutralInk(s.penInk[id])) s.penInk[id] = want
        }
      })
    },

    select: (ids) => set((s) => void (s.selectedIds = ids)),
    selectAll: () =>
      set((s) => {
        s.tool = 'select'
        s.selectedIds = s.doc.elements.filter((e) => !e.locked).map((e) => e.id)
      }),
    setEditingText: (id) => set((s) => void (s.editingTextId = id)),

    setViewport: (v) =>
      set((s) => {
        Object.assign(s.viewport, v)
        s.viewport.zoom = clampZoom(s.viewport.zoom)
      }),

    /**
     * Zoom about a point, which by default is the middle of the canvas.
     *
     * The anchor has to stay under the same scene coordinate across the change,
     * otherwise a wheel zoom walks the drawing off screen; solving for the new
     * scroll is the whole of it.
     */
    zoomBy: (factor, anchor) => {
      set((s) => {
        const vp = s.viewport
        const next = clampZoom(vp.zoom * factor)
        const ax = anchor?.x ?? surface.w / 2
        const ay = anchor?.y ?? surface.h / 2
        const sceneX = ax / vp.zoom - vp.scrollX
        const sceneY = ay / vp.zoom - vp.scrollY
        vp.zoom = next
        vp.scrollX = ax / next - sceneX
        vp.scrollY = ay / next - sceneY
      })
    },

    resetZoom: () => {
      set((s) => {
        const vp = s.viewport
        const cx = surface.w / 2 / vp.zoom - vp.scrollX
        const cy = surface.h / 2 / vp.zoom - vp.scrollY
        vp.zoom = 1
        vp.scrollX = surface.w / 2 - cx
        vp.scrollY = surface.h / 2 - cy
      })
    },

    zoomToFit: (pad = 64) => {
      const box = unionBounds(get().doc.elements)
      if (!box) {
        get().resetZoom()
        return
      }
      const zoom = clampZoom(
        Math.min((surface.w - pad * 2) / Math.max(box.w, 1), (surface.h - pad * 2) / Math.max(box.h, 1), 1),
      )
      set((s) => {
        s.viewport.zoom = zoom
        s.viewport.scrollX = surface.w / 2 / zoom - (box.x + box.w / 2)
        s.viewport.scrollY = surface.h / 2 / zoom - (box.y + box.h / 2)
      })
    },

    /** Keep the zoom, just bring the drawing back under the window. */
    scrollToContent: () => {
      const box = unionBounds(get().doc.elements)
      if (!box) return
      set((s) => {
        const z = s.viewport.zoom
        s.viewport.scrollX = surface.w / 2 / z - (box.x + box.w / 2)
        s.viewport.scrollY = surface.h / 2 / z - (box.y + box.h / 2)
      })
    },

    setTray: (patch) =>
      set((s) => {
        Object.assign(s.tray, patch)
        localStorage.setItem('draw-tray', JSON.stringify(s.tray))
      }),
    setTrayFace: (f) => set((s) => void (s.trayFace = f)),
    setTrayCollapsed: (v) => set((s) => void (s.trayCollapsed = v)),
    setTrayGauge: (v) => set((s) => void (s.trayGauge = v)),
    setDialog: (d) => set((s) => void (s.dialog = d)),

    importImage: async (file) => {
      try {
        const bmp = await createImageBitmap(file)
        const id = uid()
        await saveAsset(id, file)
        const url = URL.createObjectURL(file)
        const vp = get().viewport
        // dropped at a readable size, centred on what you are looking at
        const max = 420
        const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
        const w = bmp.width * scale
        const h = bmp.height * scale
        set((s) => void (s.images[id] = url))
        get().addElement({
          ...get().style,
          kind: 'image',
          id: uid(),
          seed: seed(),
          assetId: id,
          ratio: bmp.width / bmp.height,
          x: surface.w / 2 / vp.zoom - vp.scrollX - w / 2,
          y: surface.h / 2 / vp.zoom - vp.scrollY - h / 2,
          w,
          h,
          angle: 0,
          version: 1,
        })
        bmp.close()
      } catch {
        ui.toast('That image could not be read', 'error')
      }
    },

    hydrate: async () => {
      try {
        const saved = localStorage.getItem('draw-tray')
        if (saved) {
          const cfg = JSON.parse(saved) as TrayConfig
          // 'right' was a placement before the tool rail claimed that edge; a
          // setting saved back then would otherwise sit the tray under the rail
          if ((cfg.placement as string) === 'right') cfg.placement = 'bottom'
          set((s) => void Object.assign(s.tray, cfg))
        }
      } catch {
        /* a corrupt tray preference is not worth failing a load over */
      }
      try {
        const doc = await loadJSON<DrawDoc>(DOC_KEY)
        if (doc && doc.version === 1) {
          // the grid used to be a boolean, before it grew a dotted style
          const legacy = doc.grid as unknown
          if (typeof legacy === 'boolean') doc.grid = legacy ? 'lines' : 'off'
          const images: Record<string, string> = {}
          for (const el of doc.elements) {
            if (el.kind !== 'image') continue
            const blob = await loadAsset(el.assetId)
            if (blob) images[el.assetId] = URL.createObjectURL(blob)
          }
          set((s) => {
            s.doc = doc
            s.images = images
          })
        }
      } catch {
        /* start on a blank sheet rather than refusing to open */
      }
      set((s) => void (s.hydrated = true))
    },
  })),
)

/*
 * ----- Element factories -----
 * Kept beside the store because every one of them needs the current style, and
 * a new element that does not inherit what the panel is showing is the fastest
 * way to make a properties panel feel broken.
 */

export function newShape(kind: 'rect' | 'diamond' | 'ellipse', x: number, y: number): DrawElement {
  return { ...useDraw.getState().style, kind, id: uid(), seed: seed(), x, y, w: 0, h: 0, angle: 0, version: 1 }
}

export function newLinear(kind: 'arrow' | 'line', x: number, y: number): DrawElement {
  return {
    ...useDraw.getState().style,
    kind,
    id: uid(),
    seed: seed(),
    x,
    y,
    w: 0,
    h: 0,
    angle: 0,
    version: 1,
    points: [
      [0, 0],
      [0, 0],
    ],
  }
}

export function newStroke(kind: 'freedraw' | 'erase', x: number, y: number, pressure: number, t: number): DrawElement {
  const s = useDraw.getState()
  const base = {
    ...s.style,
    id: uid(),
    seed: seed(),
    x,
    y,
    w: 0,
    h: 0,
    angle: 0,
    version: 1,
    points: [[0, 0, pressure, t]] as [number, number, number, number][],
  }
  if (kind === 'erase') return { ...base, kind: 'erase', size: s.eraserSize, opacity: 1 }
  return { ...base, kind: 'freedraw', pen: s.pen, size: s.penSize[s.pen], stroke: s.style.stroke }
}

export function newText(x: number, y: number): DrawElement {
  const s = useDraw.getState()
  return {
    ...s.style,
    kind: 'text',
    id: uid(),
    seed: seed(),
    x,
    y,
    w: s.style.fontSize,
    h: s.style.fontSize * 1.25,
    angle: 0,
    version: 1,
    text: '',
  }
}

/**
 * Re-fit a stroke's box around its samples, keeping the mark where it was drawn.
 *
 * Every point moves by -b and the origin moves by +b, so the stroke does not
 * actually go anywhere: it just stops being described relative to wherever the
 * pointer happened to go down.
 *
 * The version bump is not optional. Geometry is memoised on id and version, and
 * the last frame of the drag already cached an outline built from the *old*
 * points. Re-origin without invalidating it and that stale outline gets painted
 * against the new origin, so the finished stroke lands half a nib width up and
 * to the left of the one you just drew: a small jump at the exact moment you
 * lift the pen, on every tool, which is precisely how this showed up.
 */
export function refitStroke(el: DrawElement) {
  if (!isStroke(el)) return
  const b = strokeBounds(el.points, el.size)
  const dx = b.x
  const dy = b.y
  if (dx || dy) {
    for (const p of el.points) {
      p[0] -= dx
      p[1] -= dy
    }
    el.x += dx
    el.y += dy
  }
  el.w = b.w
  el.h = b.h
  dropGeometry(el)
  el.version++
}

/** Re-fit a line or arrow's box around its points. */
export function refitLinear(el: DrawElement) {
  if (!isLinear(el)) return
  const xs = el.points.map((p) => p[0])
  const ys = el.points.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  if (minX || minY) {
    for (const p of el.points) {
      p[0] -= minX
      p[1] -= minY
    }
    el.x += minX
    el.y += minY
  }
  el.w = Math.max(...xs) - minX
  el.h = Math.max(...ys) - minY
  // same re-origin, same stale-cache trap
  dropGeometry(el)
  el.version++
}

/** Re-measure a text element after an edit. */
export function refitText(el: DrawElement, ctx: CanvasRenderingContext2D) {
  if (el.kind !== 'text') return
  const m = measureText(ctx, el.text || ' ', el.fontSize, el.fontFamily)
  el.w = m.w
  el.h = m.h
}

/** A normalised box from two corners, for the drag-out shapes. */
export function boxFrom(x1: number, y1: number, x2: number, y2: number): Box {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

/** Is anything on the board currently off screen? Drives "Scroll back to content". */
export function contentOffScreen(elements: DrawElement[], vp: Viewport): boolean {
  if (elements.length === 0) return false
  const { w, h } = surface
  for (const el of elements) {
    const b = sceneBounds(el)
    const x = (b.x + vp.scrollX) * vp.zoom
    const y = (b.y + vp.scrollY) * vp.zoom
    if (x + b.w * vp.zoom > 0 && y + b.h * vp.zoom > 0 && x < w && y < h) return false
  }
  return true
}

export { uid, seed }
export type { ElementKind, DrawTool }
