import { Vector2 } from 'three'
import { applyAtTime, renderFrame, rt } from './runtime'
import { paintMeshGradient } from './meshGradient'
import type { AssetRuntime, BackgroundState, Overlay, ProjectDoc } from '../types'

// ————— Background compositing (preview CSS ⇄ export canvas parity) —————

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
    case 'mesh':
      paintMeshGradient(ctx, w, h, bg.mesh.seed, bg.mesh.colors)
      break
    case 'image': {
      const asset = bg.imageAssetId ? assets[bg.imageAssetId] : null
      if (!asset) {
        ctx.fillStyle = '#111'
        ctx.fillRect(0, 0, w, h)
        break
      }
      const img = new Image()
      img.src = asset.url
      await img.decode()
      // cover
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
      const dw = img.naturalWidth * scale
      const dh = img.naturalHeight * scale
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
      break
    }
  }
  ctx.restore()
}

// ————— Overlay compositing (PRD §6.7 — rendered at export resolution) —————

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
      ctx.font = `${o.weight} ${px}px ${o.font}`
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

function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const px = Math.max(12, h * 0.02)
  ctx.save()
  ctx.font = `600 ${px}px system-ui`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  const text = '◆ Mockup Studio'
  const tw = ctx.measureText(text).width
  const pad = px * 0.55
  ctx.fillStyle = 'rgba(0,0,0,0.42)'
  rr(ctx, w - tw - pad * 3, h - px - pad * 3, tw + pad * 2, px + pad * 1.6, px)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillText(text, w - pad * 2, h - pad * 1.9)
  ctx.restore()
}

// ————— Renderer size management —————

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

// ————— Image export (PRD §11.4) —————

export interface ImageExportOptions {
  width: number
  height: number
  format: 'png' | 'jpg' | 'webp'
  quality: number
  transparent: boolean
}

export async function exportImage(
  project: ProjectDoc,
  assets: Record<string, AssetRuntime>,
  opts: ImageExportOptions,
  pro: boolean,
  timeMs: number,
) {
  if (!rt.gl || !rt.camera) throw new Error('Renderer not ready')
  rt.setFrameloop?.('never')
  await pauseVideos()
  const backup = resizeRenderer(opts.width, opts.height)
  try {
    applyAtTime(project, timeMs)
    await seekVideos(timeMs)
    renderFrame()

    const out = document.createElement('canvas')
    out.width = opts.width
    out.height = opts.height
    const ctx = out.getContext('2d')!
    await paintBackground(ctx, opts.width, opts.height, project.scene.background, assets, opts.transparent)
    ctx.drawImage(rt.gl.domElement, 0, 0, opts.width, opts.height)
    await drawOverlays(ctx, project.overlays, assets, opts.width, opts.height)
    if (!pro) drawWatermark(ctx, opts.width, opts.height)

    const mime = opts.format === 'png' ? 'image/png' : opts.format === 'jpg' ? 'image/jpeg' : 'image/webp'
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, mime, opts.quality))
    if (!blob) throw new Error('Encoding failed')
    downloadBlob(blob, `${safeName(project.name)}.${opts.format}`)
  } finally {
    if (backup) restoreRenderer(backup)
    resumeVideos()
    rt.setFrameloop?.('always')
  }
}

// ————— Video export (PRD §11.3 — offline, frame-accurate, client-side) —————

export interface VideoExportOptions {
  width: number
  height: number
  fps: number
  format: 'mp4' | 'webm'
  /** bits per second */
  bitrate: number
  transparent: boolean
}

export async function exportVideo(
  project: ProjectDoc,
  assets: Record<string, AssetRuntime>,
  opts: VideoExportOptions,
  pro: boolean,
  onProgress: (done: number, total: number) => void,
) {
  if (!rt.gl || !rt.camera) throw new Error('Renderer not ready')
  if (typeof VideoEncoder === 'undefined')
    throw new Error('WebCodecs is not supported in this browser — try Chrome or Edge.')

  const { Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, CanvasSource } = await import(
    'mediabunny'
  )

  const transparent = opts.transparent && opts.format === 'webm'
  const canvas = document.createElement('canvas')
  canvas.width = opts.width
  canvas.height = opts.height
  const ctx = canvas.getContext('2d')!

  const output = new Output({
    format: opts.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const source = new CanvasSource(canvas, {
    codec: opts.format === 'mp4' ? 'avc' : 'vp9',
    bitrate: opts.bitrate,
    ...(transparent ? { alpha: 'keep' as const } : {}),
  })
  output.addVideoTrack(source, { frameRate: opts.fps })
  await output.start()

  rt.exportCancelled = false
  rt.setFrameloop?.('never')
  await pauseVideos()
  const backup = resizeRenderer(opts.width, opts.height)
  const total = Math.max(1, Math.round((project.durationMs / 1000) * opts.fps))

  try {
    for (let i = 0; i < total; i++) {
      if (rt.exportCancelled) break
      const t = (i * 1000) / opts.fps
      applyAtTime(project, t)
      await seekVideos(t)
      renderFrame()

      ctx.clearRect(0, 0, opts.width, opts.height)
      await paintBackground(ctx, opts.width, opts.height, project.scene.background, assets, transparent)
      ctx.drawImage(rt.gl.domElement, 0, 0, opts.width, opts.height)
      await drawOverlays(ctx, project.overlays, assets, opts.width, opts.height)
      if (!pro) drawWatermark(ctx, opts.width, opts.height)

      await source.add(i / opts.fps, 1 / opts.fps)
      onProgress(i + 1, total)
      if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0))
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
    if (backup) restoreRenderer(backup)
    resumeVideos()
    rt.setFrameloop?.('always')
  }
}

export function cancelExport() {
  rt.exportCancelled = true
}

// ————— Quick capture at viewport state —————

export async function quickCapture(project: ProjectDoc, assets: Record<string, AssetRuntime>, pro: boolean, timeMs: number) {
  await exportImage(
    project,
    assets,
    {
      width: project.exportSize.width,
      height: project.exportSize.height,
      format: 'png',
      quality: 1,
      transparent: project.scene.background.type === 'transparent',
    },
    pro,
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
