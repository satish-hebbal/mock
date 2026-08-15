import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AppWindow,
  ArrowLeftRight,
  Ban,
  Box,
  Camera,
  ChevronDown,
  CircleMinus,
  Copy,
  Crop,
  Image as ImageIcon,
  ImagePlus,
  Laptop,
  Lightbulb,
  Monitor,
  Move3d,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Rotate3d,
  Scale3d,
  Smartphone,
  Square,
  Tablet,
  Tv,
  Type,
  Upload,
  Watch,
  type LucideIcon,
} from 'lucide-react'
import { pickMediaFile, useStudio } from '../store'
import {
  DEVICE_CATEGORIES,
  PICKABLE_DEVICES,
  getDevice,
  type DeviceKind,
} from '../lib/registry'
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
import {
  addLogoOverlay,
  addShapeOverlay,
  addTextOverlay,
  importBackgroundImage,
  requestDevice,
} from '../lib/sceneActions'
import { useUI } from '../lib/ui'
import type { BackgroundType } from '../types'

/*
 * Toolbar above the canvas. It carries the choices you make *while looking at
 * the scene* — which device, which angle, which backdrop — as ribbons that drop
 * down and scroll sideways, so a long catalog costs one row of height instead
 * of a tall column in the inspector. The inspector keeps the fine-tuning.
 */

const MENUS = [
  { id: 'devices', label: 'Devices', icon: Box },
  { id: 'studio', label: 'Studio', icon: Lightbulb },
  { id: 'camera', label: 'Camera', icon: Camera },
  { id: 'frame', label: 'Frame', icon: Crop },
  { id: 'background', label: 'Background', icon: ImageIcon },
  { id: 'add', label: 'Add', icon: Plus },
] as const

type MenuId = (typeof MENUS)[number]['id']

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

/** Pill used inside every ribbon. Never shrinks, so strips scroll instead of squashing. */
function Chip({
  children,
  onClick,
  active,
  title,
}: {
  children: ReactNode
  onClick: () => void
  active?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] whitespace-nowrap transition-colors ${
        active
          ? 'bg-(--accent-soft) text-(--accent)'
          : 'bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * One labelled row of a ribbon. The content pans sideways; a vertical wheel is
 * translated to horizontal so a plain mouse can reach the end of the catalog.
 */
function Strip({ label, children }: { label?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const onWheel = (e: React.WheelEvent) => {
    const el = ref.current
    if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    el.scrollLeft += e.deltaY
  }
  return (
    <div className="flex items-center gap-2">
      <span className="w-[62px] shrink-0 text-[9px] font-semibold tracking-[0.16em] text-(--tx3) uppercase">
        {label}
      </span>
      <div
        ref={ref}
        onWheel={onWheel}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5"
      >
        {children}
      </div>
    </div>
  )
}

function StripDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-(--line)" />
}

/** Buttons welded into one control, Figma-style. */
function Attached({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div title={title} className="flex items-center gap-0.5 rounded-[6px] bg-(--field) p-0.5">
      {children}
    </div>
  )
}

function AttachedBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`flex h-6 items-center justify-center gap-1 rounded-[4px] px-1.5 text-[11px] transition-colors ${
        active
          ? 'bg-(--accent-soft) text-(--accent)'
          : 'text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
      }`}
    >
      {children}
    </button>
  )
}

function BarDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-(--line)" />
}

// ————— ribbons —————

