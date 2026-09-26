import { createSchool } from './koi'
import { createRenderer, type Renderer, type View } from './renderer'

const frame = document.querySelector<HTMLDivElement>('#pond')!
const canvas = frame.querySelector('canvas')!
const views = document.querySelector<HTMLDivElement>('#views')!
const status = document.querySelector<HTMLParagraphElement>('#status')!

let width = frame.clientWidth
let height = frame.clientHeight
const school = createSchool(width, height)
let water: Renderer | null = createRenderer(canvas, school.count)
if (!water) {
  frame.dataset.fallback = ''
  status.textContent = 'This browser has no WebGL2 with float render targets, so the pond cannot run.'
}

let view: View = 'final'
const maxDpr = () => Math.min(window.devicePixelRatio || 1, 2)
let raf = 0
let last = 0
let clock = 40 // start the noise clock mid-flow so the first frame isn't suspiciously calm
let visible = false
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let awakeUntil = 0 // with reduced motion, only animate for a moment after each touch

const running = () => water !== null && visible && !document.hidden && (!reducedMotion.matches || performance.now() < awakeUntil)

function tick(now: number) {
  raf = 0
  if (!water || !running()) {
    last = 0
    return
  }
  const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60
  last = now
  clock += dt
  school.update(dt, clock)
  // the wave equation is only stable for small steps, so split the frame into substeps of <= 1/300 s
  const steps = Math.min(12, Math.max(1, Math.ceil(dt * 300 - 0.01)))
  for (let i = 1; i <= steps; i++) {
    school.emitRipples(clock - dt + (dt * i) / steps, i / steps, dt / steps, water)
    water.stepRipples(dt / steps)
  }
  school.writeVertices(water.fishVertices)
  water.render(clock, view)
  raf = requestAnimationFrame(tick)
}

function wake() {
  if (!raf && running()) raf = requestAnimationFrame(tick)
}

function resize() {
  width = frame.clientWidth
  height = frame.clientHeight
  if (!water || !width || !height) return
  school.resize(width, height)
  water.resize(width, height, maxDpr())
  if (!raf) {
    school.writeVertices(water.fishVertices)
    water.render(clock, view)
  }
}

function toPond(e: PointerEvent): [number, number] {
  const r = canvas.getBoundingClientRect()
  return [((e.clientX - r.left) / r.width) * width, ((e.clientY - r.top) / r.height) * height]
}

let dragFrom: [number, number] | null = null

canvas.addEventListener('pointerdown', (e) => {
  if (!water || e.button > 0) return
  const [x, y] = toPond(e)
  const fish = school.hitTest(x, y)
  if (fish) {
    school.scare(fish, x, y)
    water.splash(x, y, 7, 1.4)
  } else {
    water.splash(x, y, 9, 2.6)
    water.drop(x, y, 3, 0.5)
    school.disturb(x, y, width * 0.3, 0.45)
  }
  dragFrom = [x, y]
  awakeUntil = performance.now() + 4000
  wake()
})
// dragging a finger through the water leaves a trail of ripples
window.addEventListener('pointermove', (e) => {
  if (!water || !dragFrom) return
  const [x, y] = toPond(e)
  if (Math.hypot(x - dragFrom[0], y - dragFrom[1]) < 8) return
  water.splash(x, y, 6, 0.9)
  school.disturb(x, y, width * 0.2, 0.3)
  dragFrom = [x, y]
  awakeUntil = performance.now() + 4000
  wake()
})
const endDrag = () => (dragFrom = null)
window.addEventListener('pointerup', endDrag)
window.addEventListener('pointercancel', endDrag)

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault()
  cancelAnimationFrame(raf)
  raf = 0
  water = null
})
canvas.addEventListener('webglcontextrestored', () => {
  water = createRenderer(canvas, school.count)
  resize()
  wake()
})

new ResizeObserver(resize).observe(frame)
new IntersectionObserver(
  ([entry]) => {
    visible = entry.isIntersecting
    wake()
  },
  { rootMargin: '200px' },
).observe(frame)
document.addEventListener('visibilitychange', wake)
reducedMotion.addEventListener('change', wake)

views.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-view]')
  if (!button) return
  view = button.dataset.view as View
  for (const b of views.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button))
  frame.dataset.view = view
  if (!raf && water) water.render(clock, view)
})

resize()
