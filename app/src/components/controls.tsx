import { useState, type ReactNode } from 'react'
import { useStudio } from '../store'

// ————— collapsible section —————

export function Section({
  title,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  badge?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-(--line)">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[10px] font-semibold tracking-[0.2em] text-(--tx2) uppercase">
          {title}
          {badge && (
            <span className="ml-2 rounded bg-orange-600/90 px-1.5 py-0.5 text-[8px] font-bold text-white">
              {badge}
            </span>
          )}
        </span>
        <span className={`text-[10px] text-(--tx3) transition-transform ${open ? '' : '-rotate-90'}`}>▾</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
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
      title={hasTrack ? (hasHere ? 'Remove keyframe' : 'Add keyframe at playhead') : 'Animate this property'}
      className="flex h-4 w-4 shrink-0 items-center justify-center"
    >
      <span
        className={`block h-2 w-2 rotate-45 transition-colors ${
          hasHere
            ? 'bg-orange-500'
            : hasTrack
              ? 'border border-orange-500 bg-transparent'
              : 'border border-(--tx3) bg-transparent hover:border-(--tx2)'
        }`}
      />
    </button>
  )
}

// ————— slider row (label · KF · slider · number) —————

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
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-14 shrink-0 text-[11px] text-(--tx2)" title={hint}>
        {label}
      </span>
      {target ? <KFDiamond target={target} /> : <span className="w-4 shrink-0" />}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-orange-500"
      />
      <input
        type="number"
        value={format(value)}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="w-14 shrink-0 rounded border border-(--line) bg-transparent px-1 py-0.5 text-right font-mono text-[11px] text-(--tx)"
      />
    </div>
  )
}

// ————— segment tabs —————

export function Segments<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div
      className="mb-3 grid gap-1 rounded-md bg-(--panel2) p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`truncate rounded px-1 py-1 text-[10px] font-medium tracking-[0.1em] uppercase transition-colors ${
            value === o.id ? 'bg-orange-600 text-white' : 'text-(--tx2) hover:text-(--tx)'
          }`}
        >
          {o.label}
        </button>
      ))}
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
    <label className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11px] text-(--tx2)">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-8 cursor-pointer rounded border border-(--line) bg-transparent p-0"
        />
        <span className="w-16 font-mono text-[11px] text-(--tx3)">{value}</span>
      </span>
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
      className={`rounded border px-2 py-1 text-[10px] font-medium tracking-wide uppercase transition-colors ${
        active
          ? 'border-orange-500 bg-orange-600/20 text-orange-400'
          : 'border-(--line) text-(--tx2) hover:border-(--tx3) hover:text-(--tx)'
      }`}
    >
      {children}
    </button>
  )
}
