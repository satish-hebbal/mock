import { Vector2 } from 'three'
import { applyPortrait } from './portrait'
import { applyAtTime, renderFrame, rt, setEditorObjectsVisible } from './runtime'
import { paintMeshGradient } from './meshGradient'
import { getWallpaper } from './wallpapers'
import { getPresetPhoto } from './presetPhotos'
import { gradeFilter } from './grade'
import { rgba } from './color'
import { activeShot, planFrames, sequenceLayout } from './sequence'
import { useStudio } from '../store'
import type { AssetRuntime, BackgroundState, Overlay, ProjectDoc, Shot, SweepSpec } from '../types'

// ----- Background compositing (preview CSS ⇄ export canvas parity) -----

function paintLinearGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  angle: number,
  from: string,
  to: string,
) {
  const rad = (angle * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const len = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
  const g = ctx.createLinearGradient(w / 2 - dx * len, h / 2 - dy * len, w / 2 + dx * len, h / 2 + dy * len)
  g.addColorStop(0, from)
  g.addColorStop(1, to)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

/**
 * The seamless sweep, in the same four passes the CSS preview uses: paper, the
 * pool of light the key throws on it, the falloff toward the floor, and the
 * corner hold. Elliptical gradients are done by scaling a circular one, which
 * canvas has no direct equivalent for.
 */
function paintSweep(ctx: CanvasRenderingContext2D, w: number, h: number, s: SweepSpec) {
  ctx.fillStyle = s.color
  ctx.fillRect(0, 0, w, h)

  const cy = h * s.hotY
  const hotW = w * s.spread
  const hotH = hotW * 0.75

  ctx.save()
  ctx.translate(w / 2, cy)
  ctx.scale(1, hotH / hotW)
  const hot = ctx.createRadialGradient(0, 0, 0, 0, 0, hotW)
  hot.addColorStop(0, s.hot)
  hot.addColorStop(0.7, rgba(s.hot, 0))
  hot.addColorStop(1, rgba(s.hot, 0))
  ctx.fillStyle = hot
  ctx.fillRect(-w, (-h * hotW) / hotH, w * 2, (h * 2 * hotW) / hotH)
  ctx.restore()

  if (s.floor > 0) {
    const floor = ctx.createLinearGradient(0, h * 0.46, 0, h)
    floor.addColorStop(0, 'rgba(0, 0, 0, 0)')
    floor.addColorStop(1, `rgba(0, 0, 0, ${s.floor})`)
    ctx.fillStyle = floor
    ctx.fillRect(0, 0, w, h)
  }

  if (s.vignette > 0) {
    const r = Math.max(w, h) * 0.75
    ctx.save()
    ctx.translate(w / 2, cy)
    ctx.scale(1, (h * 1.05) / (w * 1.2))
    const vig = ctx.createRadialGradient(0, 0, r * 0.42, 0, 0, r)
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)')
    vig.addColorStop(1, `rgba(0, 0, 0, ${s.vignette})`)
    ctx.fillStyle = vig
    ctx.fillRect(-w * 2, -h * 2, w * 4, h * 4)
    ctx.restore()
  }
}

/**
 * Fill the frame with an image, cropped to cover. Shared by the uploaded
 * backdrop and the shipped photo presets so the two crop identically.
 */
async function drawCover(ctx: CanvasRenderingContext2D, w: number, h: number, src: string | null) {
  if (!src) {
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, w, h)
    return
  }
  const img = new Image()
  img.src = src
  await img.decode()
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const dw = img.naturalWidth * scale
  const dh = img.naturalHeight * scale
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

async function paintBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bg: BackgroundState,
  assets: Record<string, AssetRuntime>,
  transparent: boolean,
) {
  if (transparent || bg.type === 'transparent') return
  ctx.save()
  if (bg.blur > 0 || bg.brightness !== 1) {
    ctx.filter = `blur(${(bg.blur * w) / 1280}px) brightness(${bg.brightness})`
  }
  switch (bg.type) {
    case 'solid':
      ctx.fillStyle = bg.color
      ctx.fillRect(-w * 0.05, -h * 0.05, w * 1.1, h * 1.1)
      break
    case 'gradient':
      if (bg.gradient.kind === 'radial') {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75)
        g.addColorStop(0, bg.gradient.from)
        g.addColorStop(1, bg.gradient.to)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      } else {
        paintLinearGradient(ctx, w, h, bg.gradient.angle, bg.gradient.from, bg.gradient.to)
      }
      break
    case 'wallpaper': {
      const g = getWallpaper(bg.wallpaperId).gradient
      if (g.kind === 'radial') {
        const rg = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, Math.max(w, h) * 0.75)
        rg.addColorStop(0, g.from)
        rg.addColorStop(1, g.to)
        ctx.fillStyle = rg
        ctx.fillRect(0, 0, w, h)
      } else {
        paintLinearGradient(ctx, w, h, g.angle, g.from, g.to)
      }
      break
    }
    case 'mesh':
      paintMeshGradient(ctx, w, h, bg.mesh)
      break
    case 'studio':
      paintSweep(ctx, w, h, bg.sweep)
      break
    case 'photo': {
      const photo = getPresetPhoto(bg.photoId)
      await drawCover(ctx, w, h, photo?.src ?? null)
      break
    }
    case 'image': {
      const asset = bg.imageAssetId ? assets[bg.imageAssetId] : null
      await drawCover(ctx, w, h, asset?.url ?? null)
      break
    }
  }
  ctx.restore()
}

