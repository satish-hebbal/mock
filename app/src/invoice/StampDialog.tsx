/**
 * Marking an invoice.
 *
 * This is the one moment in the tool that is worth spending motion on, and it
 * is worth it for a reason that is not decoration: marking an invoice paid is
 * the only irreversible-feeling thing here, it happens once per document, and
 * it is the happy ending of the whole exercise. Everything else in this editor
 * is typing into fields.
 *
 * ----- why a roller and not a date field -----
 *
 * The date is almost never today. It is the day the money actually landed,
 * which is a day or three back, and picking a nearby day is exactly what a
 * wheel is good at: it opens on today, and the day you want is one flick away
 * with no dialog, no month grid and no parsing of what the user typed. A
 * calendar would be the right control for picking a date months out; this one
 * is for picking a date near the one already shown.
 *
 * The wheels are real scroll containers with CSS snap, not a transform driven
 * by pointer maths. That buys the platform's own inertia, its own rubber
 * banding, trackpad and wheel and touch all at once, and keyboard support for
 * free, none of which a hand-rolled drag gets right. What is hand-rolled is
 * only the part CSS cannot express: the continuous distance from the centre,
 * which is what blurs and fades the neighbours.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Scrim } from '../components/Overlay'
import { NotchedFrame } from '../components/NotchedCanvas'
import { notchForPill } from '../lib/notch'
import { daysInMonth, longDate, toISO } from './money'
import { useInvoice } from './store'
import { STAMP_COLORS, STAMP_KINDS, type StampKind } from './types'

/** Row height, and so the snap interval. Everything else is derived from it. */
const ITEM = 58
/** Rows visible at once: the chosen one, and two either side going out of focus. */
const VISIBLE = 5

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/**
 * One column of the roller.
 *
 * `index` is the source of truth and the scroll position follows it, except
 * while the user is the one scrolling, when it is the other way round. Without
 * that guard the two fight: a scroll fires, the index updates, the effect
 * writes the scroll position back, and the wheel stutters under the finger.
 */
function Wheel({
  values,
  index,
  onIndex,
  label,
  wide,
}: {
  values: string[]
  index: number
  onIndex: (i: number) => void
  label: string
  /** the month and year columns carry more glyphs than the day column */
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  /** continuous position in rows, which is what the blur is measured against */
  const [at, setAt] = useState(index)
  const scrolling = useRef(false)
  const raf = useRef(0)
  const settle = useRef(0)

  /* Follow the index when it was changed from outside (a clamped day, a reset). */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || scrolling.current) return
    const want = index * ITEM
    if (Math.abs(el.scrollTop - want) < 1) return
    el.scrollTop = want
    setAt(index)
  }, [index])

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    scrolling.current = true
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => setAt(el.scrollTop / ITEM))

    /*
     * Snap is done by the browser, so the only thing left is noticing when it
     * has finished. `scrollend` is not everywhere yet, and polling for
     * stillness is the portable version of it: the timer is reset by every
     * scroll event, so it only fires once the wheel has actually stopped.
     */
    clearTimeout(settle.current)
    settle.current = window.setTimeout(() => {
      scrolling.current = false
      const i = Math.round(el.scrollTop / ITEM)
      const clamped = Math.min(values.length - 1, Math.max(0, i))
      if (clamped !== index) onIndex(clamped)
    }, 90)
  }, [index, onIndex, values.length])

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      clearTimeout(settle.current)
    },
    [],
  )

  const pad = (VISIBLE - 1) / 2

  return (
    <div className="relative" style={{ width: wide ? 104 : 84 }}>
      <div
        ref={ref}
        onScroll={onScroll}
        tabIndex={0}
        role="listbox"
        aria-label={label}
        aria-activedescendant={`${label}-${index}`}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          const next = Math.min(
            values.length - 1,
            Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)),
          )
          onIndex(next)
        }}
        className="inv-wheel"
        /*
         * The scroll padding narrows the snapport to the middle row, so the
         * browser snaps a row to the *window* rather than to the top of the
         * scroller. With the two spacer rows below, that makes `scrollTop`
         * exactly `index * ITEM`, which is what the effect above writes.
         */
        style={{ height: ITEM * VISIBLE, scrollPaddingBlock: ITEM * pad }}
      >
        <div style={{ height: ITEM * pad }} />
        {values.map((v, i) => {
          const dist = Math.abs(i - at)
          /*
           * The far rows do not merely fade, they go out of focus, which is
           * what makes the column read as a cylinder turning rather than as a
           * list with an opacity gradient on it. Blur and scale are both
           * clamped so a fast flick cannot smear the whole column into paste.
           */
          const t = Math.min(dist, 2.4)
          return (
            <div
              key={v}
              id={`${label}-${i}`}
              role="option"
              aria-selected={i === index}
              className="inv-wheel-item"
              style={{
                height: ITEM,
                opacity: Math.max(0.12, 1 - t * 0.42),
                filter: t > 0.05 ? `blur(${(t * 1.5).toFixed(2)}px)` : undefined,
                transform: `scale(${1 - Math.min(t, 2) * 0.07})`,
                fontWeight: dist < 0.5 ? 600 : 500,
              }}
            >
              {v}
            </div>
          )
        })}
        <div style={{ height: ITEM * pad }} />
      </div>
    </div>
  )
}

