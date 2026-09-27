/**
 * The graph canvas.
 *
 * Nodes are cards with a live picture of their own output, so you can read the
 * graph left to right as a strip of pictures rather than as a diagram of names.
 * Wires are drawn in the colour of the node they come from, which is enough to
 * tell the branches apart at a glance without labelling any of them.
 *
 * Gestures, all of them the ones node editors already taught everybody:
 * drag the background to pan, pinch or Ctrl+wheel to zoom, drag a card by its
 * title, drag from a right-hand port to a left-hand one to wire, drag a wire
 * off an input to move or drop it, and click a wire to cut it.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Maximize2, Minus, Plus, Workflow, X } from 'lucide-react'
import { useAscii } from '../store'
import { DRAG_MIME, KIND_COLOR, nodeIcon, nodeTitle } from './meta'
import type { FlowRender } from './FlowEditor'
import { useFlow } from './store'
import { hasOutput, inputsOf, NODE_W, PORT_LABEL, type FlowDoc, type FlowNode, type NodeKind, type PortId } from './types'

const HEADER = 34
const PORT_Y0 = HEADER + 18
const PORT_STEP = 26

function portPos(n: FlowNode, port: PortId | 'out') {
  if (port === 'out') return { x: n.x + NODE_W, y: n.y + PORT_Y0 }
  const i = inputsOf(n.kind).indexOf(port)
  return { x: n.x, y: n.y + PORT_Y0 + Math.max(0, i) * PORT_STEP }
}

function wire(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5)
  return `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

/** Draws a node's picture into its own canvas whenever the render changes. */
function Thumb({ canvas, tick }: { canvas: HTMLCanvasElement | undefined; tick: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !canvas) return
    el.width = canvas.width
    el.height = canvas.height
    el.getContext('2d')!.drawImage(canvas, 0, 0)
  }, [canvas, tick])
  const aspect = useAscii((s) => s.doc.size.height / Math.max(1, s.doc.size.width)) || 0.75
  return (
    <div
      className="flow-thumb overflow-hidden rounded-md"
      style={{ height: Math.min(150, (NODE_W - 12) * aspect) }}
    >
      <canvas ref={ref} className="block h-full w-full object-cover" />
    </div>
  )
}

function NodeCard({
  node,
  selected,
  render,
  connected,
  onHeaderDown,
  onPortDown,
}: {
  node: FlowNode
  selected: boolean
  render: FlowRender
  connected: Set<string>
  onHeaderDown: (e: React.PointerEvent, n: FlowNode) => void
  onPortDown: (e: React.PointerEvent, n: FlowNode, port: PortId | 'out') => void
}) {
  const Icon = nodeIcon(node)
  const color = KIND_COLOR[node.kind]
  const st = useFlow.getState
  return (
    <div
      className={`flow-node group absolute rounded-lg border bg-(--raised) shadow-[0_6px_20px_rgb(0_0_0/0.28)] ${
        selected ? 'border-(--tx2)' : 'border-(--line)'
      } ${node.bypass ? 'opacity-60' : ''}`}
      style={{ left: node.x, top: node.y, width: NODE_W }}
      onPointerDown={(e) => {
        e.stopPropagation()
        st().select(node.id)
      }}
    >
      <div
        onPointerDown={(e) => onHeaderDown(e, node)}
        className="flex cursor-grab items-center gap-1.5 px-2 active:cursor-grabbing"
        style={{ height: HEADER }}
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm"
          style={{ background: `color-mix(in srgb, ${color} 22%, transparent)`, color }}
        >
          <Icon size={12} strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1 truncate t-body-sm font-medium text-(--tx)">{nodeTitle(node)}</span>
        {node.kind !== 'image' && node.kind !== 'output' && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => st().patch((f) => {
              const n = f.nodes.find((q) => q.id === node.id)
              if (n) n.bypass = !n.bypass
            })}
            title={node.bypass ? 'Turn this node back on' : 'Bypass: pass the picture straight through'}
            className="flex h-5 w-5 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
          >
            {node.bypass ? <EyeOff size={12} strokeWidth={1.9} /> : <Eye size={12} strokeWidth={1.9} />}
          </button>
        )}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => st().removeNode(node.id)}
          title="Remove node (Delete)"
          className="flex h-5 w-5 items-center justify-center rounded-xs text-(--tx3) opacity-0 transition-opacity group-hover:opacity-100 hover:bg-(--panel3) hover:text-(--tx)"
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
      <div className="px-1.5 pb-1.5">
        <Thumb canvas={render.thumbs.get(node.id)} tick={render.tick} />
      </div>

      {inputsOf(node.kind).map((p, i) => {
        const on = connected.has(`${node.id}:${p}`)
        return (
          <button
            key={p}
            data-node={node.id}
            data-port={p}
            onPointerDown={(e) => onPortDown(e, node, p)}
            title={on ? `${PORT_LABEL[p]}: drag to move or unplug the wire` : PORT_LABEL[p]}
            className="flow-port absolute flex items-center"
            style={{ left: -7, top: PORT_Y0 + i * PORT_STEP - 7 }}
          >
            <span
              className="h-3.5 w-3.5 rounded-full border-2 bg-(--raised)"
              style={{ borderColor: on ? color : 'var(--tx3)', background: on ? color : undefined }}
            />
            {inputsOf(node.kind).length > 1 && (
              <span className="ml-1.5 rounded-xs bg-(--raised)/90 px-1 t-caption text-(--tx2)">{PORT_LABEL[p]}</span>
            )}
          </button>
        )
      })}
      {hasOutput(node.kind) && (
        <button
          data-node={node.id}
          data-port="out"
          onPointerDown={(e) => onPortDown(e, node, 'out')}
          title="Drag to wire this into another node"
          className="flow-port absolute"
          style={{ right: -7, top: PORT_Y0 - 7 }}
        >
          <span className="block h-3.5 w-3.5 rounded-full border-2 border-(--raised)" style={{ background: color }} />
        </button>
      )}
    </div>
  )
}

