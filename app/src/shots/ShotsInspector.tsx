import { useEffect, useState } from 'react'
import {
  AppWindow,
  Blend,
  Box,
  FlipHorizontal2,
  FlipVertical2,
  Frame,
  ImageUp,
  Images,
  Laptop,
  LayoutGrid,
  Link2,
  Monitor,
  Maximize2,
  MoveHorizontal,
  MoveVertical,
  Ratio,
  RotateCw,
  Shuffle,
  Smartphone,
  Sparkles,
  Square,
  SquareDashedBottom,
  Squircle,
  Tablet,
  Trash2,
  Upload,
  Wallpaper,
  Watch,
  type LucideIcon,
} from 'lucide-react'
import { useShots } from './store'
import { WALLPAPERS, gradientCss } from './wallpapers'
import { magicBackgrounds } from './palette'
import { ColorRow, Dropdown, MiniButton, Section, Segments, SliderRow, SubHeading } from '../components/controls'
import { MESH_PALETTES, meshGradientDataURL } from '../lib/meshGradient'
import { ui } from '../lib/ui'
import { SIZE_PRESETS } from '../lib/presets'
import { MAX_SHOTS, selectedShotsImage } from './types'
import { DEVICES, type DeviceCategory, type DeviceSpec } from './devices'
import type { ShotsBackground, ShotsBgType, ShotsFrame } from './types'

/** CSS preview for a generated background patch (Magic swatches). */
function patchCss(patch: Partial<ShotsBackground>): string {
  if (patch.type === 'solid' && patch.color) return patch.color
  if (patch.type === 'mesh' && patch.mesh) return `url(${meshGradientDataURL(patch.mesh.seed, patch.mesh.colors)})`
  if (patch.gradient) return gradientCss(patch.gradient)
  return '#333'
}

const NO_PALETTE: string[] = []

/** Glyphs shown ahead of each slider label, sized to match the 11px labels. */
const iconProps = { size: 12, strokeWidth: 1.75 } as const
/** Glyphs for section headers and sub-headings. */
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

// ————— Background —————