/*
 * ----- the words, in the notch -----
 *
 * Paid, Received, Approved and Due sit in a pocket cut into the roller's top
 * edge, the same negative shape the canvases use for their tools. They are
 * what the date is *for*, so they sit on the thing that picks it rather than
 * in a row of their own underneath.
 *
 * The pocket is sized around the control by the shared rule in `lib/notch`:
 * six points of air all round, and a corner concentric with the control's.
 * The control is given a fixed width so the hole can be cut before anything
 * is measured, with four equal tabs because "Approved" is the widest word and
 * uneven tabs would slide the highlight by different distances.
 */
const KIND_W = 320
const KIND_H = 32
const KIND_NOTCH = notchForPill(KIND_W, KIND_H)
/** the roller's top padding: the pocket, and a step of air under it */
const HEAD = KIND_NOTCH.depth + 8
/**
 * The wheels and the air below them. No DAY / MONTH / YEAR captions: the
 * values name their own columns, and each wheel still carries its name as an
 * aria-label for anyone who cannot see them.
 */
const ROLLER_H = HEAD + ITEM * VISIBLE + 14

function KindTabs({ kind, onKind }: { kind: StampKind; onKind: (k: StampKind) => void }) {
  return (
    <div
      className="relative grid grid-cols-4 gap-0.5 rounded-md p-0.5"
      style={{ width: KIND_W, height: KIND_H }}
    >
      {/*
        `--sel` rather than `--raised`, which is what the rest of the app's
        segmented controls use. On the dark theme `--raised` is a step *down*
        from the field it sits in, so the chosen tab came out darker than its
        neighbours: the highlight was a hole.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-sm bg-(--sel) transition-transform duration-200 ease-[var(--ease-settle)]"
        style={{
          width: `calc((100% - ${4 + 2 * 3}px) / 4)`,
          transform: `translateX(calc(${STAMP_KINDS.findIndex((k) => k.id === kind)} * (100% + 2px)))`,
        }}
      />
      {STAMP_KINDS.map((k) => (
        <button
          key={k.id}
          onClick={() => onKind(k.id)}
          aria-pressed={kind === k.id}
          className={`relative z-10 rounded-sm t-body-sm transition-colors ${
            kind === k.id ? 'text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'
          }`}
        >
          {k.label}
        </button>
      ))}
    </div>
  )
}

export function StampDialog() {
  const doc = useInvoice((s) => s.doc)
  const close = () => useInvoice.getState().setDialog(null)

  const start = doc.stamp.date ? new Date(doc.stamp.date) : new Date()
  const [year, setYear] = useState(() => start.getFullYear())
  const [month, setMonth] = useState(() => start.getMonth())
  const [day, setDay] = useState(() => start.getDate())
  const [kind, setKind] = useState<StampKind>(doc.stamp.kind)
  const [color, setColor] = useState(doc.stamp.color)

  /*
   * Five years back and five forward. An invoice is marked paid within weeks of
   * being issued, so the useful range is tiny; the span exists for the person
   * entering last financial year's records in April, not for time travel.
   */
  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: 11 }, (_, i) => String(thisYear - 5 + i))

  /*
   * A day that no longer exists after the month turns is pulled back to the
   * last one that does. Leaving 31 selected in a 30-day month would produce
   * the 1st of the next month the moment a Date is built from it, which is the
   * kind of bug that only shows up on an invoice somebody has already sent.
   */
  const count = daysInMonth(year, month)
  useEffect(() => {
    if (day > count) setDay(count)
  }, [count, day])

  const days = Array.from({ length: count }, (_, i) => String(i + 1))
  const iso = toISO(new Date(year, month, Math.min(day, count)))

  const apply = () => {
    useInvoice.getState().markStamp(kind, iso, color)
    close()
  }

  const verb = STAMP_KINDS.find((k) => k.id === kind)?.label ?? 'Paid'

  return (
    <Scrim onClose={close} label="Mark this invoice">
      {(dismiss) => (
        <div
          onKeyDown={(e) => {
            /* Enter marks it from anywhere in the dialog, the wheels included,
               since they are focusable and would otherwise swallow it. */
            if (e.key !== 'Enter') return
            e.preventDefault()
            useInvoice.getState().markStamp(kind, iso, color)
            dismiss()
          }}
          className="w-full max-w-lg rounded-2xl border border-(--line) bg-(--raised) p-6 text-center"
        >
          {/* the number, and nothing else: the roller below says what is being
              chosen, and the date line under it says what was */}
          <h2 className="t-headline text-(--tx)">Invoice {doc.number}</h2>

          {/* ----- the roller, with what the mark says cut into its top ----- */}
          {/* the frame's contents sit in an absolute layer, so its height is set
              here, from the same numbers the wheels are built from */}
          <div className="mt-5" style={{ height: ROLLER_H }}>
            <NotchedFrame
              className="h-full"
              surface="bg-(--field)"
              notch={KIND_NOTCH}
              bar={(p) => (
                <div
                  className="absolute top-0 flex items-center justify-center"
                  style={{
                    left: p.centerX - KIND_W / 2,
                    width: KIND_W,
                    height: p.depth,
                  }}
                >
                  <KindTabs kind={kind} onKind={setKind} />
                </div>
              )}
            >
              <div
                className="relative flex items-start justify-center gap-2 px-4"
                style={{ paddingTop: HEAD }}
              >
                {/* the band the chosen row sits in, behind all three columns so
                  it reads as one window cut across the whole roller */}
                <span
                  aria-hidden
                  className="inv-roller-band"
                  style={{
                    height: ITEM - 8,
                    top: HEAD + ((VISIBLE - 1) / 2) * ITEM + 4,
                  }}
                />
                <Wheel
                  label="Day"
                  values={days}
                  index={Math.min(day, count) - 1}
                  onIndex={(i) => setDay(i + 1)}
                />
                <Wheel label="Month" values={MONTHS} index={month} onIndex={setMonth} wide />
                <Wheel
                  label="Year"
                  values={years}
                  index={years.indexOf(String(year))}
                  onIndex={(i) => setYear(Number(years[i]))}
                  wide
                />
              </div>
            </NotchedFrame>
          </div>

          {/*
            The date written out in full, under the wheels that produced it.
            Three columns of abbreviations are quick to operate and easy to
            misread, and this is the line that makes a wrong month obvious
            before the stamp is on the page rather than after.
          */}
          <p key={iso} className="inv-date-read mt-4 t-body-sm font-medium text-(--tx)">
            {longDate(iso)}
          </p>

          {/* ----- the ink ----- */}
          <div className="mt-4 flex items-center justify-center gap-1.5">
            {STAMP_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Stamp in ${c}`}
                aria-pressed={color === c}
                className="inv-ink-dot"
                data-on={color === c || undefined}
                style={{ background: c }}
              >
                {/* a check rather than a ring: white reads on every ink,
                    where a ring in the ink's own colour vanished on the dark
                    one against the dark dialog */}
                <Check size={12} strokeWidth={3} className="inv-ink-check" aria-hidden />
              </button>
            ))}
          </div>

          <button
            onClick={apply}
            className="mt-5 flex h-10 w-full items-center justify-center rounded-md bg-(--accent-fill) t-button text-(--accent-tx) transition-[background-color,transform] duration-150 ease-[var(--ease-settle)] hover:bg-(--accent-fill-hover) active:scale-[0.98]"
          >
            Mark as {verb.toLowerCase()}
          </button>
        </div>
      )}
    </Scrim>
  )
}