export function FlowGraph({ render }: { render: FlowRender }) {
  const flow = useFlow((s) => s.flow)
  const selected = useFlow((s) => s.selected)
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState(flow.view)
  const viewRef = useRef(view)
  viewRef.current = view
  const [pending, setPending] = useState<{ from: string; x: number; y: number } | null>(null)
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)

  // a history move or a rebuild can replace the view under us
  useEffect(() => setView(flow.view), [flow.view])

  const toGraph = (cx: number, cy: number, v = viewRef.current) => {
    const r = box.current!.getBoundingClientRect()
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom }
  }

  const commitView = (v: FlowDoc['view']) => useFlow.getState().setView(v)

  // wheel: pinch or Ctrl zooms round the pointer, anything else pans
  useEffect(() => {
    const el = box.current
    if (!el) return
    let t: ReturnType<typeof setTimeout> | undefined
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      let next: FlowDoc['view']
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect()
        const zoom = Math.min(2.2, Math.max(0.25, v.zoom * Math.exp(-e.deltaY * 0.0022)))
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        next = { zoom, x: px - ((px - v.x) / v.zoom) * zoom, y: py - ((py - v.y) / v.zoom) * zoom }
      } else {
        next = { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }
      }
      setView(next)
      clearTimeout(t)
      t = setTimeout(() => commitView(next), 250)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    useFlow.getState().select(null)
    const start = { mx: e.clientX, my: e.clientY, ...viewRef.current }
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let last = viewRef.current
    const move = (ev: PointerEvent) => {
      last = { zoom: start.zoom, x: start.x + ev.clientX - start.mx, y: start.y + ev.clientY - start.my }
      setView(last)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      commitView(last)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const onHeaderDown = (e: React.PointerEvent, n: FlowNode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    useFlow.getState().select(n.id)
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const start = { mx: e.clientX, my: e.clientY, x: n.x, y: n.y }
    const move = (ev: PointerEvent) => {
      const z = viewRef.current.zoom
      useFlow.getState().moveNode(n.id, Math.round(start.x + (ev.clientX - start.mx) / z), Math.round(start.y + (ev.clientY - start.my) / z))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const onPortDown = (e: React.PointerEvent, n: FlowNode, port: PortId | 'out') => {
    e.stopPropagation()
    e.preventDefault()
    const f = useFlow.getState()
    let from = n.id
    if (port !== 'out') {
      // pulling a wire off an input picks it up by its far end
      const edge = f.flow.edges.find((q) => q.to === n.id && q.port === port)
      if (!edge) return
      from = edge.from
      f.disconnect(edge.id)
    }
    const p = toGraph(e.clientX, e.clientY)
    setPending({ from, ...p })
    const move = (ev: PointerEvent) => setPending({ from, ...toGraph(ev.clientX, ev.clientY) })
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setPending(null)
      const hit = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-port]') as HTMLElement | null
      const to = hit?.dataset.node
      const toPort = hit?.dataset.port as PortId | 'out' | undefined
      if (to && toPort && toPort !== 'out' && to !== from) useFlow.getState().connect(from, to, toPort)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    e.preventDefault()
    const { kind, what } = JSON.parse(raw) as { kind: NodeKind; what?: string }
    const p = toGraph(e.clientX, e.clientY)
    useFlow.getState().addNode(kind, Math.round(p.x - NODE_W / 2), Math.round(p.y - 20), what)
  }

  const fit = () => {
    const el = box.current
    if (!el || flow.nodes.length === 0) return
    const minX = Math.min(...flow.nodes.map((n) => n.x))
    const minY = Math.min(...flow.nodes.map((n) => n.y))
    const maxX = Math.max(...flow.nodes.map((n) => n.x + NODE_W))
    const maxY = Math.max(...flow.nodes.map((n) => n.y + 200))
    const pad = 60
    const zoom = Math.min(1.2, Math.max(0.25, Math.min((el.clientWidth - pad * 2) / (maxX - minX), (el.clientHeight - pad * 2) / (maxY - minY))))
    const next = {
      zoom,
      x: (el.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (el.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom,
    }
    setView(next)
    commitView(next)
  }

  const zoomBy = (k: number) => {
    const el = box.current
    if (!el) return
    const v = viewRef.current
    const zoom = Math.min(2.2, Math.max(0.25, v.zoom * k))
    const px = el.clientWidth / 2
    const py = el.clientHeight / 2
    const next = { zoom, x: px - ((px - v.x) / v.zoom) * zoom, y: py - ((py - v.y) / v.zoom) * zoom }
    setView(next)
    commitView(next)
  }

  const byId = new Map(flow.nodes.map((n) => [n.id, n]))
  const connected = new Set(flow.edges.map((e) => `${e.to}:${e.port}`))
  const grid = 22 * view.zoom

  return (
    <div
      ref={box}
      data-flow-graph
      onPointerDown={onBackgroundDown}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault()
      }}
      onDrop={onDrop}
      className="absolute inset-0 cursor-default overflow-hidden select-none"
      style={{
        backgroundImage: 'radial-gradient(circle, var(--line2) 1px, transparent 1.2px)',
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1">
          {flow.edges.map((e) => {
            const a = byId.get(e.from)
            const b = byId.get(e.to)
            if (!a || !b) return null
            const p1 = portPos(a, 'out')
            const p2 = portPos(b, e.port)
            const d = wire(p1.x, p1.y, p2.x, p2.y)
            const hot = hoverEdge === e.id
            return (
              <g key={e.id}>
                <path
                  d={d}
                  fill="none"
                  stroke={hot ? 'var(--tx)' : KIND_COLOR[a.kind]}
                  strokeOpacity={hot ? 0.9 : 0.75}
                  strokeWidth={hot ? 2.5 : 2}
                  strokeDasharray={hot ? '6 4' : undefined}
                />
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  className="pointer-events-auto cursor-pointer"
                  onPointerEnter={() => setHoverEdge(e.id)}
                  onPointerLeave={() => setHoverEdge(null)}
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={() => {
                    setHoverEdge(null)
                    useFlow.getState().disconnect(e.id)
                  }}
                >
                  <title>Click to cut this wire</title>
                </path>
              </g>
            )
          })}
          {pending &&
            (() => {
              const a = byId.get(pending.from)
              if (!a) return null
              const p1 = portPos(a, 'out')
              return (
                <path
                  d={wire(p1.x, p1.y, pending.x, pending.y)}
                  fill="none"
                  stroke={KIND_COLOR[a.kind]}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
              )
            })()}
        </svg>

        {flow.nodes.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            selected={selected === n.id}
            render={render}
            connected={connected}
            onHeaderDown={onHeaderDown}
            onPortDown={onPortDown}
          />
        ))}
      </div>

      {flow.nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-(--tx3)">
          <Workflow size={22} strokeWidth={1.5} />
          <p className="t-body-sm">An empty graph. Add nodes from the left, or start from Studio.</p>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => useFlow.getState().fromStudio()}
            className="rounded-md bg-(--field) px-3 py-1.5 t-body-sm text-(--tx) hover:bg-(--field-h)"
          >
            Build from Studio's look
          </button>
        </div>
      )}

      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-lg border border-(--line) bg-(--raised)/90 p-0.5 backdrop-blur-md"
      >
        <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out" className="flex h-7 w-7 items-center justify-center rounded-md text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)">
          <Minus size={14} strokeWidth={1.9} />
        </button>
        <span className="w-10 text-center t-caption text-(--tx2) tabular-nums">{Math.round(view.zoom * 100)}%</span>
        <button onClick={() => zoomBy(1.2)} title="Zoom in" className="flex h-7 w-7 items-center justify-center rounded-md text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)">
          <Plus size={14} strokeWidth={1.9} />
        </button>
        <button onClick={fit} title="Fit the graph" className="flex h-7 w-7 items-center justify-center rounded-md text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)">
          <Maximize2 size={13} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  )
}
