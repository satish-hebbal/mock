/**
 * The working surface: one sheet of paper on a table.
 *
 * The page is laid out at its true pixel size and scaled with a single
 * transform, never re-laid-out. That is what keeps the preview honest, since a
 * page that reflowed to fit the window would be a different page from the one
 * that prints, and it is also what makes zooming free: a transform is composited
 * and a reflow of a table is not, so dragging the zoom stays at frame rate.
 *
 * Fit is the default and is recomputed on resize, which means the sheet always
 * fills the width it has and opening a panel does not leave it stranded in a
 * corner. Choosing a zoom opts out of that until Fit is asked for again.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { InvoicePaper } from './InvoicePaper'
import { useInvoice } from './store'
import { PAGE_SIZE } from './types'

/** Air between the sheet and the edge of the canvas, at fit. */
const MARGIN = 28
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2

export function InvoiceCanvas() {
  const doc = useInvoice((s) => s.doc)
  const logoUrl = useInvoice((s) => s.logoUrl)
  const zoom = useInvoice((s) => s.zoom)

  const boxRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(0.6)

  const page = PAGE_SIZE[doc.look.page]

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth - MARGIN * 2
      if (w <= 0) return
      /*
       * Fit is to the width, and the page scrolls. The sheet is typed on now,
       * and a whole page squeezed into the height of a laptop screen sets its
       * body text at about seven pixels, which is fine to look at and hopeless
       * to edit. Never past 1:1 either: a sheet blown up past its own size to
       * fill a wide window looks like a zoom bug rather than a generous layout.
       */
      setFit(Math.min(w / page.w, 1))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [page.w])

  const scale = zoom || fit
  const st = useInvoice.getState

  /*
   * Ctrl+wheel zooms, which is the gesture every canvas in every design tool
   * already answers to, and a plain wheel is left to scroll. Non-passive
   * because the default browser action (zooming the whole page) has to be
   * cancelled, and a passive listener is not allowed to cancel anything.
   */
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const current = useInvoice.getState().zoom || fit
      const next = current * (e.deltaY > 0 ? 0.92 : 1.08)
      st().setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [fit, st])

  const step = (by: number) =>
    st().setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (zoom || fit) + by)))

  /*
   * Two boxes, and the split is load-bearing: the outer one is positioned and
   * does not scroll, the inner one scrolls and is not positioned.
   *
   * The zoom pill used to sit inside the scroller. An absolutely positioned
   * element resolves against its nearest positioned ancestor's *padding box*,
   * and a scroll container's padding box scrolls with its content, so the pill
   * was pinned to the bottom of the page rather than to the bottom of the
   * window: at fit there is nothing to scroll and it looked correct, and at any
   * zoom past fit it slid away with the sheet. Hoisting it out of the scroller
   * is the whole fix.
   */
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={boxRef} className="dot-grid h-full w-full overflow-auto">
        {/*
          The sheet is centred by a flex box that is at least as big as the
          canvas, so it sits in the middle when it fits and scrolls from the
          middle out when it does not. Centring with `margin: auto` on the scaled
          element instead would measure the element's *unscaled* box and leave the
          page pinned to the top-left at any zoom below 1.
        */}
        <div
          className="flex min-h-full min-w-full items-center justify-center"
          style={{ padding: MARGIN }}
        >
          <div
            style={{
              width: page.w * scale,
              height: page.h * scale,
              // the scaled box above reserves the real estate; this one carries
              // the page at its true size and shrinks it into that space
              flex: 'none',
            }}
          >
            <div
              className="inv-sheet"
              style={{
                width: page.w,
                height: page.h,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
            >
              <InvoicePaper doc={doc} logoUrl={logoUrl} editable />
            </div>
          </div>
        </div>
      </div>

      {/* zoom, on the window's bottom edge rather than the page's */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-(--line) bg-(--raised)/85 p-1 backdrop-blur-md">
          <ZoomButton label="Zoom out" onClick={() => step(-0.1)}>
            <Minus size={14} strokeWidth={2} />
          </ZoomButton>
          <button
            onClick={() => st().setZoom(0)}
            title="Fit the page to the window"
            className="flex h-7 min-w-14 items-center justify-center gap-1.5 rounded-md px-2 t-caption tabular-nums text-(--tx2) transition-colors hover:bg-(--panel3) hover:text-(--tx)"
          >
            {zoom ? <Maximize2 size={11} strokeWidth={2} /> : null}
            {Math.round(scale * 100)}%
          </button>
          <ZoomButton label="Zoom in" onClick={() => step(0.1)}>
            <Plus size={14} strokeWidth={2} />
          </ZoomButton>
        </div>
      </div>
    </div>
  )
}

function ZoomButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-md text-(--tx2) transition-colors hover:bg-(--panel3) hover:text-(--tx)"
    >
      {children}
    </button>
  )
}
