/**
 * Export.
 *
 * Four destinations on four tabs, in the order they get reached for: a still, a
 * video, a snippet, and a mockup. The mockup tab is the one no reference tool
 * can offer, so it is a peer of the other three rather than an afterthought.
 *
 * The video tab is the only one that can take real time, so it is the only one
 * with a progress bar and a way out of it. Everything else completes inside a
 * frame or two and gets a spinner's worth of disabled button instead.
 */

import { useMemo, useState } from 'react'
import { Boxes, Code, Copy, Download, Film, Image as ImageIcon } from 'lucide-react'
import { Dialog } from '../components/Overlay'
import { InfoTip, MiniButton, Segments, SliderRow } from '../components/controls'
import { ui } from '../lib/ui'
import { useSignal } from './store'
import { frameCount } from './render'
import {
  codeFor,
  copyCode,
  copyStill,
  downloadCode,
  downloadStill,
  embedOmissions,
  exportShape,
  exportVideo,
  sendToMockup,
  trackExport,
  videoState,
  type CodeFormat,
  type StillFormat,
  type VideoFormat,
} from './export'

type Tab = 'still' | 'video' | 'code' | 'mockup'

export function SignalExportDialog() {
  const doc = useSignal((s) => s.doc)
  const close = () => useSignal.getState().setDialog(null)

  const [tab, setTab] = useState<Tab>('still')
  const [stillFormat, setStillFormat] = useState<StillFormat>('png')
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('mp4')
  const [fps, setFps] = useState(30)
  const [quality, setQuality] = useState(6)
  const [codeFormat, setCodeFormat] = useState<CodeFormat>('embed')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  /* The clock is read once when the dialog opens rather than subscribed to.
     Exporting the frame that was on screen when you pressed Export is what
     everybody expects; exporting whatever the animation drifted to while the
     dialog was open is not. */
  const [frozenTime] = useState(() => useSignal.getState().time)

  const omissions = embedOmissions(doc)
  const totalFrames = frameCount(doc, fps)

  /** Every action goes through one wrapper, so the funnel is measured once. */
  const run = async (
    shape: Record<string, string | number | boolean>,
    fn: () => Promise<void> | void,
  ) => {
    setBusy(true)
    const startedAt = performance.now()
    trackExport('export_started', shape)
    try {
      await fn()
      trackExport('export_completed', {
        ...shape,
        duration_ms: Math.round(performance.now() - startedAt),
      })
    } catch (e) {
      const reason = (e as Error).message
      trackExport('export_failed', { ...shape, reason: reason.slice(0, 120) })
      ui.error(`Export failed: ${reason}`)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  /* Generating the snippet stringifies a generator and builds a page of text.
     Switching tabs is not a reason to redo it. */
  const snippet = useMemo(
    () => (tab === 'code' ? codeFor(doc, codeFormat) : ''),
    [tab, doc, codeFormat],
  )

  return (
    <Dialog title="Export" onClose={close}>

      <Segments
        options={[
          { id: 'still', label: 'Still' },
          { id: 'video', label: 'Video' },
          { id: 'code', label: 'Code' },
          { id: 'mockup', label: 'Mockup' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'still' && (
        <>
          <Segments
            options={[
              { id: 'png', label: 'PNG' },
              { id: 'jpg', label: 'JPG' },
            ]}
            value={stillFormat}
            onChange={setStillFormat}
          />
          <p className="mb-3 t-caption text-(--tx3) tabular-nums">
            {doc.canvas.width} × {doc.canvas.height}, the frame on screen. There is no export
            multiplier: a dither is measured in pixels, so change the canvas size to change the
            picture.
          </p>
          <div className="flex gap-1">
            <MiniButton
              onClick={() =>
                void run(exportShape(doc, { format: stillFormat, kind: 'still' }), () =>
                  downloadStill(doc, frozenTime, stillFormat),
                )
              }
              title="Save the current frame"
            >
              <Download size={13} strokeWidth={1.9} />
              {busy ? 'Working' : 'Download'}
            </MiniButton>
            <MiniButton
              onClick={() =>
                void run(exportShape(doc, { format: 'png', kind: 'copy' }), () =>
                  copyStill(doc, frozenTime).then(() => ui.toast('Frame copied')),
                )
              }
            >
              <Copy size={13} strokeWidth={1.9} />
              Copy
            </MiniButton>
          </div>
        </>
      )}

      {tab === 'video' && (
        <>
          <Segments
            options={[
              { id: 'mp4', label: 'MP4' },
              { id: 'webm', label: 'WebM' },
            ]}
            value={videoFormat}
            onChange={setVideoFormat}
          />
          <SliderRow
            label="Frame rate"
            value={fps}
            min={12}
            max={60}
            step={1}
            format={(v) => `${Math.round(v)} fps`}
            onChange={(v) => setFps(Math.round(v))}
          />
          <SliderRow
            label="Quality"
            hint="Megabits per second. Dithered noise is expensive to encode, so this runs higher than video usually needs."
            value={quality}
            min={1}
            max={24}
            step={1}
            format={(v) => `${Math.round(v)} Mbps`}
            onChange={(v) => setQuality(Math.round(v))}
          />

          <p className="my-2 t-caption text-(--tx3) tabular-nums">
            {doc.canvas.duration.toFixed(1)}s · {totalFrames} frames · {doc.canvas.width} ×{' '}
            {doc.canvas.height}
          </p>
          {/*
           * Worth saying plainly, because it is the opposite of what the
           * tools people have used before do, and it changes what they should
           * expect: a slow machine here makes the same file, later.
           */}
          <p className="mb-3 t-caption text-(--tx3)">
            Encoded frame by frame rather than recorded, so nothing is dropped and the file does
            not depend on how fast this machine is.
          </p>

          {progress && (
            <div className="mb-2">
              <div className="h-1 w-full overflow-hidden rounded-full bg-(--field)">
                <div
                  className="h-full bg-(--accent-fill) transition-[width]"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <p className="mt-1 t-caption text-(--tx3) tabular-nums">
                Frame {progress.done} of {progress.total}
              </p>
            </div>
          )}

          <div className="flex gap-1">
            <MiniButton
              onClick={() =>
                void run(
                  exportShape(doc, { format: videoFormat, kind: 'video', fps, frames: totalFrames }),
                  () =>
                    exportVideo(
                      doc,
                      { format: videoFormat, fps, bitrate: quality * 1_000_000 },
                      (done, total) => setProgress({ done, total }),
                    ),
                )
              }
              title="Render and encode every frame"
            >
              <Film size={13} strokeWidth={1.9} />
              {busy ? 'Encoding' : 'Encode'}
            </MiniButton>
            {busy && (
              <MiniButton
                onClick={() => {
                  videoState.cancelled = true
                }}
              >
                Stop
              </MiniButton>
            )}
          </div>
        </>
      )}

      {tab === 'code' && (
        <>
          <Segments
            options={[
              { id: 'embed', label: 'HTML embed' },
              { id: 'json', label: 'Document' },
            ]}
            value={codeFormat}
            onChange={setCodeFormat}
          />

          {codeFormat === 'embed' ? (
            <p className="mb-2 t-caption text-(--tx3)">
              A standalone page: the generator itself, lifted out and pasted in, with no script to
              load and nothing to host.
            </p>
          ) : (
            <p className="mb-2 t-caption text-(--tx3)">
              The document as JSON. The only export that comes back in exactly as it went out.
            </p>
          )}

          {/*
           * What the snippet cannot carry is named before it is copied, not
           * discovered after it is pasted.
           */}
          {codeFormat === 'embed' && omissions.length > 0 && (
            <p className="mb-2 rounded-sm bg-(--field) px-2 py-1.5 t-caption text-(--tx3)">
              The snippet leaves out {omissions.join(' and ')}. Export a video if you need the
              picture exactly as it is here.
            </p>
          )}

          <pre className="mb-2 max-h-40 overflow-auto rounded-sm bg-(--field) p-2 t-mono text-(--tx3)">
            {snippet.slice(0, 1400)}
            {snippet.length > 1400 ? '\n…' : ''}
          </pre>

          <div className="flex gap-1">
            <MiniButton
              onClick={() =>
                void run(exportShape(doc, { format: codeFormat, kind: 'code' }), () =>
                  copyCode(doc, codeFormat).then(() => ui.toast('Copied')),
                )
              }
            >
              <Copy size={13} strokeWidth={1.9} />
              Copy
            </MiniButton>
            <MiniButton
              onClick={() =>
                void run(exportShape(doc, { format: codeFormat, kind: 'code-file' }), () =>
                  downloadCode(doc, codeFormat),
                )
              }
            >
              <Code size={13} strokeWidth={1.9} />
              Save file
            </MiniButton>
          </div>
        </>
      )}

      {tab === 'mockup' && (
        <>
          <p className="mb-3 t-caption text-(--tx3)">
            Sends the current frame through as a screen. A still rather than the animation:
            neither mockup editor takes a moving screen from another tool yet.
          </p>
          <div className="flex gap-1">
            <MiniButton
              onClick={() =>
                void run(exportShape(doc, { kind: 'mockup', target: 'shots' }), () =>
                  sendToMockup(doc, frozenTime, 'shots'),
                )
              }
            >
              <ImageIcon size={13} strokeWidth={1.9} />
              To Shots
            </MiniButton>
            <MiniButton
              onClick={() =>
                void run(exportShape(doc, { kind: 'mockup', target: 'studio' }), () =>
                  sendToMockup(doc, frozenTime, 'studio'),
                )
              }
            >
              <Boxes size={13} strokeWidth={1.9} />
              To 3D Studio
            </MiniButton>
          </div>
        </>
      )}

      <div className="mt-4 flex items-center gap-1.5 border-t border-(--line) pt-3">
        <InfoTip label="About these exports">
          Every one of these renders through the same function the canvas does, at the document's
          own size, so the file is the picture you framed.
        </InfoTip>
        <span className="t-caption text-(--tx3)">Same renderer as the preview.</span>
      </div>
    </Dialog>
  )
}
