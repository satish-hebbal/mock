import { useEffect, useState } from 'react'
import { pickMediaFile, useStudio } from '../store'
import { ColorRow, Dropdown, MiniButton, Section, Segments, SliderRow, SubHeading } from './controls'
import {
  ArrowLeftRight,
  Box,
  Camera,
  CircleMinus,
  Crop,
  Disc,
  FileImage,
  Image,
  Link2,
  Move3d,
  Palette,
  Sparkles,
  Sun,
  Type,
  Unlink,
} from 'lucide-react'
import { focalFromFov } from '../lib/studio'
import { OVERLAY_FONTS, ratioLabel } from '../lib/presets'
import { getDevice } from '../lib/registry'
import { ui } from '../lib/ui'
import type { BackgroundType } from '../types'

/** Glyphs for section headers and sub-headings. */
const secIcon = { size: 13, strokeWidth: 1.75 } as const
const subIcon = { size: 11, strokeWidth: 1.75 } as const

/** Backdrop names, so the Scene section can name what the toolbar picked. */
const BG_LABEL: Record<BackgroundType, string> = {
  solid: 'Solid color',
  gradient: 'Gradient',
  mesh: 'Mesh gradient',
  image: 'Image',
  studio: 'Studio sweep',
  transparent: 'Transparent',
}

/** What a key-to-fill ratio reads as, in the language of the setup. */
function ratioNote(key: number, fill: number): string {
  const r = fill <= 0.02 ? Infinity : key / fill
  if (!Number.isFinite(r)) return 'unfilled — single-source drama'
  if (r >= 6) return `${r.toFixed(1)}:1 — hard, dramatic`
  if (r >= 2.6) return `${r.toFixed(1)}:1 — natural contrast`
  if (r >= 1.8) return `${r.toFixed(1)}:1 — soft, flattering`
  return `${r.toFixed(1)}:1 — near shadowless`
}

// ————— Frame —————

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
        if (e.key === 'Escape') setDraft(String(value))
      }}
      className="h-7 w-full min-w-0 rounded-[5px] bg-(--field) px-2 text-[11px] text-(--tx) tabular-nums outline-none focus:ring-1 focus:ring-(--accent)"
    />
  )
}

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
    <Section title="Frame" icon={<Crop {...secIcon} />} defaultOpen={false}>
      <div className="flex items-center gap-1.5">
        <NumField value={size.width} onCommit={setWidth} label="Frame width" />
        <span className="text-[11px] text-(--tx3)">×</span>
        <NumField value={size.height} onCommit={setHeight} label="Frame height" />
        <MiniButton
          active={linked}
          title={linked ? 'Ratio locked — editing one side moves the other' : 'Lock the ratio'}
          onClick={() => setLinked(!linked)}
        >
          {linked ? <Link2 {...subIcon} /> : <Unlink {...subIcon} />}
        </MiniButton>
        <MiniButton title="Swap width and height" onClick={() => setExportSize(size.height, size.width)}>
          <ArrowLeftRight {...subIcon} />
        </MiniButton>
      </div>
      <p className="mt-1.5 text-[10px] text-(--tx3)">
        {ratioLabel(size.width, size.height)} · this is the picture you export. Ratios and platform
        sizes are in the toolbar above.
      </p>
    </Section>
  )
}

// ————— Source —————

