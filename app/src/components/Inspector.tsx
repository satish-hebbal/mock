import { useState } from 'react'
import { pickMediaFile, useStudio } from '../store'
import { ColorRow, MiniButton, Section, Segments, SliderRow } from './controls'
import { CAMERA_PRESETS, GRADIENT_PRESETS, OVERLAY_FONTS } from '../lib/presets'
import { DEVICES, DEVICE_CATEGORIES, getDevice } from '../lib/registry'
import { MESH_PALETTES, meshGradientDataURL } from '../lib/meshGradient'
import type { Overlay, TextOverlay } from '../types'

const uid = () => crypto.randomUUID()

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
  const updateDeviceScreen = useStudio((s) => s.updateDeviceScreen)

  return (
    <Section title="Source">
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
  const setCamera = useStudio((s) => s.setCamera)
  const [tab, setTab] = useState<'manual' | 'presets'>('manual')

  const row = (
    prop: keyof typeof cam,
    label: string,
    min: number,
    max: number,
    step = 0.1,
    hint?: string,
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
    />
  )

  return (
    <Section title="Camera">
      <Segments
        options={[
          { id: 'manual', label: 'Manual' },
          { id: 'presets', label: 'Presets' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'manual' ? (
        <div>
          {row('tiltX', 'Tilt X', -88, 88, 0.5, 'DRAG')}
          {row('tiltY', 'Tilt Y', -180, 180, 0.5, 'DRAG')}
          {row('roll', 'Roll', -45, 45, 0.5)}
          {row('fov', 'FOV', 8, 90, 0.5)}
          {row('zoom', 'Zoom', 0.3, 8, 0.01, 'SCROLL')}
          {row('panX', 'Pan X', -3, 3, 0.01, 'R-DRAG')}
          {row('panY', 'Pan Y', -3, 3, 0.01, 'R-DRAG')}
          {row('rotateY', 'Rotate Y', -180, 180, 0.5)}
          {row('rotateX', 'Rotate X', -90, 90, 0.5)}
          <div className="mt-2 text-right">
            <MiniButton
              onClick={() =>
                setCamera(
                  { tiltX: 0, tiltY: 0, roll: 0, panX: 0, panY: 0, rotateX: 0, rotateY: 0 },
                  'cam-reset',
                )
              }
            >
              Snap straight-on
            </MiniButton>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {CAMERA_PRESETS.map((p) => (
            <MiniButton key={p.name} onClick={() => setCamera(p.cam, 'cam-preset')}>
              {p.name}
            </MiniButton>
          ))}
        </div>
      )}
    </Section>
  )
}

// ————— Blur / DoF —————

function BlurSection() {
  const blur = useStudio((s) => s.project.scene.blur)
  const setBlur = useStudio((s) => s.setBlur)
  return (
    <Section title="Blur · Depth of Field" defaultOpen={false}>
      <Segments
        options={[
          { id: 'none', label: 'Off' },
          { id: 'lens', label: 'Lens' },
          { id: 'tiltshift', label: 'Tilt-shift' },
        ]}
        value={blur.style}
        onChange={(style) => setBlur({ style })}
      />
      {blur.style !== 'none' && (
        <>
          {blur.style === 'lens' && (
            <SliderRow label="Focus" value={blur.focus} min={0} max={1} onChange={(focus) => setBlur({ focus })} />
          )}
          <SliderRow
            label="Amount"
            value={blur.strength}
            min={0}
            max={1}
            onChange={(strength) => setBlur({ strength })}
          />
        </>
      )}
    </Section>
  )
}

// ————— Scene (background / environment / ground) —————

function SceneSection() {
  const bg = useStudio((s) => s.project.scene.background)
  const env = useStudio((s) => s.project.scene.environment)
  const ground = useStudio((s) => s.project.scene.ground)
  const setBackground = useStudio((s) => s.setBackground)
  const setEnvironment = useStudio((s) => s.setEnvironment)
  const setGround = useStudio((s) => s.setGround)
  const importBgImage = () =>
    pickMediaFile(async (f) => {
      // reuse media importer, then point the background at the new asset
      const st = useStudio.getState()
      const before = new Set(st.project.assets.map((a) => a.id))
      await st.importMedia(f)
      const after = useStudio.getState().project.assets
      const added = after.find((a) => !before.has(a.id))
      if (added) {
        // un-bind from device (importMedia auto-binds) and use as background
        const dev = useStudio
          .getState()
          .project.scene.devices.find((d) => d.screen.assetId === added.id)
        if (dev) useStudio.getState().updateDeviceScreen(dev.id, { assetId: null })
        useStudio.getState().setBackground({ imageAssetId: added.id, type: 'image' })
      }
    }, false)

  return (
    <Section title="Scene">
      <Segments
        options={[
          { id: 'solid', label: 'Solid' },
          { id: 'gradient', label: 'Grad' },
          { id: 'mesh', label: 'Mesh' },
          { id: 'image', label: 'Image' },
          { id: 'transparent', label: 'Alpha' },
        ]}
        value={bg.type}
        onChange={(type) => setBackground({ type })}
      />

      {bg.type === 'solid' && (
        <ColorRow label="Color" value={bg.color} onChange={(color) => setBackground({ color })} />
      )}

      {bg.type === 'gradient' && (
        <>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {GRADIENT_PRESETS.map((g, i) => (
              <button
                key={i}
                onClick={() => setBackground({ gradient: { ...bg.gradient, ...g } })}
                className="h-6 w-6 rounded-full border border-(--line)"
                style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
              />
            ))}
          </div>
          <Segments
            options={[
              { id: 'linear', label: 'Linear' },
              { id: 'radial', label: 'Radial' },
            ]}
            value={bg.gradient.kind}
            onChange={(kind) => setBackground({ gradient: { ...bg.gradient, kind } })}
          />
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
          <MiniButton
            onClick={() => setBackground({ mesh: { ...bg.mesh, seed: Math.floor(Math.random() * 1e6) } })}
          >
            ↻ Randomize
          </MiniButton>
          <SliderRow
            label="Blur"
            value={bg.blur}
            min={0}
            max={60}
            step={1}
            onChange={(blur) => setBackground({ blur })}
          />
        </>
      )}

      {bg.type === 'image' && (
        <>
          <MiniButton onClick={importBgImage}>Upload background…</MiniButton>
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

      {bg.type === 'transparent' && (
        <p className="text-[10px] text-(--tx3)">
          Exports with a true alpha channel (PNG / WebM-alpha).
        </p>
      )}

      <div className="mt-3 border-t border-(--line) pt-3">
        <p className="mb-1 text-[9px] font-semibold tracking-[0.18em] text-(--tx3) uppercase">Lighting</p>
        <SliderRow label="Key" value={env.keyIntensity} min={0} max={4} onChange={(keyIntensity) => setEnvironment({ keyIntensity })} />
        <SliderRow label="Fill" value={env.fillIntensity} min={0} max={2} onChange={(fillIntensity) => setEnvironment({ fillIntensity })} />
        <SliderRow label="Rim" value={env.rimIntensity} min={0} max={2} onChange={(rimIntensity) => setEnvironment({ rimIntensity })} />
        <SliderRow label="Ambient" value={env.ambient} min={0} max={2} onChange={(ambient) => setEnvironment({ ambient })} />
      </div>

      <div className="mt-3 border-t border-(--line) pt-3">
        <p className="mb-1 text-[9px] font-semibold tracking-[0.18em] text-(--tx3) uppercase">Ground shadow</p>
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
  return (
    <Section title="Effects" defaultOpen={false}>
      <SliderRow label="Bloom" value={fx.bloom} min={0} max={1} onChange={(bloom) => setEffects({ bloom })} />
      <SliderRow label="Grain" value={fx.noise} min={0} max={1} onChange={(noise) => setEffects({ noise })} />
      <SliderRow label="Vignette" value={fx.vignette} min={0} max={1} onChange={(vignette) => setEffects({ vignette })} />
      <SliderRow label="Fringe" value={fx.chromatic} min={0} max={1} onChange={(chromatic) => setEffects({ chromatic })} hint="Chromatic aberration" />
    </Section>
  )
}

// ————— Devices —————

function DevicesSection() {
  const devices = useStudio((s) => s.project.scene.devices)
  const selectedId = useStudio((s) => s.selectedDeviceId)
  const pro = useStudio((s) => s.pro)
  const st = useStudio.getState
  const [adding, setAdding] = useState(false)

  const selected = devices.find((d) => d.id === selectedId) ?? devices[0]
  const spec = selected ? getDevice(selected.modelId) : null

  return (
    <Section title="3D Devices">
      <div className="mb-2 flex flex-col gap-1">
        {devices.map((d, i) => {
          const dSpec = getDevice(d.modelId)
          return (
            <div
              key={d.id}
              className={`flex cursor-pointer items-center justify-between rounded border px-2 py-1.5 ${
                d.id === selected?.id ? 'border-orange-500/60 bg-orange-600/10' : 'border-(--line)'
              }`}
              onClick={() => st().selectDevice(d.id)}
            >
              <span className="text-[11px] text-(--tx)">
                {i + 1} · {dSpec.name}
              </span>
              <span className="flex gap-1">
                <button
                  title="Duplicate"
                  className="text-[11px] text-(--tx3) hover:text-(--tx)"
                  onClick={(e) => {
                    e.stopPropagation()
                    st().duplicateDevice(d.id)
                  }}
                >
                  ⧉
                </button>
                {devices.length > 1 && (
                  <button
                    title="Delete"
                    className="text-[11px] text-(--tx3) hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation()
                      st().removeDevice(d.id)
                    }}
                  >
                    ✕
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>

      <div className="mb-2 flex gap-1">
        <MiniButton onClick={() => setAdding(!adding)} active={adding}>
          + Add device
        </MiniButton>
        {devices.length > 1 && (
          <>
            <MiniButton onClick={() => st().arrangeDevices('row')}>Row</MiniButton>
            <MiniButton onClick={() => st().arrangeDevices('fan')}>Fan</MiniButton>
            <MiniButton onClick={() => st().arrangeDevices('stack')}>Stack</MiniButton>
          </>
        )}
      </div>

      {adding && (
        <div className="mb-3 max-h-56 overflow-y-auto rounded border border-(--line) p-2">
          {DEVICE_CATEGORIES.map((cat) => {
            const list = DEVICES.filter((d) => d.category === cat)
            if (list.length === 0) return null
            return (
              <div key={cat} className="mb-2">
                <p className="mb-1 text-[9px] font-semibold tracking-[0.18em] text-(--tx3) uppercase">{cat}</p>
                <div className="flex flex-wrap gap-1">
                  {list.map((d) => (
                    <MiniButton
                      key={d.id}
                      onClick={() => {
                        if (d.pro && !pro) {
                          st().setDialog('upgrade')
                          return
                        }
                        st().addDevice(d.id)
                        setAdding(false)
                      }}
                    >
                      {d.name}
                      {d.pro && !pro ? ' ◆' : ''}
                    </MiniButton>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selected && spec && (
        <div className="border-t border-(--line) pt-2">
          <p className="mb-1 text-[9px] font-semibold tracking-[0.18em] text-(--tx3) uppercase">
            {spec.name}
          </p>
          {spec.colors.length > 1 && (
            <div className="mb-2 flex gap-1.5">
              {spec.colors.map((c) => (
                <button
                  key={c.id}
                  title={c.name}
                  onClick={() => st().updateDevice(selected.id, { colorVariant: c.id })}
                  className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                    selected.colorVariant === c.id ? 'border-orange-500' : 'border-(--line)'
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

  const addText = () => {
    const o: TextOverlay = {
      id: `ovl_${uid()}`,
      type: 'text',
      text: 'Your headline',
      x: 0.5,
      y: 0.14,
      opacity: 1,
      rotation: 0,
      size: 0.055,
      weight: 700,
      color: '#ffffff',
      font: 'system-ui',
      align: 'center',
      bg: null,
    }
    st().addOverlay(o)
  }

  const addShape = () => {
    st().addOverlay({
      id: `ovl_${uid()}`,
      type: 'shape',
      shape: 'rect',
      x: 0.5,
      y: 0.85,
      opacity: 0.9,
      rotation: 0,
      width: 0.22,
      height: 0.08,
      color: '#111827',
      radius: 0.04,
    } as Overlay)
  }

  const addLogo = () =>
    pickMediaFile(async (f) => {
      const stt = useStudio.getState()
      const before = new Set(stt.project.assets.map((a) => a.id))
      await stt.importMedia(f)
      const added = useStudio.getState().project.assets.find((a) => !before.has(a.id))
      if (added) {
        const dev = useStudio.getState().project.scene.devices.find((d) => d.screen.assetId === added.id)
        if (dev) useStudio.getState().updateDeviceScreen(dev.id, { assetId: null })
        useStudio.getState().addOverlay({
          id: `ovl_${uid()}`,
          type: 'image',
          assetId: added.id,
          x: 0.12,
          y: 0.1,
          opacity: 1,
          rotation: 0,
          width: 0.12,
        } as Overlay)
      }
    }, false)

  return (
    <Section title="Text · Logo · Shapes" defaultOpen={false}>
      <div className="mb-2 flex gap-1">
        <MiniButton onClick={addText}>+ Text</MiniButton>
        <MiniButton onClick={addShape}>+ Shape</MiniButton>
        <MiniButton onClick={addLogo}>+ Logo</MiniButton>
      </div>
      {overlays.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {overlays.map((o) => (
            <div
              key={o.id}
              onClick={() => st().selectOverlay(o.id)}
              className={`flex cursor-pointer items-center justify-between rounded border px-2 py-1 ${
                o.id === selectedId ? 'border-orange-500/60 bg-orange-600/10' : 'border-(--line)'
              }`}
            >
              <span className="max-w-40 truncate text-[11px] text-(--tx)">
                {o.type === 'text' ? `T · ${o.text}` : o.type === 'shape' ? `▢ · ${o.shape}` : '🖼 · logo'}
              </span>
              <button
                className="text-[11px] text-(--tx3) hover:text-red-400"
                onClick={(e) => {
                  e.stopPropagation()
                  st().removeOverlay(o.id)
                }}
              >
                ✕
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
                <select
                  value={selected.font}
                  onChange={(e) => st().updateOverlay(selected.id, { font: e.target.value })}
                  className="flex-1 rounded border border-(--line) bg-(--panel) px-1 py-1 text-[11px] text-(--tx)"
                >
                  {OVERLAY_FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <select
                  value={selected.weight}
                  onChange={(e) => st().updateOverlay(selected.id, { weight: Number(e.target.value) })}
                  className="rounded border border-(--line) bg-(--panel) px-1 py-1 text-[11px] text-(--tx)"
                >
                  {[400, 500, 600, 700, 800, 900].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
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
    <aside className="flex w-76 shrink-0 flex-col overflow-y-auto border-l border-(--line) bg-(--panel)">
      <SourceSection />
      <CameraSection />
      <BlurSection />
      <SceneSection />
      <EffectsSection />
      <DevicesSection />
      <OverlaysSection />
    </aside>
  )
}
