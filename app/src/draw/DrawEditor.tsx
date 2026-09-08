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
import { Download } from 'lucide-react'
import { Dialog } from '../components/Overlay'
import { MiniButton, Segments } from '../components/controls'
import { ui } from '../lib/ui'
import { track } from '../lib/analytics'
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

    const shape = {
      editor: 'draw',
      kind: action === 'copy' ? 'clipboard' : 'file',
      format,
      width: size.w,
      height: size.h,
      transparent,
      elements: doc.elements.length,
    }
    const startedAt = performance.now()
    track('export_started', shape)

    try {
      if (action === 'copy') {
        await copyToClipboard(doc, images, { transparent, scale })
        ui.toast('Copied to the clipboard')
      } else {
        await download(doc, images, 'drawing', format, { transparent, scale })
      }
      track('export_completed', {
        ...shape,
        duration_ms: Math.round(performance.now() - startedAt),
      })
      close()
    } catch (e) {
      const reason = (e as Error).message
      track('export_failed', { ...shape, reason: reason.slice(0, 120) })
      ui.error(`Export failed: ${reason}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Export drawing" onClose={close}>

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
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-(--accent-fill) t-button text-(--accent-tx) hover:bg-(--accent-fill-hover) disabled:opacity-40"
        >
          <Download size={15} strokeWidth={1.9} />
          {busy ? 'Working…' : 'Download'}
        </button>
      </div>
    </Dialog>
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