function SourceSection() {
  const selectedDeviceId = useStudio((s) => s.selectedDeviceId)
  const device = useStudio(
    (s) =>
      s.project.scene.devices.find((d) => d.id === s.selectedDeviceId) ?? s.project.scene.devices[0],
  )
  const asset = useStudio((s) =>
    device?.screen.assetId ? s.assets[device.screen.assetId] : undefined,
  )
  const importMedia = useStudio((s) => s.importMedia)
  const importMediaFromURL = useStudio((s) => s.importMediaFromURL)
  const updateDeviceScreen = useStudio((s) => s.updateDeviceScreen)

  const fromURL = async () => {
    const url = await ui.prompt({
      title: 'Load from URL',
      label: 'Paste an image or video URL. It must allow cross-origin requests.',
      placeholder: 'https://…',
    })
    if (!url) return
    try {
      await importMediaFromURL(url)
    } catch (err) {
      ui.error(`Couldn't load that URL: ${(err as Error).message}`)
    }
  }

  return (
    <Section title="Source" icon={<FileImage {...secIcon} />}>
      <button
        onClick={() => pickMediaFile((f) => void importMedia(f))}
        className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-(--line) bg-(--panel2) px-3 py-5 transition-colors hover:border-(--tx3)"
      >
        {asset ? (
          asset.kind === 'video' ? (
            <video src={asset.url} muted loop autoPlay playsInline className="max-h-24 rounded-md" />
          ) : (
            <img src={asset.url} alt="Screen media" className="max-h-24 rounded-md object-contain" />
          )
        ) : (
          <>
            <span className="text-[11px] font-medium tracking-[0.14em] text-(--tx2) uppercase">
              Click to upload
            </span>
            <span className="text-[9px] tracking-[0.1em] text-(--tx3) uppercase">
              image or video · drag & drop or paste
            </span>
          </>
        )}
      </button>
      <div className="mt-1.5 flex gap-1">
        <MiniButton onClick={() => pickMediaFile((f) => void importMedia(f))}>Upload…</MiniButton>
        <MiniButton onClick={fromURL}>From URL…</MiniButton>
      </div>
      {device && asset && (
        <>
          <div className="mt-2 flex gap-1">
            <MiniButton
              active={device.screen.fit === 'cover'}
              onClick={() => updateDeviceScreen(device.id, { fit: 'cover' })}
            >
              Cover
            </MiniButton>
            <MiniButton
              active={device.screen.fit === 'contain'}
              onClick={() => updateDeviceScreen(device.id, { fit: 'contain' })}
            >
              Contain
            </MiniButton>
          </div>
          <div className="mt-1">
            <SliderRow
              label="Scroll"
              value={device.screen.scroll}
              min={0}
              max={1}
              target={`dev.${device.id}.scroll`}
              onChange={(v) => useStudio.getState().setAnimatable(`dev.${device.id}.scroll`, v)}
              hint="Scroll tall screenshots inside the screen (animatable)"
            />
          </div>
        </>
      )}
      {selectedDeviceId === null && (
        <p className="mt-2 text-[10px] text-(--tx3)">Media binds to the selected device.</p>
      )}
    </Section>
  )
}

// ————— Camera —————

function CameraSection() {
  const cam = useStudio((s) => s.project.scene.camera)
  const setAnimatable = useStudio((s) => s.setAnimatable)

  const row = (
    prop: keyof typeof cam,
    label: string,
    min: number,
    max: number,
    step = 0.1,
    hint?: string,
    format?: (v: number) => string,
  ) => (
    <SliderRow
      label={label}
      value={cam[prop]}
      min={min}
      max={max}
      step={step}
      target={`camera.${prop}`}
      onChange={(v) => setAnimatable(`camera.${prop}`, v, `cam-${prop}`)}
      hint={hint}
      format={format}
    />
  )

  return (
    <Section title="Camera" icon={<Camera {...secIcon} />}>
      {row('tiltX', 'Tilt X', -88, 88, 0.5, 'DRAG')}
      {row('tiltY', 'Tilt Y', -180, 180, 0.5, 'DRAG')}
      {row('roll', 'Roll', -45, 45, 0.5)}
      {row(
        'fov',
        'Lens',
        8,
        90,
        0.5,
        // product work lives around 50–100mm: long enough not to distort
        'Field of view, shown as its 35mm-equivalent focal length',
        (v) => `${focalFromFov(v)}mm`,
      )}
      {row('zoom', 'Zoom', 0.3, 8, 0.01, 'SCROLL')}
      {row('panX', 'Pan X', -3, 3, 0.01, 'R-DRAG')}
      {row('panY', 'Pan Y', -3, 3, 0.01, 'R-DRAG')}
      {row('rotateY', 'Rotate Y', -180, 180, 0.5)}
      {row('rotateX', 'Rotate X', -90, 90, 0.5)}
    </Section>
  )
}


// ————— Scene (background / environment / ground) —————

