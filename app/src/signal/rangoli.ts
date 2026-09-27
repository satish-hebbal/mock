/**
 * Rangoli, drawn the way a kolam is drawn: the dots first, then a line that
 * loops round them without ever touching one.
 *
 * The line is a mirror curve, which is what a sikku kolam is underneath. Give
 * every dot a diamond of four short diagonal segments. Wherever two diamonds
 * meet, at the gap between two neighbouring dots, four segment ends arrive and
 * have to be paired off, and there are exactly three ways to do it:
 *
 *   cross     straight through, the X every sikku kolam is full of
 *   dots      each dot is wrapped on its own side, as if a mirror stood
 *             between them
 *   hole      the line turns round the empty square above and below instead
 *
 * A gap on the edge of the grid has only one dot beside it, so it can only
 * wrap that dot, and that is the whole reason the line never escapes: every
 * outer dot grows the teardrop loop the references are drawn with. Everything
 * the panel calls a design is a rule for which of the three each inner gap
 * takes. Every choice keeps the curve closed and away from the dots, so the
 * three rules of the form (every dot encircled, crossings are points, no loose
 * ends) hold by construction rather than by checking.
 *
 * One line: smoothing a crossing where two different loops meet always joins
 * them, and so does un-smoothing a turn. So joining is a union-find pass over
 * the gaps rather than a search, and any connected grid comes out as the single
 * unbroken line of a Brahma mudi kolam.
 *
 * Both functions below are lifted into the embed export by name, so like every
 * figure they reach for nothing outside themselves but each other and `Math`.
 */

import { param, type ParamSpec } from './fields'
import type { FigureFn } from './figures'

/** The trig hash the other figures use, with a third input for the seed. */
export function kolamHash(a: number, b: number, c: number) {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return s - Math.floor(s)
}

export interface KolamLoop {
  /** flat x,y in dot units, centred on the grid, closed */
  pts: number[]
  /** per point, how far it is from a crossing this pass goes under (99 if none) */
  under: number[]
  /** per point, the arc length so far */
  cum: number[]
  len: number
}

export interface KolamWeave {
  /** flat x,y of every dot, centred */
  dots: number[]
  /** per dot, its ring number, for the ripple */
  rings: number[]
  loops: KolamLoop[]
}

/**
 * Lay the dots, decide every gap, join, and flatten the result to polylines.
 *
 * Pure in its arguments and a few milliseconds at the largest grid, so the
 * figure caches the result on its canvas and only calls this again when the
 * structure changes, never because the clock moved.
 */
