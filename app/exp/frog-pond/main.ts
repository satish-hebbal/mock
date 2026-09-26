import { buildLayout, type Layout } from './layout'
import { createSchool } from './koi'
import { createFrogs } from './frogs'
import { createFlies } from './flies'
import { createRenderer, type View } from './renderer'
import { createGovernor, startingTier, TIERS } from './quality'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { HomeOverlay } from './home-overlay'
import { ENV_NAMES, ENVIRONMENTS, mixEnv, type Env, type EnvName } from './environments'

const canvas = document.querySelector<HTMLCanvasElement>('#pond')!
const hud = document.querySelector<HTMLDivElement>('#hud')!
const hudStats = hud.querySelector<HTMLPreElement>('pre')!
const ui = document.querySelector<HTMLElement>('#ui')!
// the half layout's solid shore (see drawShore)
const shoreEl = document.querySelector<SVGSVGElement>('#shore')!
const shoreFill = shoreEl.querySelector<SVGPathElement>('.shore-fill')!
const shoreRims = [...shoreEl.querySelectorAll<SVGPathElement>('.rim-base, .rim, .rim-glint')]
const shoreGlint = shoreEl.querySelector<SVGLinearGradientElement>('#glint')!
let shoreD = ''
createRoot(ui).render(createElement(HomeOverlay))
const CARD_SELECTOR = '.tool-card'

const params = new URLSearchParams(location.search)
const SEED = Number(params.get('seed')) || 1 + Math.floor(Math.random() * 0x7ffffffd)
const derive = (k: number) => ((SEED * k) % 0x7fffffff) || 1

let width = window.innerWidth
let height = window.innerHeight
// theme: the app keeps it in localStorage as ms-theme and marks it with a .light class on <html>
const themeParam = params.get('theme')
let light = themeParam ? themeParam === 'light' : (() => {
  try {
    return localStorage.getItem('ms-theme') === 'light'
  } catch {
    return false
  }
})()
document.documentElement.classList.toggle('light', light)

type FrameMode = 'full' | 'half'
let frameMode: FrameMode = params.get('frame') === 'half' ? 'half' : 'full'
let shoreAmount = frameMode === 'half' ? 1 : 0
let layout: Layout = buildLayout(width, height, SEED)
// koi are given the visible pond's height, so they turn back at the shoreline like at a bank
const koi = createSchool(width, height, layout.unit)
let clock = 30 // start the noise clock mid-flow so the first frame isn't suspiciously calm
let frogs = createFrogs(layout, 3, 2, derive(48271), clock)
const flies = createFlies(12, derive(69621))

// weather: switching blends every light and colour setting over a couple of seconds
const ENV_BLEND = 2.5
const envParam = params.get('env')
let envName: EnvName = envParam && envParam in ENVIRONMENTS ? (envParam as EnvName) : 'overcast'
let envFrom: Env = ENVIRONMENTS[envName]
let env: Env = envFrom
let envT = 1
let rainCarry = 0

let koiOn = params.get('koi') !== '0'
let view: View = 'final'
let raf = 0
let lastDraw = 0
let lastInput = performance.now()
let awakeUntil = 0
let state: 'running' | 'idle' | 'frozen' | 'paused' | 'poster' = 'running'
let cpuMs = 0
let drawn = 0
let fps = 0
let fpsSince = performance.now()
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const forced = params.get('tier')
const start = forced === 'poster' ? 'poster' : forced !== null ? Number(forced) : startingTier()
const renderer = start === 'poster' ? null : createRenderer(canvas, koi.count, frogs.count)
if (!renderer) {
  // weak device, data saver, or no WebGL2: a still, painted background and nothing running
  document.body.dataset.poster = ''
  state = 'poster'
}