// ----- Overlay compositing (PRD §6.7, rendered at export resolution) -----

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

async function drawOverlays(
  ctx: CanvasRenderingContext2D,
  overlays: Overlay[],
  assets: Record<string, AssetRuntime>,
  w: number,
  h: number,
) {
  for (const o of overlays) {
    ctx.save()
    ctx.globalAlpha = o.opacity
    ctx.translate(o.x * w, o.y * h)
    ctx.rotate((o.rotation * Math.PI) / 180)
    if (o.type === 'text') {
      const px = o.size * h
      ctx.font = `${o.weight} ${px}px "${o.font}", system-ui, sans-serif`
      ctx.textAlign = o.align
      ctx.textBaseline = 'middle'
      const lines = o.text.split('\n')
      const lineH = px * 1.25
      const startY = -((lines.length - 1) * lineH) / 2
      if (o.bg) {
        let maxW = 0
        for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line).width)
        const padX = px * 0.6
        const padY = px * 0.35
        const bw = maxW + padX * 2
        const bh = lines.length * lineH + padY * 2
        const bx = o.align === 'left' ? -padX : o.align === 'right' ? -bw + padX : -bw / 2
        ctx.fillStyle = o.bg
        rr(ctx, bx, -bh / 2, bw, bh, bh / 2)
        ctx.fill()
      }
      ctx.fillStyle = o.color
      lines.forEach((line, i) => ctx.fillText(line, 0, startY + i * lineH))
    } else if (o.type === 'shape') {
      const sw = o.width * w
      const sh = o.height * h
      ctx.fillStyle = o.color
      if (o.shape === 'ellipse') {
        ctx.beginPath()
        ctx.ellipse(0, 0, sw / 2, sh / 2, 0, 0, Math.PI * 2)
        ctx.fill()
      } else {
        rr(ctx, -sw / 2, -sh / 2, sw, sh, o.radius * h)
        ctx.fill()
      }
    } else if (o.type === 'image') {
      const asset = assets[o.assetId]
      if (asset) {
        const img = new Image()
        img.src = asset.url
        try {
          await img.decode()
          const dw = o.width * w
          const dh = dw * (img.naturalHeight / Math.max(1, img.naturalWidth))
          ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
        } catch {
          // skip broken asset
        }
      }
    }
    ctx.restore()
  }
}