export function kolamWeave(
  layout: number,
  span: number,
  aspect: number,
  hollow: number,
  pattern: number,
  sym: number,
  oneLine: number,
  seed: number,
  folds: number,
  round: number,
): KolamWeave {
  const nx = Math.max(1, Math.round(span))
  const ny = Math.max(1, Math.round((nx - 1) * aspect) + 1)
  const R = (nx - 1) / 2
  const Ry = (ny - 1) / 2
  const Rn = Math.max(R, 0.5)
  const Ryn = Math.max(Ry, 0.5)

  // how far out a dot sits, in the shape's own sense of distance
  const metric = (u: number, v: number) => {
    const a = Math.abs(u) / Rn
    const b = Math.abs(v) / Ryn
    if (layout === 1 || layout === 5) return Math.max(a, b)
    if (layout === 2) return Math.min(a + b, Math.max(a, b) * 2)
    if (layout === 3) return Math.max(Math.max(a, b), (a + b) / 1.45)
    if (layout === 4) return Math.sqrt(a * a + b * b)
    return a + b
  }
  const limit = layout === 4 ? 1 + 0.35 / Rn : 1

  const present = new Uint8Array(nx * ny)
  const ring = new Float32Array(nx * ny)
  let inner = Infinity
  const lay = (withHollow: boolean, only: number) => {
    let n = 0
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const u = i - R
        const v = j - Ry
        const m = metric(u, v)
        inner = Math.min(inner, m)
        let on = only >= 0 ? m <= only + 1e-6 : m <= limit + 1e-6
        if (on && only < 0 && layout === 5) on = Math.min(Math.abs(u) / Rn, Math.abs(v) / Ryn) <= Math.max(0.34, 0.5 / Rn) + 1e-6
        if (on && withHollow && hollow > 0) on = m >= hollow - 1e-6
        present[i + j * nx] = on ? 1 : 0
        ring[i + j * nx] = Math.round(m * Math.max(Rn, Ryn))
        if (on) n++
      }
    }
    return n
  }
  // a hollow wide enough to empty the grid is ignored, and a shape too small to
  // hold any dot (a diamond two across) keeps its innermost ones, rather than
  // either drawing nothing
  if (lay(true, -1) === 0 && lay(false, -1) === 0) lay(false, inner)

  const has = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && present[i + j * nx] === 1
  const port = (i: number, j: number, k: number, e: number) => ((i + j * nx) * 4 + k) * 2 + e

  const nSeg = nx * ny * 4
  const link: number[] = new Array(nSeg * 2).fill(-1)
  const portJ: number[] = new Array(nSeg * 2).fill(-1)

  /*
   * Segment k of a dot runs E→N, N→W, W→S, S→E for k = 0..3, and its two ends
   * are ports 0 and 1. A gap holds four ports ordered so that the pairs are the
   * same for either orientation: P0-P1 and P2-P3 cross, P0-P2 and P1-P3 wrap the
   * dots, P0-P3 and P2-P1 wrap the holes.
   */
  const jx: number[] = []
  const jy: number[] = []
  const jt: number[] = []
  const ja: number[] = []
  const jb: number[] = []
  const jp: number[] = []
  const jst: number[] = []
  const jin: boolean[] = []
  const addGap = (type: number, x: number, y: number, a: number, b: number, P: number[]) => {
    const n = jx.length
    jx.push(x)
    jy.push(y)
    jt.push(type)
    ja.push(a)
    jb.push(b)
    for (let q = 0; q < 4; q++) {
      jp.push(P[q])
      if (P[q] >= 0) portJ[P[q]] = n
    }
    jst.push(1)
    jin.push(P[0] >= 0 && P[1] >= 0)
  }
  for (let j = 0; j < ny; j++) {
    for (let i = -1; i < nx; i++) {
      const l = has(i, j)
      const r = has(i + 1, j)
      if (!l && !r) continue
      addGap(0, i + 0.5 - R, j - Ry, l ? i + j * nx : -1, r ? i + 1 + j * nx : -1, [
        l ? port(i, j, 0, 0) : -1,
        r ? port(i + 1, j, 2, 0) : -1,
        l ? port(i, j, 3, 1) : -1,
        r ? port(i + 1, j, 1, 1) : -1,
      ])
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = -1; j < ny; j++) {
      const b = has(i, j)
      const tp = has(i, j + 1)
      if (!b && !tp) continue
      addGap(1, i - R, j + 0.5 - Ry, b ? i + j * nx : -1, tp ? i + (j + 1) * nx : -1, [
        b ? port(i, j, 0, 1) : -1,
        tp ? port(i, j + 1, 2, 1) : -1,
        b ? port(i, j, 1, 0) : -1,
        tp ? port(i, j + 1, 3, 0) : -1,
      ])
    }
  }
  const nGap = jx.length

  const pair = (x: number, y: number) => {
    if (x < 0 || y < 0) return
    link[x] = y
    link[y] = x
  }
  const setGap = (n: number, st: number) => {
    const a = jp[n * 4]
    const b = jp[n * 4 + 1]
    const c = jp[n * 4 + 2]
    const d = jp[n * 4 + 3]
    jst[n] = st
    if (st === 0) {
      pair(a, b)
      pair(c, d)
    } else if (st === 1) {
      pair(a, c)
      pair(b, d)
    } else {
      pair(a, d)
      pair(c, b)
    }
  }

  // the symmetric key: gaps in one orbit read the same hash, so decide alike
  const keyX = (n: number) => {
    const x = Math.abs(jx[n])
    const y = Math.abs(jy[n])
    if (sym === 0) return jx[n]
    if (sym === 3) return Math.max(x, y)
    return x
  }
  const keyY = (n: number) => {
    const x = Math.abs(jx[n])
    const y = Math.abs(jy[n])
    if (sym === 0 || sym === 1) return jy[n]
    if (sym === 3) return Math.min(x, y)
    return y
  }

  for (let n = 0; n < nGap; n++) {
    if (!jin[n]) {
      setGap(n, 1)
      continue
    }
    const di = ja[n] % nx
    const dj = Math.floor(ja[n] / nx)
    let st = 0
    if (pattern === 1) st = 1
    else if (pattern === 2) st = 2
    else if (pattern === 3) st = jt[n] === 0 ? 0 : 1
    else if (pattern === 4) st = (di + dj) % 2 === 0 ? 0 : 1
    else if (pattern === 5) {
      const ra = ring[ja[n]]
      const rb = ring[jb[n]]
      st = ra !== rb && Math.min(ra, rb) % 2 === 1 ? 1 : 0
    }
    const kx = keyX(n)
    const ky = keyY(n)
    if (kolamHash(kx * 1.37 + 0.11, ky * 2.11 + 0.7, seed * 0.618 + 1.3) < folds) {
      st = (st + (kolamHash(ky + 3.1, kx - 1.7, seed + 9.2) < 0.5 ? 1 : 2)) % 3
    }
    setGap(n, st)
  }

  const comp: number[] = new Array(nSeg).fill(-1)
  const trace = () => {
    comp.fill(-1)
    let loops = 0
    for (let s = 0; s < nSeg; s++) {
      if (present[s >> 2] !== 1 || comp[s] >= 0) continue
      let pin = s * 2
      let guard = 0
      while (guard++ < nSeg * 2 + 4) {
        comp[pin >> 1] = loops
        const nxt = link[pin ^ 1]
        if (nxt < 0) break
        pin = nxt
        if (pin === s * 2) break
      }
      loops++
    }
    return loops
  }

  // a crossing becomes a turn of the orbit's chosen kind; a turn opens to a crossing
  const flipOf = (n: number) =>
    jst[n] !== 0 ? 0 : kolamHash(keyX(n) + 5.3, keyY(n) - 2.9, seed + 4.4) < 0.5 ? 1 : 2

  if (oneLine > 0) {
    let loops = trace()
    const inner: number[] = []
    for (let n = 0; n < nGap; n++) if (jin[n]) inner.push(n)

    /*
     * First, whole orbits at a time, kept only when they reduce the count. This
     * is what keeps a symmetric design symmetric while it joins: the greedy
     * pass below would happily break the symmetry to finish the job.
     */
    if (sym > 0 && loops > 1) {
      const orbits: Record<string, number[]> = {}
      const names: string[] = []
      for (const n of inner) {
        const name = keyX(n) + ',' + keyY(n)
        if (!orbits[name]) {
          orbits[name] = []
          names.push(name)
        }
        orbits[name].push(n)
      }
      const order = names.map((_name, i) => [kolamHash(i * 0.37, seed, 2.2), i])
      order.sort((u, v) => u[0] - v[0])
      for (const o of order) {
        if (loops <= 1) break
        const members = orbits[names[o[1]]]
        const was = members.map((n) => jst[n])
        const to = flipOf(members[0])
        for (const n of members) setGap(n, to)
        const c = trace()
        if (c < loops) loops = c
        else members.forEach((n, q) => setGap(n, was[q]))
      }
    }

    if (loops > 1) {
      trace()
      const parent: number[] = []
      for (let q = 0; q < loops; q++) parent.push(q)
      const find = (x: number) => {
        while (parent[x] !== x) {
          parent[x] = parent[parent[x]]
          x = parent[x]
        }
        return x
      }
      const order = inner.map((n) => [kolamHash(n * 0.73, seed, 5.1), n])
      order.sort((u, v) => u[0] - v[0])
      for (const o of order) {
        const n = o[1]
        const a = jp[n * 4]
        const mate = link[a]
        let other = -1
        for (let q = 0; q < 4; q++) {
          const pq = jp[n * 4 + q]
          if (pq !== a && pq !== mate) other = pq
        }
        const ca = find(comp[a >> 1])
        const cb = find(comp[other >> 1])
        if (ca === cb) continue
        setGap(n, flipOf(n))
        parent[ca] = cb
      }
    }
  }

  // which pass goes over at a crossing: "\" on a horizontal gap, "/" on a vertical
  const overPort: number[] = new Array(nSeg * 2).fill(-1)
  for (let n = 0; n < nGap; n++) {
    if (jst[n] !== 0 || !jin[n]) continue
    const top = jt[n] === 0 ? 0 : 2
    for (let q = 0; q < 4; q++) overPort[jp[n * 4 + q]] = q === top || q === top + 1 ? 1 : 0
  }

  const MX = [0.25, -0.25, -0.25, 0.25]
  const MY = [0.25, 0.25, -0.25, -0.25]
  const midX = (s: number) => ((s >> 2) % nx) - R + MX[s & 3]
  const midY = (s: number) => Math.floor((s >> 2) / nx) - Ry + MY[s & 3]
  const STEPS = 8

  const seen = new Uint8Array(nSeg)
  const loops: KolamLoop[] = []
  for (let s = 0; s < nSeg; s++) {
    if (present[s >> 2] !== 1 || seen[s]) continue
    const pts: number[] = [midX(s), midY(s)]
    const under: number[] = [99]
    const cum: number[] = [0]
    let len = 0
    let pin = s * 2
    let guard = 0
    while (guard++ < nSeg * 2 + 4) {
      const seg = pin >> 1
      seen[seg] = 1
      const q = pin ^ 1
      const r = link[q]
      if (r < 0) break
      const n = portJ[q]
      const x0 = midX(seg)
      const y0 = midY(seg)
      const x1 = midX(r >> 1)
      const y1 = midY(r >> 1)
      const mx = (x0 + x1) / 2
      const my = (y0 + y1) / 2
      const cx = mx + (jx[n] - mx) * round
      const cy = my + (jy[n] - my) * round
      const goesUnder = overPort[q] === 0
      for (let k = 1; k <= STEPS; k++) {
        const tt = k / STEPS
        const a = (1 - tt) * (1 - tt)
        const b = 2 * (1 - tt) * tt
        const c = tt * tt
        const px = a * x0 + b * cx + c * x1
        const py = a * y0 + b * cy + c * y1
        len += Math.hypot(px - pts[pts.length - 2], py - pts[pts.length - 1])
        pts.push(px, py)
        cum.push(len)
        under.push(goesUnder ? Math.hypot(px - jx[n], py - jy[n]) : 99)
      }
      pin = r
      if (pin === s * 2) break
    }
    loops.push({ pts, under, cum, len })
  }

  const dots: number[] = []
  const rings: number[] = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!present[i + j * nx]) continue
      dots.push(i - R, j - Ry)
      rings.push(ring[i + j * nx])
    }
  }
  return { dots, rings, loops }
}

