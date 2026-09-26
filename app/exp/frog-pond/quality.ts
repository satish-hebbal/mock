// Keeps the pond cheap. It picks a starting tier from what the device says about itself, then watches
// real cost and steps down when frames get expensive. GPU time comes from a timer query where the
// browser offers one (Chrome and Edge on desktop); elsewhere it falls back to counting late frames.

export type Tier = { scale: number; fps: number; grid: number; sim: number }

// scale: canvas px per CSS px. grid: caustic mesh spacing in CSS px. sim: CSS px per ripple texel;
// finer texels give crisp rings but need more, shorter steps, so the top tiers pay for them.
export const TIERS: Tier[] = [
  { scale: 1, fps: 60, grid: 6, sim: 2 }, // the caustic texture is half res at most, so a finer grid only adds specks
  { scale: 0.85, fps: 30, grid: 6, sim: 2 },
  { scale: 0.7, fps: 30, grid: 6, sim: 3 },
  { scale: 0.55, fps: 30, grid: 8, sim: 4 },
  { scale: 0.45, fps: 24, grid: 8, sim: 4 },
  { scale: 0.35, fps: 20, grid: 10, sim: 4 },
]

const GPU_DOWN_MS = 7 // above this for a whole window, step down
const GPU_UP_MS = 2.5 // below this for long enough, allowed to step back up
const WINDOW_MS = 2000

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

export function startingTier(): number | 'poster' {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  if (nav.connection?.saveData) return 'poster'
  const cores = nav.hardwareConcurrency ?? 8
  const memory = nav.deviceMemory ?? 8
  if (cores <= 2 || memory <= 2) return 'poster'
  return 0 // everyone starts at full quality; the governor steps down only if frames get expensive
}

export function createGovernor(gl: WebGL2RenderingContext, initial: number, onChange: (tier: number | 'frozen') => void) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null
  const pending: WebGLQuery[] = []
  let active: WebGLQuery | null = null
  let tier = initial
  let locked = false // after stepping down once, never climb back: no see-sawing
  let auto = true
  let samples: number[] = []
  let late = 0
  let frames = 0
  let windowStart = performance.now()
  let tierSince = performance.now()
  let lastGpu = 0

  function begin() {
    if (!ext || active) return
    active = gl.createQuery()
    if (active) gl.beginQuery(ext.TIME_ELAPSED_EXT, active)
  }

  function end() {
    if (!ext || !active) return
    gl.endQuery(ext.TIME_ELAPSED_EXT)
    pending.push(active)
    active = null
  }

  function poll() {
    if (!ext) return
    while (pending.length) {
      const q = pending[0]
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT)
      if (!disjoint) {
        lastGpu = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6
        samples.push(lastGpu)
      }
      gl.deleteQuery(q)
      pending.shift()
    }
  }

  function step(to: number | 'frozen') {
    if (to !== 'frozen') tier = to
    tierSince = performance.now()
    samples = []
    onChange(to)
  }

  // call once per drawn frame with the gap since the previous drawn frame
  function frame(interval: number, now: number) {
    poll()
    frames++
    if (interval > (1000 / TIERS[tier].fps) * 1.6) late++
    if (now - windowStart < WINDOW_MS) return
    const lateRatio = late / Math.max(frames, 1)
    frames = late = 0
    windowStart = now
    if (!auto) return
    const median = samples.length >= 10 ? [...samples].sort((a, b) => a - b)[samples.length >> 1] : null
    samples = []
    const tooSlow = median !== null ? median > GPU_DOWN_MS : lateRatio > 0.25
    if (tooSlow) {
      locked = true
      if (tier < TIERS.length - 1) step(tier + 1)
      else step('frozen')
    } else if (!locked && median !== null && median < GPU_UP_MS && tier > 0 && now - tierSince > 6000) {
      step(tier - 1)
    }
  }

  return {
    begin,
    end,
    frame,
    get tier() {
      return tier
    },
    get gpuMs() {
      return ext ? lastGpu : null
    },
    get auto() {
      return auto
    },
    // manual override from the HUD; null hands control back
    force(to: number | null) {
      auto = to === null
      if (to !== null) step(Math.min(TIERS.length - 1, Math.max(0, to)))
    },
  }
}
