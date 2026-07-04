import { useState, type ReactNode } from 'react'
import { useStudio } from '../store'
import { cancelExport, exportImage, exportVideo } from '../lib/export'
import { SIZE_PRESETS } from '../lib/presets'
import { TEMPLATES } from '../lib/presets'
import { MiniButton, Segments, SliderRow } from './controls'

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div
        className={`max-h-[85vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto rounded-xl border border-(--line) bg-(--panel) p-5 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[12px] font-semibold tracking-[0.2em] text-(--tx) uppercase">{title}</h2>
          <button onClick={onClose} className="text-(--tx3) hover:text-(--tx)">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ————— Export dialog (PRD §6.10) —————

export function ExportDialog() {
  const project = useStudio((s) => s.project)
  const pro = useStudio((s) => s.pro)
  const st = useStudio.getState

  const [mode, setMode] = useState<'image' | 'video'>('image')
  const [sizeIdx, setSizeIdx] = useState(0)
  const [customW, setCustomW] = useState(project.exportSize.width)
  const [customH, setCustomH] = useState(project.exportSize.height)
  const [scale, setScale] = useState(1)
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp'>('png')
  const [vFormat, setVFormat] = useState<'mp4' | 'webm'>('mp4')
  const [quality, setQuality] = useState(0.92)
  const [bitrateMbps, setBitrateMbps] = useState(12)
  const [transparent, setTransparent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const custom = sizeIdx === -1
  const baseW = custom ? customW : SIZE_PRESETS[sizeIdx].width
  const baseH = custom ? customH : SIZE_PRESETS[sizeIdx].height
  const outW = Math.round(baseW * (mode === 'image' ? scale : 1))
  const outH = Math.round(baseH * (mode === 'image' ? scale : 1))

  const gated = (msg: string) => {
    setError(msg)
    st().setDialog('upgrade')
  }

  const run = async () => {
    setError(null)
    if (!pro && Math.max(outW, outH) > 2000) return gated('Exports above 1080p-class need Pro.')
    if (mode === 'video' && !pro && project.durationMs > 5000)
      return gated('Videos longer than 5s need Pro.')
    if (mode === 'video' && transparent && vFormat === 'mp4') setVFormat('webm')

    // sync export canvas aspect with the viewport frame
    st().setExportSize(baseW, baseH)
    st().setDialog(null)
    const s = st()
    try {
      if (mode === 'image') {
        s.setExportProgress({ label: 'Rendering image…', done: 0, total: 1 })
        await exportImage(
          s.project,
          s.assets,
          { width: outW, height: outH, format, quality, transparent },
          s.pro,
          s.timeMs,
        )
      } else {
        s.setExportProgress({ label: 'Encoding video…', done: 0, total: 1 })
        await exportVideo(
          s.project,
          s.assets,
          {
            width: Math.floor(outW / 2) * 2,
            height: Math.floor(outH / 2) * 2,
            fps: s.project.fps,
            format: transparent ? 'webm' : vFormat,
            bitrate: bitrateMbps * 1_000_000,
            transparent,
          },
          s.pro,
          (done, total) => s.setExportProgress({ label: 'Encoding video…', done, total }),
        )
      }
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`)
    } finally {
      useStudio.getState().setExportProgress(null)
    }
  }

  return (
    <Modal title="Export" onClose={() => st().setDialog(null)}>
      <Segments
        options={[
          { id: 'image', label: 'Image' },
          { id: 'video', label: 'Video' },
        ]}
        value={mode}
        onChange={setMode}
      />

      <label className="mb-2 block text-[10px] tracking-[0.15em] text-(--tx3) uppercase">Size</label>
      <select
        value={sizeIdx}
        onChange={(e) => setSizeIdx(Number(e.target.value))}
        className="mb-2 w-full rounded border border-(--line) bg-(--panel) px-2 py-1.5 text-[12px] text-(--tx)"
      >
        {SIZE_PRESETS.map((p, i) => (
          <option key={p.name} value={i}>
            {p.name}
          </option>
        ))}
        <option value={-1}>Custom…</option>
      </select>
      {custom && (
        <div className="mb-2 flex items-center gap-2">
          <input
            type="number"
            value={customW}
            onChange={(e) => setCustomW(Number(e.target.value))}
            className="w-24 rounded border border-(--line) bg-transparent px-2 py-1 font-mono text-[12px] text-(--tx)"
          />
          <span className="text-(--tx3)">×</span>
          <input
            type="number"
            value={customH}
            onChange={(e) => setCustomH(Number(e.target.value))}
            className="w-24 rounded border border-(--line) bg-transparent px-2 py-1 font-mono text-[12px] text-(--tx)"
          />
        </div>
      )}

      {mode === 'image' ? (
        <>
          <div className="mb-2 flex gap-1">
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
          {format !== 'png' && (
            <SliderRow label="Quality" value={quality} min={0.5} max={1} onChange={setQuality} />
          )}
        </>
      ) : (
        <>
          <Segments
            options={[
              { id: 'mp4', label: 'MP4 · H.264' },
              { id: 'webm', label: 'WebM · VP9' },
            ]}
            value={vFormat}
            onChange={setVFormat}
          />
          <SliderRow label="Mbps" value={bitrateMbps} min={2} max={40} step={1} onChange={setBitrateMbps} />
          <p className="mb-2 text-[10px] text-(--tx3)">
            {(project.durationMs / 1000).toFixed(1)}s · {project.fps} fps ·{' '}
            {Math.round((project.durationMs / 1000) * project.fps)} frames — rendered offline in your
            browser.
          </p>
        </>
      )}

      <label className="mb-3 flex items-center gap-2 text-[11px] text-(--tx2)">
        <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} className="accent-orange-500" />
        Transparent background {mode === 'video' ? '(forces WebM alpha)' : '(PNG alpha)'}
        {!pro && mode === 'video' && <span className="text-orange-400">◆ Pro</span>}
      </label>

      {error && <p className="mb-2 text-[11px] text-red-400">{error}</p>}

      <button
        onClick={() => {
          if (mode === 'video' && transparent && !pro) {
            st().setDialog('upgrade')
            return
          }
          void run()
        }}
        className="w-full rounded-md bg-orange-600 py-2 text-[12px] font-semibold tracking-[0.14em] text-white uppercase hover:bg-orange-500"
      >
        Export {mode} · {outW}×{outH}
      </button>
      {!pro && (
        <p className="mt-2 text-center text-[10px] text-(--tx3)">
          Free exports include a small watermark · <button className="text-orange-400 underline" onClick={() => st().setDialog('upgrade')}>remove with Pro</button>
        </p>
      )}
    </Modal>
  )
}

