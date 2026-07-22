import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useStudio } from '../store'

/*
 * Panel primitives, modelled on Figma's right rail: sentence-case section
 * titles, quiet sub-labels, and fields where a leading icon replaces the label
 * so the value is the loudest thing in the row. Surfaces stay neutral; the blue
 * accent is reserved for "this is on".
 */

// ————— collapsible section —————

export function Section({
  title,
  children,
  defaultOpen = true,
  badge,
  icon,
  actions,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  badge?: string
  /** small glyph shown before the section title */
  icon?: ReactNode
  /** trailing controls, aligned with the collapse chevron */
  actions?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-(--line)">
      <div className="flex items-center gap-1 pr-2 pl-3">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 py-2.5 text-left"
        >
          {icon && <span className="shrink-0 text-(--tx2)">{icon}</span>}
          <span className="text-[11px] font-semibold text-(--tx)">{title}</span>
          {badge && (
            <span className="rounded bg-(--panel3) px-1.5 py-0.5 text-[9px] font-medium text-(--tx2)">
              {badge}
            </span>
          )}
        </button>
        {actions}
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          className="flex h-6 w-6 items-center justify-center rounded text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
        >
          <ChevronDown size={13} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  )
}

/** Quiet label above a cluster of fields ("Alignment", "Lighting", …). */
export function SubHeading({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] text-(--tx2)">
      {icon}
      {children}
    </p>
  )
}

// ————— keyframe diamond —————

export function KFDiamond({ target }: { target: string }) {
  const timeMs = useStudio((s) => s.timeMs)
  const hasTrack = useStudio((s) => s.project.keyframes.some((k) => k.target === target))
  const hasHere = useStudio((s) =>
    s.project.keyframes.some((k) => k.target === target && Math.abs(k.timeMs - timeMs) <= 1),
  )
  const toggleTrack = useStudio((s) => s.toggleTrack)
  const addKeyframeAt = useStudio((s) => s.addKeyframeAt)
  const removeKeyframes = useStudio((s) => s.removeKeyframes)
  const kfs = useStudio((s) => s.project.keyframes)

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
      className="flex h-4 w-4 shrink-0 items-center justify-center"
    >
      <span
        className={`block h-2 w-2 rotate-45 transition-colors ${
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

// ————— numeric field (icon + value, drag to scrub, click to type) —————

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
  }

  // Figma-style relative scrub: drag anywhere on the field, ~180px covers the
  // full range; a click that never moved opens the value for typing instead.
  const onPointerDown = (e: React.PointerEvent) => {
    if (editing || e.button !== 0) return
    const startX = e.clientX
    const startV = value
    const perPx = (max - min) / 180
    let moved = false
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    scrubbing.current = true

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (Math.abs(dx) > 2) moved = true
      if (!moved) return
      onChange(clamp(startV + dx * perPx * (ev.shiftKey ? 0.2 : 1)))
    }
    const onUp = () => {
      el.releasePointerCapture(e.pointerId)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      scrubbing.current = false
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
      {target ? <KFDiamond target={target} /> : <span className="w-4 shrink-0" />}
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
        className="relative h-7 flex-1 cursor-ew-resize overflow-hidden rounded-[5px] bg-(--field) select-none focus:ring-1 focus:ring-(--accent) focus:outline-none"
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-[5px] bg-(--sel)"
          style={{ width: `${pct}%` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-(--tx2)"
          style={{ left: `calc(${pct}% - 6px)` }}
        />
        <div className="absolute inset-0 flex items-center justify-between gap-2 px-2.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-(--tx2)">
            {icon && <span className="shrink-0">{icon}</span>}
            <span className="truncate">{label}</span>
          </span>
          {editing ? (
            <input
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
                e.stopPropagation()
              }}
              className="w-14 shrink-0 rounded-[3px] border border-(--line2) bg-(--panel) px-1 text-right text-[11px] text-(--tx) tabular-nums outline-none"
            />
          ) : (
            <span className="shrink-0 text-[11px] text-(--tx) tabular-nums">{format(value)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ————— segment tabs —————

export function Segments<T extends string>({
  options,
  value,
  onChange,
}: {
  /** an `icon` turns the tab into a glyph-only button with the label as tooltip */
  options: { id: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div
      className="mb-2 grid gap-0.5 rounded-[5px] bg-(--field) p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          aria-label={o.label}
          title={o.label}
          className={`flex h-6 items-center justify-center gap-1 truncate rounded-[3px] px-1.5 text-[11px] transition-colors ${
            value === o.id
              ? 'bg-(--sel) text-(--tx)'
              : 'text-(--tx2) hover:text-(--tx)'
          }`}
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
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex h-6 w-6 items-center justify-center rounded-[4px] transition-colors ${
        active
          ? 'bg-(--accent-soft) text-(--accent)'
          : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
      }`}
    >
      {icon}
    </button>
  )
}

// ————— dropdown (replaces native <select>, which can't be themed) —————

export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  title,
  className = '',
  align = 'left',
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  title?: string
  className?: string
  /** which edge the menu lines up with when it would overflow a narrow panel */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  const toggle = () => {
    if (!open) {
      // open toward whichever side has room — the timeline sits at the bottom
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
        className="flex h-7 w-full items-center gap-1.5 rounded-[5px] bg-(--field) px-2 text-[11px] text-(--tx) hover:bg-(--field-h)"
      >
        <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? '—'}</span>
        <ChevronDown size={12} className={`shrink-0 text-(--tx3) ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          className={`absolute z-50 max-h-64 min-w-full overflow-y-auto rounded-[6px] border border-(--line) bg-(--panel) p-1 shadow-2xl ${
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
              className={`block w-full truncate rounded-[4px] px-2 py-1.5 text-left text-[11px] whitespace-nowrap ${
                o.value === value
                  ? 'bg-(--accent-soft) text-(--accent)'
                  : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ————— color row —————

export function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label
      title={label}
      className="relative my-0.5 flex h-7 items-center gap-2 rounded-[5px] bg-(--field) px-2 hover:bg-(--field-h)"
    >
      <span className="relative h-4 w-4 shrink-0 overflow-hidden rounded-[3px] border border-(--line2)">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="absolute -inset-1 cursor-pointer"
        />
      </span>
      <span className="text-[11px] text-(--tx) uppercase tabular-nums">{value.replace('#', '')}</span>
      <span className="ml-auto truncate text-[10px] text-(--tx3)">{label}</span>
    </label>
  )
}

// ————— small button —————

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
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`inline-flex h-7 items-center justify-center gap-1.5 truncate rounded-[5px] px-2 text-[11px] transition-colors ${
        active
          ? 'bg-(--accent-soft) text-(--accent)'
          : 'bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
      }`}
    >
      {children}
    </button>
  )
}
