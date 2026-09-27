/**
 * Flow's state: the graph, its history, and what is selected.
 *
 * Its own undo stack rather than Studio's, because the two are edited in
 * different places and an undo in Flow that reached back and changed a Studio
 * slider would be undoing something that is not on screen. The toolbar's undo
 * and redo follow whichever workspace is showing.
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { FxId } from '../../lib/postfx'
import { loadAsset, loadJSON, saveAsset, saveJSON } from '../../lib/db'
import { coalesces, endEditRun } from '../../lib/history'
import { ui } from '../../lib/ui'
import { getFilter } from '../filters'
import { defaults } from '../params'
import { NAMED_FX } from '../postfx'
import { useAscii } from '../store'
import { defaultAsciiDoc, type AsciiDoc, type AsciiLayer } from '../types'
import { wouldCycle } from './evaluate'
import type { FlowDoc, FlowEdge, FlowNode, NodeKind, PortId, StyleLook } from './types'

const KEY = 'ascii-flow'
const uid = () => crypto.randomUUID().slice(0, 8)
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function lookFromDoc(doc: AsciiDoc): StyleLook {
  return clone({
    style: doc.style,
    ramp: doc.ramp,
    customRamp: doc.customRamp,
    grid: doc.grid,
    tone: doc.tone,
    color: doc.color,
    dither: doc.dither,
    backdrop: doc.backdrop,
    fx: doc.fx,
    finish: doc.finish,
    styleParams: doc.styleParams,
  })
}

const COLOR_DEFAULTS: Partial<Record<FxId, { color?: string; color2?: string; x?: number; y?: number }>> = {
  colorOverlay: { color: '#5e6ad2' },
  fog: { color: '#c9d4e0' },
  lightLeak: { color: '#ff7a3d', color2: '#ff3da8', x: 0.15, y: 0.2 },
  gridLines: { color: '#ffffff' },
  matrixRain: { color: '#4dff88' },
  godRays: { x: 0.5, y: 0.2 },
}

/** A fresh node of a kind, with its data filled in. `what` names the filter, style or effect. */
export function makeNode(kind: NodeKind, x: number, y: number, what?: string): FlowNode {
  const id = uid()
  switch (kind) {
    case 'image':
      return { id, x, y, kind, image: { source: 'studio' } }
    case 'filter': {
      const spec = getFilter(what ?? 'twirl') ?? getFilter('twirl')!
      return { id, x, y, kind, filter: { kind: spec.id, params: defaults(spec.params) } }
    }
    case 'style': {
      const base = defaultAsciiDoc()
      const look = lookFromDoc(base)
      if (what) look.style = what as AsciiDoc['style']
      look.backdrop = { ...look.backdrop, mode: 'paper', color: '#0b0c0d' }
      return { id, x, y, kind, look }
    }
    case 'finish': {
      const fx = (what ?? 'bloom') as FxId
      return { id, x, y, kind, finish: { fx, settings: { amount: 0.6, ...COLOR_DEFAULTS[fx] } } }
    }
    case 'mix':
      return { id, x, y, kind, mix: { mode: 'screen', amount: 1, mask: 'none' } }
    default:
      return { id, x, y, kind: 'output' }
  }
}

/** The graph for a Studio document: its picture, its layers in order, its look, out. */
export function flowFromDoc(doc: AsciiDoc): FlowDoc {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  let x = 40
  const y = 140
  const step = 236
  const push = (n: FlowNode) => {
    const prev = nodes[nodes.length - 1]
    nodes.push(n)
    if (prev) edges.push({ id: uid(), from: prev.id, to: n.id, port: 'in' })
    x += step
  }
  push(makeNode('image', x, y))
  for (const l of doc.layers.filter((q) => q.on)) {
    const n = makeNode('filter', x, y, l.kind)
    if (n.kind === 'filter') n.filter.params = clone(l.params)
    push(n)
  }
  const style = makeNode('style', x, y)
  if (style.kind === 'style') style.look = lookFromDoc(doc)
  push(style)
  push(makeNode('output', x, y))
  return { version: 1, nodes, edges, view: { x: 0, y: 0, zoom: 0.9 } }
}

/**
 * The Studio document a straight graph describes, or the reason there is none.
 *
 * Studio holds exactly one pipeline: filters, one style, then effects. A graph
 * that is that shape translates; one with a Mix, two styles or a second
 * picture does not, and saying which part is in the way beats a button that
 * quietly does something else.
 */