const governor = renderer
  ? createGovernor(renderer.gl, typeof start === 'number' ? start : 0, (tier) => {
      if (tier === 'frozen') {
        state = 'frozen' // the last frame stays on screen; nothing runs
        stop()
      } else {
        renderer.resize(layout, TIERS[tier])
        drawOnce()
      }
      showStats()
    })
  : null
if (renderer && governor && params.get('tier') !== null) governor.force(governor.tier)

const IDLE_AFTER = 20000
const IDLE_FPS = 12

function canRun(now: number) {
  if (!renderer || state === 'frozen' || state === 'poster' || document.hidden) return false
  return !reducedMotion.matches || now < awakeUntil
}

function frame(dt: number) {
  if (!renderer) return
  clock += dt
  if (envT < 1) {
    const before = envT
    envT = Math.min(1, envT + dt / ENV_BLEND)
    env = mixEnv(envFrom, ENVIRONMENTS[envName], envT * envT * (3 - 2 * envT))
    renderer.setEnv(env)
    // stone shadows are baked into the bed: repaint halfway through and at the end
    if ((before < 0.5 && envT >= 0.5) || envT === 1) renderer.rebakeBed()
  }
  if (koiOn) koi.update(dt, clock)
  frogs.update(dt, clock, renderer, env.croak)
  // the ripple sim is only stable for short steps (shorter the finer its texels), so split the frame
  const steps = Math.min(10, Math.max(1, Math.ceil(dt / renderer.maxStep() - 0.01)))
  // raindrops land all over the pond, a few hundred a second in a downpour on a big screen
  const rainPerStep = (env.rain * 2.2e-4 * width * height * dt) / steps
  for (let i = 1; i <= steps; i++) {
    rainCarry += rainPerStep
    for (; rainCarry >= 1; rainCarry--) renderer.drop(Math.random() * width, Math.random() * height, 2 * layout.unit, 0.15 + Math.random() * 0.3)
    if (koiOn) koi.emitRipples(clock - dt + (dt * i) / steps, i / steps, dt / steps, renderer)
    frogs.emitWake(i / steps, renderer)
    renderer.stepRipples(dt / steps)
  }
  if (koiOn) koi.writeVertices(renderer.fishVertices)
  const frogsLow = frogs.writeInstances(renderer.frogInstances)
  const flyData = flies.update(clock, width, height, layout.unit)
  // the cards cast shadows into the pond; six rect reads a frame, with nothing dirtying layout, is cheap
  const rects = ui.hidden ? [] : [...ui.querySelectorAll(CARD_SELECTOR)].map((c) => c.getBoundingClientRect())
  renderer.setCards(rects)
  // the half layout eases in and out, and follows the card row
  shoreAmount += ((frameMode === 'half' ? 1 : 0) - shoreAmount) * (1 - Math.exp(-dt * 5))
  if (Math.abs(shoreAmount - Math.round(shoreAmount)) < 0.002) shoreAmount = Math.round(shoreAmount)
  const sh = shoreFrom(rects)
  renderer.setShore(shoreAmount, sh.plateau, sh.shelf)
  drawShore(sh)
  if (frameMode === 'half' && Math.abs(sh.shelf - layout.waterBottom) > 24) rebuildScene(sh.shelf)
  governor?.begin()
  renderer.render({ time: clock, fish: koiOn ? koi.count : 0, frogs: frogs.count, frogsLow, flies: flyData, flyCount: flies.count, view })
  governor?.end()
}

function tick(now: number) {
  raf = requestAnimationFrame(tick)
  if (!canRun(now)) return stop()
  const idle = now - lastInput > IDLE_AFTER
  state = idle ? 'idle' : 'running'
  const target = idle ? Math.min(IDLE_FPS, TIERS[governor!.tier].fps) : TIERS[governor!.tier].fps
  const interval = now - lastDraw
  // the display refreshes at 60 to 144 Hz; only draw when a frame at our rate is due
  if (lastDraw && interval < 1000 / target - 3) return
  const t0 = performance.now()
  frame(lastDraw ? Math.min(interval / 1000, 0.1) : 1 / target)
  cpuMs = performance.now() - t0
  if (lastDraw && !idle) governor!.frame(interval, now)
  lastDraw = now
  drawn++
  if (now - fpsSince > 500) {
    fps = (drawn * 1000) / (now - fpsSince)
    drawn = 0
    fpsSince = now
    showStats()
  }
}

