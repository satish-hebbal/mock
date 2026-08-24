import { useEffect, useRef } from 'react'
import { exportProjectFile, importProjectFile, pickMediaFile, useStudio } from './store'
import { useShots } from './shots/store'
import { selectedShotsImage } from './shots/types'
import { PALETTE_GROUP_SIZE } from './shots/palette'
import { ShotsEditor } from './shots/ShotsEditor'
import { ToolRail } from './components/ToolRail'
import { ToolPanel } from './components/ToolPanel'
import { AppSheet } from './components/AppSheet'
import { RightPanel } from './components/RightPanel'
import { Inspector } from './components/Inspector'
import { Viewport } from './components/Viewport'
import { NotchedCanvas } from './components/NotchedCanvas'
import { Timeline } from './components/Timeline'
import { Home } from './components/Home'
import {
  ExportDialog,
  ExportProgressOverlay,
  ShortcutsDialog,
  TemplatesDialog,
} from './components/dialogs'
import { UILayer } from './components/ui'
import { SmallScreen } from './components/SmallScreen'
import { UploadPrompt } from './components/UploadPrompt'
import { useIsDesktop } from './lib/breakpoint'

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

/*
 * Input types with no free-text state of their own (a colour swatch, a
 * checkbox) so there's nothing for a native undo to apply to and no reason
 * for them to keep swallowing keyboard shortcuts once the user is done with
 * them. `<input type="color">` is the one that bites in practice: picking a
 * colour leaves it focused, and it stays focused (nothing else claims focus
 * on the next click), so every shortcut goes quiet until something else
 * happens to steal focus back. Text-like inputs are deliberately left out of
 * this set, while one of those is focused, Ctrl+Z should still mean "undo
 * my typing" and not "undo my last app action".
 */
const NON_TEXT_INPUT_TYPES = new Set([
  'color',
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'file',
  'image',
])

/** Is `el` (or an ancestor) a field the user could plausibly still be typing into? */
function isTextEntryTarget(el: Element | null): boolean {
  const field = el?.closest?.('input, textarea, select, [contenteditable="true"]') as HTMLInputElement | null
  if (!field) return false
  if (field.tagName === 'INPUT' && NON_TEXT_INPUT_TYPES.has(field.type)) return false
  return true
}

/*
 * Printable keys whose physical position we bind, spelled the way the US
 * layout prints them. Letters and digits are derived from `code` directly;
 * this is only the punctuation, which has no regular pattern to compute.
 */
const PUNCTUATION_BY_CODE: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Slash: '/',
  Comma: ',',
  Period: '.',
  Minus: '-',
  Equal: '=',
}

/**
 * A shortcut's identity, independent of the active keyboard layout.
 *
 * `e.key` is the character the *current layout prints*, so on a Russian
 * layout the physical Z key arrives as 'я' and on a German one as 'y',
 * and every letter shortcut silently stops matching. That failure is
 * especially confusing because it tracks the layout toggle (Alt+Shift,
 * Win+Space) rather than anything in the app, so shortcuts appear to break
 * and heal at random.
 *
 * `e.code` is the physical position, which is what Ctrl+Z has always
 * actually meant, so letters, digits and the punctuation we bind resolve
 * from there. Named keys (Escape, arrows, Delete) are already
 * layout-independent in `e.key`, so they fall through unchanged.
 */
