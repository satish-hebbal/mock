import { useEffect, useRef, useState } from 'react'
import { useShots } from './store'
import { computeLayout, perspectiveFor, type CardLayout } from './layout'
import { getShotsDevice, type DeviceNotch } from './devices'
import { getWallpaper, gradientCss } from './wallpapers'
import { meshGradientDataURL } from '../lib/meshGradient'
import type { ShotsBackground, ShotsImage } from './types'

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

/**
 * Alpha checkerboard, drawn only in the preview — exports keep true alpha.
 * Built from theme surfaces so it stays a quiet backdrop for the shot rather
 * than a high-contrast grid competing with it.
 */
const CHECKER_SQUARE = 'color-mix(in srgb, var(--tx3) 12%, transparent)'
const CHECKER: React.CSSProperties = {
  backgroundColor: 'var(--panel2)',
  backgroundImage:
    `linear-gradient(45deg, ${CHECKER_SQUARE} 25%, transparent 25%, transparent 75%, ${CHECKER_SQUARE} 75%),` +
    `linear-gradient(45deg, ${CHECKER_SQUARE} 25%, transparent 25%, transparent 75%, ${CHECKER_SQUARE} 75%)`,
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 10px 10px',
}

function bgCss(bg: ShotsBackground, imageUrl: string | null): React.CSSProperties {
  switch (bg.type) {
    case 'transparent':
      return CHECKER
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

// ————— device notch overlay (mirrors drawNotch in render.ts) —————

function Notch({ notch, L, f }: { notch: DeviceNotch; L: CardLayout; f: number }) {
  const sw = L.screenW
  if (notch === 'island') {
    const w = sw * 0.3 * f
    const h = sw * 0.032 * f
    return (
      <span
        style={{
          position: 'absolute',
          top: (L.screenY + sw * 0.02) * f,
          left: (L.screenX + (sw - sw * 0.3) / 2) * f,
          width: w,
          height: h,
          borderRadius: h / 2,
          background: '#000',
        }}
      />
    )
  }
  if (notch === 'punch') {
    const r = sw * 0.016 * f
    return (
      <span
        style={{
          position: 'absolute',
          top: (L.screenY + sw * 0.032) * f - r,
          left: (L.screenX + sw / 2) * f - r,
          width: r * 2,
          height: r * 2,
          borderRadius: '50%',
          background: '#000',
        }}
      />
    )
  }
  if (notch === 'camera') {
    const r = Math.max(1.2, sw * 0.006) * f
    return (
      <span
        style={{
          position: 'absolute',
          top: (L.screenY - L.bezelPx * 0.5) * f - r,
          left: (L.screenX + sw / 2) * f - r,
          width: r * 2,
          height: r * 2,
          borderRadius: '50%',
          background: '#2a2a30',
        }}
      />
    )
  }
  return null
}

// ————— the screenshot card (device bezel + frame chrome + image), mirrors render.ts —————

function Card({ img, url, f, L }: { img: ShotsImage; url: string; f: number; L: CardLayout }) {
  const dark = img.frame === 'macos-dark' || img.frame === 'browser-dark'
  const browser = img.frame.startsWith('browser')
  const dot = Math.max(2.5, L.barH * f * 0.13)
  const rx = img.style3d ? img.rotateX : 0
  const ry = img.style3d ? img.rotateY : 0
  const hasDevice = !img.style3d && img.device !== 'none'
  const dev = getShotsDevice(hasDevice ? img.device : 'none')

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
      {/* device bezel */}
      {hasDevice && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: L.outerRadiusPx * f,
            background: dev.color,
            boxShadow: `inset 0 0 0 ${Math.max(1, L.bezelPx * 0.12 * f)}px ${dev.edge}`,
          }}
        />
      )}

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

      {hasDevice && <Notch notch={dev.notch} L={L} f={f} />}
    </div>
  )
}

/** One placed screen: reflection + shadow/glow + the (selectable) card. */
function ScreenInstance({ img, W, H, f, selected }: {
  img: ShotsImage
  W: number
  H: number
  f: number
  selected: boolean
}) {
  const assets = useShots((s) => s.assets)
  const meta = useShots((s) => s.doc.assets.find((a) => a.id === img.assetId))
  const selectImage = useShots((s) => s.selectImage)
  const url = assets[img.assetId]?.url
  if (!url || !meta) return null
  const layout = computeLayout(img, meta.w, meta.h, W, H)
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
        className="absolute cursor-pointer"
        onPointerDown={() => selectImage(img.id)}
        style={{
          left: layout.cx * f,
          top: layout.cy * f,
          marginLeft: (-layout.cardW * f) / 2,
          marginTop: (-layout.cardH * f) / 2,
          filter: `${glow} ${dropShadow}`.trim() || undefined,
          outline: selected ? '2px solid rgba(99,155,255,0.95)' : undefined,
          outlineOffset: 2,
          borderRadius: layout.outerRadiusPx * f,
        }}
      >
        <Card img={img} url={url} f={f} L={layout} />
      </div>
    </>
  )
}

export function ShotsCanvas() {
  const doc = useShots((s) => s.doc)
  const assets = useShots((s) => s.assets)
  const outerRef = useRef<HTMLDivElement>(null)
  const { width: W, height: H } = doc.size
  const rect = useFitRect(outerRef, W / H)
  const f = rect.width / W

  const bg = doc.background
  const bgImageUrl = bg.imageAssetId ? (assets[bg.imageAssetId]?.url ?? null) : null
  const alpha = bg.type === 'transparent'
  const bgFilter =
    bg.blur > 0 || bg.brightness !== 1
      ? `blur(${(bg.blur * rect.width) / 1280}px) brightness(${bg.brightness})`
      : undefined

  return (
    <div ref={outerRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <div
        className="relative overflow-hidden rounded-lg shadow-2xl"
        style={{ width: rect.width, height: rect.height }}
      >
        {/* background — the checkerboard takes no blur/vignette, matching the exporter */}
        <div
          className="absolute inset-0"
          style={
            alpha
              ? bgCss(bg, bgImageUrl)
              : { ...bgCss(bg, bgImageUrl), filter: bgFilter, transform: 'scale(1.08)' }
          }
        />
        {!alpha && bg.vignette > 0 && (
          <div
            className="absolute inset-0"
            style={{ background: `radial-gradient(circle at 50% 50%, transparent 45%, rgba(0,0,0,${bg.vignette * 0.65}) 100%)` }}
          />
        )}

        {/* screens, painted back-to-front */}
        {doc.images.map((img) => (
          <ScreenInstance
            key={img.id}
            img={img}
            W={W}
            H={H}
            f={f}
            selected={img.id === doc.selectedId && doc.images.length > 1}
          />
        ))}

        {doc.images.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="rounded-full bg-black/50 px-4 py-2 text-[12px] text-white/90">
              Upload a screenshot to get started
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function hexA(hex: string, a: number): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex)
  if (!m) return `rgba(0,0,0,${a})`
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`
}