// ————— Templates dialog (PRD §6.8) —————

export function TemplatesDialog() {
  const st = useStudio.getState
  return (
    <Modal title="Templates" onClose={() => st().setDialog(null)} wide>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => st().applyTemplate(t.id)}
            className="group overflow-hidden rounded-lg border border-(--line) text-left transition-colors hover:border-orange-500/60"
          >
            <div className="h-20 w-full" style={{ background: t.swatch }} />
            <div className="p-2">
              <p className="text-[12px] font-medium text-(--tx)">{t.name}</p>
              <p className="text-[10px] text-(--tx3)">{t.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  )
}

// ————— Shortcuts dialog —————

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Delete', 'Delete selected keyframes / overlay / device'],
  ['E', 'Export dialog'],
  ['T', 'Templates'],
  ['?', 'This dialog'],
  ['Drag on canvas', 'Orbit camera'],
  ['Scroll on canvas', 'Zoom'],
  ['Right-drag on canvas', 'Pan'],
  ['Ctrl+V', 'Paste screenshot into the selected device'],
]

export function ShortcutsDialog() {
  const st = useStudio.getState
  return (
    <Modal title="Keyboard shortcuts" onClose={() => st().setDialog(null)}>
      <table className="w-full text-[12px]">
        <tbody>
          {SHORTCUTS.map(([k, desc]) => (
            <tr key={k} className="border-b border-(--line) last:border-0">
              <td className="py-1.5 pr-3 font-mono text-[11px] whitespace-nowrap text-orange-400">{k}</td>
              <td className="py-1.5 text-(--tx2)">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

// ————— Upgrade dialog (demo gating — PRD §6.13, no real billing wired) —————

export function UpgradeDialog() {
  const st = useStudio.getState
  const perks = [
    'No watermark on exports',
    '4K image & video export',
    'Videos longer than 5 seconds',
    'Transparent WebM (alpha) video',
    'All premium devices',
  ]
  return (
    <Modal title="Mockup Studio Pro" onClose={() => st().setDialog(null)}>
      <ul className="mb-4 flex flex-col gap-1.5">
        {perks.map((p) => (
          <li key={p} className="flex items-center gap-2 text-[12px] text-(--tx2)">
            <span className="text-orange-500">◆</span> {p}
          </li>
        ))}
      </ul>
      <p className="mb-3 text-[13px] text-(--tx)">
        One-time <span className="font-bold">$29</span> — lifetime license.
      </p>
      <button
        onClick={() => {
          st().setPro(true)
          st().setDialog(null)
        }}
        className="w-full rounded-md bg-orange-600 py-2 text-[12px] font-semibold tracking-[0.14em] text-white uppercase hover:bg-orange-500"
      >
        Unlock Pro (demo — no payment wired)
      </button>
      <p className="mt-2 text-center text-[10px] text-(--tx3)">
        Billing integration (Stripe) is stubbed in this build.
      </p>
    </Modal>
  )
}

// ————— Export progress overlay —————

export function ExportProgressOverlay() {
  const progress = useStudio((s) => s.exportProgress)
  if (!progress) return null
  const pct = progress.total > 1 ? Math.round((progress.done / progress.total) * 100) : null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-80 rounded-xl border border-(--line) bg-(--panel) p-5 text-center shadow-2xl">
        <p className="mb-3 text-[12px] font-medium tracking-[0.15em] text-(--tx) uppercase">
          {progress.label}
        </p>
        <div className="mb-2 h-2 overflow-hidden rounded-full bg-(--panel2)">
          <div
            className="h-full bg-orange-500 transition-all"
            style={{ width: `${pct ?? 40}%` }}
          />
        </div>
        {pct !== null && (
          <p className="mb-3 font-mono text-[11px] text-(--tx3)">
            {progress.done} / {progress.total} frames · {pct}%
          </p>
        )}
        <button
          onClick={cancelExport}
          className="rounded border border-(--line) px-4 py-1.5 text-[11px] tracking-wide text-(--tx2) uppercase hover:text-(--tx)"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
