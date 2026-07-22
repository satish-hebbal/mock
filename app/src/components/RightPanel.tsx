import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Camera,
  FileDown,
  FilePlus,
  FileUp,
  Keyboard,
  LayoutTemplate,
  MoreHorizontal,
  Redo2,
  Save as SaveIcon,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import {
  exportProjectFile,
  importProjectFile,
  persistProject,
  useStudio,
} from '../store'
import { persistShots, useShots } from '../shots/store'
import { quickCapture } from '../lib/export'
import { ui } from '../lib/ui'
import { quickCaptureShot } from '../shots/export'

function IconBtn({
  icon: Icon,
  onClick,
  title,
  disabled,
  active,
}: {
  icon: LucideIcon
  onClick?: () => void
  title: string
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active ? 'bg-(--sel) text-(--tx)' : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
      } disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent`}
    >
      <Icon size={15} strokeWidth={1.9} />
    </button>
  )
}

export function InspectorHeader() {
  const mode = useStudio((s) => s.mode)
  const shots = mode === 'shots'

  const studioName = useStudio((s) => s.project.name)
  const shotsName = useShots((s) => s.doc.name)
  const studioPast = useStudio((s) => s.past.length)
  const studioFuture = useStudio((s) => s.future.length)
  const shotsPast = useShots((s) => s.past.length)
  const shotsFuture = useShots((s) => s.future.length)

  const name = shots ? shotsName : studioName
  const canUndo = shots ? shotsPast > 0 : studioPast > 0
  const canRedo = shots ? shotsFuture > 0 : studioFuture > 0

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

  const setName = (v: string) =>
    shots ? useShots.getState().setName(v) : useStudio.getState().setProjectName(v)
  const undo = () => (shots ? useShots.getState().undo() : useStudio.getState().undo())
  const redo = () => (shots ? useShots.getState().redo() : useStudio.getState().redo())
  const openExport = () =>
    shots ? useShots.getState().setDialog('export') : useStudio.getState().setDialog('export')

  const save = async () => {
    if (shots) await persistShots()
    else await persistProject()
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
  }

  const capture = () => {
    if (shots) {
      const s = useShots.getState()
      void quickCaptureShot(s.doc, s.assets).catch((e) => ui.error(`Capture failed: ${(e as Error).message}`))
    } else {
      const s = useStudio.getState()
      void quickCapture(s.project, s.assets, s.timeMs).catch((e) =>
        ui.error(`Capture failed: ${(e as Error).message}`),
      )
    }
  }

  const menuItem = (Icon: LucideIcon, label: string, action: () => void) => (
    <button
      onClick={() => {
        setMenuOpen(false)
        action()
      }}
      className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)"
    >
      <Icon size={14} strokeWidth={1.8} />
      {label}
    </button>
  )

  return (
    <div className="shrink-0 border-b border-(--line) px-3 py-2.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        spellCheck={false}
        className="mb-2 w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-medium text-(--tx) hover:border-(--line) focus:border-(--line2) focus:outline-none"
      />
      <div className="flex items-center gap-1">
        <IconBtn icon={Undo2} title="Undo" onClick={undo} disabled={!canUndo} />
        <IconBtn icon={Redo2} title="Redo" onClick={redo} disabled={!canRedo} />
        <IconBtn icon={Camera} title="Quick capture → PNG" onClick={capture} />

        <div className="flex-1" />

        <IconBtn icon={SaveIcon} title={saved ? 'Saved' : 'Save'} onClick={() => void save()} active={saved} />

        <div className="relative" ref={menuRef}>
          <IconBtn icon={MoreHorizontal} title="More" onClick={() => setMenuOpen(!menuOpen)} active={menuOpen} />
          {menuOpen && (
            <div className="absolute top-8 right-0 z-30 flex w-52 flex-col gap-0.5 rounded-lg border border-(--line) bg-(--panel) p-1.5 shadow-2xl">
              {!shots && (
                <>
                  {menuItem(LayoutTemplate, 'Templates', () => useStudio.getState().setDialog('templates'))}
                  {menuItem(FilePlus, 'New project', () => {
                    void ui
                      .confirm({
                        title: 'Start a new project?',
                        body: 'Your current work stays saved locally and can be reopened from a file.',
                        confirmLabel: 'New project',
                      })
                      .then((ok) => {
                        if (ok) useStudio.getState().newProject()
                      })
                  })}
                  {menuItem(FileUp, 'Import project…', () => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = '.json,application/json'
                    input.onchange = () => {
                      const f = input.files?.[0]
                      if (f)
                        importProjectFile(f).catch((err) =>
                          ui.error(`Import failed: ${(err as Error).message}`),
                        )
                    }
                    input.click()
                  })}
                  {menuItem(FileDown, 'Export project file', () => void exportProjectFile())}
                  {menuItem(Keyboard, 'Keyboard shortcuts', () => useStudio.getState().setDialog('shortcuts'))}
                </>
              )}
              {menuItem(Camera, 'Quick capture PNG', capture)}
            </div>
          )}
        </div>

        <button
          onClick={openExport}
          className="ml-1 rounded-md bg-(--accent-fill) px-3 py-1.5 text-[11px] font-semibold tracking-[0.06em] text-(--accent-tx) uppercase hover:opacity-90"
        >
          Export
        </button>
      </div>
    </div>
  )
}

export function RightPanel({ children }: { children: ReactNode }) {
  const open = useStudio((s) => s.panelOpen)
  if (!open) return null
  return (
    <div className="flex w-[300px] shrink-0 flex-col border-l border-(--line) bg-(--panel)">
      <InspectorHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
