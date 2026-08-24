import { useState, type ReactNode } from 'react'
import { useShots } from './store'
import { exportShot } from './export'
import { SIZE_PRESETS } from '../lib/presets'
import { MiniButton, Segments, SliderRow } from '../components/controls'
import { CircleMinus } from 'lucide-react'
import { ui } from '../lib/ui'

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-(--line) bg-(--raised) p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="t-eyebrow text-(--tx) uppercase">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
          >
            <CircleMinus size={18} strokeWidth={1.75} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ShotsExportDialog() {
  const doc = useShots((s) => s.doc)
  const setDialog = useShots((s) => s.setDialog)
  const exporting = useShots((s) => s.exporting)

  const [scale, setScale] = useState(2)
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp'>('png')
  const [quality, setQuality] = useState(0.92)
  const [error, setError] = useState<string | null>(null)

  const outW = Math.round(doc.size.width * scale)
  const outH = Math.round(doc.size.height * scale)

  const run = async () => {
    setError(null)
    const s = useShots.getState()
    s.setExporting(true)
    try {
      await exportShot(s.doc, s.assets, { width: outW, height: outH, format, quality })
      setDialog(null)
    } catch (err) {
      ui.error(`Export failed: ${(err as Error).message}`)
    } finally {
      useShots.getState().setExporting(false)
    }
  }

  return (
    <Modal title="Export shot" onClose={() => setDialog(null)}>
      <label className="mb-2 block t-eyebrow text-(--tx3) uppercase">
        Resolution: {SIZE_PRESETS.find((p) => p.width === doc.size.width && p.height === doc.size.height)?.name ?? `${doc.size.width}×${doc.size.height}`}
      </label>
      <div className="mb-3 flex gap-1">
        {([1, 2, 3] as const).map((s) => (
          <MiniButton key={s} active={scale === s} onClick={() => setScale(s)}>
            {s}×
          </MiniButton>
        ))}
      </div>

      <Segments
        options={[
          { id: 'png', label: 'PNG' },
          { id: 'jpg', label: 'JPG' },
          { id: 'webp', label: 'WEBP' },
        ]}
        value={format}
        onChange={setFormat}
      />
      {doc.background.type === 'transparent' && format === 'jpg' && (
        <p className="mb-2 t-body-sm text-(--danger)">
          JPG can't store transparency, so this shot will export on a black background. Use PNG or WebP.
        </p>
      )}
      {format !== 'png' && <SliderRow label="Quality" value={quality} min={0.5} max={1} onChange={setQuality} />}

      {error && <p className="mb-2 t-body-sm text-(--danger)">{error}</p>}

      <button
        disabled={exporting}
        onClick={() => void run()}
        className="mt-2 w-full rounded-md bg-(--accent-fill) py-2 t-button text-(--accent-tx) hover:opacity-90 disabled:opacity-60"
      >
        {exporting ? 'Rendering…' : `Export · ${outW}×${outH}`}
      </button>
    </Modal>
  )
}
