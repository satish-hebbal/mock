import { useState } from 'react'
import { MAX_SCREEN_MEDIA, pickMediaFile, screenMedia, useStudio } from '../store'
import { ColorRow, Disclosure, Dropdown, MiniButton, Section, Segments, SliderRow, SubHeading } from './controls'
import {
  Box,
  Camera,
  CircleMinus,
  CloudSun,
  Disc,
  Globe,
  Image,
  Images,
  Link,
  Move3d,
  Palette,
  Plus,
  Sparkles,
  Sun,
  Type,
  X,
} from 'lucide-react'
import { focalFromFov, keyColor } from '../lib/studio'
import { getMood } from '../lib/moods'
import { OVERLAY_FONTS } from '../lib/presets'
import { getDevice } from '../lib/registry'
import { CAMERA_LIMITS } from '../lib/camera'
import { ui } from '../lib/ui'
import type { AssetRuntime, BackgroundType } from '../types'

/** Glyphs for section headers and sub-headings. */
const secIcon = { size: 13, strokeWidth: 1.75 } as const
const subIcon = { size: 11, strokeWidth: 1.75 } as const

/** Backdrop names, so the Scene section can name what the toolbar picked. */
const BG_LABEL: Record<BackgroundType, string> = {
  studio: 'Studio sweep',
  solid: 'Solid color',
  gradient: 'Gradient',
  wallpaper: 'Gradient preset',
  mesh: 'Mesh gradient',
  photo: 'Photo',
  image: 'Image',
  transparent: 'Transparent',
}

/** What a key-to-fill ratio reads as, in the language of the setup. */
function ratioNote(key: number, fill: number): string {
  const r = fill <= 0.02 ? Infinity : key / fill
  if (!Number.isFinite(r)) return 'unfilled (single-source drama)'
  if (r >= 6) return `${r.toFixed(1)}:1 (hard, dramatic)`
  if (r >= 2.6) return `${r.toFixed(1)}:1 (natural contrast)`
  if (r >= 1.8) return `${r.toFixed(1)}:1 (soft, flattering)`
  return `${r.toFixed(1)}:1 (near shadowless)`
}

// ----- Media -----

/**
 * One file in the tray, and the readout of whether it is the one on screen.
 *
 * The thumbnail is the button: picking it puts the file on the selected
 * device, and the file already up there wears the accent, so the tray says
 * what is on the screen without a second control to read it off. Remove waits
 * for a hover or a focus, because five tiles each carrying a permanent cross
 * is a row of delete buttons rather than a row of media.
 */
function MediaTile({
  media,
  active,
  onPick,
  onRemove,
}: {
  media: AssetRuntime
  active: boolean
  onPick: () => void
  onRemove: () => void
}) {
  return (
    <div className="group relative">
      <button
        onClick={onPick}
        aria-pressed={active}
        title={active ? 'On the screen now' : 'Put this on the screen'}
        className={`block aspect-[4/3] w-full overflow-hidden rounded-md border bg-(--panel2) transition-colors ${
          active
            ? 'border-(--accent) ring-1 ring-(--accent)'
            : 'border-(--line) hover:border-(--line2)'
        }`}
      >
        {media.kind === 'video' ? (
          <video
            src={media.url}
            muted
            loop
            autoPlay
            playsInline
            className="h-full w-full object-cover"
          />
        ) : (
          <img src={media.url} alt="" className="h-full w-full object-cover" />
        )}
      </button>
      <button
        onClick={onRemove}
        title="Remove from the tray"
        aria-label="Remove from the tray"
        className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-(--line2) bg-(--raised) text-(--tx2) opacity-0 transition-opacity group-hover:opacity-100 hover:text-(--tx) focus-visible:opacity-100"
      >
        <X size={11} strokeWidth={2.2} />
      </button>
    </div>
  )
}

