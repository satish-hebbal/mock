import { useState } from 'react'
import { useShots } from './store'
import { exportShot } from './export'
import { SIZE_PRESETS } from '../lib/presets'
import { MiniButton, Segments, SliderRow } from '../components/controls'
import { ui } from '../lib/ui'
import { track } from '../lib/analytics'
import { Dialog } from '../components/Overlay'

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

    const shape = {
      editor: 'shots',
      kind: 'image',
      format,
      width: outW,
      height: outH,
      scale,
      screens: s.doc.images.length,
    }
    const startedAt = performance.now()
    track('export_started', shape)

    try {
      await exportShot(s.doc, s.assets, { width: outW, height: outH, format, quality })
      track('export_completed', {
        ...shape,
        duration_ms: Math.round(performance.now() - startedAt),
      })
      setDialog(null)
    } catch (err) {
      const reason = (err as Error).message
      track('export_failed', { ...shape, reason: reason.slice(0, 120) })
      ui.error(`Export failed: ${reason}`)
    } finally {
      useShots.getState().setExporting(false)
    }
  }

  return (
    <Dialog title="Export shot" onClose={() => setDialog(null)}>
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
        className="mt-2 w-full rounded-md bg-(--accent-fill) py-2 t-button text-(--accent-tx) hover:bg-(--accent-fill-hover) disabled:opacity-60"
      >
        {exporting ? 'Rendering…' : `Export · ${outW}×${outH}`}
      </button>
    </Dialog>
  )
}
