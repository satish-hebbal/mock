import { Mascot } from './Mascot'
import { useStudio } from '../store'
import { TOOLS, toolGlow, toolTint } from '../lib/tools'
import { ToolAurora } from './ToolAurora'
import { HOME_SEAM } from '../lib/interlock'

/*
 * The first two cards interlock, and the rest stand clear.
 *
 * A row of cards evenly spaced is a row of separate offers, and it was being
 * read that way: pick one of five. The first two are the same job at two
 * different fidelities, though, one screen dressed for a video and one dressed
 * for a post, so cutting the seam between them into a step makes them a pair
 * you choose within, while the others stay rectangles because they are
 * genuinely somewhere else. The shapes are in interlock.ts.
 */
export function Home() {
  const setMode = useStudio((s) => s.setMode)

  return (
    <div className="h-full overflow-y-auto">
      {/* the bottom padding matches the sides, so the hint is inset from the edge
          by the same amount the content is rather than floating above a band of
          nothing */}
      <div className="mx-auto flex min-h-full max-w-6xl flex-col px-8 pt-16 pb-8">
        {/* brand */}
        <div className="mt-auto mb-10 flex flex-col items-center text-center">
          <Mascot size={128} className="mb-4" />
          <h1 className="t-headline text-(--tx)">Ribbit</h1>
          <p className="mt-1.5 t-body text-(--tx2)">
            A personal toolkit for visual work. Mock it up, dress it up, ship it.
          </p>
        </div>

        {/* tools */}
        {/*
          One row once there is width for it. Below that the cards pair off two
          by two rather than stacking into a column, which keeps the interlocked
          first two side by side at every size they are drawn as a pair.
        */}
        <div
          className="tool-row mb-auto grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
          style={HOME_SEAM.row}
        >
          {TOOLS.map((t, i) => {
            const seam = HOME_SEAM.parts[i]
            return (
              <button
                key={t.name}
                disabled={t.soon}
                onClick={() => !t.soon && setMode(t.id)}
                style={{ ...seam?.style, ...toolTint(t), ...toolGlow(t.soon ? 0.25 : 0.62) }}
                className={`tool-card group flex flex-col items-start gap-2.5 p-4 text-left ${
                  seam?.className ?? ''
                } ${t.soon ? 'cursor-default opacity-60' : ''}`}
              >
                {/* the card's surface: the ground, the tool's four curtains of
                    light, and a scrim over the top of them. The 1px of card
                    background it leaves uncovered reads as a hairline */}
                <span className="tool-card-fill">
                  <ToolAurora tool={t} />
                </span>
                <t.icon className="tool-card-icon" size={22} strokeWidth={1.75} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="t-body font-semibold text-(--tx)">{t.name}</span>
                    {t.soon && (
                      <span className="rounded-xs bg-(--panel3) px-1.5 py-0.5 t-caption text-(--tx3) uppercase">
                        Soon
                      </span>
                    )}
                  </div>
                  {/* snug rather than relaxed: at three lines the extra leading
                      was most of what made the card tall. The ink is the card's
                      own rather than secondary ink, because the last line of it
                      sits over the glow */}
                  <p className="mt-1 t-body-sm leading-snug text-(--tool-copy)">{t.tagline}</p>
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
