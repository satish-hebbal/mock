import { useEffect, useRef, useState } from 'react'
import { useShots } from './store'
import { CaptureFlash } from '../components/CaptureFlash'
import { computeLayout, perspectiveFor, type CardLayout } from './layout'
import { getWallpaper, gradientCss } from './wallpapers'
import { meshGradientDataURL } from '../lib/meshGradient'
import { ALPHA_CHECKER } from '../lib/checker'
import type { ShotsBackground, ShotsDoc, ShotsImage } from './types'

function useFitRect(outer: React.RefObject<HTMLDivElement | null>, aspect: number) {
  const [rect, setRect] = useState({ width: 640, height: 400 })
  useEffect(() => {
    const el = outer.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const pad = 28
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

function bgCss(bg: ShotsBackground, imageUrl: string | null): React.CSSProperties {
  switch (bg.type) {
    case 'transparent':
      return ALPHA_CHECKER
    case 'solid':
      return { background: bg.color }
    case 'gradient':
      return { background: gradientCss(bg.gradient) }
    case 'wallpaper':
      return { background: gradientCss(getWallpaper(bg.wallpaperId).gradient) }
    case 'mesh':
      return {
        backgroundImage: `url(${meshGradientDataURL(bg.mesh.seed, bg.mesh.colors)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    case 'image':
      return imageUrl
        ? { backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: '#15151b' }
  }
}

// ————— the screenshot card (device bezel + frame chrome + image), mirrors render.ts —————

function Card({ img, url, f, L }: { img: ShotsImage; url: string; f: number; L: CardLayout }) {
  const dark = img.frame === 'macos-dark' || img.frame === 'browser-dark'
  const browser = img.frame.startsWith('browser')
  const dot = Math.max(2.5, L.barH * f * 0.13)
  const rx = img.style3d ? img.rotateX : 0
  const ry = img.style3d ? img.rotateY : 0

  return (
    <div
      style={{
        width: L.cardW * f,
        height: L.cardH * f,
        position: 'relative',
        transformOrigin: 'center',
        transform: `perspective(${perspectiveFor(L.cardW) * f}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${img.rotate}deg)`,
      }}
    >
      {/* screen */}
      <div
        style={{
          position: 'absolute',
          left: L.screenX * f,
          top: L.screenY * f,
          width: L.screenW * f,
          height: L.screenH * f,
          borderRadius: L.screenRadiusPx * f,
          overflow: 'hidden',
          border: L.borderPx > 0 ? `${L.borderPx * f}px solid ${img.border.color}` : undefined,
          background: dark ? '#0c0c10' : '#fff',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {L.barH > 0 && (
          <div
            style={{
              height: L.barH * f,
              flexShrink: 0,
              background: dark ? '#2b2b31' : '#f4f4f6',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: L.barH * f * 0.55,
              gap: dot * 1.1,
            }}
          >
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <span key={c} style={{ width: dot * 2, height: dot * 2, borderRadius: '50%', background: c }} />
            ))}
            {browser && (
              <span
                style={{
                  marginLeft: L.barH * f * 0.5,
                  flex: 1,
                  height: L.barH * f * 0.48,
                  marginRight: L.barH * f * 0.6,
                  borderRadius: 9999,
                  background: dark ? '#3c3c44' : '#e4e4ea',
                }}
              />
            )}
          </div>
        )}
        {/* cover, so a device's screen aspect crops the shot instead of squashing it */}
        <img src={url} alt="" draggable={false} style={{ width: '100%', flex: 1, objectFit: 'cover', minHeight: 0 }} />
      </div>

      {/*
       * The frame sits over the screen box above (which clips itself to the
       * cutout's radius). The island and camera are opaque pixels inside the
       * cutout, so they overlay the screenshot without any extra markup.
       */}
      {L.bezel && (
        <img
          src={L.bezel.src}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}

/**
 * One placed screen: reflection + shadow/glow + the (selectable) card.
 *
 * Deliberately draws no selected state. An outline on the canvas competes with
 * the shot you're judging, and the numbered thumbnail strip in the left panel
 * already says which screen the controls are pointed at.
 */
function ScreenInstance({ img, doc, W, H, f, interactive }: {
  img: ShotsImage
  doc: ShotsDoc
  W: number
  H: number
  f: number
  interactive: boolean
}) {
  const assets = useShots((s) => s.assets)
  const selectImage = useShots((s) => s.selectImage)
  const meta = doc.assets.find((a) => a.id === img.assetId)
  const url = assets[img.assetId]?.url
  if (!url || !meta) return null
  const layout = computeLayout(img, meta.w, meta.h, W, H, doc.zoom ?? 1)
  const minDim = Math.min(W, H)

  const dropShadow =
    img.shadow.opacity > 0 && img.shadow.blur > 0
      ? `drop-shadow(${img.shadow.x * minDim * f}px ${img.shadow.y * minDim * f}px ${img.shadow.blur * minDim * f}px ${hexA(img.shadow.color, img.shadow.opacity)})`
      : ''
  const glow =
    img.glow.strength > 0
      ? `drop-shadow(0 0 ${img.glow.strength * minDim * 0.14 * f}px ${img.glow.color}) drop-shadow(0 0 ${img.glow.strength * minDim * 0.14 * f}px ${img.glow.color})`
      : ''

  return (
    <>
      {img.reflection > 0 && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: layout.cx * f,
            top: (layout.cy + layout.cardH / 2) * f,
            width: layout.cardW * f,
            height: layout.cardH * f,
            marginLeft: (-layout.cardW * f) / 2,
            transform: 'scaleY(-1)',
            transformOrigin: 'top',
            opacity: img.reflection * 0.5,
            WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.9), transparent 55%)',
            maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.9), transparent 55%)',
          }}
        >
          <Card img={{ ...img, rotateX: 0, rotateY: 0 }} url={url} f={f} L={layout} />
        </div>
      )}
      <div
        className={interactive ? 'absolute cursor-pointer' : 'pointer-events-none absolute'}
        onPointerDown={interactive ? () => selectImage(img.id) : undefined}
        style={{
          left: layout.cx * f,
          top: layout.cy * f,
          marginLeft: (-layout.cardW * f) / 2,
          marginTop: (-layout.cardH * f) / 2,
          filter: `${glow} ${dropShadow}`.trim() || undefined,
          borderRadius: layout.outerRadiusPx * f,
        }}
      >
        <Card img={img} url={url} f={f} L={layout} />
      </div>
    </>
  )
}

/**
 * The composition itself, at whatever pixel size it's handed.
 *
 * Split out from the viewport so the layout-preset thumbnails can render the
 * *actual* shot — this screenshot, this background, this shadow — rather than a
 * drawn approximation. A preset picker that lies about the result is worse than
 * no picker, and a second renderer would drift from this one the first time
 * either changed.
 */
export function ShotsScene({
  doc,
  width,
  height,
  interactive = false,
}: {
  doc: ShotsDoc
  width: number
  height: number
  interactive?: boolean
}) {
  const assets = useShots((s) => s.assets)
  const { width: W, height: H } = doc.size
  const f = width / W

  const bg = doc.background
  const bgImageUrl = bg.imageAssetId ? (assets[bg.imageAssetId]?.url ?? null) : null
  const alpha = bg.type === 'transparent'
  const bgFilter =
    bg.blur > 0 || bg.brightness !== 1
      ? `blur(${(bg.blur * width) / 1280}px) brightness(${bg.brightness})`
      : undefined
  /*
   * The backdrop pushes in with the camera, so zooming magnifies the picture
   * rather than just the phones. It never goes below 1: pulling back would
   * otherwise shrink the backdrop off the frame edges, and a backdrop is meant
   * to be endless — pulling back just shows more of it.
   */
  const bgZoom = Math.max(1, doc.zoom ?? 1)

  return (
    <div className="relative overflow-hidden rounded-lg" style={{ width, height }}>
      {/* background — the checkerboard takes no blur/vignette, matching the exporter */}
      <div
        className="absolute inset-0"
        style={
          alpha
            ? bgCss(bg, bgImageUrl)
            : { ...bgCss(bg, bgImageUrl), filter: bgFilter, transform: `scale(${1.08 * bgZoom})` }
        }
      />
      {!alpha && bg.vignette > 0 && (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at 50% 50%, transparent 45%, rgba(0,0,0,${bg.vignette * 0.65}) 100%)`,
          }}
        />
      )}

      {/* screens, painted back-to-front */}
      {doc.images.map((img) => (
        <ScreenInstance key={img.id} img={img} doc={doc} W={W} H={H} f={f} interactive={interactive} />
      ))}

      {/* only the live canvas gets the shutter; the thumbnails aren't what you captured */}
      {interactive && <CaptureFlash />}
    </div>
  )
}

