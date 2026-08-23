import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  Aperture,
  AppWindow,
  Blend,
  Check,
  ChevronDown,
  Crosshair,
  Focus,
  Image as ImageIcon,
  ImageUp,
  LayoutGrid,
  Link2,
  Palette,
  Pipette,
  Plus,
  Ratio,
  Shuffle,
  Smartphone,
  Sparkles,
  Spotlight,
  Tablet,
  Trash2,
  Upload,
  Wallpaper,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useShots } from './store'
import {
  DEVICES,
  NO_DEVICE,
  deviceEntryFor,
  devicePatchFor,
  getShotsDevice,
  type DeviceCategory,
  type DeviceSpec,
} from './devices'
import { WALLPAPERS, SOLID_COLORS, gradientCss } from '../lib/wallpapers'
import { PRESET_PHOTO_CATEGORIES, presetPhotosByCategory } from '../lib/presetPhotos'
import { bgCss } from './backgroundCss'
import { magicBackgrounds, PALETTE_FULL_SIZE, PALETTE_GROUP_SIZE } from './palette'
import { MESH_PRESETS, meshCss, reshuffleMesh } from '../lib/meshGradient'
import { SIZE_PRESETS, presetLabel } from '../lib/presets'
import { ColorRow, SegmentThumb, Segments, SliderRow } from '../components/controls'
import { MoreGrid, Swatch } from '../components/catalog'
import { useStudio } from '../store'
import { ui } from '../lib/ui'
import { MAX_SHOTS, selectedShotsImage, type PortraitMode } from './types'
import { portraitOf } from './portrait'
import { CARD_STYLES, DEFAULT_CARD_STYLE, cardStyleCss } from './cardStyles'
import { NO_SHADOW_SCENE, SHADOW_SCENES, type ShadowScene } from './shadows'
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
    <div className="px-3 py-3">
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


/** Same as `pickImage`, but multi-select: the shot can hold several screens. */
function pickImages(onFiles: (files: File[]) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm'
  input.onchange = () => {
    const files = Array.from(input.files ?? [])
    if (files.length > 0) onFiles(files)
  }
  input.click()
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
  { id: 'window', label: 'Window', icon: AppWindow },
]

/** The line under a tile: what shape this enclosure gives the capture. */
function deviceSub(d: DeviceSpec): string {
  if (d.screen) return `${d.screen.w} / ${d.screen.h}`
  return d.chrome === 'none' ? 'bare screen' : 'adapts to media'
}

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
  if (dev.chrome !== 'none') return <ChromeThumb frame={dev.chrome} box={box} />
  if (!dev.bezel) {
    /*
     * The bare entry: just the screen, no enclosure. Its thumbnail matches
     * the phone tiles beside it — same portrait silhouette, same screen
     * fill — with no bezel drawn around it, so it reads as "a phone without
     * the case" rather than an unrelated shape.
     */
    const a = 0.46 // close to a modern phone's own screen aspect
    const h = box
    const w = Math.round(box * a)
    return (
      <span
        style={{ width: w, height: h, background: BLANK_SCREEN, borderRadius: Math.round(w * 0.18) }}
        className="block"
      />
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

function ChromeThumb({ frame, box }: { frame: ShotsFrame; box: number }) {
  const dark = frame.endsWith('dark')
  const browser = frame.startsWith('browser')
  // Landscape, because the thing you put in a window is a desktop capture. The
  // bar is the whole tell, so it keeps a floor in px and stays legible at 28.
  const h = Math.round(box * 0.66)
  const bar = Math.max(5, Math.round(h * (browser ? 0.28 : 0.2)))
  const dot = Math.max(2, Math.round(bar * 0.24))
  return (
    <span
      className="flex flex-col overflow-hidden rounded-[3px] border border-(--line2)"
      style={{ width: box, height: h }}
    >
      <span
        className="flex shrink-0 items-center gap-[2px] px-[3px]"
        style={{ height: bar, background: dark ? '#2b2b31' : '#f4f4f6' }}
      >
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} className="rounded-full" style={{ width: dot, height: dot, background: c }} />
        ))}
        {browser && (
          <span
            className="ml-[2px] flex-1 rounded-full"
            style={{ height: Math.max(2, dot - 1), background: dark ? '#3c3c44' : '#e4e4ea' }}
          />
        )}
      </span>
      <span className="min-h-0 flex-1" style={{ background: dark ? '#15151b' : BLANK_SCREEN }} />
    </span>
  )
}

