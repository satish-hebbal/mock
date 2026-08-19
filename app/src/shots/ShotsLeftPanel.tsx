import { useEffect, useState, type ReactNode } from 'react'
import {
  Blend,
  Check,
  ChevronDown,
  Eraser,
  Image as ImageIcon,
  ImageUp,
  LayoutGrid,
  Link2,
  Palette,
  Pipette,
  Plus,
  Ratio,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Upload,
  Wallpaper,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useShots } from './store'
import { DEVICES, NO_DEVICE, getShotsDevice, type DeviceCategory } from './devices'
import { WALLPAPERS, gradientCss } from './wallpapers'
import { magicBackgrounds } from './palette'
import { MESH_PALETTES, meshGradientDataURL } from '../lib/meshGradient'
import { SIZE_PRESETS } from '../lib/presets'
import { ColorRow, Dropdown, SegmentThumb, SliderRow } from '../components/controls'
import { useStudio } from '../store'
import { ui } from '../lib/ui'
import { MAX_SHOTS, selectedShotsImage } from './types'
import { applyLayoutToDoc, presetsForCount } from './layouts'
import { ShotsPreview } from './ShotsCanvas'
import type { ShotsBackground, ShotsBgType, ShotsDoc, ShotsFrame, ShotsImage } from './types'

/*
 * The Shots left panel. Two tabs split the editor along the line the work
 * actually falls on: **Mockup** is the subject — which device, what's on its
 * screen, how it's lit — and **Frame** is everything it sits on, from the
 * canvas shape to the backdrop. Fine positioning (padding, scale, offset,
 * tilt) stays in the right-hand inspector, so nothing is offered twice.
 */

const iconProps = { size: 12, strokeWidth: 1.75 } as const
const subIcon = { size: 11, strokeWidth: 1.75 } as const

// ————— primitives —————

/** Quiet all-caps heading, the way the reference tools label a block. */
function GroupLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <p className="t-eyebrow text-(--tx3) uppercase">{children}</p>
      {action}
    </div>
  )
}

function Group({ label, children, action }: { label?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="border-b border-(--line) px-3 py-3 last:border-b-0">
      {label && <GroupLabel action={action}>{label}</GroupLabel>}
      {children}
    </div>
  )
}

/** Square tile with a glyph over a caption — the reference's control shape. */
function Tile({
  icon,
  label,
  active,
  onClick,
  title,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      aria-pressed={active}
      className="group flex flex-col items-center gap-1"
    >
      <span
        className={`flex h-11 w-full items-center justify-center rounded-lg transition-colors ${
          active
            ? 'bg-(--sel) text-(--tx)'
            : 'bg-(--field) text-(--tx2) group-hover:bg-(--field-h) group-hover:text-(--tx)'
        }`}
      >
        {icon}
      </span>
      <span className={`w-full truncate text-center t-caption ${active ? 'text-(--tx)' : 'text-(--tx3)'}`}>
        {label}
      </span>
    </button>
  )
}

/** Swatch button used by every colour / gradient grid. */
function Swatch({
  style,
  active,
  onClick,
  title,
  children,
}: {
  style?: React.CSSProperties
  active?: boolean
  onClick: () => void
  title?: string
  children?: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={style}
      className={`relative flex h-9 items-center justify-center overflow-hidden rounded-md border bg-cover bg-center transition-colors ${
        active ? 'is-picked' : 'border-(--line) hover:border-(--line2)'
      }`}
    >
      {children}
      {active && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
          <Check size={13} strokeWidth={2.6} className="text-white drop-shadow" />
        </span>
      )}
    </button>
  )
}

function pickImage(onFile: (f: File) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm'
  input.onchange = () => {
    const f = input.files?.[0]
    if (f) onFile(f)
  }
  input.click()
}

// ————— Mockup · device picker —————

const DEVICE_TABS: { id: DeviceCategory | 'all'; label: string; icon: LucideIcon }[] = [
  { id: 'all', label: 'All', icon: LayoutGrid },
  { id: 'phone', label: 'Phone', icon: Smartphone },
  { id: 'tablet', label: 'Tablet', icon: Tablet },
]

/** Stand-in screen behind a thumbnail, so a lit device reads as a solid shape. */
const BLANK_SCREEN = 'linear-gradient(155deg, #f6f3ec 0%, #dcd8ce 52%, #c2beb4 100%)'

