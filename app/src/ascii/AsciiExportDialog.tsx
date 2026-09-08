/**
 * Export.
 *
 * Three destinations on three tabs, in the order they get reached for: a
 * picture, the characters, and a mockup. The third is the one the reference
 * tools cannot offer at all, so it is a peer of the other two rather than an
 * afterthought at the bottom.
 *
 * The text tab is the only one that can be genuinely unavailable, and it says
 * why rather than going grey: a tile style has no characters to give, and
 * "switch to a text style" is a useful sentence where a disabled button is not.
 */

import { useMemo, useState } from 'react'
import { CircleMinus, Copy, Download, Boxes, Image as ImageIcon } from 'lucide-react'
import { InfoTip, MiniButton, Segments } from '../components/controls'
import { ui } from '../lib/ui'
import { useAscii } from './store'
import {
  canExportText,
  copyImage,
  copyText,
  downloadImage,
  downloadText,
  exportShape,
  exportSize,
  sendToMockup,
  trackExport,
  TEXT_FORMATS,
  type ImageFormat,
  type TextFormat,
} from './export'
import { textGrid } from './text'

type Tab = 'image' | 'text' | 'mockup'

export function AsciiExportDialog() {
  const doc = useAscii((s) => s.doc)
  const bitmap = useAscii((s) => s.bitmap)
  const close = () => useAscii.getState().setDialog(null)

  const [tab, setTab] = useState<Tab>('image')
  const [format, setFormat] = useState<ImageFormat>('png')
  const [scale, setScale] = useState(2)
  const [textFormat, setTextFormat] = useState<TextFormat>('txt')
  const [busy, setBusy] = useState(false)

  const size = exportSize(doc, scale)
  const textOk = canExportText(doc)
  const ready = bitmap !== null

  /** Every action goes through one wrapper, so the funnel is measured once. */
  const run = async (shape: Record<string, string | number | boolean>, fn: () => Promise<void> | void) => {
    setBusy(true)
    const startedAt = performance.now()
    trackExport('export_started', shape)
    try {
      await fn()
      trackExport('export_completed', { ...shape, duration_ms: Math.round(performance.now() - startedAt) })
    } catch (e) {
      const reason = (e as Error).message
      trackExport('export_failed', { ...shape, reason: reason.slice(0, 120) })
      ui.error(`Export failed: ${reason}`)
    } finally {
      setBusy(false)
    }
  }

  /* Cutting the grid is real work, and switching tabs or picking a format is
     not a reason to redo it. Only the document and the source can change it. */
  const counts = useMemo(
    () => (bitmap && textOk ? textGrid(doc, bitmap) : null),
    [doc, bitmap, textOk],
  )

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onMouseDown={close}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-(--line) bg-(--raised) p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="t-eyebrow text-(--tx) uppercase">Export</h2>
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
            { id: 'image', label: 'Picture' },
            { id: 'text', label: 'Text' },
            { id: 'mockup', label: 'Mockup' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'image' && (
          <>
            <Segments
              options={[
                { id: 'png', label: 'PNG' },
                { id: 'jpg', label: 'JPG' },
              ]}
              value={format}
              onChange={setFormat}
            />
            <label className="mb-2 block t-eyebrow text-(--tx3) uppercase">Scale</label>
            <div className="mb-3 flex gap-1">
              {([1, 2, 3, 4] as const).map((s) => (
                <MiniButton key={s} active={scale === s} onClick={() => setScale(s)}>
                  {s}×
                </MiniButton>
              ))}
            </div>
            <p className="mb-4 flex items-center gap-1 t-caption text-(--tx3) tabular-nums">
              {size.w} × {size.h} px
              {format === 'jpg' && doc.backdrop.mode === 'transparent' && (
                <InfoTip>JPG carries no alpha, so the paper colour is filled in behind the art.</InfoTip>
              )}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  void run(exportShape(doc, { kind: 'clipboard', format: 'png', scale }), async () => {
                    await copyImage(doc, bitmap, scale)
                    ui.toast('Copied to the clipboard')
                    close()
                  })
                }
                disabled={busy || !ready}
                className="h-9 flex-1 rounded-md bg-(--field) t-button text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx) disabled:opacity-40"
              >
                Copy PNG
              </button>
              <button
                onClick={() =>
                  void run(
                    exportShape(doc, { kind: 'file', format, scale, width: size.w, height: size.h }),
                    async () => {
                      await downloadImage(doc, bitmap, format, scale)
                      close()
                    },
                  )
                }
                disabled={busy || !ready}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-(--accent-fill) t-button text-(--accent-tx) transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Download size={15} strokeWidth={1.9} />
                {busy ? 'Working…' : 'Download'}
              </button>
            </div>
          </>
        )}

        {tab === 'text' && (
          <>
            {!textOk ? (
              <p className="t-body-sm text-(--tx2)">
                No characters in this style. Try Characters, Blocks or Braille.
              </p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap gap-1">
                  {TEXT_FORMATS.map((f) => (
                    <MiniButton
                      key={f.id}
                      active={textFormat === f.id}
                      title={f.hint}
                      onClick={() => setTextFormat(f.id)}
                    >
                      {f.label}
                    </MiniButton>
                  ))}
                </div>
                {counts && (
                  <p className="mb-4 flex items-center gap-1 t-caption text-(--tx3) tabular-nums">
                    {counts.cols} × {counts.rows} characters
                    <InfoTip>{TEXT_FORMATS.find((f) => f.id === textFormat)?.hint}</InfoTip>
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      void run(exportShape(doc, { kind: 'clipboard', format: textFormat }), async () => {
                        await copyText(doc, bitmap!, textFormat)
                        ui.toast('Characters copied')
                        close()
                      })
                    }
                    disabled={busy || !ready}
                    className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-(--field) t-button text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx) disabled:opacity-40"
                  >
                    <Copy size={14} strokeWidth={1.9} />
                    Copy
                  </button>
                  <button
                    onClick={() =>
                      void run(exportShape(doc, { kind: 'file', format: textFormat }), () => {
                        downloadText(doc, bitmap!, textFormat)
                        close()
                      })
                    }
                    disabled={busy || !ready}
                    className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-(--accent-fill) t-button text-(--accent-tx) transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    <Download size={15} strokeWidth={1.9} />
                    Download
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'mockup' && (
          <>
            <p className="mb-3 flex items-center gap-1 t-caption text-(--tx3) tabular-nums">
              Send as a screen, {doc.size.width * 2} × {doc.size.height * 2} px
              <InfoTip>
                Twice document size, so whatever sits it on a device still has pixels to work with.
              </InfoTip>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  void run(exportShape(doc, { kind: 'handoff', target: 'shots' }), async () => {
                    await sendToMockup(doc, bitmap, 'shots')
                    close()
                  })
                }
                disabled={busy || !ready}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-(--field) t-button text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx) disabled:opacity-40"
              >
                <ImageIcon size={15} strokeWidth={1.9} />
                Shots
              </button>
              <button
                onClick={() =>
                  void run(exportShape(doc, { kind: 'handoff', target: 'studio' }), async () => {
                    await sendToMockup(doc, bitmap, 'studio')
                    close()
                  })
                }
                disabled={busy || !ready}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-(--field) t-button text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx) disabled:opacity-40"
              >
                <Boxes size={15} strokeWidth={1.9} />
                3D Studio
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