function MediaSection() {
  const selectedDeviceId = useStudio((s) => s.selectedDeviceId)
  const device = useStudio(
    (s) =>
      s.project.scene.devices.find((d) => d.id === s.selectedDeviceId) ?? s.project.scene.devices[0],
  )
  const devices = useStudio((s) => s.project.scene.devices)
  // the whole list, not a filtered one: a selector that builds a new array
  // every call re-renders this panel on every frame the timeline plays
  const assets = useStudio((s) => s.project.assets)
  const runtime = useStudio((s) => s.assets)
  const importMedia = useStudio((s) => s.importMedia)
  const importMediaFromURL = useStudio((s) => s.importMediaFromURL)
  const removeAsset = useStudio((s) => s.removeAsset)
  const updateDeviceScreen = useStudio((s) => s.updateDeviceScreen)

  const media = screenMedia(assets)
  const bound = device?.screen.assetId ?? null
  const empty = media.length === 0

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
    <Section title="Media" icon={<Images {...secIcon} />}>
      {/*
       * Five slots and the one that adds another, which lands as two tidy rows
       * of three. Empty, that add slot takes the whole row and says what it
       * takes, since a lone dashed square in the corner of an empty panel
       * explains nothing.
       */}
      <div className="grid grid-cols-3 gap-1.5">
        {media.map((m) => {
          const live = runtime[m.id]
          return live ? (
            <MediaTile
              key={m.id}
              media={live}
              active={m.id === bound}
              onPick={() => device && updateDeviceScreen(device.id, { assetId: m.id, scroll: 0 })}
              onRemove={() => removeAsset(m.id)}
            />
          ) : null
        })}
        {media.length < MAX_SCREEN_MEDIA && (
          <button
            onClick={() => pickMediaFile((f) => void importMedia(f))}
            /* the empty slot says this in its own label, and a tooltip that
               covers the thing it is describing is worse than no tooltip */
            title={empty ? undefined : 'Add an image or video, or drop one anywhere'}
            className={`media-drop relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-md border border-dashed border-(--line) text-(--tx3) transition-colors hover:border-(--tx3) hover:text-(--tx2) ${
              empty ? 'col-span-3 py-6' : 'aspect-[4/3]'
            }`}
          >
            {/* six, a sixth of a cycle apart, which is what turns one ring
                travelling inward into a wave doing it */}
            <span className="media-ripple" aria-hidden>
              <span className="media-ring" />
              <span className="media-ring" />
              <span className="media-ring" />
              <span className="media-ring" />
              <span className="media-ring" />
              <span className="media-ring" />
            </span>
            <Plus className="media-plus" size={empty ? 16 : 14} strokeWidth={1.9} />
            {empty && <span className="t-caption">Add an image or video, or drop one here</span>}
          </button>
        )}
      </div>

      <div className="mt-1.5">
        <MiniButton onClick={fromURL}>
          <Link size={13} strokeWidth={1.9} />
          From URL
        </MiniButton>
      </div>

      {device && bound && (
        <div className="mt-2">
          <Segments
            options={[
              { id: 'cover', label: 'Cover' },
              { id: 'contain', label: 'Contain' },
            ]}
            value={device.screen.fit}
            onChange={(fit) => updateDeviceScreen(device.id, { fit })}
          />
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
      )}

      {/* with one device there is nothing to say; with several, which one a
          pick lands on is the whole question */}
      {devices.length > 1 && device && (
        <p className="mt-2 t-caption text-(--tx3)">
          Picking one puts it on {getDevice(device.modelId).name}.
        </p>
      )}
      {selectedDeviceId === null && devices.length <= 1 && (
        <p className="mt-2 t-caption text-(--tx3)">Media binds to the selected device.</p>
      )}
    </Section>
  )
}

