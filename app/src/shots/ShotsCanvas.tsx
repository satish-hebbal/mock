import { useEffect, useRef, useState } from 'react'
import { endEditRun } from '../lib/history'
import { useShots } from './store'
import { CaptureFlash } from '../components/CaptureFlash'
import { UploadPrompt } from '../components/UploadPrompt'
import { computeLayout, perspectiveFor, type CardLayout } from './layout'
import { cardStyleCss, getCardStyle, stackShade } from './cardStyles'
import { getShadowScene, goboTransform } from './shadows'
import {
  portraitGeometry,
  portraitMaskCss,
  portraitOf,
  portraitPasses,
  type PortraitGeometry,
} from './portrait'
import { ALPHA_CHECKER } from '../lib/checker'
import { bgCss } from './backgroundCss'
import { paintOrder } from './types'
import type { ShotsDoc, ShotsGobo, ShotsImage } from './types'

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

// ————— the screenshot card (device bezel + frame chrome + image), mirrors render.ts —————

function Card({ img, url, f, L }: { img: ShotsImage; url: string; f: number; L: CardLayout }) {
  const dark = img.frame === 'macos-dark' || img.frame === 'browser-dark'
  const browser = img.frame.startsWith('browser')
  const dot = Math.max(2.5, L.barH * f * 0.13)
  const rx = img.style3d ? img.rotateX : 0
  const ry = img.style3d ? img.rotateY : 0

  /*
   * The mount, skipped when a device frame is on. A border or a paper stack
   * wrapped round a photograph of a phone reads as a mistake, and the exporter
   * makes the same call from the same condition.
   *
   * The stack copies live inside this element rather than beside it so they
   * inherit its transform: rotate the card and its stack turns with it, for
   * free, which a sibling would not do.
   */
  const style = getCardStyle(img.cardStyle)
  const mounted = !L.bezel
  const cw = L.cardW * f

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
      {mounted &&
        style.stack &&
        Array.from({ length: style.stack.count }, (_, i) => {
          const k = style.stack!.count - i
          const inset = style.stack!.shrink * cw * k
          const sh = stackShade(k)
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: L.screenX * f + inset + style.stack!.dx * cw * k,
                top: L.screenY * f + style.stack!.dy * cw * k,
                width: L.screenW * f - inset * 2,
                height: L.screenH * f,
                borderRadius: L.screenRadiusPx * f,
                background: style.stack!.color,
                boxShadow: `0 ${sh.dy * cw}px ${sh.blur * cw}px ${sh.color}`,
              }}
            />
          )
        })}

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
          boxShadow: mounted ? cardStyleCss(style, cw) : undefined,
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
 * A shadow scene, laid across the frame.
 *
 * The asset is flat black with its darkness already in alpha, so this is a
 * plain image at an opacity rather than a blend mode, and the exporter draws
 * the very same file the very same way.
 *
 * `background-size: cover` then `transform` matches the canvas side exactly:
 * cover-fit, then the user's zoom, then a rotation that carries its own
 * |cos| + |sin| compensation so the layer never swings its corners into frame.
 */
function ShadowSceneLayer({ gobo }: { gobo: ShotsGobo }) {
  const scene = getShadowScene(gobo.id)
  if (!scene) return null
  const { rad, scale } = goboTransform(gobo)
  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-lg bg-cover bg-center"
      style={{
        backgroundImage: `url(${scene.src})`,
        opacity: gobo.opacity,
        transform:
          `translate(${gobo.x * 100}%, ${gobo.y * 100}%) ` +
          `rotate(${(rad * 180) / Math.PI}deg) scale(${scale})`,
      }}
    />
  )
}

/**
 * The out-of-focus region, drawn as glass laid over the finished picture.
 *
 * `backdrop-filter` blurs what is already behind the element, so the scene is
 * rendered once and never duplicated. A radial mask that is transparent over
 * the focal core keeps the subject sharp, and stacking the passes reproduces
 * the exporter's chain of blurs because each layer's backdrop includes the one
 * below it.
 */
