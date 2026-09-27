/**
 * Running a graph.
 *
 * Every node is a function from its inputs to one picture at the size being
 * drawn, and every node is the Studio engine: a Filter node is `runLayers` with
 * one layer, a Style node is `renderAscii`, a Finish node is the shared post
 * chain with one effect. There is no Flow-only image code to drift.
 *
 * Results are cached by a signature of the node and everything upstream of it,
 * so moving a slider on the last node redraws the last node, and dragging a
 * node around the canvas (which changes nothing but its position) redraws
 * nothing at all. Positions are deliberately not in the signature.
 */

import { applyFx } from '../../lib/postfx'
import { runLayers } from '../layers'
import { copy, ctx2d, cover, canvas as makeCanvas, read } from '../pixels'
import { renderAscii } from '../render'
import { defaultAsciiDoc, defaultReveal, type AsciiDoc } from '../types'
import type { FlowDoc, FlowNode, PortId } from './types'

export interface EvalEnv {
  /** the picture Studio has loaded */
  studio: CanvasImageSource | null
  /** pictures belonging to Image nodes, by asset id */
  assets: Map<string, CanvasImageSource>
  /** the size the settings are written against, which is Studio's document */
  docW: number
  docH: number
  /** the size to draw at */
  w: number
  h: number
  quality: 'preview' | 'export'
}

// ----- identity for pictures, so a signature can name one -----

const ids = new WeakMap<object, number>()
let nextId = 1
function idOf(src: CanvasImageSource | null | undefined): number {
  if (!src) return 0
  let n = ids.get(src as object)
  if (!n) {
    n = nextId++
    ids.set(src as object, n)
  }
  return n
}

const cache = new Map<string, HTMLCanvasElement>()
const KEEP = 80

function remember(sig: string, c: HTMLCanvasElement) {
  cache.delete(sig)
  cache.set(sig, c)
  while (cache.size > KEEP) cache.delete(cache.keys().next().value as string)
}

/** The look a Style node renders with, as a full document. */
export function styleDoc(node: Extract<FlowNode, { kind: 'style' }>, env: Pick<EvalEnv, 'docW' | 'docH'>): AsciiDoc {
  const base = defaultAsciiDoc()
  const look = JSON.parse(JSON.stringify(node.look)) as typeof node.look
  return {
    ...base,
    ...look,
    color: { ...base.color, ...look.color },
    finish: look.finish ?? {},
    styleParams: look.styleParams ?? {},
    size: { width: env.docW, height: env.docH },
    layers: [],
    reveal: defaultReveal(),
    cursor: base.cursor,
    assetId: null,
    presetId: null,
    name: 'Flow',
    version: 1,
  }
}

function blank(w: number, h: number) {
  return makeCanvas(w, h)
}

/** `b` with its alpha cut by a mask, for Mix. */
function masked(b: HTMLCanvasElement, mask: string): HTMLCanvasElement {
  if (mask === 'none') return b
  const out = copy(b)
  const w = out.width
  const h = out.height
  if (mask === 'luma' || mask === 'inverse') {
    const img = read(out)
    const d = img.data
    for (let p = 0; p < d.length; p += 4) {
      const l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255
      d[p + 3] *= mask === 'luma' ? l : 1 - l
    }
    ctx2d(out).putImageData(img, 0, 0)
    return out
  }
  const ctx = ctx2d(out)
  const g =
    mask === 'radial'
      ? ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.hypot(w, h) / 2)
      : mask === 'left'
        ? ctx.createLinearGradient(0, 0, w, 0)
        : ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, 'rgba(0,0,0,1)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalCompositeOperation = 'destination-in'
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  return out
}

/**
 * Evaluate the graph, returning every node's picture that was reached.
 *
 * `want` limits the work to the named nodes and what feeds them; leave it out
 * to evaluate everything, which is what the node thumbnails need.
 */
