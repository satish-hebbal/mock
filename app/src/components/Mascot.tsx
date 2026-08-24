import { Suspense, lazy, useEffect, useRef, useState } from 'react'

const MascotRive = lazy(() => import('./MascotRive'))

/*
 * The CSS in index.css handles reduced motion for everything that animates in
 * markup, but a Rive canvas draws on its own clock and stylesheets cannot reach
 * it. Asking here means the runtime is never even fetched when motion is
 * unwelcome, which is the honest version of honouring the setting.
 */
const REDUCE = '(prefers-reduced-motion: reduce)'

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCE).matches)

  useEffect(() => {
    const mq = window.matchMedia(REDUCE)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}

/*
 * tod-b.riv paints the frog inside a wide margin. Measured against the artboard
 * box, the idle ink runs 21 to 106 of 128 across and 23 to 100 of 128 down, so
 * the frog covers about two thirds of the square it is handed. frog-logo.svg
 * has no such margin, since its art fills its viewBox. Left alone that costs
 * twice over: the animated frog renders a third smaller than the still one so
 * the cross-fade visibly pops, and the artboard's dead space reads as slack
 * between the mascot and whatever sits beneath it.
 *
 * So the canvas is drawn oversized and nudged until its ink lands where the
 * SVG's ink already is. The layout box then measures the frog rather than the
 * artboard, which is what callers mean by `size`. Re-measure if the .riv is
 * ever re-exported.
 */
const INK = { left: 21 / 128, right: 106 / 128, top: 23 / 128, bottom: 100 / 128 }

function inkFrame(size: number) {
  const box = size / (INK.right - INK.left)
  const slack = (size - box) / 2
  return {
    width: box,
    height: box,
    left: slack + (0.5 - (INK.left + INK.right) / 2) * box,
    top: slack + (0.5 - (INK.top + INK.bottom) / 2) * box,
  }
}

/*
 * How long a pet runs once it has started, however briefly the pointer stayed.
 *
 * A mouse crossing the frog on its way somewhere else, or a finger tapping and
 * lifting, would otherwise flip the state machine to PET and back inside a
 * frame or two: the hearts never leave the frog and the whole thing reads as a
 * glitch. Holding the state open long enough for one to rise turns both into a
 * deliberate-looking reaction. PET loops every 2s, so this is most of a pass.
 */
const MIN_PET_MS = 1200

interface Props {
  size?: number
  className?: string
  /**
   * When to fetch the animation. 'mount' is right where the frog is part of the
   * furniture. 'contact' holds the runtime back until a pointer actually
   * touches the frog, which is what <SmallScreen /> wants: it is a dead end for
   * someone on a phone, and ~815KB of runtime and wasm is a lot to spend on
   * a screen whose whole message is "come back on a laptop". Poke the frog and
   * it wakes; read the note and leave and it never costs anything.
   */
  awaken?: 'mount' | 'contact'
}

/*
 * Tod, idling.
 *
 * Two layers on top of each other rather than one or the other: the flat SVG is
 * the same frog the favicon and the rails use, so it stands in as the poster
 * frame while the Rive chunk loads, and stays put if that load never lands or
 * the animation is turned down. When the artboard is ready the two cross-fade,
 * which reads as the frog waking up instead of a swap.
 *
 * The pointer is reported to the state machine rather than commanded: pointer
 * enter and leave cover mouse hover and touch alike, because a touch pointer is
 * created on touchstart and destroyed on touchend, so a press and hold is the
 * same gesture as a hover without needing a second code path. Petting a frog is
 * a thing you do continuously, so that mapping is the honest one.
 *
 * The <img> keeps the alt text and the canvas is hidden from assistive tech,
 * because the animation is the same frog and announcing it twice would be noise.
 */
export function Mascot({ size = 64, className = '', awaken = 'mount' }: Props) {
  const reduced = usePrefersReducedMotion()
  const [live, setLive] = useState(false)
  const [awake, setAwake] = useState(awaken === 'mount')

  const [touching, setTouching] = useState(false)
  const [settling, setSettling] = useState(false)
  const [pets, setPets] = useState(0)

  /*
   * The floor starts when the frog can actually respond, not when the pointer
   * landed. Under `awaken="contact"` the first press is also what begins the
   * download, so a phone tap can be long over before there is anything to see;
   * keying on `live` means that first tap still gets its pet whenever the
   * runtime arrives. `pets` rather than `touching` in the deps so releasing
   * does not cancel the timer that release is waiting on.
   */
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!pets || !live) return
    setSettling(true)
    timer.current = window.setTimeout(() => setSettling(false), MIN_PET_MS)
    return () => window.clearTimeout(timer.current)
  }, [pets, live])

  const start = () => {
    if (!awake) setAwake(true)
    setTouching(true)
    setPets((n) => n + 1)
  }

  return (
    <span
      className={`relative block shrink-0 touch-manipulation select-none ${className}`}
      style={{ width: size, height: size, WebkitTouchCallout: 'none' }}
      onPointerEnter={start}
      onPointerLeave={() => setTouching(false)}
      onPointerCancel={() => setTouching(false)}
    >
      <img
        src="/frog-logo.svg"
        alt="Ribbit"
        width={size}
        height={size}
        draggable={false}
        className="absolute inset-0 transition-opacity duration-300"
        style={{ opacity: live ? 0 : 1 }}
      />

      {!reduced && awake && (
        <Suspense fallback={null}>
          <span
            className="absolute block transition-opacity duration-300"
            /*
             * The canvas is deliberately wider than the layout box, and pointer
             * enter/leave on a parent counts its descendants, so without this
             * the frog would react to a pointer sitting in the empty overspill,
             * well outside anything the page looks like it can touch.
             */
            style={{ ...inkFrame(size), opacity: live ? 1 : 0, pointerEvents: 'none' }}
          >
            <MascotRive petting={touching || settling} onReady={() => setLive(true)} />
          </span>
        </Suspense>
      )}
    </span>
  )
}