function stop() {
  cancelAnimationFrame(raf)
  raf = 0
  lastDraw = 0
  if (state === 'running' || state === 'idle') state = 'paused'
  showStats()
}

function wake() {
  if (!raf && canRun(performance.now())) {
    state = 'running'
    raf = requestAnimationFrame(tick)
  }
}

function drawOnce() {
  if (!raf && renderer && state !== 'poster') frame(0)
}

function touched() {
  lastInput = performance.now()
  awakeUntil = lastInput + 4000
  if (state === 'frozen') return
  wake()
}

function setEnvironment(name: EnvName) {
  if (name === envName && envT >= 1) return
  envFrom = env
  envName = name
  envT = reducedMotion.matches || !renderer ? 1 : 0
  if (envT === 1) {
    env = ENVIRONMENTS[name]
    renderer?.setEnv(env)
    renderer?.rebakeBed()
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-env]')) b.setAttribute('aria-pressed', String(b.dataset.env === name))
  touched()
  drawOnce()
  showStats()
}

// Full: the pond fills the page. Half: the pond is only the top of the page, ending in a shoreline
// just above the card row, and the page stays black below. The pond's contents (pads, frogs, koi)
// are rebuilt to live above the shoreline, so none of them swim off under the black.
function setFrame(next: FrameMode) {
  frameMode = next
  document.body.dataset.frame = next
  shoreEl.classList.toggle('on', next === 'half')
  const sh = shoreFrom(ui.hidden ? [] : [...ui.querySelectorAll(CARD_SELECTOR)].map((c) => c.getBoundingClientRect()))
  rebuildScene(next === 'half' ? sh.shelf : height)
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-frame]')) b.setAttribute('aria-pressed', String(b.dataset.frame === next))
  touched()
  drawOnce()
}

function setTheme(next: boolean) {
  light = next
  document.documentElement.classList.toggle('light', light)
  renderer?.setTheme(light)
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-theme]')) b.setAttribute('aria-pressed', String((b.dataset.theme === 'light') === light))
  touched()
  drawOnce()
}

// the half layout's black rises to a box around the card row and sits flat below it; with no cards
// on screen it falls back to a line a little over halfway down
function shoreFrom(rects: DOMRect[]) {
  const unit = layout.unit
  if (!rects.length) return { plateau: [width / 2, -1e4, 0, 0], shelf: height * 0.62 }
  const left = Math.min(...rects.map((r) => r.left)) - 18 * unit
  const right = Math.max(...rects.map((r) => r.right)) + 18 * unit
  const top = Math.min(...rects.map((r) => r.top)) - 18 * unit
  const bottom = Math.max(...rects.map((r) => r.bottom))
  return { plateau: [(left + right) / 2, (top + bottom) / 2, (right - left) / 2, (bottom - top) / 2], shelf: bottom } // the shelf is level with the bottom of the cards
}

