/**
 * Draw, on a phone.
 *
 * This is the one tool where the phone layout owes nothing to a sheet. The
 * work is the empty page, so the page gets the whole screen and nothing rises
 * over it. What the desktop spreads across a notch, a rail and a zoom cluster
 * comes down to two things a thumb can reach:
 *
 *   The dock      the tools you switch between constantly, in one row along
 *                 the bottom edge: select, draw, shapes, text, erase. The five
 *                 shapes share one slot (the dock shows whichever you used
 *                 last) and the rarer tools sit behind More, both opening as a
 *                 small tray right above the button that opened them.
 *   The pen tray  the same pens-in-a-cup the desktop has, standing on the left
 *                 edge where it goes when the canvas is narrow. It already
 *                 turns into the palette and the size controls, and rolls up
 *                 into a disc when you want the page clear.
 *
 * Two fingers pinch and pan, which the canvas handles itself; one finger always
 * does what the tool says. Keyboard shortcuts do not exist here, so everything
 * they reached on the desktop has a button.
 */

import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Circle,
  Diamond,
  Download,
  Eraser,
  Hand,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { pickMediaFile, useStudio } from '../store'
import { ui } from '../lib/ui'
import {
  MobileIconButton,
  MobilePrimary,
  MobileTopBar,
} from '../components/mobile/MobileShell'
import { DrawCanvas } from './DrawCanvas'
import { PenTray } from './PenTray'
import { DrawExportDialog } from './DrawEditor'
import { useDraw } from './store'
import type { DrawTool } from './types'

const SHAPES: { id: DrawTool; label: string; icon: LucideIcon }[] = [
  { id: 'rect', label: 'Box', icon: Square },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'diamond', label: 'Diamond', icon: Diamond },
  { id: 'arrow', label: 'Arrow', icon: ArrowRight },
  { id: 'line', label: 'Line', icon: Minus },
]

type Tray = 'shapes' | 'more' | null

function Bar() {
  const canUndo = useDraw((s) => s.past.length > 0)
  const canRedo = useDraw((s) => s.future.length > 0)
  const empty = useDraw((s) => s.doc.elements.length === 0)
  const st = useDraw.getState
  return (
    <MobileTopBar
      title="Draw"
      actions={
        <>
          <MobileIconButton icon={Undo2} label="Undo" onClick={() => st().undo()} disabled={!canUndo} />
          <MobileIconButton icon={Redo2} label="Redo" onClick={() => st().redo()} disabled={!canRedo} />
        </>
      }
      primary={
        <MobilePrimary icon={Download} label="Export" disabled={empty} onClick={() => st().setDialog('export')} />
      }
    />
  )
}