/** Ensure every text overlay's font+weight is loaded before rasterizing (PRD §6.7). */
async function preloadOverlayFonts(overlays: Overlay[]) {
  if (!('fonts' in document)) return
  const jobs: Promise<unknown>[] = []
  for (const o of overlays) {
    if (o.type !== 'text') continue
    try {
      jobs.push(document.fonts.load(`${o.weight} 32px "${o.font}"`))
    } catch {
      // ignore unknown families, canvas falls back to system-ui
    }
  }
  await Promise.all(jobs).catch(() => {})
}

// ----- Renderer size management -----

interface RendererBackup {
  width: number
  height: number
  pixelRatio: number
  aspect: number
}

function resizeRenderer(width: number, height: number): RendererBackup | null {
  const { gl, camera, composer } = rt
  if (!gl || !camera) return null
  const size = gl.getSize(new Vector2())
  const prev: RendererBackup = {
    width: size.x,
    height: size.y,
    pixelRatio: gl.getPixelRatio(),
    aspect: camera.aspect,
  }
  gl.setPixelRatio(1)
  gl.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  composer?.setSize(width, height)
  return prev
}

function restoreRenderer(backup: RendererBackup) {
  const { gl, camera, composer } = rt
  if (!gl || !camera) return
  gl.setPixelRatio(backup.pixelRatio)
  gl.setSize(backup.width, backup.height, false)
  camera.aspect = backup.aspect
  camera.updateProjectionMatrix()
  composer?.setSize(backup.width, backup.height)
}

/** Seek all screen-bound videos to `timeMs` for deterministic export (PRD §11.1). */
async function seekVideos(timeMs: number) {
  const seeks: Promise<void>[] = []
  for (const video of rt.videos.values()) {
    if (!Number.isFinite(video.duration) || video.duration <= 0) continue
    const t = (timeMs / 1000) % video.duration
    if (Math.abs(video.currentTime - t) < 1 / 240) continue
    seeks.push(
      new Promise<void>((res) => {
        const done = () => {
          video.removeEventListener('seeked', done)
          res()
        }
        video.addEventListener('seeked', done)
        video.currentTime = t
        setTimeout(done, 350) // safety net
      }),
    )
  }
  await Promise.all(seeks)
  for (const handle of rt.screens.values()) handle.texture.needsUpdate = true
}

async function pauseVideos() {
  for (const v of rt.videos.values()) v.pause()
}
function resumeVideos() {
  for (const v of rt.videos.values()) void v.play().catch(() => {})
}

// ----- One composed frame -----

/**
 * The canvases a frame is built on, allocated once per export.
 *
 * `stage` holds the backdrop with the 3D render on top, which is the unit the
 * colour grade applies to; `out` is what gets encoded, and is where the lens
 * and the overlays land. Two canvases rather than one because the grade has to
 * apply to the backdrop and the devices *together*, the way the preview stacks
 * them, and a filter cannot be un-applied once something is drawn under it.
 */
interface FrameBufs {
  out: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  stage: HTMLCanvasElement
  sctx: CanvasRenderingContext2D
}

function makeBufs(width: number, height: number): FrameBufs {
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const stage = document.createElement('canvas')
  stage.width = width
  stage.height = height
  return {
    out,
    ctx: out.getContext('2d')!,
    stage,
    sctx: stage.getContext('2d')!,
  }
}

/**
 * Composite whatever the renderer last drew into a finished frame of `shot`.
 *
 * The order is the preview's order, and it is the reason a still and a frame of
 * the video of the same moment come out identical: backdrop, 3D, grade over
 * both, then the lens, then the overlays, which are stuck to the front of the
 * frame rather than being in the picture.
 */
