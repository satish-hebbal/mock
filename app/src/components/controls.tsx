import { activeShot } from '../lib/sequence'
import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'
import { useStudio } from '../store'
import { endEditRun } from '../lib/history'
import { KF_MARK } from '../lib/marks'
import { BareSections, SheetActions, useTouchUI } from '../lib/touch'

/*
 * Panel primitives, modelled on Figma's right rail: sentence-case section
 * titles, quiet sub-labels, and fields where a leading icon replaces the label
 * so the value is the loudest thing in the row. Surfaces stay neutral; the blue
 * accent is reserved for "this is on".
 */

// ----- collapsible section -----

export function Section({
  title,
  children,
  defaultOpen = true,
  openWhen,
  badge,
  icon,
  actions,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  /**
   * Something that, whenever it changes to a value at all, opens this section
   * and brings it into view.
   *
   * For sections that are shut by default but hold the controls for a thing
   * you can pick up out on the canvas. Selecting a caption and then hunting
   * down the panel for the fold it lives behind is a step nobody means to
   * take: the selection already said which controls were wanted.
   *
   * Deliberately not a controlled `open`, so the section can still be
   * collapsed by hand afterwards and will stay that way until the next
   * selection.
   */
  openWhen?: string | number | null
  badge?: string
  /** small glyph shown before the section title */
  icon?: ReactNode
  /** trailing controls, aligned with the collapse chevron */
  actions?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const ref = useRef<HTMLElement>(null)
  const touch = useTouchUI()
  const bare = useContext(BareSections)
  const slot = useContext(SheetActions)

  useEffect(() => {
    if (!openWhen) return
    setOpen(true)
    /*
     * After the open, not with it. The body grows over 200ms, so a scroll
     * measured now would be measuring a section that is still 0px tall and
     * would stop short of showing anything inside it.
     */
    const t = setTimeout(
      () => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      220,
    )
    return () => clearTimeout(t)
  }, [openWhen])

  if (bare) {
    return (
      <section ref={ref} className="px-4 pb-4">
        {actions && slot && createPortal(actions, slot)}
        {children}
      </section>
    )
  }

  return (
    <section ref={ref} className="border-b border-(--line)">
      <div className={`flex items-center gap-1 pr-2 ${touch ? 'pl-4' : 'pl-3'}`}>
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className={`flex flex-1 items-center gap-2 text-left ${touch ? 'min-h-12 py-3' : 'py-2.5'}`}
        >
          {icon && <span className="shrink-0 text-(--tx2)">{icon}</span>}
          <span className="t-body-sm font-semibold text-(--tx)">{title}</span>
          {badge && (
            <span className="rounded-xs bg-(--panel3) px-1.5 py-0.5 t-caption font-medium text-(--tx2)">
              {badge}
            </span>
          )}
        </button>
        {actions}
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          className={`flex items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx) ${
            touch ? 'h-10 w-10' : 'h-6 w-6'
          }`}
        >
          <ChevronDown size={13} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
      </div>
      {/*
        The chevron animated and the thing it points at teleported.
        `{open && …}` meant the body was in the DOM or it was not, so a section
        opening shoved everything below it down the panel in a single frame, and
        with several sections in a column the eye loses which one moved and has
        to re-find the control it was reaching for.
        `grid-template-rows` from `0fr` to `1fr` animates to the content's own
        height with no measurement, no ResizeObserver and no magic number that
        breaks the first time a section gains a row. The inner div must own the
        `min-height: 0`, or the grid refuses to size it below its content and
        nothing moves at all.
      */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        {/*
          `inert` because the body is now always mounted, and clipping it with
          `overflow: hidden` hides it from the eye but not from Tab. Without
          this, collapsing a section would quietly leave its controls in the
          focus order: the keyboard would walk into a closed section and the
          focus ring would disappear off the bottom of a 0px-tall box.
        */}
        <div className="min-h-0 overflow-hidden" inert={!open}>
          {/* padding lives inside the clipped box, so it collapses with it
              rather than leaving a stubborn gap when the section is shut */}
          <div className={touch ? 'px-4 pb-4' : 'px-3 pb-3'}>{children}</div>
        </div>
      </div>
    </section>
  )
}

/**
 * An explanation, folded into a dot.
 *
 * A panel this dense cannot afford standing prose. A paragraph under a section
 * heading is read once, on the first visit, and then costs a fixed slice of the
 * panel forever after: on a 280px column two lines of caption push a control
 * group off the bottom of the page, so the price of explaining one thing is not
 * being able to see another. The text is worth having and worth hiding.
 *
 * Opens on hover and on focus, and toggles on click, because a dot that only
 * answers to a pointer is not available to a keyboard or to touch.
 *
 * Positioned `fixed` from a measured rect rather than absolutely inside the
 * panel. Both panel pages scroll, and an element that scrolls on one axis
 * clips the other, so an absolutely positioned bubble would be cut off at the
 * panel's edge exactly when it has something to say.
 *
 * `fixed` is not enough on its own, though, and this is the part that is easy
 * to get wrong twice. The panel that holds the Surprise me notch cuts its shape
 * with `clip-path`, and a clip-path clips every descendant, whatever its
 * position: viewport coordinates do not buy an escape from it the way they buy
 * an escape from `overflow`. A bubble rendered in place came out sliced down
 * the panel's right edge, three words wide. So it goes through a portal to the
 * body, which is the only way out of an ancestor's clip.
 */
/** Breathing room the bubble keeps from the edge of the window. */
const EDGE = 8

export function InfoTip({ children, label = 'What is this?' }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ x: number; y: number; flip: boolean; below?: boolean } | null>(null)
  /** how far the bubble had to move to stay on screen, in pixels */
  const [lift, setLift] = useState(0)

  const touch = useTouchUI()
  const open = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setLift(0)
    /*
     * On a phone there is no room beside the dot on either side, so the bubble
     * drops under it instead, slid along to stay inside the screen.
     */
    if (touch) {
      const x = Math.min(Math.max(EDGE, r.right - 240), window.innerWidth - EDGE - 240)
      setAt({ x, y: r.bottom + 6, flip: false, below: true })
      return
    }
    const flip = r.right + 248 > window.innerWidth
    setAt({ x: flip ? r.left - 8 : r.right + 8, y: r.top + r.height / 2, flip })
  }
  const close = () => setAt(null)

  /*
   * A dot near the bottom of the panel centres a bubble that runs off the
   * bottom of the window, which is the same "cut off mid-sentence" failure the
   * portal fixes on the other axis. The height is only knowable once it has
   * text in it, so it is measured and nudged before the browser paints.
   */
  useLayoutEffect(() => {
    if (!at || at.below) return
    const h = bubble.current?.offsetHeight ?? 0
    const top = at.y - h / 2
    const lowest = Math.max(EDGE, window.innerHeight - EDGE - h)
    setLift(Math.min(Math.max(top, EDGE), lowest) - top)
  }, [at])

  useEffect(() => {
    if (!at) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // the dot is inside dialogs and panels that also answer to Escape, and
      // closing the bubble is the smaller, nearer thing the key should do first
      e.stopImmediatePropagation()
      close()
    }
    /*
     * A tap anywhere else puts it away. Blur cannot be relied on for that:
     * Safari never focuses a button it was tapped on, so it never blurs one
     * either, and the bubble would stay up until the next scroll.
     */
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('keydown', onKey, true)
    // a scroll moves the button out from under a bubble measured against the
    // old position, so the honest thing is to drop it rather than chase it
    window.addEventListener('scroll', close, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [at])

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-expanded={!!at}
        /*
         * Hover is a mouse's idea. A finger fires enter and leave around every
         * tap, which opened the bubble on the way down and the click then shut
         * it again, so a tap looked like it did nothing.
         */
        onPointerEnter={(e) => e.pointerType === 'mouse' && open()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && close()}
        onFocus={touch ? undefined : open}
        onBlur={close}
        onClick={(e) => {
          e.stopPropagation()
          if (at) close()
          else open()
        }}
        className={`flex shrink-0 items-center justify-center rounded-xs text-(--tx3) transition-colors hover:text-(--tx) ${
          touch ? 'h-10 w-10' : 'h-6 w-6'
        }`}
      >
        <Info size={13} strokeWidth={1.9} />
      </button>
      {at &&
        createPortal(
          <div
            ref={bubble}
            role="tooltip"
            style={{
              left: at.x,
              top: at.y,
              transform: at.below
                ? undefined
                : `translate(${at.flip ? '-100%' : '0'}, calc(-50% + ${lift}px))`,
            }}
            className="pointer-events-none fixed z-[60] max-w-[240px] rounded-md border border-(--line) bg-(--raised) px-2.5 py-2 t-caption leading-snug text-(--tx2) shadow-lg"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}

/** Quiet label above a cluster of fields ("Alignment", "Lighting", …). */
export function SubHeading({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <p className="mb-1.5 flex items-center gap-1.5 t-caption text-(--tx2)">
      {icon}
      {children}
    </p>
  )
}

// ----- keyframe diamond -----

export function KFDiamond({ target }: { target: string }) {
  const touch = useTouchUI()
  const timeMs = useStudio((s) => s.timeMs)
  const hasTrack = useStudio((s) => activeShot(s.project).keyframes.some((k) => k.target === target))
  const hasHere = useStudio((s) =>
    activeShot(s.project).keyframes.some((k) => k.target === target && Math.abs(k.timeMs - timeMs) <= 1),
  )
  const toggleTrack = useStudio((s) => s.toggleTrack)
  const addKeyframeAt = useStudio((s) => s.addKeyframeAt)
  const removeKeyframes = useStudio((s) => s.removeKeyframes)
  const kfs = useStudio((s) => activeShot(s.project).keyframes)

  const onClick = () => {
    if (!hasTrack) {
      toggleTrack(target)
      return
    }
    if (hasHere) {
      const ids = kfs
        .filter((k) => k.target === target && Math.abs(k.timeMs - timeMs) <= 1)
        .map((k) => k.id)
      // removing the last keyframe kills the track (bake handled by toggle)
      const trackCount = kfs.filter((k) => k.target === target).length
      if (trackCount <= ids.length) toggleTrack(target)
      else removeKeyframes(ids)
    } else {
      addKeyframeAt(target)
    }
  }

  return (
    <button
      onClick={onClick}
      aria-label={hasTrack ? (hasHere ? 'Remove keyframe' : 'Add keyframe at playhead') : 'Animate this property'}
      aria-pressed={hasTrack}
      title={hasTrack ? (hasHere ? 'Remove keyframe' : 'Add keyframe at playhead') : 'Animate this property'}
      // a fingertip gets a target the size of a fingertip round the same mark
      className={`flex shrink-0 items-center justify-center ${touch ? '-ml-2 h-10 w-8' : 'h-4 w-4'}`}
    >
      <span
        className={`${KF_MARK} ${
          hasHere
            ? 'bg-(--accent)'
            : hasTrack
              ? 'border border-(--accent) bg-transparent'
              : 'border border-(--tx3) bg-transparent hover:border-(--tx2)'
        }`}
      />
    </button>
  )
}

// ----- numeric field (icon + value, drag to scrub, click to type) -----

/** decimals implied by the step, so scrubbing doesn't produce 0.30000000004 */
function decimalsFor(step: number) {
  if (step >= 1) return 0
  const s = String(step)
  return s.includes('.') ? Math.min(4, s.split('.')[1].length) : 2
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  target,
  format = (v) => v.toFixed(step >= 1 ? 0 : 2),
  hint,
  icon,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  /** animatable target path → renders a KF diamond */
  target?: string
  format?: (v: number) => string
  hint?: string
  /** small glyph shown before the label */
  icon?: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const scrubbing = useRef(false)
  const touch = useTouchUI()
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  const dec = decimalsFor(step)

  const clamp = (v: number) => Math.min(max, Math.max(min, Number(v.toFixed(dec))))
  const startEdit = () => {
    setDraft(format(value))
    setEditing(true)
  }
  const commit = () => {
    const v = Number(draft)
    if (Number.isFinite(v)) onChange(clamp(v))
    setEditing(false)
    endEditRun()
  }

  /*
   * Figma-style relative scrub: drag anywhere on the field, ~180px covers the
   * full range; a click that never moved opens the value for typing instead.
   *
   * Accumulated from `movementX` rather than from `clientX - startX`, so the
   * number tracks how far the hand has travelled rather than where it happens
   * to be over the row.
   *
   * This used to take a pointer lock as well, which made the travel unbounded:
   * with the cursor hidden there is no screen edge to run out of. The browser
   * charges too much for that. Chrome and every Chromium relative put a banner
   * across the top of the window on *every* lock, "press Esc to show your
   * cursor", which is a modal-looking interruption over the artwork each time
   * anybody nudges a slider, and there is no way for a page to decline it. A
   * scrub that stops at the bezel is a much smaller problem: the gesture is
   * relative, so letting go and dragging again picks up from the value you
   * reached, and the arrow keys and the typed value are still there for the
   * rest. So: no lock, and no banner.
   */
  /*
   * A finger, in a panel that scrolls.
   *
   * The mouse scrub above cannot work here. `movementX` is zero or missing for
   * touch in Safari, and taking the pointer on contact would steal every
   * vertical swipe that happened to start on a slider, which in a column of
   * sliders is most of them. So the gesture waits to see which way it is
   * going: up or down belongs to the page (`touch-action: pan-y` lets the
   * browser have it, and it cancels us), sideways belongs to the slider.
   *
   * The drag is relative, not absolute. Putting a finger down never jumps the
   * value to where it landed, because on a 40px-tall row that is where the
   * finger lands while scrolling too. The track's full width is the full range,
   * so the handle stays under the finger that is moving it.
   */
  const onTouchDown = (e: React.PointerEvent) => {
    if (editing) return
    const el = e.currentTarget as HTMLElement
    const width = Math.max(1, el.getBoundingClientRect().width)
    const startX = e.clientX
    const startY = e.clientY
    const startV = value
    let phase: 'wait' | 'drag' = 'wait'

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (phase === 'wait') {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) return end()
        if (Math.abs(dx) < 6) return
        phase = 'drag'
        scrubbing.current = true
        el.setPointerCapture(ev.pointerId)
      }
      onChange(clamp(startV + (dx / width) * (max - min)))
    }
    const onUp = () => {
      const tapped = phase === 'wait'
      end()
      if (tapped) startEdit()
    }
    const end = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', end)
      if (phase === 'drag') endEditRun()
      scrubbing.current = false
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', end)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (touch && e.pointerType !== 'mouse') return onTouchDown(e)
    if (editing || e.button !== 0) return
    const startV = value
    const perPx = (max - min) / 180
    let moved = false
    let dx = 0
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    scrubbing.current = true

    const onMove = (ev: PointerEvent) => {
      dx += ev.movementX
      if (Math.abs(dx) > 2) moved = true
      if (!moved) return
      onChange(clamp(startV + dx * perPx * (ev.shiftKey ? 0.2 : 1)))
    }
    const onUp = () => {
      el.releasePointerCapture(e.pointerId)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      scrubbing.current = false
      // the drag is over: whatever comes next is a separate undo step, without
      // having to wait out the coalescing window
      endEditRun()
      if (!moved) startEdit()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const nudge = e.shiftKey ? step * 10 : step
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp(value + nudge))
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp(value - nudge))
    else if (e.key === 'Enter') startEdit()
    else return
    e.preventDefault()
  }

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {/*
       * The diamond's gutter exists only when there is a timeline to put a key
       * on. Reserving it either way indented every slider in the tools that
       * have no keyframes at all, against colour rows that start at the panel
       * edge. Nothing needs to line up across that boundary: the rows that
       * animate are grouped together (the whole camera, a whole transform), so
       * within any one group the gutter is either there for all of them or for
       * none.
       */}
      {target && <KFDiamond target={target} />}
      <div
        role="slider"
        tabIndex={editing ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={format(value)}
        title={hint ?? label}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        /*
         * The row is a scrub target that looked identical whether or not the
         * pointer was on it, so the only way to discover it was draggable was to
         * press it and see. `cursor-ew-resize` said so, but a cursor is the one
         * affordance you cannot notice without already being over the thing.
         * Hover lifts the field and the handle. Deliberately not the filled
         * portion: the tokens either side of `--sel` step *up* the ladder on
         * dark and *down* on light, so any fixed hover colour for the fill
         * brightens it in one theme and dulls it in the other. The track and the
         * handle both have a token that moves the right way in both, and two
         * things moving is already more than enough signal.
         */
        className={`group relative flex-1 overflow-hidden bg-(--field) transition-colors select-none hover:bg-(--field-h) focus:ring-2 focus:ring-(--focus) focus:outline-none ${
          touch ? 'h-11 touch-pan-y rounded-md' : 'h-7 cursor-ew-resize rounded-sm'
        }`}
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-sm bg-(--sel)"
          style={{ width: `${pct}%` }}
        />
        <div
          className={`pointer-events-none absolute top-1/2 w-0.5 -translate-y-1/2 rounded-full transition-colors group-hover:bg-(--tx) ${
            touch ? 'h-5 bg-(--tx)' : 'h-3 bg-(--tx2)'
          }`}
          style={{ left: `calc(${pct}% - 6px)` }}
        />
        <div className={`absolute inset-0 flex items-center justify-between gap-2 ${touch ? 'px-3.5' : 'px-2.5'}`}>
          <span className="flex min-w-0 items-center gap-1.5 t-body-sm text-(--tx2)">
            {icon && <span className="shrink-0">{icon}</span>}
            <span className="truncate">{label}</span>
          </span>
          {editing ? (
            <input
              autoFocus
              inputMode="decimal"
              onFocus={(e) => e.currentTarget.select()}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
                e.stopPropagation()
              }}
              className="w-14 shrink-0 rounded-xs border border-(--line2) bg-(--raised) px-1 text-right t-body-sm text-(--tx) tabular-nums outline-none"
            />
          ) : (
            <span className="shrink-0 t-body-sm text-(--tx) tabular-nums">{format(value)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ----- segment tabs -----

/**
 * The sliding selection pill for an equal-width segmented row.
 *
 * Painting the active background on the button itself makes selection *jump*:
 * one pill vanishes and another appears, and nothing connects them. A single
 * pill that travels tells you where the selection went, which matters most on
 * the row you use least, where the labels haven't been memorised yet.
 *
 * The geometry is derived rather than measured. Both callers lay their options
 * out as equal columns with a 2px gap, so cell width is `(track - gaps) / n` and
 * each step is exactly one cell plus one gap. Percentages in `translateX`
 * resolve against the element's own width, so "move one cell" is literally
 * `100% + 2px`, and it stays correct at any container width with no
 * ResizeObserver and no layout read.
 */
export function SegmentThumb({
  count,
  index,
  radius = 'rounded-xs',
}: {
  count: number
  index: number
  /** match the row's own corner radius */
  radius?: string
}) {
  if (index < 0) return null // nothing selected: no pill rather than a stray one
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 bg-(--sel) transition-transform duration-200 ease-out motion-reduce:transition-none ${radius}`}
      style={{
        width: `calc((100% - ${4 + 2 * (count - 1)}px) / ${count})`,
        transform: `translateX(calc(${index} * (100% + 2px)))`,
      }}
    />
  )
}

export function Segments<T extends string>({
  options,
  value,
  onChange,
  compact = false,
}: {
  /** an `icon` turns the tab into a glyph-only button with the label as tooltip */
  options: { id: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (v: T) => void
  /** a shorter, smaller-type row for a toggle that's a detail, not a main setting */
  compact?: boolean
}) {
  const touch = useTouchUI()
  return (
    <div
      className={`relative grid gap-0.5 rounded-sm bg-(--field) p-0.5 ${compact ? 'mb-1.5' : 'mb-2'}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      <SegmentThumb count={options.length} index={options.findIndex((o) => o.id === value)} />
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          aria-label={o.label}
          title={o.label}
          className={`relative z-10 flex items-center justify-center gap-1 truncate rounded-xs px-1.5 transition-colors ${
            touch ? (compact ? 'h-9 t-body-sm' : 'h-10 t-body-sm') : compact ? 'h-5 t-caption' : 'h-6 t-body-sm'
          } ${value === o.id ? 'text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'}`}
        >
          {o.icon ?? o.label}
        </button>
      ))}
    </div>
  )
}