export function evaluate(flow: FlowDoc, env: EvalEnv, want?: string[]): Map<string, HTMLCanvasElement> {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]))
  const inputOf = new Map<string, string>()
  for (const e of flow.edges) inputOf.set(`${e.to}:${e.port}`, e.from)

  const out = new Map<string, HTMLCanvasElement>()
  const sigs = new Map<string, string>()
  const visiting = new Set<string>()
  const size = `${env.w}x${env.h}:${env.docW}x${env.docH}:${env.quality}`

  const run = (id: string): { c: HTMLCanvasElement; sig: string } | null => {
    const node = byId.get(id)
    if (!node) return null
    const done = out.get(id)
    if (done) return { c: done, sig: sigs.get(id)! }
    if (visiting.has(id)) return null // a cycle: the wire that closes it is ignored
    visiting.add(id)

    const input = (port: PortId) => {
      const from = inputOf.get(`${id}:${port}`)
      return from ? run(from) : null
    }

    let result: { c: HTMLCanvasElement; sig: string }
    const { x: _x, y: _y, ...data } = node
    const own = JSON.stringify(data)

    if (node.kind === 'image') {
      const src = node.image.source === 'studio' ? env.studio : env.assets.get(node.image.source)
      const sig = `img:${idOf(src)}:${size}`
      let c = cache.get(sig)
      if (!c) {
        c = src ? cover(src, env.w, env.h) : blank(env.w, env.h)
        remember(sig, c)
      }
      result = { c, sig }
    } else {
      const ins = node.kind === 'mix' ? [input('a'), input('b')] : [input('in')]
      const main = ins[0]
      if (node.bypass || node.kind === 'output') {
        result = main ?? { c: blank(env.w, env.h), sig: `blank:${size}` }
      } else {
        const sig = `${own}|${ins.map((i) => i?.sig ?? '-').join('|')}|${size}`
        let c = cache.get(sig)
        if (!c) {
          c = compute(node, ins.map((i) => i?.c ?? null), env)
          remember(sig, c)
        }
        result = { c, sig }
      }
    }

    visiting.delete(id)
    out.set(id, result.c)
    sigs.set(id, result.sig)
    return result
  }

  const targets = want ?? flow.nodes.map((n) => n.id)
  for (const id of targets) run(id)
  return out
}

function compute(node: FlowNode, ins: (HTMLCanvasElement | null)[], env: EvalEnv): HTMLCanvasElement {
  const { w, h } = env
  const main = ins[0]
  switch (node.kind) {
    case 'filter': {
      if (!main) return blank(w, h)
      const layer = { uid: node.id, kind: node.filter.kind, on: true, params: node.filter.params }
      return runLayers(main, [layer], w, h, w / Math.max(1, env.docW))
    }
    case 'style': {
      if (!main) return blank(w, h)
      return renderAscii(styleDoc(node, env), main, w, h, { quality: env.quality, noReveal: true }).canvas
    }
    case 'finish': {
      if (!main) return blank(w, h)
      const c = copy(main)
      applyFx(c, { [node.finish.fx]: node.finish.settings }, { scale: w / Math.max(1, env.docW), time: 0 })
      return c
    }
    case 'mix': {
      const [a, b] = ins
      const c = a ? copy(a) : blank(w, h)
      if (!b) return c
      const ctx = ctx2d(c)
      ctx.globalAlpha = node.mix.amount
      ctx.globalCompositeOperation = node.mix.mode
      ctx.drawImage(masked(b, node.mix.mask), 0, 0)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      return c
    }
    default:
      return main ? copy(main) : blank(w, h)
  }
}

/** The node the graph's result comes out of: the first Output, or failing that the last node. */
export function outputNode(flow: FlowDoc): FlowNode | undefined {
  return flow.nodes.find((n) => n.kind === 'output') ?? flow.nodes[flow.nodes.length - 1]
}

/** True when adding `from -> to` would close a loop. */
export function wouldCycle(flow: FlowDoc, from: string, to: string): boolean {
  if (from === to) return true
  const next = new Map<string, string[]>()
  for (const e of flow.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to])
  const seen = new Set<string>()
  const stack = [to]
  while (stack.length) {
    const n = stack.pop()!
    if (n === from) return true
    if (seen.has(n)) continue
    seen.add(n)
    stack.push(...(next.get(n) ?? []))
  }
  return false
}
