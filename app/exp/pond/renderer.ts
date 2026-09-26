// Owns the WebGL2 context and runs the passes in order each frame:
//   ripples (stepped separately) -> surface -> caustics -> fish shadow -> fish -> seaweed
//   -> composite -> finish (or a debug view of one pass).
// Sizes are in "pond px" (CSS px); `unit` = width / 540 keeps look-tuned numbers resolution independent.

import * as S from './shaders'
import { COLS, FLOATS_PER_VERTEX, INDICES_PER_FISH, ROWS } from './koi'

type Target = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }
type Program = { program: WebGLProgram; u: (name: string) => WebGLUniformLocation | null }

export type View = 'final' | 'caustics' | 'ripples' | 'surface' | 'bed' | 'fish' | 'shadow'
export type Renderer = NonNullable<ReturnType<typeof createRenderer>>

// greenish water: dim ambient, warm-ish sun
const AMBIENT = [0.03, 0.066, 0.056]
const SUN = [0.9, 0.92, 0.66]

// stones: position as a fraction of the pond, size in design px (scaled by unit), tone 0 grey, 1 warm, 2 dark
const STONES = [
  { x: 0.78, y: 0.28, length: 42, width: 31, height: 18, angle: 0.35, seed: 0.21, tone: 0 },
  { x: 0.88, y: 0.52, length: 20, width: 15, height: 9, angle: -0.7, seed: 0.64, tone: 2 },
  { x: 0.34, y: 0.66, length: 30, width: 22, height: 13, angle: -0.25, seed: 0.47, tone: 1 },
]

// big seaweed clumps reaching in from the edges; small tufts are scattered around them at random
const CLUMPS = [
  { x: 0.05, y: 0.84, angle: -0.55, count: 9, root: 20, length: [60, 150], width: [4, 8] },
  { x: 0.9, y: 0.92, angle: -2.35, count: 7, root: 20, length: [60, 150], width: [4, 8] },
  { x: 0.33, y: 0.03, angle: 1.25, count: 6, root: 20, length: [60, 150], width: [4, 8] },
]
const WEED_POINTS = 14
const WEED_SEED = 1 + Math.floor(Math.random() * 0x7ffffffd)