// The half layout's shore: a solid shape in the page colour, drawn as an SVG over the canvas so its
// edge is crisp at any render scale. It rises from a flat shelf just below the cards to frame the card
// row, with rounded corners on top and small concave curves where it meets the shelf. A thin steel rim
// runs along the edge (the open top path), with a glint that follows the pointer.
function drawShore(sh: { plateau: number[]; shelf: number }) {
  const [cx, cy, hx, hy] = sh.plateau
  const u = layout.unit
  const n = (v: number) => Math.round(v * 10) / 10
  const S = n(sh.shelf)
  // the edge alone, left to right; the fill closes it round the bottom of the page
  let edge = `M0 ${S}H${width}`
  if (cy > -1000) {
    const L = n(cx - hx)
    const R = n(cx + hx)
    const T = n(cy - hy)
    const r = n(Math.max(0, Math.min(28 * u, hx, (S - T) / 2))) // the plateau's rounded top corners
    const f = n(Math.max(0, Math.min(16 * u, S - T - r))) // a tight curve into the shelf, about a card corner
    edge =
      `M0 ${S}H${n(L - f)}A${f} ${f} 0 0 0 ${L} ${n(S - f)}V${n(T + r)}A${r} ${r} 0 0 1 ${n(L + r)} ${T}` +
      `H${n(R - r)}A${r} ${r} 0 0 1 ${R} ${n(T + r)}V${n(S - f)}A${f} ${f} 0 0 0 ${n(R + f)} ${S}H${width}`
  }
  if (edge === shoreD) return
  shoreD = edge
  shoreFill.setAttribute('d', `${edge}V${height}H0Z`)
  for (const p of shoreRims) p.setAttribute('d', edge)
}

// the rim's glint slides along it under the pointer, like light catching polished steel
window.addEventListener('pointermove', (e) => {
  shoreGlint.setAttribute('x1', String(e.clientX - 220))
  shoreGlint.setAttribute('x2', String(e.clientX + 220))
})

// lay the pond out again for how far down it now reaches; the canvas keeps its size
function rebuildScene(waterBottom: number) {
  layout = buildLayout(width, height, SEED, Math.min(height, waterBottom))
  koi.resize(width, layout.waterBottom, layout.unit)
  frogs = createFrogs(layout, 3, 2, derive(48271), clock)
  if (renderer && governor) {
    renderer.resize(layout, TIERS[governor.tier])
    drawOnce()
  }
}

let resizeTimer = 0
function resize() {
  width = window.innerWidth
  height = window.innerHeight
  rebuildScene(frameMode === 'half' ? shoreFrom([...ui.querySelectorAll(CARD_SELECTOR)].map((c) => c.getBoundingClientRect())).shelf : height)
  if (renderer && governor) {
    renderer.resize(layout, TIERS[governor.tier])
    drawOnce()
  }
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(resize, 150)
})

// input: the pond sits behind the page, so listen on the window and skip anything over a card
let trail: [number, number] | null = null
window.addEventListener('pointermove', (e) => {
  touched()
  if (!renderer) return
  const x = e.clientX
  const y = e.clientY
  // the cursor trails a faint wake
  if (!trail || Math.hypot(x - trail[0], y - trail[1]) > 14 * layout.unit) {
    renderer.drop(x, y, 5 * layout.unit, 0.12)
    trail = [x, y]
  }
})
window.addEventListener('pointerdown', (e) => {
  touched()
  if (!renderer || e.button > 0 || (e.target as HTMLElement).closest(`${CARD_SELECTOR}, #hud`)) return
  const x = e.clientX
  const y = e.clientY
  const frog = frogs.hitTest(x, y)
  if (frog) return frogs.poke(frog, x, y, clock, renderer)
  const pad = layout.pads.find((p) => Math.hypot(p.x - x, p.y - y) < p.r)
  if (pad) {
    renderer.splash(pad.x, pad.y, pad.r, 0.8) // press the pad and it dips
    return
  }
  const fish = koiOn ? koi.hitTest(x, y) : null
  if (fish) {
    koi.scare(fish, x, y)
    renderer.splash(x, y, 7, 1.4)
    return
  }
  renderer.splash(x, y, 9, 2.6)
  renderer.drop(x, y, 3, 0.5)
  frogs.disturb(x, y, 170 * layout.unit, clock)
  if (koiOn) koi.disturb(x, y, width * 0.2, 0.45)
})
// hovering a card nudges the water under it (delegated, since React renders the cards)
ui.addEventListener('pointerover', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>(CARD_SELECTOR)
  if (!card || !renderer || card.contains(e.relatedTarget as Node | null)) return
  const r = card.getBoundingClientRect()
  renderer.splash(r.left + r.width / 2, r.top + r.height / 2, Math.min(r.width, r.height) * 0.5, 0.5)
  touched()
})
window.addEventListener('keydown', (e) => {
  touched()
  if (e.key === 'h' || e.key === 'H') hud.hidden = !hud.hidden
  const n = Number(e.key)
  if (n >= 1 && n <= ENV_NAMES.length) setEnvironment(ENV_NAMES[n - 1])
})
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : wake()))
reducedMotion.addEventListener('change', wake)
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault()
  state = 'frozen'
  stop()
})

