/**
 * ASCII, on a phone.
 *
 * The desktop panel's three pages become five tabs, in the order the work
 * goes: the photo, the style that cuts it, the adjustments to that cut, the
 * filters under it, and the colour over it.
 *
 * Until there is a photo there is nothing to adjust, so the other four tabs
 * wait and the sheet stays shut, leaving the whole screen to the two ways in:
 * your own picture, or one of the starters. Once one is in, the sheet opens on
 * Style, which is the choice that changes the most.
 *
 * Shuffle floats on the picture for the same reason Remix does in Signal: it is
 * the one control worth pressing before you know what any of the others do.
 */

import { useEffect } from 'react'
import {
  Dices,
  Download,
  Image as ImageIcon,
  Layers,
  Palette,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  Type,
  Undo2,
} from 'lucide-react'
import { useStudio } from '../store'
import { BareSections } from '../lib/touch'
import { HoldButton } from '../components/HoldButton'
import {
  FloatButton,
  MobileEditor,
  MobileIconButton,
  MobilePrimary,
  MobileTopBar,
} from '../components/mobile/MobileShell'
import { useAscii } from './store'
import { AsciiCanvas } from './AsciiCanvas'
import {
  BackdropGroup,
  CharactersGroup,
  ColorGroup,
  DitherGroup,
  GridGroup,
  LooksGroup,
  SourceGroup,
  StyleSettingsGroup,
  ToneGroup,
} from './AsciiLeftPanel'
import { StylePicker } from './AsciiStylePicker'
import { LayersPage } from './AsciiLayers'
import { FinishSection, RevealSection } from './AsciiFinish'
import { AsciiExportDialog } from './AsciiExportDialog'

function Bar() {
  const canUndo = useAscii((s) => s.past.length > 0)
  const canRedo = useAscii((s) => s.future.length > 0)
  const ready = useAscii((s) => s.bitmap !== null)
  const st = useAscii.getState
  return (
    <MobileTopBar
      title="ASCII"
      actions={
        <>
          <MobileIconButton icon={Undo2} label="Undo" onClick={() => st().undo()} disabled={!canUndo} />
          <MobileIconButton icon={Redo2} label="Redo" onClick={() => st().redo()} disabled={!canRedo} />
        </>
      }
      primary={
        <MobilePrimary
          icon={Download}
          label="Export"
          disabled={!ready}
          onClick={() => st().setDialog('export')}
        />
      }
    />
  )
}

function PhotoPanel() {
  return (
    <>
      <BareSections value>
        <SourceGroup />
      </BareSections>
      <div className="flex justify-center px-4 pt-1">
        <HoldButton
          icon={<RotateCcw size={14} strokeWidth={2} />}
          label="Start over"
          hint="Hold to clear the picture and the settings"
          onHold={() => useAscii.getState().startOver()}
          spinIcon
        />
      </div>
    </>
  )
}

export function AsciiMobile() {
  const hydrated = useAscii((s) => s.hydrated)
  const dialog = useAscii((s) => s.dialog)
  const hydrate = useAscii((s) => s.hydrate)
  const hasImage = useAscii((s) => s.bitmap !== null)
  const theme = useStudio((s) => s.theme)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // a fresh document takes its paper from the theme, as on the desktop
  useEffect(() => {
    if (!hydrated) return
    const s = useAscii.getState()
    if (s.doc.assetId) return
    const paper = theme === 'light' ? '#f5f6f6' : '#08090a'
    const ink = theme === 'light' ? '#0f1011' : '#f7f8f8'
    if (s.doc.backdrop.color === paper) return
    s.patch((d) => {
      d.backdrop.color = paper
      d.color.ink = ink
    })
  }, [hydrated, theme])

  const locked = !hasImage

  return (
    <>
      <MobileEditor
        /* a photo arriving or leaving is a different starting point, so the
           editor starts over from the tab and height that suit it */
        key={hasImage ? 'art' : 'empty'}
        bar={<Bar />}
        stage={hydrated && <AsciiCanvas compact />}
        overlay={
          hasImage && (
            <>
              <span />
              <FloatButton
                icon={Dices}
                label="Shuffle"
                showLabel
                strong
                onClick={() => useAscii.getState().shuffle()}
              />
            </>
          )
        }
        initial={hasImage ? 'style' : 'photo'}
        initialDetent={hasImage ? 'open' : 'closed'}
        tabs={[
          { id: 'photo', label: 'Photo', icon: ImageIcon, panel: <PhotoPanel /> },
          {
            id: 'style',
            label: 'Style',
            icon: Type,
            disabled: locked,
            heading: false,
            panel: (
              <>
                <StylePicker />
                <StyleSettingsGroup />
                <CharactersGroup />
                <LooksGroup />
              </>
            ),
          },
          {
            id: 'adjust',
            label: 'Adjust',
            icon: SlidersHorizontal,
            disabled: locked,
            heading: false,
            panel: (
              <>
                <ToneGroup />
                <GridGroup />
                <DitherGroup />
              </>
            ),
          },
          { id: 'layers', label: 'Layers', icon: Layers, disabled: locked, heading: false, panel: <LayersPage /> },
          {
            id: 'colour',
            label: 'Colour',
            icon: Palette,
            disabled: locked,
            heading: false,
            panel: (
              <>
                <ColorGroup />
                <BackdropGroup />
                <FinishSection />
                <RevealSection />
              </>
            ),
          },
        ]}
      />
      {dialog === 'export' && <AsciiExportDialog />}
    </>
  )
}