export function studioFromFlow(flow: FlowDoc): { layers: AsciiLayer[]; look: StyleLook | null; extra: AsciiDoc['finish'] } | string {
  const out = flow.nodes.find((n) => n.kind === 'output')
  if (!out) return 'Add an Output node first.'
  const into = new Map(flow.edges.map((e) => [`${e.to}:${e.port}`, e.from]))
  const byId = new Map(flow.nodes.map((n) => [n.id, n]))
  const chain: FlowNode[] = []
  let cur = into.get(`${out.id}:in`)
  while (cur) {
    const n = byId.get(cur)
    if (!n) break
    if (n.kind === 'mix') return 'Studio holds one straight chain, and this graph mixes two.'
    chain.unshift(n)
    if (n.kind === 'image') break
    cur = into.get(`${n.id}:in`)
  }
  if (chain[0]?.kind !== 'image') return 'The chain into Output does not start from an Image.'
  const styles = chain.filter((n) => n.kind === 'style')
  if (styles.length > 1) return 'Studio has one style, and this chain has several.'
  const layers: AsciiLayer[] = []
  const extra: AsciiDoc['finish'] = {}
  let seenStyle = false
  for (const n of chain) {
    if (n.bypass) continue
    if (n.kind === 'style') seenStyle = true
    else if (n.kind === 'filter') {
      if (seenStyle) return 'A filter after the style has no place in Studio. Move it before the style.'
      layers.push({ uid: crypto.randomUUID(), kind: n.filter.kind, on: true, params: clone(n.filter.params) })
    } else if (n.kind === 'finish') {
      extra[n.finish.fx] = clone(n.finish.settings)
    }
  }
  const style = styles[0]
  return { layers, look: style && style.kind === 'style' ? clone(style.look) : null, extra }
}

interface FlowState {
  hydrated: boolean
  flow: FlowDoc
  past: FlowDoc[]
  future: FlowDoc[]
  selected: string | null
  /** bumps whenever `flowAssets` gains a picture, so anything drawing from it redraws */
  assetsRev: number

  commit: (label?: string) => void
  undo: () => void
  redo: () => void
  patch: (fn: (f: FlowDoc) => void, label?: string) => void
  select: (id: string | null) => void
  addNode: (kind: NodeKind, x: number, y: number, what?: string) => string
  removeNode: (id: string) => void
  duplicateNode: (id: string) => void
  moveNode: (id: string, x: number, y: number) => void
  connect: (from: string, to: string, port: PortId) => void
  disconnect: (edgeId: string) => void
  setView: (v: FlowDoc['view']) => void
  fromStudio: () => void
  toStudio: () => void
  loadImage: (nodeId: string, file: Blob, name?: string) => Promise<void>
  hydrate: () => Promise<void>
}

/**
 * Pictures that Image nodes brought with them, by asset id. Outside the store
 * because a decoded bitmap has no business in an immer draft or an undo stack.
 */
export const flowAssets = new Map<string, ImageBitmap>()

let saveTimer: ReturnType<typeof setTimeout> | undefined
function persist(flow: FlowDoc) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveJSON(KEY, flow), 400)
}

