import { useEffect } from 'react'
import { pickMediaFile, useStudio } from './store'
import { TopBar } from './components/TopBar'
import { Inspector } from './components/Inspector'
import { Viewport } from './components/Viewport'
import { Timeline } from './components/Timeline'
import {
  ExportDialog,
  ExportProgressOverlay,
  ShortcutsDialog,
  TemplatesDialog,
  UpgradeDialog,
} from './components/dialogs'

/** rAF playback driver (PRD §5.4). */
function usePlayback() {
  const playing = useStudio((s) => s.playing)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const s = useStudio.getState()
      const dt = now - last
      last = now
      let t = s.timeMs + dt
      if (t >= s.project.durationMs) {
        if (s.loop) t = t % s.project.durationMs
        else {
          s.setTime(s.project.durationMs)
          s.setPlaying(false)
          return
        }
      }
      s.setTime(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])
}

function useGlobalShortcuts() {
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
    }
    const onKey = (e: KeyboardEvent) => {
      const s = useStudio.getState()
      if (isTyping(e)) return
      if (e.code === 'Space') {
        e.preventDefault()
        s.setPlaying(!s.playing)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        s.redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedKeyframeIds.length > 0) s.removeKeyframes(s.selectedKeyframeIds)
        else if (s.selectedOverlayId) s.removeOverlay(s.selectedOverlayId)
        else if (s.selectedDeviceId && s.project.scene.devices.length > 1)
          s.removeDevice(s.selectedDeviceId)
      } else if (e.key === '?') {
        s.setDialog(s.dialog === 'shortcuts' ? null : 'shortcuts')
      } else if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey) {
        s.setDialog(s.dialog === 'export' ? null : 'export')
      } else if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey) {
        s.setDialog(s.dialog === 'templates' ? null : 'templates')
      } else if (e.key === 'Escape') {
        s.setDialog(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function useMediaDropPaste() {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault()
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      const file = Array.from(e.dataTransfer?.files ?? []).find(
        (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
      )
      if (file) void useStudio.getState().importMedia(file)
    }
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (file) void useStudio.getState().importMedia(file)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [])
}

export default function App() {
  const hydrated = useStudio((s) => s.hydrated)
  const theme = useStudio((s) => s.theme)
  const dialog = useStudio((s) => s.dialog)
  const hasMedia = useStudio((s) => s.project.scene.devices.some((d) => d.screen.assetId))
  const hydrate = useStudio((s) => s.hydrate)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  usePlayback()
  useGlobalShortcuts()
  useMediaDropPaste()

  return (
    <div className="flex h-full flex-col bg-(--panel2) text-(--tx)">
      <TopBar />
      <main className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {hydrated && <Viewport />}
          {hydrated && !hasMedia && (
            <div className="pointer-events-none absolute inset-x-0 bottom-10 z-10 flex justify-center">
              <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-black/80 py-2 pr-2 pl-5 shadow-xl backdrop-blur">
                <span className="text-[13px] text-neutral-200">
                  Upload media to get started — or paste / drop.
                </span>
                <button
                  onClick={() => pickMediaFile((f) => void useStudio.getState().importMedia(f))}
                  className="rounded-full bg-white px-4 py-1.5 text-[11px] font-semibold tracking-[0.14em] text-black uppercase transition-colors hover:bg-neutral-200"
                >
                  Upload
                </button>
              </div>
            </div>
          )}
        </div>
        <Inspector />
      </main>
      <Timeline />

      {dialog === 'export' && <ExportDialog />}
      {dialog === 'templates' && <TemplatesDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      {dialog === 'upgrade' && <UpgradeDialog />}
      <ExportProgressOverlay />
    </div>
  )
}