// HUD
function showStats() {
  if (hud.hidden) return
  if (!renderer || !governor) {
    hudStats.textContent = `poster: device hint or ?tier=poster\nnothing is running`
    return
  }
  const tier = TIERS[governor.tier]
  const gpu = governor.gpuMs
  hudStats.textContent = [
    `${fps.toFixed(0).padStart(2)} fps   gpu ${gpu === null ? 'n/a' : gpu.toFixed(2) + ' ms'}   cpu ${cpuMs.toFixed(2)} ms`,
    `tier ${governor.tier} ${governor.auto ? 'auto' : 'manual'}   ${canvas.width}x${canvas.height} (${tier.scale}x, ${tier.fps} fps cap)`,
    `${state}${state === 'idle' ? ` (${IDLE_FPS} fps)` : ''}   ${envName}   seed ${SEED}`,
  ].join('\n')
}
hud.addEventListener('click', (e) => {
  const themeButton = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-theme]')
  if (themeButton) return setTheme(themeButton.dataset.theme === 'light')
  const framing = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-frame]')
  if (framing) return setFrame(framing.dataset.frame as FrameMode)
  const weather = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-env]')
  if (weather) return setEnvironment(weather.dataset.env as EnvName)
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]')
  if (!button || !governor) return
  const act = button.dataset.act
  if (act === 'down') governor.force(governor.tier + 1)
  else if (act === 'up') governor.force(governor.tier - 1)
  else if (act === 'auto') governor.force(null)
  else if (act === 'koi') {
    koiOn = !koiOn
    button.setAttribute('aria-pressed', String(koiOn))
  } else if (act === 'ui') {
    ui.hidden = !ui.hidden
    button.setAttribute('aria-pressed', String(!ui.hidden))
    renderer?.setFocus(!ui.hidden)
  } else if (act === 'view') {
    const views: View[] = ['final', 'caustics', 'ripples', 'bed', 'shadow']
    view = views[(views.indexOf(view) + 1) % views.length]
    button.textContent = `view: ${view}`
  }
  if (state === 'frozen' && act !== 'koi' && act !== 'ui' && act !== 'view') state = 'running'
  drawOnce()
  wake()
  showStats()
})
hud.querySelector('[data-act="koi"]')!.setAttribute('aria-pressed', String(koiOn))
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-env]')) b.setAttribute('aria-pressed', String(b.dataset.env === envName))
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-frame]')) b.setAttribute('aria-pressed', String(b.dataset.frame === frameMode))
shoreEl.classList.toggle('on', frameMode === 'half')
document.body.dataset.frame = frameMode
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-theme]')) b.setAttribute('aria-pressed', String((b.dataset.theme === 'light') === light))

// ?debug exposes the frogs, so a test can click on one
if (params.has('debug')) Object.assign(window, {
    pond: {
      frogs: () => frogs.inspect(),
      // the same splash a frog makes hitting the water
      splash: (x: number, y: number) => renderer && frogs.splashAt(x, y, frogs.length, clock, renderer),
    },
  })

if (renderer && governor) {
  renderer.setEnv(env)
  renderer.setTheme(light)
  renderer.resize(layout, TIERS[governor.tier])
  drawOnce()
  wake()
}
showStats()
