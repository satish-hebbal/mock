import { useEffect, useState } from 'react'
import { Home as HomeIcon, Keyboard, Moon, Sun, X, type LucideIcon } from 'lucide-react'
import { useStudio, type AppMode } from '../store'
import { TOOLS, toolGlow, toolTint } from '../lib/tools'
import { ToolAurora } from './ToolAurora'
import { SHEET_SEAM } from '../lib/interlock'
import { rt } from '../lib/runtime'

/*
 * The app menu. Switching tool, theme or reading the shortcut guide are things
 * you do between sessions, not while composing a shot, so they don't get to own
 * a permanent column. They live behind the logo and drop down over the canvas
 * when asked for. Everything the rail and panels do stays reachable underneath.
 */

function QuickAction({
  icon: Icon,
  label,
  onClick,
  title,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-8 items-center gap-2 rounded-sm px-2.5 t-body-sm text-(--tx2) transition-colors hover:bg-(--panel3) hover:text-(--tx)"
    >
      <Icon size={14} strokeWidth={1.8} />
      {label}
    </button>
  )
}

export function AppSheet() {
  const open = useStudio((s) => s.sheetOpen)
  const mode = useStudio((s) => s.mode)
  const theme = useStudio((s) => s.theme)
  const st = useStudio.getState

  /*
   * On screen outlasts open: closing flips `open` at once, so Escape and the
   * logo answer immediately, and the sheet stays mounted until its exit has
   * played. The timer is the floor under `onAnimationEnd`, which never fires
   * when reduced motion has switched the animation off.
   */
  const [shown, setShown] = useState(open)
  if (open && !shown) setShown(true)
  const closing = shown && !open
  useEffect(() => {
    if (!closing) return
    const t = window.setTimeout(() => setShown(false), 260)
    return () => clearTimeout(t)
  }, [closing])

  /*
   * Park everything that animates behind the sheet for as long as it is on
   * screen. The 3D view, the pond and Signal's canvas all sit under a
   * backdrop-filter, so every frame they draw invalidates the blur and forces
   * the compositor to redo it, which is what made the slide drop frames and
   * hovering in here feel a beat late. A held frame looks the same blurred.
   */
  useEffect(() => {
    if (!shown) return
    rt.setFrameloop?.('never')
    st().setSheetCovering(true)
    return () => {
      rt.setFrameloop?.('always')
      st().setSheetCovering(false)
    }
  }, [shown, st])

  // Escape closes the sheet before the global handler gets to clear a selection
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useStudio.getState().dialog) return
      e.stopImmediatePropagation()
      st().setSheetOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, st])

  if (!shown) return null

  const close = () => st().setSheetOpen(false)
  const go = (m: AppMode) => {
    st().setMode(m)
    close()
  }

  return (
    <div className="app-sheet-root fixed inset-0 z-50" data-closing={closing || undefined} onMouseDown={close}>
      <div className="app-sheet-scrim absolute inset-0 bg-black/35" />
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onAnimationEnd={(e) => closing && e.target === e.currentTarget && setShown(false)}
        className="app-sheet absolute inset-x-0 top-0 border-b border-(--line) bg-(--raised)/80 px-6 pt-5 pb-6 backdrop-blur-xl backdrop-saturate-150"
      >
        <div className="app-sheet-body mx-auto max-w-5xl xl:max-w-6xl">
          <div className="mb-4 flex items-center gap-2.5">
            <img src="/frog-logo.svg" alt="" width={22} height={22} />
            <span className="t-body font-semibold text-(--tx)">Ribbit</span>
            <span className="t-body-sm text-(--tx3)">free tools, no sign-up</span>
          </div>

          <p className="mb-2 t-eyebrow text-(--tx3) uppercase">
            Tools
          </p>
          <div
            className="tool-row grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
            style={SHEET_SEAM.row}
          >
            {TOOLS.map((t, i) => {
              const active = !t.soon && mode === t.id
              /*
               * The glow carries the card on its own, and the tool you are
               * actually in is simply the one turned all the way up, so "this
               * is where you are" reads before you have finished scanning the
               * row. It is the same light hover reaches for, which is the
               * point: hovering a card shows you what being in it looks like.
               *
               * These cards are half the height of the home screen's and their
               * copy runs closer to the bottom edge the glow comes out of, so
               * the light is both turned down and pushed 16% further under the
               * card. Turning it down alone would have cost the lit edge, which
               * is the half of the effect that survives being this small.
               */
              const seam = SHEET_SEAM.parts[i]
              return (
                <button
                  key={t.name}
                  disabled={t.soon}
                  onClick={() => go(t.id)}
                  style={{
                    ...seam?.style,
                    ...toolTint(t),
                    ...toolGlow(active ? 1 : t.soon ? 0.22 : 0.5, 16),
                  }}
                  className={`tool-card flex flex-col items-start gap-2.5 p-3 text-left ${
                    seam?.className ?? ''
                  } ${t.soon ? 'cursor-default opacity-60' : ''}`}
                >
                  {/* the card's surface, and the 1px of card background left
                      showing around it is the hairline */}
                  <span className="tool-card-fill">
                    <ToolAurora tool={t} />
                  </span>
                  <t.icon className="tool-card-icon" size={18} strokeWidth={1.8} />
                  <span>
                    <span className="flex items-center gap-1.5">
                      <span className="t-body-sm font-semibold text-(--tx)">{t.name}</span>
                      {t.soon && (
                        <span className="rounded-xs bg-(--panel3) px-1 py-0.5 t-caption text-(--tx3) uppercase">
                          Soon
                        </span>
                      )}
                      {t.beta && (
                        <span className="tool-card-chip">
                          Beta
                        </span>
                      )}
                    </span>
                    {/*
                      One ink for every card, where this used to brighten the
                      copy on the active one. It brightened it because a dim
                      tagline under a lit surface reads as disabled, and that is
                      still true, but the glow is doing the lighting now and the
                      copy no longer has a dark card to be dim against: at full
                      glow the tagline on a card this short sits right on the
                      light. `--tool-copy` is the ink that clears that, so it is
                      the ink all five want.
                    */}
                    <span className="mt-0.5 block truncate t-caption leading-snug text-(--tool-copy)">
                      {t.tagline}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-5 flex items-center gap-1">
            <QuickAction icon={HomeIcon} label="Home" onClick={() => go('home')} />
            <QuickAction
              icon={Keyboard}
              label="Shortcuts"
              onClick={() => {
                st().setDialog('shortcuts')
                close()
              }}
            />
            <QuickAction
              icon={theme === 'dark' ? Sun : Moon}
              label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              onClick={() => st().setTheme(theme === 'dark' ? 'light' : 'dark')}
            />
            {/* dismissal belongs at the far end, away from the things that navigate */}
            <div className="flex-1" />
            <QuickAction icon={X} label="Close" title="Close (Esc)" onClick={close} />
          </div>
        </div>
      </div>
    </div>
  )
}
