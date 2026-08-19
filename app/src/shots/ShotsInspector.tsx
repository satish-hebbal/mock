import {
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
  Upload,
} from 'lucide-react'
import { useShots } from './store'
import { MiniButton, Section, Segments, SliderRow, SubHeading } from '../components/controls'
import { selectedShotsImage } from './types'
import { getShotsDevice } from './devices'
import { ShotsPreview } from './ShotsCanvas'

/*
 * The Shots inspector: where the selected screen *sits*. What it is (device,
 * media, shadow) and what it sits on (canvas, backdrop) both live in the left
 * panel, so this rail stays short and every control here moves the same thing —
 * the screen's placement in the frame.
 */

const iconProps = { size: 12, strokeWidth: 1.75 } as const
const secIcon = { size: 13, strokeWidth: 1.75 } as const
const subIcon = { size: 11, strokeWidth: 1.75 } as const

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

      <div className="mt-2 border-t border-(--line) pt-2">
        <SubHeading icon={<RotateCw {...subIcon} />}>Rotate</SubHeading>
        <SliderRow
          icon={<SLIDER_ICON.rotate />}
          label="Rotate"
          value={img.rotate}
          min={-45}
          max={45}
          step={0.5}
          onChange={(rotate) => setImage({ rotate })}
        />
      </div>

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
  const hasScreens = useShots((s) => s.doc.images.length > 0)
  if (!hasScreens) return <EmptyState />
  return (
    <>
      <FrameSection />
      <PlacementSection />
      <TiltSection />
    </>
  )
}
