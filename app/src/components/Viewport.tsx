import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  Vignette,
} from '@react-three/postprocessing'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { EffectComposer as EffectComposerImpl } from 'postprocessing'
import { rt, applyAtTime } from '../lib/runtime'
import { meshGradientDataURL } from '../lib/meshGradient'
import { gradeFilter } from '../lib/grade'
import { rgba } from '../lib/color'
import { useStudio } from '../store'
import { DeviceMesh } from './DeviceMesh'
import { DeviceGizmo } from './DeviceGizmo'
import { OverlayLayer } from './OverlayLayer'
import type { BackgroundState } from '../types'

// ————— background CSS (preview path; export repaints the same thing) —————

function cssBackground(bg: BackgroundState, imageUrl: string | null): React.CSSProperties {
  switch (bg.type) {
    case 'solid':
      return { background: bg.color }
    case 'gradient':
      return {
        background:
          bg.gradient.kind === 'radial'
            ? `radial-gradient(circle at 50% 50%, ${bg.gradient.from}, ${bg.gradient.to})`
            : `linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.from}, ${bg.gradient.to})`,
      }
    case 'mesh':
      return {
        backgroundImage: `url(${meshGradientDataURL(bg.mesh.seed, bg.mesh.colors)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    case 'studio': {
      // Painted in the same order as the export canvas: paper, then the pool of
      // light the key throws on it, the floor falloff, and the corner hold.
      const s = bg.sweep
      const hotW = Math.round(s.spread * 200)
      const hotH = Math.round(s.spread * 150)
      return {
        backgroundColor: s.color,
        backgroundImage: [
          `radial-gradient(120% 105% at 50% ${s.hotY * 100}%, ${rgba('#000000', 0)} 42%, ${rgba('#000000', s.vignette)} 100%)`,
          `linear-gradient(to bottom, ${rgba('#000000', 0)} 46%, ${rgba('#000000', s.floor)} 100%)`,
          `radial-gradient(${hotW}% ${hotH}% at 50% ${s.hotY * 100}%, ${s.hot} 0%, ${rgba(s.hot, 0)} 70%)`,
        ].join(','),
      }
    }
    case 'image':
      return imageUrl
        ? { backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: '#111' }
    case 'transparent':
      return {
        backgroundImage:
          'repeating-conic-gradient(#3a3a42 0% 25%, #2a2a30 0% 50%)',
        backgroundSize: '20px 20px',
      }
  }
}

// ————— bridges into the runtime —————

function RuntimeBridge() {
  const { gl, scene, camera, setFrameloop } = useThree()
  useEffect(() => {
    rt.gl = gl
    rt.scene = scene
    rt.camera = camera as THREE.PerspectiveCamera
    rt.setFrameloop = setFrameloop as (m: 'always' | 'never' | 'demand') => void
  }, [gl, scene, camera, setFrameloop])

  // The single deterministic driver: evaluate keyframes at the playhead and
  // write into the three scene every frame (PRD §5.4).
  useFrame(() => {
    // Several passes borrow the renderer mid-frame — the post-processing
    // composer, the contact-shadow FBO, the environment cube — and each one
    // toggles autoClear around its own render. If any of them unmounts between
    // the set and the restore, the canvas stops clearing and every frame paints
    // on top of the last one (the device smears into a fan of ghosts while you
    // orbit). Re-asserting it here, before R3F renders, makes that unrecoverable
    // state impossible.
    gl.autoClear = true
    const s = useStudio.getState()
    applyAtTime(s.project, s.timeMs)
  })
  return null
}

function SceneRoot({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useEffect(() => {
    rt.sceneRoot = ref.current ?? undefined
    return () => {
      rt.sceneRoot = undefined
    }
  }, [])
  return <group ref={ref}>{children}</group>
}

// ————— the lighting rig (PRD §6.4 — photographic three-point setup) —————

const KEY_WARM = new THREE.Color('#ffd2a1') // tungsten
const KEY_COOL = new THREE.Color('#cfe0ff') // daylight strobe
const NEUTRAL = new THREE.Color('#ffffff')

/** Key colour for a -1 (cool) … +1 (warm) temperature dial. */
function keyColor(t: number) {
  const c = new THREE.Color().copy(NEUTRAL)
  return t >= 0 ? c.lerp(KEY_WARM, t) : c.lerp(KEY_COOL, -t)
}

/** Position on a sphere around the subject, in the rig's camera-relative frame. */
function place(azimuthDeg: number, elevationDeg: number, radius: number): [number, number, number] {
  const a = THREE.MathUtils.degToRad(azimuthDeg)
  const e = THREE.MathUtils.degToRad(elevationDeg)
  return [Math.sin(a) * Math.cos(e) * radius, Math.sin(e) * radius, Math.cos(a) * Math.cos(e) * radius]
}

/**
 * Lamps and softboxes, mounted on a rig that yaws with the camera.
 *
 * A photographer who walks around a product carries the setup with them, so a
 * "45° key" stays 45° off the lens instead of swinging behind the subject when
 * you orbit. The same yaw is applied to the environment map so the reflections
 * in a glossy body track the lamps that are supposedly casting them.
 */
function StudioRig() {
  const env = useStudio((s) => s.project.scene.environment)
  const rigRef = useRef<THREE.Group>(null)

  // the yaw itself is written by applyAtTime, the one driver both the preview
  // and the export loop run through
  useEffect(() => {
    rt.lightRig = rigRef.current ?? undefined
    return () => {
      rt.lightRig = undefined
    }
  }, [])

  const key = keyColor(env.temperature)
  // fill is the bounce off the opposite wall: always cooler than the key
  const fill = keyColor(-env.temperature * 0.5)
  const rim = keyColor(-Math.abs(env.temperature) * 0.4 - 0.15)

  const keyPos = place(env.keyAzimuth, env.keyElevation, 7)
  const fillPos = place(-env.keyAzimuth * 0.85, env.keyElevation * 0.35, 6.5)
  const rimPos = place(180 - env.keyAzimuth * 0.5, 42, 6)

  const soft = 0.35 + env.softness * 1.15

  return (
    <>
      <group ref={rigRef}>
        <ambientLight intensity={env.ambient} />
        <directionalLight position={keyPos} intensity={env.keyIntensity} color={key} />
        <directionalLight position={fillPos} intensity={env.fillIntensity} color={fill} />
        <directionalLight position={rimPos} intensity={env.rimIntensity} color={rim} />
        {/* the white card on the table, lifting the underside of the product */}
        <directionalLight position={[0, -4, 3.2]} intensity={env.bounce * 0.9} color="#ffffff" />
      </group>

      {/*
        Softboxes as geometry: they are what a glossy phone body actually
        reflects. Without them the metal frames read as flat grey plastic.

        No `key` here on purpose — drei re-renders the cube map whenever these
        children change identity, which is every time a lighting dial moves.
        Remounting instead would throw away and reallocate the render target on
        every frame of a slider drag.
      */}
      <Environment frames={1} resolution={128} environmentIntensity={env.reflection}>
        <color attach="background" args={['#0a0a0c']} />
        <Lightformer
          form="rect"
          intensity={env.keyIntensity * 1.1}
          color={`#${key.getHexString()}`}
          position={keyPos}
          scale={[6 * soft, 9 * soft, 1]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={env.fillIntensity * 1.2}
          color={`#${fill.getHexString()}`}
          position={fillPos}
          scale={[7 * soft, 6 * soft, 1]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={env.rimIntensity * 1.3}
          color={`#${rim.getHexString()}`}
          position={rimPos}
          scale={[1.4, 9, 1]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={env.bounce * 1.1}
          color="#ffffff"
          position={[0, -5, 2]}
          scale={[10, 10, 1]}
          target={[0, 0, 0]}
        />
      </Environment>
    </>
  )
}

/**
 * The pool of shadow the product sits in.
 *
 * ContactShadows projects straight down from an orthographic camera, so it
 * can't be leaned toward or away from the key: offsetting it only slides the
 * capture window until the blurred shadow runs off the edge of its own plane,
 * which shows up as a hard diagonal line across the backdrop. It stays centred,
 * and softness only nudges the blur — past roughly 3 the shadow stops reading
 * as contact and becomes a grey cloud hanging in frame.
 */
function GroundShadow() {
  const ground = useStudio((s) => s.project.scene.ground)
  const softness = useStudio((s) => s.project.scene.environment.softness)

  if (!ground.shadow) return null
  return (
    <ContactShadows
      position={[0, -1.3, 0]}
      opacity={ground.shadowOpacity}
      scale={10}
      blur={Math.min(3.2, ground.shadowBlur * (0.8 + softness * 0.4))}
      far={3}
      resolution={512}
    />
  )
}

function EffectsStack() {
  const effects = useStudio((s) => s.project.scene.effects)
  const composerRef = useRef<EffectComposerImpl>(null)
  const gl = useThree((s) => s.gl)

  const enabled =
    effects.bloom > 0 || effects.noise > 0 || effects.vignette > 0 || effects.chromatic > 0

  useEffect(() => {
    rt.composer = enabled && composerRef.current ? composerRef.current : undefined
    return () => {
      rt.composer = undefined
    }
  }, [enabled, effects])

  // Switching studio looks turns effects on and off, which mounts and unmounts
  // the composer under a live renderer. Hand the plain render path back a clean
  // slate — screen target, clearing enabled, buffer wiped — so the first frame
  // after the swap isn't drawn over the composer's leftovers.
  useEffect(() => {
    if (enabled) return
    gl.autoClear = true
    gl.setRenderTarget(null)
    gl.clear()
  }, [enabled, gl])

  const chromaticOffset = useMemo(
    () => new THREE.Vector2(effects.chromatic * 0.004, effects.chromatic * 0.004),
    [effects.chromatic],
  )

  if (!enabled) return null

  const items: React.ReactElement[] = []
  if (effects.bloom > 0)
    items.push(<Bloom key="bloom" intensity={effects.bloom * 1.6} luminanceThreshold={0.72} mipmapBlur />)
  if (effects.chromatic > 0)
    items.push(<ChromaticAberration key="ca" offset={chromaticOffset} />)
  if (effects.noise > 0) items.push(<Noise key="noise" premultiply opacity={effects.noise * 0.6} />)
  if (effects.vignette > 0)
    items.push(<Vignette key="vig" darkness={effects.vignette * 0.9} eskil={false} />)

  return (
    <EffectComposer ref={composerRef} multisampling={4}>
      {items}
    </EffectComposer>
  )
}

// ————— camera gestures (PRD §7.2: drag orbit · scroll zoom · right-drag pan) —————

function useCameraGestures(container: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = container.current
    if (!el) return

    let mode: 'orbit' | 'pan' | null = null
    let startX = 0
    let startY = 0
    let start = { tiltX: 0, tiltY: 0, panX: 0, panY: 0 }

    const sampled = () => {
      const s = useStudio.getState()
      const cam = s.project.scene.camera
      return { tiltX: cam.tiltX, tiltY: cam.tiltY, panX: cam.panX, panY: cam.panY }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
      // a transform-gizmo handle owns the drag; don't orbit underneath it
      if (rt.gizmoDragging) return
      mode = e.button === 0 ? 'orbit' : 'pan'
      startX = e.clientX
      startY = e.clientY
      start = sampled()
      el.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!mode || rt.gizmoDragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const s = useStudio.getState()
      if (mode === 'orbit') {
        s.setAnimatable('camera.tiltY', start.tiltY + dx * 0.35, 'gesture-orbit')
        s.setAnimatable(
          'camera.tiltX',
          THREE.MathUtils.clamp(start.tiltX - dy * 0.3, -88, 88),
          'gesture-orbit',
        )
      } else {
        const zoom = Math.max(0.2, s.project.scene.camera.zoom)
        const k = (7 / zoom) * 0.0016
        s.setAnimatable('camera.panX', start.panX - dx * k, 'gesture-pan')
        s.setAnimatable('camera.panY', start.panY + dy * k, 'gesture-pan')
      }
    }

    const endDrag = (e: PointerEvent) => {
      if (mode && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      mode = null
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = useStudio.getState()
      const zoom = THREE.MathUtils.clamp(
        s.project.scene.camera.zoom * Math.exp(-e.deltaY * 0.0012),
        0.3,
        8,
      )
      s.setAnimatable('camera.zoom', Number(zoom.toFixed(3)), 'gesture-zoom')
    }

    const onContext = (e: Event) => e.preventDefault()

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', onContext)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endDrag)
      el.removeEventListener('pointercancel', endDrag)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('contextmenu', onContext)
    }
  }, [container])
}

// ————— frame-aspect fit —————

function useFitRect(outer: React.RefObject<HTMLDivElement | null>, aspect: number) {
  const [rect, setRect] = useState({ width: 640, height: 360 })
  useEffect(() => {
    const el = outer.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const pad = 24
      const availW = Math.max(80, el.clientWidth - pad * 2)
      const availH = Math.max(80, el.clientHeight - pad * 2)
      let w = availW
      let h = w / aspect
      if (h > availH) {
        h = availH
        w = h * aspect
      }
      setRect({ width: Math.round(w), height: Math.round(h) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [outer, aspect])
  return rect
}

// ————— main viewport —————

export function Viewport() {
  const background = useStudio((s) => s.project.scene.background)
  const bgImageUrl = useStudio((s) =>
    s.project.scene.background.imageAssetId
      ? (s.assets[s.project.scene.background.imageAssetId]?.url ?? null)
      : null,
  )
  const devices = useStudio((s) => s.project.scene.devices)
  const grade = useStudio((s) => s.project.scene.effects.grade)
  const exportSize = useStudio((s) => s.project.exportSize)
  const selectDevice = useStudio((s) => s.selectDevice)
  const selectOverlay = useStudio((s) => s.selectOverlay)

  const outerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const rect = useFitRect(outerRef, exportSize.width / exportSize.height)
  useCameraGestures(frameRef)

  const [hintsVisible, setHintsVisible] = useState(() => localStorage.getItem('ms-hints-seen') !== '1')
  const [hintsFading, setHintsFading] = useState(false)
  useEffect(() => {
    if (!hintsVisible) return
    const el = frameRef.current
    if (!el) return
    const dismiss = () => {
      localStorage.setItem('ms-hints-seen', '1')
      setHintsFading(true)
      setTimeout(() => setHintsVisible(false), 300)
    }
    el.addEventListener('pointerdown', dismiss)
    el.addEventListener('wheel', dismiss, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', dismiss)
      el.removeEventListener('wheel', dismiss)
    }
  }, [hintsVisible])

  const bgStyle = useMemo(() => cssBackground(background, bgImageUrl), [background, bgImageUrl])
  const bgFilter =
    background.type === 'image' || background.type === 'mesh'
      ? `blur(${(background.blur * rect.width) / 1280}px) brightness(${background.brightness})`
      : undefined
  const gradeCss = useMemo(() => gradeFilter(grade) || undefined, [grade])

  return (
    <div ref={outerRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <div
        ref={frameRef}
        className="relative overflow-hidden rounded-lg shadow-2xl"
        style={{ width: rect.width, height: rect.height }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            selectOverlay(null)
          }
        }}
      >
        {/* graded layer: background + 3D canvas share the color grade so preview
            matches the export composite (overlays/watermark stay ungraded) */}
        <div className="absolute inset-0" style={{ filter: gradeCss }}>
          {/* background layer (CSS preview; export repaints identically) */}
          <div className="absolute inset-0" style={{ ...bgStyle, filter: bgFilter, transform: 'scale(1.06)' }} />

          <Canvas
            className="absolute inset-0"
            gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
            camera={{ position: [1.8, 0.8, 4.5], fov: 26, near: 0.1, far: 40 }}
            dpr={[1, 2]}
            onPointerMissed={() => selectDevice(null)}
          >
            <RuntimeBridge />
            <StudioRig />
            <SceneRoot>
              {devices.map((d) => (
                <DeviceMesh key={`${d.id}-${d.modelId}-${d.orientation}`} device={d} />
              ))}
            </SceneRoot>
            <DeviceGizmo />
            <GroundShadow />
            <EffectsStack />
          </Canvas>
        </div>

        <OverlayLayer width={rect.width} height={rect.height} />
      </div>

      {/* gesture hints — shown until the user's first orbit/zoom/pan, then never again */}
      {hintsVisible && (
        <div
          className={`pointer-events-none absolute bottom-3 left-4 flex gap-2 text-[9px] tracking-widest text-(--tx3) transition-opacity duration-300 ${
            hintsFading ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <span className="rounded bg-(--panel) px-1.5 py-0.5">DRAG · ORBIT</span>
          <span className="rounded bg-(--panel) px-1.5 py-0.5">SCROLL · ZOOM</span>
          <span className="rounded bg-(--panel) px-1.5 py-0.5">R-DRAG · PAN</span>
        </div>
      )}
    </div>
  )
}