function DevicesRibbon() {
  const devices = useStudio((s) => s.project.scene.devices)
  const selectedId = useStudio((s) => s.selectedDeviceId)
  const [cat, setCat] = useState<'All' | (typeof DEVICE_CATEGORIES)[number]>('All')
  const st = useStudio.getState

  const selected = devices.find((d) => d.id === selectedId) ?? devices[0]
  const cats = DEVICE_CATEGORIES.filter((c) => PICKABLE_DEVICES.some((d) => d.category === c))
  const list =
    cat === 'All' ? PICKABLE_DEVICES : PICKABLE_DEVICES.filter((d) => d.category === cat)

  return (
    <>
      <Strip label="In scene">
        {devices.map((d, i) => {
          const active = d.id === selected?.id
          return (
            <span
              key={d.id}
              className={`inline-flex h-7 shrink-0 items-center rounded-[6px] pr-1 transition-colors ${
                active ? 'bg-(--sel) text-(--tx)' : 'bg-(--field) text-(--tx2) hover:bg-(--field-h)'
              }`}
            >
              <button
                onClick={() => st().selectDevice(d.id)}
                className="px-2.5 text-[11px] whitespace-nowrap"
              >
                {i + 1} · {getDevice(d.modelId).name}
              </button>
              <button
                title="Duplicate"
                aria-label="Duplicate device"
                onClick={() => st().duplicateDevice(d.id)}
                className="flex h-5 w-5 items-center justify-center rounded text-(--tx3) hover:text-(--tx)"
              >
                <Copy size={11} strokeWidth={1.9} />
              </button>
              {devices.length > 1 && (
                <button
                  title="Remove device"
                  aria-label="Remove device"
                  onClick={() => st().removeDevice(d.id)}
                  className="flex h-5 w-5 items-center justify-center rounded text-(--tx3) hover:text-(--danger)"
                >
                  <CircleMinus size={12} strokeWidth={1.9} />
                </button>
              )}
            </span>
          )
        })}
      </Strip>

      <div className="mt-1.5 border-t border-(--line) pt-1.5">
        <Strip label="Add">
          <Chip active={cat === 'All'} onClick={() => setCat('All')}>
            All
          </Chip>
          {cats.map((c) => (
            <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
              {c}
            </Chip>
          ))}
          <StripDivider />
          <Chip onClick={() => void requestDevice()} title="Tell us which device to add next">
            <Plus size={11} /> Request a device
          </Chip>
        </Strip>
        <Strip>
          {list.map((d) => {
            const Icon = KIND_ICON[d.kind]
            return (
              <Chip key={d.id} title={`Add ${d.name}`} onClick={() => st().addDevice(d.id)}>
                <Icon size={12} strokeWidth={1.8} className="text-(--tx3)" />
                {d.name}
              </Chip>
            )
          })}
        </Strip>
      </div>
    </>
  )
}

/**
 * Complete photographic setups. Each card carries its recipe, so picking a look
 * also shows what a photographer would have rigged to get it.
 */
function StudioRibbon() {
  const [withCamera, setWithCamera] = useState(true)
  const st = useStudio.getState
  return (
    <>
      <Strip label="Looks">
        {STUDIO_LOOKS.map((l) => (
          <button
            key={l.id}
            onClick={() => st().applyStudioLook(l.id, withCamera)}
            title={`${l.recipe} · ${focalFromFov(l.camera.fov)}mm`}
            className="flex h-12 shrink-0 items-center gap-2.5 rounded-[8px] bg-(--field) py-1.5 pr-3 pl-1.5 text-left transition-colors hover:bg-(--field-h)"
          >
            <span
              className="h-9 w-12 shrink-0 rounded-[5px] border border-(--line)"
              style={{ background: lookSwatch(l) }}
            />
            <span className="flex flex-col">
              <span className="text-[11px] whitespace-nowrap text-(--tx)">{l.name}</span>
              <span className="text-[10px] whitespace-nowrap text-(--tx3)">
                {l.recipe} · {focalFromFov(l.camera.fov)}mm
              </span>
            </span>
          </button>
        ))}
      </Strip>
      <Strip label="">
        <Chip
          active={withCamera}
          onClick={() => setWithCamera(!withCamera)}
          title="Looks are designed around a framing — turn this off to relight without moving the camera"
        >
          {withCamera ? '✓ ' : ''}Also set the camera
        </Chip>
        <span className="text-[10px] text-(--tx3)">
          Lights, sweep, shadow and grade come as one setup.
        </span>
      </Strip>
    </>
  )
}

function CameraRibbon() {
  const st = useStudio.getState
  return (
    <Strip label="Angle">
      {CAMERA_PRESETS.map((p) => (
        <Chip key={p.name} onClick={() => st().setCamera(p.cam, 'cam-preset')}>
          {p.name}
        </Chip>
      ))}
      <StripDivider />
      <Chip
        title="Reset tilt, pan and rotation"
        onClick={() =>
          st().setCamera(
            { tiltX: 0, tiltY: 0, roll: 0, panX: 0, panY: 0, rotateX: 0, rotateY: 0 },
            'cam-reset',
          )
        }
      >
        Snap straight-on
      </Chip>
    </Strip>
  )
}

/**
 * The shape of the picture you end up downloading. Ratio is the choice people
 * actually make ("this one's for a story"), so the chips carry a proportional
 * glyph; the exact pixel size lives in the inspector.
 */
