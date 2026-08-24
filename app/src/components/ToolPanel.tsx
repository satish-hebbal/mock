import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AppWindow,
  ArrowLeftRight,
  ChevronsLeft,
  CircleMinus,
  Copy,
  ImagePlus,
  Link2,
  Laptop,
  Monitor,
  Plus,
  Shuffle,
  Smartphone,
  Square,
  Tablet,
  Tv,
  Type,
  Unlink,
  Upload,
  Watch,
  type LucideIcon,
} from 'lucide-react'
import { pickMediaFile, useStudio } from '../store'
import { DEVICE_CATEGORIES, PICKABLE_DEVICES, getDevice, type DeviceKind } from '../lib/registry'
import {
  ASPECT_PRESETS,
  CAMERA_PRESETS,
  CAMERA_PRESET_GROUPS,
  GRADIENT_PRESETS,
  SIZE_GROUPS,
  SIZE_PRESETS,
  frameForAspect,
  presetCamera,
  presetLabel,
  ratioLabel,
  type CameraPreset,
} from '../lib/presets'
import { MESH_PRESETS, meshCss, reshuffleMesh } from '../lib/meshGradient'
import { SOLID_COLORS, WALLPAPERS, getWallpaper, gradientCss } from '../lib/wallpapers'
import { PRESET_PHOTO_CATEGORIES, presetPhotosByCategory } from '../lib/presetPhotos'
import { STUDIO_LOOKS, SWEEP_PAPERS, focalFromFov, lookSwatch } from '../lib/studio'
import { SegmentThumb, SliderRow } from './controls'
import { MoreGrid, Swatch } from './catalog'
import { cssBackground } from '../lib/backgroundCss'
import { CameraStage } from './CameraStage'
import { ENV_MOODS, moodSwatch } from '../lib/moods'
import { SQUIRCLE_CLIP, SquircleDefs } from '../lib/squircle'
import {
  addLogoOverlay,
  addShapeOverlay,
  addTextOverlay,
  importBackgroundImage,
  requestDevice,
} from '../lib/sceneActions'
import { SECTIONS } from '../lib/sections'
import type { CameraState } from '../types'

/*
 * The panel the rail opens. It carries the choices you make *while looking at
 * the scene* (which device, which angle, which backdrop) as browsable
 * catalogs. Going vertical is what buys that: a column can show a whole
 * catalog at once where the old ribbon had to scroll it sideways past the
 * canvas. The inspector on the right keeps the fine-tuning.
 */

const KIND_ICON: Record<DeviceKind, LucideIcon> = {
  phone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  monitor: Monitor,
  tv: Tv,
  watch: Watch,
  browser: AppWindow,
  card: Square,
}

// ----- primitives -----

/**
 * A titled block. Quiet heading, so the catalog under it stays the loud part.
 *
 * `action` puts a verb on the heading row, Shuffle beside Mesh, where Shots
 * already puts its own, rather than parking it under the grid as a full-width
 * button pretending to be another preset.
 */
