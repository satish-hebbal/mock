import { Mascot } from './Mascot'
import { useStudio } from '../store'
import { TOOLS, toolTint, toolWash } from '../lib/tools'
import { HOME_SEAM } from '../lib/interlock'

/*
 * The first two cards interlock, and the third stands clear.
 *
 * Three cards evenly spaced are three separate offers, and they were being read
 * that way: pick one of three. The first two are the same job at two different
 * fidelities, though, one screen dressed for a video and one dressed for a
 * post, so cutting the seam between them into a step makes them a pair you
 * choose within, while Draw stays a rectangle because it is genuinely somewhere
 * else. The shapes are in interlock.ts.
 */
export function Home() {
  const setMode = useStudio((s) => s.setMode)

  return (
    <div className="h-full overflow-y-auto">
      {/* the bottom padding matches the sides, so the hint is inset from the edge
          by the same amount the content is rather than floating above a band of
          nothing */}
      <div className="mx-auto flex min-h-full max-w-5xl flex-col px-8 pt-16 pb-8">
        {/* brand */}
        <div className="mt-auto mb-10 flex flex-col items-center text-center">
          <Mascot size={128} className="mb-4" />
          <h1 className="t-headline text-(--tx)">Ribbit</h1>
          <p className="mt-1.5 t-body text-(--tx2)">
            A personal toolkit for visual work. Mock it up, dress it up, ship it.
          </p>
        </div>

        {/* tools */}
        {/* one row: three tools sit across, with room to read the taglines */}
        <div className="tool-row mb-auto grid grid-cols-1 gap-3 sm:grid-cols-3" style={HOME_SEAM.row}>
          {TOOLS.map((t, i) => {
            const seam = HOME_SEAM.parts[i]
            return (
              <button
                key={t.name}
                disabled={t.soon}
                onClick={() => !t.soon && setMode(t.id)}
                style={{ ...seam?.style, ...toolTint(t) }}
                className={`tool-card group flex flex-col items-start gap-3 p-5 text-left transition-colors ${
                  seam?.className ?? ''
                } ${t.soon ? 'cursor-default opacity-60' : ''}`}
              >
                {/* the card's surface, and everything the 1px of card
                    background around it is left reading as a hairline */}
                <span
                  className="tool-card-fill"
                  style={{ background: toolWash(t, t.soon ? 0.35 : 0.8) }}
                />
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-lg ${
                    t.soon ? 'bg-(--panel3) text-(--tx3)' : 'bg-(--sel) text-(--tx)'
                  }`}
                >
                  <t.icon size={22} strokeWidth={1.75} />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="t-body font-semibold text-(--tx)">{t.name}</span>
                    {t.soon && (
                      <span className="rounded-xs bg-(--panel3) px-1.5 py-0.5 t-caption text-(--tx3) uppercase">
                        Soon
                      </span>
                    )}
                  </div>
                  <p className="mt-1 t-body-sm leading-relaxed text-(--tx2)">{t.tagline}</p>
                </div>
              </button>
            )
          })}
        </div>

        {/* The hint belongs to the page, not to the cards, so it sits on the
            bottom edge rather than trailing the row. An auto margin above the
            brand and another below the tools splits whatever height is left
            between them, which keeps the two centred in the space over the hint
            instead of the hint riding up with them. */}
        <p className="mt-10 text-center t-body-sm text-(--tx3)">
          Press <kbd className="rounded-xs border border-(--line2) bg-(--panel3) px-1 text-(--tx2)">?</kbd> anytime for
          keyboard shortcuts.
        </p>
      </div>
    </div>
  )
}
