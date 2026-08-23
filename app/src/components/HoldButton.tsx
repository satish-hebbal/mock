import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/*
 * A button you have to mean.
 *
 * Start over throws away the whole canvas, which used to need a confirm dialog
 * in front of it. A dialog is a poor guard for this: it interrupts to ask a
 * question you answer without reading, and the "are you sure" reflex means the
 * second click is barely more considered than the first would have been.
 *
 * Holding is the deliberation instead. The commitment is continuous — you can
 * feel it filling and let go at any point — so the intent is proven by the
 * gesture rather than asserted in a second click, and nothing has to interrupt
 * to ask. The fill is a live progress bar and also the escape hatch: it is
 * obvious at every moment both that something is about to happen and how to
 * stop it.
 *
 * The scale is doing quiet work too. The contents shrink as the hold builds —
 * the button appears to compress under the pressure — so the release can spring
 * back past its resting size and land. That overshoot is the whole receipt:
 * without it the action fires with no acknowledgement at all, since the thing
 * it did is off in another panel.
 */

/** How long the press has to be held. Long enough to be a decision. */
const HOLD_MS = 1500
/** How far the contents compress at full charge. */
const SQUEEZE = 0.12

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
 * Linear was the honest readout and the wrong feeling — a constant crawl reads
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
 * so the hold takes the 1500ms it says it does either way.
 */
const charge = (t: number) => t ** 1.75

/** Points sampled down the edge. Enough that the curve reads as a curve. */
const EDGE_STEPS = 20

/**
 * How far the front bows out of vertical, as a share of the button's width.
 *
 * Measured, not chosen. `clip-path` percentages are of the box, and this box
 * is about three times wider than it is tall — so a bow written as a flat
 * percentage of the width gets a fraction of the height to bend across and
 * arrives looking perfectly straight. A hard-coded 5% here worked out at four
 * pixels of travel over thirty-two of height, which is vertical to the eye.
 *
 * Half the height is the pill's own cap radius, so a bow of that size is the
 * front carrying exactly the curvature of the cap it is leaving and the one it
 * is closing into. That is the shape the button already has, rather than an
 * arc picked to look about right at one particular size.
 */
const bowFor = (w: number, h: number) => (w > 0 ? ((h / 2) / w) * 100 : 0)

/**
 * The charge, clipped by a front that is the pill's own cap.
 *
 * The front is one arc of exactly the cap radius, travelling from the left cap
 * to the right one. That is what makes the curvature right rather than
 * approximately right: at rest it lies precisely on the button's left edge, so
 * it covers nothing; at the end it lies precisely on the right edge, so it
 * covers everything and the last thing you see is the fill tracing the cap
 * instead of stopping flat against it. In between the bow eases through zero,
 * so the front stands straight exactly where the pill's own sides are
 * straight. Nothing here is a bump added on top of the shape — it is the shape.
 *
 * The profile is a true semicircle, not a sine. A sine of the same depth is
 * noticeably more pointed through the quarter heights, which reads as a bulge
 * travelling across the button rather than as the button's corner sliding
 * along it.
 *
 * The centre runs between the two cap centres rather than 0 to 100, because
 * those are the positions at which the arc coincides with each edge. Both
 * endpoints then fall out exactly, with no fudge at either end.
 */
