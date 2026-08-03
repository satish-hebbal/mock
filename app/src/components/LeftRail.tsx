import {
  Blend,
  Boxes,
  Image as ImageIcon,
  Keyboard,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { useStudio, type AppMode } from '../store'

interface Tool {
  id: AppMode | string
  label: string
  icon: LucideIcon
  soon?: boolean
}

const TOOLS: Tool[] = [
  { id: 'studio', label: '3D Studio', icon: Boxes },
  { id: 'shots', label: 'Shots', icon: ImageIcon },
  { id: 'gradients', label: 'Gradients', icon: Blend, soon: true },
  { id: 'ancii', label: 'ANCII', icon: Terminal, soon: true },
]

export function LeftRail() {
  const mode = useStudio((s) => s.mode)
  const theme = useStudio((s) => s.theme)
  const st = useStudio.getState

  // lives in the store so the `[` shortcut can drive it too
  const expanded = useStudio((s) => s.railOpen)
  const setExpanded = (v: boolean) => st().setRailOpen(v)

  const RailButton = ({
    icon: Icon,
    label,
    active,
    onClick,
    disabled,
    title,
  }: {
    icon: LucideIcon
    label: string
    active?: boolean
    onClick?: () => void
    disabled?: boolean
    title?: string
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`group flex h-9 items-center gap-3 rounded-lg px-2.5 transition-colors ${
        expanded ? 'w-full' : 'w-9 justify-center'
      } ${
        active
          ? 'bg-(--sel) text-(--tx)'
          : disabled
            ? 'cursor-default text-(--tx3)'
            : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
      }`}
    >
      <Icon size={17} strokeWidth={1.75} className="shrink-0" />
      {expanded && <span className="flex-1 truncate text-left text-[12px] font-medium">{label}</span>}
      {expanded && disabled && (
        <span className="rounded bg-(--panel3) px-1 py-0.5 text-[8px] tracking-wide text-(--tx3) uppercase">
          Soon
        </span>
      )}
    </button>
  )

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-(--line) bg-(--panel) py-3 transition-[width] duration-150 ${
        expanded ? 'w-48 px-2.5' : 'w-14 items-center px-2'
      }`}
    >
      {/* brand — click to return to the home screen */}
      <button
        onClick={() => st().setMode('home')}
        title="Ribbit — home"
        aria-label="Go to home"
        className={`mb-4 flex h-9 items-center rounded-lg transition-colors hover:bg-(--panel3) ${
          expanded ? 'gap-2.5 px-1.5' : 'w-9 justify-center'
        } ${mode === 'home' ? 'bg-(--panel3)' : ''}`}
      >
        <img src="/frog-logo.svg" alt="Ribbit logo" width={22} height={22} className="shrink-0" />
        {expanded && <span className="text-[13px] font-semibold tracking-tight text-(--tx)">Ribbit</span>}
      </button>

      {/* tools */}
      <nav className="flex flex-col gap-1">
        {expanded && (
          <p className="mb-1 px-2 text-[9px] font-semibold tracking-[0.18em] text-(--tx3) uppercase">Tools</p>
        )}
        {TOOLS.map((t) => (
          <RailButton
            key={t.id}
            icon={t.icon}
            label={t.label}
            active={!t.soon && mode === t.id}
            disabled={t.soon}
            title={t.soon ? `${t.label} — coming soon` : t.label}
            onClick={t.soon ? undefined : () => st().setMode(t.id as AppMode)}
          />
        ))}
      </nav>

      <div className="flex-1" />

      {/* footer actions */}
      <div className="flex flex-col gap-1">
        <RailButton
          icon={Keyboard}
          label="Shortcuts"
          title="Keyboard shortcuts (?)"
          onClick={() => st().setDialog('shortcuts')}
        />
        <RailButton
          icon={theme === 'dark' ? Sun : Moon}
          label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          onClick={() => st().setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
        <RailButton
          icon={expanded ? PanelLeftClose : PanelLeftOpen}
          label="Collapse"
          title={expanded ? 'Collapse' : 'Expand'}
          onClick={() => setExpanded(!expanded)}
        />
      </div>
    </aside>
  )
}