/**
 * The frame's own PNG is the thumbnail — a drawn approximation would be a
 * second source of truth for something the asset already answers exactly.
 *
 * The frames are near-black with the screen punched out, so on a dark panel a
 * bare PNG is a dark outline on a dark field and all but disappears. Filling
 * the cutout with a blank screen first gives the frame something to sit on;
 * it's placed with the same measured geometry the canvas uses, so the thumbnail
 * doubles as a check that the manifest still lines up with the asset.
 */
function DeviceThumb({ deviceId, box = 56 }: { deviceId: string; box?: number }) {
  const dev = getShotsDevice(deviceId)
  if (!dev.bezel) {
    return (
      <span
        style={{ width: box * 0.46, height: box }}
        className="flex items-center justify-center rounded-sm border border-dashed border-(--tx3) text-(--tx3)"
      >
        <Eraser size={12} strokeWidth={1.8} />
      </span>
    )
  }
  const b = dev.bezel
  const a = b.frame.w / b.frame.h
  const h = a >= 1 ? box / a : box
  const w = a >= 1 ? box : box * a
  const k = w / b.frame.w // PNG px -> thumbnail px

  return (
    <span className="relative block" style={{ width: w, height: h }}>
      <span
        className="absolute"
        style={{
          left: b.screen.x * k,
          top: b.screen.y * k,
          width: b.screen.w * k,
          height: b.screen.h * k,
          borderRadius: b.radius * k,
          background: BLANK_SCREEN,
        }}
      />
      <img
        src={b.src}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full"
      />
    </span>
  )
}

