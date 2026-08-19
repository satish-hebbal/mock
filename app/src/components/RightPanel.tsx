import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Camera,
  Download,
  FileDown,
  FilePlus,
  FileUp,
  Keyboard,
  LayoutTemplate,
  MoreHorizontal,
  PanelRightOpen,
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

/**
 * Everything the header does, so the collapsed rail can offer the same actions
 * without a second copy of the studio/shots branching.
 */
function useInspectorActions() {
  const mode = useStudio((s) => s.mode)
  const shots = mode === 'shots'

  const studioName = useStudio((s) => s.project.name)
  const shotsName = useShots((s) => s.doc.name)
  const studioPast = useStudio((s) => s.past.length)
  const studioFuture = useStudio((s) => s.future.length)
  const shotsPast = useShots((s) => s.past.length)
  const shotsFuture = useShots((s) => s.future.length)

  const [saved, setSaved] = useState(false)

  const capture = () => {
    ui.snap()
    if (shots) {
      const s = useShots.getState()
      void quickCaptureShot(s.doc, s.assets).catch((e) =>
        ui.error(`Capture failed: ${(e as Error).message}`),
      )
    } else {
      const s = useStudio.getState()
      void quickCapture(s.project, s.assets, s.timeMs).catch((e) =>
        ui.error(`Capture failed: ${(e as Error).message}`),
      )
    }
  }

  return {
    shots,
    name: shots ? shotsName : studioName,
    canUndo: shots ? shotsPast > 0 : studioPast > 0,
    canRedo: shots ? shotsFuture > 0 : studioFuture > 0,
    saved,
    setName: (v: string) =>
      shots ? useShots.getState().setName(v) : useStudio.getState().setProjectName(v),
    undo: () => (shots ? useShots.getState().undo() : useStudio.getState().undo()),
    redo: () => (shots ? useShots.getState().redo() : useStudio.getState().redo()),
    openExport: () =>
      shots ? useShots.getState().setDialog('export') : useStudio.getState().setDialog('export'),
    capture,
    save: async () => {
      if (shots) await persistShots()
      else await persistProject()
      setSaved(true)
      setTimeout(() => setSaved(false), 1400)
    },
  }
}

export function InspectorHeader() {
  const a = useInspectorActions()
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

  const menuItem = (Icon: LucideIcon, label: string, action: () => void) => (
    <button
      onClick={() => {
        setMenuOpen(false)
        action()
      }}
      className="flex items-center gap-2 rounded-xs px-2 py-1.5 text-left t-body-sm text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)"
    >
      <Icon size={14} strokeWidth={1.8} />
      {label}
    </button>
  )

  return (
    <div className="shrink-0 border-b border-(--line) px-3 py-2.5">
      <div className="flex items-center gap-1">
        <input
          value={a.name}
          onChange={(e) => a.setName(e.target.value)}
          spellCheck={false}
          onKeyDown={(e) => {
            // hand focus back so the single-key shortcuts start working again
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
          }}
          className="min-w-0 flex-1 rounded-xs border border-transparent bg-transparent px-1.5 py-1 t-body font-medium text-(--tx) hover:border-(--line) focus:border-(--line2) focus:outline-none"
        />
        <IconBtn
          icon={PanelRightOpen}
          title="Hide the inspector (])"
          onClick={() => useStudio.getState().setPanelOpen(false)}
        />
      </div>
      <div className="mt-2 flex items-center gap-1">
        <IconBtn icon={Undo2} title="Undo" onClick={a.undo} disabled={!a.canUndo} />
        <IconBtn icon={Redo2} title="Redo" onClick={a.redo} disabled={!a.canRedo} />

        <div className="flex-1" />

        <IconBtn
          icon={SaveIcon}
          title={a.saved ? 'Saved' : 'Save'}
          onClick={() => void a.save()}
          active={a.saved}
        />

        {/* every entry is studio-only, so in Shots there is nothing to open */}
        <div className={`relative ${a.shots ? 'hidden' : ''}`} ref={menuRef}>
          <IconBtn
            icon={MoreHorizontal}
            title="More"
            onClick={() => setMenuOpen(!menuOpen)}
            active={menuOpen}
          />
          {menuOpen && (
            <div className="absolute top-8 right-0 z-30 flex w-52 flex-col gap-0.5 rounded-lg border border-(--line) bg-(--raised) p-1.5">
              {menuItem(LayoutTemplate, 'Templates', () =>
                useStudio.getState().setDialog('templates'),
              )}
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
              {menuItem(Keyboard, 'Keyboard shortcuts', () =>
                useStudio.getState().setDialog('shortcuts'),
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={a.capture}
          title="One click, straight to a PNG at the project's own size. No dialog."
          className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-(--field) t-button text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx)"
        >
          <Camera size={15} strokeWidth={1.9} />
          Quick Snap
        </button>
        <button
          onClick={a.openExport}
          title="Export (E)"
          className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-(--accent-fill) t-button text-(--accent-tx) transition-opacity hover:opacity-90"
        >
          <Download size={15} strokeWidth={1.9} />
          Export
        </button>
      </div>
    </div>
  )
}

/**
 * Collapsed state. The panel used to disappear outright, which took Export —
 * the one irreversible action in the app — off screen with it, and left nothing
 * on the edge to say a panel was ever there. Like the timeline's transport bar,
 * the rail keeps the verbs and drops only the detail.
 */
function CollapsedRail() {
  const a = useInspectorActions()
  return (
    <div className="flex w-13 shrink-0 flex-col items-center gap-1 rounded-lg border border-(--line) bg-(--raised) py-2">
      <IconBtn
        icon={PanelRightOpen}
        title="Show the inspector (])"
        onClick={() => useStudio.getState().setPanelOpen(true)}
      />

      <span className="my-1 h-px w-6 shrink-0 bg-(--line)" />

      <button
        onClick={a.openExport}
        title="Export (E)"
        aria-label="Export"
        className="flex h-8 w-8 items-center justify-center rounded-md bg-(--accent-fill) text-(--accent-tx) transition-opacity hover:opacity-90"
      >
        <Download size={15} strokeWidth={2} />
      </button>

      <span className="my-1 h-px w-6 shrink-0 bg-(--line)" />

      <IconBtn icon={Undo2} title="Undo" onClick={a.undo} disabled={!a.canUndo} />
      <IconBtn icon={Redo2} title="Redo" onClick={a.redo} disabled={!a.canRedo} />
      <IconBtn icon={Camera} title="Quick capture → PNG" onClick={a.capture} />
      <IconBtn
        icon={SaveIcon}
        title={a.saved ? 'Saved' : 'Save'}
        onClick={() => void a.save()}
        active={a.saved}
      />
    </div>
  )
}

export function RightPanel({ children }: { children: ReactNode }) {
  const open = useStudio((s) => s.panelOpen)
  if (!open) return <CollapsedRail />
  return (
    <div className="flex w-[316px] shrink-0 flex-col overflow-hidden rounded-lg border border-(--line) bg-(--raised)">
      <InspectorHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
