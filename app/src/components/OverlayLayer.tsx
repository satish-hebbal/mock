import { useRef, useState } from 'react'
import { activeShot } from '../lib/sequence'
import {
  blockAlpha,
  glyphsAt,
  needsGlyphs,
  progressOf,
  resolveOverlays,
  revealOf,
  RISE_DISTANCE,
  scaleOf,
} from '../lib/overlays'
import { endEditRun } from '../lib/history'
import { useStudio } from '../store'
import type { Overlay, TextOverlay } from '../types'

/**
 * The layer stuck to the front of the frame (PRD §6.7).
 *
 * Overlays live in normalized frame coordinates and never meet the 3D scene:
 * the camera can orbit all it likes and a caption stays exactly where it was
 * put, which is the whole point of a caption. The export path draws from the
 * same numbers, so what is dragged here is what comes out.
 */

/** How close to a guide a drag has to get before it snaps, in px. */
const SNAP_PX = 6

/** The lines an overlay snaps to: the middle, and a margin in from each edge. */
const GUIDES = [0.5, 0.08, 0.92]

function TextBody({ o, height }: { o: TextOverlay; height: number }) {
  const px = o.size * height
  const kind = revealOf(o)
  const style: React.CSSProperties = {
    fontSize: px,
    fontWeight: o.weight,
    color: o.color,
    fontFamily: o.font,
    textAlign: o.align,
    lineHeight: 1.25,
    whiteSpace: 'pre',
    opacity: blockAlpha(kind, progressOf(o)),
    ...(o.bg
      ? {
          background: o.bg,
          padding: `${px * 0.35}px ${px * 0.6}px`,
          borderRadius: 9999,
        }
      : {}),
  }

  // the cheap path, which is every text overlay that is not mid-reveal
  if (!needsGlyphs(o)) return <div style={style}>{o.text}</div>

  /*
   * Mid-reveal, every character is placed individually so the line does not
   * reflow as letters arrive: a centred caption that grew from its first
   * letter would slide sideways the whole way in. Each glyph keeps its box and
   * only its paint changes.
   */
  const glyphs = glyphsAt(o.text, kind, progressOf(o))
  return (
    <div style={style}>
      {glyphs.map((g, i) =>
        g.char === '\n' ? (
          <br key={i} />
        ) : (
          <span
            key={i}
            style={{
              display: 'inline-block',
              whiteSpace: 'pre',
              opacity: g.alpha,
              transform: g.rise ? `translateY(${g.rise * RISE_DISTANCE}em)` : undefined,
            }}
          >
            {g.char}
          </span>
        ),
      )}
    </div>
  )
}

export function OverlayLayer({ width, height }: { width: number; height: number }) {
  const items = useStudio((s) => activeShot(s.project).overlays)
  const keyframes = useStudio((s) => activeShot(s.project).keyframes)
  /*
   * Only follow the clock when something here actually moves. The selector
   * returns the same 0 for every tick of a shot with no overlay tracks, so a
   * playing camera move does not re-render this layer sixty times a second.
   */
  const timeMs = useStudio((s) =>
    activeShot(s.project).keyframes.some((k) => k.target.startsWith('ov.')) ? s.timeMs : 0,
  )
  const assets = useStudio((s) => s.assets)
  const selectedId = useStudio((s) => s.selectedOverlayId)
  const selectOverlay = useStudio((s) => s.selectOverlay)
  const setAnimatable = useStudio((s) => s.setAnimatable)

  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const drag = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(null)

  const overlays = resolveOverlays(items, keyframes, timeMs)

  const onPointerDown = (e: React.PointerEvent, o: Overlay) => {
    if (e.button !== 0) return
    e.stopPropagation()
    selectOverlay(o.id)
    drag.current = { id: o.id, startX: e.clientX, startY: e.clientY, ox: o.x, oy: o.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    let dx = e.clientX - d.startX
    let dy = e.clientY - d.startY
    // shift locks the drag to the axis it started along
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
    }

    let x = Math.min(1, Math.max(0, d.ox + dx / width))
    let y = Math.min(1, Math.max(0, d.oy + dy / height))

    /*
     * Magnets on the centre line and the two safe margins. Placing a logo is
     * nearly always "in the corner" or "dead centre", and hitting either by
     * eye to the pixel is luck. Alt holds the drag free.
     */
    let gx: number | null = null
    let gy: number | null = null
    if (!e.altKey) {
      for (const g of GUIDES) {
        if (Math.abs(x - g) * width < SNAP_PX) {
          x = g
          gx = g
        }
        if (Math.abs(y - g) * height < SNAP_PX) {
          y = g
          gy = g
        }
      }
    }
    setGuides({ x: gx, y: gy })
    /*
     * Through the animatable path, not a plain write. A layer with a track on
     * its position is being driven by its keyframes, so a bare write would be
     * overwritten by the next evaluation and the drag would spring back; this
     * drops a key at the playhead instead, which is what dragging an animated
     * camera already does. One label for both axes, so the whole drag is a
     * single step to undo.
     */
    setAnimatable(`ov.${d.id}.x`, x, 'overlay-drag')
    setAnimatable(`ov.${d.id}.y`, y, 'overlay-drag')
  }

  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    setGuides({ x: null, y: null })
    // the gesture is over: the next nudge is its own undo step
    endEditRun()
  }

  if (overlays.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {overlays.map((o) => {
        const selected = o.id === selectedId
        const scale = scaleOf(o)
        const base: React.CSSProperties = {
          position: 'absolute',
          left: o.x * width,
          top: o.y * height,
          transform: `translate(-50%, -50%) rotate(${o.rotation}deg)${
            scale === 1 ? '' : ` scale(${scale})`
          }`,
          opacity: o.opacity,
          cursor: 'move',
        }
        return (
          <div
            key={o.id}
            /*
             * The camera gestures are native listeners on an ancestor, so they
             * run during the bubble phase, before React has dispatched a thing.
             * stopPropagation below cannot reach back and undo an orbit that
             * has already begun; this attribute is what those listeners look
             * for so they can stand down before it does.
             */
            data-overlay=""
            style={base}
            className={`pointer-events-auto touch-none select-none ${
              selected ? 'outline-1 outline-offset-2 outline-white/70' : ''
            }`}
            onPointerDown={(e) => onPointerDown(e, o)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {o.type === 'text' && <TextBody o={o} height={height} />}
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

      {/* the line the drag just snapped to, for as long as it holds */}
      {guides.x !== null && (
        <span
          className="pointer-events-none absolute inset-y-0 w-px bg-(--accent)"
          style={{ left: guides.x * width }}
        />
      )}
      {guides.y !== null && (
        <span
          className="pointer-events-none absolute inset-x-0 h-px bg-(--accent)"
          style={{ top: guides.y * height }}
        />
      )}
    </div>
  )
}
