/*
 * The behaviour of a button you have to mean.
 *
 * Split out of HoldButton because there are now two of these with the same
 * interaction and completely different shapes: a pill whose own cap sweeps
 * across it as it charges, and a round one in the pen tray that fills a ring
 * around its edge. What they share is not a look, it is a feel — how long the
 * hold is, how the charge accelerates, when to give up, and when to admit the
 * control needs explaining — and that is exactly what lives here.
 *
 * Keeping it in one place matters more than the saved lines. If the two drift,
 * the app has two subtly different ideas of how long "held" is, and the second
 * one you meet feels broken.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** How long the press has to be held. Long enough to be a decision. */
export const HOLD_MS = 1500
/** How far the contents compress at full charge. */
export const SQUEEZE = 0.12

/**
 * A press shorter than this was a click, not an abandoned hold.
 *
 * Someone who held for a second and let go has understood the control and
 * changed their mind; they do not need telling. This only wants to catch the
 * press-and-release that expects a button to fire.
 */
const TAP_MS = 400
/** Clicks before the hint shows. One is a slip; two is a misunderstanding. */
const TAPS_BEFORE_HINT = 2
/** Clicks further apart than this are unrelated, so the count starts over. */
const TAP_WINDOW_MS = 4000

/**
 * The shape of the charge: creeping at first, then running away with itself.
 *
 * Linear was the honest readout and the wrong feeling: a constant crawl reads
 * as a progress bar being reported to you, when what this wants to be is
 * something winding up. Accelerating gives it that: the last third arrives in
 * a rush, so the moment it fires is the peak of a build rather than the end of
 * a wait.
 *
 * The exponent is the whole argument. Squared is the textbook ease-in and it
 * sat dead for the first half a second, which is exactly the window where the
 * fill has to prove holding is doing something or you let go. At 1.75 there is
 * visible travel from the first frames and the acceleration still lands.
 *
 * Only the *look* is curved. Completion is still keyed off raw elapsed time,
 * so the hold takes the time it says it does either way.
 */
export const charge = (t: number) => t ** 1.75

export type HoldPhase = 'idle' | 'holding' | 'fired'

export interface Hold {
  /** the raw clock, 0..1; run it through `charge` for what the eye is shown */
  progress: number
  phase: HoldPhase
  /** the control has been clicked at rather than held, twice */
  nudge: boolean
  clearNudge: () => void
  /** back to rest, once the receipt animation has finished */
  reset: () => void
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerUp: () => void
    onPointerCancel: () => void
    onKeyDown: (e: React.KeyboardEvent) => void
    onKeyUp: (e: React.KeyboardEvent) => void
  }
}

export function useHold(onHold: () => void, holdMs: number = HOLD_MS): Hold {
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<HoldPhase>('idle')
  const [nudge, setNudge] = useState(false)
  const taps = useRef({ n: 0, at: 0 })
  const raf = useRef(0)
  const start = useRef(0)
  /* keydown repeats while a key is held, so the first one owns the charge */
  const keyHeld = useRef(false)
  /* read by the handlers, which would otherwise close over a stale phase */
  const phaseRef = useRef<HoldPhase>('idle')
  phaseRef.current = phase

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    raf.current = 0
  }, [])

  const cancel = useCallback(() => {
    keyHeld.current = false
    stop()
    /*
     * Letting go *after* a hold completes is not an abandonment. The pointer is
     * still down at the moment it fires, so the release that follows would
     * otherwise land here and reset the state out from under the pop, cutting
     * the animation off a frame or two in, every single time.
     */
    if (phaseRef.current === 'fired') return

    /*
     * A release this early is someone clicking a button, so start counting.
     * Only while actually holding: `cancel` also runs for a stray pointerup
     * and on window blur, neither of which is a click at this control.
     */
    if (phaseRef.current === 'holding' && performance.now() - start.current < TAP_MS) {
      const now = performance.now()
      const t = taps.current
      t.n = now - t.at > TAP_WINDOW_MS ? 1 : t.n + 1
      t.at = now
      if (t.n >= TAPS_BEFORE_HINT) {
        t.n = 0
        setNudge(true)
      }
    }

    setPhase('idle')
    setProgress(0)
  }, [stop])

  const begin = useCallback(() => {
    if (raf.current) return
    setPhase('holding')
    start.current = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start.current) / holdMs)
      setProgress(p)
      if (p < 1) {
        raf.current = requestAnimationFrame(tick)
        return
      }
      stop()
      keyHeld.current = false
      setPhase('fired')
      onHold()
    }
    raf.current = requestAnimationFrame(tick)
  }, [onHold, stop, holdMs])

  // a hold interrupted by the tab going away should not survive the trip
  useEffect(() => {
    const onBlur = () => cancel()
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      cancelAnimationFrame(raf.current)
    }
  }, [cancel])

  const reset = useCallback(() => {
    setPhase('idle')
    setProgress(0)
  }, [])

  return {
    progress,
    phase,
    nudge,
    clearNudge: useCallback(() => setNudge(false), []),
    reset,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        // primary button only; a right-click should not arm anything
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        begin()
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      /* keyboard parity: hold Space or Enter, release to abandon */
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key !== ' ' && e.key !== 'Enter') return
        e.preventDefault()
        if (keyHeld.current) return
        keyHeld.current = true
        begin()
      },
      onKeyUp: (e: React.KeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') cancel()
      },
    },
  }
}