function PortraitOverlay({ g }: { g: PortraitGeometry }) {
  const passes = portraitPasses(g)
  return (
    <>
      {passes.map((p, i) => {
        const mask = portraitMaskCss(g, p.inner, p.outer)
        return (
          /*
             `rounded-lg` on the layer itself, not just on the scene around it.
             A backdrop-filtered element paints its result into its own border
             box, and that paint is not clipped by an ancestor's rounded
             `overflow: hidden`, so the corners of the shot came back square the
             moment the lens was switched on. Matching the radius here puts them
             back.
          */
          <div
            key={i}
            className="pointer-events-none absolute inset-0 rounded-lg"
            style={{
              backdropFilter: `blur(${p.blur}px)`,
              WebkitBackdropFilter: `blur(${p.blur}px)`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        )
      })}
    </>
  )
}

function StageOverlay({ g }: { g: PortraitGeometry }) {
  const mask = portraitMaskCss(g, g.inner, g.outer)
  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-lg"
      style={{
        background: `rgba(0,0,0,${g.darkness})`,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  )
}

/**
 * The focal point, as something you drag rather than two more sliders.
 *
 * Where the focus sits is a decision about the picture, so it is made on the
 * picture. The dashed ring is the sharp core and the outer ring is where the
 * falloff finishes, which makes "radius" and "feather" legible without reading
 * their numbers.
 */
function PortraitHandle({
  g,
  width,
  height,
}: {
  g: PortraitGeometry
  width: number
  height: number
}) {
  const setPortrait = useShots((s) => s.setPortrait)
  const ref = useRef<HTMLDivElement>(null)

  const move = (e: React.PointerEvent) => {
    const box = ref.current?.parentElement?.getBoundingClientRect()
    if (!box) return
    setPortrait({
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / Math.max(1, width))),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / Math.max(1, height))),
    })
  }

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      <div
        className="absolute rounded-full border border-dashed border-white/45"
        style={{
          left: g.cx - g.outer,
          top: g.cy - g.outer,
          width: g.outer * 2,
          height: g.outer * 2,
        }}
      />
      <div
        className="absolute rounded-full border border-white/70"
        style={{
          left: g.cx - g.inner,
          top: g.cy - g.inner,
          width: g.inner * 2,
          height: g.inner * 2,
        }}
      />
      <div
        onPointerDown={(e) => {
          // grabbing the handle is not a click on the canvas, so it must not
          // reach the dismissal listener on the way up
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          move(e)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e)
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId)
          endEditRun()
        }}
        title="Drag to move the focal point"
        className="pointer-events-auto absolute h-6 w-6 cursor-grab rounded-full border-2 border-white bg-white/25 shadow-[0_1px_6px_rgba(0,0,0,0.6)] backdrop-blur-sm active:cursor-grabbing"
        style={{ left: g.cx - 12, top: g.cy - 12 }}
      />
    </div>
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
  effects = true,
}: {
  doc: ShotsDoc
  width: number
  height: number
  interactive?: boolean
  /**
   * Draw the whole-frame effects: the shadow scene and the depth of field.
   *
   * Off for the layout-preset thumbnails. Those exist to answer one question,
   * where the screens sit, and both effects are global, so every preset renders
   * them identically and none of them help you choose. They are also by far the
   * most expensive things on the panel: `backdrop-filter` is near the top of
   * the list of costly CSS, and the preset picker was paying for two of them
   * per thumbnail, several thumbnails over, on every keystroke of every slider.
   */
  effects?: boolean
}) {
  const assets = useShots((s) => s.assets)
  const guide = useShots((s) => s.focusGuide)
  const { width: W, height: H } = doc.size
  const f = width / W

  const bg = doc.background
  const bgImageUrl = bg.imageAssetId ? (assets[bg.imageAssetId]?.url ?? null) : null
  const alpha = bg.type === 'transparent'
  /*
   * An empty shot shows the checkerboard, whatever background is set.
   *
   * A wallpaper with nothing on it is just a coloured rectangle, and a big one:
   * it reads as the shot, so the canvas looks finished when it is in fact
   * empty. The checkerboard has one job, saying "nothing here", which is
   * exactly the state. The chosen background comes back the moment a screen
   * lands on it.
   */
  const bare = alpha || doc.images.length === 0
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

  // geometry is measured against the surface being drawn, so the same document
  // gives the same picture at 640px on screen and 3200px in the export
  const gobo = doc.gobo
  const portrait = portraitOf(doc.portrait)
  const geo = portraitGeometry(portrait, width, height)

  /*
   * `isolate` pins the backdrop root to the shot itself. Without it the lens
   * layer samples whatever is painted behind the scene as well, and since the
   * working surface picked up a dot grid, that texture would smear into the
   * out-of-focus corners of the picture.
   */
  return (
    <div className="relative isolate overflow-hidden rounded-lg" style={{ width, height }}>
      {/* background — the checkerboard takes no blur/vignette, matching the exporter */}
      <div
        className="absolute inset-0"
        style={
          bare
            ? ALPHA_CHECKER
            : { ...bgCss(bg, bgImageUrl), filter: bgFilter, transform: `scale(${1.08 * bgZoom})` }
        }
      />
      {!bare && bg.vignette > 0 && (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at 50% 50%, transparent 45%, rgba(0,0,0,${bg.vignette * 0.65}) 100%)`,
          }}
        />
      )}

      {/* the shadow lands on the background alone when it sits under the screens */}
      {effects && gobo?.placement === 'under' && gobo.id !== 'none' && <ShadowSceneLayer gobo={gobo} />}

      {/* screens, painted back-to-front */}
      {paintOrder(doc.images).map((img) => (
        <ScreenInstance key={img.id} img={img} doc={doc} W={W} H={H} f={f} interactive={interactive} />
      ))}

      {effects && gobo?.placement === 'over' && gobo.id !== 'none' && <ShadowSceneLayer gobo={gobo} />}

      {/*
        Depth of field goes over everything, background and screens alike. The
        two layers are driven off the geometry rather than off the mode, so
        running them together is just both being non-zero, and the shade lands
        after the blur exactly as it does in the exporter.
      */}
      {effects && geo.blur > 0 && <PortraitOverlay g={geo} />}
      {effects && geo.darkness > 0 && <StageOverlay g={geo} />}
      {interactive && portrait.mode !== 'none' && guide && (
        <PortraitHandle g={geo} width={width} height={height} />
      )}

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
export function ShotsPreview({ doc, effects = true }: { doc: ShotsDoc; effects?: boolean }) {
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
      {width > 0 && <ShotsScene doc={doc} width={width} height={height} effects={effects} />}
    </div>
  )
}

export function ShotsCanvas() {
  const doc = useShots((s) => s.doc)
  const outerRef = useRef<HTMLDivElement>(null)
  const rect = useFitRect(outerRef, doc.size.width / doc.size.height)

  return (
    <div
      ref={outerRef}
      /*
       * A click anywhere that isn't the handle dismisses the focal rings. They
       * are scaffolding for one decision, and once it's made they sit on top of
       * the picture you are trying to judge. Any portrait control brings them
       * straight back, so nothing is lost by putting them away.
       */
      onPointerDown={() => useShots.getState().setFocusGuide(false)}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
    >
      <ShotsScene doc={doc} width={rect.width} height={rect.height} interactive />
      {doc.images.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          {/* clipped to the frame, so the rings live inside the checkerboard */}
          <div
            className="relative flex items-center justify-center overflow-hidden rounded-xl"
            style={{ width: rect.width, height: rect.height }}
          >
            <AttractRings />
            <UploadPrompt onFiles={(fs) => void useShots.getState().importMediaFiles(fs)} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Pill-shaped rings closing in on the empty-state prompt.
 *
 * An empty canvas gives the eye nothing to land on, and the one thing worth
 * doing there is dropping a file in. Concentric rings that travel *inward*
 * point at the prompt instead of away from it, and echoing the prompt's own
 * pill shape makes them read as belonging to it rather than as decoration
 * that happens to be nearby.
 *
 * Each ring runs the same animation on a stagger, so the sequence never has a
 * gap or a moment where two rings sit on top of each other. Purely decorative,
 * so it is hidden from assistive tech and sits behind the prompt.
 */
function AttractRings() {
  const count = 4
  const seconds = 5
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="absolute rounded-full border border-(--line2)"
          /*
           * Sized against the frame rather than in pixels, so the widest ring
           * is always just inside it. An absolute width overshot on smaller
           * canvases and only its top and bottom edges stayed on screen, which
           * read as two drifting horizontal lines instead of a closing ring.
           */
          style={{
            width: '86%',
            height: '74%',
            animation: `attract-in ${seconds}s cubic-bezier(0.33, 0, 0.2, 1) ${(i * seconds) / count}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

function hexA(hex: string, a: number): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex)
  if (!m) return `rgba(0,0,0,${a})`
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`
}
