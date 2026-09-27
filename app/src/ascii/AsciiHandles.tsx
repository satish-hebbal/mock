/**
 * Handles on the picture.
 *
 * Two things in this tool have a place on the frame: the reveal, and a layer
 * that works around a centre (a twirl, a lens, a zoom). Both used to be two
 * sliders labelled X and Y, which is a way of pointing at something with your
 * eyes shut. So each gets a handle where it actually is, drawn over the canvas
 * and dragged there, and the sliders stay in the panel for exact values.
 *
 * Only one layer shows a handle at a time: the one whose card is open. Six
 * handles for six layers would be a puzzle of which dot is which.
 */

import { useRef } from 'react'
import { endEditRun } from '../lib/history'
import { getFilter } from './filters'
import { useAscii } from './store'

function Handle({
  x,
  y,
  title,
  onMove,
  ring,
  line,
}: {
  x: number
  y: number
  title: string
  onMove: (fx: number, fy: number) => void
  /** a circle drawn round the handle, in CSS pixels */
  ring?: number
  /** a guide line through the handle, in degrees */
  line?: number
}) {
  const box = useRef<HTMLDivElement>(null)

  const down = (e: React.PointerEvent) => {
    const parent = box.current?.parentElement
    if (!parent) return
    e.stopPropagation()
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const r = parent.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      onMove(
        Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)),
      )
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      endEditRun()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <div ref={box} className="pointer-events-none absolute inset-0">
      {ring !== undefined && (
        <div
          className="absolute rounded-full border border-dashed border-white/70 mix-blend-difference"
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: ring * 2, height: ring * 2, transform: 'translate(-50%, -50%)' }}
        />
      )}
      {line !== undefined && (
        <div
          className="absolute h-px w-[300%] border-t border-dashed border-white/70 mix-blend-difference"
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: `translate(-50%, 0) rotate(${line + 90}deg)` }}
        />
      )}
      <button
        onPointerDown={down}
        title={title}
        aria-label={title}
        className="pointer-events-auto absolute flex h-5 w-5 cursor-grab items-center justify-center rounded-full bg-white/90 shadow-[0_1px_4px_rgb(0_0_0/0.5)] ring-2 ring-black/40 transition-transform hover:scale-110 active:cursor-grabbing"
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: 'translate(-50%, -50%)' }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-black/70" />
      </button>
    </div>
  )
}

export function CanvasHandles({ width, height }: { width: number; height: number }) {
  const reveal = useAscii((s) => s.doc.reveal)
  const activeId = useAscii((s) => s.activeLayer)
  const layer = useAscii((s) => s.doc.layers.find((l) => l.uid === s.activeLayer && l.on))
  const section = useAscii((s) => s.section)
  const spec = layer ? getFilter(layer.kind) : undefined
  const st = useAscii.getState
  const diag = Math.hypot(width, height)

  return (
    <>
      {reveal.mode !== 'off' && (
        <Handle
          x={reveal.x}
          y={reveal.y}
          title="Drag to move the reveal"
          ring={reveal.mode === 'spot' ? reveal.size * diag : undefined}
          line={reveal.mode === 'spot' ? undefined : reveal.angle}
          onMove={(x, y) =>
            st().patch((d) => {
              d.reveal.x = x
              d.reveal.y = y
            }, 'ascii-rv-move')
          }
        />
      )}
      {section === 'layers' && layer && spec?.positioned && activeId && (
        <Handle
          x={Number(layer.params.cx ?? 0.5)}
          y={Number(layer.params.cy ?? 0.5)}
          title={`Drag to move the ${spec.label.toLowerCase()}`}
          ring={typeof layer.params.radius === 'number' ? (layer.params.radius as number) * diag * 0.5 : undefined}
          onMove={(x, y) =>
            st().patch((d) => {
              const l = d.layers.find((q) => q.uid === activeId)
              if (!l) return
              l.params.cx = x
              l.params.cy = y
            }, `ascii-layer-${activeId}-move`)
          }
        />
      )}
    </>
  )
}
