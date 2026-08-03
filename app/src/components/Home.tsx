import { Boxes, Image as ImageIcon, Blend, Terminal, type LucideIcon } from 'lucide-react'
import { useStudio, type AppMode } from '../store'

interface Tool {
  id: AppMode
  name: string
  tagline: string
  icon: LucideIcon
  soon?: boolean
}

const TOOLS: Tool[] = [
  { id: 'studio', name: '3D Studio', tagline: 'Animate your screenshot on a 3D device, then export video.', icon: Boxes },
  { id: 'shots', name: 'Shots', tagline: 'Frame a screenshot on a beautiful background in seconds.', icon: ImageIcon },
  { id: 'home', name: 'Gradients', tagline: 'Mesh & gradient wallpaper generator.', icon: Blend, soon: true },
  { id: 'home', name: 'ANCII', tagline: 'Turn images into ASCII art.', icon: Terminal, soon: true },
]

export function Home() {
  const setMode = useStudio((s) => s.setMode)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-8 py-16">
        {/* brand */}
        <div className="mb-10 flex flex-col items-center text-center">
          <img src="/frog-logo.svg" alt="Ribbit" width={64} height={64} className="mb-4" />
          <h1 className="text-[28px] font-semibold tracking-tight text-(--tx)">Ribbit</h1>
          <p className="mt-1.5 text-[13px] text-(--tx2)">
            A little studio for turning screenshots into things worth sharing.
          </p>
        </div>

        {/* tools */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TOOLS.map((t) => (
            <button
              key={t.name}
              disabled={t.soon}
              onClick={() => !t.soon && setMode(t.id)}
              className={`group flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-colors ${
                t.soon
                  ? 'cursor-default border-(--line) opacity-55'
                  : 'border-(--line) hover:border-(--accent) hover:bg-(--field)'
              }`}
            >
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-lg ${
                  t.soon ? 'bg-(--panel3) text-(--tx3)' : 'bg-(--accent-soft) text-(--accent)'
                }`}
              >
                <t.icon size={22} strokeWidth={1.75} />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-(--tx)">{t.name}</span>
                  {t.soon && (
                    <span className="rounded bg-(--panel3) px-1.5 py-0.5 text-[9px] tracking-wide text-(--tx3) uppercase">
                      Soon
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-(--tx2)">{t.tagline}</p>
              </div>
            </button>
          ))}
        </div>

        <p className="mt-10 text-center text-[11px] text-(--tx3)">
          Press <kbd className="rounded border border-(--line2) bg-(--panel3) px-1 text-(--tx2)">?</kbd> anytime for
          keyboard shortcuts.
        </p>
      </div>
    </div>
  )
}