function chargeFront(p: number, amp: number): { clip: string; reach: number } {
  /*
   * The bow saturates rather than ramping.
   *
   * Straight linear, the deep concave bows all happen in the first fifth of
   * the hold — while the fill is still buried in the left cap and there is
   * nothing to see. By the time any of it is on screen the concave side has
   * already faded to almost nothing, so the charge read as starting flat and
   * only becoming curved on the convex half. Pulling the magnitude up with a
   * root makes both halves equally shaped over the part you actually watch,
   * while `p = 0.5` stays exactly straight and both ends stay exactly on the
   * cap.
   */
  const away = 2 * p - 1
  const bow = Math.sign(away) * Math.abs(away) ** 0.45 * amp
  const centre = amp + p * (100 - 2 * amp)

  /*
   * Sampled evenly around the arc, not evenly down the button. A circle's ends
   * turn fastest, so stepping uniformly through the height spent over half the
   * first step's worth of curvature in one straight chord — a visible diagonal
   * facet cutting the corner off the fill. Walking the angle instead spaces
   * the points along the curve, so the ends come out as round as the middle.
   */
  const edge: string[] = []
  for (let i = 0; i <= EDGE_STEPS; i++) {
    const angle = -Math.PI / 2 + (Math.PI * i) / EDGE_STEPS
    const x = centre + bow * Math.cos(angle)
    const y = 50 + 50 * Math.sin(angle)
    edge.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`)
  }

  /*
   * How far right the clip actually reaches, which is not the same as how far
   * along the charge is. While the front is concave its furthest point is the
   * centre, at the top and bottom; once convex it is the centre plus the bow,
   * at mid-height. The colour ramp is sized to this rather than to the raw
   * progress — sized to progress it stopped short of its own clip, and the
   * strip between the two got the grey gloss with no red beneath it. That was
   * the dark wedge sitting on the front, worst at the very start where the
   * gap is widest.
   */
  return { clip: `polygon(0% 0%, ${edge.join(', ')}, 0% 100%)`, reach: centre + Math.max(0, bow) }
}

type Phase = 'idle' | 'holding' | 'fired'

export function HoldButton({
  icon,
  label,
  hint,
  onHold,
  spinIcon = false,
  className = '',
}: {
  icon: ReactNode
  label: string
  /** what the hold is for; shown as the tooltip alongside the hold instruction */
  hint: string
  onHold: () => void
  /**
   * Turn the glyph through a full revolution across the hold.
   *
   * Opt-in, because it only means anything when the icon is itself about
   * turning — on Start over the arrow winds all the way round and lands where
   * it began, which is the action drawn out in miniature. On a glyph with a
   * fixed upright, spinning it would just be a glyph spinning.
   */
  spinIcon?: boolean
  className?: string
}) {
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  /* the bow is a share of the width but is drawn across the height, so it can
     only be worked out from the box the button actually occupies */
  const btnRef = useRef<HTMLButtonElement>(null)
  const [bow, setBow] = useState(0)
  const [nudge, setNudge] = useState(false)
  const taps = useRef({ n: 0, at: 0 })
  /*
   * Completed holds, and the reason the icon never rewinds.
   *
   * Resetting the rotation to zero after a turn looked like the arrow
   * *unwinding* — the transition that makes an abandoned hold spring back was
   * happily animating the full 360 in reverse. Counting turns instead means
   * the angle only ever grows: a finished hold banks its revolution, and the
   * frame after is the same angle it already sat at, so there is nothing to
   * animate. Abandoning still unwinds, because that genuinely is going back.
   */
  const [turns, setTurns] = useState(0)
  const raf = useRef(0)
  const start = useRef(0)
  /* keydown repeats while a key is held, so the first one owns the charge */
  const keyHeld = useRef(false)
  /* read by the handlers, which would otherwise close over a stale phase */
  const phaseRef = useRef<Phase>('idle')
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
     * otherwise land here and reset the state out from under the pop — the
     * animation would be cut off a frame or two in, every single time.
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
      const p = Math.min(1, (now - start.current) / HOLD_MS)
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
  }, [onHold, stop])

  useEffect(() => {
    const el = btnRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setBow(bowFor(r.width, r.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // a hold interrupted by the tab going away should not survive the trip
  useEffect(() => {
    const onBlur = () => cancel()
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      cancelAnimationFrame(raf.current)
    }
  }, [cancel])

  const fired = phase === 'fired'
  const holding = phase === 'holding'

  /*
   * Charging is driven frame by frame so it can be abandoned at any point;
   * the release is a transition, so letting go springs back rather than
   * snapping. `fired` runs the pop, and the animation's end resets the state.
   */
  /* raw `progress` is the clock; `p` is what the eye is shown */
  const p = fired ? 1 : charge(progress)
  const scale = fired ? 1 : 1 - SQUEEZE * p
  const front = chargeFront(p, bow)

  /*
   * One full turn, counter-clockwise to match the arrow's own direction, and
   * held at the full -360 while the pop runs. A revolution is congruent with
   * where it started, so when the state resets to zero there is nothing to
   * see — it lands rather than snapping back. Abandon the hold and it unwinds
   * on the same transition as everything else, which is the charge visibly
   * running backwards out of it.
   */
  const spin = spinIcon ? -(turns * 360 + 360 * p) : 0

  /*
   * The button is pressed *into* the panel as it charges — an inset shadow
   * deepening with progress — while an outer glow builds around it. Read
   * together they are one thing gathering energy: the surface gives under the
   * pressure, and what it is storing leaks out at the edges. The pop then
   * discharges both, so the release is the energy going rather than a style
   * simply being switched off.
   */
  const pressure = holding
    ? `0 0 ${(3 + p * 20).toFixed(1)}px color-mix(in srgb, var(--danger) ${Math.round(
        p * 42,
      )}%, transparent), inset 0 1px ${(1 + p * 3).toFixed(1)}px rgb(0 0 0 / ${(
        0.08 +
        p * 0.26
      ).toFixed(3)})`
    : undefined

  return (
    /*
     * The button clips its own contents to the pill, so the hint cannot live
     * inside it. A wrapper gives both something to be positioned against, and
     * DOM order does the layering: the hint is painted first and the button's
     * opaque fill covers it until it has travelled far enough to clear.
     */
    <span className="relative inline-flex shrink-0">
      {nudge && (
        <span
          aria-hidden
          onAnimationEnd={() => setNudge(false)}
          className="hold-hint pointer-events-none absolute bottom-full left-1/2 z-0 whitespace-nowrap rounded-full border border-(--line) bg-(--raised) px-2.5 py-1 t-caption text-(--tx2)"
        >
          Press and hold
        </span>
      )}
      <button
        ref={btnRef}
      onPointerDown={(e) => {
        // primary button only; a right-click should not arm anything
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        begin()
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      /* keyboard parity: hold Space or Enter, release to abandon */
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return
        e.preventDefault()
        if (keyHeld.current) return
        keyHeld.current = true
        begin()
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') cancel()
      }}
      onAnimationEnd={() => {
        // bank the revolution as the charge resets, so the two cancel exactly
        // and the arrow does not move on this frame
        setTurns((t) => (t + 1) % 1000)
        setPhase('idle')
        setProgress(0)
      }}
      style={{ boxShadow: pressure }}
      title={`${hint} — press and hold`}
      aria-label={`${label}. Press and hold to confirm.`}
      className={`relative isolate flex h-8 shrink-0 items-center gap-1.5 overflow-hidden rounded-full bg-(--field) px-3 t-body-sm text-(--tx2) select-none hover:bg-(--field-h) hover:text-(--tx) ${
        fired ? 'hold-pop' : ''
      } ${className}`}
    >
      {/*
        The charge, revealed by a clip rather than a scale. Scaling stretched
        the gradients with it — the ramp flattened out and the top highlight
        smeared — so the fill is painted full width and uncovered, which keeps
        every one of its layers the shape it was drawn at.
      */}
      <span
        /*
         * Keyed on the turn count so a completed hold remounts it. A fresh
         * element has no previous value to animate from, which is what stops
         * the reset being visible: without it the clip raced back across the
         * button as the opacity came up, and you saw the fill drain out
         * backwards under the pop.
         */
        key={turns}
        aria-hidden
        style={{
          clipPath: front.clip,
          /*
           * The horizontal ramp is sized to the charge, so its hot end always
           * lands on the clip. Spanning the whole button instead left the
           * brightest part out beyond the edge, unreachable until the very
           * end, and the front had no heat on it for most of the travel.
           */
          ['--charge' as string]: `${front.reach.toFixed(2)}%`,
          /*
           * Nothing at all when there is no charge.
           *
           * At rest the clip traces the button's left cap, which encloses no
           * area inside the pill — but the clip and the parent's rounded
           * corner are rasterised independently, so the two anti-aliased
           * curves do not quite cancel and a sub-pixel arc of the fill's top
           * highlight showed at the caps of an idle button. Geometry alone
           * could not settle it; not painting is unambiguous. It shares the
           * retract transition, so letting go still fades rather than blinks.
           */
          opacity: fired || p <= 0 ? 0 : 1,
        }}
        className={`hold-fill absolute inset-0 -z-10 ${
          holding
            ? ''
            : fired
              ? /* full and dissolving: the charge is spent, not withdrawn */
                'transition-opacity duration-300 ease-out'
              : 'transition-[clip-path,opacity] duration-200 ease-out'
        }`}
      />
      <span
        style={{ transform: `scale(${scale})` }}
        className={`relative flex items-center gap-1.5 ${
          holding ? '' : 'transition-transform duration-200 ease-out'
        }`}
      >
        <span
          style={{ transform: `rotate(${spin.toFixed(1)}deg)` }}
          className={`flex ${holding ? '' : 'transition-transform duration-200 ease-out'}`}
        >
          {icon}
        </span>
        {label}
        </span>
      </button>
    </span>
  )
}
