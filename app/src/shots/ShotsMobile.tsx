/**
 * Shots, on a phone.
 *
 * The desktop tool splits into a left panel of what the screen is and what it
 * sits on, and a right one of where it sits. On a phone those become five
 * tabs in the order a shot gets made: the screen and its device, where it
 * sits, how it is finished, what is behind it, and the size of the picture.
 *
 * With no screenshot in yet, the tabs that act on one wait and the sheet stays
 * shut, so the whole screen is the frame and the one button that fills it.
 */

import { useEffect, type ReactNode } from 'react'
import {
  Crop,
  Download,
  Move,
  Palette,
  Redo2,
  Smartphone,
  Sparkles,
  Undo2,
} from 'lucide-react'
import {
  MobileEditor,
  MobileIconButton,
  MobilePrimary,
  MobileTopBar,
} from '../components/mobile/MobileShell'
import { useShots } from './store'
import { ShotsCanvas } from './ShotsCanvas'
import {
  ApplyScopeRow,
  BackgroundGroup,
  CanvasGroup,
  DevicePicker,
  EffectsGroup,
  FinishGroup,
  LayoutGroup,
  MediaGroup,
  PortraitGroup,
  ShadowGroup,
  ShadowSceneGroup,
  StyleGroup,
} from './ShotsLeftPanel'
import { PlacementSection, PositionSection, TiltSection } from './ShotsInspector'
import { ShotsExportDialog } from './ShotsExportDialog'

function Bar() {
  const canUndo = useShots((s) => s.past.length > 0)
  const canRedo = useShots((s) => s.future.length > 0)
  const ready = useShots((s) => s.doc.images.length > 0)
  const st = useShots.getState
  return (
    <MobileTopBar
      title="Shots"
      actions={
        <>
          <MobileIconButton icon={Undo2} label="Undo" onClick={() => st().undo()} disabled={!canUndo} />
          <MobileIconButton icon={Redo2} label="Redo" onClick={() => st().redo()} disabled={!canRedo} />
        </>
      }
      primary={
        <MobilePrimary icon={Download} label="Export" disabled={!ready} onClick={() => st().setDialog('export')} />
      }
    />
  )
}

/** The Shots panel groups divide themselves with hairlines, as on the desktop. */
function Stack({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-(--line)">{children}</div>
}

export function ShotsMobile() {
  const hydrated = useShots((s) => s.hydrated)
  const dialog = useShots((s) => s.dialog)
  const hydrate = useShots((s) => s.hydrate)
  const count = useShots((s) => s.doc.images.length)
  const has = count > 0

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  return (
    <>
      <MobileEditor
        key={has ? 'shot' : 'empty'}
        bar={<Bar />}
        stage={<div className="dot-grid h-full w-full">{hydrated && <ShotsCanvas compact />}</div>}
        initial="screen"
        initialDetent={has ? 'open' : 'closed'}
        tabs={[
          {
            id: 'screen',
            label: 'Screen',
            icon: Smartphone,
            panel: (
              <Stack>
                <MediaGroup />
                {has && <DevicePicker />}
                {has && <ApplyScopeRow />}
              </Stack>
            ),
          },
          {
            id: 'place',
            label: 'Place',
            icon: Move,
            disabled: !has,
            heading: false,
            panel: (
              <>
                {count > 1 && <PositionSection n={count} />}
                <PlacementSection />
                <TiltSection />
                <LayoutGroup />
              </>
            ),
          },
          {
            id: 'style',
            label: 'Style',
            icon: Sparkles,
            disabled: !has,
            panel: (
              <Stack>
                <StyleGroup />
                <ShadowGroup />
                <FinishGroup />
              </Stack>
            ),
          },
          {
            id: 'backdrop',
            label: 'Backdrop',
            icon: Palette,
            panel: (
              <Stack>
                <BackgroundGroup />
                {has && <PortraitGroup />}
                {has && <ShadowSceneGroup />}
                <EffectsGroup />
              </Stack>
            ),
          },
          { id: 'canvas', label: 'Canvas', icon: Crop, panel: <CanvasGroup /> },
        ]}
      />
      {dialog === 'export' && <ShotsExportDialog />}
    </>
  )
}
