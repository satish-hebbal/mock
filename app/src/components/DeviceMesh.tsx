import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { getDevice, screenAspectFor, type DeviceSpec } from '../lib/registry'
import { rt } from '../lib/runtime'
import { useStudio } from '../store'
import type { DeviceInstance } from '../types'

// ————— shared geometry helpers —————

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  const rad = Math.min(r, w / 2, h / 2)
  s.moveTo(x + rad, y)
  s.lineTo(x + w - rad, y)
  s.absarc(x + w - rad, y + rad, rad, -Math.PI / 2, 0, false)
  s.lineTo(x + w, y + h - rad)
  s.absarc(x + w - rad, y + h - rad, rad, 0, Math.PI / 2, false)
  s.lineTo(x + rad, y + h)
  s.absarc(x + rad, y + h - rad, rad, Math.PI / 2, Math.PI, false)
  s.lineTo(x, y + rad)
  s.absarc(x + rad, y + rad, rad, Math.PI, Math.PI * 1.5, false)
  return s
}

function normalizeUVs(geo: THREE.BufferGeometry, w: number, h: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5)
  }
  uv.needsUpdate = true
  return geo
}

function screenGeo(w: number, h: number, r: number) {
  return normalizeUVs(new THREE.ShapeGeometry(roundedRect(w, h, r), 24), w, h)
}

function slabGeo(w: number, h: number, r: number, depth: number, bevel = 0.012) {
  const geo = new THREE.ExtrudeGeometry(roundedRect(w, h, r), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 24,
  })
  geo.translate(0, 0, -depth / 2)
  return geo
}

// ————— per-kind dimensions —————

interface Dims {
  screenW: number
  screenH: number
  screenR: number
  bodyW: number
  bodyH: number
  bodyR: number
  bodyD: number
  bevel: number
}

function dimsFor(spec: DeviceSpec, orientation: 'portrait' | 'landscape'): Dims {
  const aspect = screenAspectFor(spec, orientation)
  switch (spec.kind) {
    case 'phone': {
      const short = 0.94
      const w = aspect < 1 ? short : short * aspect
      const h = aspect < 1 ? short / aspect : short
      // classic phones get chunky bezels along the long axis
      const extra = spec.mask === 'none' ? 0.3 : 0.075
      return {
        screenW: w,
        screenH: h,
        screenR: 0.11,
        bodyW: w + (aspect < 1 ? 0.07 : extra),
        bodyH: h + (aspect < 1 ? extra : 0.07),
        bodyR: 0.15,
        bodyD: 0.075,
        bevel: 0.012,
      }
    }
    case 'tablet': {
      const width = aspect < 1 ? 1.6 : 2.1
      const height = width / aspect
      return {
        screenW: width,
        screenH: height,
        screenR: 0.07,
        bodyW: width + 0.12,
        bodyH: height + 0.12,
        bodyR: 0.12,
        bodyD: 0.06,
        bevel: 0.01,
      }
    }
    case 'laptop': {
      const width = 2.7
      return {
        screenW: width,
        screenH: width / aspect,
        screenR: 0.03,
        bodyW: width + 0.16,
        bodyH: width / aspect + 0.14,
        bodyR: 0.08,
        bodyD: 0.045,
        bevel: 0.008,
      }
    }
    case 'monitor': {
      const width = 3.1
      return {
        screenW: width,
        screenH: width / aspect,
        screenR: 0.04,
        bodyW: width + 0.1,
        bodyH: width / aspect + 0.1,
        bodyR: 0.08,
        bodyD: 0.09,
        bevel: 0.012,
      }
    }
    case 'tv': {
      const width = 4.0
      return {
        screenW: width,
        screenH: width / aspect,
        screenR: 0.015,
        bodyW: width + 0.08,
        bodyH: width / aspect + 0.08,
        bodyR: 0.03,
        bodyD: 0.06,
        bevel: 0.008,
      }
    }
    case 'watch': {
      // round face (aspect ~1) gets a fully circular screen/body radius
      const round = Math.abs(aspect - 1) < 0.05
      return {
        screenW: 0.62,
        screenH: 0.62 / aspect,
        screenR: round ? 0.31 : 0.2,
        bodyW: 0.72,
        bodyH: 0.62 / aspect + 0.1,
        bodyR: round ? 0.36 : 0.26,
        bodyD: 0.1,
        bevel: 0.018,
      }
    }
    case 'browser': {
      const width = 3.2
      const contentH = width / aspect
      return {
        screenW: width - 0.06,
        screenH: contentH,
        screenR: 0.02,
        bodyW: width,
        bodyH: contentH + 0.24,
        bodyR: 0.07,
        bodyD: 0.03,
        bevel: 0.004,
      }
    }
    case 'card': {
      const width = 2.6
      return {
        screenW: width,
        screenH: width / aspect,
        screenR: 0.1,
        bodyW: width,
        bodyH: width / aspect,
        bodyR: 0.1,
        bodyD: 0.02,
        bevel: 0.003,
      }
    }
  }
}

