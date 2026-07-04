import { useEffect, useRef, useState } from 'react'
import {
  exportProjectFile,
  importProjectFile,
  persistProject,
  useStudio,
} from '../store'
import { quickCapture } from '../lib/export'

export function TopBar() {
  const name = useStudio((s) => s.project.name)
  const theme = useStudio((s) => s.theme)
  const pro = useStudio((s) => s.pro)
  const st = useStudio.getState
  const [saved, setSaved] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  const handleSave = async () => {
    await persistProject()
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const menuItem = (label: string, action: () => void) => (
    <button
      onClick={() => {
        setMenuOpen(false)
        action()
      }}
      className="rounded px-2 py-1.5 text-left text-[12px] text-(--tx2) hover:bg-orange-600/15 hover:text-(--tx)"
    >
      {label}
    </button>
  )

  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center justify-between border-b border-(--line) bg-(--panel) px-3">
      <div className="flex items-center gap-3">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="rounded px-2 py-1 text-(--tx2) hover:bg-(--panel2) hover:text-(--tx)"
            title="Menu"
          >
            ☰
          </button>
          {menuOpen && (
            <div className="absolute top-9 left-0 flex w-52 flex-col gap-0.5 rounded-lg border border-(--line) bg-(--panel) p-1.5 shadow-2xl">
              {menuItem('New project', () => {
                if (confirm('Start a new project? Current work is saved locally.')) st().newProject()
              })}
              {menuItem('Import project (.mockup.json)', () => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = '.json,application/json'
                input.onchange = () => {
                  const f = input.files?.[0]
                  if (f)
                    importProjectFile(f).catch((err) => alert(`Import failed: ${(err as Error).message}`))
                }
                input.click()
              })}
              {menuItem('Export project file', () => void exportProjectFile())}
              <div className="my-1 border-t border-(--line)" />
              {menuItem(`Theme: ${theme === 'dark' ? 'Dark → Light' : 'Light → Dark'}`, () =>
                st().setTheme(theme === 'dark' ? 'light' : 'dark'),
              )}
              {menuItem('Keyboard shortcuts (?)', () => st().setDialog('shortcuts'))}
              {!pro && menuItem('Upgrade to Pro ◆', () => st().setDialog('upgrade'))}
            </div>
          )}
        </div>

        <span className="text-base leading-none text-orange-500">◆</span>
        <span className="hidden text-[12px] font-semibold tracking-[0.18em] uppercase sm:inline">
          Mockup Studio
        </span>
        <input
          value={name}
          onChange={(e) => st().setProjectName(e.target.value)}
          className="w-44 rounded border border-transparent bg-transparent px-2 py-1 text-[12px] text-(--tx2) hover:border-(--line) focus:border-orange-500/50 focus:text-(--tx) focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => st().setDialog('templates')}
          className="rounded-md px-3 py-1.5 text-[11px] font-medium tracking-[0.12em] text-(--tx2) uppercase hover:bg-(--panel2) hover:text-(--tx)"
        >
          Templates
        </button>
        <button
          onClick={handleSave}
          className="rounded-md px-3 py-1.5 text-[11px] font-medium tracking-[0.12em] text-(--tx2) uppercase hover:bg-(--panel2) hover:text-(--tx)"
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
        {!pro && (
          <button
            onClick={() => st().setDialog('upgrade')}
            className="rounded-md border border-orange-500/50 px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-orange-400 uppercase hover:bg-orange-600/15"
          >
            Upgrade
          </button>
        )}
        <button
          title="Quick capture (current frame → PNG)"
          onClick={() => {
            const s = st()
            void quickCapture(s.project, s.assets, s.pro, s.timeMs).catch((err) =>
              alert(`Capture failed: ${(err as Error).message}`),
            )
          }}
          className="rounded-md bg-(--panel2) px-2.5 py-1.5 text-[13px] hover:bg-orange-600/20"
        >
          📷
        </button>
        <button
          onClick={() => st().setDialog('export')}
          className="rounded-md bg-orange-600 px-4 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-white uppercase hover:bg-orange-500"
        >
          Export ▾
        </button>
      </div>
    </header>
  )
}