function DockButton({
  icon: Icon,
  label,
  on,
  open,
  onClick,
}: {
  icon: LucideIcon
  label: string
  on?: boolean
  /** its tray is showing */
  open?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-expanded={open}
      className={`m-press flex flex-col items-center justify-center gap-1 transition-colors ${
        on || open ? 'text-(--tx)' : 'text-(--tx3)'
      }`}
    >
      <span
        className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 ease-settle ${
          on ? 'bg-(--sel)' : ''
        }`}
      >
        <Icon size={20} strokeWidth={on ? 2 : 1.75} />
        {open !== undefined && (
          // a caret-sized tick that says this slot opens something
          <span className="absolute right-3 bottom-1 h-1 w-1 rounded-full bg-current opacity-60" />
        )}
      </span>
      <span className={`t-caption leading-none ${on ? 'font-medium' : ''}`}>{label}</span>
    </button>
  )
}

function TrayButton({
  icon: Icon,
  label,
  on,
  danger,
  onClick,
}: {
  icon: LucideIcon
  label: string
  on?: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`m-press flex w-16 shrink-0 flex-col items-center gap-1.5 rounded-xl py-2 transition-colors ${
        on ? 'bg-(--sel) text-(--tx)' : danger ? 'text-(--danger)' : 'text-(--tx2) active:bg-(--panel3)'
      }`}
    >
      <Icon size={20} strokeWidth={1.8} />
      <span className="t-caption leading-none">{label}</span>
    </button>
  )
}

/** The small tray a dock slot opens, sitting just above the dock. */
function Flyout({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <>
      {/* a tap anywhere else puts it away, and does nothing else */}
      <div className="absolute inset-0 z-40" onPointerDown={onClose} />
      <div className="m-fade absolute inset-x-3 bottom-3 z-50 flex justify-center">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-(--line) bg-(--raised)/95 p-1.5 shadow-[0_12px_32px_rgb(0_0_0/0.28)] backdrop-blur-md [scrollbar-width:none]">
          {children}
        </div>
      </div>
    </>
  )
}

/** Zoom, only once it has moved: tap to go back to 100%. */
function ZoomPill() {
  const zoom = useDraw((s) => s.viewport.zoom)
  if (Math.abs(zoom - 1) < 0.01) return null
  return (
    <button
      onClick={() => useDraw.getState().resetZoom()}
      className="m-press pointer-events-auto absolute top-3 right-3 z-20 flex h-9 items-center rounded-full border border-(--line) bg-(--raised)/85 px-3 t-caption tabular-nums text-(--tx2) shadow-md backdrop-blur-md"
    >
      {Math.round(zoom * 100)}%
    </button>
  )
}

/** Said once, on a first visit: the two gestures that have no button. */
function FirstHint() {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem('ms-draw-touch-hint') !== '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    if (!show) return
    const done = () => {
      setShow(false)
      try {
        localStorage.setItem('ms-draw-touch-hint', '1')
      } catch {
        /* private mode: it will simply say it again next time */
      }
    }
    const t = setTimeout(done, 6000)
    window.addEventListener('pointerdown', done, { once: true })
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', done)
    }
  }, [show])
  if (!show) return null
  return (
    <div className="m-fade pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
      <span className="rounded-full border border-(--line) bg-(--raised)/90 px-3.5 py-2 t-caption text-(--tx2) shadow-md backdrop-blur-md">
        Pinch to zoom · two fingers to move the page
      </span>
    </div>
  )
}

export function DrawMobile() {
  const hydrated = useDraw((s) => s.hydrated)
  const dialog = useDraw((s) => s.dialog)
  const hydrate = useDraw((s) => s.hydrate)
  const background = useDraw((s) => s.doc.background)
  const tool = useDraw((s) => s.tool)
  const locked = useDraw((s) => s.toolLocked)
  const theme = useStudio((s) => s.theme)
  const [tray, setTray] = useState<Tray>(null)
  const [lastShape, setLastShape] = useState<DrawTool>('rect')
  const st = useDraw.getState

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // the neutral ink follows the paper and the theme, as on the desktop
  useEffect(() => {
    if (hydrated) useDraw.getState().syncInkToPaper(theme === 'dark')
  }, [hydrated, background, theme])

  useEffect(() => {
    if (SHAPES.some((s) => s.id === tool)) setLastShape(tool)
  }, [tool])

  const pick = (t: DrawTool) => {
    st().setTool(t)
    setTray(null)
  }
  const shape = SHAPES.find((s) => s.id === lastShape) ?? SHAPES[0]
  const onShape = SHAPES.some((s) => s.id === tool)
  const onMore = tool === 'note' || tool === 'hand'

  return (
    <div className="flex h-full flex-col">
      <Bar />
      <div className="relative min-h-0 flex-1 overflow-hidden border-t border-(--line)">
        {hydrated && (
          <>
            <DrawCanvas />
            <PenTray />
            <ZoomPill />
            <FirstHint />
          </>
        )}

        {tray === 'shapes' && (
          <Flyout onClose={() => setTray(null)}>
            {SHAPES.map((s) => (
              <TrayButton key={s.id} icon={s.icon} label={s.label} on={tool === s.id} onClick={() => pick(s.id)} />
            ))}
          </Flyout>
        )}

        {tray === 'more' && (
          <Flyout onClose={() => setTray(null)}>
            <TrayButton icon={StickyNote} label="Note" on={tool === 'note'} onClick={() => pick('note')} />
            <TrayButton
              icon={ImageIcon}
              label="Image"
              onClick={() => {
                setTray(null)
                pickMediaFile((f) => void st().importImage(f), false)
              }}
            />
            <TrayButton icon={Hand} label="Hand" on={tool === 'hand'} onClick={() => pick('hand')} />
            <TrayButton
              icon={locked ? Lock : LockOpen}
              label={locked ? 'Locked' : 'Lock tool'}
              on={locked}
              onClick={() => {
                st().setToolLocked(!locked)
                ui.toast(locked ? 'Tools go back to Select after each shape' : 'The tool stays picked after each shape')
              }}
            />
            <TrayButton
              icon={Trash2}
              label="Clear"
              danger
              onClick={() => {
                setTray(null)
                st().clear()
                ui.toast('Page cleared. Undo brings it back')
              }}
            />
          </Flyout>
        )}
      </div>

      <nav className="shrink-0 border-t border-(--line) bg-(--raised) pb-[env(safe-area-inset-bottom)]">
        <div className="grid h-16 grid-cols-6">
          <DockButton icon={MousePointer2} label="Select" on={tool === 'select'} onClick={() => pick('select')} />
          <DockButton icon={Pencil} label="Draw" on={tool === 'freedraw'} onClick={() => pick('freedraw')} />
          <DockButton
            icon={shape.icon}
            label="Shapes"
            on={onShape}
            open={tray === 'shapes'}
            onClick={() => {
              // picks the shape it shows, and offers the other four right above it
              if (!onShape) st().setTool(lastShape)
              setTray(tray === 'shapes' ? null : 'shapes')
            }}
          />
          <DockButton icon={Type} label="Text" on={tool === 'text'} onClick={() => pick('text')} />
          <DockButton icon={Eraser} label="Erase" on={tool === 'eraser'} onClick={() => pick('eraser')} />
          <DockButton
            icon={MoreHorizontal}
            label="More"
            on={onMore}
            open={tray === 'more'}
            onClick={() => setTray(tray === 'more' ? null : 'more')}
          />
        </div>
      </nav>

      {dialog === 'export' && <DrawExportDialog />}
    </div>
  )
}