function SceneSection() {
  const bg = useStudio((s) => s.project.scene.background)
  const env = useStudio((s) => s.project.scene.environment)
  const ground = useStudio((s) => s.project.scene.ground)
  const setBackground = useStudio((s) => s.setBackground)
  const setSweep = useStudio((s) => s.setSweep)
  const setEnvironment = useStudio((s) => s.setEnvironment)
  const setGround = useStudio((s) => s.setGround)

  return (
    <Section title="Scene" icon={<Image {...secIcon} />}>
      {/* the backdrop is *chosen* in the toolbar; this section tunes the choice */}
      <p className="mb-2 text-[10px] text-(--tx3)">
        Backdrop: <span className="text-(--tx2)">{BG_LABEL[bg.type]}</span> — swap it from the
        toolbar above.
      </p>

      {bg.type === 'solid' && (
        <ColorRow label="Color" value={bg.color} onChange={(color) => setBackground({ color })} />
      )}

      {bg.type === 'gradient' && (
        <>
          <ColorRow
            label="From"
            value={bg.gradient.from}
            onChange={(from) => setBackground({ gradient: { ...bg.gradient, from } })}
          />
          <ColorRow
            label="To"
            value={bg.gradient.to}
            onChange={(to) => setBackground({ gradient: { ...bg.gradient, to } })}
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
        </>
      )}

      {bg.type === 'mesh' && (
        <SliderRow
          label="Blur"
          value={bg.blur}
          min={0}
          max={60}
          step={1}
          onChange={(blur) => setBackground({ blur })}
        />
      )}

      {bg.type === 'image' && (
        <>
          <SliderRow label="Blur" value={bg.blur} min={0} max={60} step={1} onChange={(blur) => setBackground({ blur })} />
          <SliderRow
            label="Bright"
            value={bg.brightness}
            min={0.2}
            max={2}
            onChange={(brightness) => setBackground({ brightness })}
          />
        </>
      )}

      {bg.type === 'studio' && (
        <>
          <ColorRow label="Paper" value={bg.sweep.color} onChange={(color) => setSweep({ color })} />
          <ColorRow label="Hotspot" value={bg.sweep.hot} onChange={(hot) => setSweep({ hot })} />
          <SliderRow
            label="Hot height"
            value={bg.sweep.hotY}
            min={0.1}
            max={0.8}
            onChange={(hotY) => setSweep({ hotY })}
            hint="Where the key hits the paper — keep it just behind the product"
          />
          <SliderRow label="Spread" value={bg.sweep.spread} min={0.2} max={1.2} onChange={(spread) => setSweep({ spread })} />
          <SliderRow label="Floor" value={bg.sweep.floor} min={0} max={0.9} onChange={(floor) => setSweep({ floor })} hint="Falloff toward the bottom of the sweep" />
          <SliderRow label="Vignette" value={bg.sweep.vignette} min={0} max={0.8} onChange={(vignette) => setSweep({ vignette })} />
        </>
      )}

      {bg.type === 'transparent' && (
        <p className="text-[10px] text-(--tx3)">
          Exports with a true alpha channel (PNG / WebM-alpha).
        </p>
      )}

      <div className="mt-3 border-t border-(--line) pt-3">
        <SubHeading icon={<Sun {...subIcon} />}>Lighting</SubHeading>
        <SliderRow label="Key" value={env.keyIntensity} min={0} max={4} onChange={(keyIntensity) => setEnvironment({ keyIntensity })} hint="Main lamp — defines the form" />
        <SliderRow label="Fill" value={env.fillIntensity} min={0} max={3} onChange={(fillIntensity) => setEnvironment({ fillIntensity })} hint="Opens the shadows the key casts" />
        <SliderRow label="Rim" value={env.rimIntensity} min={0} max={3} onChange={(rimIntensity) => setEnvironment({ rimIntensity })} hint="Behind the subject — peels it off the backdrop" />
        <SliderRow label="Ambient" value={env.ambient} min={0} max={2} onChange={(ambient) => setEnvironment({ ambient })} />
        <p className="mt-1 mb-2 pl-5 text-[10px] text-(--tx3)">
          Key-to-fill {ratioNote(env.keyIntensity, env.fillIntensity)}
        </p>

        <SubHeading icon={<Move3d {...subIcon} />}>Key placement</SubHeading>
        <SliderRow
          label="Angle"
          value={env.keyAzimuth}
          min={-90}
          max={90}
          step={1}
          format={(v) => `${v.toFixed(0)}°`}
          onChange={(keyAzimuth) => setEnvironment({ keyAzimuth })}
          hint="Degrees off the lens axis — 45° is the workhorse, 15–70° the useful range"
        />
        <SliderRow
          label="Height"
          value={env.keyElevation}
          min={0}
          max={85}
          step={1}
          format={(v) => `${v.toFixed(0)}°`}
          onChange={(keyElevation) => setEnvironment({ keyElevation })}
          hint="Elevation above the product, angled down"
        />
        <SliderRow
          label="Softness"
          value={env.softness}
          min={0}
          max={1}
          onChange={(softness) => setEnvironment({ softness })}
          hint="Apparent source size: bare bulb → big softbox"
        />
        <SliderRow
          label="Warmth"
          value={env.temperature}
          min={-1}
          max={1}
          onChange={(temperature) => setEnvironment({ temperature })}
          hint="Cool strobe ↔ tungsten warm"
        />
        <SliderRow
          label="Reflections"
          value={env.reflection}
          min={0}
          max={2}
          onChange={(reflection) => setEnvironment({ reflection })}
          hint="How strongly the softboxes show up in glossy surfaces"
        />
        <SliderRow
          label="Bounce"
          value={env.bounce}
          min={0}
          max={1}
          onChange={(bounce) => setEnvironment({ bounce })}
          hint="White card under the product, lifting its underside"
        />
      </div>

      <div className="mt-3 border-t border-(--line) pt-3">
        <SubHeading icon={<Disc {...subIcon} />}>Ground shadow</SubHeading>
        <div className="mb-1">
          <MiniButton active={ground.shadow} onClick={() => setGround({ shadow: !ground.shadow })}>
            {ground.shadow ? 'On' : 'Off'}
          </MiniButton>
        </div>
        {ground.shadow && (
          <>
            <SliderRow label="Opacity" value={ground.shadowOpacity} min={0} max={1} onChange={(shadowOpacity) => setGround({ shadowOpacity })} />
            <SliderRow label="Soft" value={ground.shadowBlur} min={0.2} max={6} onChange={(shadowBlur) => setGround({ shadowBlur })} />
          </>
        )}
      </div>
    </Section>
  )
}

