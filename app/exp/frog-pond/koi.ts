// The koi school, copied from the koi pond experiment, sized in pond units instead of screen width
// so the fish stay small on a full screen background. Simulated on the CPU. Each fish steers its head around the pond; the body is not
// simulated at all, it just follows the path the head has already swum (follow the leader), with a
// travelling sine wave added on top for the swimming motion. That trail is what makes turns look
// like a real fish bending through water instead of a rigid sprite rotating.

type Water = {
  drop(x: number, y: number, r: number, amount: number): void
  splash(x: number, y: number, r: number, amount: number): void
  push(x: number, y: number, r: number, amount: number): void
  pushRoom(): number
}

const TAU = Math.PI * 2

// ribbon layout, shared with the fish shaders
export const ROWS = 64
export const COLS = 9
export const FLOATS_PER_VERTEX = 12
export const INDICES_PER_FISH = (ROWS - 1) * (COLS - 1) * 6
const U_MIN = -0.03 // a sliver in front of the snout, so the lips anti-alias
const U_MAX = 1.52 // past the tail root (u = 1) to the tip of the tail fin
const HALF_WIDTH = 0.42 // wide enough for the pectoral fins
const SPINE = 22
const TRAIL = 160

const rowU = (i: number) => U_MIN + ((U_MAX - U_MIN) * i) / (ROWS - 1)
const rowAt = (u: number) => Math.round(((u - U_MIN) / (U_MAX - U_MIN)) * (ROWS - 1))
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

// kind: 0 orange, 1 gold with black spots, 2 red and white, 3 pale calico
// size is the body length in px at unit 1
const START = [
  { kind: 0, x: 0.2, y: 0.3, heading: 0.35, size: 104, lift: 1, seed: 0.13 },
  { kind: 1, x: 0.8, y: 0.25, heading: 2.7, size: 96, lift: 1.1, seed: 0.91 },
  { kind: 3, x: 0.7, y: 0.8, heading: -0.9, size: 88, lift: 1.05, seed: 0.72 },
]

type Fish = {
  kind: number
  seed: number
  size: number // body length in px at unit 1
  length: number // body length in px
  lift: number // how high above the bed; drives shadow offset and draw order
  x: number
  y: number
  heading: number
  turn: number
  speed: number
  cruise: number
  goalX: number
  goalY: number
  goalUntil: number
  fear: number
  fleeAngle: number
  beat: number // tail beat phase
  flicked: boolean
  flickSide: number
  finPhase: number
  fold: number
  swim: number // body wave amplitude
  prevHeadX: number
  prevHeadY: number
  trail: Float32Array // recent head positions, newest first
  trailCount: number
  spine: Float32Array
  rows: Float32Array // x, y, tangent x, tangent y for each ribbon row
}

export type School = ReturnType<typeof createSchool>

