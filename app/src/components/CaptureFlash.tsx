import { useUI } from '../lib/ui'

/*
 * The shutter.
 *
 * A quick snap writes a file with no dialog, which is the point of it, but that
 * also means the only evidence it worked is a line in the downloads tray. This
 * puts the confirmation where you're already looking: a band of light crosses
 * the frame and its edge lights up for a moment.
 *
 * The edge matters as much as the sweep. It traces the exact rectangle that got
 * written to the file, so the animation answers "did it work" and "what did it
 * take" at the same time. That second question is otherwise one you only answer
 * by opening the PNG and noticing what got cropped.
 *
 * Mounted inside the framed region rather than over the whole viewport, so it
 * can never claim more of the screen than the export actually contains.
 */
export function CaptureFlash() {
  const snap = useUI((s) => s.snap)
  if (!snap) return null

  /*
   * No timer and no "is it playing" state. Both layers finish where they can't
   * be seen (the band off the right edge under overflow-hidden, the edge at
   * zero opacity), so leaving the element mounted costs nothing and there is no
   * window where a re-render can catch it half torn down.
   *
   * `key` is the whole mechanism: React replaces the pair on every snap, and a
   * fresh element restarts its CSS animations from zero. That also makes a
   * second snap mid-sweep restart cleanly instead of being swallowed.
   */
  return (
    <div key={snap} className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {/*
        The travelling band of light, with its own shadow trailing it.
        `drop-shadow` reads the band's alpha, so the shadow is the shape of the
        light itself and rides along on the same transform. One animation moves
        both, which is cheaper than a second animated layer and can never drift
        out of sync with the highlight it belongs to.
      */}
      <div
        className="absolute inset-y-0 w-[45%] animate-[snap-sweep_700ms_cubic-bezier(0.3,0,0.2,1)_forwards]"
        style={{
          background:
            'linear-gradient(100deg, transparent, rgba(255,255,255,0.14) 35%, rgba(255,255,255,0.72) 50%, rgba(255,255,255,0.14) 65%, transparent)',
          // offset against the direction of travel, so the dark edge is the
          // side the light has already left rather than the one it is reaching
          filter: 'drop-shadow(-22px 0 20px rgba(0,0,0,0.55))',
        }}
      />
      {/* the edge, tracing exactly what got written to the file. Inline shadow
          rather than a ring utility: Tailwind v4 renamed ring-inset, and the
          old spelling silently resolves to a transparent shadow. */}
      <div
        className="absolute inset-0 animate-[snap-edge_700ms_ease-out_forwards] rounded-lg opacity-0"
        style={{ boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.8)' }}
      />
    </div>
  )
}