// ————— Effects —————

function EffectsSection() {
  const fx = useStudio((s) => s.project.scene.effects)
  const setEffects = useStudio((s) => s.setEffects)
  const setGrade = useStudio((s) => s.setGrade)
  const g = fx.grade
  return (
    <Section title="Effects" icon={<Sparkles {...secIcon} />} defaultOpen={false}>
      <SliderRow label="Bloom" value={fx.bloom} min={0} max={1} onChange={(bloom) => setEffects({ bloom })} />
      <SliderRow label="Grain" value={fx.noise} min={0} max={1} onChange={(noise) => setEffects({ noise })} />
      <SliderRow label="Vignette" value={fx.vignette} min={0} max={1} onChange={(vignette) => setEffects({ vignette })} />
      <SliderRow label="Fringe" value={fx.chromatic} min={0} max={1} onChange={(chromatic) => setEffects({ chromatic })} hint="Chromatic aberration" />

      <div className="mt-3 border-t border-(--line) pt-3">
        <div className="mb-1 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[10px] text-(--tx2)">
            <Palette {...subIcon} /> Color grade
          </p>
          <MiniButton
            onClick={() => setGrade({ exposure: 1, contrast: 1, saturation: 1, temperature: 0 })}
          >
            Reset
          </MiniButton>
        </div>
        <SliderRow label="Exposure" value={g.exposure} min={0.4} max={1.8} onChange={(exposure) => setGrade({ exposure })} />
        <SliderRow label="Contrast" value={g.contrast} min={0.5} max={1.8} onChange={(contrast) => setGrade({ contrast })} />
        <SliderRow label="Saturate" value={g.saturation} min={0} max={2} onChange={(saturation) => setGrade({ saturation })} />
        <SliderRow label="Temp" value={g.temperature} min={-1} max={1} onChange={(temperature) => setGrade({ temperature })} hint="Warm ↔ cool" />
      </div>
    </Section>
  )
}

// ————— Devices —————

