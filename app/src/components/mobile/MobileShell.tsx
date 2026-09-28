/**
 * The phone layout, shared by every tool that has one.
 *
 * The desktop editors are a picture with panels either side of it. Folding
 * those panels under the picture on a phone gives a 390px column with the
 * artwork squeezed into whatever is left, and every adjustment made blind
 * because the thing being adjusted has scrolled away. So the phone gets its
 * own arrangement, built round four rules:
 *
 *   The picture never leaves.   The canvas takes the top of the screen and is
 *                               re-fitted to the space the sheet leaves it, so
 *                               a slider moved in the sheet is watched working
 *                               on the picture above it.
 *   Choices live at the thumb.  The tabs are a dock on the bottom edge, where a
 *                               thumb already rests; the top bar holds only the
 *                               things pressed once in a while (back, undo,
 *                               export).
 *   One thing at a time.        A tab is one job (colour, shape, finish), so
 *                               the sheet under it is short enough to read
 *                               rather than a scroll of every control there is.
 *   The sheet has three heights. Shut, for looking. Open, for adjusting with
 *                               the picture in view. Full, for browsing a long
 *                               list. It is dragged by its handle, and pressing
 *                               the open tab again shuts it.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronUp, type LucideIcon } from 'lucide-react'
import { useStudio } from '../../store'
import { SheetActions } from '../../lib/touch'

/* --------------------------------------------------------------- pieces */

export function MobileIconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="m-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-(--tx2) transition-colors active:bg-(--panel3) disabled:text-(--tx3) disabled:opacity-50"
    >
      <Icon size={20} strokeWidth={1.8} />
    </button>
  )
}

/** The one button in the top bar that finishes the job: Export, or PDF. */
export function MobilePrimary({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="m-press ml-1 flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-(--accent-fill) px-3.5 t-button text-(--accent-tx) transition-opacity disabled:opacity-40"
    >
      <Icon size={15} strokeWidth={2} />
      {label}
    </button>
  )
}

export function MobileTopBar({
  title,
  subtitle,
  actions,
  primary,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  primary?: ReactNode
}) {
  return (
    <header className="shrink-0 pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-0.5 pr-3 pl-1">
        <MobileIconButton
          icon={ChevronLeft}
          label="All tools"
          onClick={() => useStudio.getState().setMode('home')}
        />
        <div className="min-w-0 flex-1 pl-0.5">
          <p className="truncate t-body font-semibold leading-tight text-(--tx)">{title}</p>
          {subtitle && <p className="truncate t-caption leading-tight text-(--tx3)">{subtitle}</p>}
        </div>
        {actions}
        {primary}
      </div>
    </header>
  )
}

export interface DockTab {
  id: string
  label: string
  icon: LucideIcon
  disabled?: boolean
}

