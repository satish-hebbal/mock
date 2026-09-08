/**
 * The preview.
 *
 * Draws with `renderSignal`, the same function the exporter calls. There is one
 * renderer and no second quality path, so nothing on screen can drift from what
 * lands in the file.
 *
 * What it no longer does is always draw at the document's resolution. The
 * canvas is CSS-scaled down to fit the window regardless, so a 1920x1080
 * document shown in a 700px box was computing four pixels for every one anybody
 * could see, and a per-pixel field landed in single figures. In 'fit' mode it
 * draws at the size it is actually displayed at instead.
 *
 * The trade is real and is not hidden. A dither mask is measured in pixels, so
 * a fitted preview lays down a coarser grid than the file will. The inspector
 * offers 'exact' for when that matters, the readout under the canvas says what
 * percentage is being drawn, and every export is the document's own size either
 * way.
 *
 * The clock lives in the store but is written straight through `setState` on
 * the raw store rather than through a React setter, and read the same way. A
 * `set` per frame would re-render both panels sixty times a second to move a
 * number neither of them displays.
 */

import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { useSignal } from './store'
import { renderSignal } from './render'

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

export function SignalCanvas() {
  const size = useSignal((s) => s.doc.canvas)
  const wrap = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { w: availW, h: availH } = useContainerSize(wrap)
  const [fps, setFps] = useState(0)

  const aspect = size.width / Math.max(1, size.height)
  const boxW = Math.max(0, availW - 48)
  const boxH = Math.max(0, availH - 72)
  const dispW = Math.max(1, Math.min(boxW, boxH * aspect))
  const dispH = Math.max(1, dispW / aspect)

  /*
   * Capped at the document size, never above it. Drawing more pixels than the
   * file will have is pure waste, and on a high-density screen the naive
   * `display x dpr` overshoots a small document badly.
   *
   * Rounded to an even number so scaling back up cannot leave a half-pixel
   * column at the right edge.
   */
  const fit = size.preview === 'fit'
  const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
  const renderW = fit
    ? Math.max(64, Math.min(size.width, Math.round((dispW * dpr) / 2) * 2))
    : size.width
  const renderH = fit ? Math.max(64, Math.round(renderW / aspect)) : size.height

  /*
   * The loop starts once and never restarts, so it reads the target size out of
   * a ref rather than closing over whatever it was on mount. Restarting the
   * loop on every resize would reset the clock mid-drag.
   */
  const sizeRef = useRef({ width: renderW, height: renderH })
  sizeRef.current = { width: renderW, height: renderH }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let raf = 0
    let lastFrame = 0
    let lastDraw = 0
    let frames = 0
    let fpsWindow = 0
    let hidden = document.hidden

    /*
     * A hidden tab is not paused, it is skipped. The clock stops advancing, so
     * coming back to a tab left running for ten minutes shows the frame you
     * left rather than a document ten minutes further along, and none of that
     * time was spent on a canvas nobody could see.
     */
    const onVisibility = () => {
      hidden = document.hidden
      if (!hidden) {
        lastFrame = 0
        lastDraw = 0
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (hidden) return

      const s = useSignal.getState()
      const cap = s.doc.canvas.fpsCap
      if (cap > 0 && cap < 60 && now - lastDraw < 1000 / cap) return

      // dt is measured from the last frame actually *drawn*, not from the last
      // time the loop ran, or a capped document would advance its clock in
      // fractions of the interval it renders at and play back slowly
      const dt = lastFrame > 0 ? (now - lastFrame) / 1000 : 1 / 60
      lastFrame = now
      lastDraw = now

      frames++
      fpsWindow += dt
      if (fpsWindow >= 1) {
        setFps(frames)
        frames = 0
        fpsWindow = 0
      }

      if (s.playing) {
        // speed scales the clock here rather than inside seventy-one generators
        useSignal.setState({ time: s.time + dt * s.doc.source.speed })
      }
      renderSignal(useSignal.getState().doc, useSignal.getState().time, canvas, {
        size: sizeRef.current,
      })
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const previewPct = Math.round((renderW / size.width) * 100)

  return (
    <div
      ref={wrap}
      className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-lg border border-(--line) bg-(--panel)"
    >
      <canvas ref={canvasRef} style={{ width: dispW, height: dispH }} className="block rounded-sm" />

      <div className="absolute bottom-2 left-3 flex items-center gap-3">
        <Transport />
        <p className="t-caption text-(--tx3) tabular-nums">
          {size.width} × {size.height} · {fps} fps
          {fit && previewPct < 100 ? ` · preview ${previewPct}%` : ''}
        </p>
      </div>
    </div>
  )
}

/**
 * Play, pause and restart, on the canvas rather than in a panel.
 *
 * They are the two things you press while looking at the picture rather than
 * adjust while looking at a control, so they sit where your eyes already are.
 */
function Transport() {
  const playing = useSignal((s) => s.playing)
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-(--field) p-0.5">
      <button
        onClick={() => useSignal.getState().togglePlay()}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={playing ? 'Pause' : 'Play'}
        className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)"
      >
        {playing ? <Pause size={13} strokeWidth={2} /> : <Play size={13} strokeWidth={2} />}
      </button>
      <button
        onClick={() => useSignal.getState().restart()}
        title="Back to the start (0)"
        aria-label="Back to the start"
        className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)"
      >
        <RotateCcw size={12} strokeWidth={2} />
      </button>
    </div>
  )
}