function DevicesSection() {
  const devices = useStudio((s) => s.project.scene.devices)
  const selectedId = useStudio((s) => s.selectedDeviceId)
  const st = useStudio.getState

  const selected = devices.find((d) => d.id === selectedId) ?? devices[0]
  const spec = selected ? getDevice(selected.modelId) : null

  return (
    <Section title="3D Devices" icon={<Box {...secIcon} />}>
      {/* which device these controls edit — adding, arranging and removing live
          in the toolbar, so this is a selector rather than a manager */}
      {devices.length > 1 && selected && (
        <div className="mb-2">
          <Dropdown
            title="Device being edited"
            value={selected.id}
            onChange={(id) => st().selectDevice(id)}
            options={devices.map((d, i) => ({
              value: d.id,
              label: `${i + 1} · ${getDevice(d.modelId).name}`,
            }))}
          />
        </div>
      )}

      {selected && spec && (
        <div>
          {/* the dropdown above already names the device when there's more than one */}
          {devices.length === 1 && (
            <p className="mb-1 text-[9px] font-semibold tracking-[0.18em] text-(--tx3) uppercase">
              {spec.name}
            </p>
          )}
          {spec.colors.length > 1 && (
            <div className="mb-2 flex gap-1.5">
              {spec.colors.map((c) => (
                <button
                  key={c.id}
                  title={c.name}
                  onClick={() => st().updateDevice(selected.id, { colorVariant: c.id })}
                  className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                    selected.colorVariant === c.id ? 'border-(--tx)' : 'border-(--line)'
                  }`}
                  style={{ background: c.value }}
                />
              ))}
            </div>
          )}
          {spec.canRotate && (
            <div className="mb-2">
              <Segments
                options={[
                  { id: 'portrait', label: 'Portrait' },
                  { id: 'landscape', label: 'Landscape' },
                ]}
                value={selected.orientation}
                onChange={(orientation) => st().updateDevice(selected.id, { orientation })}
              />
            </div>
          )}
          <DeviceTransformRows deviceId={selected.id} />
        </div>
      )}
    </Section>
  )
}

function DeviceTransformRows({ deviceId }: { deviceId: string }) {
  const dev = useStudio((s) => s.project.scene.devices.find((d) => d.id === deviceId))
  const setAnimatable = useStudio((s) => s.setAnimatable)
  if (!dev) return null
  const p = `dev.${deviceId}`
  const row = (label: string, path: string, value: number, min: number, max: number, step = 0.01) => (
    <SliderRow
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      target={`${p}.${path}`}
      onChange={(v) => setAnimatable(`${p}.${path}`, v, `dev-${path}`)}
    />
  )
  return (
    <div>
      {row('Pos X', 'posX', dev.transform.position[0], -4, 4)}
      {row('Pos Y', 'posY', dev.transform.position[1], -4, 4)}
      {row('Pos Z', 'posZ', dev.transform.position[2], -4, 4)}
      {row('Rot X', 'rotX', dev.transform.rotation[0], -180, 180, 0.5)}
      {row('Rot Y', 'rotY', dev.transform.rotation[1], -180, 180, 0.5)}
      {row('Rot Z', 'rotZ', dev.transform.rotation[2], -180, 180, 0.5)}
      {row('Scale', 'scale', dev.transform.scale, 0.2, 3)}
    </div>
  )
}

// ————— Overlays —————

function OverlaysSection() {
  const overlays = useStudio((s) => s.project.overlays)
  const selectedId = useStudio((s) => s.selectedOverlayId)
  const st = useStudio.getState
  const selected = overlays.find((o) => o.id === selectedId)

  return (
    <Section title="Text · Logo · Shapes" icon={<Type {...secIcon} />} defaultOpen={false}>
      {overlays.length === 0 && (
        <p className="text-[10px] text-(--tx3)">
          Add text, a shape or a logo from the toolbar above — they'll show up here to edit.
        </p>
      )}
      {overlays.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {overlays.map((o) => (
            <div
              key={o.id}
              onClick={() => st().selectOverlay(o.id)}
              className={`flex cursor-pointer items-center justify-between rounded border px-2 py-1 ${
                o.id === selectedId ? 'border-(--line2) bg-(--panel3)' : 'border-(--line)'
              }`}
            >
              <span className="max-w-40 truncate text-[11px] text-(--tx)">
                {o.type === 'text' ? `T · ${o.text}` : o.type === 'shape' ? `▢ · ${o.shape}` : '🖼 · logo'}
              </span>
              <button
                title="Remove layer"
                aria-label="Remove layer"
                className="text-(--tx3) hover:text-(--danger)"
                onClick={(e) => {
                  e.stopPropagation()
                  st().removeOverlay(o.id)
                }}
              >
                <CircleMinus size={13} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <div className="border-t border-(--line) pt-2">
          {selected.type === 'text' && (
            <>
              <textarea
                value={selected.text}
                onChange={(e) => st().updateOverlay(selected.id, { text: e.target.value })}
                rows={2}
                className="mb-1 w-full rounded border border-(--line) bg-transparent px-2 py-1 text-[12px] text-(--tx)"
              />
              <div className="mb-1 flex items-center gap-2">
                <Dropdown
                  className="flex-1"
                  value={selected.font}
                  onChange={(font) => st().updateOverlay(selected.id, { font })}
                  options={OVERLAY_FONTS.map((f) => ({ value: f, label: f }))}
                />
                <Dropdown
                  className="w-20"
                  align="right"
                  title="Font weight"
                  value={selected.weight}
                  onChange={(weight) => st().updateOverlay(selected.id, { weight })}
                  options={[400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))}
                />
              </div>
              <SliderRow
                label="Size"
                value={selected.size}
                min={0.015}
                max={0.2}
                step={0.001}
                onChange={(size) => st().updateOverlay(selected.id, { size })}
              />
              <ColorRow label="Color" value={selected.color} onChange={(color) => st().updateOverlay(selected.id, { color })} />
              <div className="flex items-center justify-between gap-2 py-1">
                <span className="text-[11px] text-(--tx2)">Pill bg</span>
                <span className="flex items-center gap-1">
                  <MiniButton
                    active={!!selected.bg}
                    onClick={() => st().updateOverlay(selected.id, { bg: selected.bg ? null : '#111827' })}
                  >
                    {selected.bg ? 'On' : 'Off'}
                  </MiniButton>
                  {selected.bg && (
                    <input
                      type="color"
                      value={selected.bg}
                      onChange={(e) => st().updateOverlay(selected.id, { bg: e.target.value })}
                      className="h-6 w-8 cursor-pointer rounded border border-(--line) bg-transparent"
                    />
                  )}
                </span>
              </div>
            </>
          )}
          {selected.type === 'shape' && (
            <>
              <Segments
                options={[
                  { id: 'rect', label: 'Rect' },
                  { id: 'ellipse', label: 'Ellipse' },
                ]}
                value={selected.shape}
                onChange={(shape) => st().updateOverlay(selected.id, { shape })}
              />
              <SliderRow label="Width" value={selected.width} min={0.02} max={1} onChange={(width) => st().updateOverlay(selected.id, { width })} />
              <SliderRow label="Height" value={selected.height} min={0.02} max={1} onChange={(height) => st().updateOverlay(selected.id, { height })} />
              {selected.shape === 'rect' && (
                <SliderRow label="Radius" value={selected.radius} min={0} max={0.2} step={0.005} onChange={(radius) => st().updateOverlay(selected.id, { radius })} />
              )}
              <ColorRow label="Color" value={selected.color} onChange={(color) => st().updateOverlay(selected.id, { color })} />
            </>
          )}
          {selected.type === 'image' && (
            <SliderRow label="Width" value={selected.width} min={0.03} max={1} onChange={(width) => st().updateOverlay(selected.id, { width })} />
          )}
          <SliderRow label="Opacity" value={selected.opacity} min={0} max={1} onChange={(opacity) => st().updateOverlay(selected.id, { opacity })} />
          <SliderRow label="Rotate" value={selected.rotation} min={-180} max={180} step={1} onChange={(rotation) => st().updateOverlay(selected.id, { rotation })} />
        </div>
      )}
    </Section>
  )
}

// ————— assembled inspector —————

export function Inspector() {
  return (
    <>
      <FrameSection />
      <SourceSection />
      <CameraSection />
      <SceneSection />
      <EffectsSection />
      <DevicesSection />
      <OverlaysSection />
    </>
  )
}
