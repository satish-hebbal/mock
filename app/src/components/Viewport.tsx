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
import { cssBackground } from '../lib/backgroundCss'
import { gradeFilter } from '../lib/grade'
import { useStudio } from '../store'
import { ALPHA_CHECKER } from '../lib/checker'
import { CaptureFlash } from './CaptureFlash'
import { getMood, type EnvMood } from '../lib/moods'
import { keyColor } from '../lib/studio'
import { clampCamera } from '../lib/camera'
import { Focus } from 'lucide-react'
import { DeviceMesh } from './DeviceMesh'
import { DeviceGizmo } from './DeviceGizmo'
import { OverlayLayer } from './OverlayLayer'
import { FRAME_BUTTON, FRAME_INSET, NOTCH } from '../lib/notch'

// ----- bridges into the runtime -----

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
    // Several passes borrow the renderer mid-frame (the post-processing
    // composer, the contact-shadow FBO, the environment cube) and each one
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

// ----- the lighting rig (PRD §6.4, photographic three-point setup) -----

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
/**
 * The sky, ground and sun of an environment mood, drawn into the cube map the
 * softboxes already occupy.
 *
 * Three planes rather than a real gradient sphere: the map is rendered once at
 * 128px and then only ever sampled as a blurry reflection, so a zenith plane, a
 * ground plane and the background colour between them read as a gradient at the
 * only resolution anyone sees. A shader dome would cost a custom material and
 * look identical after the roughness blur.
 *
 * `amount` scales every source, so the Studio mood (strength 0) contributes
 * nothing and the rig behaves exactly as it did before moods existed.
 */
