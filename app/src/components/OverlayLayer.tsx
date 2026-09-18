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

/** Angles a rotation lands on while shift is held. */
const ANGLE_STEP = 15

/*
 * The transform box.
 *
 * Sizing something by watching a number go up is working blind: a caption is
 * the right size when it looks right against the device beside it, and that
 * judgement is made on the canvas, not in a panel. The sliders stay for typing
 * an exact value, but the handles are how a size is actually chosen.
 *
 * Corners scale from the centre, which is where an overlay is anchored, so
 * what is under the pointer keeps its relation to the middle of the box
 * instead of the whole thing crawling sideways as it grows. The sides are for
 * shapes only, which are the one kind with two independent dimensions.
 */

/** Where a handle sits on the box, as a fraction of its half-width and half-height. */
const CORNERS = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
] as const

const EDGES = [
  { id: 'n', x: 0.5, y: 0, axis: 'y', cursor: 'ns-resize' },
  { id: 'e', x: 1, y: 0.5, axis: 'x', cursor: 'ew-resize' },
  { id: 's', x: 0.5, y: 1, axis: 'y', cursor: 'ns-resize' },
  { id: 'w', x: 0, y: 0.5, axis: 'x', cursor: 'ew-resize' },
] as const

/** The size a corner drag is scaling, per kind of layer. */
function sizeOf(o: Overlay): { size?: number; width?: number; height?: number } {
  if (o.type === 'text') return { size: o.size }
  if (o.type === 'image') return { width: o.width }
  return { width: o.width, height: o.height }
}