async function composeFrame(
  b: FrameBufs,
  shot: Shot,
  assets: Record<string, AssetRuntime>,
  width: number,
  height: number,
  transparent: boolean,
) {
  b.sctx.clearRect(0, 0, width, height)
  await paintBackground(b.sctx, width, height, shot.scene.background, assets, transparent)
  if (rt.gl) b.sctx.drawImage(rt.gl.domElement, 0, 0, width, height)

  b.ctx.clearRect(0, 0, width, height)
  const gf = gradeFilter(shot.scene.effects.grade)
  if (gf) b.ctx.filter = gf
  b.ctx.drawImage(b.stage, 0, 0)
  b.ctx.filter = 'none'

  applyPortrait(b.out, shot.scene.effects.portrait)
  await drawOverlays(b.ctx, shot.overlays, assets, width, height)
}

/**
 * Drive the 3D renderer to one moment of one shot.
 *
 * With more than one motion-blur sample this renders the shot several times
 * across the open-shutter window and averages them with a running mean, which
 * is what turns a fast whip-pan from a stack of sharp stills into something
 * that reads as movement.
 */
async function renderShotAt(
  shot: Shot,
  localMs: number,
  mb: { samples: number; frameMs: number; acc: HTMLCanvasElement; accCtx: CanvasRenderingContext2D } | null,
) {
  if (mb && mb.samples > 1) {
    const shutter = 0.6 // fraction of the frame interval the "shutter" is open
    mb.accCtx.clearRect(0, 0, mb.acc.width, mb.acc.height)
    for (let k = 0; k < mb.samples; k++) {
      const frac = k / (mb.samples - 1) - 0.5
      const t = localMs + shutter * mb.frameMs * frac
      applyAtTime(shot, t)
      await seekVideos(t)
      renderFrame()
      mb.accCtx.globalAlpha = 1 / (k + 1)
      if (rt.gl) mb.accCtx.drawImage(rt.gl.domElement, 0, 0, mb.acc.width, mb.acc.height)
    }
    mb.accCtx.globalAlpha = 1
    return mb.acc
  }
  applyAtTime(shot, localMs)
  await seekVideos(localMs)
  renderFrame()
  return null
}

// ----- Image export (PRD §11.4) -----

export interface ImageExportOptions {
  width: number
  height: number
  format: 'png' | 'jpg' | 'webp'
  quality: number
  transparent: boolean
}

export async function exportImage(
  project: ProjectDoc,
  shot: Shot,
  assets: Record<string, AssetRuntime>,
  opts: ImageExportOptions,
  timeMs: number,
  filename?: string,
) {
  if (!rt.gl || !rt.camera) throw new Error('Renderer not ready')
  await preloadOverlayFonts(shot.overlays)
  rt.setFrameloop?.('never')
  // the gizmo lives in this scene; it must not reach the picture
  setEditorObjectsVisible(false)
  await pauseVideos()
  const backup = resizeRenderer(opts.width, opts.height)
  try {
    await renderShotAt(shot, timeMs, null)
    const b = makeBufs(opts.width, opts.height)
    await composeFrame(b, shot, assets, opts.width, opts.height, opts.transparent)

    const mime = opts.format === 'png' ? 'image/png' : opts.format === 'jpg' ? 'image/jpeg' : 'image/webp'
    const blob = await new Promise<Blob | null>((res) => b.out.toBlob(res, mime, opts.quality))
    if (!blob) throw new Error('Encoding failed')
    downloadBlob(blob, `${filename ?? safeName(project.name)}.${opts.format}`)
  } finally {
    setEditorObjectsVisible(true)
    if (backup) restoreRenderer(backup)
    resumeVideos()
    rt.setFrameloop?.('always')
  }
}

// ----- Video export (PRD §11.3, offline, frame-accurate, client-side) -----

export interface VideoExportOptions {
  width: number
  height: number
  fps: number
  format: 'mp4' | 'webm'
  /** bits per second */
  bitrate: number
  transparent: boolean
  /** temporal samples per frame for motion blur (1 = off) */
  motionBlurSamples?: number
  /** render the whole film, or only the shot being edited */
  scope?: 'film' | 'shot'
}

