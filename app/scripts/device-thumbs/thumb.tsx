/*
 * One device, on a clear background, for the catalog's picture tiles.
 *
 * Rendered by scripts/render-device-thumbs.mjs rather than live in the panel:
 * a dozen WebGL scenes in a side panel would cost more than the whole viewport,
 * and a still of the real model is all a tile needs to say "this one". It goes
 * through the app's own GltfDevice, so the thumbnail is the device exactly as it
 * will land in the scene, screen fit and all.
 */
import { Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { ALL_MODEL_DEVICES } from '../../src/lib/registry'
import { GltfDevice } from '../../src/components/GltfDevice'

const q = new URLSearchParams(location.search)
const spec = ALL_MODEL_DEVICES.find((d) => d.id === q.get('id'))!

/** Three-quarter views: phones turned to show an edge, laptops seen from above the keyboard. */
const POSE: Record<string, [number, number]> = {
  phone: [8, -24],
  tablet: [8, -22],
  laptop: [20, -28],
  watch: [6, -18],
}

/*
 * The wallpaper: one of the shipped Nature presets, the same on every device
 * so the tiles read as one set. A real photograph rather than a drawn gradient,
 * because a screen showing a picture is what makes a device read as switched on.
 */
const WALLPAPER = '/preset-bgs/nature/nature-29.webp'
/** where the lit peak sits in the photo, so a narrow phone crop keeps it */
const FOCUS = { x: 0.62, y: 0.4 }

const photo = await new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = reject
  img.src = WALLPAPER
})

/** The photo cover-cropped to the screen's aspect, centred on the peak as far as the edges allow. */
function wallpaper(aspect: number) {
  const c = document.createElement('canvas')
  c.height = 1024
  c.width = Math.round(1024 * aspect)
  const g = c.getContext('2d')!
  const k = Math.max(c.width / photo.width, c.height / photo.height)
  const w = photo.width * k
  const h = photo.height * k
  const clamp = (v: number, lo: number) => Math.min(0, Math.max(lo, v))
  const x = clamp(c.width / 2 - FOCUS.x * w, c.width - w)
  const y = clamp(c.height / 2 - FOCUS.y * h, c.height - h)
  g.drawImage(photo, x, y, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function Env() {
  const { gl, scene } = useThree()
  useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl)
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.9
  }, [gl, scene])
  return null
}

/**
 * Centres whatever it holds and walks the camera in until the device fills the
 * frame. Runs inside the Suspense boundary, so by the time it measures, the
 * model is loaded and scaled.
 */
function Fit({ children }: { children: ReactNode }) {
  const outer = useRef<THREE.Group>(null)
  const { camera } = useThree()
  useLayoutEffect(() => {
    const g = outer.current!
    g.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(g)
    const c = box.getCenter(new THREE.Vector3())
    g.position.sub(c)
    g.updateWorldMatrix(true, true)
    box.setFromObject(g)
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (i) =>
        new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ),
    )
    let d = 20
    for (let it = 0; it < 6; it++) {
      camera.position.set(0, 0, d)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      let ext = 0
      for (const p of corners) {
        const v = p.clone().project(camera)
        ext = Math.max(ext, Math.abs(v.x), Math.abs(v.y))
      }
      d *= ext / 0.9
    }
    camera.position.set(0, 0, d)
    camera.updateMatrixWorld()
    requestAnimationFrame(() =>
      requestAnimationFrame(() => ((window as unknown as { __ready: boolean }).__ready = true)),
    )
  }, [camera])
  return <group ref={outer}>{children}</group>
}

function App() {
  const tex = useMemo(() => wallpaper(spec.screenAspect), [])
  const [pitch, yaw] = POSE[spec.kind] ?? POSE.phone
  return (
    <Canvas
      camera={{ fov: 16, near: 0.1, far: 500 }}
      gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0)
        gl.toneMapping = THREE.ACESFilmicToneMapping
      }}
    >
      <Env />
      <directionalLight position={[-3, 5, 6]} intensity={1.4} />
      <Suspense fallback={null}>
        <Fit>
          <group rotation={[THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), 0]}>
            <GltfDevice model={spec.model!} texture={tex} emptyColor="#111" tint={null} onPick={() => {}} />
          </group>
        </Fit>
      </Suspense>
    </Canvas>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