function FrameRibbon() {
  const size = useStudio((s) => s.project.exportSize)
  const setExportSize = useStudio((s) => s.setExportSize)
  const ratio = size.width / size.height

  return (
    <>
      <Strip label="Ratio">
        {ASPECT_PRESETS.map((a) => {
          const box =
            a.w >= a.h
              ? { width: 20, height: Math.max(4, (20 * a.h) / a.w) }
              : { height: 20, width: Math.max(4, (20 * a.w) / a.h) }
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
              <span className="flex h-5 w-5 items-center justify-center">
                <span className="rounded-[2px] border border-current" style={box} />
              </span>
              {a.label}
            </Chip>
          )
        })}
        <StripDivider />
        <Chip
          title="Swap width and height"
          onClick={() => setExportSize(size.height, size.width)}
        >
          <ArrowLeftRight size={12} /> Rotate
        </Chip>
        <span className="shrink-0 pl-1 text-[10px] whitespace-nowrap text-(--tx3)">
          {size.width} × {size.height} · {ratioLabel(size.width, size.height)}
        </span>
      </Strip>

      <div className="mt-1.5 border-t border-(--line) pt-1.5">
        <Strip label="Presets">
          {SIZE_PRESETS.map((p) => (
            <Chip
              key={p.name}
              active={p.width === size.width && p.height === size.height}
              onClick={() => setExportSize(p.width, p.height)}
            >
              {p.name}
            </Chip>
          ))}
        </Strip>
      </div>
    </>
  )
}

function BackgroundRibbon() {
  const bg = useStudio((s) => s.project.scene.background)
  const setBackground = useStudio((s) => s.setBackground)

  return (
    <>
      <Strip label="Type">
        {BG_TYPES.map((t) => (
          <Chip key={t.id} active={bg.type === t.id} onClick={() => setBackground({ type: t.id })}>
            {t.label}
          </Chip>
        ))}
      </Strip>

      <div className="mt-1.5 border-t border-(--line) pt-1.5">
        <Strip label={bg.type === 'transparent' ? '' : 'Preset'}>
          {bg.type === 'studio' &&
            SWEEP_PAPERS.map((p) => (
              <button
                key={p.name}
                title={p.name}
                aria-label={p.name}
                onClick={() => useStudio.getState().setSweep({ color: p.color, hot: p.hot })}
                style={{
                  background: `radial-gradient(120% 90% at 50% 42%, ${p.hot}, ${p.color} 72%)`,
                }}
                className={`h-7 w-11 shrink-0 rounded-[6px] border ${
                  bg.sweep.color === p.color ? 'border-(--accent)' : 'border-(--line)'
                }`}
              />
            ))}

          {bg.type === 'solid' && (
            <>
              <label
                title="Custom color"
                className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] bg-(--field) px-2.5 text-[11px] text-(--tx2) hover:bg-(--field-h)"
              >
                <span className="relative h-4 w-4 overflow-hidden rounded-[3px] border border-(--line2)">
                  <input
                    type="color"
                    value={bg.color}
                    aria-label="Background color"
                    onChange={(e) => setBackground({ color: e.target.value, type: 'solid' })}
                    className="absolute -inset-1 cursor-pointer"
                  />
                </span>
                Custom
              </label>
              {SOLID_SWATCHES.map((c) => (
                <button
                  key={c}
                  title={c}
                  aria-label={`Background ${c}`}
                  onClick={() => setBackground({ color: c, type: 'solid' })}
                  style={{ background: c }}
                  className="h-7 w-9 shrink-0 rounded-[6px] border border-(--line)"
                />
              ))}
            </>
          )}

          {bg.type === 'gradient' && (
            <>
              {GRADIENT_PRESETS.map((g, i) => (
                <button
                  key={i}
                  aria-label={`Gradient ${i + 1}`}
                  onClick={() =>
                    setBackground({ type: 'gradient', gradient: { ...bg.gradient, ...g } })
                  }
                  style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
                  className="h-7 w-11 shrink-0 rounded-[6px] border border-(--line)"
                />
              ))}
              <StripDivider />
              <Chip
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
            </>
          )}

          {bg.type === 'mesh' && (
            <>
              {MESH_PALETTES.map((colors, i) => (
                <button
                  key={i}
                  aria-label={`Mesh palette ${i + 1}`}
                  onClick={() => setBackground({ type: 'mesh', mesh: { ...bg.mesh, colors } })}
                  style={{ backgroundImage: `url(${meshGradientDataURL(bg.mesh.seed, colors)})` }}
                  className="h-7 w-11 shrink-0 rounded-[6px] border border-(--line) bg-cover"
                />
              ))}
              <StripDivider />
              <Chip
                onClick={() =>
                  setBackground({ mesh: { ...bg.mesh, seed: Math.floor(Math.random() * 1e6) } })
                }
              >
                ↻ Randomize
              </Chip>
            </>
          )}

          {bg.type === 'image' && (
            <Chip onClick={importBackgroundImage}>
              <Upload size={12} /> Upload background…
            </Chip>
          )}

          {bg.type === 'transparent' && (
            <span className="text-[11px] text-(--tx3)">
              Exports with a true alpha channel (PNG / WebM-alpha).
            </span>
          )}
        </Strip>
      </div>
    </>
  )
}