/** Wait for the browser to paint, so a React commit has somewhere to land. */
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/**
 * Put a shot on screen and wait until it is actually there.
 *
 * Shots are mounted by React from the active shot on the store, so rendering a
 * different one means committing that change and letting the scene rebuild.
 * Two frames covers the commit; the poll after it covers the part React cannot
 * promise, a device model still downloading or a screenshot still decoding.
 * Without the wait the first frames of a shot export as an empty set, which is
 * the kind of bug that only shows up on someone else's slower machine.
 */
async function mountShot(shot: Shot, timeoutMs = 6000) {
  const st = useStudio.getState()
  if (st.project.activeShotId !== shot.id) st.activateForRender(shot.id)
  await nextFrame()
  await nextFrame()

  const deadline = performance.now() + timeoutMs
  for (;;) {
    const meshes = shot.scene.devices.every((d) => {
      const g = rt.deviceGroups.get(d.id)
      return !!g && g.children.length > 0
    })
    const screens = shot.scene.devices.every((d) => !d.screen.assetId || rt.screens.has(d.id))
    if ((meshes && screens) || performance.now() > deadline) return
    await nextFrame()
  }
}

/**
 * How many outgoing frames a dissolve may hold in memory at full resolution.
 *
 * A dissolve is the one transition that needs both shots' pixels at the same
 * instant, and only one shot is mounted at a time, so the outgoing side has to
 * be kept. Frames are bitmaps, so the cost scales with the export size: a
 * budget in bytes rather than a fixed count is what keeps a 4K export from
 * asking the browser for two gigabytes. Past the cap the held frames are
 * sampled rather than dropped, which shows up as a slightly stepped fade on a
 * layer that is on its way out anyway.
 */
const DISSOLVE_BUDGET_BYTES = 384 * 1024 * 1024

/**
 * Render the film, or one shot of it, straight to a video file.
 *
 * Shots are rendered in order and their frames encoded in order, so the encoder
 * never sees a frame twice or out of sequence. The only thing that complicates
 * that is a dissolve, where two shots are on screen at once: the outgoing
 * shot's overlapping frames are composed during its own pass and held, then
 * blended under the incoming shot's frames when its turn comes.
 */