/**
 * A preview that fills whatever width it's given and takes the frame's own
 * aspect — square frame, square preview.
 *
 * ShotsScene needs real pixel dimensions (it scales the composition by
 * `width / doc.size.width`), so the container is measured rather than guessed.
 * Both preview spots used to hardcode a width, which left a strip of dead panel
 * beside them and lied about the shape of anything that wasn't 16:9.
 */
export function ShotsPreview({ doc }: { doc: ShotsDoc }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const height = Math.round((width * doc.size.height) / Math.max(1, doc.size.width))

  return (
    <div ref={ref} className="w-full">
      {width > 0 && <ShotsScene doc={doc} width={width} height={height} />}
    </div>
  )
}

export function ShotsCanvas() {
  const doc = useShots((s) => s.doc)
  const outerRef = useRef<HTMLDivElement>(null)
  const rect = useFitRect(outerRef, doc.size.width / doc.size.height)

  return (
    <div ref={outerRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <ShotsScene doc={doc} width={rect.width} height={rect.height} interactive />
      {doc.images.length === 0 && (
        <p className="pointer-events-none absolute rounded-full bg-black/50 px-4 py-2 t-body-sm text-white/90">
          Upload a screenshot to get started
        </p>
      )}
    </div>
  )
}

function hexA(hex: string, a: number): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex)
  if (!m) return `rgba(0,0,0,${a})`
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`
}
