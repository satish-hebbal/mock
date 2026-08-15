import { useState, type ReactNode } from 'react'
import { useStudio } from '../store'
import { cancelExport, exportImage, exportImageBatch, exportVideo } from '../lib/export'
import { SIZE_PRESETS } from '../lib/presets'
import { TEMPLATES } from '../lib/presets'
import { SHORTCUT_GROUPS } from '../lib/shortcuts'
import { CircleMinus } from 'lucide-react'
import { ui } from '../lib/ui'
import { Dropdown, MiniButton, Segments, SliderRow } from './controls'

/** Sentinel size option: follow the project's frame instead of a fixed preset. */
const FRAME_IDX = -2

function Modal({
  title,
  onClose,
  children,
  wide,
  aside,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  /** small note rendered next to the title (e.g. the key that toggles it) */
  aside?: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div
        className={`max-h-[85vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto rounded-xl border border-(--line) bg-(--panel) p-5 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="text-[12px] font-semibold tracking-[0.2em] text-(--tx) uppercase">{title}</h2>
            {aside}
          </div>
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

// ————— Export dialog (PRD §6.10) —————

export function ExportDialog() {
  const project = useStudio((s) => s.project)
  const st = useStudio.getState

  const [mode, setMode] = useState<'image' | 'video' | 'batch'>('image')
  // -2 = the project's own frame, the shape you actually composed against
  const [sizeIdx, setSizeIdx] = useState(FRAME_IDX)
  const [customW, setCustomW] = useState(project.exportSize.width)
  const [customH, setCustomH] = useState(project.exportSize.height)
  const [scale, setScale] = useState(1)
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp'>('png')
  const [vFormat, setVFormat] = useState<'mp4' | 'webm'>('mp4')
  const [quality, setQuality] = useState(0.92)
  const [bitrateMbps, setBitrateMbps] = useState(12)
  const [transparent, setTransparent] = useState(false)
  const [motionBlur, setMotionBlur] = useState(false)
  const [batchIdxs, setBatchIdxs] = useState<number[]>([0, 2, 3])
  const [error, setError] = useState<string | null>(null)

  const custom = sizeIdx === -1
  const frame = sizeIdx === FRAME_IDX
  const baseW = frame ? project.exportSize.width : custom ? customW : SIZE_PRESETS[sizeIdx].width
  const baseH = frame ? project.exportSize.height : custom ? customH : SIZE_PRESETS[sizeIdx].height
  const outW = Math.round(baseW * (mode === 'image' ? scale : 1))
  const outH = Math.round(baseH * (mode === 'image' ? scale : 1))

  const run = async () => {
    setError(null)
    if (mode === 'video' && transparent && vFormat === 'mp4') setVFormat('webm')

    // sync export canvas aspect with the viewport frame
    if (mode !== 'batch') st().setExportSize(baseW, baseH)
    st().setDialog(null)
    const s = st()
    try {
      if (mode === 'image') {
        s.setExportProgress({ label: 'Rendering image…', done: 0, total: 1 })
        await exportImage(
          s.project,
          s.assets,
          { width: outW, height: outH, format, quality, transparent },
          s.timeMs,
        )
      } else if (mode === 'batch') {
        const sizes = batchIdxs.map((i) => SIZE_PRESETS[i])
        await exportImageBatch(
          s.project,
          s.assets,
          sizes,
          format,
          quality,
          transparent,
          s.timeMs,
          (done, total, label) => s.setExportProgress({ label, done, total }),
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
            motionBlurSamples: motionBlur ? 6 : 1,
          },
          (done, total) => s.setExportProgress({ label: 'Encoding video…', done, total }),
        )
      }
    } catch (err) {
      ui.error(`Export failed: ${(err as Error).message}`)
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
          { id: 'batch', label: 'Batch' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'batch' ? (
        <>
          <label className="mb-2 block text-[10px] tracking-[0.15em] text-(--tx3) uppercase">
            Sizes to export
          </label>
          <div className="mb-2 max-h-48 overflow-y-auto rounded border border-(--line) p-1">
            {SIZE_PRESETS.map((p, i) => (
              <label
                key={p.name}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] text-(--tx2) hover:bg-(--panel2)"
              >
                <input
                  type="checkbox"
                                   checked={batchIdxs.includes(i)}
                  onChange={(e) =>
                    setBatchIdxs((prev) =>
                      e.target.checked ? [...prev, i].sort((a, b) => a - b) : prev.filter((x) => x !== i),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
          <p className="mb-2 text-[10px] text-(--tx3)">
            {batchIdxs.length} size{batchIdxs.length === 1 ? '' : 's'} · one file each, downloaded in
            sequence.
          </p>
        </>
      ) : (
        <>
          <label className="mb-2 block text-[10px] tracking-[0.15em] text-(--tx3) uppercase">Size</label>
          <div className="mb-2">
            <Dropdown
              value={sizeIdx}
              onChange={setSizeIdx}
              options={[
                {
                  value: FRAME_IDX,
                  label: `Project frame ${project.exportSize.width}×${project.exportSize.height}`,
                },
                ...SIZE_PRESETS.map((p, i) => ({ value: i, label: p.name })),
                { value: -1, label: 'Custom…' },
              ]}
            />
          </div>
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
        </>
      )}

      {mode !== 'video' ? (
        <>
          {mode === 'image' && (
            <div className="mb-2 flex gap-1">
              {([1, 2, 3] as const).map((s) => (
                <MiniButton key={s} active={scale === s} onClick={() => setScale(s)}>
                  {s}×
                </MiniButton>
              ))}
            </div>
          )}
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
          <label className="mb-2 flex items-center gap-2 text-[11px] text-(--tx2)">
            <input
              type="checkbox"
              checked={motionBlur}
              onChange={(e) => setMotionBlur(e.target.checked)}
                         />
            Motion blur (smoother fast moves)
          </label>
          <p className="mb-2 text-[10px] text-(--tx3)">
            {(project.durationMs / 1000).toFixed(1)}s · {project.fps} fps ·{' '}
            {Math.round((project.durationMs / 1000) * project.fps)} frames — rendered offline in your
            browser.
          </p>
        </>
      )}

      <label className="mb-3 flex items-center gap-2 text-[11px] text-(--tx2)">
        <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
        Transparent background {mode === 'video' ? '(forces WebM alpha)' : '(PNG alpha)'}
      </label>

      {error && <p className="mb-2 text-[11px] text-(--danger)">{error}</p>}

      <button
        onClick={() => {
          if (mode === 'batch' && batchIdxs.length === 0) {
            setError('Pick at least one size to export.')
            return
          }
          void run()
        }}
        className="w-full rounded-md bg-(--accent-fill) py-2 text-[12px] font-semibold tracking-[0.14em] text-(--accent-tx) uppercase hover:opacity-90"
      >
        {mode === 'batch' ? `Export ${batchIdxs.length} images` : `Export ${mode} · ${outW}×${outH}`}
      </button>
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
            className="group overflow-hidden rounded-lg border border-(--line) text-left transition-colors hover:border-(--line2)"
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

/**
 * Render "Ctrl+Shift+Z" as individual keycaps. A slash only separates when it
 * is spaced ("← / →") so that "/" can itself be a key.
 */
function Keys({ combo }: { combo: string }) {
  // one capture group → separators always land on odd indices, so a key that is
  // itself "+" or "/" still renders as a cap
  const parts = combo.split(/(\s*\+\s*|\s+\/\s+)/)
  return (
    <span className="flex flex-wrap items-center gap-0.5">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="px-0.5 text-[10px] text-(--tx3)">
            {p.trim()}
          </span>
        ) : (
          <kbd
            key={i}
            className="rounded-[4px] border border-(--line2) bg-(--panel3) px-1.5 py-0.5 text-[10px] whitespace-nowrap text-(--tx)"
          >
            {p}
          </kbd>
        ),
      )}
    </span>
  )
}

export function ShortcutsDialog() {
  const st = useStudio.getState
  const mode = useStudio((s) => s.mode)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const groups = SHORTCUT_GROUPS.map((g) => ({
    ...g,
    items: q
      ? g.items.filter((i) => i.desc.toLowerCase().includes(q) || i.keys.toLowerCase().includes(q))
      : g.items,
  })).filter((g) => g.items.length > 0)

  return (
    <Modal
      wide
      title="Keyboard shortcuts"
      onClose={() => st().setDialog(null)}
      aside={
        <Keys combo="Shift + /" />
      }
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search shortcuts…"
        className="mb-3 w-full rounded-[5px] bg-(--field) px-2.5 py-2 text-[12px] text-(--tx) outline-none placeholder:text-(--tx3)"
      />
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {groups.map((g) => (
          <section key={g.title} className="mb-4 last:mb-0">
            <p className="mb-1.5 flex items-center gap-2 text-[10px] text-(--tx2)">
              {g.title}
              {/* the mode a group applies to, so nothing looks broken in the other one */}
              {g.scope !== 'global' && g.scope !== mode && (
                <span className="rounded bg-(--panel3) px-1.5 py-0.5 text-[9px] text-(--tx3)">
                  {g.scope === 'studio' ? '3D Studio' : 'Shots'}
                </span>
              )}
            </p>
            <div className="rounded-[6px] bg-(--panel2)">
              {g.items.map((s) => (
                <div
                  key={s.keys + s.desc}
                  className="flex items-center justify-between gap-4 border-b border-(--line) px-2.5 py-1.5 last:border-0"
                >
                  <span className="text-[12px] text-(--tx2)">{s.desc}</span>
                  <Keys combo={s.keys} />
                </div>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && (
          <p className="py-6 text-center text-[11px] text-(--tx3)">No shortcut matches “{query}”.</p>
        )}
      </div>
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
            className="h-full bg-(--tx) transition-all"
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