export async function exportVideo(
  project: ProjectDoc,
  assets: Record<string, AssetRuntime>,
  opts: VideoExportOptions,
  onProgress: (done: number, total: number) => void,
) {
  if (!rt.gl || !rt.camera) throw new Error('Renderer not ready')
  if (typeof VideoEncoder === 'undefined')
    throw new Error('WebCodecs is not supported in this browser. Try Chrome or Edge.')

  const film: ProjectDoc =
    opts.scope === 'shot' ? { ...project, shots: [activeShot(project)] } : project

  for (const shot of film.shots) await preloadOverlayFonts(shot.overlays)

  const { Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, CanvasSource } = await import(
    'mediabunny'
  )

  const transparent = opts.transparent && opts.format === 'webm'
  const { width, height, fps } = opts
  const frameMs = 1000 / fps
  const b = makeBufs(width, height)

  const mbSamples = Math.max(1, Math.round(opts.motionBlurSamples ?? 1))
  const mb =
    mbSamples > 1
      ? (() => {
          const acc = document.createElement('canvas')
          acc.width = width
          acc.height = height
          return { samples: mbSamples, frameMs, acc, accCtx: acc.getContext('2d')! }
        })()
      : null

  const layout = sequenceLayout(film)
  // who renders each frame, decided up front, so the loop below stays a
  // straight walk through the shots with every frame already spoken for
  const plan = planFrames(film, fps)
  const total = plan.length

  // frames each shot has to render: the ones it owns, plus the ones a dissolve
  // will need from it after it has left the screen
  const owned: number[][] = layout.map(() => [])
  const held: number[][] = layout.map(() => [])
  plan.forEach((p, f) => {
    owned[p.owner].push(f)
    if (p.under !== null) held[p.under].push(f)
  })

  /*
   * Which held frame each overlapping frame actually uses.
   *
   * With a big enough export and a long enough dissolve, holding every
   * outgoing frame would be too much memory, so several frames share one. The
   * mapping is built from each shot's own list rather than from arithmetic on
   * the frame index, so a shared frame is always one that really was held and
   * never one that belongs to the shot before it.
   */
  const maxHeld = Math.max(2, Math.floor(DISSOLVE_BUDGET_BYTES / (width * height * 4)))
  const longestHold = held.reduce((m, list) => Math.max(m, list.length), 0)
  const holdStride = longestHold > maxHeld ? Math.ceil(longestHold / maxHeld) : 1
  const holdKey = new Map<number, number>()
  for (const list of held)
    list.forEach((f, i) => holdKey.set(f, list[Math.floor(i / holdStride) * holdStride]))
  const stash = new Map<number, ImageBitmap>()

  const output = new Output({
    format: opts.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const source = new CanvasSource(b.out, {
    codec: opts.format === 'mp4' ? 'avc' : 'vp9',
    bitrate: opts.bitrate,
    ...(transparent ? { alpha: 'keep' as const } : {}),
  })
  output.addVideoTrack(source, { frameRate: fps })
  await output.start()

  rt.exportCancelled = false
  rt.setFrameloop?.('never')
  // the gizmo lives in this scene; it must not reach the picture
  setEditorObjectsVisible(false)
  await pauseVideos()
  const backup = resizeRenderer(width, height)
  const restoreShotId = project.activeShotId
  let done = 0

  try {
    for (const placed of layout) {
      if (rt.exportCancelled) break
      const shot = placed.shot
      await mountShot(shot)
      // a fresh mount resizes the canvas back to the viewport's size
      resizeRenderer(width, height)

      // ascending, so the encoder is fed in order and a held frame is always
      // composed before the frame that blends it
      const work = [
        ...new Set([...owned[placed.index], ...held[placed.index].map((f) => holdKey.get(f) ?? f)]),
      ].sort((x, y) => x - y)

      for (const f of work) {
        if (rt.exportCancelled) break
        const localMs = Math.min(shot.durationMs, Math.max(0, f * frameMs - placed.start))
        const accumulated = await renderShotAt(shot, localMs, mb)
        if (accumulated) {
          // motion blur composited its own average; hand it over as the render
          b.sctx.clearRect(0, 0, width, height)
          await paintBackground(b.sctx, width, height, shot.scene.background, assets, transparent)
          b.sctx.drawImage(accumulated, 0, 0)
          const gf = gradeFilter(shot.scene.effects.grade)
          b.ctx.clearRect(0, 0, width, height)
          if (gf) b.ctx.filter = gf
          b.ctx.drawImage(b.stage, 0, 0)
          b.ctx.filter = 'none'
          applyPortrait(b.out, shot.scene.effects.portrait)
          await drawOverlays(b.ctx, shot.overlays, assets, width, height)
        } else {
          await composeFrame(b, shot, assets, width, height, transparent)
        }

        const isOwner = plan[f]?.owner === placed.index
        if (!isOwner) {
          // this shot is only here to be kept for the dissolve ahead of it
          stash.set(f, await createImageBitmap(b.out))
          continue
        }

        const p = plan[f]
        if (p.under !== null) {
          const under = stash.get(holdKey.get(f) ?? f)
          if (under) {
            // out = mix·incoming + (1 − mix)·outgoing
            b.ctx.save()
            b.ctx.globalAlpha = 1 - p.mix
            b.ctx.drawImage(under, 0, 0, width, height)
            b.ctx.restore()
          }
        }
        if (p.veil && p.veil.alpha > 0) {
          b.ctx.save()
          b.ctx.globalAlpha = p.veil.alpha
          b.ctx.fillStyle = p.veil.color
          b.ctx.fillRect(0, 0, width, height)
          b.ctx.restore()
        }

        await source.add(f / fps, 1 / fps)
        done++
        onProgress(done, total)
        if (done % 8 === 0) await new Promise((r) => setTimeout(r, 0))
      }

      // nothing after this shot can blend with it any more
      if (placed.index > 0) {
        for (const f of held[placed.index - 1]) {
          const key = holdKey.get(f) ?? f
          stash.get(key)?.close()
          stash.delete(key)
        }
      }
    }

    if (rt.exportCancelled) {
      await output.cancel()
      return
    }
    source.close()
    await output.finalize()
    const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer
    if (!buffer) throw new Error('Muxing produced no data')
    const mime = opts.format === 'mp4' ? 'video/mp4' : 'video/webm'
    downloadBlob(new Blob([buffer], { type: mime }), `${safeName(project.name)}.${opts.format}`)
  } finally {
    for (const bmp of stash.values()) bmp.close()
    stash.clear()
    setEditorObjectsVisible(true)
    if (backup) restoreRenderer(backup)
    resumeVideos()
    rt.setFrameloop?.('always')
    // put the editor back on the shot the user was working on
    if (useStudio.getState().project.activeShotId !== restoreShotId)
      useStudio.getState().activateForRender(restoreShotId)
  }
}

export function cancelExport() {
  rt.exportCancelled = true
}

// ----- Batch image export -----

export interface BatchSize {
  name: string
  width: number
  height: number
}

/** Render the current shot across several output sizes, one file each. */
export async function exportImageBatch(
  project: ProjectDoc,
  shot: Shot,
  assets: Record<string, AssetRuntime>,
  sizes: BatchSize[],
  format: 'png' | 'jpg' | 'webp',
  quality: number,
  transparent: boolean,
  timeMs: number,
  onProgress: (done: number, total: number, label: string) => void,
) {
  rt.exportCancelled = false
  for (let i = 0; i < sizes.length; i++) {
    if (rt.exportCancelled) break
    const size = sizes[i]
    onProgress(i, sizes.length, `Exporting ${size.name}…`)
    await exportImage(
      project,
      shot,
      assets,
      { width: size.width, height: size.height, format, quality, transparent },
      timeMs,
      safeName(`${project.name}_${size.name}`),
    )
    onProgress(i + 1, sizes.length, `Exporting ${size.name}…`)
    // small gap so the browser accepts consecutive downloads
    await new Promise((r) => setTimeout(r, 350))
  }
}

/**
 * One still per shot, taken at the same point through each.
 *
 * The obvious thing to want once a project holds several takes: a contact
 * sheet of the film as separate files, rather than a video of it.
 */
export async function exportShotStills(
  project: ProjectDoc,
  assets: Record<string, AssetRuntime>,
  opts: ImageExportOptions,
  /** 0..1 through each shot */
  at: number,
  onProgress: (done: number, total: number, label: string) => void,
) {
  rt.exportCancelled = false
  const restoreShotId = project.activeShotId
  try {
    for (let i = 0; i < project.shots.length; i++) {
      if (rt.exportCancelled) break
      const shot = project.shots[i]
      onProgress(i, project.shots.length, `Rendering ${shot.name}…`)
      await mountShot(shot)
      await exportImage(
        project,
        shot,
        assets,
        opts,
        shot.durationMs * Math.min(1, Math.max(0, at)),
        safeName(`${project.name}_${shot.name}`),
      )
      onProgress(i + 1, project.shots.length, `Rendering ${shot.name}…`)
      await new Promise((r) => setTimeout(r, 350))
    }
  } finally {
    if (useStudio.getState().project.activeShotId !== restoreShotId)
      useStudio.getState().activateForRender(restoreShotId)
  }
}

// ----- Quick capture at viewport state -----

export async function quickCapture(project: ProjectDoc, assets: Record<string, AssetRuntime>, timeMs: number) {
  const shot = activeShot(project)
  await exportImage(
    project,
    shot,
    assets,
    {
      width: project.exportSize.width,
      height: project.exportSize.height,
      format: 'png',
      quality: 1,
      transparent: shot.scene.background.type === 'transparent',
    },
    timeMs,
  )
}

function safeName(name: string) {
  return name.replace(/[^\w-]+/g, '_') || 'mockup'
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
