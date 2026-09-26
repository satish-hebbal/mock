// Frogs, sitting, leaping and swimming. A sitting frog blinks, croaks (the throat sac puffs and sends
// rings across the water), hops to another pad now and then, or dives in. A swimmer does the frog
// kick: legs snap back and push it forward, it glides, then draws its knees up wide for the next
// stroke, leaving a V shaped wake like the koi. After a while in the water it climbs out onto a free
// pad. Poke a sitting frog and it leaps into the water with a proper splash, then dives under and
// swims off along the bottom before surfacing; poke a swimmer and it dives the same way. Splash near
// a sitting frog and it may well plop in too, like the real thing.

import { FOCUS, type Layout, type Pad } from './layout'
import { FROG_KINDS } from './frog-shader'

export type Water = {
  drop(x: number, y: number, r: number, amount: number): void
  splash(x: number, y: number, r: number, amount: number): void
  push(x: number, y: number, r: number, amount: number): void
  pushRoom(): number
  spray(x: number, y: number, size: number): void // the white crown and droplets of a splash
}

export const FLOATS_PER_FROG = 16

type Leap = { fromX: number; fromY: number; fromPad: number; toX: number; toY: number; toPad: number; t: number; dur: number; height: number }
type Aim = { pad: number; x: number; y: number; dur: number; height: number }

