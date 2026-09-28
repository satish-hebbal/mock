/**
 * Signal, on a phone.
 *
 * The two desktop panels become five tabs, cut along the order the work goes:
 * pick a look, pick what makes it, shape it, colour it, finish it. Each tab is
 * one job, so its sheet is short enough to use with the picture still in view
 * above it.
 *
 * Remix is on the picture, not in a tab. It is the one control worth pressing
 * before you understand anything else, so it sits where the thumb already is
 * and where the result lands. Play sits beside it for the same reason.
 */

import { useEffect } from 'react'
import {
  Download,
  Palette,
  Pause,
  Play,
  Redo2,
  Shuffle,
  Sliders,
  Sparkles,
  Undo2,
  Wand2,
  Waves,
} from 'lucide-react'
import { useStudio } from '../store'
import { BareSections } from '../lib/touch'
import {
  FloatButton,
  MobileEditor,
  MobileIconButton,
  MobilePrimary,
  MobileTopBar,
} from '../components/mobile/MobileShell'
import { useSignal } from './store'
import { SignalCanvas } from './SignalCanvas'
import { GeneratorGroup, LooksGroup, MotionGroup, ShapeGroup } from './SignalLeftPanel'
import { CanvasGroup, ColourGroup, DitherGroup, FinishGroup, SavedGroup } from './SignalInspector'
import { SignalExportDialog } from './SignalExportDialog'

function Bar() {
  const canUndo = useSignal((s) => s.past.length > 0)
  const canRedo = useSignal((s) => s.future.length > 0)
  const st = useSignal.getState
  return (
    <MobileTopBar
      title="Signal"
      actions={
        <>
          <MobileIconButton icon={Undo2} label="Undo" onClick={() => st().undo()} disabled={!canUndo} />
          <MobileIconButton icon={Redo2} label="Redo" onClick={() => st().redo()} disabled={!canRedo} />
        </>
      }
      primary={<MobilePrimary icon={Download} label="Export" onClick={() => st().setDialog('export')} />}
    />
  )
}

function Overlay() {
  const playing = useSignal((s) => s.playing)
  const st = useSignal.getState
  return (
    <>
      <FloatButton
        icon={playing ? Pause : Play}
        label={playing ? 'Pause' : 'Play'}
        onClick={() => st().togglePlay()}
      />
      <FloatButton icon={Shuffle} label="Remix" showLabel strong onClick={() => st().shuffle()} />
    </>
  )
}

export function SignalMobile() {
  const hydrated = useSignal((s) => s.hydrated)
  const dialog = useSignal((s) => s.dialog)
  const hydrate = useSignal((s) => s.hydrate)
  const theme = useStudio((s) => s.theme)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // a fresh document takes its paper from the theme, as on the desktop
  useEffect(() => {
    if (!hydrated) return
    const s = useSignal.getState()
    if (s.doc.ink.palette !== 'none') return
    const paper = theme === 'light' ? '#f5f6f6' : '#08090a'
    const ink = theme === 'light' ? '#0f1011' : '#f7f8f8'
    if (s.doc.ink.paper === paper) return
    s.patch((d) => {
      d.ink.paper = paper
      d.ink.ink = ink
    })
  }, [hydrated, theme])

  const bare = (node: React.ReactNode) => <BareSections value>{node}</BareSections>

  return (
    <>
      <MobileEditor
        bar={<Bar />}
        stage={hydrated && <SignalCanvas compact />}
        overlay={<Overlay />}
        tabs={[
          { id: 'looks', label: 'Looks', icon: Sparkles, panel: bare(<LooksGroup />) },
          { id: 'pattern', label: 'Pattern', icon: Waves, panel: bare(<GeneratorGroup />) },
          {
            id: 'shape',
            label: 'Shape',
            icon: Sliders,
            heading: false,
            panel: (
              <>
                <ShapeGroup />
                <MotionGroup />
              </>
            ),
          },
          {
            id: 'colour',
            label: 'Colour',
            icon: Palette,
            heading: false,
            panel: (
              <>
                <ColourGroup />
                <DitherGroup />
              </>
            ),
          },
          {
            id: 'finish',
            label: 'Finish',
            icon: Wand2,
            heading: false,
            panel: (
              <>
                <FinishGroup />
                <CanvasGroup />
                <SavedGroup />
              </>
            ),
          },
        ]}
      />
      {dialog === 'export' && <SignalExportDialog />}
    </>
  )
}