// ————— screen texture hook —————

function useScreenTexture(dev: DeviceInstance, screenAspect: number) {
  const asset = useStudio((s) => (dev.screen.assetId ? s.assets[dev.screen.assetId] : undefined))
  const assetId = dev.screen.assetId
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  // Only the runtime asset (blob URL) is required — media dimensions are read
  // from the decoded image/video itself. Depending on the project.assets meta
  // entry made a missing/mismatched entry silently blank the whole screen.
  useEffect(() => {
    if (!asset || !assetId) {
      setTexture(null)
      return
    }
    let cancelled = false
    let tex: THREE.Texture | null = null
    let video: HTMLVideoElement | null = null

    const setup = (t: THREE.Texture, mediaW: number, mediaH: number) => {
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
      const ia = Math.max(0.01, mediaW) / Math.max(1, mediaH)
      const sa = screenAspect || ia
      let scrollRange = 0
      if (dev.screen.fit === 'contain') {
        t.repeat.set(1, 1)
        t.offset.set(0, 0)
      } else if (ia > sa) {
        const rx = sa / ia
        t.repeat.set(rx, 1)
        t.offset.set((1 - rx) / 2, 0)
      } else {
        const ry = ia / sa
        t.repeat.set(1, ry)
        t.offset.set(0, (1 - ry) / 2)
        scrollRange = 1 - ry
      }
      if (!cancelled) {
        rt.screens.set(dev.id, { texture: t, scrollRange })
        setTexture(t)
      }
    }

    if (asset.kind === 'video') {
      video = document.createElement('video')
      video.src = asset.url
      video.muted = true
      video.loop = true
      video.playsInline = true
      video.crossOrigin = 'anonymous'
      void video.play().catch(() => {})
      const vt = new THREE.VideoTexture(video)
      tex = vt
      rt.videos.set(assetId, video)
      const applyVideo = () => setup(vt, video!.videoWidth || 1080, video!.videoHeight || 1920)
      if (video.readyState >= 1) applyVideo()
      else video.addEventListener('loadedmetadata', applyVideo, { once: true })
    } else {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => {
        if (cancelled) return
        const t = new THREE.Texture(img)
        t.needsUpdate = true
        tex = t
        setup(t, img.naturalWidth || 1, img.naturalHeight || 1)
      }
      img.onerror = (e) => console.error('[screen texture] failed to load', asset.url, e)
      img.src = asset.url
    }

    return () => {
      cancelled = true
      rt.screens.delete(dev.id)
      if (video) {
        video.pause()
        rt.videos.delete(assetId)
        video.src = ''
      }
      tex?.dispose()
    }
  }, [asset, assetId, dev.id, dev.screen.fit, screenAspect])

  return texture
}

// ————— browser chrome texture —————