function BackgroundSection() {
  const bg = useShots((s) => s.doc.background)
  const palette = useShots((s) => selectedShotsImage(s.doc)?.palette ?? NO_PALETTE)
  const setBackground = useShots((s) => s.setBackground)
  const randomizeBackground = useShots((s) => s.randomizeBackground)
  const applyMagic = useShots((s) => s.applyMagicBackground)
  const importBackgroundImage = useShots((s) => s.importBackgroundImage)

  const magic = magicBackgrounds(palette)

  const importBg = () => pickImage((f) => void importBackgroundImage(f))

  return (
    <Section title="Background" icon={<Wallpaper {...secIcon} />}>
      {/* Magic ✨ — backgrounds sampled from the screenshot's own palette */}
      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] text-(--tx2)">
            <Sparkles {...subIcon} /> Magic
          </span>
          <MiniButton onClick={() => randomizeBackground()} title="Randomize background">
            <Shuffle {...subIcon} /> Randomize
          </MiniButton>
        </div>
        {magic.length > 0 ? (
          <div className="grid grid-cols-4 gap-1.5">
            {magic.map((patch, i) => (
              <button
                key={i}
                title="Background from image colors"
                onClick={() => applyMagic(i)}
                className="h-9 rounded-md border-2 border-(--line) bg-cover bg-center hover:border-(--line2)"
                style={{ background: patchCss(patch), backgroundSize: 'cover' }}
              />
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-(--tx3)">Upload a screenshot to generate backgrounds from its colors.</p>
        )}
        {palette.length > 0 && (
          <div className="mt-1.5 flex gap-1">
            {palette.slice(0, 6).map((c, i) => (
              <button
                key={i}
                title={`Use ${c}`}
                onClick={() => setBackground({ type: 'solid', color: c })}
                className="h-4 flex-1 rounded"
                style={{ background: c }}
              />
            ))}
          </div>
        )}
      </div>

      <Segments<ShotsBgType>
        options={[
          { id: 'wallpaper', label: 'Presets' },
          { id: 'gradient', label: 'Grad' },
          { id: 'mesh', label: 'Mesh' },
          { id: 'solid', label: 'Solid' },
          { id: 'image', label: 'Image' },
          { id: 'transparent', label: 'None' },
        ]}
        value={bg.type}
        onChange={(type) => setBackground({ type })}
      />

      {bg.type === 'wallpaper' && (
        <div className="grid grid-cols-4 gap-1.5">
          {WALLPAPERS.map((w) => (
            <button
              key={w.id}
              title={w.name}
              onClick={() => setBackground({ wallpaperId: w.id })}
              className={`h-9 rounded-md border-2 ${bg.wallpaperId === w.id ? 'border-(--tx)' : 'border-(--line)'}`}
              style={{ background: gradientCss(w.gradient) }}
            />
          ))}
        </div>
      )}

      {bg.type === 'gradient' && (
        <>
          <Segments
            options={[
              { id: 'linear', label: 'Linear' },
              { id: 'radial', label: 'Radial' },
            ]}
            value={bg.gradient.kind}
            onChange={(kind) => setBackground({ gradient: { ...bg.gradient, kind } })}
          />
          <ColorRow label="From" value={bg.gradient.from} onChange={(from) => setBackground({ gradient: { ...bg.gradient, from } })} />
          <ColorRow label="To" value={bg.gradient.to} onChange={(to) => setBackground({ gradient: { ...bg.gradient, to } })} />
          {bg.gradient.kind === 'linear' && (
            <SliderRow label="Angle" value={bg.gradient.angle} min={0} max={360} step={1} onChange={(angle) => setBackground({ gradient: { ...bg.gradient, angle } })} />
          )}
        </>
      )}

      {bg.type === 'mesh' && (
        <>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {MESH_PALETTES.map((colors, i) => (
              <button
                key={i}
                onClick={() => setBackground({ mesh: { ...bg.mesh, colors } })}
                className="h-6 w-9 rounded border border-(--line) bg-cover"
                style={{ backgroundImage: `url(${meshGradientDataURL(bg.mesh.seed, colors)})` }}
              />
            ))}
          </div>
          <MiniButton onClick={() => setBackground({ mesh: { ...bg.mesh, seed: Math.floor(Math.random() * 1e6) } })}>
            ↻ Randomize
          </MiniButton>
        </>
      )}

      {bg.type === 'solid' && (
        <ColorRow label="Color" value={bg.color} onChange={(color) => setBackground({ color })} />
      )}

      {bg.type === 'image' && (
        <MiniButton onClick={importBg}>
          <Upload {...subIcon} /> Upload background
        </MiniButton>
      )}

      {bg.type === 'transparent' ? (
        <p className="mt-3 border-t border-(--line) pt-3 text-[10px] text-(--tx3)">
          Exports with a real alpha channel — pick PNG or WebP (JPG has no transparency).
        </p>
      ) : (
        // blur/vignette/grain all paint the full frame, so they're meaningless
        // (and would fill the alpha) with no background
        <div className="mt-3 border-t border-(--line) pt-3">
          <SliderRow label="Blur" value={bg.blur} min={0} max={60} step={1} onChange={(blur) => setBackground({ blur })} />
          <SliderRow label="Bright" value={bg.brightness} min={0.4} max={1.8} onChange={(brightness) => setBackground({ brightness })} />
          <SliderRow label="Vignette" value={bg.vignette} min={0} max={1} onChange={(vignette) => setBackground({ vignette })} />
          <SliderRow label="Grain" value={bg.noise} min={0} max={1} onChange={(noise) => setBackground({ noise })} />
        </div>
      )}
    </Section>
  )
}

// ————— Image / composition —————

/** Thumbnail strip of every screen + add button (shots.so-style multi-screen). */
function ScreensStrip() {
  const images = useShots((s) => s.doc.images)
  const selectedId = useShots((s) => s.doc.selectedId)
  const assets = useShots((s) => s.assets)
  const selectImage = useShots((s) => s.selectImage)
  const importMedia = useShots((s) => s.importMedia)
  const atMax = images.length >= MAX_SHOTS

  return (
    <div className="mb-2">
      <p className="mb-1.5 text-[10px] text-(--tx2)">
        Screens <span className="text-(--tx3)">{images.length}/{MAX_SHOTS}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {images.map((im, i) => {
          const url = assets[im.assetId]?.url
          const active = im.id === selectedId
          return (
            <button
              key={im.id}
              title={`Screen ${i + 1}`}
              onClick={() => selectImage(im.id)}
              className={`relative h-12 w-10 overflow-hidden rounded-md border-2 bg-(--panel2) ${active ? 'border-(--tx)' : 'border-(--line) hover:border-(--line2)'}`}
            >
              {url ? (
                <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : null}
              <span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[8px] font-semibold text-white">
                {i + 1}
              </span>
            </button>
          )
        })}
        {!atMax && (
          <button
            title="Add screen"
            onClick={() => pickImage((f) => void importMedia(f))}
            className="flex h-12 w-10 items-center justify-center rounded-md border-2 border-dashed border-(--line) text-lg text-(--tx3) hover:border-(--tx3) hover:text-(--tx2)"
          >
            +
          </button>
        )}
      </div>
    </div>
  )
}

function ImageSection() {
  const img = useShots((s) => selectedShotsImage(s.doc))
  const hasScreens = useShots((s) => s.doc.images.length > 0)
  const setImage = useShots((s) => s.setImage)
  const importMedia = useShots((s) => s.importMedia)
  const importFromURL = useShots((s) => s.importMediaFromURL)

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

  if (!hasScreens || !img) {
    return (
      <Section title="Screens" icon={<Images {...secIcon} />}>
        <button
          onClick={() => pickImage((f) => void importMedia(f))}
          className="flex w-full flex-col items-center justify-center gap-1 rounded-[6px] border border-dashed border-(--line2) px-3 py-6 hover:bg-(--field)"
        >
          <Upload size={16} strokeWidth={1.75} className="text-(--tx2)" />
          <span className="text-[11px] text-(--tx2)">Drop a screenshot, or click to browse</span>
        </button>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <MiniButton onClick={() => pickImage((f) => void importMedia(f))}>
            <Upload {...subIcon} /> Upload
          </MiniButton>
          <MiniButton onClick={() => fromURL(false)} title="Load from URL">
            <Link2 {...subIcon} /> URL
          </MiniButton>
        </div>
      </Section>
    )
  }

  return (
    <Section title="Screens" icon={<Images {...secIcon} />}>
      <ScreensStrip />
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        <MiniButton onClick={() => pickImage((f) => void importMedia(f, undefined, { replace: true }))} title="Replace this screen">
          <ImageUp {...subIcon} /> Replace
        </MiniButton>
        <MiniButton onClick={() => fromURL(true)} title="Replace from URL">
          <Link2 {...subIcon} /> URL
        </MiniButton>
        <MiniButton onClick={() => useShots.getState().removeImage()} title="Remove this screen">
          <Trash2 {...subIcon} /> Remove
        </MiniButton>
      </div>
      <SliderRow icon={<SLIDER_ICON.padding />} label="Padding" value={img.padding} min={0} max={0.42} onChange={(padding) => setImage({ padding })} hint="Space around the shot (balance)" />
      <SliderRow icon={<SLIDER_ICON.scale />} label="Scale" value={img.scale} min={0.3} max={1.6} onChange={(scale) => setImage({ scale })} />
      <SliderRow icon={<SLIDER_ICON.offsetX />} label="Offset X" value={img.offsetX} min={-0.5} max={0.5} onChange={(offsetX) => setImage({ offsetX })} />
      <SliderRow icon={<SLIDER_ICON.offsetY />} label="Offset Y" value={img.offsetY} min={-0.5} max={0.5} onChange={(offsetY) => setImage({ offsetY })} />
      {img.device === 'none' && (
        <SliderRow icon={<SLIDER_ICON.radius />} label="Radius" value={img.radius} min={0} max={0.1} step={0.002} onChange={(radius) => setImage({ radius })} />
      )}
      <div className="mt-2 border-t border-(--line) pt-2">
        <SubHeading icon={<RotateCw {...subIcon} />}>Rotate</SubHeading>
        <SliderRow icon={<SLIDER_ICON.rotate />} label="Rotate" value={img.rotate} min={-45} max={45} step={0.5} onChange={(rotate) => setImage({ rotate })} />
      </div>
      <div className="mt-2 border-t border-(--line) pt-2">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[10px] text-(--tx2)">
            <Box {...subIcon} /> Tilt · 3D
          </p>
          <Segments<'flat' | '3d'>
            options={[
              { id: 'flat', label: 'Flat' },
              { id: '3d', label: '3D' },
            ]}
            value={img.style3d ? '3d' : 'flat'}
            onChange={(v) =>
              // device bezels can't tilt (flat placeholders) — 3D drops the device
              setImage(v === '3d' ? { style3d: true, device: 'none' } : { style3d: false })
            }
          />
        </div>
        {img.style3d ? (
          <>
            <SliderRow icon={<SLIDER_ICON.tiltX />} label="Tilt X" value={img.rotateX} min={-45} max={45} step={0.5} onChange={(rotateX) => setImage({ rotateX })} hint="Pseudo-3D pitch" />
            <SliderRow icon={<SLIDER_ICON.tiltY />} label="Tilt Y" value={img.rotateY} min={-45} max={45} step={0.5} onChange={(rotateY) => setImage({ rotateY })} hint="Pseudo-3D yaw" />
            <div className="mt-1 text-right">
              <MiniButton onClick={() => setImage({ rotateX: 0, rotateY: 0 })}>Flatten</MiniButton>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-(--line) bg-(--panel2) px-3 py-4 text-center">
            <span className="text-[11px] font-medium text-(--tx2)">3D style required</span>
            <span className="text-[10px] text-(--tx3)">Tilt works with the 3D style only</span>
            <button
              onClick={() => setImage({ style3d: true, device: 'none' })}
              className="mt-1 rounded-md bg-(--accent-fill) px-3 py-1.5 text-[11px] font-semibold text-(--accent-tx) transition-opacity hover:opacity-90"
            >
              Switch to 3D
            </button>
          </div>
        )}
      </div>
    </Section>
  )
}

// ————— Mockup (device) picker: category tabs + device cards —————

/** Tab order and glyph per category, mirroring mainstream mockup tools. */
const DEVICE_TABS: { id: DeviceCategory | 'all'; label: string; icon: LucideIcon }[] = [
  { id: 'all', label: 'All', icon: LayoutGrid },
  { id: 'phone', label: 'Phone', icon: Smartphone },
  { id: 'tablet', label: 'Tablet', icon: Tablet },
  { id: 'laptop', label: 'Laptop', icon: Laptop },
  { id: 'desktop', label: 'Desktop', icon: Monitor },
  { id: 'watch', label: 'Wearable', icon: Watch },
]

/** Scaled-down silhouette of a device, used as the card thumbnail. */
function DeviceThumb({ device }: { device: DeviceSpec }) {
  const box = 54
  const aspect = device.screen ? device.screen.w / device.screen.h : 0.62
  const h = aspect >= 1 ? box / aspect : box
  const w = aspect >= 1 ? box : box * aspect
  if (device.id === 'none') {
    return (
      <span
        style={{ width: w, height: h, borderRadius: 6 }}
        className="border border-dashed border-(--tx3)"
      />
    )
  }
  return (
    <span
      style={{
        width: w,
        height: h,
        background: device.color,
        borderRadius: Math.max(3, device.outerRadius * w),
        boxShadow: `inset 0 0 0 1px ${device.edge}`,
      }}
    />
  )
}

function MockupSection() {
  const img = useShots((s) => selectedShotsImage(s.doc))
  const setImage = useShots((s) => s.setImage)
  const [tab, setTab] = useState<DeviceCategory | 'all'>('all')
  if (!img) return null

  // Temporary bezels are flat placeholders that can't tilt — no devices in 3D.
  const locked = img.style3d
  const current = DEVICES.find((d) => d.id === img.device) ?? DEVICES[0]
  // "No device" always stays reachable, whichever category is filtered
  const shown = DEVICES.filter((d) => d.id === 'none' || tab === 'all' || d.category === tab)

  return (
    <Section
      title="Mockup"
      icon={<Smartphone {...secIcon} />}
      badge={current.id === 'none' ? undefined : current.label}
    >
      {locked && (
        <p className="mb-2 text-[10px] text-(--tx3)">
          Mockups are unavailable in 3D style — switch to Flat to use one.
        </p>
      )}

      <div className="mb-2 flex flex-wrap gap-1">
        {DEVICE_TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.label}
              aria-pressed={active}
              className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] transition-colors ${
                active
                  ? 'bg-(--sel) text-(--tx)'
                  : 'bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
              }`}
            >
              <t.icon {...subIcon} />
              {active && t.label}
            </button>
          )
        })}
      </div>

      <div className={`grid grid-cols-2 gap-1.5 ${locked ? 'pointer-events-none opacity-40' : ''}`}>
        {shown.map((d) => {
          const active = img.device === d.id
          return (
            <button
              key={d.id}
              disabled={locked}
              onClick={() => setImage({ device: d.id })}
              className={`flex flex-col gap-1 rounded-[6px] p-2 text-left transition-colors ${
                active ? 'bg-(--accent-soft) ring-1 ring-(--accent)' : 'bg-(--field) hover:bg-(--field-h)'
              }`}
            >
              <span className={`text-[11px] ${active ? 'text-(--accent)' : 'text-(--tx)'}`}>{d.label}</span>
              <span className="text-[9px] text-(--tx3) tabular-nums">
                {d.screen ? `${d.screen.w} / ${d.screen.h}` : 'bare screen'}
              </span>
              <span className="flex h-[58px] items-center justify-center">
                <DeviceThumb device={d} />
              </span>
            </button>
          )
        })}
      </div>
    </Section>
  )
}

// ————— Window chrome (the bar drawn on top of the screenshot) —————

const FRAMES: { id: ShotsFrame; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'macos-light', label: 'macOS Light' },
  { id: 'macos-dark', label: 'macOS Dark' },
  { id: 'browser-light', label: 'Browser Light' },
  { id: 'browser-dark', label: 'Browser Dark' },
]

function WindowChromeSection() {
  const img = useShots((s) => selectedShotsImage(s.doc))
  const setImage = useShots((s) => s.setImage)
  if (!img) return null
  return (
    <Section title="Window chrome" icon={<AppWindow {...secIcon} />} defaultOpen={false}>
      <div className="grid grid-cols-1 gap-1">
        {FRAMES.map((fr) => (
          <MiniButton key={fr.id} active={img.frame === fr.id} onClick={() => setImage({ frame: fr.id })}>
            {fr.label}
          </MiniButton>
        ))}
      </div>
    </Section>
  )
}

// ————— Shadow / glow / border / reflection —————

function EffectsSection() {
  const img = useShots((s) => selectedShotsImage(s.doc))
  const setImage = useShots((s) => s.setImage)
  const setShadow = useShots((s) => s.setShadow)
  const setBorder = useShots((s) => s.setBorder)
  const setGlow = useShots((s) => s.setGlow)
  if (!img) return null
  return (
    <Section title="Shadow · Glow · Border" icon={<Blend {...secIcon} />} defaultOpen={false}>
      <SubHeading icon={<SquareDashedBottom {...subIcon} />}>Shadow</SubHeading>
      <SliderRow label="Blur" value={img.shadow.blur} min={0} max={0.2} step={0.002} onChange={(blur) => setShadow({ blur })} />
      <SliderRow label="Opacity" value={img.shadow.opacity} min={0} max={1} onChange={(opacity) => setShadow({ opacity })} />
      <SliderRow label="Offset Y" value={img.shadow.y} min={-0.1} max={0.15} step={0.002} onChange={(y) => setShadow({ y })} />
      <SliderRow label="Offset X" value={img.shadow.x} min={-0.1} max={0.1} step={0.002} onChange={(x) => setShadow({ x })} />
      <ColorRow label="Color" value={img.shadow.color} onChange={(color) => setShadow({ color })} />

      <div className="mt-3 border-t border-(--line) pt-3">
        <SubHeading icon={<Sparkles {...subIcon} />}>Glow</SubHeading>
        <SliderRow label="Strength" value={img.glow.strength} min={0} max={1} onChange={(strength) => setGlow({ strength })} />
        <ColorRow label="Color" value={img.glow.color} onChange={(color) => setGlow({ color })} />
      </div>

      <div className="mt-3 border-t border-(--line) pt-3">
        <SubHeading icon={<Square {...subIcon} />}>Border</SubHeading>
        <SliderRow label="Width" value={img.border.width} min={0} max={20} step={0.5} onChange={(width) => setBorder({ width })} />
        <ColorRow label="Color" value={img.border.color} onChange={(color) => setBorder({ color })} />
      </div>

      <div className="mt-3 border-t border-(--line) pt-3">
        <SliderRow label="Reflection" value={img.reflection} min={0} max={1} onChange={(reflection) => setImage({ reflection })} />
      </div>
    </Section>
  )
}

// ————— Frame: the canvas the shot is composed on (size + aspect) —————

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

function FrameSection() {
  const size = useShots((s) => s.doc.size)
  const setSize = useShots((s) => s.setSize)
  const [w, setW] = useState(size.width)
  const [h, setH] = useState(size.height)

  // keep the fields in step when a preset or ratio changes the doc
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
    'h-7 w-full rounded-[5px] bg-(--field) px-2 text-[11px] text-(--tx) tabular-nums outline-none hover:bg-(--field-h) focus:ring-1 focus:ring-(--accent)'

  return (
    <Section
      title="Frame"
      icon={<Ratio {...secIcon} />}
      badge={`${size.width}×${size.height}`}
      defaultOpen={false}
    >
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <label className="flex items-center gap-1.5">
          <span className="text-[10px] text-(--tx3)">W</span>
          <input
            type="number"
            value={w}
            onChange={(e) => setW(Number(e.target.value))}
            onBlur={() => apply(w, h)}
            onKeyDown={(e) => e.key === 'Enter' && apply(w, h)}
            className={field}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-[10px] text-(--tx3)">H</span>
          <input
            type="number"
            value={h}
            onChange={(e) => setH(Number(e.target.value))}
            onBlur={() => apply(w, h)}
            onKeyDown={(e) => e.key === 'Enter' && apply(w, h)}
            className={field}
          />
        </label>
      </div>

      <SubHeading>Aspect ratio</SubHeading>
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {RATIOS.map((r) => {
          const active = Math.abs(ratioOf - r.w / r.h) < 0.01
          // proportional swatch inside a fixed 44px box
          const box = 40
          const tw = r.w >= r.h ? box : box * (r.w / r.h)
          const th = r.w >= r.h ? box * (r.h / r.w) : box
          return (
            <button
              key={r.label}
              onClick={() => applyRatio(r.w, r.h)}
              className={`flex flex-col items-center gap-1 rounded-[6px] py-2 transition-colors ${
                active ? 'bg-(--accent-soft)' : 'hover:bg-(--field)'
              }`}
            >
              <span className="flex h-11 items-center justify-center">
                <span
                  style={{ width: tw, height: th }}
                  className={`rounded-[4px] ${active ? 'bg-(--accent)' : 'bg-(--sel)'}`}
                />
              </span>
              <span className={`text-[10px] ${active ? 'text-(--accent)' : 'text-(--tx2)'}`}>
                {r.label}
              </span>
            </button>
          )
        })}
      </div>

      <SubHeading>Presets</SubHeading>
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
    </Section>
  )
}

export function ShotsInspector() {
  return (
    <>
      <ImageSection />
      <MockupSection />
      <BackgroundSection />
      <WindowChromeSection />
      <EffectsSection />
      <FrameSection />
    </>
  )
}