/** That size multiplied, clamped to what each kind can usefully be. */
function scaledSize(o: Overlay, start: ReturnType<typeof sizeOf>, k: number): Partial<Overlay> {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  if (o.type === 'text') return { size: clamp((start.size ?? 0.05) * k, 0.008, 0.5) }
  if (o.type === 'image') return { width: clamp((start.width ?? 0.12) * k, 0.02, 2) }
  return {
    width: clamp((start.width ?? 0.2) * k, 0.01, 2),
    height: clamp((start.height ?? 0.1) * k, 0.01, 2),
  }
}

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
  const playing = useStudio((s) => s.playing)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const selectOverlay = useStudio((s) => s.selectOverlay)
  const setAnimatable = useStudio((s) => s.setAnimatable)

  const updateOverlay = useStudio((s) => s.updateOverlay)

  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const drag = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  const overlays = resolveOverlays(items, keyframes, timeMs)

  /** An overlay's anchor point in client coordinates, which is its centre. */
  const centreOf = (o: Overlay) => {
    const r = frameRef.current?.getBoundingClientRect()
    return { cx: (r?.left ?? 0) + o.x * width, cy: (r?.top ?? 0) + o.y * height }
  }

  /**
   * Run a handle drag: capture the pointer, keep the camera out of it, and feed
   * every move to `onMove` until it is let go.
   */
  const handleDrag = (
    e: React.PointerEvent,
    o: Overlay,
    onMove: (ev: PointerEvent, ctx: { cx: number; cy: number }) => void,
  ) => {
    e.stopPropagation()
    e.preventDefault()
    selectOverlay(o.id)
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const ctx = centreOf(o)
    const move = (ev: PointerEvent) => onMove(ev, ctx)
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      endEditRun()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  /** Corner: scale from the centre by how much further out the pointer went. */
  const startCornerResize = (e: React.PointerEvent, o: Overlay) => {
    const start = sizeOf(o)
    const { cx, cy } = centreOf(o)
    /*
     * Measured as a distance from the centre rather than along an axis, which
     * is what makes this hold up on a rotated layer: the distance does not care
     * which way the box is turned, so a corner still grows the box under the
     * pointer at 30° exactly as it does at 0°.
     */
    const d0 = Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy))
    handleDrag(e, o, (ev, c) => {
      const k = Math.hypot(ev.clientX - c.cx, ev.clientY - c.cy) / d0
      updateOverlay(o.id, scaledSize(o, start, k))
    })
  }

  /** Side: one axis of a shape, measured along the box's own direction. */
  const startEdgeResize = (e: React.PointerEvent, o: Overlay, axis: 'x' | 'y') => {
    if (o.type !== 'shape') return
    const startW = o.width
    const startH = o.height
    const sx = e.clientX
    const sy = e.clientY
    const rad = (-o.rotation * Math.PI) / 180
    handleDrag(e, o, (ev) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      // into the box's own frame, so a rotated shape widens along its own side
      const localX = dx * Math.cos(rad) - dy * Math.sin(rad)
      const localY = dx * Math.sin(rad) + dy * Math.cos(rad)
      // doubled: the box grows from its centre, so an edge moves half of it
      const next =
        axis === 'x'
          ? { width: Math.min(2, Math.max(0.01, startW + (2 * localX) / width)) }
          : { height: Math.min(2, Math.max(0.01, startH + (2 * localY) / height)) }
      updateOverlay(o.id, next)
    })
  }

  /** The knob above the box: turn the layer about its own centre. */
  const startRotate = (e: React.PointerEvent, o: Overlay) => {
    handleDrag(e, o, (ev, c) => {
      const deg = (Math.atan2(ev.clientY - c.cy, ev.clientX - c.cx) * 180) / Math.PI + 90
      const snapped = ev.shiftKey ? Math.round(deg / ANGLE_STEP) * ANGLE_STEP : Math.round(deg)
      const wrapped = ((snapped + 180) % 360) - 180
      setAnimatable(`ov.${o.id}.rotation`, wrapped, 'overlay-rotate')
    })
  }

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
    <div ref={frameRef} className="pointer-events-none absolute inset-0 overflow-hidden">
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
          cursor: 'move',
        }
        /*
         * The box shows while you are working on the layer and at no other
         * time. It is scaffolding for placing something, so during playback it
         * is just a rectangle drawn over the picture, and a caption that has
         * not arrived yet used to leave nothing on screen *but* the rectangle.
         *
         * A hover ring as well, fainter, because a layer animated from nothing
         * is invisible at the head of its own shot and you still have to be
         * able to find the thing you are about to drag.
         */
        const ring = playing
          ? ''
          : selected
            ? 'outline-1 outline-offset-2 outline-white/80'
            : hoverId === o.id
              ? 'outline-1 outline-offset-2 outline-white/25'
              : ''
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
            className={`pointer-events-auto touch-none select-none ${ring}`}
            onPointerDown={(e) => onPointerDown(e, o)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerEnter={() => setHoverId(o.id)}
            onPointerLeave={() => setHoverId((id) => (id === o.id ? null : id))}
          >
            {/*
              The layer's own alpha lives on the content, not on the box around
              it, so a caption animated up from nothing can still be found and
              aligned while it is invisible: the outline stays solid even when
              what it is holding is not.
            */}
            <div style={{ opacity: o.opacity }}>
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
                  <div className="rounded-xs bg-black/40 px-2 py-1 t-caption text-white">
                    missing image
                  </div>
                ))}
            </div>

            {/*
              The handles, drawn on the box rather than beside it, so they
              travel with a rotated or scaled layer without a second set of
              maths to keep them in step. Each one counter-scales, or a layer
              at 3× would be wearing handles three times the size.
            */}
            {selected && !playing && (
              <>
                {CORNERS.map((h) => (
                  <span
                    key={h.id}
                    onPointerDown={(e) => startCornerResize(e, o)}
                    title="Drag to resize"
                    style={{
                      left: `${h.x * 100}%`,
                      top: `${h.y * 100}%`,
                      cursor: h.cursor,
                      transform: `translate(-50%, -50%) scale(${1 / scale})`,
                    }}
                    className="pointer-events-auto absolute h-2.5 w-2.5 rounded-[2px] border border-black/60 bg-white"
                  />
                ))}
                {o.type === 'shape' &&
                  EDGES.map((h) => (
                    <span
                      key={h.id}
                      onPointerDown={(e) => startEdgeResize(e, o, h.axis)}
                      title={h.axis === 'x' ? 'Drag to set the width' : 'Drag to set the height'}
                      style={{
                        left: `${h.x * 100}%`,
                        top: `${h.y * 100}%`,
                        cursor: h.cursor,
                        transform: `translate(-50%, -50%) scale(${1 / scale})`,
                      }}
                      className="pointer-events-auto absolute h-2 w-2 rounded-[2px] border border-black/60 bg-white/85"
                    />
                  ))}
                <span
                  onPointerDown={(e) => startRotate(e, o)}
                  title="Drag to rotate · shift for 15° steps"
                  style={{
                    left: '50%',
                    top: 0,
                    cursor: 'grab',
                    transform: `translate(-50%, -22px) scale(${1 / scale})`,
                  }}
                  className="pointer-events-auto absolute h-2.5 w-2.5 rounded-full border border-black/60 bg-white"
                />
              </>
            )}
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