export function createSchool(width: number, height: number, unit: number) {
  let W = width
  let H = height
  const pendingSplashes: [number, number, number, number][] = []

  const fish: Fish[] = START.map((s) => {
    const length = s.size * unit
    const f: Fish = {
      kind: s.kind,
      seed: s.seed,
      size: s.size,
      length,
      lift: s.lift,
      x: s.x * W,
      y: s.y * H,
      heading: s.heading,
      turn: 0,
      speed: 0,
      cruise: length * (0.2 + 0.1 * s.seed),
      goalX: s.x * W,
      goalY: s.y * H,
      goalUntil: 0,
      fear: 0,
      fleeAngle: 0,
      beat: s.seed * TAU,
      flicked: false,
      flickSide: 1,
      finPhase: s.seed * 20,
      fold: 0,
      swim: 0.4,
      prevHeadX: s.x * W,
      prevHeadY: s.y * H,
      trail: new Float32Array(TRAIL * 2),
      trailCount: TRAIL,
      spine: new Float32Array(SPINE * 2),
      rows: new Float32Array(ROWS * 4),
    }
    f.speed = f.cruise
    // pretend it has been swimming straight so the body starts out laid along its heading
    for (let i = 0; i < TRAIL; i++) {
      f.trail[i * 2] = f.x - Math.cos(f.heading) * length * 0.02 * i
      f.trail[i * 2 + 1] = f.y - Math.sin(f.heading) * length * 0.02 * i
    }
    layoutSpine(f)
    layoutRows(f)
    return f
  })
  // draw low fish first so higher ones pass over them
  const drawOrder = [...fish].sort((a, b) => a.lift - b.lift)

  // walk back along the trail placing spine joints at equal arc length
  function layoutSpine(f: Fish) {
    const { spine, trail } = f
    const seg = (U_MAX * f.length) / (SPINE - 1)
    spine[0] = f.x
    spine[1] = f.y
    let px = f.x
    let py = f.y
    let need = seg
    let j = 1
    for (let i = 0; j < SPINE && i < f.trailCount; ) {
      const d = Math.hypot(trail[i * 2] - px, trail[i * 2 + 1] - py)
      if (d >= need) {
        px += ((trail[i * 2] - px) * need) / d
        py += ((trail[i * 2 + 1] - py) * need) / d
        spine[j * 2] = px
        spine[j * 2 + 1] = py
        j++
        need = seg
      } else {
        need -= d
        px = trail[i * 2]
        py = trail[i * 2 + 1]
        i++
      }
    }
    // ran out of trail: carry on straight
    let dx = j >= 2 ? spine[(j - 1) * 2] - spine[(j - 2) * 2] : -Math.cos(f.heading)
    let dy = j >= 2 ? spine[(j - 1) * 2 + 1] - spine[(j - 2) * 2 + 1] : -Math.sin(f.heading)
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    for (; j < SPINE; j++) {
      spine[j * 2] = spine[(j - 1) * 2] + dx * seg
      spine[j * 2 + 1] = spine[(j - 1) * 2 + 1] + dy * seg
    }
  }

  // sample the spine at each ribbon row and add the swimming wave, which grows toward the tail
  function layoutRows(f: Fish) {
    const { spine, rows, length: L } = f
    const hx = Math.cos(f.heading)
    const hy = Math.sin(f.heading)
    for (let i = 0; i < ROWS; i++) {
      const u = rowU(i)
      let x: number, y: number, tx: number, ty: number
      if (u <= 0) {
        x = f.x - hx * u * L
        y = f.y - hy * u * L
        tx = hx
        ty = hy
      } else {
        const k = (SPINE - 1) * Math.min(u / U_MAX, 1)
        const a = Math.min(Math.floor(k), SPINE - 2)
        const t = k - a
        x = spine[a * 2] + (spine[(a + 1) * 2] - spine[a * 2]) * t
        y = spine[a * 2 + 1] + (spine[(a + 1) * 2 + 1] - spine[a * 2 + 1]) * t
        tx = spine[a * 2] - spine[(a + 1) * 2]
        ty = spine[a * 2 + 1] - spine[(a + 1) * 2 + 1]
        const n = Math.hypot(tx, ty) || 1
        tx /= n
        ty /= n
      }
      const wave = L * (0.008 + 0.07 * Math.pow(smooth(0.15, U_MAX, u), 1.5)) * f.swim * Math.sin(f.beat - 5.2 * u)
      rows[i * 4] = x - ty * wave
      rows[i * 4 + 1] = y + tx * wave
    }
    // tangents from the bent rows, pointing toward the head
    for (let i = 0; i < ROWS; i++) {
      const a = Math.max(i - 1, 0)
      const b = Math.min(i + 1, ROWS - 1)
      const dx = rows[a * 4] - rows[b * 4]
      const dy = rows[a * 4 + 1] - rows[b * 4 + 1]
      const n = Math.hypot(dx, dy) || 1
      rows[i * 4 + 2] = dx / n
      rows[i * 4 + 3] = dy / n
    }
  }

  // pick somewhere open to swim to: far from the others and their goals, not too far to travel
  function pickGoal(f: Fish, now: number) {
    let best = -Infinity
    for (let n = 0; n < 6; n++) {
      const gx = W * (0.12 + 0.76 * Math.random())
      const gy = H * (0.12 + 0.76 * Math.random())
      const travel = Math.hypot(gx - f.x, gy - f.y)
      if (travel < f.length * 1.2) continue
      let room = Infinity
      for (const o of fish) {
        if (o === f) continue
        room = Math.min(room, Math.hypot(gx - o.x, gy - o.y), Math.hypot(gx - o.goalX, gy - o.goalY))
      }
      const score = Math.min(room, f.length * 2.5) - 0.15 * travel
      if (score > best) {
        best = score
        f.goalX = gx
        f.goalY = gy
      }
    }
    f.goalUntil = now + 8 + 10 * Math.random()
  }

  function frighten(f: Fish, x: number, y: number, amount: number) {
    const mid = rowAt(0.45) * 4
    let dx = f.rows[mid] - x
    let dy = f.rows[mid + 1] - y
    if (Math.hypot(dx, dy) < 4) {
      // tapped dead centre: bolt to either side
      const side = Math.random() < 0.5 ? 1 : -1
      dx = -Math.sin(f.heading) * side
      dy = Math.cos(f.heading) * side
    }
    f.fleeAngle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.8
    f.fear = Math.max(f.fear, amount)
  }

  function disturb(x: number, y: number, radius: number, amount: number, except?: Fish) {
    for (const f of fish) {
      if (f === except) continue
      const d = Math.hypot(f.x - x, f.y - y)
      if (d < radius) frighten(f, x, y, amount * (1 - d / radius))
    }
  }

  function update(dt: number, now: number) {
    for (const f of fish) {
      const L = f.length
      const headRow = rowAt(0.12) * 4
      f.prevHeadX = f.rows[headRow]
      f.prevHeadY = f.rows[headRow + 1]
      if (now > f.goalUntil || Math.hypot(f.goalX - f.x, f.goalY - f.y) < L * 0.8) pickGoal(f, now)

      const hx = Math.cos(f.heading)
      const hy = Math.sin(f.heading)
      const toGoal = Math.hypot(f.goalX - f.x, f.goalY - f.y) || 1
      const gx = (f.goalX - f.x) / toGoal
      const gy = (f.goalY - f.y) / toGoal
      // meander: slowly rotate the goal direction back and forth
      const wobble = 0.18 * Math.sin(now * 0.4 + f.seed * 17) + 0.05 * Math.sin(now * 1.1 + f.seed * 5)
      let wx = gx - gy * wobble
      let wy = gy + gx * wobble

      // look ahead and steer away from the banks
      const ax = f.x + hx * L * 0.8
      const ay = f.y + hy * L * 0.8
      const m = -0.15 * L
      const past = (v: number) => Math.max(v, 0) / L
      const bx = past(m - ax) - past(ax - (W - m))
      const by = past(m - ay) - past(ay - (H - m))
      wx += bx * (4 + 8 * Math.abs(bx))
      wy += by * (4 + 8 * Math.abs(by))

      // keep clear of the other bodies: probe the head, the middle and a point ahead
      let crowd = 0
      for (const o of fish) {
        if (o === f) continue
        const range = (L + o.length) * 0.55
        for (const along of [0, 0.6, 1.3]) {
          const px = f.x + hx * L * along
          const py = f.y + hy * L * along
          let best = Infinity
          let rx = 0
          let ry = 0
          for (let r = rowAt(0); r < rowAt(1.1); r += 3) {
            const a = r * 4
            const b = Math.min(r + 3, ROWS - 1) * 4
            const sx = o.rows[b] - o.rows[a]
            const sy = o.rows[b + 1] - o.rows[a + 1]
            const t = clamp(((px - o.rows[a]) * sx + (py - o.rows[a + 1]) * sy) / (sx * sx + sy * sy || 1), 0, 1)
            const dx = px - (o.rows[a] + sx * t)
            const dy = py - (o.rows[a + 1] + sy * t)
            const d = Math.hypot(dx, dy)
            if (d < best) {
              best = d
              rx = dx
              ry = dy
            }
          }
          if (best >= range) continue
          const push = 1 - best / range
          if (best < 1) {
            rx = -hy
            ry = hx
            best = 1
          }
          wx += (rx / best) * push * push * 9
          wy += (ry / best) * push * push * 9
          crowd = Math.max(crowd, push * (along > 1 ? 0.6 : 1))
        }
      }
      if (crowd > 0.6) f.goalUntil = Math.min(f.goalUntil, now + 1.2)
      if (f.fear > 0.02) {
        wx += Math.cos(f.fleeAngle) * f.fear * 6
        wy += Math.sin(f.fleeAngle) * f.fear * 6
      }

      // turn toward the wanted direction; a fish can't pivot faster than its speed allows
      const off = wrap(Math.atan2(wy, wx) - f.heading)
      const maxTurn = Math.min(0.6 + 2.4 * crowd + 8 * f.fear, 6, 0.3 + f.speed / (0.5 * L))
      const eager = 1.2 + 2 * crowd + 8 * f.fear
      const wantTurn = clamp(off * eager, -maxTurn, maxTurn)
      f.turn += (wantTurn - f.turn) * (1 - Math.exp(-dt * eager * 4.5))
      f.heading = wrap(f.heading + f.turn * dt)

      // cruise with a slow surge, ease off in tight turns or crowds, sprint when scared
      const surge = 0.7 + 0.45 * (0.5 + 0.5 * Math.sin(now * 0.37 + f.seed * 23))
      const target = f.cruise * surge * (1 - 0.35 * Math.min(Math.abs(off), 1)) * (1 - 0.4 * crowd) + f.fear * L * 3.4
      f.speed += (target - f.speed) * (1 - Math.exp(-dt * (f.fear > 0.15 ? 7 : 1.1)))
      f.x += Math.cos(f.heading) * f.speed * dt
      f.y += Math.sin(f.heading) * f.speed * dt
      f.fear *= Math.exp(-1.5 * dt)

      // faster swimming means faster tail beats; each half beat is a flick that drops a ripple
      const rel = f.speed / L
      const lastBeat = f.beat
      f.beat += dt * TAU * (0.7 + 2.2 * rel)
      if (Math.floor(f.beat / Math.PI) !== Math.floor(lastBeat / Math.PI)) f.flicked = true
      f.finPhase += dt * TAU * (0.8 + 0.4 * f.seed)
      f.fold += (Number(f.fear > 0.25) - f.fold) * (1 - Math.exp(-6 * dt))
      f.swim = 0.3 + 0.7 * clamp(rel / 1.2, 0, 1)

      const t = f.trail
      if (Math.hypot(f.x - t[0], f.y - t[1]) >= f.length * 0.02) {
        t.copyWithin(2, 0, t.length - 2)
        t[0] = f.x
        t[1] = f.y
        f.trailCount = Math.min(f.trailCount + 1, TRAIL)
      }
      layoutSpine(f)
      layoutRows(f)
    }
  }

  // pack every ribbon vertex: pos, (u, s), tangent, (kind + seed, length, beat, lift), (fold, finPhase)
  function writeVertices(out: Float32Array) {
    let o = 0
    for (const f of drawOrder) {
      const { rows, length: L } = f
      for (let i = 0; i < ROWS; i++) {
        const u = rowU(i)
        const x = rows[i * 4]
        const y = rows[i * 4 + 1]
        const tx = rows[i * 4 + 2]
        const ty = rows[i * 4 + 3]
        for (let j = 0; j < COLS; j++) {
          const s = -HALF_WIDTH + (2 * HALF_WIDTH * j) / (COLS - 1)
          out[o++] = x - ty * s * L
          out[o++] = y + tx * s * L
          out[o++] = u
          out[o++] = s
          out[o++] = tx
          out[o++] = ty
          out[o++] = f.kind + f.seed
          out[o++] = L
          out[o++] = f.beat
          out[o++] = f.lift
          out[o++] = f.fold
          out[o++] = f.finPhase
        }
      }
    }
  }

  // the fish disturb the water: a push-pull wake at the head, a drop at each tail flick,
  // and little paddling ripples from the pectorals while hovering
  function emitRipples(now: number, frac: number, dt: number, water: Water) {
    const paddle = 180 * dt
    fish.forEach((f, n) => {
      const { rows, length: L } = f
      const rel = f.speed / L
      const head = rowAt(0.12) * 4
      // interpolate the head within this frame so fast fish leave a smooth wake, not dots
      const hx = f.prevHeadX + (rows[head] - f.prevHeadX) * frac
      const hy = f.prevHeadY + (rows[head + 1] - f.prevHeadY) * frac
      const tx = rows[head + 2]
      const ty = rows[head + 3]
      const force = 2800 * Math.tanh(f.speed / 380)
      if (force > 20 && water.pushRoom() >= 2) {
        water.push(hx + tx * L * 0.08, hy + ty * L * 0.08, L * 0.11, force)
        water.push(hx - tx * L * 0.12, hy - ty * L * 0.12, L * 0.11, -force)
      }
      if (f.flicked) {
        f.flicked = false
        f.flickSide = -f.flickSide
        const tail = rowAt(1.3) * 4
        const side = f.flickSide * L * 0.05
        water.drop(rows[tail] - rows[tail + 3] * side, rows[tail + 1] + rows[tail + 2] * side, 3.2, 0.06 + 0.24 * clamp(rel / 2, 0, 1))
      }
      const hover = 1 - clamp(rel / 0.5, 0, 1)
      if (hover > 0.05) {
        const fin = rowAt(0.26) * 4
        const amount = 0.05 * Math.sin(now * TAU * 14 + n * 1.7) * hover * (1 - f.fold) * paddle
        for (const side of [1, -1]) {
          const ox = -rows[fin + 3] * side * 0.09 * L
          const oy = rows[fin + 2] * side * 0.09 * L
          water.drop(rows[fin] + ox, rows[fin + 1] + oy, 3, amount)
        }
      }
    })
    for (const s of pendingSplashes) water.splash(...s)
    pendingSplashes.length = 0
  }

  // which fish, if any, is under this point (topmost first)
  function hitTest(x: number, y: number): Fish | null {
    for (let k = drawOrder.length - 1; k >= 0; k--) {
      const f = drawOrder[k]
      const { rows, length: L } = f
      for (let i = 0; i < ROWS - 1; i++) {
        const u = rowU(i)
        if (u < 0) continue
        const reach = (u <= 1 ? halfWidth(u) * L : 0.12 * L) + 10
        const ax = rows[i * 4]
        const ay = rows[i * 4 + 1]
        const sx = rows[(i + 1) * 4] - ax
        const sy = rows[(i + 1) * 4 + 1] - ay
        const t = clamp(((x - ax) * sx + (y - ay) * sy) / (sx * sx + sy * sy || 1), 0, 1)
        if (Math.hypot(x - (ax + sx * t), y - (ay + sy * t)) < reach) return f
      }
    }
    return null
  }

  function scare(f: Fish, x: number, y: number) {
    const fresh = f.fear < 0.5
    frighten(f, x, y, 1)
    if (!fresh) return
    f.speed = Math.max(f.speed, f.length * 1.2)
    const tail = rowAt(1.3) * 4
    if (pendingSplashes.length < 6) pendingSplashes.push([f.rows[tail], f.rows[tail + 1], 7, 1.6])
    disturb(x, y, f.length * 1.8, 0.6, f) // panic spreads to the neighbours
  }

  function resize(width: number, height: number, unit: number) {
    const sx = width / (W || width)
    const sy = height / (H || height)
    W = width
    H = height
    for (const f of fish) {
      f.x *= sx
      f.y *= sy
      f.goalX *= sx
      f.goalY *= sy
      for (let i = 0; i < SPINE; i++) {
        f.spine[i * 2] *= sx
        f.spine[i * 2 + 1] *= sy
      }
      for (let i = 0; i < TRAIL; i++) {
        f.trail[i * 2] *= sx
        f.trail[i * 2 + 1] *= sy
      }
      const k = (f.size * unit) / f.length
      f.length *= k
      f.cruise *= k
      f.speed *= k
      layoutRows(f)
    }
  }

  return { count: fish.length, update, writeVertices, emitRipples, hitTest, scare, disturb, resize }
}

// same profile as bodyHW() in the shaders
function halfWidth(u: number) {
  if (u < 0) return 0
  const nose = Math.sqrt(Math.max(0, 1 - (Math.max(0.3 - u, 0) / 0.3) ** 2))
  return (0.05 + 0.085 * (1 - clamp((u - 0.3) / 0.7, 0, 1) ** 1.4)) * nose
}
