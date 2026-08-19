import { useStudio } from '../store'
import { TOOLS, toolWash } from '../lib/tools'

export function Home() {
  const setMode = useStudio((s) => s.setMode)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-8 py-16">
        {/* brand */}
        <div className="mb-10 flex flex-col items-center text-center">
          <img src="/frog-logo.svg" alt="Ribbit" width={64} height={64} className="mb-4" />
          <h1 className="t-headline text-(--tx)">Ribbit</h1>
          <p className="mt-1.5 t-body text-(--tx2)">
            A personal toolkit for visual work — mock it up, dress it up, ship it.
          </p>
        </div>

        {/* tools */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TOOLS.map((t) => (
            <button
              key={t.name}
              disabled={t.soon}
              onClick={() => !t.soon && setMode(t.id)}
              style={{ background: toolWash(t, t.soon ? 0.35 : 0.8) }}
              className={`group flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-colors ${
                t.soon
                  ? 'cursor-default border-(--line) opacity-60'
                  : 'border-(--line) hover:border-(--line2)'
              }`}
            >
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
          ))}
        </div>

        <p className="mt-10 text-center t-body-sm text-(--tx3)">
          Press <kbd className="rounded-xs border border-(--line2) bg-(--panel3) px-1 text-(--tx2)">?</kbd> anytime for
          keyboard shortcuts.
        </p>
      </div>
    </div>
  )
}
