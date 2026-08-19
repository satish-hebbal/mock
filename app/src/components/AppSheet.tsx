import { useEffect } from 'react'
import { Home as HomeIcon, Keyboard, Moon, Sun, X, type LucideIcon } from 'lucide-react'
import { useStudio, type AppMode } from '../store'
import { TOOLS, toolLit, toolWash } from '../lib/tools'
import { rt } from '../lib/runtime'

/*
 * The app menu. Switching tool, theme or reading the shortcut guide are things
 * you do between sessions, not while composing a shot, so they don't get to own
 * a permanent column — they live behind the logo and drop down over the canvas
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
   * Park the render loop while the sheet is over the canvas. The 3D view draws
   * continuously, and it sits directly behind a backdrop-filter — so every
   * frame invalidates the blur and forces the compositor to redo it, which is
   * what makes hovering in here feel a beat late. Nothing behind the sheet
   * needs to animate while it's open.
   */
  useEffect(() => {
    if (!open) return
    rt.setFrameloop?.('never')
    return () => rt.setFrameloop?.('always')
  }, [open])

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

  if (!open) return null

  const close = () => st().setSheetOpen(false)
  const go = (m: AppMode) => {
    st().setMode(m)
    close()
  }

  return (
    <div className="fixed inset-0 z-50" onMouseDown={close}>
      <div className="absolute inset-0 animate-[scrim-in_160ms_ease-out] bg-black/35" />
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute inset-x-0 top-0 animate-[sheet-drop_240ms_cubic-bezier(0.2,0.85,0.25,1)] border-b border-(--line) bg-(--raised)/72 px-6 pt-5 pb-6 backdrop-blur-2xl backdrop-saturate-150"
      >
        <div className="mx-auto max-w-4xl">
          <div className="mb-4 flex items-center gap-2.5">
            <img src="/frog-logo.svg" alt="" width={22} height={22} />
            <span className="t-body font-semibold text-(--tx)">Ribbit</span>
            <span className="t-body-sm text-(--tx3)">— a personal toolkit for visual work</span>
          </div>

          <p className="mb-2 t-eyebrow text-(--tx3) uppercase">
            Tools
          </p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {TOOLS.map((t) => {
              const active = !t.soon && mode === t.id
              // The wash carries the card on its own; the tool you're actually
              // in gets light on top of it, so "this is where you are" reads
              // before you've finished scanning the four names.
              const lit = active ? toolLit(t) : null
              return (
                <button
                  key={t.name}
                  disabled={t.soon}
                  onClick={() => go(t.id)}
                  style={lit ? lit.card : { background: toolWash(t, t.soon ? 0.35 : 0.7) }}
                  className={`flex flex-col items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                    t.soon ? 'cursor-default border-(--line) opacity-60' : ''
                  } ${!t.soon && !active ? 'border-(--line) hover:border-(--line2)' : ''}`}
                >
                  <span
                    style={lit?.chip}
                    className={`flex h-8 w-8 items-center justify-center rounded-md ${
                      t.soon ? 'bg-(--panel3) text-(--tx3)' : 'bg-(--sel) text-(--tx)'
                    }`}
                  >
                    <t.icon size={16} strokeWidth={1.8} />
                  </span>
                  <span>
                    <span className="flex items-center gap-1.5">
                      <span className="t-body-sm font-semibold text-(--tx)">{t.name}</span>
                      {t.soon && (
                        <span className="rounded-xs bg-(--panel3) px-1 py-0.5 t-caption text-(--tx3) uppercase">
                          Soon
                        </span>
                      )}
                    </span>
                    {/* the copy brightens with the card: a dim tagline under a lit
                        surface reads as disabled, which is the opposite of the point */}
                    <span
                      className={`mt-0.5 block t-caption leading-snug ${
                        active ? 'text-(--tx2)' : 'text-(--tx3)'
                      }`}
                    >
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