// ----- Camera -----

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
      {row('tiltX', 'Tilt X', ...CAMERA_LIMITS.tiltX, 0.5, 'DRAG')}
      {row('tiltY', 'Tilt Y', ...CAMERA_LIMITS.tiltY, 0.5, 'DRAG')}
      {row('roll', 'Roll', ...CAMERA_LIMITS.roll, 0.5)}
      {row(
        'fov',
        'Lens',
        ...CAMERA_LIMITS.fov,
        0.5,
        // product work lives around 50–100mm: long enough not to distort
        'Field of view, shown as its 35mm-equivalent focal length',
        (v) => `${focalFromFov(v)}mm`,
      )}
      {row('zoom', 'Zoom', ...CAMERA_LIMITS.zoom, 0.01, 'SCROLL')}
      {row('panX', 'Pan X', ...CAMERA_LIMITS.panX, 0.01, 'R-DRAG')}
      {row('panY', 'Pan Y', ...CAMERA_LIMITS.panY, 0.01, 'R-DRAG')}
      {row('rotateY', 'Rotate Y', ...CAMERA_LIMITS.rotateY, 0.5)}
      {row('rotateX', 'Rotate X', ...CAMERA_LIMITS.rotateX, 0.5)}
    </Section>
  )
}


// ----- Scene (background / environment / ground) -----

