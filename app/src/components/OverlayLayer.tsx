import { useRef } from 'react'
import { useStudio } from '../store'
import type { Overlay } from '../types'

/**
 * DOM overlay compositor preview (PRD §6.7). Overlays live in normalized
 * frame coordinates so the export path reproduces them exactly.
 */
export function OverlayLayer({ width, height }: { width: number; height: number }) {
  const overlays = useStudio((s) => s.project.overlays)
  const assets = useStudio((s) => s.assets)
  const selectedId = useStudio((s) => s.selectedOverlayId)
  const selectOverlay = useStudio((s) => s.selectOverlay)
  const updateOverlay = useStudio((s) => s.updateOverlay)

  const drag = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent, o: Overlay) => {
    e.stopPropagation()
    selectOverlay(o.id)
    drag.current = { id: o.id, startX: e.clientX, startY: e.clientY, ox: o.x, oy: o.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    updateOverlay(d.id, {
      x: Math.min(1, Math.max(0, d.ox + (e.clientX - d.startX) / width)),
      y: Math.min(1, Math.max(0, d.oy + (e.clientY - d.startY) / height)),
    })
  }

  const onPointerUp = () => {
    drag.current = null
  }

  if (overlays.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {overlays.map((o) => {
        const selected = o.id === selectedId
        const base: React.CSSProperties = {
          position: 'absolute',
          left: o.x * width,
          top: o.y * height,
          transform: `translate(-50%, -50%) rotate(${o.rotation}deg)`,
          opacity: o.opacity,
          cursor: 'move',
        }
        return (
          <div
            key={o.id}
            style={base}
            className={`pointer-events-auto select-none ${selected ? 'ring-1 ring-white/70' : ''}`}
            onPointerDown={(e) => onPointerDown(e, o)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {o.type === 'text' && (
              <div
                style={{
                  fontSize: o.size * height,
                  fontWeight: o.weight,
                  color: o.color,
                  fontFamily: o.font,
                  textAlign: o.align,
                  lineHeight: 1.25,
                  whiteSpace: 'pre',
                  ...(o.bg
                    ? {
                        background: o.bg,
                        padding: `${o.size * height * 0.35}px ${o.size * height * 0.6}px`,
                        borderRadius: 9999,
                      }
                    : {}),
                }}
              >
                {o.text}
              </div>
            )}
            {o.type === 'shape' && (
              <div
                style={{
                  width: o.width * width,
                  height: o.height * height,
                  background: o.color,
                  borderRadius: o.shape === 'ellipse' ? '50%' : o.radius * height,
                }}
              />
            )}
            {o.type === 'image' &&
              (assets[o.assetId] ? (
                <img
                  src={assets[o.assetId].url}
                  alt=""
                  draggable={false}
                  style={{ width: o.width * width, display: 'block' }}
                />
              ) : (
                <div className="rounded-xs bg-black/40 px-2 py-1 t-caption text-white">missing image</div>
              ))}
          </div>
        )
      })}
    </div>
  )
}
