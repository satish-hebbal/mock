/**
 * Getting the work out.
 *
 * Four destinations:
 *
 *   a still      PNG or JPG of one frame, at the document's own size
 *   a video      MP4 or WebM, encoded offline rather than recorded
 *   a snippet    a self-contained HTML embed, or the document as JSON
 *   a mockup     straight into Shots or the 3D Studio as a screen
 *
 * The video is the one worth reading the reasoning on. The tool this borrows
 * from records the live canvas with `MediaRecorder` and `captureStream(30)`,
 * which means a fifteen second video takes fifteen seconds to make, is capped
 * at thirty frames a second, and bakes in every frame the machine dropped while
 * it was recording. Ribbit already encodes offline with mediabunny for the 3D
 * studio, so Signal does the same: every frame is rendered deliberately, at the
 * exact time it represents, and handed to the encoder when it is ready. A slow
 * machine makes the same file as a fast one, just later.
 */

import { useShots } from '../shots/store'
import { useStudio } from '../store'
import { track } from '../lib/analytics'
import { ui } from '../lib/ui'
import { FIELD_BY_ID, FIELD_HELPERS, resolveParams } from './fields'
import { FIGURE_BY_ID, FIGURE_HELPERS } from './figures'
import { hexRgb } from './quantize'
import { frameCount, frameTime, makeFrameCanvas, renderSignal } from './render'
import type { MaskId, SignalDoc } from './types'

export type StillFormat = 'png' | 'jpg'
export type VideoFormat = 'mp4' | 'webm'
export type CodeFormat = 'embed' | 'json'

/**
 * The closing script tag, assembled rather than written.
 *
 * The snippet this file builds contains a `<script>` block, so it has to
 * contain the closing tag too. Writing that tag literally here is a hazard the
 * moment anything inlines this bundle into an HTML page: the browser's parser
 * does not care that the characters are inside a JavaScript string, it sees
 * `</script` and ends the block. Splitting it means the sequence never appears
 * in the source, only in the output.
 */
const CLOSE_SCRIPT = '<' + '/script>'

function safeName(name: string) {
  return name.replace(/[^\w-]+/g, '_') || 'signal'
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

async function toBlob(canvas: HTMLCanvasElement, format: StillFormat): Promise<Blob> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, 0.92))
  if (!blob) throw new Error('Encoding failed')
  return blob
}

/** One frame, at the time currently on the clock. */
export function renderStill(doc: SignalDoc, t: number) {
  const canvas = makeFrameCanvas(doc)
  renderSignal(doc, t, canvas)
  return canvas
}

export async function downloadStill(doc: SignalDoc, t: number, format: StillFormat) {
  const canvas = renderStill(doc, t)
  downloadBlob(await toBlob(canvas, format), `${safeName(doc.name)}.${format}`)
}

