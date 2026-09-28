// The home page pond: owns the simulation (koi, frogs, fireflies, rain), the WebGL renderer and the
// quality governor, and runs the frame loop. The home page mounts it behind its content and disposes
// it on unmount, so none of it runs, or holds GPU memory, while a tool is open.
//
// The pond is the top of the home page only: a solid shore (an SVG in the page colour, see
// drawShore) rises from a shelf level with the bottom of the tool cards to frame the card row, and
// nothing below that is drawn. Everything is measured against the host box in CSS px ("pond px").

import { buildLayout, type Layout } from './layout'
import { createSchool } from './koi'
import { createFrogs } from './frogs'
import { createFlies } from './flies'
import { createRenderer } from './renderer'
import { createGovernor, startingTier, TIERS } from './quality'
import { ENVIRONMENTS, mixEnv, type Env, type EnvName } from './environments'

export type PondElements = {
  /** the pond's box: sizes and pointer positions are measured against it */
  host: HTMLElement
  canvas: HTMLCanvasElement
  /** the page content over the pond, searched for the tool cards */
  content: HTMLElement
  shoreFill: SVGPathElement
  shoreRims: SVGPathElement[]
  shoreGlint: SVGLinearGradientElement
}

export type Pond = {
  setEnvironment(name: EnvName): void
  setLight(light: boolean): void
  dispose(): void
}

const CARD_SELECTOR = '.tool-card'
// a press on any of these belongs to the page, not the water
const INTERACTIVE = 'button, a, input, textarea, select, [role="button"], kbd, .tool-card'
const ENV_BLEND = 2.5 // seconds to blend from one weather to the next
const POND_RADIUS = 16 // the home page's rounded-xl, which clips the pond's top corners
const IDLE_AFTER = 20000
const IDLE_FPS = 12

