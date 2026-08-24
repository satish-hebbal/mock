import type { ReactNode } from 'react'
import { Blend, Smartphone, type LucideIcon } from 'lucide-react'
import { useStudio } from '../store'
import { SECTIONS } from '../lib/sections'

/*
 * The spine of the editor. Every choice you make *about the scene* enters from
 * here, and each section button opens the panel beside it. The transform tools
 * used to sit below in their own group and have moved to a floating bar over
 * the canvas: they act on the thing you are looking at rather than on a
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

/*
 * The site mark, drawn inline rather than loaded as an image so it takes
 * currentColor and dims with the rest of the rail in either theme.
 */
function SiteMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 645 614"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M645 129C645 148.882 628.882 165 609 165H531C511.118 165 495 181.118 495 201V263C495 282.882 511.118 299 531 299H609C628.882 299 645 315.118 645 335V428C645 447.882 628.882 464 609 464H531C511.118 464 495 480.118 495 500V578C495 597.882 478.882 614 459 614H366C346.118 614 330 597.882 330 578V500C330 480.118 313.882 464 294 464H201C181.118 464 165 480.118 165 500V578C165 597.882 148.882 614 129 614H36C16.1177 614 0 597.882 0 578V485C0 465.118 16.1177 449 36 449H129C148.882 449 165 432.882 165 413V350C165 330.118 148.882 314 129 314H36C16.1177 314 0 297.882 0 278V185C0 165.118 16.1178 149 36 149H444C463.882 149 480 132.882 480 113V36C480 16.1178 496.118 0 516 0H645V129ZM330 413C330 432.882 346.118 449 366 449H444C463.882 449 480 432.882 480 413V350C480 330.118 463.882 314 444 314H366C346.118 314 330 330.118 330 350V413Z"
        fill="currentColor"
      />
    </svg>
  )
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
      {/* brand: the app menu lives behind it */}
      <button
        onClick={() => st().setSheetOpen(!sheetOpen)}
        title="Ribbit: tools, theme & shortcuts"
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

      {/*
       * The one link that leaves for the web, so it sits where nothing else
       * competes for the eye: foot of the rail, tertiary ink until you reach
       * for it.
       */}
      <a
        href="https://www.satishhebbal.design/about"
        target="_blank"
        rel="noreferrer noopener"
        title="Built by Satish Hebbal"
        aria-label="Built by Satish Hebbal, opens satishhebbal.design in a new tab"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-(--tx3) transition-colors hover:bg-(--panel3) hover:text-(--tx)"
      >
        <SiteMark />
      </a>
    </aside>
  )
}