function browserChromeTexture(dark: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 76
  const ctx = c.getContext('2d')!
  ctx.fillStyle = dark ? '#2b2b31' : '#f2f2f5'
  ctx.fillRect(0, 0, c.width, c.height)
  const dots = ['#ff5f57', '#febc2e', '#28c840']
  dots.forEach((color, i) => {
    ctx.beginPath()
    ctx.arc(34 + i * 30, 38, 8, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  })
  ctx.fillStyle = dark ? '#3c3c44' : '#e2e2e8'
  const rw = 620
  const rx = (c.width - rw) / 2
  ctx.beginPath()
  ctx.roundRect(rx, 16, rw, 44, 22)
  ctx.fill()
  ctx.fillStyle = dark ? '#9a9aa4' : '#8e8e98'
  ctx.font = '26px system-ui'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('yourapp.com', c.width / 2, 39)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// ————— main component —————

const EMPTY_SCREEN_COLOR = '#0b0b10'

export function DeviceMesh({ device }: { device: DeviceInstance }) {
  const spec = getDevice(device.modelId)
  const aspect = screenAspectFor(spec, device.orientation)
  const dims = useMemo(() => dimsFor(spec, device.orientation), [spec, device.orientation])
  const texture = useScreenTexture(device, aspect)
  const selectDevice = useStudio((s) => s.selectDevice)

  const colorValue = spec.colors.find((c) => c.id === device.colorVariant)?.value ?? '#3a3a3e'

  // register the group for the deterministic evaluator
  const [group, setGroup] = useState<THREE.Group | null>(null)
  useEffect(() => {
    if (!group) return
    rt.deviceGroups.set(device.id, group)
    return () => {
      rt.deviceGroups.delete(device.id)
    }
  }, [group, device.id])

  const onPick = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    selectDevice(device.id)
  }

  const body = useMemo(() => {
    if (spec.kind === 'card') return null
    return slabGeo(dims.bodyW, dims.bodyH, dims.bodyR, dims.bodyD, dims.bevel)
  }, [spec.kind, dims])

  const screen = useMemo(
    () => screenGeo(dims.screenW, dims.screenH, dims.screenR),
    [dims.screenW, dims.screenH, dims.screenR],
  )

  // Seat the screen flush on the body's front face, just proud of it so the
  // frame's beveled edge wraps around it like a real device. The body's front
  // cap is NOT at bodyD/2 — ExtrudeGeometry's bevel extrudes the outer contour
  // beyond the flat depth by roughly `bevel`, so the true outermost surface
  // sits at bodyD/2 + bevel. A screen offset that didn't clear the bevel sat
  // embedded inside that beveled geometry and was permanently occluded by it.
  const screenZ = dims.bodyD / 2 + dims.bevel + 0.001

  const chromeTex = useMemo(
    () => (spec.kind === 'browser' ? browserChromeTexture(spec.id.includes('dark')) : null),
    [spec.kind, spec.id],
  )

  const laptopBase = useMemo(
    () => (spec.kind === 'laptop' ? slabGeo(dims.bodyW + 0.35, 1.95, 0.07, 0.05, 0.01) : null),
    [spec.kind, dims.bodyW],
  )

  // Key by the texture identity so the material fully remounts when the image
  // arrives. Merely setting `material.map` after first compile doesn't add the
  // map sampler to an already-compiled shader, so the texture never showed —
  // a fresh material is compiled *with* the map and renders it.
  //
  // FrontSide only: the body encloses the screen from every other angle now
  // that screenZ correctly clears the bevel, and this quad has zero thickness.
  // DoubleSide made both its faces render at once at grazing/behind angles,
  // superimposing the (mirrored) back face over the front as a ghostly
  // see-through double-exposure.
  const screenMat = (
    <meshBasicMaterial
      key={texture ? texture.uuid : 'empty'}
      map={texture ?? null}
      color={texture ? '#ffffff' : EMPTY_SCREEN_COLOR}
      toneMapped={false}
    />
  )

  const bodyMat = <meshStandardMaterial color={colorValue} metalness={0.75} roughness={0.34} />

  // island / punch mask geometry
  const mask = useMemo(() => {
    if (spec.mask === 'island') return new THREE.ShapeGeometry(roundedRect(0.26, 0.07, 0.035), 16)
    if (spec.mask === 'punch') return new THREE.CircleGeometry(0.025, 24)
    return null
  }, [spec.mask])

  const isPortrait = device.orientation === 'portrait' || !spec.canRotate

  switch (spec.kind) {
    case 'laptop': {
      const baseD = 1.95
      const lidAngle = -0.24 // lean back ~14°
      const hingeZ = -baseD / 2 + 0.06
      return (
        <group ref={setGroup} onPointerDown={onPick}>
          {/* base */}
          <mesh geometry={laptopBase ?? undefined} rotation-x={-Math.PI / 2} position-y={-1.0}>
            {bodyMat}
          </mesh>
          {/* lid, hinged at rear */}
          <group position={[0, -0.98, hingeZ]} rotation-x={lidAngle}>
            <mesh geometry={body ?? undefined} position-y={dims.bodyH / 2}>
              {bodyMat}
            </mesh>
            <mesh geometry={screen} position={[0, dims.bodyH / 2, screenZ]}>
              {screenMat}
            </mesh>
          </group>
        </group>
      )
    }
    case 'monitor': {
      return (
        <group ref={setGroup} onPointerDown={onPick}>
          <mesh geometry={body ?? undefined} position-y={0.25}>
            {bodyMat}
          </mesh>
          <mesh geometry={screen} position={[0, 0.25, screenZ]}>
            {screenMat}
          </mesh>
          {/* stand */}
          <mesh position={[0, -0.85, -0.06]}>
            <boxGeometry args={[0.32, 0.9, 0.06]} />
            {bodyMat}
          </mesh>
          <mesh position={[0, -1.27, 0.12]} rotation-x={-Math.PI / 2}>
            <cylinderGeometry args={[0.42, 0.42, 0.03, 32]} />
            {bodyMat}
          </mesh>
        </group>
      )
    }
    case 'tv': {
      return (
        <group ref={setGroup} onPointerDown={onPick}>
          <mesh geometry={body ?? undefined} position-y={0.35}>
            {bodyMat}
          </mesh>
          <mesh geometry={screen} position={[0, 0.35, screenZ]}>
            {screenMat}
          </mesh>
          {/* pedestal stand */}
          <mesh position={[0, dims.bodyH / -2 + 0.35 - 0.5, -0.04]}>
            <boxGeometry args={[0.5, 0.5, 0.08]} />
            {bodyMat}
          </mesh>
          <mesh position={[0, dims.bodyH / -2 + 0.35 - 0.75, 0.16]} rotation-x={-Math.PI / 2}>
            <boxGeometry args={[1.5, 0.5, 0.04]} />
            {bodyMat}
          </mesh>
        </group>
      )
    }
    case 'watch': {
      return (
        <group ref={setGroup} onPointerDown={onPick}>
          <mesh geometry={body ?? undefined}>{bodyMat}</mesh>
          <mesh geometry={screen} position-z={screenZ}>
            {screenMat}
          </mesh>
          {/* crown */}
          <mesh position={[dims.bodyW / 2 + 0.03, 0.14, 0]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.035, 0.035, 0.05, 16]} />
            {bodyMat}
          </mesh>
          {/* band stubs */}
          <mesh position={[0, dims.bodyH / 2 + 0.22, -0.01]}>
            <boxGeometry args={[0.4, 0.48, 0.05]} />
            <meshStandardMaterial color="#26262b" roughness={0.8} />
          </mesh>
          <mesh position={[0, -dims.bodyH / 2 - 0.22, -0.01]}>
            <boxGeometry args={[0.4, 0.48, 0.05]} />
            <meshStandardMaterial color="#26262b" roughness={0.8} />
          </mesh>
        </group>
      )
    }
    case 'browser': {
      const barH = 0.24
      return (
        <group ref={setGroup} onPointerDown={onPick}>
          <mesh geometry={body ?? undefined}>
            <meshStandardMaterial color={colorValue} metalness={0.1} roughness={0.6} />
          </mesh>
          {/* chrome bar */}
          <mesh position={[0, dims.bodyH / 2 - barH / 2 - 0.005, screenZ]}>
            <planeGeometry args={[dims.bodyW - 0.02, barH - 0.015]} />
            {chromeTex ? <meshBasicMaterial map={chromeTex} toneMapped={false} /> : bodyMat}
          </mesh>
          <mesh geometry={screen} position={[0, -barH / 2 + 0.005, screenZ]}>
            {screenMat}
          </mesh>
        </group>
      )
    }
    case 'card': {
      return (
        <group ref={setGroup} onPointerDown={onPick}>
          <mesh geometry={screen}>{screenMat}</mesh>
        </group>
      )
    }
    default: {
      // phone / tablet
      const maskY = isPortrait ? dims.screenH / 2 - 0.09 : 0
      const maskX = isPortrait ? 0 : -dims.screenW / 2 + 0.09
      return (
        <group ref={setGroup} onPointerDown={onPick}>
          <mesh geometry={body ?? undefined}>{bodyMat}</mesh>
          <mesh geometry={screen} position-z={screenZ}>
            {screenMat}
          </mesh>
          {mask && (
            <mesh
              geometry={mask}
              position={[maskX, maskY, screenZ + 0.001]}
              rotation-z={isPortrait ? 0 : Math.PI / 2}
            >
              <meshBasicMaterial color="#000000" toneMapped={false} />
            </mesh>
          )}
        </group>
      )
    }
  }
}