export async function copyStill(doc: SignalDoc, t: number) {
  const canvas = renderStill(doc, t)
  // PNG only: every browser's clipboard image support is PNG, and asking for
  // a JPEG on the clipboard fails silently on most of them
  const blob = await toBlob(canvas, 'png')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

// ----- video -----

export interface VideoOptions {
  format: VideoFormat
  fps: number
  /** bits per second */
  bitrate: number
}

/** Cancelled by the dialog's stop button; read at the top of every frame. */
export const videoState = { cancelled: false }

/**
 * Encode the document as a video, one deliberate frame at a time.
 *
 * The yield every eighth frame is not decoration. Rendering is synchronous and
 * on the main thread, so without it the whole encode is one long task: the
 * progress bar never paints, the cancel button never receives its click, and
 * the browser offers to kill the tab. Eight frames is about as long as a frame
 * budget tolerates and short enough that cancelling feels immediate.
 */
export async function exportVideo(
  doc: SignalDoc,
  opts: VideoOptions,
  onProgress: (done: number, total: number) => void,
) {
  if (typeof VideoEncoder === 'undefined')
    throw new Error('WebCodecs is not supported in this browser. Try Chrome or Edge.')

  const { Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, CanvasSource } = await import(
    'mediabunny'
  )

  const canvas = makeFrameCanvas(doc)
  const output = new Output({
    format:
      opts.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const source = new CanvasSource(canvas, {
    codec: opts.format === 'mp4' ? 'avc' : 'vp9',
    bitrate: opts.bitrate,
  })
  output.addVideoTrack(source, { frameRate: opts.fps })
  await output.start()

  videoState.cancelled = false
  const total = frameCount(doc, opts.fps)

  try {
    for (let i = 0; i < total; i++) {
      if (videoState.cancelled) break
      renderSignal(doc, frameTime(doc, i, opts.fps), canvas)
      await source.add(i / opts.fps, 1 / opts.fps)
      onProgress(i + 1, total)
      if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0))
    }

    if (videoState.cancelled) {
      await output.cancel()
      return
    }
    source.close()
    await output.finalize()
    const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer
    if (!buffer) throw new Error('Muxing produced no data')
    const mime = opts.format === 'mp4' ? 'video/mp4' : 'video/webm'
    downloadBlob(new Blob([buffer], { type: mime }), `${safeName(doc.name)}.${opts.format}`)
  } catch (e) {
    await output.cancel().catch(() => {})
    throw e
  }
}

// ----- code -----

/**
 * The ordered masks, written out as source rather than lifted from the module.
 *
 * `quantize.ts` builds its Bayer matrices into typed arrays at module load and
 * closes over them, and an array has no name to look up at runtime the way a
 * function does. Rather than restructure the renderer around what the embed
 * needs, the ten masks are re-expressed here as standalone source text. They
 * are short, and `scripts/verify-signal.mjs` runs each of these strings against
 * the real mask over a grid of coordinates so the two cannot silently diverge.
 */
const EMBED_MASKS: Record<MaskId, string> = {
  bayer2: 'function(x,y){var m=[0,2,3,1];return m[(y&1)*2+(x&1)]/4;}',
  bayer4:
    'function(x,y){var m=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];return m[(y&3)*4+(x&3)]/16;}',
  bayer8:
    'function(x,y){var v=0,xc=(x^y),yc=y;for(var b=0;b<6;b++){v|=(yc&1)<<(5-b);b++;if(b<6)v|=(xc&1)<<(5-b);yc>>=1;xc>>=1;}return v/64;}',
  halftone:
    'function(x,y){var s=12,hf=6,k=Math.SQRT1_2,rx=x*k+y*k,ry=-x*k+y*k,cx=((rx%s)+s)%s-hf,cy=((ry%s)+s)%s-hf;return Math.min(1,Math.sqrt(cx*cx+cy*cy)/(hf*0.95));}',
  'blue-noise':
    'function(x,y){var h=(x*374761393+y*668265263+1013904223)|0;h=((h>>16)^h)*1274126177;h=((h>>16)^h)*1274126177;h=(h>>16)^h;return (h&255)/255;}',
  crosshatch: 'function(x,y){return Math.min(((x+y)%8)/8,((x-y+800)%8)/8);}',
  diamond: 'function(x,y){return (Math.abs((x%8)-3.5)+Math.abs((y%8)-3.5))/7;}',
  spiral:
    'function(x,y){var cx=(x%12)-5.5,cy=(y%12)-5.5,a=Math.atan2(cy,cx);return ((((a/Math.PI+Math.sqrt(cx*cx+cy*cy)/6)%1)+1)%1);}',
  lines: 'function(x,y){return (y%6)/6;}',
  none: 'function(){return 0.5;}',
}

/**
 * `var <minified name> = <source>;` for each helper a lifted body closes over.
 *
 * Two helpers arriving under the same name would mean one silently overwrote
 * the other in the snippet, which is a broken page rather than a broken build,
 * and so is worth refusing loudly rather than shipping.
 *
 * It cannot happen while both families land in one bundled chunk, because a
 * bundler guarantees unique top-level names within a chunk. It becomes possible
 * the moment anything splits them apart, and that is not something this file
 * can see. `scripts/verify-signal-embed.mjs` is what proves it has not.
 */
function helperSource(helpers: Function[]) {
  const seen = new Map<string, Function>()
  for (const fn of helpers) {
    const clash = seen.get(fn.name)
    if (clash && clash !== fn) {
      throw new Error(`Two embed helpers are both named "${fn.name}" and would overwrite each other.`)
    }
    seen.set(fn.name, fn)
  }
  return [...seen.values()].map((fn) => `var ${fn.name}=${fn.toString()};`).join('\n  ')
}

/**
 * True when the document can be turned into a standalone snippet.
 *
 * Everything can, in fact. The check exists because a glyph document also needs
 * a font to be loaded and a text pass emitted, and rather than ship an embed
 * that quietly drops the characters, the dialog says which part will not travel
 * and offers the video instead.
 */
export function embedOmissions(doc: SignalDoc): string[] {
  const out: string[] = []
  if (doc.source.kind === 'field' && doc.quantize.glyphs !== 'off') {
    out.push('characters (the snippet draws pixels, not glyphs)')
  }
  if (Object.values(doc.fx).some((f) => f && f.amount > 0)) {
    out.push('the finishing effects')
  }
  return out
}

/**
 * A self-contained animated snippet.
 *
 * The generator is lifted out of this bundle with `toString()` and pasted into
 * the snippet along with the handful of helpers it closes over, keyed by
 * `Function.prototype.name` so the declarations match whatever the minifier
 * renamed the call sites to. The dither loop is written out longhand because it
 * lives inside `quantize.ts` wrapped in buffer reuse that a one-canvas snippet
 * has no use for.
 *
 * What does not travel: the post chain and the glyph pass. `embedOmissions`
 * names both, and the dialog shows that list rather than letting somebody paste
 * a snippet and wonder where the bloom went.
 */
export function embedCode(doc: SignalDoc): string {
  const { canvas, source, quantize, ink, motion } = doc
  const uid = 'sig_' + Math.random().toString(36).slice(2, 9)
  const fg = hexRgb(ink.ink)
  const bg = hexRgb(ink.paper)
  const ac = hexRgb(ink.accent)
  const shell = (body: string) => `<!-- Signal · ${doc.name} -->
<div style="position:relative;width:${canvas.width}px;max-width:100%;aspect-ratio:${canvas.width}/${canvas.height};background:${ink.paper};overflow:hidden">
<canvas id="${uid}" style="width:100%;height:100%;display:block"></canvas>
<script>(function(){
  var c=document.getElementById(${JSON.stringify(uid)}),ctx=c.getContext("2d");
  var W=${canvas.width},H=${canvas.height};
  c.width=W;c.height=H;
  var fg=[${fg}],bg=[${bg}],ac=[${ac}];
  var speed=${source.speed},intensity=${source.intensity},scale=${source.scale};
  var t=0,last=0;
${body}
  requestAnimationFrame(function loop(now){
    requestAnimationFrame(loop);
    if(last)t+=(now-last)/1000*speed;
    last=now;
    draw();
  });
})();${CLOSE_SCRIPT}
</div>`

  if (source.kind === 'figure') {
    const spec = FIGURE_BY_ID.get(source.id)
    if (!spec) return '<!-- That generator is not in this build. -->'
    // the generator's own controls are resolved here and inlined as a literal,
    // so the snippet carries the picture rather than the defaults
    return shell(`  ${helperSource(FIGURE_HELPERS)}
  var fn=${spec.fn.toString()};
  var motion=${JSON.stringify(motion)};
  var pr=${JSON.stringify(resolveParams(spec.params, source.params))};
  function draw(){fn(ctx,W,H,t,intensity,scale,{fg:fg,bg:bg,accent:ac},motion,pr);}`)
  }

  const spec = FIELD_BY_ID.get(source.id)
  if (!spec) return '<!-- That generator is not in this build. -->'

  /*
   * The snippet carries the same Detail step the app uses, and for the same
   * reason: a per-pixel field at a megapixel is as expensive in somebody's page
   * as it is here. The field is generated small and interpolated up; the dither
   * below it still runs at full size, which is the part anybody can see.
   */
  const step = Math.max(1, Math.round(quantize.detail))
  const cw = Math.max(2, Math.ceil(canvas.width / step))
  const ch = Math.max(2, Math.ceil(canvas.height / step))

  return shell(`  ${helperSource(FIELD_HELPERS)}
  var fn=${spec.fn.toString()};
  var pr=${JSON.stringify(resolveParams(spec.params, source.params))};
  var mask=${EMBED_MASKS[quantize.mask] ?? EMBED_MASKS.bayer4};
  var px=${Math.max(1, quantize.pixelSize)},thr=${quantize.threshold}/255,spr=${quantize.spread}/100;
  var mix=${quantize.mask === 'none' ? 0 : ink.mix}/100,mode=${JSON.stringify(ink.mode)};
  var CW=${cw},CH=${ch},STEP=${step};
  var small=new Float32Array(CW*CH);
  var buf=new Float32Array(W*H),img=ctx.createImageData(W,H),d=img.data;
  var half=mix*0.45,lo=0.5-half,hi=0.5+half;
  var kx=(CW-1)/Math.max(1,W-1),ky=(CH-1)/Math.max(1,H-1);
  function field(){
    if(STEP<=1){fn(buf,W,H,t,intensity,scale,pr);return;}
    fn(small,CW,CH,t,intensity,scale,pr);
    for(var y=0;y<H;y++){
      var gy=y*ky,j0=Math.min(CH-2,gy|0),fy=gy-j0,r0=j0*CW,r1=r0+CW;
      for(var x=0;x<W;x++){
        var gx=x*kx,i0=Math.min(CW-2,gx|0),fx=gx-i0;
        var a=small[r0+i0],b=small[r0+i0+1],c=small[r1+i0],e=small[r1+i0+1];
        buf[y*W+x]=(a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+e*fx)*fy;
      }
    }
  }
  function draw(){
    field();
    for(var y=0;y<H;y++){
      var qy=Math.floor(y/px);
      for(var x=0;x<W;x++){
        var i=y*W+x,v=buf[i];
        var lit=(v+(mask(Math.floor(x/px),qy)-0.5)*spr)>thr?1:0;
        var r,g,b;
        if(v<0){r=ac[0];g=ac[1];b=ac[2];}
        else if(mix>0.01&&v>=lo&&v<=hi){
          if(mode==="hard"){r=ac[0];g=ac[1];b=ac[2];}
          else if(mode==="pattern"){var q=lit?ac:bg;r=q[0];g=q[1];b=q[2];}
          else{var e=half>0.01?1-Math.abs(v-0.5)/half:1,k=e*e,q2=lit?fg:bg;
            r=q2[0]+(ac[0]-q2[0])*k;g=q2[1]+(ac[1]-q2[1])*k;b=q2[2]+(ac[2]-q2[2])*k;}
        } else {var q3=lit?fg:bg;r=q3[0];g=q3[1];b=q3[2];}
        var p=i*4;d[p]=r;d[p+1]=g;d[p+2]=b;d[p+3]=255;
      }
    }
    ctx.putImageData(img,0,0);
  }`)
}

/** The document, as a document. The only export that round-trips exactly. */
export function configJson(doc: SignalDoc): string {
  return JSON.stringify(doc, null, 2)
}

export function codeFor(doc: SignalDoc, format: CodeFormat) {
  return format === 'json' ? configJson(doc) : embedCode(doc)
}

export async function copyCode(doc: SignalDoc, format: CodeFormat) {
  await navigator.clipboard.writeText(codeFor(doc, format))
}

export function downloadCode(doc: SignalDoc, format: CodeFormat) {
  const text = codeFor(doc, format)
  const ext = format === 'json' ? 'json' : 'html'
  const mime = format === 'json' ? 'application/json' : 'text/html'
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), `${safeName(doc.name)}.${ext}`)
}