function DevicePicker() {
  const img = useShots((s) => selectedShotsImage(s.doc))
  const setImage = useShots((s) => s.setImage)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<DeviceCategory | 'all'>('all')

  const current = img ? deviceEntryFor(img.device, img.frame) : getShotsDevice(NO_DEVICE)
  const shown = DEVICES.filter((d) => d.id === NO_DEVICE || tab === 'all' || d.category === tab)

  return (
    <div className="px-3 py-3">
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
            {!img ? 'add media below' : deviceSub(current)}
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
              /*
               * Only "All" carries its name. Four labelled tabs need more width
               * than a 280px panel has, and the categories are the ones whose
               * icons are unambiguous, so they keep the icon and hand the word
               * to the tooltip.
               */
              const labelled = t.id === 'all'
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  title={t.label}
                  aria-label={t.label}
                  aria-pressed={active}
                  className={`flex h-7 items-center justify-center gap-1.5 rounded-full t-body-sm transition-colors ${
                    labelled ? 'flex-1 px-3' : 'w-9 shrink-0'
                  } ${
                    active
                      ? 'bg-(--sel) text-(--tx)'
                      : 'bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
                  }`}
                >
                  <t.icon {...subIcon} />
                  {labelled && t.label}
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {shown.map((d) => {
              const active = current.id === d.id
              return (
                <button
                  key={d.id}
                  onClick={() => {
                    setImage(devicePatchFor(d))
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
                  <span className="t-caption text-(--tx3) tabular-nums">{deviceSub(d)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The scope switch for everything below it on this tab.
 *
 * Without it, giving four screens the same device and shadow means picking
 * each one and repeating yourself four times, and the odds of them drifting
 * out of step grow with every repeat. Hidden at one screen, where "all" and
 * "this one" are the same thing and the control would only raise a question
 * it does not answer.
 */
function ApplyScopeRow() {
  const n = useShots((s) => s.doc.images.length)
  const applyToAll = useShots((s) => s.applyToAll)
  const setApplyToAll = useShots((s) => s.setApplyToAll)
  if (n < 2) return null

  return (
    <div className="px-3 pt-3">
      <button
        onClick={() => setApplyToAll(!applyToAll)}
        aria-pressed={applyToAll}
        title={
          applyToAll
            ? `Device, style, shadow and finish land on all ${n} screens. Position stays per screen.`
            : 'Changes land on the selected screen only'
        }
        className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors ${
          applyToAll ? 'bg-(--sel) text-(--tx)' : 'bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
        }`}
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border transition-colors ${
            applyToAll ? 'border-transparent bg-(--accent-fill)' : 'border-(--line2)'
          }`}
        >
          {applyToAll && <Check size={11} strokeWidth={3} className="text-(--accent-tx)" />}
        </span>
        <span className="truncate t-body-sm">Apply to all {n} screens</span>
      </button>
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
  const importMediaFiles = useShots((s) => s.importMediaFiles)
  const importFromURL = useShots((s) => s.importMediaFromURL)
  const parked = useShots((s) => s.doc.parked ?? EMPTY_SCREENS)
  const setScreenCount = useShots((s) => s.setScreenCount)
  const atMax = images.length + parked.length >= MAX_SHOTS

  /*
   * Drag to reorder which media sits in which slot.
   *
   * `order[i]` is the index, into `images` as it stood when the drag began, of
   * whatever is currently previewed at slot `i`. It only exists while a drag is
   * live — null the rest of the time, so the strip normally just reads `images`
   * directly.
   *
   * The tiles reorder in the DOM as you drag over them, which is what makes
   * neighbours "shift and give space": no separate animation layer, just the
   * array feeding the map changing on every dragover.
   */
  const [dragOrder, setDragOrder] = useState<number[] | null>(null)
  const [dragAt, setDragAt] = useState<number | null>(null)
  const display = dragOrder ?? images.map((_, i) => i)

  /*
   * FLIP (First, Last, Invert, Play), so a shift is a slide rather than a
   * jump-cut.
   *
   * A plain reorder swaps DOM position instantly — correct, but silent: a tile
   * teleports rather than moving out of the way. This records where every tile
   * sat right before the array changes, and once React has repainted them into
   * their new spots, snaps each one back to its old position with a transform
   * and immediately releases it into a transition — so what actually renders
   * is the tile sliding from old to new, even though the DOM update itself was
   * instant.
   */
  const tileRefs = useRef(new Map<string, HTMLButtonElement>())
  const flipFrom = useRef<Map<string, DOMRect> | null>(null)
  // the id being dragged, stable for the whole gesture — `dragAt` is a
  // position and moves every time the preview reorders, so it can't be used
  // to recognise "the tile under the pointer" from one dragover to the next
  const draggingId = useRef<string | null>(null)

  const captureFlip = () => {
    const rects = new Map<string, DOMRect>()
    tileRefs.current.forEach((el, id) => rects.set(id, el.getBoundingClientRect()))
    flipFrom.current = rects
  }

  useLayoutEffect(() => {
    const from = flipFrom.current
    if (!from) return
    flipFrom.current = null
    tileRefs.current.forEach((el, id) => {
      // the dragged tile wears its own lift transform (scale + shadow, via
      // class), so correcting it here would fight that transform rather than
      // add to it — it skips FLIP and gets a plain fade instead
      if (id === draggingId.current) return
      const prev = from.get(id)
      if (!prev) return
      const next = el.getBoundingClientRect()
      const dx = prev.left - next.left
      const dy = prev.top - next.top
      if (!dx && !dy) return
      el.style.transition = 'none'
      el.style.transform = `translate(${dx}px, ${dy}px)`
      el.getBoundingClientRect() // flush, so the browser registers the start point before it animates away from it
      requestAnimationFrame(() => {
        el.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)'
        el.style.transform = ''
      })
      el.addEventListener('transitionend', () => void (el.style.transition = ''), { once: true })
    })
  }, [dragOrder])

  const dragStart = (at: number) => (e: React.DragEvent) => {
    draggingId.current = images[at]?.id ?? null
    setDragOrder(images.map((_, i) => i))
    setDragAt(at)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', '') // Firefox won't start a drag with no data
  }
  const dragOver = (at: number) => (e: React.DragEvent) => {
    e.preventDefault()
    if (dragAt === null || dragAt === at) return
    captureFlip()
    setDragOrder((prev) => {
      if (!prev) return prev
      const next = [...prev]
      const [moved] = next.splice(dragAt, 1)
      next.splice(at, 0, moved)
      return next
    })
    setDragAt(at)
  }
  const dragEnd = () => {
    if (dragOrder && dragAt !== null) {
      useShots.getState().reorderMedia(dragOrder)
      // the tile follows the drag rather than the id it started with, so
      // selection lands wherever it was actually dropped
      selectImage(images[dragAt]?.id ?? images[0]?.id ?? '')
    }
    draggingId.current = null
    setDragOrder(null)
    setDragAt(null)
  }

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
          onClick={() => pickImages((fs) => void importMediaFiles(fs))}
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
        {images.length > 1 && (
          <p className="mb-0.5 w-full t-caption text-(--tx3)">Drag to reorder</p>
        )}
        {display.map((srcIdx, i) => {
          const im = images[srcIdx]
          if (!im) return null
          const url = assets[im.assetId]?.url
          const active = im.id === selectedId
          const dragging = dragOrder !== null && dragAt === i
          return (
            <button
              key={im.id}
              ref={(el) => {
                if (el) tileRefs.current.set(im.id, el)
                else tileRefs.current.delete(im.id)
              }}
              draggable={images.length > 1}
              onDragStart={dragStart(i)}
              onDragOver={dragOver(i)}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={dragEnd}
              title={images.length > 1 ? `Screen ${i + 1} — drag to reorder` : 'Screen 1'}
              onClick={() => selectImage(im.id)}
              /*
               * The dragged tile itself gets picked up rather than just faded:
               * a touch of scale and a real shadow read as "lifted off the
               * strip", which is what a mouse drag is actually doing. The
               * neighbours it displaces get the FLIP slide above instead — two
               * different motions for two different things happening at once.
               */
              className={`relative h-14 w-11 overflow-hidden rounded-lg border-2 bg-(--panel2) transition-[transform,box-shadow,opacity] duration-150 ${
                images.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''
              } ${active ? 'is-picked' : 'border-transparent hover:border-(--line2)'} ${
                dragging
                  ? 'z-10 scale-110 opacity-90 shadow-[0_8px_20px_rgba(0,0,0,0.45)]'
                  : 'scale-100 shadow-none'
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
            onClick={() => pickImages((fs) => void importMediaFiles(fs))}
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
  /*
   * The pager keeps both pages mounted so it can slide between them, which
   * means this group renders a full scene per preset even while the Frame tab
   * is the one you are looking at. It selects the whole document, so every
   * slider drag anywhere re-rendered all of them. Off-page, it renders nothing.
   */
  const onPage = useStudio((s) => s.shotsSection === 'mockup')
  const activeId = useShots((s) => s.doc.layout)
  const applyLayout = useShots((s) => s.applyLayout)
  const setScreenCount = useShots((s) => s.setScreenCount)

  const n = images.length
  if (n === 0 || !onPage) return null

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
                <ShotsPreview doc={preview} effects={false} />
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
/*
 * A preview tile that shows the effect on a card corner, close up.
 *
 * The old shadow tiles were a 20px white square with a scaled-down shadow
 * behind it. At that size every preset resolves to the same faint smudge, so
 * the picker asked you to choose between four things it could not show you.
 *
 * This is the same trick a paint chip uses: stop trying to depict the whole
 * object and show one corner of it, large. The card is oversized and pushed
 * down and right so only its top-left corner is in frame, which puts the radius
 * and the shadow's near edge, the two things actually being chosen, at the
 * biggest scale the tile can give them.
 *
 * The backdrop is a lit grey rather than flat: a shadow is invisible on white
 * and reads as a hole on black, and the gradient running light-to-dark from the
 * top left is what tells you where the light is before you read any label.
 */
function CornerPreview({
  label,
  active,
  onClick,
  card,
  behind,
  title,
}: {
  label: string
  active?: boolean
  onClick: () => void
  /** styles applied to the card, this is what is being previewed */
  card: React.CSSProperties
  /** copies drawn behind the card, for styles built out of stacked paper */
  behind?: React.CSSProperties[]
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      aria-pressed={active}
      /*
       * Selection is a plate behind the tile, not a ring around it. A ring is a
       * border, and on a preview it lands right where the card's own edge is
       * being judged.
       */
      className={`group flex flex-col items-center gap-1 rounded-xl p-1 transition-colors ${
        active ? 'bg-(--sel)' : 'hover:bg-(--field)'
      }`}
    >
      <span
        className="relative block aspect-square w-full overflow-hidden rounded-xl"
        style={{ background: 'linear-gradient(145deg, #e2e2e7 0%, #bcbcc5 52%, #9c9ca7 100%)' }}
      >
        {/* same "chosen" mark every swatch grid uses — see Swatch below */}
        {active && (
          <span className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/25">
            <Check size={22} strokeWidth={2.6} className="text-white drop-shadow" />
          </span>
        )}
        {behind?.map((b, i) => (
          <span
            key={i}
            className="absolute block"
            style={{
              left: '28%',
              top: '24%',
              width: '100%',
              height: '100%',
              borderRadius: '26%',
              ...b,
            }}
          />
        ))}
        <span
          className="absolute block"
          style={{
            left: '28%',
            top: '24%',
            width: '100%',
            height: '100%',
            borderRadius: '26%',
            background: '#f6f6f8',
            ...card,
          }}
        />
      </span>
      <span
        className={`w-full truncate t-caption ${active ? 'text-(--tx)' : 'text-(--tx3) group-hover:text-(--tx2)'}`}
      >
        {label}
      </span>
    </button>
  )
}

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
  /*
   * Adaptive is a colour, the other four are shapes, and they used to be
   * judged independently: a shadow could be "None" *and* "Adaptive" at once
   * and tick two tiles in what is meant to be a single-select grid. They now
   * share one selection, so choosing a shape drops back to a plain black
   * shadow and choosing Adaptive is the shape-plus-tint it always applied.
   * A colour picked by hand under "Adjust light" matches neither, which is
   * honest: it is no longer any of these presets.
   */
  const adaptiveOn =
    !!adaptive && img.shadow.color.toLowerCase() === adaptive.toLowerCase() && img.shadow.opacity > 0

  return (
    <Group label="Shadow">
      {/*
        Three across, not four. The tiles are square now, so a fourth column
        would shrink each one to the size the old glyphs were, which is the
        problem this replaced.
      */}
      <div className="grid grid-cols-3 gap-1">
        {SHADOW_PRESETS.map((p) => (
          <CornerPreview
            key={p.id}
            label={p.label}
            active={activeId === p.id && !adaptiveOn}
            onClick={() => setShadow({ ...p.value, color: '#000000' })}
            card={{
              // the same numbers the renderer uses, against the tile's own size
              // instead of the canvas, so each preset is genuinely itself here
              boxShadow:
                p.value.opacity === 0
                  ? 'none'
                  : `${p.value.x * 150}px ${p.value.y * 150}px ${p.value.blur * 170}px rgba(0,0,0,${Math.min(0.85, p.value.opacity + 0.2)})`,
            }}
          />
        ))}
        {adaptive && (
          <CornerPreview
            label="Adaptive"
            title="Tint the shadow with the screenshot's own darkest colour"
            active={adaptiveOn}
            onClick={() => setShadow({ ...SHADOW_PRESETS[2].value, color: adaptive })}
            card={{ boxShadow: `0 10px 17px ${adaptive}cc` }}
          />
        )}
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

// ————— Mockup · card style —————

/*
 * The tile shows a card corner, and the card it depicts is bigger than the
 * tile, so the recipe is measured against a width larger than the box it is
 * drawn in. That is not an exaggeration for legibility: it is the same ratio
 * you get on the canvas, where a 20px border on a 700px card shows as a thick
 * band when you look at one corner of it.
 */
const STYLE_TILE_CARD_W = 150

function StyleGroup() {
  const img = useShots((s) => selectedShotsImage(s.doc))
  const setImage = useShots((s) => s.setImage)
  if (!img) return null

  // a device frame is its own mount, so the whole group is meaningless there
  if (getShotsDevice(img.device).bezel) return null

  return (
    <Group label="Style">
      <div className="grid grid-cols-3 gap-1">
        <MoreGrid cols={3} rows={3}>
          {CARD_STYLES.map((s) => (
            <CornerPreview
              key={s.id}
              label={s.label}
              active={(img.cardStyle ?? DEFAULT_CARD_STYLE) === s.id}
              onClick={() => setImage({ cardStyle: s.id })}
              card={{ boxShadow: cardStyleCss(s, STYLE_TILE_CARD_W) }}
              behind={
                s.stack
                  ? Array.from({ length: s.stack.count }, (_, i) => {
                      const k = s.stack!.count - i
                      const inset = s.stack!.shrink * STYLE_TILE_CARD_W * k
                      return {
                        marginLeft: inset + s.stack!.dx * STYLE_TILE_CARD_W * k,
                        marginTop: s.stack!.dy * STYLE_TILE_CARD_W * k,
                        width: `calc(100% - ${inset * 2}px)`,
                        background: s.stack!.color,
                        boxShadow: `0 ${2 * k}px ${7 * k}px rgba(0,0,0,0.16)`,
                      }
                    })
                  : undefined
              }
            />
          ))}
        </MoreGrid>
      </div>
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

/** A ratio's shape, scaled to fit inside a `box`-sized square, centred. */
function RatioSwatch({
  w,
  h,
  box,
  style,
}: {
  w: number
  h: number
  box: number
  style: React.CSSProperties
}) {
  const tw = w >= h ? box : box * (w / h)
  const th = w >= h ? box * (h / w) : box
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: box, height: box }}>
      <span className="rounded-xs bg-cover bg-center" style={{ width: tw, height: th, ...style }} />
    </span>
  )
}

/**
 * Frame size, one control for the whole decision, collapsed by default.
 *
 * This used to be three controls for one decision — a plain summary card, a
 * dropdown for named export sizes, and a separate grid for abstract ratios —
 * stacked on top of each other and costing that much panel height whether or
 * not anyone was picking a size right now. Closed shows the current match:
 * a named preset if the size is exactly one (e.g. "Dribbble"), else the
 * ratio it happens to be (e.g. "4:3"), else "Custom". Open shows both lists
 * under one toggle, each swatch painted in the shot's current background.
 */
function SizePicker({
  size,
  apply,
  onCustom,
}: {
  size: { width: number; height: number }
  apply: (w: number, h: number) => void
  onCustom: () => void
}) {
  const [open, setOpen] = useState(false)
  const bg = useShots((s) => s.doc.background)
  const assets = useShots((s) => s.assets)
  const bgImageUrl = bg.imageAssetId ? (assets[bg.imageAssetId]?.url ?? null) : null
  const bgStyle = bgCss(bg, bgImageUrl)

  const presetIdx = SIZE_PRESETS.findIndex((p) => p.width === size.width && p.height === size.height)
  const preset = presetIdx >= 0 ? SIZE_PRESETS[presetIdx] : null
  const ratioOf = size.width / size.height
  const ratio = RATIOS.find((r) => Math.abs(ratioOf - r.w / r.h) < 0.01)
  const label = preset ? presetLabel(preset.name) : ratio ? ratio.label : 'Custom'

  const long = Math.max(size.width, size.height)
  const sizeForRatio = (rw: number, rh: number) =>
    rw >= rh ? { w: long, h: Math.round((long * rh) / rw) } : { w: Math.round((long * rw) / rh), h: long }
  const applyRatio = (rw: number, rh: number) => {
    const s = sizeForRatio(rw, rh)
    apply(s.w, s.h)
  }

  return (
    <div className="px-3 py-3">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg bg-(--field) p-2 text-left transition-colors hover:bg-(--field-h)"
      >
        <RatioSwatch w={size.width} h={size.height} box={32} style={bgStyle} />
        <span className="min-w-0 flex-1">
          <span className="block truncate t-body-sm font-semibold text-(--tx)">{label}</span>
          <span className="block t-caption text-(--tx3) tabular-nums">
            {size.width} × {size.height}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-(--tx3) transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-2">
          <p className="mb-1.5 t-caption text-(--tx3)">Ratio</p>
          <div className="grid grid-cols-3 gap-1.5">
            {RATIOS.map((r) => {
              const isActive = ratio?.label === r.label
              const s = sizeForRatio(r.w, r.h)
              return (
                <button
                  key={r.label}
                  onClick={() => {
                    applyRatio(r.w, r.h)
                    setOpen(false)
                  }}
                  aria-pressed={isActive}
                  className={`flex flex-col items-center gap-1 rounded-md py-2 transition-colors ${
                    isActive ? 'bg-(--sel)' : 'hover:bg-(--field)'
                  }`}
                >
                  <RatioSwatch w={r.w} h={r.h} box={30} style={bgStyle} />
                  <span className={`t-caption ${isActive ? 'text-(--tx)' : 'text-(--tx2)'}`}>{r.label}</span>
                  <span className="t-caption text-(--tx3) tabular-nums">
                    {s.w} × {s.h}
                  </span>
                </button>
              )
            })}
          </div>

          <p className="mt-3 mb-1.5 t-caption text-(--tx3)">Preset size</p>
          <div className="flex flex-col gap-0.5">
            {SIZE_PRESETS.map((p, i) => {
              const isActive = presetIdx === i
              return (
                <button
                  key={p.name}
                  onClick={() => {
                    apply(p.width, p.height)
                    setOpen(false)
                  }}
                  aria-pressed={isActive}
                  className={`flex items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors ${
                    isActive ? 'bg-(--sel)' : 'hover:bg-(--field)'
                  }`}
                >
                  <RatioSwatch w={p.width} h={p.height} box={26} style={bgStyle} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate t-caption ${isActive ? 'text-(--tx)' : 'text-(--tx2)'}`}>
                      {presetLabel(p.name)}
                    </span>
                    <span className="block t-caption text-(--tx3) tabular-nums">
                      {p.width} × {p.height}
                    </span>
                  </span>
                </button>
              )
            })}
            <button
              onClick={() => {
                setOpen(false)
                onCustom()
              }}
              aria-pressed={!preset && !ratio}
              className={`flex items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors ${
                !preset && !ratio ? 'bg-(--sel)' : 'hover:bg-(--field)'
              }`}
            >
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center">
                <Ratio size={14} strokeWidth={1.8} className={!preset && !ratio ? 'text-(--tx)' : 'text-(--tx2)'} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate t-caption ${!preset && !ratio ? 'text-(--tx)' : 'text-(--tx2)'}`}>
                  Custom
                </span>
                <span className="block t-caption text-(--tx3) tabular-nums">
                  {size.width} × {size.height}
                </span>
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CanvasGroup() {
  const size = useShots((s) => s.doc.size)
  const setSize = useShots((s) => s.setSize)
  const [w, setW] = useState(size.width)
  const [h, setH] = useState(size.height)
  const wRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setW(size.width)
    setH(size.height)
  }, [size.width, size.height])

  const apply = (nw: number, nh: number) => {
    setSize(nw, nh)
    setW(nw)
    setH(nh)
  }

  const field =
    'h-7 w-full rounded-sm bg-(--field) px-2 t-body-sm text-(--tx) tabular-nums outline-none hover:bg-(--field-h) focus:ring-2 focus:ring-(--focus)'

  return (
    <>
      <SizePicker size={size} apply={apply} onCustom={() => wRef.current?.focus()} />

      <div className="px-3 pt-0 pb-3">
        <div className="grid grid-cols-2 gap-1.5">
          <label className="flex items-center gap-1.5">
            <span className="t-caption text-(--tx3)">W</span>
            <input
              ref={wRef}
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
      </div>
    </>
  )
}

// ————— Frame · shadow scene —————

/**
 * The tiles show the asset itself, on a light field.
 *
 * The files are black-on-transparent, so on a dark panel a bare thumbnail is
 * an invisible shape in a void. Putting it over a pale swatch is what the
 * shadow will actually look like in a shot, and it doubles as a check that the
 * alpha came out of the processing script right.
 */
function ShadowSceneTile({
  scene,
  active,
  onClick,
}: {
  scene: ShadowScene | null
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={scene?.label ?? 'No shadow'}
      aria-label={scene?.label ?? 'No shadow'}
      aria-pressed={active}
      className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-cover bg-center"
      style={
        // the empty tile has no picture to darken, so it says "chosen" by
        // filling with the selection colour rather than by wearing an overlay
        // that would hide its own glyph
        scene
          ? { backgroundImage: `url(${scene.thumb})`, backgroundColor: '#d9d9de' }
          : { backgroundColor: active ? 'var(--sel)' : 'var(--field)' }
      }
    >
      {!scene && <X size={14} strokeWidth={1.8} className="text-(--tx3)" />}
      {/* chosen is said inside the shape, the same way the colour swatches do it */}
      {active && scene && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Check size={14} strokeWidth={2.6} className="text-white drop-shadow" />
        </span>
      )}
    </button>
  )
}

function ShadowSceneGroup() {
  const gobo = useShots((s) => s.doc.gobo)
  const setGobo = useShots((s) => s.setGobo)
  if (!gobo) return null
  const on = gobo.id !== NO_SHADOW_SCENE

  return (
    <Group label="Shadow Scene">
      <div className="grid grid-cols-3 gap-1.5">
        <MoreGrid cols={3}>
          {[
            <ShadowSceneTile
              key="none"
              scene={null}
              active={!on}
              onClick={() => setGobo({ id: NO_SHADOW_SCENE })}
            />,
            ...SHADOW_SCENES.map((s) => (
              <ShadowSceneTile
                key={s.id}
                scene={s}
                active={gobo.id === s.id}
                onClick={() => setGobo({ id: s.id })}
              />
            )),
          ]}
        </MoreGrid>
      </div>

      {on && (
        <div className="mt-3">
          {/*
            Under or over is the whole decision here. Under keeps the screens
            perfectly readable because the shadow never touches them; over lets
            it fall across the devices, which is what makes the light look real
            and what costs legibility. Neither is the right default for every
            shot, so it is a switch rather than a preference.
          */}
          <div className="mb-2 grid grid-cols-2 gap-0.5 rounded-md bg-(--field) p-0.5">
            {(['under', 'over'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setGobo({ placement: p })}
                aria-pressed={gobo.placement === p}
                title={
                  p === 'under'
                    ? 'Shadow falls on the background only'
                    : 'Shadow falls across the devices too'
                }
                className={`h-7 rounded-sm t-body-sm capitalize transition-colors ${
                  gobo.placement === p ? 'bg-(--sel) text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'
                }`}
              >
                {p === 'under' ? 'Underlay' : 'Overlay'}
              </button>
            ))}
          </div>
          <SliderRow
            label="Opacity"
            value={gobo.opacity}
            min={0}
            max={1}
            onChange={(opacity) => setGobo({ opacity })}
          />
          <SliderRow
            label="Scale"
            value={gobo.scale}
            min={0.5}
            max={3}
            onChange={(scale) => setGobo({ scale })}
          />
          <SliderRow
            label="Rotate"
            value={gobo.rotate}
            min={-180}
            max={180}
            step={1}
            format={(v) => `${Math.round(v)}°`}
            onChange={(rotate) => setGobo({ rotate })}
          />
          <SliderRow
            label="Offset X"
            value={gobo.x}
            min={-0.5}
            max={0.5}
            step={0.005}
            onChange={(x) => setGobo({ x })}
          />
          <SliderRow
            label="Offset Y"
            value={gobo.y}
            min={-0.5}
            max={0.5}
            step={0.005}
            onChange={(y) => setGobo({ y })}
          />
        </div>
      )}
    </Group>
  )
}

// ————— Frame · portrait (depth of field) —————

const PORTRAIT_MODES: { id: PortraitMode; label: string; icon: ReactNode; title: string }[] = [
  { id: 'none', label: 'None', icon: <X size={14} strokeWidth={1.8} />, title: 'Everything in focus' },
  {
    id: 'lens',
    label: 'Lens Blur',
    icon: <Aperture size={15} strokeWidth={1.6} />,
    title: 'Defocus everything outside the focal point',
  },
  {
    id: 'stage',
    label: 'Stage',
    icon: <Spotlight size={15} strokeWidth={1.6} />,
    title: 'Drop everything outside the focal point into shadow',
  },
  {
    id: 'both',
    label: 'Lens + Stage',
    icon: <Focus size={15} strokeWidth={1.6} />,
    title: 'Defocus and shade everything outside the focal point',
  },
]

function PortraitGroup() {
  /*
   * The fallback is applied outside the selector on purpose. `portraitOf`
   * builds a fresh object when the field is missing, and zustand compares
   * selector results by identity, so calling it inside would hand back a new
   * object every render and never settle.
   */
  const saved = useShots((s) => s.doc.portrait)
  const portrait = portraitOf(saved)
  const guide = useShots((s) => s.focusGuide)
  const setFocusGuide = useShots((s) => s.setFocusGuide)
  const setPortrait = useShots((s) => s.setPortrait)
  const on = portrait.mode !== 'none'

  return (
    <Group label="Portrait">
      {/* two by two rather than a row: "Lens + Stage" has no room in a quarter
          of a 280px panel, and four tiles in a row of three leaves a stray */}
      <div className="grid grid-cols-2 gap-1.5">
        {PORTRAIT_MODES.map((m) => (
          <Tile
            key={m.id}
            label={m.label}
            title={m.title}
            active={portrait.mode === m.id}
            onClick={() => setPortrait({ mode: m.id })}
            icon={m.icon}
          />
        ))}
      </div>

      {on && (
        <div className="mt-3">
          {/*
            The focal point is dragged on the canvas rather than typed here, so
            when its rings are put away this is the way back to them. Without
            it, dismissing the guide would be a one-way door.
          */}
          {guide ? (
            <p className="mb-2 t-caption leading-snug text-(--tx3)">
              Drag the ring on the canvas to choose what stays sharp. Click the canvas to hide it.
            </p>
          ) : (
            <button
              onClick={() => setFocusGuide(true)}
              className="mb-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-(--field) t-body-sm text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)"
            >
              <Crosshair {...subIcon} /> Show focal point
            </button>
          )}
          <SliderRow
            label="Focus"
            value={portrait.radius}
            min={0.05}
            max={0.6}
            onChange={(radius) => setPortrait({ radius })}
          />
          <SliderRow
            label="Falloff"
            value={portrait.feather}
            min={0.02}
            max={0.5}
            onChange={(feather) => setPortrait({ feather })}
          />
          {/* each amount shows only where it does something, and keeps its
              value when the mode moves away from it */}
          {(portrait.mode === 'lens' || portrait.mode === 'both') && (
            <SliderRow
              label="Blur"
              value={portrait.strength}
              min={0}
              max={1}
              onChange={(strength) => setPortrait({ strength })}
            />
          )}
          {(portrait.mode === 'stage' || portrait.mode === 'both') && (
            <SliderRow
              label="Shade"
              value={portrait.shade}
              min={0}
              max={1}
              onChange={(shade) => setPortrait({ shade })}
            />
          )}
        </div>
      )}
    </Group>
  )
}

// ————— Frame · background —————

/**
 * CSS preview for a generated background patch (Magic swatches).
 *
 * A full style object rather than a bare CSS string: solid/gradient patches
 * only ever need the `background` shorthand, mesh needs the longhand
 * `backgroundImage`/`backgroundSize`/`backgroundPosition` trio, and mixing
 * shorthand with longhand in the same style object between renders is
 * exactly what React's dev-mode style warning exists to catch — the 8
 * swatches switch between both shapes every time the palette tab changes.
 */
function patchStyle(patch: Partial<ShotsBackground>): React.CSSProperties {
  if (patch.type === 'solid' && patch.color) return { background: patch.color }
  if (patch.type === 'mesh' && patch.mesh) return meshCss(patch.mesh)
  if (patch.gradient) return { background: gradientCss(patch.gradient) }
  return { background: '#333' }
}

const NO_PALETTE: string[] = []
const EMPTY_SCREENS: ShotsImage[] = []

/*
 * `extractPalette` returns three `PALETTE_GROUP_SIZE`-color palettes back to
 * back — the same pixels read three ways, so a real color the frequency
 * ranking buries (a sliver of green in an orange screenshot) still gets a
 * tab where it's the point rather than being out-voted every time.
 */
const PALETTE_GROUPS = ['dominant', 'vibrant', 'diverse'] as const
type PaletteGroup = (typeof PALETTE_GROUPS)[number]
const PALETTE_GROUP_TABS: { id: PaletteGroup; label: string }[] = [
  { id: 'dominant', label: 'Dominant' },
  { id: 'vibrant', label: 'Vibrant' },
  { id: 'diverse', label: 'Diverse' },
]

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

  const [paletteGroup, setPaletteGroup] = useState<PaletteGroup>('dominant')
  const groupIdx = PALETTE_GROUPS.indexOf(paletteGroup)
  const ensurePalettes = useShots((s) => s.ensurePalettes)

  /*
   * A screen sampled before the three groups existed carries only one of
   * them. Hydration re-samples those, but a session already open when it
   * happens would sit on the short palette until reload, so noticing it here
   * repairs it in place. `ensurePalettes` is a no-op once everything is
   * current, and the effect only re-runs when the length actually changes.
   */
  const hasGroups = palette.length === PALETTE_FULL_SIZE
  useEffect(() => {
    if (palette.length > 0 && !hasGroups) void ensurePalettes()
  }, [ensurePalettes, hasGroups, palette.length])

  const activePalette = hasGroups
    ? palette.slice(groupIdx * PALETTE_GROUP_SIZE, (groupIdx + 1) * PALETTE_GROUP_SIZE)
    : palette
  const magic = magicBackgrounds(activePalette)

  /*
   * A real photo makes stale Effects sliders obvious in a way a solid or
   * gradient never did — someone picks "Nature 20" expecting what the thumb
   * showed and gets it dimmed, blurred and grainy from whatever they were
   * tuning before. Presets are a fresh start, so effects reset back to
   * neutral here; nothing stops turning them on again afterward.
   */
  const selectPhoto = (photoId: string) =>
    setBackground({ type: 'photo', photoId, blur: 0, brightness: 1, vignette: 0, noise: 0 })

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
            className="flex h-6 items-center gap-1 rounded-full bg-(--field) px-2.5 t-caption text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx)"
          >
            <Shuffle size={11} strokeWidth={2} />
            Randomize
          </button>
        }
      >
        {palette.length > 0 ? (
          <>
            <Segments options={PALETTE_GROUP_TABS} value={paletteGroup} onChange={setPaletteGroup} compact />
            {activePalette.length > 0 && (
              <div className="mb-1.5 flex h-3 overflow-hidden rounded-xs">
                {activePalette.map((c, i) => (
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
                  onClick={() => applyMagic(i, activePalette)}
                  style={patchStyle(patch)}
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

      <Group label="Solid">
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
      </Group>

      <Group label="Gradient presets">
        <div className="grid grid-cols-4 gap-1.5">
          <MoreGrid cols={4}>
            {WALLPAPERS.map((w) => (
              <Swatch
                key={w.id}
                title={w.name}
                active={bg.type === 'wallpaper' && bg.wallpaperId === w.id}
                onClick={() => setBackground({ type: 'wallpaper', wallpaperId: w.id })}
                style={{ background: gradientCss(w.gradient) }}
              />
            ))}
          </MoreGrid>
        </div>
      </Group>

      {/*
        Reshuffling reseeds the same palettes rather than picking a different
        one, so it belongs beside the heading with the other verbs, not in the
        grid pretending to be an eighth palette you can choose.
      */}
      <Group
        label="Mesh"
        action={
          <button
            onClick={() =>
              setBackground({ type: 'mesh', mesh: reshuffleMesh(bg.mesh) })
            }
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

      {/* one section per shipped folder, in PRESET_PHOTO_CATEGORIES order */}
      {PRESET_PHOTO_CATEGORIES.map((cat) => (
        <Group key={cat.id} label={cat.label}>
          <div className="grid grid-cols-4 gap-1.5">
            <MoreGrid cols={4}>
              {presetPhotosByCategory(cat.id).map((p) => (
                <Swatch
                  key={p.id}
                  title={p.name}
                  active={bg.type === 'photo' && bg.photoId === p.id}
                  onClick={() => selectPhoto(p.id)}
                  style={{ backgroundImage: `url(${p.thumb})` }}
                />
              ))}
            </MoreGrid>
          </div>
        </Group>
      ))}

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

    </>
  )
}

function EffectsGroup() {
  const bg = useShots((s) => s.doc.background)
  const setBackground = useShots((s) => s.setBackground)
  const effectsOn = bg.blur > 0 || bg.brightness !== 1 || bg.vignette > 0 || bg.noise > 0

  if (bg.type === 'transparent')
    return (
      <Group label="Effects">
        <p className="t-caption leading-snug text-(--tx3)">
          Exports with a real alpha channel — pick PNG or WebP (JPG has no transparency).
        </p>
      </Group>
    )

  return (
    // blur / vignette / grain all paint the full frame, so they're
    // meaningless (and would fill the alpha) with no background
    <Group
      label="Effects"
      action={
        /*
         * Only here when there is something to undo.
         *
         * These four multiply whatever the background is, and they survive
         * every change to it, so a brightness left at 0.68 quietly turns a
         * pure white into grey and keeps doing it through every preset you
         * try afterwards. Nothing upstream sets them, which is worse rather
         * than better: it means the only way back to neutral is noticing
         * four sliders in a group you were not looking at. This is both the
         * flag that they are active and the way out.
         */
        effectsOn ? (
          <button
            onClick={() => setBackground({ blur: 0, brightness: 1, vignette: 0, noise: 0 })}
            title="Back to no blur, full brightness, no vignette or grain"
            className="t-caption text-(--tx3) hover:text-(--tx)"
          >
            Reset
          </button>
        ) : undefined
      }
    >
      <SliderRow label="Blur" value={bg.blur} min={0} max={60} step={1} onChange={(blur) => setBackground({ blur })} />
      <SliderRow label="Bright" value={bg.brightness} min={0.4} max={1.8} onChange={(brightness) => setBackground({ brightness })} />
      <SliderRow label="Vignette" value={bg.vignette} min={0} max={1} onChange={(vignette) => setBackground({ vignette })} />
      <SliderRow label="Grain" value={bg.noise} min={0} max={1} onChange={(noise) => setBackground({ noise })} />
    </Group>
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
  const pager = useRef<HTMLDivElement>(null)
  const settled = useRef(false)
  /*
   * When a tab click animates the pager, the scroll it produces fires the
   * handler below on every frame, starting at the page it is leaving. Without
   * a window to ignore, the first frame reports the old page and hands the
   * section straight back, and the panel snaps to where it started.
   */
  const driving = useRef(0)
  const index = Math.max(
    0,
    TABS.findIndex((t) => t.id === section),
  )

  /*
   * Tab to page. Restoring a remembered tab on open is not a gesture, so the
   * first pass jumps and every one after it animates.
   */
  useEffect(() => {
    const el = pager.current
    if (!el || !el.clientWidth) return
    const target = index * el.clientWidth
    if (Math.abs(el.scrollLeft - target) < 2) return
    driving.current = Date.now() + 700
    el.scrollTo({ left: target, behavior: settled.current ? 'smooth' : 'auto' })
  }, [index, open])

  useEffect(() => {
    settled.current = true
  }, [])

  /*
   * Page to tab. `setShotsSection` rather than `toggleShotsSection`, because
   * the toggle closes the panel when handed the section already showing, and a
   * scroll that settles back where it started would otherwise slam it shut.
   */
  const onScroll = () => {
    const el = pager.current
    if (!el || !el.clientWidth || Date.now() < driving.current) return
    const id = TABS[Math.round(el.scrollLeft / el.clientWidth)]?.id
    if (id) useStudio.getState().setShotsSection(id)
  }

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

      {/*
        The two sections are pages of one horizontal scroller rather than a
        swap, so a trackpad's sideways scroll moves between them the way it
        already moves anything else. The tabs stay: this is a second way in, not
        a replacement, and a gesture with no visible affordance is not a control.

        `overscroll-x-contain` matters more than it looks. Without it a swipe
        that runs past the last page hands the gesture to the browser, which
        reads it as navigate-back and throws the editor away.
      */}
      <div
        ref={pager}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
      >
        <div className="w-full shrink-0 snap-start overflow-y-auto">
          <DevicePicker />
          <ApplyScopeRow />
          <MediaGroup />
          {hasScreens && (
            <>
              <LayoutGroup />
              <StyleGroup />
              <ShadowGroup />
              <FinishGroup />
            </>
          )}
        </div>
        <div className="w-full shrink-0 snap-start overflow-y-auto">
          <CanvasGroup />
          <BackgroundGroup />
          {hasScreens && <PortraitGroup />}
          {hasScreens && <ShadowSceneGroup />}
          <EffectsGroup />
        </div>
      </div>
    </div>
  )
}
