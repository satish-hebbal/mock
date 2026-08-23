import {
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Box,
  Camera,
  FlipHorizontal2,
  FlipVertical2,
  Frame,
  Images,
  Maximize2,
  MoveHorizontal,
  MoveVertical,
  RotateCw,
  Squircle,
  StretchVertical,
  Upload,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { useShots } from './store'
import { MiniButton, Section, Segments, SliderRow, SubHeading } from '../components/controls'
import { selectedShotsImage } from './types'
import { getShotsDevice } from './devices'
import { ShotsPreview } from './ShotsCanvas'
import type { AlignMode } from './align'

/*
 * The Shots inspector: where the selected screen *sits*. What it is (device,
 * media, shadow) and what it sits on (canvas, backdrop) both live in the left
 * panel, so this rail stays short and every control here moves the same thing —
 * the screen's placement in the frame.
 */

const iconProps = { size: 12, strokeWidth: 1.75 } as const
const secIcon = { size: 13, strokeWidth: 1.75 } as const

const SLIDER_ICON = {
  padding: () => <Frame {...iconProps} />,
  scale: () => <Maximize2 {...iconProps} />,
  offsetX: () => <MoveHorizontal {...iconProps} />,
  offsetY: () => <MoveVertical {...iconProps} />,
  radius: () => <Squircle {...iconProps} />,
  rotate: () => <RotateCw {...iconProps} />,
  tiltX: () => <FlipVertical2 {...iconProps} />,
  tiltY: () => <FlipHorizontal2 {...iconProps} />,
}

/**
 * A live thumbnail of the whole frame — a map, not a viewport.
 *
 * It always shows the entire composition at a fixed size, so when the canvas is
 * zoomed past the viewport and showing a detail, this still says what the
 * finished picture looks like.
 *
 * The block used to hold a "3D style required" placeholder — a box explaining
 * why it was empty. Showing the composition instead means the panel is worth
 * looking at whichever style is on, and the Zoom below it has something to act
 * against while you drag.
 */
function FramePreview() {
  const doc = useShots((s) => s.doc)
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-(--line)">
      <ShotsPreview doc={doc} />
    </div>
  )
}

const ALIGN_H: { mode: AlignMode; label: string; icon: LucideIcon }[] = [
  { mode: 'left', label: 'Align left', icon: AlignHorizontalJustifyStart },
  { mode: 'center-h', label: 'Align centre', icon: AlignHorizontalJustifyCenter },
  { mode: 'right', label: 'Align right', icon: AlignHorizontalJustifyEnd },
]
const ALIGN_V: { mode: AlignMode; label: string; icon: LucideIcon }[] = [
  { mode: 'top', label: 'Align top', icon: AlignVerticalJustifyStart },
  { mode: 'middle-v', label: 'Align middle', icon: AlignVerticalJustifyCenter },
  { mode: 'bottom', label: 'Align bottom', icon: AlignVerticalJustifyEnd },
]

function PosBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-8 flex-1 items-center justify-center rounded-md bg-(--field) text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx) disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon size={14} strokeWidth={1.8} />
    </button>
  )
}

/**
 * Align and distribute across every screen currently in the shot.
 *
 * There's nothing to select first — a shot only ever holds up to five
 * screens, so "the things being aligned" is unambiguous. This is the tool for
 * the moment a layout preset gets close but a hand-nudged screen (or the
 * padding difference between two device frames) leaves everything a few
 * pixels off from actually lining up.
 *
 * Lives in the right panel rather than beside Media and Layout presets on the
 * left: those describe *what* the shot contains, this nudges *where* it sits
 * once it's there — the same split Frame and Placement already draw.
 */
