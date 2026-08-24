import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FRAME_RADIUS, NOTCH, fitsNotch, framePath, notchCenter, type NotchGeom } from '../lib/notch'
import { GizmoBar } from './GizmoBar'

/*
 * The canvas panel, with the transform tools cut into its top edge.
 *
 * Three layers, and the split matters: the clipped layer holds the picture and
 * really is notch-shaped, so nothing can paint into the hole; the stroke layer
 * draws the hairline along the same path, because a CSS border would be
 * sliced in half by the clip; and the tools sit above both, outside the clip,
 * because a child of the clipped layer would be cut away by the very hole it
 * is meant to occupy.
 */
export function NotchedCanvas({
  children,
  notch = NOTCH,
  bar,
  overlay,
}: {
  children: ReactNode
  /** the hole to cut, sized around whatever row is going in it */
  notch?: NotchGeom
  /** what sits in the hole; Studio's transform tools by default */
  bar?: (p: { notched: boolean; centerX: number; depth: number }) => ReactNode
  /** anything else that floats over the canvas but outside the clip */
  overlay?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const measured = box.w > 0 && box.h > 0
  const notched = measured && fitsNotch(box.w, box.h, notch)
  // the clip runs on the true edge; the stroke half a pixel inside it, so a
  // 1px line lands on the pixel instead of straddling the boundary
  const path = measured ? framePath(box.w, box.h, 0, notch) : ''
  const edge = measured ? framePath(box.w, box.h, 0.5, notch) : ''

  return (
    <div ref={ref} className="relative min-h-0 min-w-0 flex-1">
      <div
        className="absolute inset-0 overflow-hidden bg-(--raised)"
        style={{
          borderRadius: FRAME_RADIUS,
          // before the first measurement there is no path to clip to; the
          // radius alone carries the shape for that one frame
          clipPath: path ? `path('${path}')` : undefined,
        }}
      >
        {children}
      </div>

      {path && (
        <svg
          className="pointer-events-none absolute inset-0"
          width={box.w}
          height={box.h}
          aria-hidden
        >
          {/*
            One stroke for the whole outline. The notch used to get a second,
            brighter pass over the top to make the cut easier to pick out in
            dark theme, but a doubled line reads as a seam where the border
            changes colour halfway along, which is a worse problem than the
            one it solved. The canvas is a peer of every other panel, so it
            carries the same `--line` the rest of them do, all the way round.
          */}
          <path d={edge} fill="none" stroke="var(--line)" strokeWidth={1} />
        </svg>
      )}

      {bar ? (
        bar({ notched, centerX: measured ? notchCenter(box.w) : 0, depth: notch.depth })
      ) : (
        <GizmoBar notched={notched} centerX={measured ? notchCenter(box.w) : 0} />
      )}
      {overlay}
    </div>
  )
}