function Group({
  label,
  divider = true,
  action,
  children,
}: {
  label?: string
  /** off for a run of catalog shelves that should read as one continuous list */
  divider?: boolean
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={`px-3 py-3 ${divider ? 'border-b border-(--line) last:border-b-0' : ''}`}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="t-eyebrow text-(--tx3) uppercase">{label}</p>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

/** Pill used inside the wrapping strips. */
function Chip({
  children,
  onClick,
  active,
  title,
  full,
}: {
  children: ReactNode
  onClick: () => void
  active?: boolean
  title?: string
  full?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 t-body-sm whitespace-nowrap transition-colors ${
        full ? 'w-full justify-center' : ''
      } ${
        active
          ? 'bg-(--sel) text-(--tx)'
          : 'bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
      }`}
    >
      {children}
    </button>
  )
}

/** Chips that wrap onto as many lines as they need. */
function Wrap({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>
}

/** Full-width catalog row: glyph, name, and an optional trailing note. */
function ListRow({
  icon: Icon,
  label,
  note,
  active,
  onClick,
  title,
}: {
  icon?: LucideIcon
  label: string
  note?: string
  active?: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      aria-pressed={active}
      className={`flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left t-body-sm transition-colors ${
        active
          ? 'bg-(--sel) text-(--tx)'
          : 'text-(--tx2) hover:bg-(--field) hover:text-(--tx)'
      }`}
    >
      {Icon && <Icon size={13} strokeWidth={1.8} className="shrink-0 text-(--tx3)" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note && <span className="shrink-0 t-caption text-(--tx3) tabular-nums">{note}</span>}
    </button>
  )
}

// ----- sections -----

function DevicesSection() {
  const devices = useStudio((s) => s.project.scene.devices)
  const selectedId = useStudio((s) => s.selectedDeviceId)
  const [cat, setCat] = useState<'All' | (typeof DEVICE_CATEGORIES)[number]>('All')
  const st = useStudio.getState

  const selected = devices.find((d) => d.id === selectedId) ?? devices[0]
  const cats = DEVICE_CATEGORIES.filter((c) => PICKABLE_DEVICES.some((d) => d.category === c))
  const list = cat === 'All' ? PICKABLE_DEVICES : PICKABLE_DEVICES.filter((d) => d.category === cat)

  return (
    <>
      <Group label="In scene">
        <div className="flex flex-col gap-0.5">
          {devices.map((d, i) => {
            const active = d.id === selected?.id
            return (
              <div
                key={d.id}
                className={`flex h-8 items-center rounded-sm pr-1 transition-colors ${
                  active ? 'bg-(--sel) text-(--tx)' : 'text-(--tx2) hover:bg-(--field)'
                }`}
              >
                <button
                  onClick={() => st().selectDevice(d.id)}
                  className="min-w-0 flex-1 truncate px-2 text-left t-body-sm"
                >
                  {i + 1} · {getDevice(d.modelId).name}
                </button>
                <button
                  title="Duplicate"
                  aria-label="Duplicate device"
                  onClick={() => st().duplicateDevice(d.id)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xs text-(--tx3) hover:text-(--tx)"
                >
                  <Copy size={12} strokeWidth={1.9} />
                </button>
                {devices.length > 1 && (
                  <button
                    title="Remove device"
                    aria-label="Remove device"
                    onClick={() => st().removeDevice(d.id)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xs text-(--tx3) hover:text-(--danger)"
                  >
                    <CircleMinus size={13} strokeWidth={1.9} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {devices.length > 1 && (
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {(['row', 'fan', 'stack'] as const).map((m) => (
              <Chip key={m} full title={`Arrange in a ${m}`} onClick={() => st().arrangeDevices(m)}>
                <span className="capitalize">{m}</span>
              </Chip>
            ))}
          </div>
        )}
      </Group>

      <Group label="Add a device">
        <Wrap>
          <Chip active={cat === 'All'} onClick={() => setCat('All')}>
            All
          </Chip>
          {cats.map((c) => (
            <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
              {c}
            </Chip>
          ))}
        </Wrap>
        <div className="mt-2 flex flex-col gap-0.5">
          {list.map((d) => (
            <ListRow
              key={d.id}
              icon={KIND_ICON[d.kind]}
              label={d.name}
              title={`Add ${d.name}`}
              onClick={() => st().addDevice(d.id)}
            />
          ))}
        </div>
        <button
          onClick={() => void requestDevice()}
          title="Tell us which device to add next"
          className="mt-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-(--line2) t-body-sm text-(--tx3) transition-colors hover:border-(--line2) hover:text-(--tx2)"
        >
          <Plus size={12} /> Request a device
        </button>
      </Group>
    </>
  )
}

/**
 * Complete photographic setups. Each card carries its recipe, so picking one
 * also shows what a photographer would have rigged to get it.
 */
function StudioPresetsTab() {
  // Off by default: a look is a lighting setup, and quietly re-aiming the
  // lens undoes framing that was usually deliberate. Opt in to take the
  // framing too when you want the whole shot the preset was designed around.
  const [withCamera, setWithCamera] = useState(false)
  const st = useStudio.getState
  return (
    <>
      <Group label="Presets">
        <div className="flex flex-col gap-1">
          {STUDIO_LOOKS.map((l) => (
            <button
              key={l.id}
              onClick={() => st().applyStudioLook(l.id, withCamera)}
              title={`${l.recipe} · ${focalFromFov(l.camera.fov)}mm`}
              className="flex items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-(--field)"
            >
              <span
                className="h-9 w-12 shrink-0 rounded-xl"
                style={{ background: lookSwatch(l) }}
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate t-body-sm text-(--tx)">{l.name}</span>
                <span className="truncate t-caption text-(--tx3)">
                  {l.recipe} · {focalFromFov(l.camera.fov)}mm
                </span>
              </span>
            </button>
          ))}
        </div>
      </Group>
      <Group>
        <label
          title="Looks are designed around a framing. Check this to take that framing too"
          className="flex cursor-pointer items-center gap-2 t-body-sm text-(--tx2)"
        >
          <input
            type="checkbox"
            checked={withCamera}
            onChange={(e) => setWithCamera(e.target.checked)}
          />
          Also set the camera
        </label>
        <p className="mt-2 t-caption leading-snug text-(--tx3)">
          Lights, sweep, shadow and grade come as one setup. Your camera stays where you
          put it.
        </p>
      </Group>
    </>
  )
}

/**
 * The world the product sits in.
 *
 * This is a peer of the studio presets, not a detail inside them: a preset
 * rigs the lamps, a mood decides what those lamps are standing in. Both are
 * decisions you make while watching the canvas, which is why they share this
 * panel rather than living down the inspector where the choice was easy to
 * scroll past and never find.
 */
function EnvironmentTab() {
  const env = useStudio((s) => s.project.scene.environment)
  const setEnvironment = useStudio((s) => s.setEnvironment)
  const current = env.mood ?? 'studio'
  return (
    <>
      <Group>
        <div className="flex flex-col gap-1">
          {ENV_MOODS.map((m) => {
            const active = current === m.id
            return (
              <button
                key={m.id}
                onClick={() =>
                  setEnvironment({
                    mood: m.id,
                    hemiSky: m.hemi.sky,
                    hemiGround: m.hemi.ground,
                    hemiIntensity: m.hemi.intensity,
                  })
                }
                title={m.note}
                className={`flex items-center gap-2.5 rounded-md p-1.5 text-left transition-colors ${
                  active ? 'bg-(--sel)' : 'hover:bg-(--field)'
                }`}
              >
                <span
                  className="h-10 w-10 shrink-0"
                  style={{ background: moodSwatch(m), clipPath: SQUIRCLE_CLIP }}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate t-body-sm text-(--tx)">{m.name}</span>
                  <span className="truncate t-caption text-(--tx3)">{m.note}</span>
                </span>
              </button>
            )
          })}
        </div>
      </Group>
      <Group>
        <p className="t-caption leading-snug text-(--tx3)">
          What the world reflects in a glossy body. Your lamps stay as you set them, so a
          mood tints the shot rather than relighting it.
        </p>
      </Group>
    </>
  )
}

/**
 * Is the camera standing where this preset would put it?
 *
 * Only the three angles are compared. A preset that also names a lens leaves
 * the dolly wherever the framing trade landed it, and someone who then nudges
 * the zoom has not stopped being at that angle.
 */
function atPreset(cam: CameraState, preset: CameraPreset): boolean {
  const near = (a: number | undefined, b: number) => a === undefined || Math.abs(a - b) < 0.75
  return (
    near(preset.cam.tiltX, cam.tiltX) &&
    near(preset.cam.tiltY, cam.tiltY) &&
    near(preset.cam.roll, cam.roll)
  )
}

function CameraSection() {
  const cam = useStudio((s) => s.project.scene.camera)
  const st = useStudio.getState
  return (
    <>
      <Group label="Stage">
        <CameraStage />
      </Group>
      <Group label="Angle">
        {CAMERA_PRESET_GROUPS.map((g, gi) => (
          <div key={g.id} className={gi > 0 ? 'mt-3' : ''}>
            <p className="mb-1.5 t-caption text-(--tx3)">{g.label}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {CAMERA_PRESETS.filter((p) => p.group === g.id).map((p) => (
                <Chip
                  key={p.name}
                  full
                  title={p.cam.fov ? `${p.note} · ${focalFromFov(p.cam.fov)}mm` : p.note}
                  active={atPreset(cam, p)}
                  onClick={() => st().setCamera(presetCamera(p, cam), 'cam-preset')}
                >
                  {p.name}
                </Chip>
              ))}
            </div>
          </div>
        ))}
        <button
          title="Reset tilt, pan and rotation"
          onClick={() =>
            st().setCamera(
              { tiltX: 0, tiltY: 0, roll: 0, panX: 0, panY: 0, rotateX: 0, rotateY: 0 },
              'cam-reset',
            )
          }
          className="mt-3 flex h-7 w-full items-center justify-center rounded-sm border border-dashed border-(--line2) t-body-sm text-(--tx3) transition-colors hover:border-(--line2) hover:text-(--tx2)"
        >
          Snap straight-on
        </button>
        <p className="mt-2 t-caption leading-snug text-(--tx3)">
          Each angle brings its own lens, and dollies in or out to match, so the subject
          stays the size it was and only the perspective changes.
        </p>
      </Group>
    </>
  )
}

/** Numeric field that only commits on blur/Enter, so a half-typed "19" isn't clamped. */
function NumField({
  value,
  onCommit,
  label,
}: {
  value: number
  onCommit: (v: number) => void
  label: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n) && n > 0) onCommit(n)
    else setDraft(String(value))
  }
  return (
    <input
      value={draft}
      aria-label={label}
      inputMode="numeric"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(String(value))
          e.currentTarget.blur()
        }
      }}
      className="h-7 min-w-0 flex-1 rounded-sm bg-(--field) px-2 text-center t-body-sm text-(--tx) tabular-nums outline-none hover:bg-(--field-h) focus:ring-2 focus:ring-(--focus)"
    />
  )
}

/**
 * A frame shape, drawn in the backdrop you are actually going to export.
 *
 * An empty outline tells you the proportions and nothing else. Filling it with
 * the live scene turns the picker into a set of thumbnails of the same shot at
 * different crops, which is the decision being made, a photo backdrop under
 * 9:16 and under 21:9 are visibly different pictures, and the outlines were
 * identical. `box` is the square the shape is fitted into, so every preview in
 * a row sits on the same baseline whichever way round it is.
 */
function FramePreview({
  w,
  h,
  box,
  style,
  active,
}: {
  w: number
  h: number
  box: number
  style: React.CSSProperties
  active?: boolean
}) {
  const tw = w >= h ? box : box * (w / h)
  const th = w >= h ? box * (h / w) : box
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: box, height: box }}>
      <span
        className={`rounded-xs bg-cover bg-center ${active ? 'ring-1 ring-(--tx2)' : ''}`}
        style={{ width: Math.round(tw), height: Math.round(th), ...style }}
      />
    </span>
  )
}

function FrameSection() {
  const size = useStudio((s) => s.project.exportSize)
  const setExportSize = useStudio((s) => s.setExportSize)
  const background = useStudio((s) => s.project.scene.background)
  const bgImageUrl = useStudio((s) =>
    s.project.scene.background.imageAssetId
      ? (s.assets[s.project.scene.background.imageAssetId]?.url ?? null)
      : null,
  )
  const [linked, setLinked] = useState(false)
  const ratio = size.width / size.height

  // the same paint the viewport and the exporter use, so a preview can't lie
  const bgStyle = useMemo(
    () => cssBackground(background, bgImageUrl),
    [background, bgImageUrl],
  )

  const setWidth = (width: number) =>
    setExportSize(width, linked ? Math.round(width / ratio) : size.height)
  const setHeight = (height: number) =>
    setExportSize(linked ? Math.round(height * ratio) : size.width, height)

  const activePreset = SIZE_PRESETS.find((p) => p.width === size.width && p.height === size.height)

  return (
    <>
      <Group label="Size">
        {/* the frame as it stands, at the top, so the numbers below have
            something to be the numbers *of* */}
        <div className="mb-2 flex items-center gap-2.5 rounded-md bg-(--field) p-2">
          <FramePreview w={size.width} h={size.height} box={40} style={bgStyle} />
          <span className="min-w-0 flex-1">
            <span className="block truncate t-body-sm font-semibold text-(--tx)">
              {activePreset ? presetLabel(activePreset.name) : ratioLabel(size.width, size.height)}
            </span>
            <span className="block t-caption text-(--tx3) tabular-nums">
              {size.width} × {size.height} px
            </span>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <NumField value={size.width} onCommit={setWidth} label="Frame width" />
          <span className="t-body-sm text-(--tx3)">×</span>
          <NumField value={size.height} onCommit={setHeight} label="Frame height" />
          <Chip
            active={linked}
            title={linked ? 'Ratio locked, editing one side moves the other' : 'Lock the ratio'}
            onClick={() => setLinked(!linked)}
          >
            {linked ? <Link2 size={12} /> : <Unlink size={12} />}
          </Chip>
          <Chip title="Swap width and height" onClick={() => setExportSize(size.height, size.width)}>
            <ArrowLeftRight size={12} />
          </Chip>
        </div>
      </Group>

      <Group label="Ratio" divider={false}>
        <div className="grid grid-cols-3 gap-1.5">
          {ASPECT_PRESETS.map((a) => {
            const active = Math.abs(ratio - a.w / a.h) < 0.01
            const f = frameForAspect(size, a.w, a.h)
            return (
              <button
                key={a.id}
                aria-pressed={active}
                title={a.note ?? `${a.label} frame`}
                onClick={() => setExportSize(f.width, f.height)}
                className={`flex flex-col items-center gap-1 rounded-md py-2 transition-colors ${
                  active ? 'bg-(--sel)' : 'hover:bg-(--field)'
                }`}
              >
                <FramePreview w={a.w} h={a.h} box={30} style={bgStyle} />
                <span className={`t-caption ${active ? 'text-(--tx)' : 'text-(--tx2)'}`}>
                  {a.label}
                </span>
                <span className="t-caption text-(--tx3) tabular-nums">
                  {f.width} × {f.height}
                </span>
              </button>
            )
          })}
        </div>
      </Group>

      {/* one block per destination: you arrive knowing where the shot is going */}
      {SIZE_GROUPS.map((g) => (
        <Group key={g} label={g} divider={false}>
          <div className="flex flex-col gap-0.5">
            {SIZE_PRESETS.filter((p) => p.group === g).map((p) => {
              const active = p.width === size.width && p.height === size.height
              return (
                <button
                  key={p.name}
                  aria-pressed={active}
                  onClick={() => setExportSize(p.width, p.height)}
                  className={`flex items-center gap-2.5 rounded-md p-1.5 text-left transition-colors ${
                    active ? 'bg-(--sel)' : 'hover:bg-(--field)'
                  }`}
                >
                  <FramePreview w={p.width} h={p.height} box={26} style={bgStyle} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate t-body-sm ${active ? 'text-(--tx)' : 'text-(--tx2)'}`}
                    >
                      {presetLabel(p.name)}
                    </span>
                    <span className="block t-caption text-(--tx3) tabular-nums">
                      {p.width} × {p.height}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </Group>
      ))}
    </>
  )
}