function PositionSection({ n }: { n: number }) {
  const align = useShots((s) => s.alignScreens)
  const distribute = useShots((s) => s.distributeScreens)
  const matchHeights = useShots((s) => s.matchHeights)
  const canDistribute = n > 2
  const canMatch = n > 1

  return (
    <Section title="Alignment" icon={<AlignHorizontalDistributeCenter {...secIcon} />}>
      <div className="flex gap-1">
        {ALIGN_H.map((a) => (
          <PosBtn key={a.mode} icon={a.icon} label={a.label} onClick={() => align(a.mode)} />
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {ALIGN_V.map((a) => (
          <PosBtn key={a.mode} icon={a.icon} label={a.label} onClick={() => align(a.mode)} />
        ))}
      </div>
      <div className="mt-2 border-t border-(--line) pt-2">
        <SubHeading>Distribute &amp; match</SubHeading>
      </div>
      <div className="flex gap-1">
        <PosBtn
          icon={AlignHorizontalDistributeCenter}
          label="Distribute horizontal spacing — equalize the gaps (needs 3+ screens)"
          onClick={() => distribute('x')}
          disabled={!canDistribute}
        />
        <PosBtn
          icon={AlignVerticalDistributeCenter}
          label="Distribute vertical spacing — equalize the gaps (needs 3+ screens)"
          onClick={() => distribute('y')}
          disabled={!canDistribute}
        />
        <PosBtn
          icon={StretchVertical}
          label="Match heights — rescale every screen to the same height (needs 2+ screens)"
          onClick={() => matchHeights()}
          disabled={!canMatch}
        />
        <PosBtn icon={Wand2} label="Tidy up" onClick={() => useShots.getState().applyLayout('row')} />
      </div>
    </Section>
  )
}

function PlacementSection() {
  const img = useShots((s) => selectedShotsImage(s.doc))
  const setImage = useShots((s) => s.setImage)
  if (!img) return null

  const dev = getShotsDevice(img.device)

  return (
    <Section title="Placement" icon={<Images {...secIcon} />} badge={dev.bezel ? dev.label : undefined}>
      <SliderRow
        icon={<SLIDER_ICON.padding />}
        label="Padding"
        value={img.padding}
        min={0}
        max={0.42}
        onChange={(padding) => setImage({ padding })}
        hint="Space around the shot (balance)"
      />
      <SliderRow icon={<SLIDER_ICON.scale />} label="Scale" value={img.scale} min={0.3} max={1.6} onChange={(scale) => setImage({ scale })} />
      <SliderRow icon={<SLIDER_ICON.offsetX />} label="Offset X" value={img.offsetX} min={-0.5} max={0.5} onChange={(offsetX) => setImage({ offsetX })} />
      <SliderRow icon={<SLIDER_ICON.offsetY />} label="Offset Y" value={img.offsetY} min={-0.5} max={0.5} onChange={(offsetY) => setImage({ offsetY })} />
      {/* a device frame brings its own corner radius, measured off the asset */}
      {!dev.bezel && (
        <SliderRow
          icon={<SLIDER_ICON.radius />}
          label="Radius"
          value={img.radius}
          min={0}
          max={0.1}
          step={0.002}
          onChange={(radius) => setImage({ radius })}
        />
      )}
      {/* in with the rest: turning the shot is the same kind of adjustment as
          moving or scaling it, and a rule plus a heading that only repeated
          the slider's own label made one row look like a separate decision */}
      <SliderRow
        icon={<SLIDER_ICON.rotate />}
        label="Rotate"
        value={img.rotate}
        min={-45}
        max={45}
        step={0.5}
        onChange={(rotate) => setImage({ rotate })}
      />
    </Section>
  )
}

/**
 * The camera: what the shot looks like, and how close you're standing.
 *
 * Its own section above Placement because it describes the whole picture, while
 * Placement moves one screen inside it — and because a preview is the first
 * thing you want to see, not something to scroll to.
 */
function FrameSection() {
  const zoom = useShots((s) => s.doc.zoom ?? 1)
  const setZoom = useShots((s) => s.setZoom)
  return (
    <Section title="Frame" icon={<Camera {...secIcon} />}>
      <FramePreview />
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <SliderRow
            icon={<Maximize2 {...iconProps} />}
            label="Zoom"
            value={zoom}
            min={0.4}
            max={2.5}
            step={0.01}
            onChange={setZoom}
            format={(v) => `${Math.round(v * 100)}%`}
            hint="Dollies the camera in or out — magnifies the whole shot, and crops"
          />
        </div>
        <MiniButton title="Back to 100%" onClick={() => setZoom(1)}>
          Reset
        </MiniButton>
      </div>
    </Section>
  )
}

/**
 * Flat or tilted, per screen. Kept out of Frame: the camera is one thing for the
 * whole shot, while this is a property of the screen you have selected.
 */
function TiltSection() {
  const img = useShots((s) => selectedShotsImage(s.doc))
  const setImage = useShots((s) => s.setImage)
  if (!img) return null
  const dev = getShotsDevice(img.device)

  return (
    <Section title="Tilt" icon={<Box {...secIcon} />} defaultOpen={img.style3d}>
      <Segments<'flat' | '3d'>
        options={[
          { id: 'flat', label: 'Flat' },
          { id: '3d', label: '3D' },
        ]}
        value={img.style3d ? '3d' : 'flat'}
        onChange={(v) => setImage({ style3d: v === '3d' })}
      />
      {img.style3d ? (
        <>
          <SliderRow icon={<SLIDER_ICON.tiltX />} label="Tilt X" value={img.rotateX} min={-45} max={45} step={0.5} onChange={(rotateX) => setImage({ rotateX })} hint="Pseudo-3D pitch" />
          <SliderRow icon={<SLIDER_ICON.tiltY />} label="Tilt Y" value={img.rotateY} min={-45} max={45} step={0.5} onChange={(rotateY) => setImage({ rotateY })} hint="Pseudo-3D yaw" />
          {dev.bezel && (
            <p className="mt-1.5 t-caption leading-snug text-(--tx3)">
              The {dev.label} frame is hidden while tilted — a frame is a photo lit from one
              angle, and turning it stops matching the pose. Switch to Flat to bring it back.
            </p>
          )}
          <div className="mt-1 text-right">
            <MiniButton onClick={() => setImage({ rotateX: 0, rotateY: 0 })}>Flatten</MiniButton>
          </div>
        </>
      ) : (
        <p className="t-caption leading-snug text-(--tx3)">
          Flat keeps the device frame. Switch to 3D to pitch and yaw the screen.
        </p>
      )}
    </Section>
  )
}

function EmptyState() {
  return (
    <div className="px-3 py-6 text-center">
      <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-(--field) text-(--tx2)">
        <Upload size={16} strokeWidth={1.75} />
      </span>
      <p className="t-body-sm text-(--tx2)">No screen yet</p>
      <p className="mt-1 t-caption leading-snug text-(--tx3)">
        Add one from <span className="text-(--tx2)">Mockup → Media</span> on the left, or drop a
        screenshot onto the canvas.
      </p>
    </div>
  )
}

export function ShotsInspector() {
  const n = useShots((s) => s.doc.images.length)
  if (n === 0) return <EmptyState />
  return (
    <>
      <FrameSection />
      {n > 1 && <PositionSection n={n} />}
      <PlacementSection />
      <TiltSection />
    </>
  )
}