export function createPond(el: PondElements, initial: { env: EnvName; light: boolean }): Pond {
  const { host, canvas, content } = el
  const SEED = 1 + Math.floor(Math.random() * 0x7ffffffd)
  const derive = (k: number) => (SEED * k) % 0x7fffffff || 1

  let width = Math.max(1, host.clientWidth)
  let height = Math.max(1, host.clientHeight)
  let layout: Layout = buildLayout(width, height, SEED)
  const koi = createSchool(width, height, layout.unit)
  let clock = 30 // start the noise clock mid-flow so the first frame isn't suspiciously calm
  const SITTING = 3
  const SWIMMING = 2
  let frogs = createFrogs(layout, SITTING, SWIMMING, derive(48271), clock)
  const flies = createFlies(12, derive(69621))

  let envName: EnvName = initial.env
  let envFrom: Env = ENVIRONMENTS[envName]
  let env: Env = envFrom
  let envT = 1
  let rainCarry = 0

  let raf = 0
  let lastDraw = 0
  let lastInput = performance.now()
  let awakeUntil = 0
  let frozen = false
  let disposed = false
  let shoreD = ''
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  const start = startingTier()
  /*
   * The frog buffer is sized for the most frogs a scene can hold, not for the
   * first scene's. How many find a seat depends on the pads, so a pond laid out
   * again (a phone's tall first layout, then the shorter one under the shore)
   * can hold more frogs than it started with, and a buffer sized to the first
   * count was overrun on the next frame.
   */
  const renderer = start === 'poster' ? null : createRenderer(canvas, koi.count, SITTING + SWIMMING)
  if (!renderer) {
    // a weak device, data saver, or no WebGL2: a still, painted pond and nothing running
    host.dataset.poster = ''
    return { setEnvironment() {}, setLight() {}, dispose() {} }
  }
  const governor = createGovernor(renderer.gl, typeof start === 'number' ? start : 1, (tier) => {
    if (tier === 'frozen') {
      frozen = true // the last frame stays on screen and nothing runs
      stop()
    } else {
      renderer.resize(layout, TIERS[tier])
      drawOnce()
    }
  })

  function cardRects() {
    const box = host.getBoundingClientRect()
    return [...content.querySelectorAll(CARD_SELECTOR)].map((c) => {
      const r = c.getBoundingClientRect()
      return new DOMRect(r.left - box.left, r.top - box.top, r.width, r.height)
    })
  }

  // the shore's black rises to a box around the card row and sits flat, level with the cards'
  // bottom edge; with no cards on screen it falls back to a line a little over halfway down
  function shoreFrom(rects: DOMRect[]) {
    const unit = layout.unit
    if (!rects.length) return { plateau: [width / 2, -1e4, 0, 0], shelf: height * 0.62 }
    const left = Math.min(...rects.map((r) => r.left)) - 18 * unit
    const right = Math.max(...rects.map((r) => r.right)) + 18 * unit
    const top = Math.min(...rects.map((r) => r.top)) - 18 * unit
    const bottom = Math.max(...rects.map((r) => r.bottom))
    return { plateau: [(left + right) / 2, (top + bottom) / 2, (right - left) / 2, (bottom - top) / 2], shelf: bottom }
  }
  let shelf = height * 0.62

  // The shore: a solid shape in the page colour, drawn as an SVG over the canvas so its edge is crisp
  // at any render scale. It frames the card row with rounded top corners and small concave curves
  // into the shelf, and rounds off the pond's bottom corners where the shelf meets the sides. A thin
  // steel rim runs right round the pond: along the shore, up both sides and across the top.
  function drawShore(sh: { plateau: number[]; shelf: number }) {
    const [cx, cy, hx, hy] = sh.plateau
    const u = layout.unit
    const n = (v: number) => Math.round(v * 10) / 10
    const S = n(sh.shelf)
    const e = 1 // the rim sits a pixel inside the host, so its rounded, clipped edge doesn't halve it
    const W = n(width - e)
    const k = n(Math.min(20 * u, S / 2)) // the pond's rounded bottom corners
    const top = POND_RADIUS - e // the host's own rounded top corners, which the rim follows
    // the shore edge, left to right, from the pond's bottom left corner to its bottom right
    let edge = `M${e} ${n(S - k)}A${k} ${k} 0 0 0 ${n(e + k)} ${S}`
    if (cy > -1000) {
      const L = n(cx - hx)
      const R = n(cx + hx)
      const T = n(cy - hy)
      const r = n(Math.max(0, Math.min(28 * u, hx, (S - T) / 2))) // the plateau's rounded top corners
      const f = n(Math.max(0, Math.min(16 * u, S - T - r))) // a tight curve into the shelf, about a card corner
      edge +=
        `H${n(L - f)}A${f} ${f} 0 0 0 ${L} ${n(S - f)}V${n(T + r)}A${r} ${r} 0 0 1 ${n(L + r)} ${T}` +
        `H${n(R - r)}A${r} ${r} 0 0 1 ${R} ${n(T + r)}V${n(S - f)}A${f} ${f} 0 0 0 ${n(R + f)} ${S}`
    }
    edge += `H${n(W - k)}A${k} ${k} 0 0 0 ${W} ${n(S - k)}`
    if (edge === shoreD) return
    shoreD = edge
    // the fill drops from the bottom right corner to the page's foot and back round to the start
    // (out to the host's true edges, not the rim's inset line, or a hairline of water shows below)
    el.shoreFill.setAttribute('d', `${edge}H${width}V${height}H0V${n(S - k)}Z`)
    // the rim carries on up the right side, across the top and down the left, closing the loop
    const rim = `${edge}V${top + e}A${top} ${top} 0 0 0 ${n(W - top)} ${e}H${top + e}A${top} ${top} 0 0 0 ${e} ${top + e}Z`
    for (const p of el.shoreRims) p.setAttribute('d', rim)
  }

  // lay the pond out again for how far down it now reaches; the canvas keeps its size
  function rebuildScene(waterBottom: number) {
    layout = buildLayout(width, height, SEED, Math.min(height, waterBottom))
    koi.resize(width, layout.waterBottom, layout.unit)
    frogs = createFrogs(layout, SITTING, SWIMMING, derive(48271), clock)
    renderer!.resize(layout, TIERS[governor.tier])
  }

  function canRun(now: number) {
    if (disposed || frozen || document.hidden) return false
    return !reducedMotion.matches || now < awakeUntil
  }

  function frame(dt: number) {
    const r = renderer!
    clock += dt
    if (envT < 1) {
      const before = envT
      envT = Math.min(1, envT + dt / ENV_BLEND)
      env = mixEnv(envFrom, ENVIRONMENTS[envName], envT * envT * (3 - 2 * envT))
      r.setEnv(env)
      // stone shadows are baked into the bed: repaint halfway through and at the end
      if ((before < 0.5 && envT >= 0.5) || envT === 1) r.rebakeBed()
    }
    koi.update(dt, clock)
    frogs.update(dt, clock, r, env.croak)
    // the ripple sim is only stable for short steps (shorter the finer its texels), so split the frame
    const steps = Math.min(10, Math.max(1, Math.ceil(dt / r.maxStep() - 0.01)))
    // raindrops land all over the pond, a few hundred a second in a downpour on a big screen
    const rainPerStep = (env.rain * 2.2e-4 * width * shelf * dt) / steps
    for (let i = 1; i <= steps; i++) {
      rainCarry += rainPerStep
      for (; rainCarry >= 1; rainCarry--) r.drop(Math.random() * width, Math.random() * shelf, 2 * layout.unit, 0.15 + Math.random() * 0.3)
      koi.emitRipples(clock - dt + (dt * i) / steps, i / steps, dt / steps, r)
      frogs.emitWake(i / steps, r)
      r.stepRipples(dt / steps)
    }
    koi.writeVertices(r.fishVertices)
    const frogsLow = frogs.writeInstances(r.frogInstances)
    const flyData = flies.update(clock, width, shelf, layout.unit)
    // the cards cast shadows into the pond and set the shore; six rect reads a frame is cheap
    const rects = cardRects()
    r.setCards(rects)
    const sh = shoreFrom(rects)
    shelf = sh.shelf
    r.setShore(1, sh.plateau, sh.shelf)
    drawShore(sh)
    if (Math.abs(sh.shelf - layout.waterBottom) > 24) rebuildScene(sh.shelf)
    governor.begin()
    r.render({ time: clock, fish: koi.count, frogs: frogs.count, frogsLow, flies: flyData, flyCount: flies.count })
    governor.end()
  }

  function tick(now: number) {
    raf = requestAnimationFrame(tick)
    if (!canRun(now)) return stop()
    const idle = now - lastInput > IDLE_AFTER
    const target = idle ? Math.min(IDLE_FPS, TIERS[governor.tier].fps) : TIERS[governor.tier].fps
    const interval = now - lastDraw
    // the display refreshes at 60 to 144 Hz; only draw when a frame at our rate is due
    if (lastDraw && interval < 1000 / target - 3) return
    frame(lastDraw ? Math.min(interval / 1000, 0.1) : 1 / target)
    if (lastDraw && !idle) governor.frame(interval, now)
    lastDraw = now
  }

  function stop() {
    cancelAnimationFrame(raf)
    raf = 0
    lastDraw = 0
  }

  function wake() {
    if (!raf && canRun(performance.now())) raf = requestAnimationFrame(tick)
  }

  function drawOnce() {
    if (!raf && !disposed) frame(0)
  }

  function touched() {
    lastInput = performance.now()
    awakeUntil = lastInput + 4000
    wake()
  }

  function local(e: PointerEvent) {
    const box = host.getBoundingClientRect()
    return [e.clientX - box.left, e.clientY - box.top] as const
  }
  const inPond = (x: number, y: number) => x >= 0 && x <= width && y >= 0 && y < shelf

  // input: the pond sits behind the page, so listen on the window
  let trail: [number, number] | null = null
  const onMove = (e: PointerEvent) => {
    touched()
    const [x, y] = local(e)
    // the rim's glint slides along it under the pointer, like light catching polished steel
    el.shoreGlint.setAttribute('x1', String(x - 220))
    el.shoreGlint.setAttribute('x2', String(x + 220))
    if (!inPond(x, y)) return
    // the cursor trails a faint wake
    if (!trail || Math.hypot(x - trail[0], y - trail[1]) > 14 * layout.unit) {
      renderer.drop(x, y, 5 * layout.unit, 0.12)
      trail = [x, y]
    }
  }
  const onDown = (e: PointerEvent) => {
    touched()
    const [x, y] = local(e)
    if (e.button > 0 || !inPond(x, y) || (e.target as HTMLElement).closest(INTERACTIVE)) return
    const frog = frogs.hitTest(x, y)
    if (frog) return frogs.poke(frog, x, y, clock, renderer)
    const pad = layout.pads.find((p) => Math.hypot(p.x - x, p.y - y) < p.r)
    if (pad) return renderer.splash(pad.x, pad.y, pad.r, 0.8) // press the pad and it dips
    const fish = koi.hitTest(x, y)
    if (fish) {
      koi.scare(fish, x, y)
      renderer.splash(x, y, 7, 1.4)
      return
    }
    renderer.splash(x, y, 9, 2.6)
    renderer.drop(x, y, 3, 0.5)
    frogs.disturb(x, y, 170 * layout.unit, clock)
    koi.disturb(x, y, width * 0.2, 0.45)
  }
  // hovering a card nudges the water under it
  const onOver = (e: PointerEvent) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(CARD_SELECTOR)
    if (!card || card.contains(e.relatedTarget as Node | null)) return
    const box = host.getBoundingClientRect()
    const r = card.getBoundingClientRect()
    renderer.splash(r.left - box.left + r.width / 2, r.top - box.top + r.height / 2, Math.min(r.width, r.height) * 0.5, 0.5)
    touched()
  }
  const onVisibility = () => (document.hidden ? stop() : wake())
  const onLost = (e: Event) => {
    e.preventDefault()
    frozen = true
    stop()
  }

  let resizeTimer = 0
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      const w = Math.max(1, host.clientWidth)
      const h = Math.max(1, host.clientHeight)
      if (w === width && h === height) return
      width = w
      height = h
      shoreD = ''
      rebuildScene(shoreFrom(cardRects()).shelf)
      drawOnce()
    }, 150)
  })

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerdown', onDown)
  window.addEventListener('keydown', touched)
  content.addEventListener('pointerover', onOver)
  document.addEventListener('visibilitychange', onVisibility)
  reducedMotion.addEventListener('change', wake)
  canvas.addEventListener('webglcontextlost', onLost)
  ro.observe(host)

  renderer.setEnv(env)
  renderer.setTheme(initial.light)
  rebuildScene(shoreFrom(cardRects()).shelf)
  drawOnce()
  wake()

  return {
    setEnvironment(name) {
      if (name === envName && envT >= 1) return
      envFrom = env
      envName = name
      envT = reducedMotion.matches ? 1 : 0
      if (envT === 1) {
        env = ENVIRONMENTS[name]
        renderer.setEnv(env)
        renderer.rebakeBed()
      }
      touched()
      drawOnce()
    },
    setLight(light) {
      renderer.setTheme(light)
      drawOnce()
    },
    dispose() {
      disposed = true
      stop()
      clearTimeout(resizeTimer)
      ro.disconnect()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', touched)
      content.removeEventListener('pointerover', onOver)
      document.removeEventListener('visibilitychange', onVisibility)
      reducedMotion.removeEventListener('change', wake)
      canvas.removeEventListener('webglcontextlost', onLost)
      renderer.dispose()
      // hand the GPU memory back now rather than whenever the context is collected
      renderer.gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
