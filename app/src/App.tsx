import { useEffect, useRef } from 'react'
import { exportProjectFile, importProjectFile, pickMediaFile, useStudio } from './store'
import { useShots } from './shots/store'
import { ShotsEditor } from './shots/ShotsEditor'
import { ToolRail } from './components/ToolRail'
import { ToolPanel } from './components/ToolPanel'
import { AppSheet } from './components/AppSheet'
import { RightPanel } from './components/RightPanel'
import { Inspector } from './components/Inspector'
import { Viewport } from './components/Viewport'
import { Timeline } from './components/Timeline'
import { Home } from './components/Home'
import {
  ExportDialog,
  ExportProgressOverlay,
  ShortcutsDialog,
  TemplatesDialog,
} from './components/dialogs'
import { UILayer } from './components/ui'

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

/** Open a .mockup.json from disk (Ctrl+O). */
function pickProjectFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'
  input.onchange = () => {
    const f = input.files?.[0]
    if (f) void importProjectFile(f)
  }
  input.click()
}

function useGlobalShortcuts() {
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
    }

    /** Shortcuts that mean the same thing in every mode. Returns true if handled. */
    const handleGlobal = (e: KeyboardEvent): boolean => {
      const s = useStudio.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      // Alt, not Ctrl: Ctrl+1/2 are browser tab switches and can't be cancelled
      if (e.altKey && (key === '1' || key === '2')) {
        s.setMode(key === '1' ? 'studio' : 'shots')
        return true
      }
      if (key === '/' || key === '?') {
        s.setDialog(s.dialog === 'shortcuts' ? null : 'shortcuts')
        return true
      }
      if (!mod && key === '[') {
        s.setToolPanelOpen(!s.toolPanelOpen)
        return true
      }
      if (!mod && key === ']') {
        s.setPanelOpen(!s.panelOpen)
        return true
      }
      if (!mod && key === '\\') {
        s.setTimelineOpen(!s.timelineOpen)
        return true
      }
      if (!mod && e.shiftKey && key === 'd') {
        s.setTheme(s.theme === 'dark' ? 'light' : 'dark')
        return true
      }
      return false
    }

    const handleShots = (e: KeyboardEvent) => {
      const sh = useShots.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const img = sh.doc.images.find((i) => i.id === sh.doc.selectedId)
      const step = e.shiftKey ? 0.05 : 0.01

      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) sh.redo()
        else sh.undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        sh.redo()
      } else if (mod) {
        return
      } else if (key === 'e') {
        sh.setDialog(sh.dialog === 'export' ? null : 'export')
      } else if (e.key === 'Escape') {
        sh.setDialog(null)
      } else if (key >= '1' && key <= '5') {
        const target = sh.doc.images[Number(key) - 1]
        if (target) sh.selectImage(target.id)
      } else if (key === 'u') {
        pickMediaFile((f) => void sh.importMedia(f))
      } else if (key === 'r') {
        sh.randomizeBackground()
      } else if (key === 'm') {
        sh.applyMagicBackground(Math.floor(Math.random() * 4))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        sh.removeImage()
      } else if (img && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        sh.setImage({ offsetX: img.offsetX + (e.key === 'ArrowRight' ? step : -step) })
      } else if (img && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        sh.setImage({ offsetY: img.offsetY + (e.key === 'ArrowDown' ? step : -step) })
      } else if (img && (e.key === '+' || e.key === '=' || e.key === '-')) {
        sh.setImage({ scale: img.scale + (e.key === '-' ? -0.05 : 0.05) })
      } else if (img && (e.key === ',' || e.key === '.')) {
        sh.setImage({ rotate: img.rotate + (e.key === ',' ? -1 : 1) })
      }
    }

    const handleStudio = (e: KeyboardEvent) => {
      const s = useStudio.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const frame = 1000 / s.project.fps
      const hasKfSelection = s.selectedKeyframeIds.length > 0

      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        s.redo()
      } else if (mod && key === 'a') {
        e.preventDefault()
        s.selectKeyframes(s.project.keyframes.map((k) => k.id))
      } else if (e.altKey && key === 'n') {
        // Ctrl+N would open a browser window instead
        e.preventDefault()
        s.newProject()
      } else if (mod && key === 'o') {
        e.preventDefault()
        pickProjectFile()
      } else if (mod && key === 's') {
        e.preventDefault()
        void exportProjectFile()
      } else if (mod && key === 'l') {
        e.preventDefault()
        s.makeLoopFriendly()
      } else if (mod) {
        return // leave every other Ctrl combo to the browser (incl. Ctrl+V paste)
      } else if (e.code === 'Space' || key === 'k') {
        e.preventDefault()
        s.setPlaying(!s.playing)
      } else if (e.key === 'Home') {
        s.setTime(0)
      } else if (e.key === 'End') {
        s.setTime(s.project.durationMs)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // with keyframes selected the Timeline nudges them instead
        if (hasKfSelection) return
        e.preventDefault()
        const d = (e.shiftKey ? 10 : 1) * frame * (e.key === 'ArrowRight' ? 1 : -1)
        s.setTime(Math.min(s.project.durationMs, Math.max(0, s.timeMs + d)))
      } else if (key === 'l') {
        s.setLoop(!s.loop)
      } else if (key === 'g' || key === 'r' || key === 's') {
        // Blender-style: G move, R rotate, S scale — pressing the active one exits
        const want = key === 'g' ? 'translate' : key === 'r' ? 'rotate' : 'scale'
        s.setGizmo(s.gizmo === want ? 'off' : want)
      } else if (key === 'f') {
        s.frameDevices()
      } else if (key === 'i') {
        for (const prop of ['tiltX', 'tiltY', 'zoom', 'panX', 'panY'] as const)
          s.addKeyframeAt(`camera.${prop}`)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (hasKfSelection) s.removeKeyframes(s.selectedKeyframeIds)
        else if (s.selectedOverlayId) s.removeOverlay(s.selectedOverlayId)
        else if (s.selectedDeviceId && s.project.scene.devices.length > 1)
          s.removeDevice(s.selectedDeviceId)
      } else if (key === 'e') {
        s.setDialog(s.dialog === 'export' ? null : 'export')
      } else if (key === 't') {
        s.setDialog(s.dialog === 'templates' ? null : 'templates')
      } else if (e.key === 'Escape') {
        if (s.dialog) s.setDialog(null)
        else s.selectKeyframes([])
      }
    }

    const onKey = (e: KeyboardEvent) => {
      // Escape closes an open dialog even while a field inside it has focus,
      // so it must run before the typing guard.
      if (e.key === 'Escape') {
        const s = useStudio.getState()
        if (s.dialog) {
          e.preventDefault()
          s.setDialog(null)
          return
        }
        if (useShots.getState().dialog) {
          e.preventDefault()
          useShots.getState().setDialog(null)
          return
        }
      }
      if (isTyping(e)) return
      if (handleGlobal(e)) {
        e.preventDefault()
        return
      }
      if (useStudio.getState().mode === 'shots') handleShots(e)
      else handleStudio(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function useMediaDropPaste() {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault()
    const importTo = (file: Blob) => {
      if (useStudio.getState().mode === 'shots') void useShots.getState().importMedia(file)
      else void useStudio.getState().importMedia(file)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      const file = Array.from(e.dataTransfer?.files ?? []).find(
        (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
      )
      if (file) importTo(file)
    }
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (file) importTo(file)
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

function StudioLayout() {
  const hydrated = useStudio((s) => s.hydrated)
  const hasMedia = useStudio((s) => s.project.scene.devices.some((d) => d.screen.assetId))
  return (
    <>
      <main className="flex min-h-0 flex-1 gap-2">
        <ToolPanel />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-(--line) bg-(--raised)">
            {hydrated && <Viewport />}
            {hydrated && !hasMedia && (
              <div className="pointer-events-none absolute inset-x-0 bottom-10 z-10 flex justify-center">
                <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-(--line) bg-(--raised) py-2 pr-2 pl-5">
                  <span className="t-body text-(--tx2)">
                    Upload media to get started — or paste / drop.
                  </span>
                  {/*
                    Pill, not the default `rounded-md` button: this one is nested
                    inside a pill-shaped prompt, and the radius scale carries
                    "pill/full" precisely for that case. Keeps Linear's button
                    padding (8px 14px) and type token.
                  */}
                  <button
                    onClick={() => pickMediaFile((f) => void useStudio.getState().importMedia(f))}
                    className="rounded-full bg-(--accent-fill) px-3.5 py-2 t-button text-(--accent-tx) transition-opacity hover:opacity-90"
                  >
                    Upload
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <RightPanel>
          <Inspector />
        </RightPanel>
      </main>
      <Timeline />
    </>
  )
}

export default function App() {
  const theme = useStudio((s) => s.theme)
  const mode = useStudio((s) => s.mode)
  const dialog = useStudio((s) => s.dialog)
  const hydrate = useStudio((s) => s.hydrate)
  const hydrateShots = useShots((s) => s.hydrate)

  useEffect(() => {
    void hydrate()
    void hydrateShots()
  }, [hydrate, hydrateShots])

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  // Shortcuts listen on window, so the document has to own focus. Without this
  // a fresh load leaves it on the browser chrome and every key goes there.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.focus({ preventScroll: true })

    /*
     * Keep the keyboard pointed at the app.
     *
     * Shortcuts listen on `window`, which only sees a key if the document owns
     * focus — and focus drifts constantly: a fresh load leaves it on the browser
     * chrome, and every click parks it on whatever button was pressed. That
     * second case is worse than it sounds: with focus sitting on Loopify, Space
     * re-fires Loopify instead of toggling playback, because the browser
     * activates the focused button first.
     *
     * So after any click that isn't into a field, focus goes back to the root.
     * Deferred a frame so the click itself still lands where it was aimed.
     */
    const FIELDS = 'input, textarea, select, [contenteditable="true"]'
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.(FIELDS)) return
      requestAnimationFrame(() => {
        if (!document.activeElement?.closest?.(FIELDS)) root.focus({ preventScroll: true })
      })
    }
    const onWindowFocus = () => {
      if (!document.activeElement?.closest?.(FIELDS)) root.focus({ preventScroll: true })
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('focus', onWindowFocus)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('focus', onWindowFocus)
    }
  }, [])

  usePlayback()
  useGlobalShortcuts()
  useMediaDropPaste()

  return (
    <div ref={rootRef} tabIndex={-1} className="flex h-full bg-(--panel2) text-(--tx) outline-none">
      <ToolRail />
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-2 pr-2">
        {mode === 'home' ? <Home /> : mode === 'studio' ? <StudioLayout /> : <ShotsEditor />}
      </div>

      <AppSheet />

      {dialog === 'export' && <ExportDialog />}
      {dialog === 'templates' && <TemplatesDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      <ExportProgressOverlay />
      <UILayer />
    </div>
  )
}