function keyOf(e: KeyboardEvent): string {
  const code = e.code ?? ''
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  return PUNCTUATION_BY_CODE[code] ?? (e.key ?? '').toLowerCase()
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
    const isTyping = (e: KeyboardEvent) => isTextEntryTarget(e.target as HTMLElement)

    /** Shortcuts that mean the same thing in every mode. Returns true if handled. */
    const handleGlobal = (e: KeyboardEvent): boolean => {
      const s = useStudio.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = keyOf(e)

      // Alt, not Ctrl: Ctrl+1/2 are browser tab switches and can't be cancelled
      if (e.altKey && (key === '1' || key === '2')) {
        s.setMode(key === '1' ? 'studio' : 'shots')
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
      const key = keyOf(e)
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
        sh.setFocusGuide(false)
      } else if (key >= '1' && key <= '5') {
        const target = sh.doc.images[Number(key) - 1]
        if (target) sh.selectImage(target.id)
      } else if (key === 'u') {
        pickMediaFile((f) => void sh.importMedia(f))
      } else if (key === 'r') {
        sh.randomizeBackground()
      } else if (key === 'm') {
        // a random one of the three Magic palettes, same as clicking a tab first
        const full = selectedShotsImage(sh.doc)?.palette ?? []
        const g = Math.floor(Math.random() * 3)
        const palette = full.slice(g * PALETTE_GROUP_SIZE, (g + 1) * PALETTE_GROUP_SIZE)
        sh.applyMagicBackground(Math.floor(Math.random() * 8), palette)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        sh.removeImage()
      } else if (img && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        sh.setImage({ offsetX: img.offsetX + (e.key === 'ArrowRight' ? step : -step) })
      } else if (img && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        sh.setImage({ offsetY: img.offsetY + (e.key === 'ArrowDown' ? step : -step) })
      } else if (img && (key === '+' || key === '=' || key === '-')) {
        sh.setImage({ scale: img.scale + (key === '-' ? -0.05 : 0.05) })
      } else if (img && (key === ',' || key === '.')) {
        sh.setImage({ rotate: img.rotate + (key === ',' ? -1 : 1) })
      }
    }

    const handleStudio = (e: KeyboardEvent) => {
      const s = useStudio.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = keyOf(e)
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
        // Blender-style: G move, R rotate, S scale. Pressing the active one exits
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
      /*
       * Mid-composition keystrokes belong to the IME, not to us: an input
       * method reports every key as 'Process' until the candidate is
       * committed, so acting on them would fire shortcuts out of what the
       * user means as ordinary typing.
       */
      if (e.isComposing || e.keyCode === 229) return

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

      const st = useStudio.getState()
      const dialogOpen = !!st.dialog || !!useShots.getState().dialog

      /*
       * The shortcut guide closes with the same key that opened it, so it has
       * to be reachable while it is the thing on screen. It is still refused
       * over any *other* dialog, since stacking a second panel on an open
       * export is not what pressing `?` is asking for.
       */
      if (keyOf(e) === '/' && (!dialogOpen || st.dialog === 'shortcuts')) {
        e.preventDefault()
        st.setDialog(st.dialog === 'shortcuts' ? null : 'shortcuts')
        return
      }

      /*
       * A modal owns the keyboard for as long as it is up.
       *
       * Without this every shortcut kept firing at the scene behind it: `G`
       * moved the gizmo under the export dialog, and `T` stacked Templates on
       * top of Export. Both are invisible at the time and both are waiting for
       * you when you close the thing you were actually looking at. Escape has
       * already been handled above, so there is always a way out.
       */
      if (dialogOpen) return

      if (handleGlobal(e)) {
        e.preventDefault()
        return
      }

      /*
       * Only ever the handler for the editor you are actually in. Home used to
       * fall through to Studio's, so `E` and `T` on the launcher opened Studio
       * dialogs over it for a project you had not opened yet.
       */
      if (st.mode === 'shots') handleShots(e)
      else if (st.mode === 'studio') handleStudio(e)
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
    /*
     * Every dropped or pasted file, not just the first. Shots can hold several
     * screens, and its importer is the one that knows the cap, so the whole
     * list goes there and it decides what fits. The studio still takes one.
     */
    const importAll = (files: File[]) => {
      if (files.length === 0) return
      if (useStudio.getState().mode === 'shots') void useShots.getState().importMediaFiles(files)
      else importTo(files[0])
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      importAll(
        Array.from(e.dataTransfer?.files ?? []).filter(
          (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
        ),
      )
    }
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f)
      importAll(files)
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
          <NotchedCanvas>
            {hydrated && <Viewport />}
            {hydrated && !hasMedia && (
              <div className="pointer-events-none absolute inset-x-0 bottom-10 z-10 flex justify-center">
                <UploadPrompt onFiles={(fs) => void useStudio.getState().importMedia(fs[0])} />
              </div>
            )}
          </NotchedCanvas>
        </div>
        <RightPanel>
          <Inspector />
        </RightPanel>
      </main>
      <Timeline />
    </>
  )
}

function Editor() {
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
     * focus, and focus drifts constantly: a fresh load leaves it on the browser
     * chrome, and every click parks it on whatever button was pressed. That
     * second case is worse than it sounds: with focus sitting on Loopify, Space
     * re-fires Loopify instead of toggling playback, because the browser
     * activates the focused button first.
     *
     * So after any click that isn't into a field, focus goes back to the root.
     * Deferred a frame so the click itself still lands where it was aimed.
     */
    const onPointerDown = (e: PointerEvent) => {
      if (isTextEntryTarget(e.target as HTMLElement | null)) return
      requestAnimationFrame(() => {
        if (!isTextEntryTarget(document.activeElement)) root.focus({ preventScroll: true })
      })
    }
    const onWindowFocus = () => {
      if (!isTextEntryTarget(document.activeElement)) root.focus({ preventScroll: true })
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

/*
 * The gate sits above the editor rather than inside it, so on a phone none of
 * Editor's hooks ever run: no hydrate, no rAF playback loop, no window
 * listeners, no WebGL context. Crossing the breakpoint (rotating a tablet,
 * dragging a window wider) mounts the real thing.
 */
export default function App() {
  return useIsDesktop() ? <Editor /> : <SmallScreen />
}