/*
 * The backdrop catalog.
 *
 * Stacked rather than gated behind a type picker: every group is browsable at
 * once and clicking a swatch sets both the kind of backdrop and its value, so
 * finding one is looking rather than choosing a category first and then
 * looking. The three that have no swatch to show (the sweep, an uploaded
 * image, and no backdrop at all) lead as tiles.
 */
function BackdropTab() {
  const bg = useStudio((s) => s.project.scene.background)
  const bgImageUrl = useStudio((s) =>
    s.project.scene.background.imageAssetId
      ? (s.assets[s.project.scene.background.imageAssetId]?.url ?? null)
      : null,
  )
  const setBackground = useStudio((s) => s.setBackground)
  const st = useStudio.getState

  /*
   * A photo carries its own exposure, so a blur and a brightness left over
   * from tuning a flat gradient make the preset arrive looking nothing like
   * its thumbnail. Picking one from a catalog is a fresh start; the Finish
   * sliders are still right there to dirty it again.
   */
  const pickPhoto = (photoId: string) =>
    setBackground({ type: 'photo', photoId, blur: 0, brightness: 1 })

  return (
    <>
      <Group label="Backdrop" divider={false}>
        <div className="grid grid-cols-3 gap-1.5">
          <Chip
            full
            active={bg.type === 'studio'}
            title="Seamless studio paper, lit by the key"
            onClick={() => setBackground({ type: 'studio' })}
          >
            Sweep
          </Chip>
          <Chip
            full
            active={bg.type === 'image'}
            title="Your own image, cropped to fill the frame"
            onClick={() =>
              bg.imageAssetId ? setBackground({ type: 'image' }) : importBackgroundImage()
            }
          >
            Image
          </Chip>
          <Chip
            full
            active={bg.type === 'transparent'}
            title="No backdrop, exports with a true alpha channel"
            onClick={() => setBackground({ type: 'transparent' })}
          >
            None
          </Chip>
        </div>

        {bg.type === 'image' && (
          <>
            {bgImageUrl && (
              <div
                className="mt-1.5 h-16 w-full rounded-sm bg-cover bg-center"
                style={{ backgroundImage: `url(${bgImageUrl})` }}
              />
            )}
            <div className="mt-1.5">
              <Chip full onClick={importBackgroundImage}>
                <Upload size={12} /> {bgImageUrl ? 'Replace image' : 'Upload an image'}
              </Chip>
            </div>
          </>
        )}

        {bg.type === 'transparent' && (
          <p className="mt-2 t-caption leading-snug text-(--tx3)">
            Exports with a true alpha channel (PNG / WebM-alpha).
          </p>
        )}
      </Group>

      {bg.type === 'studio' && (
        <Group label="Paper" divider={false}>
          <div className="grid grid-cols-4 gap-1.5">
            <MoreGrid cols={4}>
              {SWEEP_PAPERS.map((p) => (
                <Swatch
                  key={p.name}
                  title={p.name}
                  active={bg.sweep.color === p.color}
                  onClick={() => st().setSweep({ color: p.color, hot: p.hot })}
                  style={{
                    background: `radial-gradient(120% 90% at 50% 42%, ${p.hot}, ${p.color} 72%)`,
                  }}
                />
              ))}
            </MoreGrid>
          </div>
        </Group>
      )}

      <Group label="Solid" divider={false}>
        <div className="grid grid-cols-4 gap-1.5">
          <MoreGrid cols={4}>
            {SOLID_COLORS.map((c) => (
              <Swatch
                key={c}
                title={c}
                active={bg.type === 'solid' && bg.color === c}
                onClick={() => setBackground({ type: 'solid', color: c })}
                style={{ background: c }}
              />
            ))}
          </MoreGrid>
        </div>
        <label
          title="Custom color"
          className="mt-1.5 flex h-7 cursor-pointer items-center gap-2 rounded-sm bg-(--field) px-2.5 t-body-sm text-(--tx2) hover:bg-(--field-h)"
        >
          <span className="relative h-4 w-4 overflow-hidden rounded-xs border border-(--line2)">
            <input
              type="color"
              value={bg.color}
              aria-label="Background color"
              onChange={(e) => setBackground({ color: e.target.value, type: 'solid' })}
              className="absolute -inset-1 cursor-pointer"
            />
          </span>
          Custom color
        </label>
      </Group>

      <Group label="Gradient presets" divider={false}>
        <div className="grid grid-cols-4 gap-1.5">
          <MoreGrid cols={4}>
            {WALLPAPERS.map((w) => (
              <Swatch
                key={w.id}
                title={w.name}
                active={bg.type === 'wallpaper' && getWallpaper(bg.wallpaperId).id === w.id}
                onClick={() => setBackground({ type: 'wallpaper', wallpaperId: w.id })}
                style={{ background: gradientCss(w.gradient) }}
              />
            ))}
          </MoreGrid>
        </div>
      </Group>

      {/* Reshuffle reseeds the mesh already chosen rather than picking a
          different one, so it belongs on the heading row with the other verbs,
          not in the grid pretending to be another preset. */}
      <Group
        label="Mesh"
        divider={false}
        action={
          <button
            onClick={() => setBackground({ mesh: reshuffleMesh(bg.mesh) })}
            title="Reshuffle the mesh"
            className="flex h-6 items-center gap-1 rounded-full bg-(--field) px-2.5 t-caption text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx)"
          >
            <Shuffle size={11} strokeWidth={2} />
            Shuffle
          </button>
        }
      >
        <div className="grid grid-cols-4 gap-1.5">
          <MoreGrid cols={4}>
            {MESH_PRESETS.map((m) => (
              <Swatch
                key={m.id}
                title={m.name}
                active={bg.type === 'mesh' && bg.mesh.stops?.[0]?.color === m.stops[0].color}
                onClick={() =>
                  setBackground({
                    type: 'mesh',
                    mesh: {
                      ...bg.mesh,
                      colors: m.stops.map((s) => s.color),
                      base: m.base,
                      stops: m.stops,
                    },
                  })
                }
                style={meshCss({ ...bg.mesh, base: m.base, stops: m.stops })}
              />
            ))}
          </MoreGrid>
        </div>
      </Group>

      {/* one group per shipped folder, in PRESET_PHOTO_CATEGORIES order */}
      {PRESET_PHOTO_CATEGORIES.map((cat) => (
        <Group key={cat.id} label={cat.label} divider={false}>
          <div className="grid grid-cols-4 gap-1.5">
            <MoreGrid cols={4}>
              {presetPhotosByCategory(cat.id).map((p) => (
                <Swatch
                  key={p.id}
                  title={p.name}
                  active={bg.type === 'photo' && bg.photoId === p.id}
                  onClick={() => pickPhoto(p.id)}
                  style={{ backgroundImage: `url(${p.thumb})` }}
                />
              ))}
            </MoreGrid>
          </div>
        </Group>
      ))}

      <Group label="Custom gradient" divider={false}>
        <div className="grid grid-cols-4 gap-1.5">
          <MoreGrid cols={4}>
            {GRADIENT_PRESETS.map((g, i) => (
              <Swatch
                key={i}
                title={`Gradient ${i + 1}`}
                active={
                  bg.type === 'gradient' && bg.gradient.from === g.from && bg.gradient.to === g.to
                }
                onClick={() =>
                  setBackground({ type: 'gradient', gradient: { ...bg.gradient, ...g } })
                }
                style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
              />
            ))}
          </MoreGrid>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {(['linear', 'radial'] as const).map((kind) => (
            <Chip
              key={kind}
              full
              active={bg.type === 'gradient' && bg.gradient.kind === kind}
              onClick={() => setBackground({ type: 'gradient', gradient: { ...bg.gradient, kind } })}
            >
              <span className="capitalize">{kind}</span>
            </Chip>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {(['from', 'to'] as const).map((end) => (
            <label
              key={end}
              className="flex h-7 flex-1 cursor-pointer items-center gap-2 rounded-sm bg-(--field) px-2.5 t-body-sm text-(--tx2) capitalize hover:bg-(--field-h)"
            >
              <span className="relative h-4 w-4 overflow-hidden rounded-xs border border-(--line2)">
                <input
                  type="color"
                  value={bg.gradient[end]}
                  aria-label={`Gradient ${end} color`}
                  onChange={(e) =>
                    setBackground({
                      type: 'gradient',
                      gradient: { ...bg.gradient, [end]: e.target.value },
                    })
                  }
                  className="absolute -inset-1 cursor-pointer"
                />
              </span>
              {end}
            </label>
          ))}
        </div>
        {bg.gradient.kind === 'linear' && (
          <div className="mt-1">
            <SliderRow
              label="Angle"
              value={bg.gradient.angle}
              min={0}
              max={360}
              step={1}
              onChange={(angle) => setBackground({ gradient: { ...bg.gradient, angle } })}
            />
          </div>
        )}
      </Group>

      {bg.type !== 'transparent' && (
        <Group label="Finish" divider={false}>
          <SliderRow
            label="Blur"
            value={bg.blur}
            min={0}
            max={60}
            step={1}
            hint="Throws the backdrop out of focus without touching the product"
            onChange={(blur) => setBackground({ blur })}
          />
          <SliderRow
            label="Bright"
            value={bg.brightness}
            min={0.4}
            max={1.8}
            onChange={(brightness) => setBackground({ brightness })}
          />
          {(bg.blur > 0 || bg.brightness !== 1) && (
            <div className="mt-1.5">
              <Chip full onClick={() => setBackground({ blur: 0, brightness: 1 })}>
                Reset finish
              </Chip>
            </div>
          )}
          <p className="mt-2 t-caption leading-snug text-(--tx3)">
            Grain, vignette and the colour grade live in the inspector, over the whole
            picture rather than the backdrop alone.
          </p>
        </Group>
      )}
    </>
  )
}

/*
 * The three "what does this shot look like" decisions, in one panel: how it's
 * lit, what it's standing in, and what's behind it. They share a home because
 * they share an outcome, and because picking one almost always makes you want
 * to reconsider the other two.
 *
 * No icons on this row. At three tabs across a 280px panel the labels are what
 * carry the meaning, and 'Environment' plus a glyph doesn't fit the cell.
 *
 * Ordered by how often each is reached for, loudest first: the backdrop is the
 * thing you swap over and over while composing, the mood is an occasional
 * change of world, and a lighting look is usually set once at the start. The
 * old order ran the other way, which put the catalog you actually live in
 * behind two tabs you had already finished with.
 */
const SCENE_TABS = [
  { id: 'backdrop', label: 'Background' },
  { id: 'environment', label: 'Environment' },
  { id: 'looks', label: 'Studio' },
] as const

function BackgroundSection() {
  const [tab, setTab] = useState<(typeof SCENE_TABS)[number]['id']>('backdrop')
  return (
    <>
      <div className="border-b border-(--line) p-2">
        <div className="relative grid grid-cols-3 gap-0.5 rounded-md bg-(--field) p-0.5">
          <SegmentThumb
            count={SCENE_TABS.length}
            index={SCENE_TABS.findIndex((t) => t.id === tab)}
            radius="rounded-sm"
          />
          {SCENE_TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-pressed={active}
                className={`relative z-10 flex h-7 items-center justify-center gap-1.5 rounded-sm t-body-sm transition-colors ${
                  active ? 'text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>
      {tab === 'looks' ? (
        <StudioPresetsTab />
      ) : tab === 'environment' ? (
        <EnvironmentTab />
      ) : (
        <BackdropTab />
      )}
    </>
  )
}

function AddSection() {
  return (
    <Group label="Insert">
      <div className="flex flex-col gap-0.5">
        <ListRow
          icon={Upload}
          label="Upload media"
          title="Put an image or video on the selected device"
          onClick={() => pickMediaFile((f) => void useStudio.getState().importMedia(f))}
        />
        <ListRow icon={Type} label="Text" onClick={addTextOverlay} />
        <ListRow icon={Square} label="Shape" onClick={addShapeOverlay} />
        <ListRow icon={ImagePlus} label="Logo" onClick={addLogoOverlay} />
      </div>
      <p className="mt-2 t-caption leading-snug text-(--tx3)">
        You can also paste or drop media straight onto the canvas.
      </p>
    </Group>
  )
}

// ----- panel -----

const BODY = {
  devices: DevicesSection,
  camera: CameraSection,
  frame: FrameSection,
  background: BackgroundSection,
  add: AddSection,
}

export function ToolPanel() {
  const open = useStudio((s) => s.toolPanelOpen)
  const section = useStudio((s) => s.toolSection)
  if (!open) return null

  const meta = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]
  const Body = BODY[section] ?? DevicesSection
  const Icon = meta.icon

  return (
    <div className="flex w-[280px] shrink-0 flex-col overflow-hidden rounded-lg border border-(--line) bg-(--raised)">
      <SquircleDefs />
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-(--line) pr-2 pl-3">
        <Icon size={13} strokeWidth={1.8} className="text-(--tx2)" />
        <span className="flex-1 t-body-sm font-semibold text-(--tx)">{meta.label}</span>
        <button
          onClick={() => useStudio.getState().setToolPanelOpen(false)}
          title="Close the panel ([)"
          aria-label="Close the panel"
          className="flex h-7 w-7 items-center justify-center rounded-md text-(--tx3) transition-colors hover:bg-(--panel3) hover:text-(--tx)"
        >
          <ChevronsLeft size={15} strokeWidth={1.9} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Body />
      </div>
    </div>
  )
}
