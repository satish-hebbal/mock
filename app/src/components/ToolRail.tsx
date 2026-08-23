import type { ReactNode } from 'react'
import { Blend, Smartphone, type LucideIcon } from 'lucide-react'
import { useStudio } from '../store'
import { SECTIONS } from '../lib/sections'

/*
 * The spine of the editor. Every choice you make *about the scene* enters from
 * here, and each section button opens the panel beside it. The transform tools
 * used to sit below in their own group and have moved to a floating bar over
 * the canvas — they act on the thing you are looking at rather than on a
 * panel, so they belong next to it. The logo is the only thing that leaves the
 * workspace, so it drops the app menu down over the canvas instead of spending
 * a column on links you press twice a session.
 */

/** Shots splits the same way its reference tools do: the subject, then the canvas. */
const SHOTS_SECTIONS = [
  ['mockup', 'Mockup', Smartphone],
  ['frame', 'Frame', Blend],
] as const

function RailButton({
  icon: Icon,
  title,
  active,
  onClick,
  children,
}: {
  icon: LucideIcon
  title: string
  active?: boolean
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`relative flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-(--sel) text-(--tx)'
          : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
      }`}
    >
      <Icon size={17} strokeWidth={1.75} />
      {children}
    </button>
  )
}

function RailDivider() {
  return <span className="my-1.5 h-px w-6 shrink-0 bg-(--line)" />
}

export function ToolRail() {
  const mode = useStudio((s) => s.mode)
  const sheetOpen = useStudio((s) => s.sheetOpen)
  const section = useStudio((s) => s.toolSection)
  const shotsSection = useStudio((s) => s.shotsSection)
  const panelOpen = useStudio((s) => s.toolPanelOpen)
  const st = useStudio.getState

  const studio = mode === 'studio'
  const shots = mode === 'shots'

  return (
    <aside className="z-30 flex w-13 shrink-0 flex-col items-center gap-1 bg-(--panel) py-2.5">
      {/* brand — the app menu lives behind it */}
      <button
        onClick={() => st().setSheetOpen(!sheetOpen)}
        title="Ribbit — tools, theme & shortcuts"
        aria-label="Open the app menu"
        aria-expanded={sheetOpen}
        className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
          sheetOpen ? 'bg-(--sel)' : 'hover:bg-(--panel3)'
        }`}
      >
        <img src="/frog-logo.svg" alt="" width={22} height={22} />
      </button>

      {studio && (
        <>
          <RailDivider />
          {SECTIONS.map((s) => {
            const on = panelOpen && section === s.id
            return (
              <RailButton
                key={s.id}
                icon={s.icon}
                title={s.label}
                active={on}
                onClick={() => st().toggleToolSection(s.id)}
              >
                {on && (
                  <span className="absolute top-1/2 -left-2.5 h-4 w-[2px] -translate-y-1/2 rounded-full bg-(--tx)" />
                )}
              </RailButton>
            )
          })}
        </>
      )}

      {shots && (
        <>
          <RailDivider />
          {SHOTS_SECTIONS.map(([id, label, Icon]) => {
            const on = panelOpen && shotsSection === id
            return (
              <RailButton
                key={id}
                icon={Icon}
                title={label}
                active={on}
                onClick={() => st().toggleShotsSection(id)}
              >
                {on && (
                  <span className="absolute top-1/2 -left-2.5 h-4 w-[2px] -translate-y-1/2 rounded-full bg-(--tx)" />
                )}
              </RailButton>
            )
          })}
        </>
      )}

      <div className="flex-1" />
    </aside>
  )
}