function DevicePicker() {
  const img = useShots((s) => selectedShotsImage(s.doc))
  const setImage = useShots((s) => s.setImage)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<DeviceCategory | 'all'>('all')

  const current = getShotsDevice(img?.device ?? NO_DEVICE)
  const shown = DEVICES.filter((d) => d.id === NO_DEVICE || tab === 'all' || d.category === tab)

  return (
    <div className="border-b border-(--line) px-3 py-3">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        disabled={!img}
        className="flex w-full items-center gap-2.5 rounded-lg bg-(--field) p-2 text-left transition-colors hover:bg-(--field-h) disabled:opacity-50"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center">
          <DeviceThumb deviceId={current.id} box={28} />
        </span>
        <span className="min-w-0 flex-1">
          {/* a screen is always selected once one exists, so the empty case
              here means none has been added yet — not that nothing is picked */}
          <span className="block truncate t-body-sm font-semibold text-(--tx)">
            {img ? current.label : 'No screen yet'}
          </span>
          <span className="block t-caption text-(--tx3) tabular-nums">
            {!img
              ? 'add media below'
              : current.screen
                ? `${current.screen.w} / ${current.screen.h}`
                : 'bare screen'}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-(--tx3) transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && img && (
        <div className="mt-2">
          <div className="mb-2 flex gap-1">
            {DEVICE_TABS.map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  title={t.label}
                  aria-pressed={active}
                  className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded-full t-body-sm transition-colors ${
                    active
                      ? 'bg-(--sel) text-(--tx)'
                      : 'bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
                  }`}
                >
                  <t.icon {...subIcon} />
                  {t.label}
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {shown.map((d) => {
              const active = img.device === d.id
              return (
                <button
                  key={d.id}
                  onClick={() => {
                    setImage({ device: d.id })
                    setOpen(false)
                  }}
                  /*
                   * Fixed height, not content height. A tile's height otherwise
                   * follows its label, so one device with a name long enough to
                   * wrap pushes its whole row taller than the rest and the grid
                   * develops a ragged step halfway down. Portrait rather than
                   * square because the things being drawn in it are portrait.
                   */
                  className={`flex h-[152px] flex-col gap-1 rounded-lg p-2 text-left transition-colors ${
                    active ? 'bg-(--sel)' : 'bg-(--field) hover:bg-(--field-h)'
                  }`}
                >
                  {/*
                    Name, picture, then numbers. You pick a device by recognising
                    its shape, so the drawing belongs next to the name it belongs
                    to. The resolution is a detail you check after you've found
                    the right tile, which makes it the caption underneath rather
                    than something wedged between a label and its own picture.
                  */}
                  <span className={`truncate t-caption ${active ? 'text-(--tx)' : 'text-(--tx2)'}`}>
                    {d.label}
                  </span>
                  <span className="flex min-h-0 flex-1 items-center justify-center">
                    <DeviceThumb deviceId={d.id} box={72} />
                  </span>
                  <span className="t-caption text-(--tx3) tabular-nums">
                    {d.screen ? `${d.screen.w} / ${d.screen.h}` : 'bare screen'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ————— Mockup · media —————

function MediaGroup() {
  const images = useShots((s) => s.doc.images)
  const selectedId = useShots((s) => s.doc.selectedId)
  const assets = useShots((s) => s.assets)
  const selectImage = useShots((s) => s.selectImage)
  const importMedia = useShots((s) => s.importMedia)
  const importFromURL = useShots((s) => s.importMediaFromURL)
  const parked = useShots((s) => s.doc.parked ?? EMPTY_SCREENS)
  const setScreenCount = useShots((s) => s.setScreenCount)
  const atMax = images.length + parked.length >= MAX_SHOTS

  const fromURL = async (replace: boolean) => {
    const url = await ui.prompt({
      title: 'Load from URL',
      label: 'Paste an image or video URL. It must allow cross-origin requests.',
      placeholder: 'https://…',
    })
    if (!url) return
    try {
      await importFromURL(url, { replace })
    } catch (err) {
      ui.error(`Couldn't load that URL: ${(err as Error).message}`)
    }
  }

  if (images.length === 0) {
    return (
      <Group label="Media">
        <button
          onClick={() => pickImage((f) => void importMedia(f))}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-(--line2) px-3 py-8 transition-colors hover:border-(--line2) hover:bg-(--field)"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-(--field) text-(--tx2)">
            <Plus size={16} strokeWidth={2} />
          </span>
          <span className="t-body-sm text-(--tx2)">Drop media or click to choose</span>
          <span className="t-caption text-(--tx3)">Images &amp; videos</span>
        </button>
        <button
          onClick={() => void fromURL(false)}
          className="mt-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-(--field) t-body-sm text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)"
        >
          <Link2 {...subIcon} /> Load from URL
        </button>
      </Group>
    )
  }

  return (
    <Group
      label="Media"
      action={
        <span className="t-caption text-(--tx3) tabular-nums">
          {images.length + parked.length}/{MAX_SHOTS}
        </span>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {images.map((im, i) => {
          const url = assets[im.assetId]?.url
          const active = im.id === selectedId
          return (
            <button
              key={im.id}
              title={`Screen ${i + 1}`}
              onClick={() => selectImage(im.id)}
              className={`relative h-14 w-11 overflow-hidden rounded-lg border-2 bg-(--panel2) ${
                active ? 'is-picked' : 'border-transparent hover:border-(--line2)'
              }`}
            >
              {url && <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />}
              <span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 t-caption font-semibold text-white">
                {i + 1}
              </span>
            </button>
          )
        })}
        {/*
          Screens the count control set aside. They stay on show, dimmed, so
          lowering the count reads as putting media away rather than losing it —
          clicking one raises the count enough to bring it back.
        */}
        {parked.map((im, i) => {
          const url = assets[im.assetId]?.url
          return (
            <button
              key={im.id}
              title="Not in the shot — click to bring it back"
              onClick={() => setScreenCount(images.length + i + 1)}
              className="relative h-14 w-11 overflow-hidden rounded-lg border-2 border-dashed border-(--line) bg-(--panel2) opacity-45 transition-opacity hover:opacity-80"
            >
              {url && <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />}
            </button>
          )
        })}
        {!atMax && (
          <button
            title="Add a screen"
            onClick={() => pickImage((f) => void importMedia(f))}
            className="flex h-14 w-11 items-center justify-center rounded-lg border-2 border-dashed border-(--line) text-(--tx3) hover:border-(--line2) hover:text-(--tx2)"
          >
            <Plus size={15} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {(
          [
            [ImageUp, 'Replace', () => pickImage((f) => void importMedia(f, undefined, { replace: true }))],
            [Link2, 'URL', () => void fromURL(true)],
            [Trash2, 'Remove', () => useShots.getState().removeImage()],
          ] as const
        ).map(([Icon, label, run]) => (
          <button
            key={label}
            onClick={run}
            className="flex h-7 items-center justify-center gap-1.5 rounded-sm bg-(--field) t-body-sm text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx)"
          >
            <Icon {...subIcon} /> {label}
          </button>
        ))}
      </div>
    </Group>
  )
}

// ————— Mockup · layout —————

/**
 * Screen count, then the arrangements available at that count.
 *
 * Each card renders the real composition through the same component the canvas
 * uses, so the thumbnail carries this screenshot, this background, this shadow.
 * A generic diagram would be cheaper and would misrepresent every shot that
 * isn't a bare white phone.
 */
function LayoutGroup() {
  const images = useShots((s) => s.doc.images)
  const doc = useShots((s) => s.doc)
  const activeId = useShots((s) => s.doc.layout)
  const applyLayout = useShots((s) => s.applyLayout)
  const setScreenCount = useShots((s) => s.setScreenCount)

  const n = images.length
  if (n === 0) return null

  const presets = presetsForCount(n)

  return (
    <>
      <Group label="Screens">
        <div className="grid grid-cols-4 gap-1.5">
          {[1, 2, 3, 4].map((c) => (
            <button
              key={c}
              onClick={() => setScreenCount(c)}
              aria-pressed={n === c}
              title={`${c} screen${c > 1 ? 's' : ''}`}
              className={`h-8 rounded-md t-body-sm tabular-nums transition-colors ${
                n === c
                  ? 'bg-(--sel) text-(--tx)'
                  : 'bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <p className="mt-2 t-caption leading-snug text-(--tx3)">
          Adding a screen copies the last one — swap its media with Replace.
        </p>
      </Group>

      <Group label="Layout presets">
        <div className="flex flex-col gap-2">
          {presets.map((p) => {
            // a throwaway doc showing what this preset would do, nothing committed
            const preview: ShotsDoc = {
              ...doc,
              images: doc.images.map((im) => ({ ...im })),
            }
            applyLayoutToDoc(preview, p.id)
            const active = activeId === p.id
            return (
              <button
                key={p.id}
                onClick={() => applyLayout(p.id)}
                aria-pressed={active}
                title={p.name}
                className={`overflow-hidden rounded-lg border transition-colors ${
                  active ? 'is-picked' : 'border-(--line) hover:border-(--line2)'
                }`}
              >
                <ShotsPreview doc={preview} />
                <span
                  className={`block px-2 py-1.5 text-left t-caption ${
                    active ? 'text-(--tx)' : 'text-(--tx2)'
                  }`}
                >
                  {p.name}
                </span>
              </button>
            )
          })}
        </div>
      </Group>
    </>
  )
}

// ————— Mockup · shadow —————

/**
 * Named shadows, the way a photographer would ask for them, instead of four
 * sliders you have to balance yourself. The sliders are still underneath for
 * anyone who wants them.
 */
const SHADOW_PRESETS: { id: string; label: string; value: { blur: number; y: number; x: number; opacity: number } }[] = [
  { id: 'none', label: 'None', value: { blur: 0, y: 0, x: 0, opacity: 0 } },
  { id: 'soft', label: 'Soft', value: { blur: 0.05, y: 0.03, x: 0, opacity: 0.4 } },
  { id: 'spread', label: 'Spread', value: { blur: 0.1, y: 0.07, x: 0, opacity: 0.42 } },
  { id: 'hug', label: 'Hug', value: { blur: 0.022, y: 0.012, x: 0, opacity: 0.6 } },
]

function shadowPresetId(s: { blur: number; y: number; opacity: number }): string | null {
  if (s.opacity === 0 || s.blur === 0) return 'none'
  const hit = SHADOW_PRESETS.find(
    (p) => Math.abs(p.value.blur - s.blur) < 0.004 && Math.abs(p.value.y - s.y) < 0.004,
  )
  return hit?.id ?? null
}

function ShadowGroup() {
  const img = useShots((s) => selectedShotsImage(s.doc))
  const setShadow = useShots((s) => s.setShadow)
  const [openLight, setOpenLight] = useState(false)
  if (!img) return null

  const activeId = shadowPresetId(img.shadow)
  /** Tint the shadow with the screenshot's own darkest colour. */
  const adaptive = img.palette[img.palette.length - 1] ?? null

  return (
    <Group label="Shadow">
      <div className="grid grid-cols-4 gap-1.5">
        {SHADOW_PRESETS.map((p) => (
          <Tile
            key={p.id}
            label={p.label}
            active={activeId === p.id}
            onClick={() => setShadow(p.value)}
            icon={
              <span
                className="h-5 w-5 rounded-xs bg-white"
                style={{
                  boxShadow:
                    p.value.opacity === 0
                      ? 'none'
                      : `0 ${p.value.y * 90}px ${p.value.blur * 110}px rgba(0,0,0,${p.value.opacity + 0.25})`,
                }}
              />
            }
          />
        ))}
      </div>

      <div className="mt-2">
        <SliderRow
          label="Opacity"
          value={img.shadow.opacity}
          min={0}
          max={1}
          onChange={(opacity) => setShadow({ opacity })}
        />
      </div>

      <button
        onClick={() => setOpenLight(!openLight)}
        aria-expanded={openLight}
        className="mt-1 flex h-7 w-full items-center gap-1.5 rounded-sm px-1 t-body-sm text-(--tx2) transition-colors hover:bg-(--field) hover:text-(--tx)"
      >
        <Pipette {...subIcon} />
        Adjust light
        <ChevronDown
          size={12}
          className={`ml-auto text-(--tx3) transition-transform ${openLight ? 'rotate-180' : ''}`}
        />
      </button>

      {openLight && (
        <div className="mt-1">
          <SliderRow label="Blur" value={img.shadow.blur} min={0} max={0.2} step={0.002} onChange={(blur) => setShadow({ blur })} />
          <SliderRow label="Offset Y" value={img.shadow.y} min={-0.1} max={0.15} step={0.002} onChange={(y) => setShadow({ y })} />
          <SliderRow label="Offset X" value={img.shadow.x} min={-0.1} max={0.1} step={0.002} onChange={(x) => setShadow({ x })} />
          <ColorRow label="Color" value={img.shadow.color} onChange={(color) => setShadow({ color })} />
          {adaptive && (
            <button
              onClick={() => setShadow({ color: adaptive })}
              className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-(--field) t-body-sm text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)"
            >
              <Sparkles {...subIcon} /> Match the screenshot
            </button>
          )}
        </div>
      )}
    </Group>
  )
}

// ————— Mockup · finish (glow / border / reflection) —————

function FinishGroup() {
  const img = useShots((s) => selectedShotsImage(s.doc))
  const setImage = useShots((s) => s.setImage)
  const setBorder = useShots((s) => s.setBorder)
  const setGlow = useShots((s) => s.setGlow)
  if (!img) return null
  return (
    <Group label="Finish">
      <SliderRow label="Glow" value={img.glow.strength} min={0} max={1} onChange={(strength) => setGlow({ strength })} />
      {img.glow.strength > 0 && (
        <ColorRow label="Glow color" value={img.glow.color} onChange={(color) => setGlow({ color })} />
      )}
      <SliderRow label="Border" value={img.border.width} min={0} max={20} step={0.5} onChange={(width) => setBorder({ width })} />
      {img.border.width > 0 && (
        <ColorRow label="Border color" value={img.border.color} onChange={(color) => setBorder({ color })} />
      )}
      <SliderRow label="Reflection" value={img.reflection} min={0} max={1} onChange={(reflection) => setImage({ reflection })} />
    </Group>
  )
}

// ————— Frame · canvas size —————

const RATIOS: { label: string; w: number; h: number }[] = [
  { label: '16:9', w: 16, h: 9 },
  { label: '3:2', w: 3, h: 2 },
  { label: '4:3', w: 4, h: 3 },
  { label: '5:4', w: 5, h: 4 },
  { label: '1:1', w: 1, h: 1 },
  { label: '4:5', w: 4, h: 5 },
  { label: '3:4', w: 3, h: 4 },
  { label: '2:3', w: 2, h: 3 },
  { label: '9:16', w: 9, h: 16 },
]

function CanvasGroup() {
  const size = useShots((s) => s.doc.size)
  const setSize = useShots((s) => s.setSize)
  const [w, setW] = useState(size.width)
  const [h, setH] = useState(size.height)

  useEffect(() => {
    setW(size.width)
    setH(size.height)
  }, [size.width, size.height])

  const apply = (nw: number, nh: number) => {
    setSize(nw, nh)
    setW(nw)
    setH(nh)
  }

  /** Re-shape the canvas to a ratio, keeping the current long edge. */
  const applyRatio = (rw: number, rh: number) => {
    const long = Math.max(size.width, size.height)
    if (rw >= rh) apply(long, Math.round((long * rh) / rw))
    else apply(Math.round((long * rw) / rh), long)
  }

  const ratioOf = size.width / size.height
  const presetIdx = SIZE_PRESETS.findIndex((p) => p.width === size.width && p.height === size.height)
  const field =
    'h-7 w-full rounded-sm bg-(--field) px-2 t-body-sm text-(--tx) tabular-nums outline-none hover:bg-(--field-h) focus:ring-2 focus:ring-(--focus)'

  return (
    <>
      <div className="border-b border-(--line) px-3 py-3">
        <div className="flex items-center gap-2.5 rounded-lg bg-(--field) p-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-(--panel3) text-(--tx2)">
            <Ratio size={15} strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate t-body-sm font-semibold text-(--tx)">
              {presetIdx >= 0 ? SIZE_PRESETS[presetIdx].name.split(' ')[0] : 'Custom'}
            </span>
            <span className="block t-caption text-(--tx3) tabular-nums">
              {size.width} × {size.height}
            </span>
          </span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <label className="flex items-center gap-1.5">
            <span className="t-caption text-(--tx3)">W</span>
            <input
              type="number"
              value={w}
              onChange={(e) => setW(Number(e.target.value))}
              onBlur={() => apply(w, h)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') apply(w, h)
                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
              }}
              className={field}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="t-caption text-(--tx3)">H</span>
            <input
              type="number"
              value={h}
              onChange={(e) => setH(Number(e.target.value))}
              onBlur={() => apply(w, h)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') apply(w, h)
                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
              }}
              className={field}
            />
          </label>
        </div>

        <div className="mt-2">
          <Dropdown
            value={presetIdx}
            onChange={(i) => {
              if (i < 0) return
              apply(SIZE_PRESETS[i].width, SIZE_PRESETS[i].height)
            }}
            options={[
              { value: -1, label: 'Custom…' },
              ...SIZE_PRESETS.map((p, i) => ({ value: i, label: p.name })),
            ]}
          />
        </div>
      </div>

      <Group label="Aspect ratio">
        <div className="grid grid-cols-3 gap-1.5">
          {RATIOS.map((r) => {
            const active = Math.abs(ratioOf - r.w / r.h) < 0.01
            const box = 30
            const tw = r.w >= r.h ? box : box * (r.w / r.h)
            const th = r.w >= r.h ? box * (r.h / r.w) : box
            return (
              <button
                key={r.label}
                onClick={() => applyRatio(r.w, r.h)}
                aria-pressed={active}
                className={`flex flex-col items-center gap-1 rounded-md py-2 transition-colors ${
                  active ? 'bg-(--sel)' : 'hover:bg-(--field)'
                }`}
              >
                <span className="flex h-8 items-center justify-center">
                  <span
                    style={{ width: tw, height: th }}
                    className={`rounded-xs ${active ? 'bg-(--tx2)' : 'bg-(--panel3)'}`}
                  />
                </span>
                <span className={`t-caption ${active ? 'text-(--tx)' : 'text-(--tx2)'}`}>
                  {r.label}
                </span>
              </button>
            )
          })}
        </div>
      </Group>
    </>
  )
}

// ————— Frame · scene (window chrome) —————

const FRAMES: { id: ShotsFrame; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'macos-light', label: 'macOS' },
  { id: 'macos-dark', label: 'macOS ᴰ' },
  { id: 'browser-light', label: 'Browser' },
  { id: 'browser-dark', label: 'Browser ᴰ' },
]

/** Miniature of the chrome bar a frame style draws, so the tiles read at a glance. */
function ChromeGlyph({ id }: { id: ShotsFrame }) {
  if (id === 'none')
    return <X size={14} strokeWidth={1.8} />
  const dark = id.endsWith('dark')
  const browser = id.startsWith('browser')
  return (
    <span
      className="flex h-6 w-8 flex-col overflow-hidden rounded-xs border border-(--line2)"
      style={{ background: dark ? '#0c0c10' : '#fff' }}
    >
      <span
        className="flex h-2 shrink-0 items-center gap-[2px] px-[3px]"
        style={{ background: dark ? '#2b2b31' : '#f4f4f6' }}
      >
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} className="h-[3px] w-[3px] rounded-full" style={{ background: c }} />
        ))}
        {browser && (
          <span className="ml-[2px] h-[3px] flex-1 rounded-full" style={{ background: dark ? '#3c3c44' : '#e4e4ea' }} />
        )}
      </span>
    </span>
  )
}

function SceneGroup() {
  const img = useShots((s) => selectedShotsImage(s.doc))
  const setImage = useShots((s) => s.setImage)
  if (!img) return null
  return (
    <Group label="Scene">
      <div className="grid grid-cols-3 gap-1.5">
        {FRAMES.map((fr) => (
          <Tile
            key={fr.id}
            label={fr.label}
            active={img.frame === fr.id}
            onClick={() => setImage({ frame: fr.id })}
            icon={<ChromeGlyph id={fr.id} />}
          />
        ))}
      </div>
    </Group>
  )
}

// ————— Frame · background —————

/** CSS preview for a generated background patch (Magic swatches). */
function patchCss(patch: Partial<ShotsBackground>): string {
  if (patch.type === 'solid' && patch.color) return patch.color
  if (patch.type === 'mesh' && patch.mesh)
    return `url(${meshGradientDataURL(patch.mesh.seed, patch.mesh.colors)})`
  if (patch.gradient) return gradientCss(patch.gradient)
  return '#333'
}

const NO_PALETTE: string[] = []
const EMPTY_SCREENS: ShotsImage[] = []

const BG_TILES: { id: ShotsBgType; label: string; icon: LucideIcon }[] = [
  { id: 'transparent', label: 'None', icon: X },
  { id: 'solid', label: 'Color', icon: Palette },
  { id: 'image', label: 'Image', icon: ImageIcon },
  { id: 'wallpaper', label: 'Presets', icon: Wallpaper },
]

function BackgroundGroup() {
  const bg = useShots((s) => s.doc.background)
  const palette = useShots((s) => selectedShotsImage(s.doc)?.palette ?? NO_PALETTE)
  const setBackground = useShots((s) => s.setBackground)
  const randomizeBackground = useShots((s) => s.randomizeBackground)
  const applyMagic = useShots((s) => s.applyMagicBackground)
  const importBackgroundImage = useShots((s) => s.importBackgroundImage)

  const magic = magicBackgrounds(palette)

  return (
    <>
      <Group label="Background">
        <div className="grid grid-cols-4 gap-1.5">
          {BG_TILES.map((t) => (
            <Tile
              key={t.id}
              label={t.label}
              active={bg.type === t.id}
              onClick={() =>
                t.id === 'image' && !bg.imageAssetId
                  ? pickImage((f) => void importBackgroundImage(f))
                  : setBackground({ type: t.id })
              }
              icon={<t.icon size={15} strokeWidth={1.8} />}
            />
          ))}
        </div>
        {bg.type === 'image' && (
          <button
            onClick={() => pickImage((f) => void importBackgroundImage(f))}
            className="mt-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-(--field) t-body-sm text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)"
          >
            <Upload {...subIcon} /> Choose an image
          </button>
        )}
        {bg.type === 'solid' && (
          <div className="mt-1.5">
            <ColorRow label="Color" value={bg.color} onChange={(color) => setBackground({ color })} />
          </div>
        )}
      </Group>

      {/* Magic — backgrounds sampled from the screenshot's own palette */}
      <Group
        label="Magic ✨"
        action={
          <button
            onClick={() => randomizeBackground()}
            title="Randomize"
            className="t-caption text-(--tx3) hover:text-(--tx)"
          >
            Randomize
          </button>
        }
      >
        {magic.length > 0 ? (
          <>
            {palette.length > 0 && (
              <div className="mb-1.5 flex h-3 overflow-hidden rounded-xs">
                {palette.slice(0, 6).map((c, i) => (
                  <button
                    key={i}
                    title={`Use ${c}`}
                    onClick={() => setBackground({ type: 'solid', color: c })}
                    className="flex-1"
                    style={{ background: c }}
                  />
                ))}
              </div>
            )}
            <div className="grid grid-cols-4 gap-1.5">
              {magic.map((patch, i) => (
                <Swatch
                  key={i}
                  title="Background from the image colors"
                  onClick={() => applyMagic(i)}
                  style={{ background: patchCss(patch), backgroundSize: 'cover' }}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="t-caption text-(--tx3)">
            Upload a screenshot and its colors become backgrounds here.
          </p>
        )}
      </Group>

      <Group label="Presets">
        <div className="grid grid-cols-4 gap-1.5">
          {WALLPAPERS.map((w) => (
            <Swatch
              key={w.id}
              title={w.name}
              active={bg.type === 'wallpaper' && bg.wallpaperId === w.id}
              onClick={() => setBackground({ type: 'wallpaper', wallpaperId: w.id })}
              style={{ background: gradientCss(w.gradient) }}
            />
          ))}
        </div>
      </Group>

      <Group label="Mesh">
        <div className="grid grid-cols-4 gap-1.5">
          {MESH_PALETTES.map((colors, i) => (
            <Swatch
              key={i}
              title={`Mesh palette ${i + 1}`}
              active={bg.type === 'mesh' && bg.mesh.colors.join() === colors.join()}
              onClick={() => setBackground({ type: 'mesh', mesh: { ...bg.mesh, colors } })}
              style={{ backgroundImage: `url(${meshGradientDataURL(bg.mesh.seed, colors)})` }}
            />
          ))}
        </div>
        <button
          onClick={() =>
            setBackground({ type: 'mesh', mesh: { ...bg.mesh, seed: Math.floor(Math.random() * 1e6) } })
          }
          className="mt-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-(--field) t-body-sm text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)"
        >
          ↻ Reshuffle the mesh
        </button>
      </Group>

      <Group label="Gradient">
        <div className="mb-1.5 grid grid-cols-2 gap-1.5">
          {(['linear', 'radial'] as const).map((kind) => (
            <button
              key={kind}
              onClick={() => setBackground({ type: 'gradient', gradient: { ...bg.gradient, kind } })}
              aria-pressed={bg.type === 'gradient' && bg.gradient.kind === kind}
              className={`h-7 rounded-sm t-body-sm capitalize transition-colors ${
                bg.type === 'gradient' && bg.gradient.kind === kind
                  ? 'bg-(--sel) text-(--tx)'
                  : 'bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
              }`}
            >
              {kind}
            </button>
          ))}
        </div>
        <ColorRow
          label="From"
          value={bg.gradient.from}
          onChange={(from) => setBackground({ type: 'gradient', gradient: { ...bg.gradient, from } })}
        />
        <ColorRow
          label="To"
          value={bg.gradient.to}
          onChange={(to) => setBackground({ type: 'gradient', gradient: { ...bg.gradient, to } })}
        />
        {bg.gradient.kind === 'linear' && (
          <SliderRow
            label="Angle"
            value={bg.gradient.angle}
            min={0}
            max={360}
            step={1}
            onChange={(angle) => setBackground({ gradient: { ...bg.gradient, angle } })}
          />
        )}
      </Group>

      {bg.type === 'transparent' ? (
        <Group label="Effects">
          <p className="t-caption leading-snug text-(--tx3)">
            Exports with a real alpha channel — pick PNG or WebP (JPG has no transparency).
          </p>
        </Group>
      ) : (
        // blur / vignette / grain all paint the full frame, so they're
        // meaningless (and would fill the alpha) with no background
        <Group label="Effects">
          <SliderRow label="Blur" value={bg.blur} min={0} max={60} step={1} onChange={(blur) => setBackground({ blur })} />
          <SliderRow label="Bright" value={bg.brightness} min={0.4} max={1.8} onChange={(brightness) => setBackground({ brightness })} />
          <SliderRow label="Vignette" value={bg.vignette} min={0} max={1} onChange={(vignette) => setBackground({ vignette })} />
          <SliderRow label="Grain" value={bg.noise} min={0} max={1} onChange={(noise) => setBackground({ noise })} />
        </Group>
      )}
    </>
  )
}

// ————— panel —————

const TABS = [
  { id: 'mockup', label: 'Mockup', icon: Smartphone },
  { id: 'frame', label: 'Frame', icon: Blend },
] as const

export function ShotsLeftPanel() {
  const open = useStudio((s) => s.toolPanelOpen)
  const section = useStudio((s) => s.shotsSection)
  const hasScreens = useShots((s) => s.doc.images.length > 0)
  if (!open) return null

  return (
    <div className="flex w-[280px] shrink-0 flex-col overflow-hidden rounded-lg border border-(--line) bg-(--raised)">
      <div className="flex h-14 shrink-0 items-center border-b border-(--line) px-2">
        <div className="relative grid w-full grid-cols-2 gap-0.5 rounded-md bg-(--field) p-0.5">
          <SegmentThumb
            count={TABS.length}
            index={TABS.findIndex((t) => t.id === section)}
            radius="rounded-sm"
          />
          {TABS.map((t) => {
            const active = section === t.id
            return (
              <button
                key={t.id}
                onClick={() => useStudio.getState().toggleShotsSection(t.id)}
                aria-pressed={active}
                className={`relative z-10 flex h-7 items-center justify-center gap-1.5 rounded-sm t-body-sm font-medium transition-colors ${
                  active ? 'text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'
                }`}
              >
                <t.icon {...iconProps} />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === 'mockup' ? (
          <>
            <DevicePicker />
            <MediaGroup />
            {hasScreens && (
              <>
                <LayoutGroup />
                <ShadowGroup />
                <FinishGroup />
              </>
            )}
          </>
        ) : (
          <>
            <CanvasGroup />
            {hasScreens && <SceneGroup />}
            <BackgroundGroup />
          </>
        )}
      </div>
    </div>
  )
}