export function MobileDock({
  tabs,
  active,
  lit,
  onPress,
}: {
  tabs: DockTab[]
  active: string
  /** whether the active tab's sheet is showing; a shut sheet leaves the pill off */
  lit: boolean
  onPress: (id: string) => void
}) {
  return (
    <nav className="shrink-0 border-t border-(--line) bg-(--raised) pb-[env(safe-area-inset-bottom)]">
      <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => {
          const on = t.id === active
          return (
            <button
              key={t.id}
              onClick={() => onPress(t.id)}
              disabled={t.disabled}
              aria-pressed={on}
              className={`m-press flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-35 ${
                on ? 'text-(--tx)' : 'text-(--tx3)'
              }`}
            >
              <span
                className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 ease-settle ${
                  on && lit ? 'bg-(--sel)' : ''
                }`}
              >
                <t.icon size={20} strokeWidth={on ? 2 : 1.75} />
              </span>
              <span className={`t-caption leading-none ${on ? 'font-medium' : ''}`}>{t.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/* ---------------------------------------------------------------- sheet */

export type Detent = 'closed' | 'open' | 'full'

/** Sheet travel, on the house settle curve. */
const SHEET_MS = 360
/** How much picture stays visible above a full sheet, so it is never lost. */
const PEEK = 88

function useHeight(ref: React.RefObject<HTMLElement | null>) {
  const [h, setH] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setH(el.clientHeight)
    const ro = new ResizeObserver(() => setH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return h
}

/**
 * The canvas above and the sheet below.
 *
 * The canvas is never covered by an open sheet, it is resized to the space
 * above it, because a control you cannot see the effect of is a control you
 * cannot use. Resizing it in step with the sheet's travel would re-render the
 * artwork every frame of the animation, though, so the two are sequenced
 * instead: opening, the canvas makes room first and the sheet rises into it;
 * shutting, the sheet falls away first and the canvas grows after. Only the
 * full height lays the sheet over the picture, for browsing, and leaves a
 * strip of it showing.
 */
export function SheetLayout({
  stage,
  overlay,
  title,
  actions,
  detent,
  onDetent,
  panelKey,
  heading = true,
  children,
}: {
  stage: ReactNode
  /** floating controls over the bottom of the canvas */
  overlay?: ReactNode
  title: string
  actions?: ReactNode
  detent: Detent
  onDetent: (d: Detent) => void
  /** changes when the panel's content does, so it starts at the top again */
  panelKey: string
  /** false when the panel is several titled sections, which head themselves */
  heading?: boolean
  children: ReactNode
}) {
  const area = useRef<HTMLDivElement>(null)
  const areaH = useHeight(area)
  const openH = Math.round(Math.min(440, Math.max(Math.min(240, areaH * 0.55), areaH * 0.46)))
  const fullH = Math.max(openH, areaH - PEEK)
  const target = detent === 'closed' ? 0 : detent === 'open' ? openH : fullH

  const [drag, setDrag] = useState<number | null>(null)
  const sheetH = drag ?? target
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)

  // the space kept free for the sheet under the canvas: grown at once, shrunk late
  const want = Math.min(target, openH)
  const [reserve, setReserve] = useState(want)
  useEffect(() => {
    if (want >= reserve) {
      setReserve(want)
      return
    }
    const t = setTimeout(() => setReserve(want), SHEET_MS)
    return () => clearTimeout(t)
  }, [want, reserve])

  /*
   * Dragging the handle. The finger moves the sheet directly, and on release
   * it goes to the height the throw was heading for, not merely the nearest
   * one: a flick upward from open means full even if it only travelled 30px.
   */
  const gesture = useRef<{ y: number; h: number; last: number; t: number; v: number; moved: boolean } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-sheet-action]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    gesture.current = { y: e.clientY, h: sheetH, last: sheetH, t: performance.now(), v: 0, moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const dy = e.clientY - g.y
    if (Math.abs(dy) > 4) g.moved = true
    if (!g.moved) return
    const now = performance.now()
    const next = Math.min(fullH, Math.max(0, g.h - dy))
    g.v = (next - g.last) / Math.max(1, now - g.t)
    g.last = next
    g.t = now
    setDrag(next)
  }
  const onUp = () => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (!g.moved) {
      // a tap on the handle steps between the two open heights
      onDetent(detent === 'full' ? 'open' : 'full')
      return
    }
    const projected = g.last + g.v * 180
    const stops: [Detent, number][] = [
      ['closed', 0],
      ['open', openH],
      ['full', fullH],
    ]
    const [best] = stops.reduce((a, b) => (Math.abs(b[1] - projected) < Math.abs(a[1] - projected) ? b : a))
    setDrag(null)
    onDetent(best)
  }

  return (
    <div ref={area} className="relative min-h-0 flex-1 overflow-hidden">
      <div className="absolute inset-x-0 top-0 flex flex-col" style={{ bottom: reserve }}>
        <div className="relative min-h-0 flex-1">{stage}</div>
        {overlay && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
            {overlay}
          </div>
        )}
      </div>

      <section
        aria-label={title}
        inert={detent === 'closed' && drag === null}
        className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-2xl border-t border-(--line) bg-(--raised) shadow-[0_-12px_32px_rgb(0_0_0/0.18)]"
        style={{
          height: sheetH,
          transition: drag === null ? `height ${SHEET_MS}ms var(--ease-settle)` : 'none',
          borderTopWidth: sheetH < 2 ? 0 : undefined,
        }}
      >
        <div
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="shrink-0 touch-none select-none"
        >
          <div className="flex justify-center pt-2 pb-1">
            <span className="h-1 w-9 rounded-full bg-(--line2)" />
          </div>
          <div className={`flex items-center gap-1 pr-2 pl-4 ${heading ? 'h-10' : '-mt-4 h-8'}`}>
            <h2 className={`min-w-0 flex-1 truncate t-body font-semibold text-(--tx) ${heading ? '' : 'sr-only'}`}>
              {title}
            </h2>
            {!heading && <span className="flex-1" />}
            <div data-sheet-action className="flex items-center">
              {actions}
            </div>
            {/* a bare section's own header controls land here */}
            <div ref={setSlot} data-sheet-action className="flex items-center" />
            <button
              data-sheet-action
              onClick={() => onDetent(detent === 'full' ? 'open' : 'full')}
              aria-label={detent === 'full' ? 'Show less' : 'Show more'}
              className="m-press flex h-10 w-10 items-center justify-center rounded-full text-(--tx3) active:bg-(--panel3)"
            >
              <ChevronUp
                size={18}
                strokeWidth={2}
                className={`transition-transform duration-300 ease-settle ${detent === 'full' ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        </div>
        <div
          key={panelKey}
          className="m-fade min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6"
        >
          <SheetActions value={slot}>{children}</SheetActions>
        </div>
      </section>
    </div>
  )
}

/* ----------------------------------------------------------- the editor */

export interface MobileTab extends DockTab {
  /** the sheet's content, under the canvas */
  panel?: ReactNode
  /** or a whole screen of its own, with no canvas: a form, a preview */
  page?: ReactNode
  /** header controls for the sheet */
  actions?: ReactNode
  /** false for a panel of several titled sections, which head themselves */
  heading?: boolean
}

/**
 * A whole tool on a phone: the bar, the picture and its sheet, and the dock.
 *
 * Pressing a tab opens its sheet; pressing the tab that is already open shuts
 * it, which is how you get the whole screen for the picture. A tab can also be
 * a page of its own, for the one tool here whose main job is a form.
 */
export function MobileEditor({
  bar,
  stage,
  overlay,
  tabs,
  initial,
  initialDetent = 'open',
  tab: controlledTab,
  onTab,
}: {
  bar: ReactNode
  stage: ReactNode
  overlay?: ReactNode
  tabs: MobileTab[]
  initial?: string
  initialDetent?: Detent
  /** for a tool that also changes tab from inside a page */
  tab?: string
  onTab?: (id: string) => void
}) {
  const [innerTab, setInnerTab] = useState(initial ?? tabs[0].id)
  const tabId = controlledTab ?? innerTab
  const setTabId = onTab ?? setInnerTab
  const [detent, setDetent] = useState<Detent>(initialDetent)
  const tab = tabs.find((t) => t.id === tabId && !t.disabled) ?? tabs[0]

  const press = (id: string) => {
    const next = tabs.find((t) => t.id === id)
    if (!next) return
    if (next.page) {
      setTabId(id)
      return
    }
    if (id === tab.id && !tab.page) {
      setDetent(detent === 'closed' ? 'open' : 'closed')
      return
    }
    setTabId(id)
    if (detent === 'closed') setDetent('open')
  }

  return (
    <div className="flex h-full flex-col">
      {bar}
      {tab.page ? (
        <div key={tab.id} className="m-fade relative flex min-h-0 flex-1 flex-col">
          {tab.page}
        </div>
      ) : (
        <SheetLayout
          stage={stage}
          overlay={overlay}
          title={tab.label}
          actions={tab.actions}
          detent={detent}
          onDetent={setDetent}
          panelKey={tab.id}
          heading={tab.heading}
        >
          {tab.panel}
        </SheetLayout>
      )}
      <MobileDock tabs={tabs} active={tab.id} lit={!!tab.page || detent !== 'closed'} onPress={press} />
    </div>
  )
}

/** A round button floating over the canvas, for play, remix and the like. */
export function FloatButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  showLabel,
  strong,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  /** a pill with its word in it, rather than a bare glyph */
  showLabel?: boolean
  /** the inverted fill, for the one button on the canvas worth pressing first */
  strong?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`m-press pointer-events-auto flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border shadow-lg backdrop-blur-md transition-opacity disabled:opacity-40 ${
        showLabel ? 'px-4' : 'w-11'
      } ${
        strong
          ? 'border-transparent bg-(--inverse-canvas) text-(--canvas)'
          : 'border-(--line) bg-(--raised)/85 text-(--tx)'
      }`}
    >
      <Icon size={18} strokeWidth={2} />
      {showLabel && <span className="t-button">{label}</span>}
    </button>
  )
}
