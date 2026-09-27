/**
 * Flow, assembled: the node palette on the left, the graph in the middle, and
 * on the right the result above the settings of whichever node is selected.
 *
 * The right column starts below the toolbar's pocket, which is cut into this
 * frame's top-right corner; the graph runs underneath it, since a graph is
 * mostly empty space and loses nothing to a notch in one corner.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAscii } from '../store'
import { ASCII_NOTCH } from '../notch'
import { envFor } from './env'
import { evaluate, outputNode } from './evaluate'
import { FlowGraph } from './FlowGraph'
import { FlowInspector } from './FlowInspector'
import { FlowPalette } from './FlowPalette'
import { useFlow } from './store'
import { NODE_W } from './types'

export interface FlowRender {
  /** node thumbnails, by node id */
  thumbs: Map<string, HTMLCanvasElement>
  /** the output at preview size */
  result: HTMLCanvasElement | null
  /** bumps whenever either changes */
  tick: number
}

const dpr = () => Math.min(2, window.devicePixelRatio || 1)

/**
 * Draw the graph whenever it, or anything it reads, changes.
 *
 * Scheduled on a frame and after a short pause, so dragging a slider on a node
 * renders at the pace the machine can manage rather than once per pointer
 * event. The cache in `evaluate` means a change only costs the nodes
 * downstream of it.
 */
function useFlowRender(previewW: number): FlowRender {
  const flow = useFlow((s) => s.flow)
  const rev = useFlow((s) => s.assetsRev)
  const bitmap = useAscii((s) => s.bitmap)
  const size = useAscii((s) => s.doc.size)
  const [state, setState] = useState<FlowRender>({ thumbs: new Map(), result: null, tick: 0 })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      requestAnimationFrame(() => {
        const thumbW = (NODE_W - 12) * dpr()
        const thumbs = evaluate(flow, envFor(thumbW, 'preview'))
        const out = outputNode(flow)
        let result: HTMLCanvasElement | null = null
        if (out && previewW > 0) {
          result = evaluate(flow, envFor(previewW * dpr(), 'preview'), [out.id]).get(out.id) ?? null
        }
        setState((s) => ({ thumbs, result, tick: s.tick + 1 }))
      })
    }, 30)
    return () => clearTimeout(timer.current)
  }, [flow, rev, bitmap, size, previewW])

  return state
}

export function FlowEditor() {
  const hydrated = useFlow((s) => s.hydrated)
  const hasImage = useAscii((s) => s.bitmap !== null)
  const side = useRef<HTMLDivElement>(null)
  const [sideW, setSideW] = useState(0)

  useEffect(() => {
    void useFlow.getState().hydrate()
  }, [])

  useLayoutEffect(() => {
    const el = side.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSideW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const render = useFlowRender(Math.max(0, sideW - 24))

  // Delete and duplicate, for the selected node, while Flow is on screen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const f = useFlow.getState()
      if (!f.selected) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        f.removeNode(f.selected)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        f.duplicateNode(f.selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full w-full bg-(--panel)">
      <FlowPalette />
      <div className="relative min-w-0 flex-1">
        {hydrated && <FlowGraph render={render} />}
        {!hasImage && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <p className="rounded-md bg-(--raised) px-3 py-1.5 t-caption text-(--tx2) shadow-lg">
              Image nodes follow Studio's picture. Add one there, or give a node its own.
            </p>
          </div>
        )}
      </div>
      <div
        ref={side}
        style={{ paddingTop: ASCII_NOTCH.depth + 8 }}
        className="flex w-[300px] shrink-0 flex-col border-l border-(--line)"
      >
        <FlowInspector render={render} />
      </div>
    </div>
  )
}
