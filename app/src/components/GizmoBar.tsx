import { Ban, Move3d, Rotate3d, Scale3d, type LucideIcon } from 'lucide-react'
import { NOTCH, NOTCH_BUTTON, NOTCH_GAP, NOTCH_PAD } from '../lib/notch'
import { useStudio, type GizmoMode } from '../store'

/*
 * The transform tools, living in the notch cut out of the canvas.
 *
 * These are the one group that acts on the *thing you are looking at* rather
 * than on a panel: you pick Move, then immediately drag a handle on the
 * device. In a vertical column at the far left that was a round trip across
 * the whole window every time the tool changed. Top-centre is the shortest
 * distance to the subject and out of the way of the panels on both sides.
 *
 * Sitting in the hole rather than on a floating bar is what keeps it free:
 * the canvas is genuinely that shape, so the tools cost the picture no pixels
 * at all instead of covering some of it.
 *
 * Every measurement comes from lib/notch: the pocket is sized around this row
 * rather than the row being nudged to fit a pocket, so the padding is the same
 * 6 on all four sides and the button's rounded corner sits exactly concentric
 * with the notch corner behind it.
 */

const GIZMOS: [GizmoMode, string, LucideIcon][] = [
  ['off', 'No gizmo, orbit the camera instead', Ban],
  ['translate', 'Move (G)', Move3d],
  ['rotate', 'Rotate (R)', Rotate3d],
  ['scale', 'Scale (S)', Scale3d],
]

/** One button plus the gap after it: how far the selection travels per step. */
const STEP = NOTCH_BUTTON + NOTCH_GAP

export function GizmoBar({ notched, centerX }: { notched: boolean; centerX: number }) {
  const gizmo = useStudio((s) => s.gizmo)
  const setGizmo = useStudio((s) => s.setGizmo)
  const index = Math.max(0, GIZMOS.findIndex(([id]) => id === gizmo))

  /*
   * The selection is one pill that slides, not four backgrounds taking turns
   * being visible. Switching tools then reads as the highlight *moving* to
   * what you picked, which is a much easier thing to follow across four
   * near-identical glyphs than a light going out over here and another coming
   * on over there.
   *
   * Driven by arithmetic rather than a measured offset: the buttons are a
   * fixed 32 with a fixed 4 between them, so the travel is exactly one step
   * per index and there is nothing to observe or re-measure. Duration and
   * curve are the app's own defaults, so this accelerates like everything
   * else that moves here.
   */
  const thumb = (
    <span
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 rounded-md bg-(--sel) transition-transform duration-200 motion-reduce:transition-none"
      style={{
        width: NOTCH_BUTTON,
        height: NOTCH_BUTTON,
        transform: `translateX(${index * STEP}px)`,
      }}
    />
  )

  const buttons = GIZMOS.map(([id, label, Icon]) => {
    const active = gizmo === id
    return (
      <button
        key={id}
        onClick={() => setGizmo(id)}
        title={label}
        aria-label={label}
        aria-pressed={active}
        style={{ width: NOTCH_BUTTON, height: NOTCH_BUTTON }}
        // the pill is behind, so only the unselected ones may paint a hover
        className={`relative z-10 flex shrink-0 items-center justify-center rounded-md transition-colors ${
          active ? 'text-(--tx)' : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
        }`}
      >
        <Icon size={16} strokeWidth={1.75} />
      </button>
    )
  })

  /*
   * Too narrow for the cut, so the tools fall back to a floating bar. The
   * editor is gated to 1024px and up, so this is the belt to the notch's
   * braces rather than a layout anyone should meet.
   */
  if (!notched) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
        <div
          style={{ padding: NOTCH_PAD - 1 }}
          className="pointer-events-auto rounded-lg border border-(--line) bg-(--raised)/85 backdrop-blur-md"
        >
          <div className="relative flex" style={{ gap: NOTCH_GAP }}>
            {thumb}
            {buttons}
          </div>
        </div>
      </div>
    )
  }

  /*
   * The row is placed directly, rather than centring a full-width pocket and
   * letting flexbox find the middle: it starts one padding in from the notch's
   * left wall, measured from the same whole-pixel centre the path is cut at.
   * On an odd-width panel `left-1/2` and a half-width translate land on
   * different halves of a pixel and the icons drift out of their own hole.
   */
  return (
    <div
      className="absolute z-10 flex"
      style={{
        left: centerX - NOTCH.width / 2 + NOTCH_PAD,
        top: NOTCH_PAD,
        gap: NOTCH_GAP,
      }}
    >
      {thumb}
      {buttons}
    </div>
  )
}