/**
 * The figure.
 *
 * `intensity` is the folds: how often a gap breaks from the design's rule,
 * squared so the low end stays calm. `scale` zooms, with 4 filling the frame.
 */
export const rangoli: FigureFn = (ctx, w, h, t, intensity, scale, ink, _motion, p) => {
  const col = (c: number[], a: number) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'
  const mixc = (c1: number[], c2: number[], f: number) =>
    'rgb(' +
    Math.round(c1[0] + (c2[0] - c1[0]) * f) + ',' +
    Math.round(c1[1] + (c2[1] - c1[1]) * f) + ',' +
    Math.round(c1[2] + (c2[2] - c1[2]) * f) + ')'

  ctx.fillStyle = col(ink.bg, 1)
  ctx.fillRect(0, 0, w, h)

  const layout = Math.round(p.layout)
  const span = Math.round(p.span)
  const pattern = Math.round(p.pattern)
  const sym = Math.round(p.symmetry)
  const one = Math.round(p.oneLine)
  const seed = Math.round(p.seed) + Math.floor(Math.max(0, t) * p.evolve)
  const folds = Math.round(Math.pow(intensity / 100, 2) * 900) / 1000
  const round = Math.round(p.round * 100) / 100
  const key = [layout, span, p.aspect, p.hollow, pattern, sym, one, seed, folds, round].join('|')

  // the structure is cached on the canvas, which is the one thing that is
  // still there next frame both in the app and in an exported embed
  const host = ctx.canvas as unknown as { kolamKey?: string; kolam?: KolamWeave } | undefined
  let k = host && host.kolamKey === key ? host.kolam : undefined
  if (!k) {
    k = kolamWeave(layout, span, p.aspect, p.hollow, pattern, sym, one, seed, folds, round)
    if (host) {
      host.kolamKey = key
      host.kolam = k
    }
  }

  const th = ((p.turn + t * p.spin) * Math.PI) / 180
  const cs = Math.cos(th)
  const sn = Math.sin(th)
  let ex = 0
  let ey = 0
  for (let i = 0; i < k.dots.length; i += 2) {
    const x = k.dots[i]
    const y = k.dots[i + 1]
    if (p.spin !== 0) {
      // spinning fits the circle it sweeps, so the zoom does not pump
      const r = Math.hypot(x, y)
      ex = Math.max(ex, r)
      ey = Math.max(ey, r)
    } else {
      ex = Math.max(ex, Math.abs(x * cs - y * sn))
      ey = Math.max(ey, Math.abs(x * sn + y * cs))
    }
  }
  const pad = 0.72 + p.weight * 0.6
  const unit = Math.min(w / (2 * (ex + pad)), h / (2 * (ey + pad))) * 0.94 * (scale / 4)
  const ox = w / 2
  const oy = h / 2
  const X = (x: number, y: number) => ox + (x * cs - y * sn) * unit
  const Y = (x: number, y: number) => oy - (x * sn + y * cs) * unit

  const style = Math.round(p.style)
  const colour = Math.round(p.colour)
  const lw = Math.max(0.6, p.weight * unit)
  const lineC = colour === 1 ? ink.accent : ink.fg

  // ----- fill, under everything, from the complete loops -----
  const fill = Math.round(p.fill)
  if (fill > 0 && p.fillAlpha > 0) {
    ctx.beginPath()
    if (fill === 2) {
      ctx.moveTo(0, 0)
      ctx.lineTo(w, 0)
      ctx.lineTo(w, h)
      ctx.lineTo(0, h)
      ctx.closePath()
    }
    for (const L of k.loops) {
      ctx.moveTo(X(L.pts[0], L.pts[1]), Y(L.pts[0], L.pts[1]))
      for (let i = 2; i < L.pts.length; i += 2) ctx.lineTo(X(L.pts[i], L.pts[i + 1]), Y(L.pts[i], L.pts[i + 1]))
      ctx.closePath()
    }
    ctx.fillStyle = col(colour === 1 ? ink.fg : ink.accent, p.fillAlpha)
    ctx.fill('evenodd')
  }

  // ----- the dots, which a kolam always puts down first -----
  if (p.dot > 0) {
    const dotStyle = Math.round(p.dotStyle)
    const dc = Math.round(p.dotInk) === 1 ? ink.accent : ink.fg
    ctx.fillStyle = col(dc, 1)
    ctx.strokeStyle = col(dc, 1)
    ctx.beginPath()
    for (let i = 0; i < k.dots.length; i += 2) {
      const x = X(k.dots[i], k.dots[i + 1])
      const y = Y(k.dots[i], k.dots[i + 1])
      const ds = Math.max(0.5, p.dot * unit * (1 + p.pulse * 0.4 * Math.sin(t * 2.4 - k.rings[i >> 1] * 0.9)))
      if (dotStyle === 1) {
        ctx.moveTo(x + ds * 0.85, y)
        ctx.arc(x, y, ds * 0.85, 0, Math.PI * 2)
      } else if (dotStyle === 2) {
        for (let q = 0; q < 4; q++) {
          const a = th + (q * Math.PI) / 2
          const px = x + Math.cos(a) * ds * 0.72
          const py = y - Math.sin(a) * ds * 0.72
          ctx.moveTo(px + ds * 0.48, py)
          ctx.arc(px, py, ds * 0.48, 0, Math.PI * 2)
        }
      } else if (dotStyle === 3) {
        for (let q = 0; q <= 8; q++) {
          const a = th + (q * Math.PI) / 4
          const r = q % 2 === 0 ? ds * 1.6 : ds * 0.45
          if (q === 0) ctx.moveTo(x + Math.cos(a) * r, y - Math.sin(a) * r)
          else ctx.lineTo(x + Math.cos(a) * r, y - Math.sin(a) * r)
        }
        ctx.closePath()
      } else {
        ctx.moveTo(x + ds, y)
        ctx.arc(x, y, ds, 0, Math.PI * 2)
      }
    }
    if (dotStyle === 1) {
      ctx.lineWidth = Math.max(0.5, p.dot * unit * 0.4)
      ctx.stroke()
    } else ctx.fill()
  }

  // ----- the line: cut at the under-crossings, trimmed by the trace -----
  // the cycle starts on the finished drawing, so a still or a thumbnail at t=0 is never blank
  const tr = p.trace > 0 ? Math.min(1, (1 + t * p.trace * 0.35) % 1.3) : 1
  const gapR = Math.round(p.cross) === 1 ? p.weight * 1.3 + 0.08 : -1
  const runs: { pts: number[]; c: string }[] = []
  k.loops.forEach((L, li) => {
    const lim = tr * L.len
    const base = colour === 2 && li % 2 === 1 ? ink.accent : lineC
    let cur: number[] = []
    let c0 = 0
    const flush = () => {
      if (cur.length < 4) {
        cur = []
        return
      }
      if (colour !== 3) runs.push({ pts: cur, c: col(base, 1) })
      else {
        // the blend is cut into short runs, each in the colour of where it sits
        for (let i = 0; i < cur.length - 2; i += 20) {
          const piece = cur.slice(i, i + 24)
          if (piece.length < 4) continue
          const f = 0.5 - 0.5 * Math.cos(((c0 + i / 2) / (L.pts.length / 2)) * Math.PI * 2)
          runs.push({ pts: piece, c: mixc(ink.fg, ink.accent, f) })
        }
      }
      cur = []
    }
    for (let i = 0; i < L.pts.length; i += 2) {
      if (L.cum[i >> 1] > lim) break
      if (L.under[i >> 1] < gapR) {
        flush()
        continue
      }
      if (!cur.length) c0 = i >> 1
      cur.push(X(L.pts[i], L.pts[i + 1]), Y(L.pts[i], L.pts[i + 1]))
    }
    flush()
  })

  const strokeRuns = (width: number, colourOf: (r: { c: string }) => string) => {
    ctx.lineWidth = width
    for (const r of runs) {
      ctx.beginPath()
      ctx.moveTo(r.pts[0], r.pts[1])
      for (let i = 2; i < r.pts.length; i += 2) ctx.lineTo(r.pts[i], r.pts[i + 1])
      ctx.strokeStyle = colourOf(r)
      ctx.stroke()
    }
  }

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (style === 1) {
    // kambi: a wide line with the paper run down its middle, so crossings open into channels
    strokeRuns(lw * 1.25, (r) => r.c)
    const paper = col(ink.bg, 1)
    strokeRuns(lw * 0.45, () => paper)
  } else if (style === 2) {
    ctx.lineCap = 'butt'
    ctx.setLineDash([lw * 2.2, lw * 1.6])
    strokeRuns(lw, (r) => r.c)
    ctx.setLineDash([])
    ctx.lineCap = 'round'
  } else if (style === 3) {
    // rice beads, spaced by arc length so they do not bunch on the turns
    const gap = lw * 2.1
    for (const r of runs) {
      ctx.beginPath()
      let carry = 0
      for (let i = 2; i < r.pts.length; i += 2) {
        const x0 = r.pts[i - 2]
        const y0 = r.pts[i - 1]
        const d = Math.hypot(r.pts[i] - x0, r.pts[i + 1] - y0)
        let s = gap - carry
        while (s <= d) {
          const f = s / d
          const bx = x0 + (r.pts[i] - x0) * f
          const by = y0 + (r.pts[i + 1] - y0) * f
          ctx.moveTo(bx + lw * 0.62, by)
          ctx.arc(bx, by, lw * 0.62, 0, Math.PI * 2)
          s += gap
        }
        carry = d - (s - gap)
      }
      ctx.fillStyle = r.c
      ctx.fill()
    }
  } else if (style === 4) {
    // powder: a faint body and grains thrown either side of it, hashed so they hold still
    ctx.globalAlpha = 0.28
    strokeRuns(lw * 0.9, (r) => r.c)
    ctx.globalAlpha = 0.9
    const step = Math.max(1, lw * 0.42)
    let g = 0
    for (const r of runs) {
      ctx.fillStyle = r.c
      for (let i = 2; i < r.pts.length; i += 2) {
        const x0 = r.pts[i - 2]
        const y0 = r.pts[i - 1]
        const dx = r.pts[i] - x0
        const dy = r.pts[i + 1] - y0
        const d = Math.hypot(dx, dy) || 1
        for (let s = 0; s < d; s += step) {
          for (let q = 0; q < 2; q++) {
            g++
            const off = (kolamHash(g, 1.3, 0) - 0.5) * lw * 1.25
            const sz = lw * (0.14 + kolamHash(g, 7.1, 2) * 0.26)
            ctx.fillRect(x0 + (dx * s) / d - (dy / d) * off, y0 + (dy * s) / d + (dx / d) * off, sz, sz)
          }
        }
      }
    }
    ctx.globalAlpha = 1
  } else if (style === 5) {
    // brush: a filled ribbon whose width swells and thins like a pressed stroke
    for (const r of runs) {
      const n = r.pts.length / 2
      const lens: number[] = [0]
      for (let i = 1; i < n; i++)
        lens.push(lens[i - 1] + Math.hypot(r.pts[i * 2] - r.pts[i * 2 - 2], r.pts[i * 2 + 1] - r.pts[i * 2 - 1]))
      const total = lens[n - 1]
      const side = (sgn: number, i: number) => {
        const a = Math.max(0, i - 1)
        const b = Math.min(n - 1, i + 1)
        const dx = r.pts[b * 2] - r.pts[a * 2]
        const dy = r.pts[b * 2 + 1] - r.pts[a * 2 + 1]
        const d = Math.hypot(dx, dy) || 1
        const end = Math.min(lens[i], total - lens[i])
        const ww =
          lw * (0.3 + 0.95 * (0.5 + 0.5 * Math.sin((lens[i] / unit) * 2.6 + r.pts[0] * 0.01))) *
          Math.min(1, 0.3 + end / (lw * 2.5)) * 0.62
        return [r.pts[i * 2] - (dy / d) * ww * sgn, r.pts[i * 2 + 1] + (dx / d) * ww * sgn]
      }
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const q = side(1, i)
        if (i === 0) ctx.moveTo(q[0], q[1])
        else ctx.lineTo(q[0], q[1])
      }
      for (let i = n - 1; i >= 0; i--) {
        const q = side(-1, i)
        ctx.lineTo(q[0], q[1])
      }
      ctx.closePath()
      ctx.fillStyle = r.c
      ctx.fill()
    }
  } else {
    strokeRuns(lw, (r) => r.c)
  }
}