/** Icon-only toggle, Figma's on/off chip (accent = on). */
export function IconToggle({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  onClick: () => void
}) {
  const touch = useTouchUI()
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex items-center justify-center rounded-xs transition-colors ${touch ? 'h-10 w-10' : 'h-6 w-6'} ${
        active
          ? 'bg-(--sel) text-(--tx)'
          : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
      }`}
    >
      {icon}
    </button>
  )
}

// ----- dropdown (replaces native <select>, which can't be themed) -----

interface DropdownProps<T extends string | number> {
  value: T
  /** an `icon` is drawn ahead of the label, in the trigger and the list alike */
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (v: T) => void
  title?: string
  className?: string
  /** which edge the menu lines up with when it would overflow a narrow panel */
  align?: 'left' | 'right'
}

export function Dropdown<T extends string | number>(props: DropdownProps<T>) {
  return useTouchUI() ? <NativeDropdown {...props} /> : <PointerDropdown {...props} />
}

/*
 * On a phone the platform's own picker is the better list: it is thumb-sized,
 * scrolls with inertia, and on iOS it is a wheel at the bottom of the screen
 * rather than a menu hanging off a row in a sheet that is itself scrolling.
 * The trigger is still ours, so the row looks like every other field, with the
 * real select laid invisibly over it to catch the tap.
 */
function NativeDropdown<T extends string | number>({
  value,
  options,
  onChange,
  title,
  className = '',
}: DropdownProps<T>) {
  const current = options.find((o) => o.value === value)
  return (
    <div className={`relative ${className}`}>
      <div className="flex h-11 w-full items-center gap-2 rounded-md bg-(--field) px-3 t-body-sm text-(--tx)">
        {current?.icon && <span className="shrink-0 text-(--tx2)">{current.icon}</span>}
        <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? '—'}</span>
        <ChevronDown size={14} className="shrink-0 text-(--tx3)" />
      </div>
      <select
        aria-label={title}
        value={options.findIndex((o) => o.value === value)}
        onChange={(e) => onChange(options[Number(e.target.value)].value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {options.map((o, i) => (
          <option key={String(o.value)} value={i}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function PointerDropdown<T extends string | number>({
  value,
  options,
  onChange,
  title,
  className = '',
  align = 'left',
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  const toggle = () => {
    if (!open) {
      // open toward whichever side has room: the timeline sits at the bottom
      const r = ref.current?.getBoundingClientRect()
      const below = window.innerHeight - (r?.bottom ?? 0)
      setDropUp(below < 220 && (r?.top ?? 0) > below)
    }
    setOpen(!open)
  }

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        className="flex h-7 w-full items-center gap-1.5 rounded-sm bg-(--field) px-2 t-body-sm text-(--tx) hover:bg-(--field-h)"
      >
        {current?.icon && <span className="shrink-0 text-(--tx2)">{current.icon}</span>}
        <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? '—'}</span>
        <ChevronDown size={12} className={`shrink-0 text-(--tx3) ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          className={`absolute z-50 max-h-64 min-w-full overflow-y-auto rounded-sm border border-(--line) bg-(--raised) p-1 ${
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
          } ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {options.map((o) => (
            <button
              key={String(o.value)}
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left t-body-sm whitespace-nowrap ${
                o.value === value
                  ? 'bg-(--sel) text-(--tx)'
                  : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
              }`}
            >
              {o.icon && <span className="shrink-0">{o.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ----- color row -----

export function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const touch = useTouchUI()
  return (
    <label
      title={label}
      className={`relative my-0.5 flex items-center gap-2 bg-(--field) hover:bg-(--field-h) ${
        touch ? 'h-11 rounded-md px-3' : 'h-7 rounded-sm px-2'
      }`}
    >
      <span
        className={`relative shrink-0 overflow-hidden rounded-md ${touch ? 'h-6 w-6' : 'h-4 w-4'}`}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="absolute -inset-1 cursor-pointer"
        />
      </span>
      <span className="t-mono text-(--tx) uppercase tabular-nums">{value.replace('#', '')}</span>
      <span className="ml-auto truncate t-caption text-(--tx3)">{label}</span>
    </label>
  )
}

/**
 * A labelled fold for controls that most shots never touch.
 *
 * The panel's default is to show everything, which is right when every row is
 * something you reach for. It stops being right when a rarely-used group sits
 * between two common ones and pushes the common one off-screen, so this exists
 * for that case only.
 */
export function Disclosure({
  label,
  icon,
  open,
  onToggle,
  actions,
  children,
}: {
  label: string
  icon?: ReactNode
  open: boolean
  onToggle: (v: boolean) => void
  /**
   * Controls for the group, sat beside the fold rather than inside it.
   *
   * A sibling of the toggle and not a child of it, because a button inside a
   * button is invalid markup that browsers resolve by dropping the inner one,
   * and because an action that only appears once you have opened the fold is
   * an action for people who already found what they wanted.
   */
  actions?: ReactNode
  children: ReactNode
}) {
  const touch = useTouchUI()
  return (
    <div className="mb-1">
      {/* the header is a SubHeading that grew a caret, so a foldable group and
          a plain one still read as the same rank in the panel */}
      <div className={`mb-1.5 flex items-center gap-1 ${touch ? 'h-10' : 'h-6'}`}>
        <button
          onClick={() => onToggle(!open)}
          aria-expanded={open}
          className={`flex min-w-0 flex-1 items-center gap-1.5 t-caption text-(--tx2) hover:text-(--tx) ${
            touch ? 'h-10' : 'h-6'
          }`}
        >
          <ChevronRight
            size={11}
            strokeWidth={2.2}
            className={`shrink-0 text-(--tx3) transition-transform ${open ? 'rotate-90' : ''}`}
          />
          {icon}
          {label}
        </button>
        {actions}
      </div>
      {open && children}
    </div>
  )
}

// ----- small button -----

export function MiniButton({
  children,
  onClick,
  active,
  title,
}: {
  children: ReactNode
  onClick: () => void
  active?: boolean
  title?: string
}) {
  const touch = useTouchUI()
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`inline-flex items-center justify-center gap-1.5 truncate t-body-sm transition-colors ${
        touch ? 'h-10 rounded-md px-3' : 'h-7 rounded-sm px-2'
      } ${
        active
          ? 'bg-(--sel) text-(--tx)'
          : 'bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
      }`}
    >
      {children}
    </button>
  )
}
