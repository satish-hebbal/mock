/**
 * Draw, assembled.
 *
 * One canvas, and three things floating on it: the tool rail on the right, the
 * pen tray on its edge, the zoom cluster bottom-left. Nothing docks, nothing
 * takes a column, and there is no properties panel, because the tray is already
 * a thing that changes shape and the properties went into it.
 *
 * The earlier arrangement had a bar across the top *and* a 316px inspector
 * docked to the right, which between them spent most of the window on chrome
 * for a tool whose entire job is the empty space in the middle.
 */

import { useEffect, useState } from 'react'
import { useStudio } from '../store'
import { CircleMinus, Download } from 'lucide-react'
import { MiniButton, Segments } from '../components/controls'
import { ui } from '../lib/ui'
import { DrawCanvas } from './DrawCanvas'
import { PenTray } from './PenTray'
import { DrawCorner, DrawNotchBar, ZoomBar } from './ToolRail'
import { DRAW_NOTCH } from './shapeTools'
import { NotchedCanvas } from '../components/NotchedCanvas'
import { copyToClipboard, download, exportSize } from './export'
import { useDraw } from './store'

function DrawExportDialog() {
  const doc = useDraw((s) => s.doc)
  const images = useDraw((s) => s.images)
  const close = () => useDraw.getState().setDialog(null)

  const [format, setFormat] = useState<'png' | 'svg'>('png')
  const [scale, setScale] = useState(2)
  const [transparent, setTransparent] = useState(false)
  const [busy, setBusy] = useState(false)

  const size = exportSize(doc, format === 'svg' ? 1 : scale)
  const empty = doc.elements.length === 0

  const run = async (action: 'save' | 'copy') => {
    setBusy(true)
    try {
      if (action === 'copy') {
        await copyToClipboard(doc, images, { transparent, scale })
        ui.toast('Copied to the clipboard')
      } else {
        await download(doc, images, 'drawing', format, { transparent, scale })
      }
      close()
    } catch (e) {
      ui.error(`Export failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onMouseDown={close}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-(--line) bg-(--raised) p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="t-eyebrow text-(--tx) uppercase">Export drawing</h2>
          <button
            onClick={close}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
          >
            <CircleMinus size={18} strokeWidth={1.75} />
          </button>
        </div>

        <Segments
          options={[
            { id: 'png', label: 'PNG' },
            { id: 'svg', label: 'SVG' },
          ]}
          value={format}
          onChange={setFormat}
        />

        {/* SVG is resolution-free, so a scale would be a lie there */}
        {format === 'png' && (
          <>
            <label className="mb-2 block t-eyebrow text-(--tx3) uppercase">Scale</label>
            <div className="mb-3 flex gap-1">
              {([1, 2, 3] as const).map((s) => (
                <MiniButton key={s} active={scale === s} onClick={() => setScale(s)}>
                  {s}×
                </MiniButton>
              ))}
            </div>
          </>
        )}

        <button
          onClick={() => setTransparent(!transparent)}
          aria-pressed={transparent}
          className={`mb-3 h-8 w-full rounded-sm t-body-sm transition-colors ${
            transparent ? 'bg-(--sel) text-(--tx)' : 'bg-(--field) text-(--tx2) hover:text-(--tx)'
          }`}
        >
          {transparent ? 'Transparent background' : 'Keep the paper'}
        </button>

        <p className="mb-4 t-caption text-(--tx3)">
          {empty ? 'Nothing on the canvas yet.' : `Trimmed to the drawing — ${size.w} × ${size.h}px.`}
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => void run('copy')}
            disabled={busy || empty}
            className="h-9 flex-1 rounded-md bg-(--field) t-button text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx) disabled:opacity-40"
          >
            Copy PNG
          </button>
          <button
            onClick={() => void run('save')}
            disabled={busy || empty}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-(--accent-fill) t-button text-(--accent-tx) transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Download size={15} strokeWidth={1.9} />
            {busy ? 'Working…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The panning hint, shown only while the sheet is blank.
 *
 * Excalidraw prints this under its toolbar permanently. Permanently is right
 * for a page anyone might land on cold, and wrong for a tool inside an app you
 * already opened on purpose: after the first drawing it is a line of text
 * sitting on your canvas forever. So it greets an empty sheet and then gets out
 * of the way, which is also the only moment the canvas has room to spare.
 */
function EmptyHint() {
  const empty = useDraw((s) => s.doc.elements.length === 0)
  if (!empty) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-24 text-center select-none">
      <p className="t-body text-(--tx3)">Pick a pen and draw.</p>
      <p className="mt-1.5 t-caption text-(--tx3)">
        Hold{' '}
        <kbd className="rounded-xs border border-(--line2) bg-(--panel3) px-1 t-mono text-[11px] text-(--tx2)">
          Space
        </kbd>{' '}
        or the scroll wheel to move the canvas
      </p>
    </div>
  )
}

export function DrawEditor() {
  const hydrated = useDraw((s) => s.hydrated)
  const dialog = useDraw((s) => s.dialog)
  const hydrate = useDraw((s) => s.hydrate)
  const background = useDraw((s) => s.doc.background)
  const theme = useStudio((s) => s.theme)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  /*
   * Keep the neutral ink legible against whatever is behind the drawing. Both
   * inputs matter: the paper colour obviously, and the app theme because
   * transparent and checkered paper show the app through.
   */
  useEffect(() => {
    if (hydrated) useDraw.getState().syncInkToPaper(theme === 'dark')
  }, [hydrated, background, theme])

  return (
    <>
      <main className="flex min-h-0 flex-1">
        {/*
         * The tools live in a bite taken out of the canvas rather than on a bar
         * laid over it, so they cost the drawing nothing. Undo and redo take the
         * opposite corner of the same band; everything else floats.
         */}
        <NotchedCanvas
          notch={DRAW_NOTCH}
          bar={({ notched, centerX, depth }) => (
            <>
              <DrawNotchBar notched={notched} centerX={centerX} depth={depth} />
              <DrawCorner />
            </>
          )}
        >
          {hydrated && (
            <>
              <DrawCanvas />
              <EmptyHint />
              <PenTray />
              <ZoomBar />
            </>
          )}
        </NotchedCanvas>
      </main>
      {dialog === 'export' && <DrawExportDialog />}
    </>
  )
}