function SceneSection() {
  const bg = useStudio((s) => s.project.scene.background)
  const env = useStudio((s) => s.project.scene.environment)
  const ground = useStudio((s) => s.project.scene.ground)
  const setBackground = useStudio((s) => s.setBackground)
  const setSweep = useStudio((s) => s.setSweep)
  const setEnvironment = useStudio((s) => s.setEnvironment)
  const setGround = useStudio((s) => s.setGround)
  // panel-local: which fold is open is a view preference, not part of the project
  const [lampColors, setLampColors] = useState(false)
  const [skyBounce, setSkyBounce] = useState(false)
  const [placement, setPlacement] = useState(false)

  return (
    <Section title="Scene" icon={<Image {...secIcon} />}>
      {/* the backdrop is *chosen* in the toolbar; this section tunes the choice */}
      <p className="mb-2 t-caption text-(--tx3)">
        Backdrop: <span className="text-(--tx2)">{BG_LABEL[bg.type]}</span>. Swap it from the
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

      {/* the backdrop finish, which the preview and the exporter both run over
          whatever they just painted, so it is offered for every backdrop
          rather than only the two that happen to be photographic */}
      {bg.type !== 'transparent' && bg.type !== 'studio' && (
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
            hint="Where the key hits the paper. Keep it just behind the product"
          />
          <SliderRow label="Spread" value={bg.sweep.spread} min={0.2} max={1.2} onChange={(spread) => setSweep({ spread })} />
          <SliderRow label="Floor" value={bg.sweep.floor} min={0} max={0.9} onChange={(floor) => setSweep({ floor })} hint="Falloff toward the bottom of the sweep" />
          <SliderRow label="Vignette" value={bg.sweep.vignette} min={0} max={0.8} onChange={(vignette) => setSweep({ vignette })} />
        </>
      )}

      {bg.type === 'transparent' && (
        <p className="t-caption text-(--tx3)">
          Exports with a true alpha channel (PNG / WebM-alpha).
        </p>
      )}

      <div className="mt-3 border-t border-(--line) pt-3">
        <SubHeading icon={<Globe {...subIcon} />}>Environment</SubHeading>
        {/*
          The choice lives in the Scene panel; this tunes it. Same split the
          backdrop already uses, and the pointer matters more here because the
          mood is easy to forget you ever set.
        */}
        <p className="mb-1 t-caption text-(--tx3)">
          <span className="text-(--tx2)">{getMood(env.mood).name}</span>. Pick another in the
          Scene panel.
        </p>
        <SliderRow
          label="Amount"
          value={env.moodIntensity ?? 1}
          min={0}
          max={2}
          onChange={(moodIntensity) => setEnvironment({ moodIntensity })}
          hint="How much of the world shows up in glossy surfaces"
        />

        <SubHeading icon={<Sun {...subIcon} />}>Lighting</SubHeading>
        <SliderRow label="Key" value={env.keyIntensity} min={0} max={4} onChange={(keyIntensity) => setEnvironment({ keyIntensity })} hint="Main lamp, defines the form" />
        <SliderRow label="Fill" value={env.fillIntensity} min={0} max={3} onChange={(fillIntensity) => setEnvironment({ fillIntensity })} hint="Opens the shadows the key casts" />
        <SliderRow label="Rim" value={env.rimIntensity} min={0} max={3} onChange={(rimIntensity) => setEnvironment({ rimIntensity })} hint="Behind the subject, peels it off the backdrop" />
        <SliderRow label="Ambient" value={env.ambient} min={0} max={2} onChange={(ambient) => setEnvironment({ ambient })} />
        <p className="mt-1 mb-2 pl-5 t-caption text-(--tx3)">
          Key-to-fill {ratioNote(env.keyIntensity, env.fillIntensity)}
        </p>

        {/*
          Lamp colours are folded away by default. Warmth already moves all
          three together in the direction that matters for a product shot, and
          opening four pickers on top of it would make the common adjustment
          harder to find than the rare one.
        */}
        <Disclosure label="Lamp colours" icon={<Palette {...subIcon} />} open={lampColors} onToggle={setLampColors}>
          <ColorRow label="Key" value={env.keyColor ?? `#${keyColor(env.temperature).getHexString()}`} onChange={(keyColor) => setEnvironment({ keyColor })} />
          <ColorRow label="Fill" value={env.fillColor ?? `#${keyColor(-env.temperature * 0.5).getHexString()}`} onChange={(fillColor) => setEnvironment({ fillColor })} />
          <ColorRow label="Rim" value={env.rimColor ?? `#${keyColor(-Math.abs(env.temperature) * 0.4 - 0.15).getHexString()}`} onChange={(rimColor) => setEnvironment({ rimColor })} />
          <ColorRow label="Ambient" value={env.ambientColor ?? '#ffffff'} onChange={(ambientColor) => setEnvironment({ ambientColor })} />
          {(env.keyColor || env.fillColor || env.rimColor || env.ambientColor) && (
            <MiniButton
              onClick={() =>
                setEnvironment({
                  keyColor: undefined,
                  fillColor: undefined,
                  rimColor: undefined,
                  ambientColor: undefined,
                })
              }
            >
              Back to warmth
            </MiniButton>
          )}
        </Disclosure>

        <Disclosure label="Sky bounce" icon={<CloudSun {...subIcon} />} open={skyBounce} onToggle={setSkyBounce}>
          <SliderRow
            label="Amount"
            value={env.hemiIntensity ?? 0}
            min={0}
            max={5}
            onChange={(hemiIntensity) => setEnvironment({ hemiIntensity })}
            hint="Light from the sky above and the floor below, filling what the lamps miss"
          />
          {(env.hemiIntensity ?? 0) > 0 && (
            <>
              <ColorRow label="Sky" value={env.hemiSky ?? getMood(env.mood).hemi.sky} onChange={(hemiSky) => setEnvironment({ hemiSky })} />
              <ColorRow label="Ground" value={env.hemiGround ?? getMood(env.mood).hemi.ground} onChange={(hemiGround) => setEnvironment({ hemiGround })} />
            </>
          )}
        </Disclosure>

        <Disclosure label="Key placement" icon={<Move3d {...subIcon} />} open={placement} onToggle={setPlacement}>
          <SliderRow
            label="Angle"
            value={env.keyAzimuth}
            min={-90}
            max={90}
            step={1}
            format={(v) => `${v.toFixed(0)}°`}
            onChange={(keyAzimuth) => setEnvironment({ keyAzimuth })}
            hint="Degrees off the lens axis. 45° is the workhorse, 15–70° the useful range"
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
        </Disclosure>
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

// ----- Effects -----

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
          <p className="flex items-center gap-1.5 t-caption text-(--tx2)">
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

// ----- Devices -----

function DevicesSection() {
  const devices = useStudio((s) => s.project.scene.devices)
  const selectedId = useStudio((s) => s.selectedDeviceId)
  const st = useStudio.getState

  const selected = devices.find((d) => d.id === selectedId) ?? devices[0]
  const spec = selected ? getDevice(selected.modelId) : null

  return (
    <Section title="3D Devices" icon={<Box {...secIcon} />}>
      {/* which device these controls edit: adding, arranging and removing live
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
            <p className="mb-1 t-eyebrow text-(--tx3) uppercase">
              {spec.name}
            </p>
          )}
          {spec.colors.length > 1 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {spec.colors.map((c) => (
                <button
                  key={c.id}
                  title={c.name}
                  onClick={() => st().updateDevice(selected.id, { colorVariant: c.id })}
                  className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                    selected.colorVariant === c.id ? 'is-picked' : 'border-(--line)'
                  }`}
                  /* the stock swatch is split, so "leave it alone" doesn't
                     masquerade as just another colour you could have picked */
                  style={{
                    background: c.stock
                      ? `linear-gradient(135deg, ${c.value} 0 50%, var(--panel3) 50% 100%)`
                      : c.value,
                  }}
                />
              ))}

              {/*
                Native <input type="color">: it opens the OS picker, which has
                eyedropper and hex entry already, and no in-app wheel would beat
                that for the one job of matching a colour you saw elsewhere. The
                input itself is unstyleable across browsers, so it sits at zero
                opacity over a swatch that shows the current pick.
              */}
              <label
                title="Custom colour"
                className={`relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border-2 transition-transform hover:scale-110 ${
                  selected.colorVariant === 'custom' ? 'is-picked' : 'border-(--line)'
                }`}
                style={{
                  background:
                    selected.colorVariant === 'custom' && selected.customColor
                      ? selected.customColor
                      : 'conic-gradient(#f2555a, #e8d9b8, #27a644, #5e6ad2, #cd5ca8, #f2555a)',
                }}
              >
                <input
                  type="color"
                  value={selected.customColor ?? '#8899aa'}
                  onChange={(e) =>
                    st().updateDevice(selected.id, {
                      colorVariant: 'custom',
                      customColor: e.target.value,
                    })
                  }
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
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

// ----- Overlays -----

function OverlaysSection() {
  const overlays = useStudio((s) => s.project.overlays)
  const selectedId = useStudio((s) => s.selectedOverlayId)
  const st = useStudio.getState
  const selected = overlays.find((o) => o.id === selectedId)

  return (
    <Section title="Text · Logo · Shapes" icon={<Type {...secIcon} />} defaultOpen={false}>
      {overlays.length === 0 && (
        <p className="t-caption text-(--tx3)">
          Add text, a shape or a logo from the toolbar above. They'll show up here to edit.
        </p>
      )}
      {overlays.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {overlays.map((o) => (
            <div
              key={o.id}
              onClick={() => st().selectOverlay(o.id)}
              className={`flex cursor-pointer items-center justify-between rounded-xs border px-2 py-1 ${
                o.id === selectedId ? 'border-(--line2) bg-(--panel3)' : 'border-(--line)'
              }`}
            >
              <span className="max-w-40 truncate t-body-sm text-(--tx)">
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
                className="mb-1 w-full rounded-xs border border-(--line) bg-transparent px-2 py-1 t-body-sm text-(--tx)"
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
                <span className="t-body-sm text-(--tx2)">Pill bg</span>
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
                      className="h-6 w-8 cursor-pointer rounded-xs border border-(--line) bg-transparent"
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

// ----- assembled inspector -----

/*
 * Ordered by what the panel is *about*, working outward from the subject.
 *
 * Media is the screenshots, 3D Devices is the thing holding one, and Camera is
 * where you stand to look at the pair: those three are one continuous train
 * of thought and now sit together. Scene dresses what is behind them, and
 * Effects grades the finished picture, so both are later passes over a shot
 * that already exists. Overlays stay last: they are added on top of a frame
 * you have finished composing.
 *
 * 3D Devices used to sit below Effects, which put the device's own colour and
 * transform two whole sections beneath the camera aiming at it.
 */
export function Inspector() {
  return (
    <>
      <MediaSection />
      <CameraSection />
      <DevicesSection />
      <SceneSection />
      <EffectsSection />
      <OverlaysSection />
    </>
  )
}
