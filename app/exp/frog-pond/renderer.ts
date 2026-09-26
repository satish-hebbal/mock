// WebGL2 for the frog pond. Resolution budget, per CSS px of the page:
//   ripple sim, shadow map ........ 1/4 (a sixteenth of the pixels)
//   surface, caustics ............. min(tier scale, 1/2)
//   bed (baked once), the canvas .. tier scale
// The canvas is opaque and everything draws straight into it: composite, fish, pads, frogs, overlay.

import * as S from './shaders'
import { FROG_FS, FROG_VS } from './frog-shader'
import { COLS, FLOATS_PER_VERTEX, INDICES_PER_FISH, ROWS } from './koi'
import { FLOATS_PER_FROG } from './frogs'
import { FOCUS, type Layout } from './layout'
import type { Tier } from './quality'
import { ENVIRONMENTS, type Env } from './environments'

type Target = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }
type Program = { program: WebGLProgram; u: (name: string) => WebGLUniformLocation | null }

export type View = 'final' | 'caustics' | 'ripples' | 'bed' | 'shadow'
export type Renderer = NonNullable<ReturnType<typeof createRenderer>>

const WAVE_SPEED = 150 // px per second
// the app's page colour per theme: --canvas #08090a, and the light theme's --inverse-surface-1 #f5f6f6
const PAGE_DARK = [8 / 255, 9 / 255, 10 / 255]
const PAGE_LIGHT = [245 / 255, 246 / 255, 246 / 255]
const MAX_FLIES = 16