export function createRenderer(canvas: HTMLCanvasElement, fishCount: number) {
  const ctx = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
  })
  // float render targets are needed for the wave simulation
  if (!ctx || !ctx.getExtension('EXT_color_buffer_float')) return null
  const gl: WebGL2RenderingContext = ctx

  const programs: WebGLProgram[] = []
  function program(vs: string, fs: string, attribs: string[] = []): Program {
    const p = gl.createProgram()!
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(gl.getShaderInfoLog(sh) ?? 'shader failed to compile')
      }
      gl.attachShader(p, sh)
      gl.deleteShader(sh)
    }
    attribs.forEach((name, i) => gl.bindAttribLocation(p, i, name))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(gl.getProgramInfoLog(p) ?? 'program failed to link')
    }
    programs.push(p)
    const cache = new Map<string, WebGLUniformLocation | null>()
    return {
      program: p,
      u: (name) => {
        if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name))
        return cache.get(name)!
      },
    }
  }

  const fishAttribs = ['a_pos', 'a_local', 'a_tan', 'a_fish', 'a_motion']
  let P: Record<'ripple' | 'surface' | 'caustic' | 'blur' | 'bed' | 'fish' | 'shadow' | 'weed' | 'composite' | 'finish' | 'debug', Program>
  try {
    P = {
      ripple: program(S.FULLSCREEN_VS, S.RIPPLE_FS),
      surface: program(S.FULLSCREEN_VS, S.SURFACE_FS),
      caustic: program(S.CAUSTIC_VS, S.CAUSTIC_FS, ['a_pos']),
      blur: program(S.FULLSCREEN_VS, S.BLUR_FS),
      bed: program(S.FULLSCREEN_VS, S.BED_FS),
      fish: program(S.FISH_VS, S.FISH_FS, fishAttribs),
      shadow: program(S.FISH_VS, S.SHADOW_FS, fishAttribs),
      weed: program(S.WEED_VS, S.WEED_FS, ['a_pos', 'a_leaf']),
      composite: program(S.FULLSCREEN_VS, S.COMPOSITE_FS),
      finish: program(S.FULLSCREEN_VS, S.FINISH_FS),
      debug: program(S.FULLSCREEN_VS, S.DEBUG_FS),
    }
  } catch (err) {
    console.error(err)
    programs.forEach((p) => gl.deleteProgram(p))
    return null
  }

  const emptyVao = gl.createVertexArray()

  // fish ribbons: one dynamic vertex buffer rewritten every frame, static indices
  const fishVertices = new Float32Array(fishCount * ROWS * COLS * FLOATS_PER_VERTEX)
  const fishVao = gl.createVertexArray()
  const fishVbo = gl.createBuffer()
  const fishIbo = gl.createBuffer()
  gl.bindVertexArray(fishVao)
  gl.bindBuffer(gl.ARRAY_BUFFER, fishVbo)
  gl.bufferData(gl.ARRAY_BUFFER, fishVertices.byteLength, gl.DYNAMIC_DRAW)
  ;[2, 2, 2, 4, 2].reduce((offset, size, i) => {
    gl.enableVertexAttribArray(i)
    gl.vertexAttribPointer(i, size, gl.FLOAT, false, FLOATS_PER_VERTEX * 4, offset * 4)
    return offset + size
  }, 0)
  const fishIndices: number[] = []
  for (let f = 0; f < fishCount; f++) {
    const base = f * ROWS * COLS
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < COLS - 1; c++) {
        const i = base + r * COLS + c
        fishIndices.push(i, i + COLS, i + 1, i + 1, i + COLS, i + COLS + 1)
      }
    }
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fishIbo)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(fishIndices), gl.STATIC_DRAW)
  gl.bindVertexArray(null)

  // impulses queued for the next ripple step
  const drops = new Float32Array(32 * 4)
  const splashes = new Float32Array(32 * 4)
  const pushes = new Float32Array(16 * 4)
  let dropCount = 0
  let splashCount = 0
  let pushCount = 0

  function target(w: number, h: number, float: boolean): Target {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return { tex, fb, w, h }
  }
  const free = (t: Target) => {
    gl.deleteTexture(t.tex)
    gl.deleteFramebuffer(t.fb)
  }
  function bind(t: Target | null) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null)
    gl.viewport(0, 0, t ? t.w : gl.drawingBufferWidth, t ? t.h : gl.drawingBufferHeight)
  }
  function tex(p: Program, name: string, t: WebGLTexture, unit: number) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.uniform1i(p.u(name), unit)
  }
  function fullscreen() {
    gl.bindVertexArray(emptyVao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  function blur(t: Target, scratch: Target, radius: number) {
    gl.useProgram(P.blur.program)
    bind(scratch)
    tex(P.blur, 'u_tex', t.tex, 0)
    gl.uniform2f(P.blur.u('u_dir'), radius / t.w, 0)
    fullscreen()
    bind(t)
    tex(P.blur, 'u_tex', scratch.tex, 0)
    gl.uniform2f(P.blur.u('u_dir'), 0, radius / t.h)
    fullscreen()
  }

  type Weeds = { vertices: Float32Array; indices: Uint16Array; write: (t: number) => void }
  type State = {
    width: number
    height: number
    unit: number
    rippleA: Target
    rippleB: Target
    surface: Target
    caustic: Target
    causticBlur: Target
    bed: Target
    weeds: Target
    fish: Target
    shadow: Target
    shadowBlur: Target
    scene: Target
    gridVao: WebGLVertexArrayObject
    gridBuffers: WebGLBuffer[]
    gridIndexCount: number
    weedMesh: Weeds
    weedVao: WebGLVertexArrayObject
    weedBuffers: WebGLBuffer[]
  }
  let st: State | null = null

  function teardown() {
    if (!st) return
    ;[st.rippleA, st.rippleB, st.surface, st.caustic, st.causticBlur, st.bed, st.weeds, st.fish, st.shadow, st.shadowBlur, st.scene].forEach(free)
    gl.deleteVertexArray(st.gridVao)
    gl.deleteVertexArray(st.weedVao)
    st.gridBuffers.forEach((b) => gl.deleteBuffer(b))
    st.weedBuffers.forEach((b) => gl.deleteBuffer(b))
    st = null
  }

  function paintBed(s: State) {
    const { width: w, height: h, unit } = s
    gl.disable(gl.BLEND)
    gl.useProgram(P.bed.program)
    gl.uniform2f(P.bed.u('u_size'), w, h)
    gl.uniform1f(P.bed.u('u_unit'), unit)
    gl.uniform1f(P.bed.u('u_pixel'), w / s.bed.w)
    gl.uniform4fv(P.bed.u('u_stone[0]'), new Float32Array(STONES.flatMap((t) => [t.x * w, t.y * h, t.angle, t.seed])))
    gl.uniform4fv(P.bed.u('u_stoneDim[0]'), new Float32Array(STONES.flatMap((t) => [t.length * unit, t.width * unit, t.height * unit, t.tone])))
    bind(s.bed)
    fullscreen()
  }

  // lay out every blade once (deterministic per page load), then re-bend them each frame
  function buildWeeds(w: number, h: number): Weeds {
    const unit = w / 540
    let seed = WEED_SEED
    const rand = () => (seed = (seed * 16807) % 0x7fffffff) / 0x7fffffff
    const clumps = [...CLUMPS]
    for (let tries = 0; clumps.length < CLUMPS.length + 7 && tries < 400; tries++) {
      const x = rand()
      const y = rand()
      const edge = Math.min(x * w, (1 - x) * w, y * h, (1 - y) * h)
      if (edge < 50 * unit || edge > 110 * unit) continue // a band just inside the edge
      if (clumps.some((c) => Math.hypot((c.x - x) * w, (c.y - y) * h) < 60 * unit)) continue
      if (STONES.some((t) => Math.hypot((t.x - x) * w, (t.y - y) * h) < (t.length + 25) * unit)) continue
      clumps.push({ x, y, angle: 0.55 + (rand() - 0.5) * 0.6, count: 4 + Math.floor(rand() * 3), root: 6, length: [16, 38], width: [4, 6.5] })
    }
    const blades = clumps.flatMap((c) =>
      Array.from({ length: c.count }, () => ({
        x: c.x * w + (rand() - 0.5) * c.root * unit,
        y: c.y * h + (rand() - 0.5) * c.root * unit,
        angle: c.angle + (rand() - 0.5) * 1.3,
        length: (c.length[0] + rand() * (c.length[1] - c.length[0])) * unit,
        width: (c.width[0] + rand() * (c.width[1] - c.width[0])) * unit,
        curl: (rand() - 0.5) * 1.2,
        seed: rand(),
      })),
    )
    const vertices = new Float32Array(blades.length * WEED_POINTS * 2 * 5)
    const indices = new Uint16Array(blades.length * (WEED_POINTS - 1) * 6)
    let k = 0
    blades.forEach((_, b) => {
      const base = b * WEED_POINTS * 2
      for (let i = 0; i < WEED_POINTS - 1; i++) {
        const v = base + i * 2
        indices.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], k)
        k += 6
      }
    })
    function write(t: number) {
      let o = 0
      for (const blade of blades) {
        const step = blade.length / (WEED_POINTS - 1)
        let x = blade.x
        let y = blade.y
        for (let i = 0; i < WEED_POINTS; i++) {
          const along = i / (WEED_POINTS - 1)
          // a slow sway travelling up the blade, stronger toward the tip
          const sway = 0.28 * Math.sin(t * 0.8 + blade.seed * 17 - along * 2.4) * along + 0.05 * Math.sin(t * 1.9 + blade.seed * 5 - along * 4.5) * along
          const a = blade.angle + blade.curl * along + sway
          if (i > 0) {
            x += Math.cos(a) * step
            y += Math.sin(a) * step
          }
          const half = 0.5 * blade.width * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + 0.85 * along)), 0.6)
          const nx = -Math.sin(a) * half
          const ny = Math.cos(a) * half
          for (const side of [-1, 1]) {
            vertices[o++] = x + nx * side
            vertices[o++] = y + ny * side
            vertices[o++] = along
            vertices[o++] = side
            vertices[o++] = blade.seed
          }
        }
      }
    }
    write(0)
    return { vertices, indices, write }
  }

  function resize(cssW: number, cssH: number, dpr: number) {
    const w = Math.max(1, Math.round(cssW))
    const h = Math.max(1, Math.round(cssH))
    const dw = Math.max(1, Math.round(cssW * dpr))
    const dh = Math.max(1, Math.round(cssH * dpr))
    if (st && st.width === w && st.height === h) {
      // same pond, new pixel density: only the device resolution layers need rebuilding
      if (canvas.width === dw && canvas.height === dh) return
      ;[st.bed, st.weeds, st.fish, st.scene].forEach(free)
      canvas.width = dw
      canvas.height = dh
      st.bed = target(dw, dh, false)
      st.weeds = target(dw, dh, false)
      st.fish = target(dw, dh, true)
      st.scene = target(dw, dh, false)
      paintBed(st)
      return
    }
    teardown()
    canvas.width = dw
    canvas.height = dh

    // caustic grid: a vertex every 2 px, with a margin so light bent in from outside still lands
    const margin = 48
    const cols = Math.ceil((w + margin * 2) / 2) + 1
    const rows = Math.ceil((h + margin * 2) / 2) + 1
    const grid = new Float32Array(cols * rows * 2)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        grid[(y * cols + x) * 2] = -margin + x * 2
        grid[(y * cols + x) * 2 + 1] = -margin + y * 2
      }
    }
    const idx = new Uint32Array((cols - 1) * (rows - 1) * 6)
    let k = 0
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const i = y * cols + x
        idx[k++] = i
        idx[k++] = i + cols
        idx[k++] = i + 1
        idx[k++] = i + 1
        idx[k++] = i + cols
        idx[k++] = i + cols + 1
      }
    }
    const gridVao = gl.createVertexArray()!
    const gridVbo = gl.createBuffer()!
    const gridIbo = gl.createBuffer()!
    gl.bindVertexArray(gridVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gridVbo)
    gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gridIbo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)
    gl.bindVertexArray(null)

    const weedMesh = buildWeeds(w, h)
    const weedVao = gl.createVertexArray()!
    const weedVbo = gl.createBuffer()!
    const weedIbo = gl.createBuffer()!
    gl.bindVertexArray(weedVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, weedVbo)
    gl.bufferData(gl.ARRAY_BUFFER, weedMesh.vertices, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, weedIbo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, weedMesh.indices, gl.STATIC_DRAW)
    gl.bindVertexArray(null)

    // simulation layers run at CSS resolution, anything with fine detail at device resolution
    st = {
      width: w,
      height: h,
      unit: w / 540,
      rippleA: target(w, h, true),
      rippleB: target(w, h, true),
      surface: target(w, h, true),
      caustic: target(w, h, true),
      causticBlur: target(w, h, true),
      bed: target(dw, dh, false),
      weeds: target(dw, dh, false),
      fish: target(dw, dh, true),
      shadow: target(Math.ceil(w / 2), Math.ceil(h / 2), false),
      shadowBlur: target(Math.ceil(w / 2), Math.ceil(h / 2), false),
      scene: target(dw, dh, false),
      gridVao,
      gridBuffers: [gridVbo, gridIbo],
      gridIndexCount: idx.length,
      weedMesh,
      weedVao,
      weedBuffers: [weedVbo, weedIbo],
    }
    paintBed(st)
  }

  function stepRipples(dt: number) {
    if (!st) return
    gl.disable(gl.BLEND)
    bind(st.rippleB)
    const p = P.ripple
    gl.useProgram(p.program)
    tex(p, 'u_state', st.rippleA.tex, 0)
    gl.uniform2f(p.u('u_size'), st.width, st.height)
    gl.uniform1f(p.u('u_dt'), dt)
    gl.uniform1f(p.u('u_c2'), 22500) // wave speed 150 px/s, squared
    gl.uniform2f(p.u('u_damp'), 0.06 ** dt, 0.2 ** dt) // fine ripples fade fast, the wake lingers
    gl.uniform1f(p.u('u_diffuse'), 3 * dt)
    gl.uniform1i(p.u('u_dropCount'), dropCount)
    gl.uniform4fv(p.u('u_drops[0]'), drops)
    gl.uniform1i(p.u('u_splashCount'), splashCount)
    gl.uniform4fv(p.u('u_splashes[0]'), splashes)
    gl.uniform1i(p.u('u_pushCount'), pushCount)
    gl.uniform4fv(p.u('u_pushes[0]'), pushes)
    fullscreen()
    dropCount = splashCount = pushCount = 0
    ;[st.rippleA, st.rippleB] = [st.rippleB, st.rippleA]
  }

  function render(time: number, view: View = 'final') {
    if (!st || gl.isContextLost()) return
    const s = st
    const unit = s.unit

    // surface
    gl.disable(gl.BLEND)
    bind(s.surface)
    gl.useProgram(P.surface.program)
    tex(P.surface, 'u_state', s.rippleA.tex, 0)
    gl.uniform2f(P.surface.u('u_size'), s.width, s.height)
    gl.uniform1f(P.surface.u('u_time'), time)
    gl.uniform1f(P.surface.u('u_scale'), 0.0042 / unit)
    gl.uniform2f(P.surface.u('u_fine'), 0.05, 0.35)
    gl.uniform2f(P.surface.u('u_wake'), 0.13, 0.55)
    fullscreen()

    // caustics: additive, then softened
    bind(s.caustic)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.useProgram(P.caustic.program)
    tex(P.caustic, 'u_surface', s.surface.tex, 0)
    gl.uniform2f(P.caustic.u('u_size'), s.width, s.height)
    gl.uniform1f(P.caustic.u('u_depth'), 560 * unit * unit)
    gl.bindVertexArray(s.gridVao)
    gl.drawElements(gl.TRIANGLES, s.gridIndexCount, gl.UNSIGNED_INT, 0)
    gl.disable(gl.BLEND)
    blur(s.caustic, s.causticBlur, 1.3)

    // upload the fish once, draw them twice
    gl.bindVertexArray(fishVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, fishVbo)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, fishVertices)

    // shadow: silhouettes pushed down-right (away from the sun), at half res, blurred twice
    bind(s.shadow)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(P.shadow.program)
    gl.uniform2f(P.shadow.u('u_size'), s.width, s.height)
    gl.uniform1f(P.shadow.u('u_time'), time)
    gl.uniform2f(P.shadow.u('u_offset'), 22 * unit, 17 * unit)
    gl.bindVertexArray(fishVao)
    gl.drawElements(gl.TRIANGLES, INDICES_PER_FISH * fishCount, gl.UNSIGNED_SHORT, 0)
    gl.disable(gl.BLEND)
    blur(s.shadow, s.shadowBlur, 1.2)
    blur(s.shadow, s.shadowBlur, 1.2)

    // fish
    bind(s.fish)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const f = P.fish
    gl.useProgram(f.program)
    tex(f, 'u_caustic', s.caustic.tex, 0)
    gl.uniform2f(f.u('u_size'), s.width, s.height)
    gl.uniform2f(f.u('u_offset'), 0, 0)
    gl.uniform1f(f.u('u_time'), time)
    gl.uniform3fv(f.u('u_ambient'), AMBIENT)
    gl.uniform3fv(f.u('u_sun'), SUN)
    gl.uniform1f(f.u('u_fishLight'), 0.62)
    gl.uniform1f(f.u('u_pixel'), s.width / s.fish.w)
    gl.bindVertexArray(fishVao)
    gl.drawElements(gl.TRIANGLES, INDICES_PER_FISH * fishCount, gl.UNSIGNED_SHORT, 0)
    gl.disable(gl.BLEND)

    // seaweed
    s.weedMesh.write(time)
    bind(s.weeds)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(P.weed.program)
    gl.uniform2f(P.weed.u('u_size'), s.width, s.height)
    gl.bindVertexArray(s.weedVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, s.weedBuffers[0])
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.weedMesh.vertices)
    gl.drawElements(gl.TRIANGLES, s.weedMesh.indices.length, gl.UNSIGNED_SHORT, 0)
    gl.disable(gl.BLEND)

    if (view !== 'final') {
      const pick: Record<Exclude<View, 'final'>, [Target, number]> = {
        caustics: [s.caustic, 1],
        ripples: [s.rippleA, 2],
        surface: [s.surface, 3],
        bed: [s.bed, 4],
        fish: [s.fish, 5],
        shadow: [s.shadow, 6],
      }
      const [t, mode] = pick[view]
      bind(null)
      gl.useProgram(P.debug.program)
      tex(P.debug, 'u_tex', t.tex, 0)
      gl.uniform1i(P.debug.u('u_mode'), mode)
      fullscreen()
      return
    }

    // composite
    bind(s.scene)
    const c = P.composite
    gl.useProgram(c.program)
    tex(c, 'u_floor', s.bed.tex, 0)
    tex(c, 'u_surface', s.surface.tex, 1)
    tex(c, 'u_caustic', s.caustic.tex, 2)
    tex(c, 'u_shadow', s.shadow.tex, 3)
    tex(c, 'u_fish', s.fish.tex, 4)
    tex(c, 'u_weeds', s.weeds.tex, 5)
    gl.uniform2f(c.u('u_size'), s.width, s.height)
    gl.uniform1f(c.u('u_time'), time)
    gl.uniform3fv(c.u('u_ambient'), AMBIENT)
    gl.uniform3fv(c.u('u_sun'), SUN)
    gl.uniform1f(c.u('u_refraction'), 120 * unit * unit)
    gl.uniform1f(c.u('u_dispersion'), 60 * unit * unit)
    gl.uniform1f(c.u('u_rings'), 150)
    gl.uniform1f(c.u('u_exposure'), 1.3)
    fullscreen()

    // finish, straight to the canvas
    bind(null)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const fin = P.finish
    gl.useProgram(fin.program)
    tex(fin, 'u_scene', s.scene.tex, 0)
    gl.uniform2f(fin.u('u_size'), s.width, s.height)
    gl.uniform1f(fin.u('u_unit'), unit)
    gl.uniform1f(fin.u('u_feather'), 30 * unit)
    gl.uniform1f(fin.u('u_grain'), 0.07)
    gl.uniform1f(fin.u('u_grainSize'), 1.2 * (gl.drawingBufferWidth / s.width))
    gl.uniform1f(fin.u('u_grainFrame'), Math.floor(time * 24) % 1024)
    fullscreen()
  }

  return {
    fishVertices,
    resize,
    stepRipples,
    render,
    drop(x: number, y: number, r: number, amount: number) {
      if (dropCount >= 32) return
      drops.set([x, y, r, amount], dropCount++ * 4)
    },
    splash(x: number, y: number, r: number, amount: number) {
      if (splashCount >= 32) return
      splashes.set([x, y, r, amount], splashCount++ * 4)
    },
    push(x: number, y: number, r: number, amount: number) {
      if (pushCount >= 16) return
      pushes.set([x, y, r, amount], pushCount++ * 4)
    },
    pushRoom: () => 16 - pushCount,
    dispose() {
      teardown()
      programs.forEach((p) => gl.deleteProgram(p))
      gl.deleteVertexArray(emptyVao)
      gl.deleteVertexArray(fishVao)
      gl.deleteBuffer(fishVbo)
      gl.deleteBuffer(fishIbo)
    },
  }
}