function MoodDome({ mood, amount }: { mood: EnvMood; amount: number }) {
  if (amount <= 0) return null
  const [zenith, , ground] = mood.dome
  return (
    <>
      <Lightformer
        form="rect"
        intensity={amount * 3.4}
        color={zenith}
        position={[0, 12, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[26, 26, 1]}
      />
      <Lightformer
        form="rect"
        intensity={amount * 1.9}
        color={ground}
        position={[0, -12, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[26, 26, 1]}
      />
      {mood.sun && (
        <Lightformer
          form="circle"
          intensity={mood.sun.intensity * amount}
          color={mood.sun.color}
          position={place(mood.sun.azimuth, mood.sun.elevation, 14)}
          scale={[mood.sun.size, mood.sun.size, 1]}
          target={[0, 0, 0]}
        />
      )}
    </>
  )
}

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

  // An explicit colour, when set, wins over the warmth slider. Warmth stays the
  // default because one dial that moves all three lamps together is how a
  // photographer thinks about it; per-lamp colour is the escape hatch.
  const key = env.keyColor ? new THREE.Color(env.keyColor) : keyColor(env.temperature)
  // fill is the bounce off the opposite wall: always cooler than the key
  const fill = env.fillColor ? new THREE.Color(env.fillColor) : keyColor(-env.temperature * 0.5)
  const rim = env.rimColor
    ? new THREE.Color(env.rimColor)
    : keyColor(-Math.abs(env.temperature) * 0.4 - 0.15)

  const mood = getMood(env.mood)
  const moodAmount = (env.moodIntensity ?? 1) * mood.strength
  const hemi = env.hemiIntensity ?? 0

  const keyPos = place(env.keyAzimuth, env.keyElevation, 7)
  const fillPos = place(-env.keyAzimuth * 0.85, env.keyElevation * 0.35, 6.5)
  const rimPos = place(180 - env.keyAzimuth * 0.5, 42, 6)

  const soft = 0.35 + env.softness * 1.15

  return (
    <>
      <group ref={rigRef}>
        <ambientLight intensity={env.ambient} color={env.ambientColor ?? '#ffffff'} />
        {/* sky-to-ground bounce. Yaw doesn't reach it: a hemisphere lamp is
            defined by up and down, which orbiting the camera never changes. */}
        {hemi > 0 && (
          <hemisphereLight
            intensity={hemi}
            color={env.hemiSky ?? mood.hemi.sky}
            groundColor={env.hemiGround ?? mood.hemi.ground}
          />
        )}
        <directionalLight position={keyPos} intensity={env.keyIntensity} color={key} />
        <directionalLight position={fillPos} intensity={env.fillIntensity} color={fill} />
        <directionalLight position={rimPos} intensity={env.rimIntensity} color={rim} />
        {/* the white card on the table, lifting the underside of the product */}
        <directionalLight position={[0, -4, 3.2]} intensity={env.bounce * 0.9} color="#ffffff" />
      </group>

      {/*
        Softboxes as geometry: they are what a glossy phone body actually
        reflects. Without them the metal frames read as flat grey plastic.

        No `key` here on purpose: drei re-renders the cube map whenever these
        children change identity, which is every time a lighting dial moves.
        Remounting instead would throw away and reallocate the render target on
        every frame of a slider drag.
      */}
      <Environment frames={1} resolution={128} environmentIntensity={env.reflection}>
        <color attach="background" args={[mood.dome[1]]} />
        <MoodDome mood={mood} amount={moodAmount} />
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
 * and softness only nudges the blur: past roughly 3 the shadow stops reading
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
  // slate (screen target, clearing enabled, buffer wiped) so the first frame
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

// ----- camera gestures (PRD §7.2: drag orbit · scroll zoom · right-drag pan) -----

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
        s.setAnimatable('camera.tiltY', clampCamera('tiltY', start.tiltY + dx * 0.35), 'gesture-orbit')
        s.setAnimatable('camera.tiltX', clampCamera('tiltX', start.tiltX - dy * 0.3), 'gesture-orbit')
      } else {
        const zoom = Math.max(0.2, s.project.scene.camera.zoom)
        const k = (7 / zoom) * 0.0016
        s.setAnimatable('camera.panX', clampCamera('panX', start.panX - dx * k), 'gesture-pan')
        s.setAnimatable('camera.panY', clampCamera('panY', start.panY + dy * k), 'gesture-pan')
      }
    }

    const endDrag = (e: PointerEvent) => {
      if (mode && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      mode = null
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = useStudio.getState()
      const zoom = clampCamera('zoom', s.project.scene.camera.zoom * Math.exp(-e.deltaY * 0.0012))
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

// ----- frame-aspect fit -----

/**
 * Fit the export frame into the viewport, keeping its aspect.
 *
 * `reserveTop` is height the picture may not use: the notch bites into the
 * top of the panel, and anything drawn up there would be clipped away rather
 * than merely covered. The matching padding on the container is what actually
 * pushes the frame down; this only stops it being sized as though that space
 * were free.
 */
function useFitRect(
  outer: React.RefObject<HTMLDivElement | null>,
  aspect: number,
  reserveTop = 0,
) {
  const [rect, setRect] = useState({ width: 640, height: 360 })
  useEffect(() => {
    const el = outer.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const pad = 24
      const availW = Math.max(80, el.clientWidth - pad * 2)
      const availH = Math.max(80, el.clientHeight - reserveTop - pad * 2)
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
  }, [outer, aspect, reserveTop])
  return rect
}

// ----- main viewport -----

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
  const selectKeyframes = useStudio((s) => s.selectKeyframes)

  const outerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const rect = useFitRect(outerRef, exportSize.width / exportSize.height, NOTCH.depth)
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
  const alphaBg = background.type === 'transparent'
  /*
   * Backdrop finish. Matched to the exporter, which runs the same two numbers
   * as a canvas filter over whatever it just painted, so this applies to every
   * backdrop rather than only the two that happen to be photographic.
   */
  const bgFilter =
    background.blur > 0 || background.brightness !== 1
      ? `blur(${(background.blur * rect.width) / 1280}px) brightness(${background.brightness})`
      : undefined
  const gradeCss = useMemo(() => gradeFilter(grade) || undefined, [grade])

  return (
    <div
      ref={outerRef}
      style={{ paddingTop: NOTCH.depth }}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
    >
      <div
        ref={frameRef}
        className="relative overflow-hidden rounded-lg"
        style={{ width: rect.width, height: rect.height }}
        onPointerDown={(e) => {
          /*
           * Any press in the viewport drops a keyframe selection, because from
           * here on the arrow keys should scrub again.
           *
           * With keyframes selected the timeline nudges them instead of moving
           * the playhead, which is right while you are working in the timeline
           * and a trap once you have moved on: the selection outlived every
           * click, so arrows had quietly stopped scrubbing and only Escape,
           * which nobody thinks to press, brought them back. Turning to the
           * canvas is as clear a "done with those" as there is.
           */
          selectKeyframes([])
          if (e.target === e.currentTarget) {
            selectOverlay(null)
          }
        }}
      >
        {/*
          With no backdrop the checkerboard stands in for absence, so it sits
          outside the graded layer: the exporter leaves those pixels untouched,
          and grading "nothing" would both lie about the export and light the
          grid up whenever the scene carries a bright exposure.
        */}
        {alphaBg && <div className="absolute inset-0" style={ALPHA_CHECKER} />}

        {/* graded layer: background + 3D canvas share the color grade so preview
            matches the export composite (overlays/watermark stay ungraded) */}
        <div className="absolute inset-0" style={{ filter: gradeCss }}>
          {/* background layer (CSS preview; export repaints identically) */}
          {!alphaBg && (
            <div className="absolute inset-0" style={{ ...bgStyle, filter: bgFilter, transform: 'scale(1.06)' }} />
          )}

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
        <CaptureFlash />
      </div>

      {/*
        Lost-the-subject button. Orbiting past the edge of the frame is easy and
        gives no clue how to get back: the numbers say nothing and the canvas is
        empty. This recentres on the devices and fits them, keeping the angle,
        so a wrong drag is one click to undo rather than a hunt.

        Its size and inset are the one pair that satisfies both rules the top of
        this panel is built on. At 36 in from 4 it lands dead centre of the same
        band the notch tools sit in (4 + 18 is the 6 + 16 they centre on) so
        the two groups share a centre line across the whole width of the canvas.
        And 4 of clearance under an 8 corner puts its corner arc on exactly the
        centre of the panel's own 12 corner, so the two curves are concentric
        and the gap round them never opens or pinches. 32 would hold the first
        rule and break the second; 36 holds both, and matches the tool rail.
      */}
      <button
        onClick={() => useStudio.getState().frameDevices()}
        title="Frame the devices (F)"
        aria-label="Frame the devices"
        style={{ width: FRAME_BUTTON, height: FRAME_BUTTON, top: FRAME_INSET, right: FRAME_INSET }}
        className="absolute z-10 flex items-center justify-center rounded-md border border-(--line) bg-(--raised) text-(--tx2) transition-colors hover:border-(--line2) hover:text-(--tx)"
      >
        <Focus size={16} strokeWidth={1.8} />
      </button>

      {/* gesture hints, shown until the user's first orbit/zoom/pan, then never again */}
      {hintsVisible && (
        <div
          className={`pointer-events-none absolute bottom-3 left-4 flex gap-2 t-caption tracking-widest text-(--tx3) transition-opacity duration-300 ${
            hintsFading ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <span className="rounded-xs bg-(--raised) px-1.5 py-0.5">DRAG · ORBIT</span>
          <span className="rounded-xs bg-(--raised) px-1.5 py-0.5">SCROLL · ZOOM</span>
          <span className="rounded-xs bg-(--raised) px-1.5 py-0.5">R-DRAG · PAN</span>
        </div>
      )}
    </div>
  )
}