export function createRenderer(canvas: HTMLCanvasElement, fishCount: number, frogCount: number) {
  const ctx = canvas.getContext('webgl2', {
    alpha: false, // an opaque canvas is cheaper for the browser to composite
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power', // a background should never wake the discrete GPU
  })
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
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader failed to compile')
      gl.attachShader(p, sh)
      gl.deleteShader(sh)
    }
    attribs.forEach((name, i) => gl.bindAttribLocation(p, i, name))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) ?? 'program failed to link')
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
  type Name = 'ripple' | 'surface' | 'caustic' | 'blur' | 'bed' | 'weed' | 'composite' | 'fish' | 'fishShadow' | 'pad' | 'frog' | 'overlay' | 'debug'
  let P: Record<Name, Program>
  try {
    P = {
      ripple: program(S.FULLSCREEN_VS, S.RIPPLE_FS),
      surface: program(S.FULLSCREEN_VS, S.SURFACE_FS),
      caustic: program(S.CAUSTIC_VS, S.CAUSTIC_FS, ['a_pos']),
      blur: program(S.FULLSCREEN_VS, S.BLUR_FS),
      bed: program(S.FULLSCREEN_VS, S.BED_FS),
      weed: program(S.WEED_VS, S.WEED_FS, ['a_pos', 'a_leaf']),
      composite: program(S.FULLSCREEN_VS, S.COMPOSITE_FS),
      fish: program(S.FISH_VS, S.FISH_FS, fishAttribs),
      fishShadow: program(S.FISH_VS, S.SHADOW_FS, fishAttribs),
      pad: program(S.PAD_VS, S.PAD_FS, ['a_pad', 'a_look']),
      frog: program(FROG_VS, FROG_FS, ['a_body', 'a_pose', 'a_anchor', 'a_extra']),
      overlay: program(S.FULLSCREEN_VS, S.OVERLAY_FS),
      debug: program(S.FULLSCREEN_VS, S.DEBUG_FS),
    }
  } catch (err) {
    console.error(err)
    programs.forEach((p) => gl.deleteProgram(p))
    return null
  }

  const emptyVao = gl.createVertexArray()

  // koi ribbons
  const fishVertices = new Float32Array(Math.max(fishCount, 1) * ROWS * COLS * FLOATS_PER_VERTEX)
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

  // instanced quads: vec4 attributes, one set per instance
  function instanced(floatsPer: number, dynamicBytes: number) {
    const vao = gl.createVertexArray()!
    const vbo = gl.createBuffer()!
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    if (dynamicBytes) gl.bufferData(gl.ARRAY_BUFFER, dynamicBytes, gl.DYNAMIC_DRAW)
    for (let i = 0; i < floatsPer / 4; i++) {
      gl.enableVertexAttribArray(i)
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, floatsPer * 4, i * 16)
      gl.vertexAttribDivisor(i, 1)
    }
    gl.bindVertexArray(null)
    return { vao, vbo }
  }
  const frogInstances = new Float32Array(Math.max(frogCount, 1) * FLOATS_PER_FROG)
  const frogGeo = instanced(FLOATS_PER_FROG, frogInstances.byteLength)
  const padGeo = instanced(8, 0)
  let padCount = 0

  const drops = new Float32Array(32 * 4)
  const splashes = new Float32Array(32 * 4)
  const pushes = new Float32Array(S.MAX_PUSHES * 4)
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

  type State = {
    width: number
    height: number
    unit: number
    scale: number
    texelPx: number
    rippleA: Target
    rippleB: Target
    surface: Target
    caustic: Target
    causticBlur: Target
    shadow: Target
    shadowBlur: Target
    bed: Target
    gridVao: WebGLVertexArrayObject
    gridBuffers: WebGLBuffer[]
    gridIndexCount: number
  }
  let st: State | null = null

  function teardown() {
    if (!st) return
    ;[st.rippleA, st.rippleB, st.surface, st.caustic, st.causticBlur, st.shadow, st.shadowBlur, st.bed].forEach(free)
    gl.deleteVertexArray(st.gridVao)
    st.gridBuffers.forEach((b) => gl.deleteBuffer(b))
    st = null
  }

  // the bed and the weed on it never move, so they are painted once into one texture
  function bakeBed(s: State, layout: Layout) {
    const { width: w, height: h, unit } = s
    gl.disable(gl.BLEND)
    const b = P.bed
    gl.useProgram(b.program)
    gl.uniform2f(b.u('u_size'), w, h)
    gl.uniform1f(b.u('u_unit'), unit)
    gl.uniform1f(b.u('u_pixel'), w / s.bed.w)
    gl.uniform3fv(b.u('u_sunDir'), env.lightDir)
    gl.uniform4fv(b.u('u_stone[0]'), new Float32Array(layout.stones.flatMap((t) => [t.x, t.y, t.angle, t.seed])))
    gl.uniform4fv(b.u('u_stoneDim[0]'), new Float32Array(layout.stones.flatMap((t) => [t.length, t.width, t.height, t.tone])))
    bind(s.bed)
    fullscreen()

    // weed strips, blended onto the colour but leaving the moonlight channel (alpha) alone
    const points = 14
    const verts = new Float32Array(layout.blades.length * points * 2 * 5)
    const idx = new Uint16Array(layout.blades.length * (points - 1) * 6)
    let o = 0
    let k = 0
    layout.blades.forEach((blade, n) => {
      const step = blade.length / (points - 1)
      let x = blade.x
      let y = blade.y
      for (let i = 0; i < points; i++) {
        const along = i / (points - 1)
        const a = blade.angle + blade.curl * along + 0.2 * Math.sin(blade.seed * 17 - along * 2.4) * along
        if (i > 0) {
          x += Math.cos(a) * step
          y += Math.sin(a) * step
        }
        const half = 0.5 * blade.width * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + 0.85 * along)), 0.6)
        for (const side of [-1, 1]) {
          verts.set([x - Math.sin(a) * half * side, y + Math.cos(a) * half * side, along, side, blade.seed], o)
          o += 5
        }
      }
      const base = n * points * 2
      for (let i = 0; i < points - 1; i++) {
        const v = base + i * 2
        idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], k)
        k += 6
      }
    })
    const vao = gl.createVertexArray()
    const vbo = gl.createBuffer()
    const ibo = gl.createBuffer()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE)
    gl.useProgram(P.weed.program)
    gl.uniform2f(P.weed.u('u_size'), w, h)
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0)
    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(vao)
    gl.deleteBuffer(vbo)
    gl.deleteBuffer(ibo)
  }

  function uploadPads(layout: Layout) {
    const data = new Float32Array((layout.pads.length + layout.flowers.length) * 8)
    let o = 0
    for (const p of layout.pads) {
      data.set([p.x, p.y, p.r, p.angle, p.seed, 0, p.tint, 0], o)
      o += 8
    }
    for (const f of layout.flowers) {
      data.set([f.x, f.y, f.r, f.angle, f.seed, 1, 0, 0], o)
      o += 8
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, padGeo.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    padCount = layout.pads.length + layout.flowers.length
  }

  function resize(layout: Layout, tier: Tier) {
    teardown()
    const { width: w, height: h, unit } = layout
    canvas.width = Math.max(1, Math.round(w * tier.scale))
    canvas.height = Math.max(1, Math.round(h * tier.scale))
    const simW = Math.max(1, Math.ceil(w / tier.sim))
    const simH = Math.max(1, Math.ceil(h / tier.sim))
    const lo = Math.min(tier.scale, 0.5)
    const loW = Math.max(1, Math.round(w * lo))
    const loH = Math.max(1, Math.round(h * lo))

    const spacing = tier.grid
    const margin = 48
    const cols = Math.ceil((w + margin * 2) / spacing) + 1
    const rows = Math.ceil((h + margin * 2) / spacing) + 1
    const grid = new Float32Array(cols * rows * 2)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        grid[(y * cols + x) * 2] = -margin + x * spacing
        grid[(y * cols + x) * 2 + 1] = -margin + y * spacing
      }
    }
    const idx = new Uint32Array((cols - 1) * (rows - 1) * 6)
    let k = 0
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const i = y * cols + x
        idx.set([i, i + cols, i + 1, i + 1, i + cols, i + cols + 1], k)
        k += 6
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

    st = {
      width: w,
      height: h,
      unit,
      scale: tier.scale,
      texelPx: w / simW,
      rippleA: target(simW, simH, true),
      rippleB: target(simW, simH, true),
      surface: target(loW, loH, true),
      caustic: target(loW, loH, true),
      causticBlur: target(loW, loH, true),
      shadow: target(simW, simH, false),
      shadowBlur: target(simW, simH, false),
      bed: target(canvas.width, canvas.height, false),
      gridVao,
      gridBuffers: [gridVbo, gridIbo],
      gridIndexCount: idx.length,
    }
    bakedLayout = layout
    bakeBed(st, layout)
    uploadPads(layout)
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
    // 150 px/s, expressed in sim texels: coarse texels are what let each step be long
    gl.uniform1f(p.u('u_c2'), (WAVE_SPEED / st.texelPx) ** 2)
    gl.uniform2f(p.u('u_damp'), 0.14 ** dt, 0.2 ** dt) // fine rings linger a little longer than the koi pond's, so splashes and rain read
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

  type Frame = { time: number; fish: number; frogs: number; frogsLow: number; flies: Float32Array; flyCount: number; view: View }

  function render(f: Frame) {
    now = f.time
    if (!st || gl.isContextLost()) return
    const s = st
    const unit = s.unit
    const bob = 150 * unit
    const [lx, ly, lz] = env.lightDir
    let sx = (-lx / Math.max(lz, 0.2)) * 30 * unit
    let sy = (-ly / Math.max(lz, 0.2)) * 30 * unit
    const reach = Math.hypot(sx, sy)
    if (reach > 90 * unit) {
      sx *= (90 * unit) / reach
      sy *= (90 * unit) / reach
    }
    const shadowShift = [sx, sy]

    // surface
    gl.disable(gl.BLEND)
    bind(s.surface)
    const sf = P.surface
    gl.useProgram(sf.program)
    tex(sf, 'u_state', s.rippleA.tex, 0)
    gl.uniform2f(sf.u('u_size'), s.width, s.height)
    gl.uniform1f(sf.u('u_time'), f.time)
    gl.uniform1f(sf.u('u_scale'), 0.0042 / unit)
    // coarse texels flatten slopes, so fine ripples are scaled with the texel size to read the same
    gl.uniform2f(sf.u('u_fine'), 0.055 * s.texelPx, 0.35)
    gl.uniform2f(sf.u('u_wake'), 0.2, 0.55)
    fullscreen()

    // caustics
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

    // shadow map: everything that blocks moonlight, as silhouettes shifted down and left
    bind(s.shadow)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    if (f.fish > 0) {
      gl.bindVertexArray(fishVao)
      gl.bindBuffer(gl.ARRAY_BUFFER, fishVbo)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, fishVertices)
      const fs = P.fishShadow
      gl.useProgram(fs.program)
      gl.uniform2f(fs.u('u_size'), s.width, s.height)
      gl.uniform1f(fs.u('u_time'), f.time)
      gl.uniform2f(fs.u('u_offset'), sx * 0.58, sy * 0.58) // koi swim lower than the pads float
      gl.drawElements(gl.TRIANGLES, INDICES_PER_FISH * f.fish, gl.UNSIGNED_SHORT, 0)
    }
    drawPads(s, f.time, bob, shadowShift, 1, padGeo.vao, padCount)
    if (f.frogs > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, frogGeo.vbo)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, frogInstances)
      drawFrogs(s, f.time, bob, shadowShift, 1, 0, f.frogs)
    }
    gl.disable(gl.BLEND)
    blur(s.shadow, s.shadowBlur, 1.2)
    blur(s.shadow, s.shadowBlur, 1.2)

    if (f.view !== 'final') {
      const pick: Record<Exclude<View, 'final'>, [Target, number]> = {
        caustics: [s.caustic, 1],
        ripples: [s.rippleA, 2],
        bed: [s.bed, 3],
        shadow: [s.shadow, 4],
      }
      const [t, mode] = pick[f.view]
      bind(null)
      gl.useProgram(P.debug.program)
      tex(P.debug, 'u_tex', t.tex, 0)
      gl.uniform1i(P.debug.u('u_mode'), mode)
      fullscreen()
      return
    }

    // the water. In the half layout nothing below the shoreline shows, so start from the page's
    // black and only draw the pond above the line: roughly half the pixels on a typical screen
    bind(null)
    // the solid shore (an SVG over the canvas) covers everything below the shelf
    const cut = shore.amount >= 1 ? Math.min(s.height, shore.shelf + 12 * unit) : s.height
    if (cut < s.height) {
      gl.clearColor(page[0], page[1], page[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const rows = Math.ceil(cut * s.scale)
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(0, gl.drawingBufferHeight - rows, gl.drawingBufferWidth, rows)
    }
    const c = P.composite
    gl.useProgram(c.program)
    tex(c, 'u_bed', s.bed.tex, 0)
    tex(c, 'u_surface', s.surface.tex, 1)
    tex(c, 'u_caustic', s.caustic.tex, 2)
    tex(c, 'u_shadow', s.shadow.tex, 3)
    gl.uniform2f(c.u('u_size'), s.width, s.height)
    gl.uniform1f(c.u('u_time'), f.time)
    tone(c)
    gl.uniform1f(c.u('u_clarity'), env.clarity)
    gl.uniform1f(c.u('u_causticGain'), env.causticGain)
    gl.uniform1f(c.u('u_shadowStrength'), env.shadowStrength)
    gl.uniform3fv(c.u('u_sky'), env.sky)
    gl.uniform3fv(c.u('u_sky2'), env.sky2)
    gl.uniform3fv(c.u('u_glowColor'), env.glowColor)
    gl.uniform1f(c.u('u_glowStrength'), env.glowStrength)
    gl.uniform1f(c.u('u_glitter'), env.glitter)
    gl.uniform1f(c.u('u_ringShine'), env.ringShine)
    gl.uniform1f(c.u('u_refraction'), 120 * unit * unit)
    gl.uniform1f(c.u('u_dispersion'), 40 * unit * unit)
    gl.uniform1f(c.u('u_rings'), 260)
    gl.uniform1f(c.u('u_reflect'), 260 * unit)
    gl.uniform3f(c.u('u_glow'), s.width * env.glow[0], s.height * env.glow[1], env.glow[2] * unit)
    fullscreen()

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    if (f.fish > 0) {
      const k = P.fish
      gl.useProgram(k.program)
      tex(k, 'u_caustic', s.caustic.tex, 0)
      gl.uniform2f(k.u('u_size'), s.width, s.height)
      gl.uniform2f(k.u('u_offset'), 0, 0)
      gl.uniform1f(k.u('u_time'), f.time)
      tone(k)
      gl.uniform1f(k.u('u_fishLight'), 0.62)
      gl.uniform1f(k.u('u_pixel'), 1 / s.scale)
      gl.bindVertexArray(fishVao)
      gl.drawElements(gl.TRIANGLES, INDICES_PER_FISH * f.fish, gl.UNSIGNED_SHORT, 0)
    }

    // swimmers under the pads, frogs sitting or leaping over them
    if (f.frogsLow > 0) drawFrogs(s, f.time, bob, [0, 0], 0, 0, f.frogsLow)
    drawPads(s, f.time, bob, [0, 0], 0, padGeo.vao, padCount)
    if (f.frogs > f.frogsLow) drawFrogs(s, f.time, bob, [0, 0], 0, f.frogsLow, f.frogs - f.frogsLow)

    const ov = P.overlay
    gl.useProgram(ov.program)
    tex(ov, 'u_surface', s.surface.tex, 0)
    gl.uniform2f(ov.u('u_size'), s.width, s.height)
    gl.uniform1f(ov.u('u_unit'), unit)
    gl.uniform1i(ov.u('u_flyCount'), Math.min(f.flyCount, MAX_FLIES))
    gl.uniform4fv(ov.u('u_flies[0]'), f.flies)
    gl.uniform4f(ov.u('u_focus'), FOCUS.x * s.width, FOCUS.y * s.height, FOCUS.rx * s.width, FOCUS.ry * s.height)
    gl.uniform1f(ov.u('u_focusDark'), focusOn ? env.focusDark : 0)
    gl.uniform1f(ov.u('u_edgeDark'), env.edgeDark * (page === PAGE_LIGHT ? 0.55 : 1)) // lighter edges beside a light page
    gl.uniform1f(ov.u('u_flyGain'), env.fireflies)
    gl.uniform1f(ov.u('u_rain'), env.rain)
    gl.uniform1f(ov.u('u_time'), f.time)
    gl.uniform3fv(ov.u('u_haze'), env.haze)
    gl.uniform3fv(ov.u('u_lightDir'), env.lightDir)
    // the cards hover higher than a pad floats, so their shadow falls further, up to a limit
    const lift = Math.min(1.7, (140 * unit) / Math.max(Math.hypot(sx, sy), 1))
    gl.uniform1i(ov.u('u_cardCount'), focusOn ? cardCount : 0)
    gl.uniform4fv(ov.u('u_cards[0]'), cards)
    gl.uniform1f(ov.u('u_cardRadius'), 16) // HOME_SEAM's radius
    gl.uniform2f(ov.u('u_cardShift'), sx * lift, sy * lift)
    gl.uniform3fv(ov.u('u_page'), PAGE_DARK) // the wash over the water darkens on both themes; toward white it read as glare
    gl.uniform1f(ov.u('u_cardBlur'), (8 * unit + Math.hypot(sx, sy) * lift * 0.3) * env.softness)
    gl.uniform1f(ov.u('u_cardShadow'), Math.min(1, env.shadowStrength * 1.1))
    gl.uniform1f(ov.u('u_wobble'), 60 * unit * unit)
    for (let i = sprays.length - 1; i >= 0; i--) if (f.time - sprays[i].born > 1) sprays.splice(i, 1)
    sprays.forEach((sp, i) => sprayData.set([sp.x, sp.y, f.time - sp.born, sp.size], i * 4))
    gl.uniform1i(ov.u('u_sprayCount'), sprays.length)
    gl.uniform4fv(ov.u('u_sprays[0]'), sprayData)
    gl.uniform1f(ov.u('u_grain'), 0.05)
    gl.uniform1f(ov.u('u_grainFrame'), Math.floor(f.time * 24) % 1024)
    gl.uniform1f(ov.u('u_grainSize'), 1.2 * s.scale)
    fullscreen()
    gl.disable(gl.BLEND)
    gl.disable(gl.SCISSOR_TEST)
  }

  function drawPads(s: State, time: number, bob: number, offset: number[], mode: number, vao: WebGLVertexArrayObject, count: number) {
    if (!count) return
    const p = P.pad
    gl.useProgram(p.program)
    tex(p, 'u_surface', s.surface.tex, 0)
    gl.uniform2f(p.u('u_size'), s.width, s.height)
    gl.uniform1f(p.u('u_time'), time)
    gl.uniform1f(p.u('u_bob'), bob)
    gl.uniform2fv(p.u('u_offset'), offset)
    gl.uniform1i(p.u('u_mode'), mode)
    gl.uniform1f(p.u('u_scale'), mode ? s.shadow.w / s.width : s.scale)
    tone(p)
    gl.bindVertexArray(vao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
  }

  function drawFrogs(s: State, time: number, bob: number, offset: number[], mode: number, first: number, count: number) {
    const p = P.frog
    gl.useProgram(p.program)
    tex(p, 'u_surface', s.surface.tex, 0)
    gl.uniform2f(p.u('u_size'), s.width, s.height)
    gl.uniform1f(p.u('u_time'), time)
    gl.uniform1f(p.u('u_bob'), bob)
    gl.uniform2fv(p.u('u_offset'), offset)
    gl.uniform1i(p.u('u_mode'), mode)
    gl.uniform1f(p.u('u_scale'), mode ? s.shadow.w / s.width : s.scale)
    tone(p)
    gl.bindVertexArray(frogGeo.vao)
    // WebGL2 has no base instance, so start part way through the buffer by moving the attribute pointers
    gl.bindBuffer(gl.ARRAY_BUFFER, frogGeo.vbo)
    for (let i = 0; i < FLOATS_PER_FROG / 4; i++) {
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, FLOATS_PER_FROG * 4, (first * FLOATS_PER_FROG + i * 4) * 4)
    }
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
  }

  let env: Env = ENVIRONMENTS.overcast
  let focusOn = true
  // splashes being drawn, and the clock they age by
  const sprays: { x: number; y: number; born: number; size: number }[] = []
  const sprayData = new Float32Array(8 * 4)
  let now = 0
  const cards = new Float32Array(8 * 4)
  let cardCount = 0
  // the half page layout: how far in it is (0..1), and where its shelf is, so the pond under the solid
  // shore (drawn as an SVG over the canvas) can be skipped
  const shore = { amount: 0, plateau: new Float32Array(4), shelf: 0 }
  let page = PAGE_DARK
  let bakedLayout: Layout | null = null

  // the weather's light and grade, for every program that shades with it
  function tone(p: Program) {
    gl.uniform3fv(p.u('u_ambient'), env.ambient)
    gl.uniform3fv(p.u('u_key'), env.key)
    gl.uniform3fv(p.u('u_sun'), env.key) // the koi shader's name for it
    gl.uniform3fv(p.u('u_water'), env.water)
    gl.uniform3fv(p.u('u_lightDir'), env.lightDir)
    gl.uniform4fv(p.u('u_grade'), env.grade)
    gl.uniform1f(p.u('u_exposure'), env.exposure)
  }

  // impulses smaller than a sim texel would vanish (or alias), so they are widened to at least 1.6
  const widen = (r: number) => Math.max(r, (st?.texelPx ?? 4) * 1.6)

  return {
    fishVertices,
    frogInstances,
    resize,
    stepRipples,
    render,
    setFocus(on: boolean) {
      focusOn = on
    },
    // page elements floating over the pond, as rects in CSS px, for the shadows they cast
    setCards(rects: DOMRect[]) {
      cardCount = Math.min(rects.length, 8)
      for (let i = 0; i < cardCount; i++) cards.set([rects[i].left, rects[i].top, rects[i].width, rects[i].height], i * 4)
    },
    setTheme(light: boolean) {
      page = light ? PAGE_LIGHT : PAGE_DARK
    },
    setShore(amount: number, plateau: ArrayLike<number>, shelf: number) {
      shore.amount = amount
      shore.plateau.set(plateau)
      shore.shelf = shelf
    },
    setEnv(next: Env) {
      env = next
    },
    // the bed's stone shadows are baked, so repaint it once the light has moved
    rebakeBed() {
      if (st && bakedLayout) bakeBed(st, bakedLayout)
    },
    drop(x: number, y: number, r: number, amount: number) {
      if (dropCount < 32) drops.set([x, y, widen(r), amount], dropCount++ * 4)
    },
    splash(x: number, y: number, r: number, amount: number) {
      if (splashCount < 32) splashes.set([x, y, widen(r), amount], splashCount++ * 4)
    },
    push(x: number, y: number, r: number, amount: number) {
      if (pushCount < S.MAX_PUSHES) pushes.set([x, y, widen(r), amount], pushCount++ * 4)
    },
    pushRoom: () => S.MAX_PUSHES - pushCount,
    // the longest ripple step that stays stable: the wave may cross at most ~0.7 of a texel per step
    maxStep: () => (0.7 * (st?.texelPx ?? 4)) / WAVE_SPEED,
    spray(x: number, y: number, size: number) {
      sprays.push({ x, y, born: now, size })
      if (sprays.length > 8) sprays.shift()
    },
    gl,
    dispose() {
      teardown()
      programs.forEach((p) => gl.deleteProgram(p))
      gl.deleteVertexArray(emptyVao)
      gl.deleteVertexArray(fishVao)
      gl.deleteBuffer(fishVbo)
      gl.deleteBuffer(fishIbo)
      gl.deleteVertexArray(frogGeo.vao)
      gl.deleteBuffer(frogGeo.vbo)
      gl.deleteVertexArray(padGeo.vao)
      gl.deleteBuffer(padGeo.vbo)
    },
  }
}