type Frog = {
  mode: 'sit' | 'leap' | 'swim'
  pad: number // -1 in the water
  x: number
  y: number
  heading: number
  wantHeading: number
  length: number
  seed: number
  kind: number
  blink: number
  blinkAt: number
  puff: number
  croakAt: number
  croakT: number
  stretch: number
  hop: number
  wet: number
  leap: Leap | null
  aim: Aim | null
  aimAt: number
  nextMove: number
  nextShuffle: number
  fleeX: number
  fleeY: number
  // swimming
  speed: number
  stroke: number // 0..1 through a kick, < 0 while resting
  restUntil: number
  goalX: number
  goalY: number
  goalUntil: number
  climbAt: number
  fear: number
  fleeAngle: number
  rippleAt: number
  // diving under: 0 at the surface .. 1 down by the bed
  depth: number
  depthTarget: number
  deepUntil: number
  startled: boolean // leapt in because it was frightened, so it dives as soon as it lands
  headX: number // where the head was at the start of the frame, to spread the wake across substeps
  headY: number
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

// start: the pond clock right now; every timer below is scheduled from it
export function createFrogs(layout: Layout, sitting: number, swimming: number, seed: number, start: number) {
  let s = seed
  const rand = () => (s = (s * 16807) % 0x7fffffff) / 0x7fffffff
  const { pads, unit, width: W, waterBottom: H } = layout
  const baseLength = 74 * unit
  const occupied = new Set<number>()
  const inFocus = (x: number, y: number) => Math.hypot((x / W - FOCUS.x) / FOCUS.rx, (y / H - FOCUS.y) / FOCUS.ry) < 1

  // where a frog sits on a pad: slightly behind centre, so its body is on the leaf
  const seat = (pad: Pad, heading: number, length: number) => ({ x: pad.x - Math.cos(heading) * length * 0.1, y: pad.y - Math.sin(heading) * length * 0.1 })
  const roomy = (i: number) => pads[i].r >= baseLength * 0.55
  const openWater = (x: number, y: number, clearance: number) =>
    x > W * 0.04 && x < W * 0.96 && y > H * 0.04 && y < H * 0.96 && pads.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + clearance)

  // every colour shows up once before any repeats
  const kinds = Array.from({ length: FROG_KINDS }, (_, i) => i).sort(() => rand() - 0.5)

  function make(mode: 'sit' | 'swim', x: number, y: number, pad: number, heading: number): Frog {
    const f: Frog = {
      mode,
      pad,
      x,
      y,
      heading,
      wantHeading: heading,
      length: baseLength * (0.88 + 0.24 * rand()),
      seed: rand(),
      kind: kinds[frogs.length % kinds.length],
      blink: 0,
      blinkAt: start + 1 + rand() * 4,
      puff: 0,
      croakAt: start + 3 + rand() * 14,
      croakT: -1,
      stretch: mode === 'swim' ? 0.35 : 0,
      hop: 0,
      wet: mode === 'swim' ? 1 : 0,
      leap: null,
      aim: null,
      aimAt: 0,
      nextMove: start + 8 + rand() * 16,
      nextShuffle: start + 4 + rand() * 8,
      fleeX: 0,
      fleeY: 0,
      speed: 0,
      stroke: -1,
      restUntil: start + rand() * 2,
      goalX: x,
      goalY: y,
      goalUntil: 0,
      climbAt: start + 15 + rand() * 25,
      fear: 0,
      fleeAngle: 0,
      rippleAt: 0,
      depth: 0,
      depthTarget: 0,
      deepUntil: 0,
      startled: false,
      headX: x,
      headY: y,
    }
    return f
  }

  // droplets thrown out by a splash land a moment later as a ring of small ripples
  const pending: { at: number; x: number; y: number; r: number; amount: number }[] = []

  const frogs: Frog[] = []
  // sitters start on big pads spread apart
  for (const i of pads.map((_, i) => i).filter(roomy).sort(() => rand() - 0.5)) {
    if (frogs.length >= sitting) break
    if (frogs.some((f) => Math.hypot(f.x - pads[i].x, f.y - pads[i].y) < baseLength * 5)) continue
    const heading = rand() * Math.PI * 2
    const at = seat(pads[i], heading, baseLength)
    occupied.add(i)
    frogs.push(make('sit', at.x, at.y, i, heading))
  }
  // swimmers start in open water, away from the page content
  for (let t = 0; frogs.length < sitting + swimming && t < 300; t++) {
    const x = W * (0.08 + 0.84 * rand())
    const y = H * (0.08 + 0.84 * rand())
    if (!openWater(x, y, baseLength * 0.6) || inFocus(x, y)) continue
    if (frogs.some((f) => Math.hypot(f.x - x, f.y - y) < baseLength * 4)) continue
    frogs.push(make('swim', x, y, -1, rand() * Math.PI * 2))
  }

  // a free pad within leaping range, preferring ones away from whatever startled it
  function pickPad(f: Frog, maxReach: number) {
    let best = -1
    let bestScore = -Infinity
    pads.forEach((p, i) => {
      if (i === f.pad || occupied.has(i) || !roomy(i)) return
      const d = Math.hypot(p.x - f.x, p.y - f.y)
      if (d < f.length * 1.3 || d > maxReach) return
      let score = -Math.abs(d - f.length * 3) / f.length + rand() * 1.5
      if (f.fleeX || f.fleeY) {
        const away = Math.hypot(f.x - f.fleeX, f.y - f.fleeY) || 1
        score += (((p.x - f.x) * (f.x - f.fleeX) + (p.y - f.y) * (f.y - f.fleeY)) / (d * away)) * 4
      }
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    })
    return best
  }

  // somewhere to plop into: open water a couple of body lengths off, away from any flee point
  function pickSplashdown(f: Frog) {
    const away = f.fleeX || f.fleeY ? Math.atan2(f.y - f.fleeY, f.x - f.fleeX) : rand() * Math.PI * 2
    for (let t = 0; t < 16; t++) {
      const a = away + (rand() - 0.5) * (t < 8 ? 1.6 : 6)
      const d = f.length * (1.6 + rand() * 2)
      const x = f.x + Math.cos(a) * d
      const y = f.y + Math.sin(a) * d
      if (openWater(x, y, f.length * 0.4)) return { x, y }
    }
    return null
  }

  function pickSwimGoal(f: Frog, now: number) {
    let best = -Infinity
    for (let t = 0; t < 8; t++) {
      const x = W * (0.06 + 0.88 * rand())
      const y = H * (0.06 + 0.88 * rand())
      if (!openWater(x, y, f.length * 0.5)) continue
      if (inFocus(x, y) && rand() < 0.7) continue
      let room = Infinity
      for (const o of frogs) if (o !== f) room = Math.min(room, Math.hypot(o.x - x, o.y - y))
      const score = Math.min(room, f.length * 5) - 0.25 * Math.hypot(x - f.x, y - f.y)
      if (score > best) {
        best = score
        f.goalX = x
        f.goalY = y
      }
    }
    f.goalUntil = now + 6 + rand() * 8
  }

  // turn to face the target, then go
  function aimAt(f: Frog, aim: Aim, now: number) {
    if (aim.pad >= 0) occupied.add(aim.pad)
    f.aim = aim
    f.wantHeading = Math.atan2(aim.y - f.y, aim.x - f.x)
    f.aimAt = now + (f.mode === 'swim' ? 0.35 : 0.22)
  }

  function hopOrDive(f: Frog, now: number, diveChance: number) {
    const dive = rand() < diveChance
    const spot = dive ? pickSplashdown(f) : null
    if (spot) return aimAt(f, { pad: -1, x: spot.x, y: spot.y, dur: 0.46, height: 0.8 }, now)
    const pad = pickPad(f, f.length * 6)
    if (pad >= 0) {
      const to = seat(pads[pad], Math.atan2(pads[pad].y - f.y, pads[pad].x - f.x), f.length)
      const dist = Math.hypot(to.x - f.x, to.y - f.y)
      return aimAt(f, { pad, x: to.x, y: to.y, dur: Math.min(0.8, 0.34 + (0.08 * dist) / f.length), height: 1 }, now)
    }
    const water = dive ? null : pickSplashdown(f)
    if (water) aimAt(f, { pad: -1, x: water.x, y: water.y, dur: 0.46, height: 0.8 }, now)
    else f.nextMove = now + 5
  }

  function startLeap(f: Frog, water: Water) {
    const aim = f.aim!
    f.aim = null
    f.aimAt = 0
    if (f.mode === 'sit') {
      occupied.delete(f.pad)
      const p = pads[f.pad]
      water.drop(p.x, p.y, p.r * 0.7, -0.35) // kicking off pushes the pad down
    } else {
      water.splash(f.x, f.y, f.length * 0.5, 1.0) // a scramble out of the water
    }
    f.leap = { fromX: f.x, fromY: f.y, fromPad: f.pad, toX: aim.x, toY: aim.y, toPad: aim.pad, t: 0, dur: aim.dur, height: aim.height }
    f.mode = 'leap'
    f.croakT = -1
    f.puff = 0
    f.fleeX = f.fleeY = 0
  }

  function land(f: Frog, now: number, water: Water) {
    const j = f.leap!
    f.leap = null
    f.hop = 0
    if (j.toPad >= 0) {
      const p = pads[j.toPad]
      water.splash(p.x, p.y, p.r * 1.1, 1.1) // the pad slaps down under it
      water.drop(p.x, p.y, p.r * 0.7, 0.4)
      f.mode = 'sit'
      f.pad = j.toPad
      f.stretch = 0
      f.nextMove = now + 10 + rand() * 20
    } else {
      splashdown(f, now, water)
      f.mode = 'swim'
      f.pad = -1
      f.speed = f.length * 0.8
      f.stroke = -1
      f.restUntil = now + 0.5
      f.climbAt = now + 15 + rand() * 25
      f.goalUntil = 0
      if (f.startled) {
        f.startled = false
        submerge(f, now, f.fleeX || f.x - Math.cos(f.heading), f.fleeY || f.y - Math.sin(f.heading))
      }
    }
  }

  // a body hitting the water: a sharp, heavy ring in both ripple fields, a white crown with
  // droplets, the jet of water that rebounds from the hole and falls back into it, and the
  // droplets' own little ripples landing in a ring a beat later
  function splashAt(x: number, y: number, L: number, now: number, water: Water) {
    water.splash(x, y, L * 0.55, 5)
    water.drop(x, y, L * 0.3, 2.6)
    water.spray(x, y, L)
    // the hole refilling and the rebound jet falling back pulse the centre again, so a train of
    // rings runs out rather than one soft swell
    for (const [delay, amount] of [[0.1, 2], [0.22, 1.4], [0.35, 1.6], [0.5, 0.8]]) pending.push({ at: now + delay, x, y, r: L * 0.17, amount })
    for (let k = 0; k < 11; k++) {
      const a = rand() * Math.PI * 2
      const d = L * (0.9 + rand() * 1.1)
      pending.push({ at: now + 0.3 + rand() * 0.35, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, r: L * 0.07, amount: 0.5 })
    }
  }
  const splashdown = (f: Frog, now: number, water: Water) => splashAt(f.x, f.y, f.length, now, water)

  // dive for the bottom and bolt away from whatever startled it, surfacing a few seconds later
  function submerge(f: Frog, now: number, fromX: number, fromY: number) {
    f.depthTarget = 1
    f.deepUntil = now + 2.5 + rand() * 2
    f.fleeAngle = Math.atan2(f.y - fromY, f.x - fromX) + (rand() - 0.5) * 0.6
    f.fear = 1
    f.stroke = 0
    f.croakT = -1
    f.puff = 0
  }

  function swim(f: Frog, dt: number, now: number, water: Water) {
    const L = f.length
    if (now > f.goalUntil || Math.hypot(f.goalX - f.x, f.goalY - f.y) < L) pickSwimGoal(f, now)

    // where it wants to go: its goal, clear of the banks, the pads and the other frogs, away from fright
    let wx = f.goalX - f.x
    let wy = f.goalY - f.y
    const gl = Math.hypot(wx, wy) || 1
    wx /= gl
    wy /= gl
    const margin = L * 0.8
    const past = (v: number) => Math.max(v, 0) / L
    wx += (past(margin - f.x) - past(f.x - (W - margin))) * 6
    wy += (past(margin - f.y) - past(f.y - (H - margin))) * 6
    for (const p of f.depthTarget > 0.5 ? [] : pads) {
      const dx = f.x - p.x
      const dy = f.y - p.y
      const d = Math.hypot(dx, dy) || 1
      const gap = d - p.r - L * 0.35
      if (gap > L * 0.8) continue
      const push = Math.min(2, 1 - gap / (L * 0.8))
      wx += (dx / d) * push * push * 2.5
      wy += (dy / d) * push * push * 2.5
    }
    for (const o of frogs) {
      if (o === f || o.mode !== 'swim') continue
      const dx = f.x - o.x
      const dy = f.y - o.y
      const d = Math.hypot(dx, dy) || 1
      if (d < L * 1.8) {
        wx += (dx / d) * (1 - d / (L * 1.8)) * 3
        wy += (dy / d) * (1 - d / (L * 1.8)) * 3
      }
    }
    if (f.fear > 0.05) {
      wx += Math.cos(f.fleeAngle) * f.fear * 6
      wy += Math.sin(f.fleeAngle) * f.fear * 6
    }
    f.wantHeading = Math.atan2(wy, wx)
    const rate = 1.4 + 4 * f.fear
    f.heading += Math.max(-rate * dt, Math.min(rate * dt, wrap(f.wantHeading - f.heading)))

    // the stroke: kick (legs snap straight, thrust), glide, then recover (knees drawn up wide)
    if (f.stroke < 0) {
      f.stretch += (0.35 - f.stretch) * (1 - Math.exp(-dt * 2)) // legs trail, half open
      if (now > f.restUntil || f.fear > 0.2) f.stroke = 0
    } else {
      const period = f.fear > 0.2 ? 0.55 : 1.1 + f.seed * 0.5
      const before = f.stroke
      f.stroke += dt / period
      const p = f.stroke
      if (p < 0.2) {
        f.stretch = Math.max(f.stretch, smooth(0, 0.2, p))
        f.speed += ((f.fear > 0.2 ? 2.4 : 1.2) * L * dt) / (0.2 * period)
      } else if (p < 0.55) f.stretch = 1
      else f.stretch = 1 - smooth(0.55, 1, p)
      if (before < 0.06 && p >= 0.06) {
        // the feet shove water back as they snap together
        const fx = f.x - Math.cos(f.heading) * L * 0.75
        const fy = f.y - Math.sin(f.heading) * L * 0.75
        const surface = 1 - f.depth
        if (surface > 0.2 && water.pushRoom() >= 2) {
          water.push(fx, fy, L * 0.18, -1600 * surface)
          water.push(f.x + Math.cos(f.heading) * L * 0.35, f.y + Math.sin(f.heading) * L * 0.35, L * 0.14, 900 * surface)
        }
        if (surface > 0.5) water.drop(fx, fy, L * 0.12, 0.25)
      }
      if (f.stroke >= 1) {
        f.stroke = 0
        if (f.fear < 0.1 && rand() < 0.35) {
          f.stroke = -1
          f.restUntil = now + 1 + rand() * 3
        }
      }
    }
    f.speed *= Math.exp(-dt * 1.6)
    f.x += Math.cos(f.heading) * f.speed * dt
    f.y += Math.sin(f.heading) * f.speed * dt
    f.fear *= Math.exp(-dt * 1.2)

    // a small bow wave off the head while it moves
    // diving and surfacing
    if (f.depthTarget > 0 && now > f.deepUntil) f.depthTarget = 0
    const wasDeep = f.depth > 0.35
    f.depth += (f.depthTarget - f.depth) * (1 - Math.exp(-dt * (f.depthTarget > f.depth ? 5 : 2)))
    if (wasDeep && f.depth <= 0.35) water.splash(f.x, f.y, L * 0.4, 0.6) // a ring as it breaks the surface

    if (f.depth < 0.3 && now > f.rippleAt && f.speed > L * 0.15) {
      water.drop(f.x + Math.cos(f.heading) * L * 0.4, f.y + Math.sin(f.heading) * L * 0.4, L * 0.1, 0.06 + 0.1 * Math.min(1, f.speed / L))
      f.rippleAt = now + 0.22
    }

    // tired of swimming: climb out onto a free pad close by
    if (now > f.climbAt && f.fear < 0.1 && f.depth < 0.1) {
      const pad = pickPad(f, f.length * 2.4)
      if (pad >= 0) {
        const to = seat(pads[pad], Math.atan2(pads[pad].y - f.y, pads[pad].x - f.x), f.length)
        aimAt(f, { pad, x: to.x, y: to.y, dur: 0.42, height: 0.7 }, now)
      } else f.climbAt = now + 3
    }
  }

  function update(dt: number, now: number, water: Water, chatty = 1) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const d = pending[i]
      if (now < d.at) continue
      water.drop(d.x, d.y, d.r, d.amount)
      pending.splice(i, 1)
    }
    for (const f of frogs) {
      f.headX = f.x + Math.cos(f.heading) * f.length * 0.3
      f.headY = f.y + Math.sin(f.heading) * f.length * 0.3
      if (now > f.blinkAt) {
        f.blink = 1
        f.blinkAt = now + (rand() < 0.2 ? 0.25 : 2 + rand() * 5) // sometimes twice
      }
      f.blink = Math.max(0, f.blink - dt / 0.16)
      f.wet += ((f.mode === 'swim' ? 1 : 0) - f.wet) * (1 - Math.exp(-dt * 8))

      // croak on a pad, or floating still: three puffs, each sending a ring out across the water
      const canCroak = !f.aim && (f.mode === 'sit' || (f.mode === 'swim' && f.stroke < 0 && f.depth < 0.1))
      if (canCroak && f.croakT < 0 && now > f.croakAt) f.croakT = 0
      else if (f.croakAt - now > 26 / chatty) f.croakAt = now + rand() * (26 / chatty) // weather turned: croak sooner
      if (f.croakT >= 0) {
        const before = f.croakT
        f.croakT += dt
        f.puff = f.croakT < 1.5 ? Math.max(0, Math.sin(f.croakT * Math.PI * 2)) : 0
        for (const k of [0.25, 0.75, 1.25]) {
          if (before < k && f.croakT >= k) {
            if (f.mode === 'sit') water.splash(pads[f.pad].x, pads[f.pad].y, pads[f.pad].r * 0.9, 0.35)
            else water.splash(f.x, f.y, f.length * 0.35, 0.3)
          }
        }
        if (f.croakT > 1.6 || !canCroak) {
          f.croakT = -1
          f.puff = 0
          f.croakAt = now + (8 + rand() * 18) / chatty
        }
      }

      if (f.mode === 'leap') {
        const j = f.leap!
        j.t = Math.min(1, j.t + dt / j.dur)
        const e = smooth(0, 1, j.t)
        f.x = j.fromX + (j.toX - j.fromX) * e
        f.y = j.fromY + (j.toY - j.fromY) * e
        f.hop = Math.sin(Math.PI * j.t) * j.height
        f.stretch = j.t < 0.7 ? smooth(0, 0.15, j.t) : 1 - smooth(0.7, 1, j.t)
        if (j.t >= 1) land(f, now, water)
        continue
      }

      if (f.aim) {
        f.heading += wrap(f.wantHeading - f.heading) * (1 - Math.exp(-dt * 14))
        if (now >= f.aimAt) startLeap(f, water)
        else if (f.mode === 'swim') {
          f.speed *= Math.exp(-dt * 3)
          f.stretch += (0 - f.stretch) * (1 - Math.exp(-dt * 10)) // gathers its legs under it
        }
        continue
      }

      if (f.mode === 'swim') {
        swim(f, dt, now, water)
        continue
      }

      // sitting
      if (now > f.nextMove) hopOrDive(f, now, 0.35)
      if (now > f.nextShuffle) {
        f.wantHeading = f.heading + (rand() - 0.5) * 1.4
        f.nextShuffle = now + 6 + rand() * 10
      }
      f.heading += wrap(f.wantHeading - f.heading) * (1 - Math.exp(-dt * 3))
      const at = seat(pads[f.pad], f.heading, f.length)
      f.x = at.x
      f.y = at.y
    }
  }

  // swimmers are drawn under the pads, everything else over them, so low ones go first.
  // Returns how many are low.
  function writeInstances(out: Float32Array) {
    const low = frogs.filter((f) => f.mode === 'swim')
    const high = frogs.filter((f) => f.mode !== 'swim')
    let o = 0
    for (const f of [...low, ...high]) {
      const anchor = f.mode === 'sit' ? pads[f.pad] : f.mode === 'leap' ? leapAnchor(f.leap!) : f
      out.set([f.x, f.y, f.heading, f.length, f.blink, f.puff, f.stretch, f.hop, anchor.x, anchor.y, f.seed, f.kind, f.wet, f.depth, 0, 0], o)
      o += FLOATS_PER_FROG
    }
    return low.length
  }

  // mid leap the frog bobs with neither end; blend so there's no pop at either
  function leapAnchor(j: Leap) {
    const a = j.fromPad >= 0 ? pads[j.fromPad] : { x: j.fromX, y: j.fromY }
    const b = j.toPad >= 0 ? pads[j.toPad] : { x: j.toX, y: j.toY }
    return { x: a.x + (b.x - a.x) * j.t, y: a.y + (b.y - a.y) * j.t }
  }

  function hitTest(x: number, y: number) {
    return frogs.find((f) => Math.hypot(f.x - x, f.y - y) < f.length * 0.5 * (1 + f.hop * 0.35)) ?? null
  }

  // a swimmer's V wake, the same push and pull at the head that the koi use, spread over the
  // ripple substeps so a quick frog leaves a smooth wake rather than a row of dots
  function emitWake(frac: number, water: Water) {
    for (const f of frogs) {
      if (f.mode !== 'swim' || f.depth > 0.6) continue
      const L = f.length
      const cx = Math.cos(f.heading)
      const cy = Math.sin(f.heading)
      const hx = f.headX + (f.x + cx * L * 0.3 - f.headX) * frac
      const hy = f.headY + (f.y + cy * L * 0.3 - f.headY) * frac
      const force = 2400 * Math.tanh(f.speed / 320) * (1 - f.depth)
      if (force < 20 || water.pushRoom() < 2) continue
      water.push(hx + cx * L * 0.1, hy + cy * L * 0.1, L * 0.14, force)
      water.push(hx - cx * L * 0.15, hy - cy * L * 0.15, L * 0.14, -force)
    }
  }

  function scareSwimmer(f: Frog, x: number, y: number, amount: number) {
    f.fleeAngle = Math.atan2(f.y - y, f.x - x) + (rand() - 0.5) * 0.6
    f.fear = Math.max(f.fear, amount)
    if (f.stroke < 0 || f.stroke > 0.55) f.stroke = 0 // kick right away
  }

  function poke(f: Frog, x: number, y: number, now: number, water: Water) {
    if (f.mode === 'leap' || f.aim) return
    if (f.mode === 'swim') {
      // straight down with a plunk
      if (f.depth < 0.3) {
        water.splash(f.x, f.y, f.length * 0.45, 1.4)
        water.spray(f.x, f.y, f.length * 0.5)
      }
      return submerge(f, now, x, y)
    }
    f.fleeX = x
    f.fleeY = y
    f.startled = true
    hopOrDive(f, now, 1)
  }

  // a splash nearby: swimmers bolt, and sitters close enough often dive in
  function disturb(x: number, y: number, radius: number, now: number) {
    for (const f of frogs) {
      const d = Math.hypot(f.x - x, f.y - y)
      if (d > radius || f.mode === 'leap' || f.aim) continue
      if (f.mode === 'swim') scareSwimmer(f, x, y, 0.8 * (1 - d / radius))
      else if (d < radius * 0.6 && rand() < 0.6) {
        f.fleeX = x
        f.fleeY = y
        f.startled = true
        hopOrDive(f, now, 0.8)
      }
    }
  }

  // for ?debug: where each frog is and what it is doing
  const inspect = () => frogs.map((f) => ({ x: f.x, y: f.y, mode: f.mode, depth: f.depth }))

  return { count: frogs.length, update, emitWake, writeInstances, hitTest, poke, disturb, inspect, splashAt, length: baseLength }
}