export const useFlow = create<FlowState>()(
  immer((set, get) => ({
    hydrated: false,
    flow: { version: 1, nodes: [], edges: [], view: { x: 0, y: 0, zoom: 0.9 } },
    past: [],
    future: [],
    selected: null,
    assetsRev: 0,

    commit: (label) => {
      if (coalesces(label)) return
      set((s) => {
        s.past.push(clone(s.flow))
        if (s.past.length > 100) s.past.shift()
        s.future = []
      })
    },
    undo: () => {
      endEditRun()
      set((s) => {
        const prev = s.past.pop()
        if (!prev) return
        s.future.push(clone(s.flow))
        s.flow = prev
      })
      persist(get().flow)
    },
    redo: () => {
      endEditRun()
      set((s) => {
        const next = s.future.pop()
        if (!next) return
        s.past.push(clone(s.flow))
        s.flow = next
      })
      persist(get().flow)
    },
    patch: (fn, label) => {
      get().commit(label)
      set((s) => fn(s.flow))
      persist(get().flow)
    },
    select: (id) => set((s) => void (s.selected = id)),

    addNode: (kind, x, y, what) => {
      const node = makeNode(kind, x, y, what)
      get().patch((f) => void f.nodes.push(node))
      set((s) => void (s.selected = node.id))
      return node.id
    },
    removeNode: (id) => {
      get().patch((f) => {
        f.nodes = f.nodes.filter((n) => n.id !== id)
        f.edges = f.edges.filter((e) => e.from !== id && e.to !== id)
      })
      if (get().selected === id) set((s) => void (s.selected = null))
    },
    duplicateNode: (id) => {
      const n = get().flow.nodes.find((q) => q.id === id)
      if (!n) return
      const copy = { ...clone(n), id: uid(), x: n.x + 28, y: n.y + 28 }
      get().patch((f) => void f.nodes.push(copy))
      set((s) => void (s.selected = copy.id))
    },
    moveNode: (id, x, y) =>
      get().patch((f) => {
        const n = f.nodes.find((q) => q.id === id)
        if (n) {
          n.x = x
          n.y = y
        }
      }, `flow-move-${id}`),
    connect: (from, to, port) => {
      const f = get().flow
      if (wouldCycle(f, from, to)) {
        ui.toast('That wire would loop back on itself')
        return
      }
      get().patch((fl) => {
        // one wire per input: a new one replaces whatever was plugged in
        fl.edges = fl.edges.filter((e) => !(e.to === to && e.port === port))
        fl.edges.push({ id: uid(), from, to, port })
      })
    },
    disconnect: (edgeId) => get().patch((f) => void (f.edges = f.edges.filter((e) => e.id !== edgeId))),
    setView: (v) => {
      set((s) => void (s.flow.view = v))
      persist(get().flow)
    },

    fromStudio: () => {
      const doc = useAscii.getState().doc
      get().patch(() => {})
      set((s) => {
        s.flow = flowFromDoc(doc)
        s.selected = null
      })
      persist(get().flow)
    },

    toStudio: () => {
      const r = studioFromFlow(get().flow)
      if (typeof r === 'string') {
        ui.error(r)
        return
      }
      useAscii.getState().patch((d) => {
        d.layers = r.layers
        if (r.look) {
          const look = clone(r.look)
          d.style = look.style
          d.ramp = look.ramp
          d.customRamp = look.customRamp
          d.grid = look.grid
          d.tone = look.tone
          d.color = { ...d.color, ...look.color }
          d.dither = look.dither
          d.backdrop = look.backdrop
          d.fx = look.fx
          d.finish = look.finish ?? {}
          d.styleParams = look.styleParams ?? {}
        }
        for (const [k, v] of Object.entries(r.extra)) {
          if ((NAMED_FX as string[]).includes(k)) d.fx[k as (typeof NAMED_FX)[number]] = v?.amount ?? 0
          else d.finish[k as FxId] = v
        }
      })
      useAscii.getState().setWorkspace('studio')
      ui.toast('Sent to Studio')
    },

    loadImage: async (nodeId, file, name) => {
      try {
        const bmp = await createImageBitmap(file)
        const id = crypto.randomUUID()
        await saveAsset(id, file)
        flowAssets.set(id, bmp)
        set((s) => void (s.assetsRev += 1))
        get().patch((f) => {
          const n = f.nodes.find((q) => q.id === nodeId)
          if (n && n.kind === 'image') n.image = { source: id, name }
        })
      } catch {
        ui.error('That image could not be read')
      }
    },

    hydrate: async () => {
      if (get().hydrated) return
      try {
        const saved = await loadJSON<FlowDoc>(KEY)
        if (saved && saved.version === 1 && Array.isArray(saved.nodes)) {
          for (const n of saved.nodes) {
            if (n.kind === 'image' && n.image.source !== 'studio' && !flowAssets.has(n.image.source)) {
              const blob = await loadAsset(n.image.source)
              if (blob) flowAssets.set(n.image.source, await createImageBitmap(blob))
              else n.image = { source: 'studio' }
            }
          }
          set((s) => {
            s.flow = saved
            s.assetsRev += 1
          })
        } else {
          set((s) => void (s.flow = flowFromDoc(useAscii.getState().doc)))
        }
      } catch {
        set((s) => void (s.flow = flowFromDoc(useAscii.getState().doc)))
      }
      set((s) => void (s.hydrated = true))
    },
  })),
)