/** A choice drawn as a row of named options, stored as the option's index. */
const choice = (key: string, label: string, options: string[], value: number, section: string, hint?: string): ParamSpec => ({
  key,
  label,
  min: 0,
  max: options.length - 1,
  step: 1,
  value,
  hint,
  integer: true,
  options,
  section,
  remix: [0, options.length - 1],
})

/** A slider in a named section, optionally part of Remix shape. */
const knob = (
  section: string,
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  hint?: string,
  remix?: [number, number],
): ParamSpec => ({ ...param(key, label, min, max, step, value, hint), section, remix })

export const RANGOLI_PARAMS: ParamSpec[] = [
  // ----- the dot grid -----
  choice('layout', 'Shape', ['Diamond', 'Square', 'Star', 'Octagon', 'Circle', 'Cross'], 0, 'Grid',
    'How the dots are laid. Diamond is the 7-1 kind: seven across the middle, down to one.'),
  knob('Grid', 'span', 'Dots across', 1, 25, 1, 7, 'The middle row. Seven gives the classic 7-1.', [5, 13]),
  knob('Grid', 'aspect', 'Height', 0.3, 2.5, 0.05, 1, 'Rows against columns. Above 1 is a tall card, below is a band.'),
  knob('Grid', 'hollow', 'Hollow', 0, 0.85, 0.01, 0, 'Clears the middle, for ring kolams.'),
  knob('Grid', 'turn', 'Turn', 0, 90, 1, 0, 'At 45° a square grid becomes an interlaced (idukku) one.'),

  // ----- how the line behaves at every gap -----
  choice('pattern', 'Design', ['Net', 'Pearls', 'Lattice', 'Chains', 'Checker', 'Rings'], 0, 'Weave',
    'Open net crosses everywhere; Pearls closes a loop round every dot; Lattice rings the holes instead.'),
  choice('symmetry', 'Symmetry', ['None', 'Mirror', 'Quad', 'Octa'], 3, 'Weave',
    'Folds and joins are chosen alike across these mirrors.'),
  choice('oneLine', 'Path', ['Loops', 'One line'], 1, 'Weave',
    'One line joins every loop into a single unbroken stroke, like a Brahma mudi kolam.'),
  knob('Weave', 'seed', 'Seed', 0, 999, 1, 7, 'Which variation. Every number is a different kolam.', [0, 999]),
  knob('Weave', 'evolve', 'Evolve', 0, 3, 0.05, 0, 'New seeds per second while playing, for a kolam that keeps redrawing itself.'),

  // ----- the stroke -----
  choice('style', 'Stroke', ['Solid', 'Kambi', 'Dashed', 'Beads', 'Powder', 'Brush'], 0, 'Line',
    'Kambi is the double wire line; Powder is rice flour from the fingers; Brush swells and thins.'),
  knob('Line', 'weight', 'Weight', 0.02, 0.35, 0.005, 0.09, 'Line width against dot spacing.', [0.05, 0.16]),
  knob('Line', 'round', 'Roundness', 0, 2, 0.01, 1, '0 is angular, 1 is the drawn curve, above 1 the loops swell.', [0.6, 1.4]),
  choice('cross', 'Crossings', ['Plain', 'Woven'], 0, 'Line', 'Woven breaks the line where it passes under, like a knot.'),
  choice('colour', 'Colour', ['Ink', 'Accent', 'Loops', 'Blend'], 0, 'Line',
    'Loops alternates ink and accent between separate loops. Blend runs along the line.'),

  // ----- dots and colour -----
  knob('Dots & fill', 'dot', 'Dot size', 0, 0.3, 0.005, 0.07, undefined, [0.03, 0.12]),
  choice('dotStyle', 'Dot', ['Dot', 'Ring', 'Flower', 'Star'], 0, 'Dots & fill'),
  choice('dotInk', 'Dot colour', ['Ink', 'Accent'], 0, 'Dots & fill'),
  choice('fill', 'Fill', ['None', 'Checker', 'Inverse'], 0, 'Dots & fill',
    'Colours alternate regions between the lines, the way powder is filled in.'),
  knob('Dots & fill', 'fillAlpha', 'Fill strength', 0, 1, 0.01, 0.4),

  // ----- time -----
  knob('Motion', 'trace', 'Draw on', 0, 2, 0.01, 0, 'Traces the line as a hand would, then starts again. 0 shows it whole.'),
  knob('Motion', 'spin', 'Spin', -60, 60, 1, 0, 'Degrees a second.'),
  knob('Motion', 'pulse', 'Ripple', 0, 1, 0.01, 0.25, 'Dots breathe outward from the centre.'),
]

/** What the embed exporter has to carry beside the figure. */
export const RANGOLI_HELPERS: Function[] = [kolamHash, kolamWeave]
