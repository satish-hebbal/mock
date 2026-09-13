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
import { ASCII_NOTCH } from './notch'
import { StarterRow } from './AsciiPresets'

/** Air between the picture and the panel's walls, on the app's own 4pt step. */
const GUTTER = 24
/** The same, once the wall above it is the floor of the toolbar's pocket. */
const BAND = ASCII_NOTCH.depth + GUTTER

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
   *
   * One gutter, kept on all four sides, and the notch counts as wall.
   *
   * Reserving exactly the pocket's depth was not enough: it left a tall source
   * flush against the floor of the cut, and a picture whose edge is the same
   * line as a piece of chrome reads as a mistake even when it is deliberate,
   * which is what the top-right corner looked like. So the top band is the
   * pocket plus the same gutter the sides get, and the bottom carries that band
   * too, since the alternative is a picture that no longer sits in the middle
   * of its own canvas. The readout in the bottom-left gets clear air out of it.
   */
  const aspect = doc.size.width / Math.max(1, doc.size.height)
  const boxW = Math.max(0, availW - 2 * GUTTER)
  const boxH = Math.max(0, availH - 2 * BAND)
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
    /* no border, radius or shadow of its own any more: the frame around this is
       a real notched shape, and a rectangle drawn inside it would trace a
       corner the panel no longer has */
    <div
      ref={wrap}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-(--panel)"
    >
      {bitmap ? (
        <>
          {/*
            The checkerboard only exists to prove a transparent export is
            actually transparent, so it appears only when one would be.

            The rounded corner is on this wrapper rather than on the canvas, so
            the checkerboard is cut by it too and a transparent picture has the
            same silhouette as an opaque one. `--radius-md`, which is what the
            source thumbnail in the panel already wears: the same picture in two
            places should not round differently.

            Preview only, and deliberately so. It is a way of showing the
            artwork as an object sitting on the panel rather than as paint that
            runs to the edge of a rectangle; the export is the document, and it
            keeps its square corners.
          */}
          <div
            className="relative overflow-hidden rounded-md"
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
        /*
         * The empty state is two offers, not one.
         *
         * A drop zone alone asks for a decision (which of my photographs is
         * this for?) before it has shown what it does with one, and the answer
         * to that is not obvious even once you know: a flat snapshot turns to
         * mud. So the pictures sit right under it, already chosen to survive
         * the treatment, and the first press lands you in a finished ASCII
         * image with every control live. The drop zone keeps the top spot
         * because your own picture is still the point of the tool.
         */
        <div className="flex flex-col items-center gap-5">
          <button
            onClick={() => pickMediaFile((f) => void useAscii.getState().importImage(f), false)}
            className="media-drop relative flex h-56 w-96 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-(--line) text-(--tx3) transition-colors hover:border-(--tx3) hover:text-(--tx2)"
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
          <StarterRow />
        </div>
      )}
    </div>
  )
}
