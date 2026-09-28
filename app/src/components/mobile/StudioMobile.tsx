/**
 * 3D Studio, on a phone.
 *
 * The desktop studio is a tool panel, a viewport, an inspector and a timeline.
 * The phone keeps all four, regrouped into six tabs, one job each. The
 * timeline is not the desktop strip squeezed down; it is rebuilt for a finger
 * in `StudioAnimate.tsx`.
 *
 *   Devices  what is in the scene, and where each one stands
 *   Screen   what is on the screens, plus text, logos and shapes over the frame
 *   Camera   the angle, as presets and as numbers
 *   Scene    the backdrop, the light, portrait focus and the finish
 *   Animate  the timeline: scrubbing, presets, keyframe lanes, easing, shots
 *   Frame    the size and ratio of the picture
 *
 * The viewport keeps its own gestures, with fingers: one drags to orbit, two
 * pinch to zoom and slide to pan.
 */

import { useEffect } from 'react'
import { Box, Camera, Clapperboard, Crop, Download, Images, Pause, Play, Redo2, Sparkles, Undo2 } from 'lucide-react'
import { useStudio } from '../../store'
import { activeShot } from '../../lib/sequence'
import { usePlayback } from '../../lib/playback'
import { quickCapture } from '../../lib/export'
import { ui } from '../../lib/ui'
import { Viewport } from '../Viewport'
import { ExportDialog, ExportProgressOverlay, TemplatesDialog } from '../dialogs'
import {
  AddSection,
  BackgroundSection,
  CameraSection as CameraPresets,
  DevicesSection as DeviceCatalog,
  FrameSection,
} from '../ToolPanel'
import {
  CameraSection as CameraNumbers,
  DevicesSection as DeviceTransforms,
  EffectsSection,
  MediaSection,
  OverlaysSection,
  PortraitSection,
  SceneSection,
} from '../Inspector'
import { FloatButton, MobileEditor, MobileIconButton, MobilePrimary, MobileTopBar } from './MobileShell'
import { StudioAnimate } from './StudioAnimate'

function Bar() {
  const canUndo = useStudio((s) => s.past.length > 0)
  const canRedo = useStudio((s) => s.future.length > 0)
  const st = useStudio.getState
  return (
    <MobileTopBar
      title="3D Studio"
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
  const playing = useStudio((s) => s.playing)
  const animated = useStudio((s) => activeShot(s.project).keyframes.length > 0)
  const snap = () => {
    ui.snap()
    const s = useStudio.getState()
    void quickCapture(s.project, s.assets, s.timeMs).catch((e) =>
      ui.error(`Capture failed: ${(e as Error).message}`),
    )
  }
  return (
    <>
      {animated ? (
        <FloatButton
          icon={playing ? Pause : Play}
          label={playing ? 'Pause' : 'Play'}
          onClick={() => useStudio.getState().setPlaying(!playing)}
        />
      ) : (
        <span />
      )}
      <FloatButton icon={Camera} label="Snap" showLabel strong onClick={snap} />
    </>
  )
}

export function StudioMobile() {
  const hydrated = useStudio((s) => s.hydrated)
  const dialog = useStudio((s) => s.dialog)

  useEffect(() => {
    void useStudio.getState().hydrate()
  }, [])

  usePlayback()

  return (
    <>
      <MobileEditor
        bar={<Bar />}
        stage={hydrated && <Viewport compact />}
        overlay={<Overlay />}
        initial="screen"
        tabs={[
          {
            id: 'devices',
            label: 'Devices',
            icon: Box,
            heading: false,
            panel: (
              <>
                <DeviceCatalog />
                <DeviceTransforms />
              </>
            ),
          },
          {
            id: 'screen',
            label: 'Screen',
            icon: Images,
            heading: false,
            panel: (
              <>
                <MediaSection />
                <OverlaysSection />
                <AddSection />
              </>
            ),
          },
          {
            id: 'camera',
            label: 'Camera',
            icon: Camera,
            heading: false,
            panel: (
              <>
                <CameraPresets />
                <CameraNumbers />
              </>
            ),
          },
          {
            id: 'scene',
            label: 'Scene',
            icon: Sparkles,
            heading: false,
            panel: (
              <>
                <BackgroundSection />
                <SceneSection />
                <PortraitSection />
                <EffectsSection />
              </>
            ),
          },
          { id: 'animate', label: 'Animate', icon: Clapperboard, heading: false, panel: <StudioAnimate /> },
          { id: 'frame', label: 'Frame', icon: Crop, panel: <FrameSection /> },
        ]}
      />
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'templates' && <TemplatesDialog />}
      <ExportProgressOverlay />
    </>
  )
}
