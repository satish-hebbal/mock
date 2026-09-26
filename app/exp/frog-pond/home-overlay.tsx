// The home page's own brand line, tool cards and hint, mounted over the pond, so the background is
// judged against the real cards (aurora glow, interlocked first pair, beta chip) rather than a
// stand-in. Same markup and styles as src/components/Home.tsx, minus the mascot and the store: the
// cards here don't navigate anywhere.

import '../../src/index.css'
import { TOOLS, toolGlow, toolTint } from '../../src/lib/tools'
import { ToolAurora } from '../../src/components/ToolAurora'
import { HOME_SEAM } from '../../src/lib/interlock'

export function HomeOverlay() {
  return (
    <div className="pointer-events-none mx-auto flex h-full max-w-6xl flex-col px-8 pt-16 pb-8 xl:max-w-7xl">
      <div className="pond-brand mt-auto mb-10 flex flex-col items-center text-center">
        <h1 className="t-headline text-(--tx)">Ribbit</h1>
        <p className="mt-1.5 t-body text-(--tx2)">A personal toolkit for visual work.</p>
      </div>

      <div className="tool-row mb-auto grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" style={HOME_SEAM.row}>
        {TOOLS.map((t, i) => {
          const seam = HOME_SEAM.parts[i]
          return (
            <button
              key={t.name}
              disabled={t.soon}
              style={{ ...seam?.style, ...toolTint(t), ...toolGlow(t.soon ? 0.25 : 0.62) }}
              className={`tool-card pointer-events-auto group flex flex-col items-start gap-2.5 p-4 text-left ${seam?.className ?? ''} ${
                t.soon ? 'cursor-default opacity-60' : ''
              }`}
            >
              <span className="tool-card-fill">
                <ToolAurora tool={t} />
              </span>
              <t.icon className="tool-card-icon" size={22} strokeWidth={1.75} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="t-body font-semibold text-(--tx)">{t.name}</span>
                  {t.beta && <span className="tool-card-chip">Beta</span>}
                </div>
                <p className="mt-1 truncate t-body-sm leading-snug text-(--tool-copy)">{t.tagline}</p>
              </div>
            </button>
          )
        })}
      </div>

      <p className="pond-hint mt-10 text-center t-body-sm text-(--tx3)">
        Press <kbd className="rounded-xs border border-(--line2) bg-(--panel3) px-1 text-(--tx2)">?</kbd> anytime for keyboard shortcuts.
      </p>
    </div>
  )
}