// ----- mockup -----

/**
 * Hand the current frame to one of the mockup editors.
 *
 * The same handoff ASCII has, and the same reason for it: both editors already
 * know how to take a Blob and treat it as a screen, so this is a render, an
 * encode and a mode switch. A still rather than the animation, because neither
 * mockup editor takes a moving screen from another tool yet, and the dialog
 * says so rather than sending a video that arrives as a frozen first frame.
 */
export async function sendToMockup(doc: SignalDoc, t: number, target: 'shots' | 'studio') {
  const canvas = renderStill(doc, t)
  const blob = await toBlob(canvas, 'png')
  const file = new File([blob], `${safeName(doc.name)}.png`, { type: 'image/png' })

  if (target === 'shots') await useShots.getState().importMedia(file, 'image/png')
  else await useStudio.getState().importMedia(file, 'image/png', { bind: true })

  useStudio.getState().setMode(target)
  ui.toast(target === 'shots' ? 'Sent to Shots' : 'Sent to the 3D Studio')
}

// ----- analytics -----

/** The shape every export event reports, so the funnel is one chart. */
export function exportShape(doc: SignalDoc, extra: Record<string, string | number | boolean>) {
  return {
    editor: 'signal',
    source_kind: doc.source.kind,
    source: doc.source.id,
    mask: doc.quantize.mask,
    ...extra,
  }
}

export function trackExport(
  phase: 'export_started' | 'export_completed' | 'export_failed',
  shape: Record<string, string | number | boolean>,
) {
  track(phase, shape)
}