function AddRibbon() {
  return (
    <Strip label="Insert">
      <Chip
        title="Put an image or video on the selected device"
        onClick={() => pickMediaFile((f) => void useStudio.getState().importMedia(f))}
      >
        <Upload size={12} /> Upload media
      </Chip>
      <Chip onClick={addTextOverlay}>
        <Type size={12} /> Text
      </Chip>
      <Chip onClick={addShapeOverlay}>
        <Square size={12} /> Shape
      </Chip>
      <Chip onClick={addLogoOverlay}>
        <ImagePlus size={12} /> Logo
      </Chip>
    </Strip>
  )
}

// ————— bar —————

export function TopBar() {
  const [menu, setMenu] = useState<MenuId | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const deviceCount = useStudio((s) => s.project.scene.devices.length)
  const gizmo = useStudio((s) => s.gizmo)
  const panelOpen = useStudio((s) => s.panelOpen)
  const timelineOpen = useStudio((s) => s.timelineOpen)
  const st = useStudio.getState

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // a dialog on top owns Escape first; otherwise closing the ribbon beats
      // the global handler clearing the selection
      if (useUI.getState().request || useStudio.getState().dialog) return
      e.stopImmediatePropagation()
      setMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])

  return (
    <div ref={rootRef} className="relative z-20 shrink-0">
      <div className="flex h-10 items-center gap-1 border-b border-(--line) bg-(--panel) px-2">
        {MENUS.map((m) => {
          const open = menu === m.id
          return (
            <button
              key={m.id}
              onClick={() => setMenu(open ? null : m.id)}
              aria-expanded={open}
              className={`flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] transition-colors ${
                open ? 'bg-(--sel) text-(--tx)' : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
              }`}
            >
              <m.icon size={13} strokeWidth={1.8} />
              {m.label}
              <ChevronDown
                size={11}
                className={`text-(--tx3) transition-transform ${open ? 'rotate-180' : ''}`}
              />
            </button>
          )
        })}

        <BarDivider />

        <Attached title="Transform gizmo on the selected device">
          {(
            [
              ['off', 'No gizmo', Ban],
              ['translate', 'Move (G)', Move3d],
              ['rotate', 'Rotate (R)', Rotate3d],
              ['scale', 'Scale (S)', Scale3d],
            ] as const
          ).map(([m, label, Icon]) => (
            <AttachedBtn key={m} title={label} active={gizmo === m} onClick={() => st().setGizmo(m)}>
              <Icon size={13} strokeWidth={1.8} />
            </AttachedBtn>
          ))}
        </Attached>

        {deviceCount > 1 && (
          <>
            <BarDivider />
            <Attached title="Arrange every device">
              {(['row', 'fan', 'stack'] as const).map((m) => (
                <AttachedBtn
                  key={m}
                  title={`Arrange in a ${m}`}
                  onClick={() => st().arrangeDevices(m)}
                >
                  <span className="capitalize">{m}</span>
                </AttachedBtn>
              ))}
            </Attached>
          </>
        )}

        <div className="flex-1" />

        <Attached>
          <AttachedBtn
            title={timelineOpen ? 'Collapse the timeline (\\)' : 'Expand the timeline (\\)'}
            active={timelineOpen}
            onClick={() => st().setTimelineOpen(!timelineOpen)}
          >
            {timelineOpen ? (
              <PanelBottomClose size={13} strokeWidth={1.8} />
            ) : (
              <PanelBottomOpen size={13} strokeWidth={1.8} />
            )}
          </AttachedBtn>
          <AttachedBtn
            title={panelOpen ? 'Hide the inspector (])' : 'Show the inspector (])'}
            active={panelOpen}
            onClick={() => st().setPanelOpen(!panelOpen)}
          >
            {panelOpen ? (
              <PanelRightClose size={13} strokeWidth={1.8} />
            ) : (
              <PanelRightOpen size={13} strokeWidth={1.8} />
            )}
          </AttachedBtn>
        </Attached>
      </div>

      {menu && (
        <div className="absolute inset-x-0 top-full z-30 border-b border-(--line) bg-(--panel) px-3 py-2 shadow-2xl">
          {menu === 'devices' && <DevicesRibbon />}
          {menu === 'studio' && <StudioRibbon />}
          {menu === 'camera' && <CameraRibbon />}
          {menu === 'frame' && <FrameRibbon />}
          {menu === 'background' && <BackgroundRibbon />}
          {menu === 'add' && <AddRibbon />}
        </div>
      )}
    </div>
  )
}
