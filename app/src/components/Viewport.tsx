import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import {
  Bloom,
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  Noise,
  TiltShift2,
  Vignette,
} from '@react-three/postprocessing'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { EffectComposer as EffectComposerImpl } from 'postprocessing'
import { rt, applyAtTime } from '../lib/runtime'
import { meshGradientDataURL } from '../lib/meshGradient'
import { useStudio } from '../store'
import { DeviceMesh } from './DeviceMesh'
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

function EffectsStack() {
  const blur = useStudio((s) => s.project.scene.blur)
  const effects = useStudio((s) => s.project.scene.effects)
  const composerRef = useRef<EffectComposerImpl>(null)

  const enabled =
    blur.style !== 'none' ||
    effects.bloom > 0 ||
    effects.noise > 0 ||
    effects.vignette > 0 ||
    effects.chromatic > 0

  useEffect(() => {
    rt.composer = enabled && composerRef.current ? composerRef.current : undefined
    return () => {
      rt.composer = undefined
    }
  }, [enabled, blur, effects])

  const chromaticOffset = useMemo(
    () => new THREE.Vector2(effects.chromatic * 0.004, effects.chromatic * 0.004),
    [effects.chromatic],
  )

  if (!enabled) return null

  const items: React.ReactElement[] = []
  if (blur.style === 'lens')
    items.push(
      <DepthOfField
        key="dof"
        focusDistance={blur.focus}
        focalLength={0.02 + (1 - blur.strength) * 0.08}
        bokehScale={1 + blur.strength * 9}
      />,
    )
  if (blur.style === 'tiltshift') items.push(<TiltShift2 key="ts" blur={blur.strength * 0.6} />)
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
      mode = e.button === 0 ? 'orbit' : 'pan'
      startX = e.clientX
      startY = e.clientY
      start = sampled()
      el.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!mode) return
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
  const env = useStudio((s) => s.project.scene.environment)
  const ground = useStudio((s) => s.project.scene.ground)
  const exportSize = useStudio((s) => s.project.exportSize)
  const selectDevice = useStudio((s) => s.selectDevice)
  const selectOverlay = useStudio((s) => s.selectOverlay)
  const pro = useStudio((s) => s.pro)

  const outerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const rect = useFitRect(outerRef, exportSize.width / exportSize.height)
  useCameraGestures(frameRef)

  const bgStyle = useMemo(() => cssBackground(background, bgImageUrl), [background, bgImageUrl])
  const bgFilter =
    background.type === 'image' || background.type === 'mesh'
      ? `blur(${(background.blur * rect.width) / 1280}px) brightness(${background.brightness})`
      : undefined

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
          <ambientLight intensity={env.ambient} />
          <directionalLight position={[4, 6, 5]} intensity={env.keyIntensity} />
          <directionalLight position={[-5, 2, -4]} intensity={env.fillIntensity} />
          <directionalLight position={[0, -3, 3]} intensity={env.rimIntensity} color="#bcd4ff" />
          <SceneRoot>
            {devices.map((d) => (
              <DeviceMesh key={`${d.id}-${d.modelId}-${d.orientation}`} device={d} />
            ))}
          </SceneRoot>
          {ground.shadow && (
            <ContactShadows
              position={[0, -1.3, 0]}
              opacity={ground.shadowOpacity}
              scale={10}
              blur={ground.shadowBlur}
              far={3}
              resolution={512}
            />
          )}
          <EffectsStack />
        </Canvas>

        <OverlayLayer width={rect.width} height={rect.height} />

        {!pro && (
          <div className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-black/45 px-3 py-1 text-[10px] font-semibold tracking-wide text-white/90">
            ◆ Mockup Studio
          </div>
        )}
      </div>

      {/* gesture hints */}
      <div className="pointer-events-none absolute bottom-3 left-4 flex gap-2 text-[9px] tracking-widest text-(--tx3)">
        <span className="rounded bg-(--panel) px-1.5 py-0.5">DRAG · ORBIT</span>
        <span className="rounded bg-(--panel) px-1.5 py-0.5">SCROLL · ZOOM</span>
        <span className="rounded bg-(--panel) px-1.5 py-0.5">R-DRAG · PAN</span>
      </div>
    </div>
  )
}
