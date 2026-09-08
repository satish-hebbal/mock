/**
 * The preview.
 *
 * Draws with `renderAscii`, the same function the exporter calls, at whatever
 * size the window leaves for it. Which is the reason there is no second
 * "preview quality" code path: the grid is cut from the document, not from the
 * canvas, so a small preview is the identical picture drawn with smaller
 * characters rather than a rougher approximation of it.
 *
 * Renders are coalesced into an animation frame. A slider drag fires a change
 * per pointer move, and rendering each one synchronously means the browser
 * never gets to paint what was just drawn before the next one starts, so the
 * canvas appears frozen while the machine works flat out.
 */

import { useEffect, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { pickMediaFile } from '../store'
import { ALPHA_CHECKER } from '../lib/checker'
import { useAscii } from './store'
import { renderAscii } from './render'

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

export function AsciiCanvas() {
  const doc = useAscii((s) => s.doc)
  const bitmap = useAscii((s) => s.bitmap)
  const wrap = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frame = useRef(0)
  const { w: availW, h: availH } = useContainerSize(wrap)
  const [grid, setGrid] = useState({ cols: 0, rows: 0 })

  /*
   * The picture is fitted to the space rather than the space to the picture, so
   * changing the source's aspect ratio never moves the panels beside it.
   */
  const aspect = doc.size.width / Math.max(1, doc.size.height)
  const boxW = Math.max(0, availW - 48)
  const boxH = Math.max(0, availH - 48)
  const dispW = Math.max(1, Math.min(boxW, boxH * aspect))
  const dispH = Math.max(1, dispW / aspect)

  useEffect(() => {
    if (!bitmap || boxW <= 0) return
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      /*
       * Capped at 2. Above that the effect passes that walk pixels (curvature,
       * grain) cost four times as much for a difference nobody has ever been
       * able to point to on a screen.
       */
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const out = renderAscii(doc, bitmap, Math.round(dispW * dpr), Math.round(dispH * dpr))
      canvas.width = out.canvas.width
      canvas.height = out.canvas.height
      canvas.getContext('2d')!.drawImage(out.canvas, 0, 0)
      setGrid({ cols: out.cols, rows: out.rows })
    })
    return () => cancelAnimationFrame(frame.current)
  }, [doc, bitmap, dispW, dispH, boxW])

  return (
    <div
      ref={wrap}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-(--line) bg-(--panel)"
    >
      {bitmap ? (
        <>
          {/* the checkerboard only exists to prove a transparent export is
              actually transparent, so it appears only when one would be */}
          <div
            className="relative"
            style={{
              width: dispW,
              height: dispH,
              ...(doc.backdrop.mode === 'transparent' ? ALPHA_CHECKER : null),
            }}
          >
            <canvas
              ref={canvasRef}
              style={{ width: dispW, height: dispH }}
              className="block h-full w-full"
            />
          </div>
          <p className="absolute bottom-2 left-3 t-caption text-(--tx3) tabular-nums">
            {grid.cols} × {grid.rows} cells · {doc.size.width} × {doc.size.height} px
          </p>
        </>
      ) : (
        <button
          onClick={() => pickMediaFile((f) => void useAscii.getState().importImage(f), false)}
          className="media-drop relative flex h-64 w-96 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-(--line) text-(--tx3) transition-colors hover:border-(--tx3) hover:text-(--tx2)"
        >
          <span className="media-glow" aria-hidden />
          <span className="media-ripple" aria-hidden>
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="media-ring" />
            ))}
          </span>
          <ImagePlus className="media-plus" size={20} strokeWidth={1.75} />
          <span className="t-body-sm">Drop an image here, paste one, or click to browse</span>
        </button>
      )}
    </div>
  )
}
