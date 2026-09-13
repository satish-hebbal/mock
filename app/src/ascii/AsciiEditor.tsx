/**
 * ASCII, assembled.
 *
 * The panel on the left and the picture in the middle. No inspector on the
 * right: unlike the 3D studio there is no selection here, so there is nothing
 * for a second panel to be about, and a column of empty chrome next to a
 * picture is worse than no column.
 *
 * Which leaves undo, redo and Export with nowhere to live, since every other
 * editor keeps those in a panel header. They go in the canvas's own top edge,
 * cut into it the way Studio's gizmos and Draw's tools are, so they cost the
 * picture no pixels instead of covering some of it. The corner rather than the
 * centre: a centred pocket is for tools that act on the thing under them, and
 * these three act on the document.
 */

import { useEffect, type ComponentType } from 'react'
import { Download, Redo2, RotateCcw, Undo2 } from 'lucide-react'
import { useStudio } from '../store'
import { HoldButton } from '../components/HoldButton'
import { NotchedFrame } from '../components/NotchedCanvas'
import { NOTCH_BUTTON, NOTCH_GAP, NOTCH_PAD } from '../lib/notch'
import { ASCII_NOTCH, EXPORT_W, START_W } from './notch'
import { useAscii } from './store'
import { AsciiCanvas } from './AsciiCanvas'
import { AsciiLeftPanel } from './AsciiLeftPanel'
import { AsciiExportDialog } from './AsciiExportDialog'

function NotchButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  label: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{ width: NOTCH_BUTTON, height: NOTCH_BUTTON }}
      /* dim by colour rather than by opacity: the pocket floor is the app
         behind the canvas, and a faded secondary ink on it stops being visible
         at all rather than reading as unavailable */
      className={`flex shrink-0 items-center justify-center rounded-md transition-colors ${
        disabled ? 'cursor-default text-(--tx3)' : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
      }`}
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  )
}

function ExportButton() {
  const ready = useAscii((s) => s.bitmap !== null)
  return (
    <button
      onClick={() => useAscii.getState().setDialog('export')}
      disabled={!ready}
      title="Export (E)"
      style={{ width: EXPORT_W, height: NOTCH_BUTTON }}
      className="flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-(--accent-fill) t-button text-(--accent-tx) hover:bg-(--accent-fill-hover) disabled:opacity-40"
    >
      <Download size={14} strokeWidth={1.9} />
      Export
    </button>
  )
}

/** The row itself, laid out identically whether it is in the hole or floating. */
function CanvasRow() {
  const canUndo = useAscii((s) => s.past.length > 0)
  const canRedo = useAscii((s) => s.future.length > 0)
  const st = useAscii.getState

  return (
    <>
      <NotchButton
        icon={Undo2}
        label="Undo (Ctrl+Z)"
        onClick={() => st().undo()}
        disabled={!canUndo}
      />
      <NotchButton
        icon={Redo2}
        label="Redo (Ctrl+Shift+Z)"
        onClick={() => st().redo()}
        disabled={!canRedo}
      />
      {/*
        Held rather than clicked, the same as every other editor's Start over:
        it throws away the picture and the whole treatment, and a hold proves
        the intent by the gesture instead of interrupting with a dialog nobody
        reads. The width comes from the variable the pocket was cut against.
      */}
      <HoldButton
        icon={<RotateCcw size={14} strokeWidth={2} />}
        label="Start over"
        hint="Clear the picture and the settings"
        onHold={() => st().startOver()}
        spinIcon
        /* the pocket is a few points below the top of the window, so the nudge
           has to drop into the canvas or it plays off the top of the screen */
        hintBelow
        className="w-(--start-w) justify-center"
      />
      <ExportButton />
    </>
  )
}

function CanvasBar({ notched, centerX }: { notched: boolean; centerX: number }) {
  // the pill inside reads its width from here, so the row and the hole it was
  // cut for can never be given two different numbers
  const width = { ['--start-w' as string]: `${START_W}px` }

  // too narrow to cut: the row falls back to a plate laid on the picture, which
  // is worse and still usable, rather than a path folded inside out
  if (!notched) {
    return (
      <div
        style={{ padding: NOTCH_PAD - 1, gap: NOTCH_GAP, ...width }}
        className="absolute top-3 right-3 z-20 flex items-center rounded-lg border border-(--line) bg-(--raised)/85 backdrop-blur-md"
      >
        <CanvasRow />
      </div>
    )
  }

  /*
   * Placed from the same whole-pixel centre the path is cut at, rather than
   * centring with a half-width translate: on an odd-width panel those land on
   * different halves of a pixel and the row drifts out of its own hole.
   */
  return (
    <div
      className="absolute z-20 flex items-center"
      style={{
        left: centerX - ASCII_NOTCH.width / 2 + NOTCH_PAD,
        top: NOTCH_PAD,
        gap: NOTCH_GAP,
        ...width,
      }}
    >
      <CanvasRow />
    </div>
  )
}

export function AsciiEditor() {
  const hydrated = useAscii((s) => s.hydrated)
  const dialog = useAscii((s) => s.dialog)
  const hydrate = useAscii((s) => s.hydrate)
  const theme = useStudio((s) => s.theme)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  /*
   * A fresh document takes its paper from the app theme.
   *
   * Only a fresh one. Once there is a picture, the paper is a decision somebody
   * made, and flipping the app to light mode is not a request to repaint their
   * artwork. This is the same reasoning Draw uses for its ink.
   */
  useEffect(() => {
    if (!hydrated) return
    const s = useAscii.getState()
    if (s.doc.assetId) return
    const paper = theme === 'light' ? '#f5f6f6' : '#08090a'
    const ink = theme === 'light' ? '#0f1011' : '#f7f8f8'
    if (s.doc.backdrop.color === paper) return
    s.patch((d) => {
      d.backdrop.color = paper
      d.color.ink = ink
    })
  }, [hydrated, theme])

  return (
    <>
      <main className="flex min-h-0 flex-1 gap-2">
        <AsciiLeftPanel />
        <NotchedFrame
          className="min-h-0 min-w-0 flex-1"
          notch={ASCII_NOTCH}
          bar={(p) => <CanvasBar notched={p.notched} centerX={p.centerX} />}
        >
          {hydrated && <AsciiCanvas />}
        </NotchedFrame>
      </main>
      {dialog === 'export' && <AsciiExportDialog />}
    </>
  )
}
