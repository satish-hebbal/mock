/**
 * Exporting a graph: the Output node, drawn at full quality and at a chosen
 * multiple of Studio's document size, as PNG or JPG, to a file or the clipboard.
 */

import { useState } from 'react'
import { Copy, Download } from 'lucide-react'
import { Dialog } from '../../components/Overlay'
import { MiniButton, Segments } from '../../components/controls'
import { ui } from '../../lib/ui'
import { useAscii } from '../store'
import { envFor } from './env'
import { evaluate, outputNode } from './evaluate'
import { useFlow } from './store'

function renderOut(scale: number): HTMLCanvasElement | null {
  const flow = useFlow.getState().flow
  const out = outputNode(flow)
  if (!out) return null
  const w = useAscii.getState().doc.size.width * scale
  return evaluate(flow, envFor(w, 'export'), [out.id]).get(out.id) ?? null
}

async function toBlob(c: HTMLCanvasElement, format: 'png' | 'jpg') {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, format === 'png' ? 'image/png' : 'image/jpeg', 0.92))
  if (!blob) throw new Error('Encoding failed')
  return blob
}

export function FlowExportDialog() {
  const close = () => useAscii.getState().setDialog(null)
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const [scale, setScale] = useState(2)
  const [busy, setBusy] = useState(false)
  const size = useAscii((s) => s.doc.size)

  const run = async (fn: (c: HTMLCanvasElement) => Promise<void>) => {
    setBusy(true)
    // one frame for the button to show it is working before the render blocks
    await new Promise((r) => setTimeout(r, 30))
    try {
      const c = renderOut(scale)
      if (!c) throw new Error('The graph has no output')
      await fn(c)
    } catch (e) {
      ui.error(`Export failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Export graph" onClose={close}>
      <Segments
        options={[
          { id: 'png', label: 'PNG' },
          { id: 'jpg', label: 'JPG' },
        ]}
        value={format}
        onChange={setFormat}
      />
      <div className="mb-3 flex gap-1">
        {[1, 2, 3, 4].map((s) => (
          <MiniButton key={s} active={scale === s} onClick={() => setScale(s)}>
            {s}×
          </MiniButton>
        ))}
      </div>
      <p className="mb-4 t-caption text-(--tx3) tabular-nums">
        {Math.round(size.width * scale)} × {Math.round(size.height * scale)} px
      </p>
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={() =>
            void run(async (c) => {
              const blob = await toBlob(c, format)
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `flow.${format}`
              a.click()
              setTimeout(() => URL.revokeObjectURL(url), 2000)
            })
          }
          className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-(--accent-fill) t-button text-(--accent-tx) hover:bg-(--accent-fill-hover) disabled:opacity-50"
        >
          <Download size={14} strokeWidth={1.9} />
          {busy ? 'Rendering…' : 'Download'}
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(async (c) => {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toBlob(c, 'png') })])
              ui.toast('Copied')
            })
          }
          className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-(--field) px-3 t-button text-(--tx) hover:bg-(--field-h) disabled:opacity-50"
        >
          <Copy size={14} strokeWidth={1.9} />
          Copy
        </button>
      </div>
    </Dialog>
  )
}
