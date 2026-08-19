import { useEffect, useState, type ReactNode } from 'react'
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
  GRADIENT_PRESETS,
  SIZE_PRESETS,
  frameForAspect,
  ratioLabel,
} from '../lib/presets'
import { MESH_PALETTES, meshGradientDataURL } from '../lib/meshGradient'
import { STUDIO_LOOKS, SWEEP_PAPERS, focalFromFov, lookSwatch } from '../lib/studio'
import { SegmentThumb } from './controls'
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
import type { BackgroundType } from '../types'

/*
 * The panel the rail opens. It carries the choices you make *while looking at
 * the scene* — which device, which angle, which backdrop — as browsable
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

const SOLID_SWATCHES = [
  '#0b1220',
  '#161616',
  '#1f2937',
  '#3f3f46',
  '#64748b',
  '#f8fafc',
  '#e7e5e4',
  '#fde68a',
  '#fca5a5',
  '#a7f3d0',
  '#bfdbfe',
  '#ddd6fe',
]

const BG_TYPES: { id: BackgroundType; label: string }[] = [
  { id: 'studio', label: 'Sweep' },
  { id: 'solid', label: 'Solid' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'image', label: 'Image' },
  { id: 'transparent', label: 'Alpha' },
]

// ————— primitives —————

/** A titled block. Quiet heading, so the catalog under it stays the loud part. */
function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="border-b border-(--line) px-3 py-3 last:border-b-0">
      {label && (
        <p className="mb-2 t-eyebrow text-(--tx3) uppercase">
          {label}
        </p>
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

// ————— sections —————

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
  const [withCamera, setWithCamera] = useState(true)
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
                className="h-9 w-12 shrink-0 rounded-sm"
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
        <Chip
          full
          active={withCamera}
          onClick={() => setWithCamera(!withCamera)}
          title="Looks are designed around a framing — turn this off to relight without moving the camera"
        >
          {withCamera ? '✓ ' : ''}Also set the camera
        </Chip>
        <p className="mt-2 t-caption leading-snug text-(--tx3)">
          Lights, sweep, shadow and grade come as one setup.
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

function CameraSection() {
  const st = useStudio.getState
  return (
    <Group label="Angle">
      <div className="grid grid-cols-2 gap-1.5">
        {CAMERA_PRESETS.map((p) => (
          <Chip key={p.name} full onClick={() => st().setCamera(p.cam, 'cam-preset')}>
            {p.name}
          </Chip>
        ))}
      </div>
      <button
        title="Reset tilt, pan and rotation"
        onClick={() =>
          st().setCamera(
            { tiltX: 0, tiltY: 0, roll: 0, panX: 0, panY: 0, rotateX: 0, rotateY: 0 },
            'cam-reset',
          )
        }
        className="mt-1.5 flex h-7 w-full items-center justify-center rounded-sm border border-dashed border-(--line2) t-body-sm text-(--tx3) transition-colors hover:border-(--line2) hover:text-(--tx2)"
      >
        Snap straight-on
      </button>
    </Group>
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
 * The shape of the picture you end up downloading. Ratio is the choice people
 * actually make ("this one's for a story"), so the chips carry a proportional
 * glyph; the exact pixel size sits right above them.
 */
function FrameSection() {
  const size = useStudio((s) => s.project.exportSize)
  const setExportSize = useStudio((s) => s.setExportSize)
  const [linked, setLinked] = useState(false)
  const ratio = size.width / size.height

  const setWidth = (width: number) =>
    setExportSize(width, linked ? Math.round(width / ratio) : size.height)
  const setHeight = (height: number) =>
    setExportSize(linked ? Math.round(height * ratio) : size.width, height)

  return (
    <>
      <Group label="Size">
        <div className="flex items-center gap-1.5">
          <NumField value={size.width} onCommit={setWidth} label="Frame width" />
          <span className="t-body-sm text-(--tx3)">×</span>
          <NumField value={size.height} onCommit={setHeight} label="Frame height" />
          <Chip
            active={linked}
            title={linked ? 'Ratio locked — editing one side moves the other' : 'Lock the ratio'}
            onClick={() => setLinked(!linked)}
          >
            {linked ? <Link2 size={12} /> : <Unlink size={12} />}
          </Chip>
          <Chip title="Swap width and height" onClick={() => setExportSize(size.height, size.width)}>
            <ArrowLeftRight size={12} />
          </Chip>
        </div>
        <p className="mt-1.5 t-caption text-(--tx3)">
          {ratioLabel(size.width, size.height)} · this is the picture you export.
        </p>
      </Group>

      <Group label="Ratio">
        <Wrap>
          {ASPECT_PRESETS.map((a) => {
            const box =
              a.w >= a.h
                ? { width: 16, height: Math.max(4, (16 * a.h) / a.w) }
                : { height: 16, width: Math.max(4, (16 * a.w) / a.h) }
            return (
              <Chip
                key={a.id}
                active={Math.abs(ratio - a.w / a.h) < 0.01}
                title={a.note ?? `${a.label} frame`}
                onClick={() => {
                  const f = frameForAspect(size, a.w, a.h)
                  setExportSize(f.width, f.height)
                }}
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  <span className="rounded-xs border border-current" style={box} />
                </span>
                {a.label}
              </Chip>
            )
          })}
        </Wrap>
      </Group>

      <Group label="Presets">
        <div className="flex flex-col gap-0.5">
          {SIZE_PRESETS.map((p) => (
            <ListRow
              key={p.name}
              label={p.name}
              active={p.width === size.width && p.height === size.height}
              onClick={() => setExportSize(p.width, p.height)}
            />
          ))}
        </div>
      </Group>
    </>
  )
}

function BackdropTab() {
  const bg = useStudio((s) => s.project.scene.background)
  const setBackground = useStudio((s) => s.setBackground)

  return (
    <>
      <Group label="Type">
        <div className="grid grid-cols-3 gap-1.5">
          {BG_TYPES.map((t) => (
            <Chip
              key={t.id}
              full
              active={bg.type === t.id}
              onClick={() => setBackground({ type: t.id })}
            >
              {t.label}
            </Chip>
          ))}
        </div>
      </Group>

      <Group label={bg.type === 'transparent' ? undefined : 'Preset'}>
        {bg.type === 'studio' && (
          <div className="grid grid-cols-4 gap-1.5">
            {SWEEP_PAPERS.map((p) => (
              <button
                key={p.name}
                title={p.name}
                aria-label={p.name}
                onClick={() => useStudio.getState().setSweep({ color: p.color, hot: p.hot })}
                style={{
                  background: `radial-gradient(120% 90% at 50% 42%, ${p.hot}, ${p.color} 72%)`,
                }}
                className={`h-9 rounded-sm ${
                  bg.sweep.color === p.color
                    ? 'outline-2 outline-(--tx2) outline-offset-2'
                    : ''
                }`}
              />
            ))}
          </div>
        )}

        {bg.type === 'solid' && (
          <>
            <div className="grid grid-cols-4 gap-1.5">
              {SOLID_SWATCHES.map((c) => (
                <button
                  key={c}
                  title={c}
                  aria-label={`Background ${c}`}
                  onClick={() => setBackground({ color: c, type: 'solid' })}
                  style={{ background: c }}
                  className={`h-9 rounded-sm ${
                    bg.color === c ? 'outline-2 outline-(--tx2) outline-offset-2' : ''
                  }`}
                />
              ))}
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
          </>
        )}

        {bg.type === 'gradient' && (
          <>
            <div className="grid grid-cols-4 gap-1.5">
              {GRADIENT_PRESETS.map((g, i) => (
                <button
                  key={i}
                  aria-label={`Gradient ${i + 1}`}
                  onClick={() =>
                    setBackground({ type: 'gradient', gradient: { ...bg.gradient, ...g } })
                  }
                  style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
                  className="h-9 rounded-sm"
                />
              ))}
            </div>
            <div className="mt-1.5">
              <Chip
                full
                active={bg.gradient.kind === 'radial'}
                onClick={() =>
                  setBackground({
                    gradient: {
                      ...bg.gradient,
                      kind: bg.gradient.kind === 'radial' ? 'linear' : 'radial',
                    },
                  })
                }
              >
                Radial
              </Chip>
            </div>
          </>
        )}

        {bg.type === 'mesh' && (
          <>
            <div className="grid grid-cols-4 gap-1.5">
              {MESH_PALETTES.map((colors, i) => (
                <button
                  key={i}
                  aria-label={`Mesh palette ${i + 1}`}
                  onClick={() => setBackground({ type: 'mesh', mesh: { ...bg.mesh, colors } })}
                  style={{ backgroundImage: `url(${meshGradientDataURL(bg.mesh.seed, colors)})` }}
                  className="h-9 rounded-sm bg-cover"
                />
              ))}
            </div>
            <div className="mt-1.5">
              <Chip
                full
                onClick={() =>
                  setBackground({ mesh: { ...bg.mesh, seed: Math.floor(Math.random() * 1e6) } })
                }
              >
                ↻ Randomize
              </Chip>
            </div>
          </>
        )}

        {bg.type === 'image' && (
          <Chip full onClick={importBackgroundImage}>
            <Upload size={12} /> Upload background…
          </Chip>
        )}

        {bg.type === 'transparent' && (
          <p className="t-body-sm leading-snug text-(--tx3)">
            Exports with a true alpha channel (PNG / WebM-alpha).
          </p>
        )}
      </Group>
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
 */
const SCENE_TABS = [
  { id: 'looks', label: 'Studio' },
  { id: 'environment', label: 'Environment' },
  { id: 'backdrop', label: 'Background' },
] as const

function BackgroundSection() {
  // Studio first: it's the one that sets everything else, including the sweep.
  const [tab, setTab] = useState<(typeof SCENE_TABS)[number]['id']>('looks')
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

// ————— panel —————

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
