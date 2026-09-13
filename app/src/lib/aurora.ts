import type { Tool } from './tools'

/**
 * The shapes the light is made of.
 *
 * These were four stacked `radial-gradient`s, and the trouble with that is
 * visible the moment the five cards sit in a row: a radial gradient is an
 * ellipse, an ellipse blurred is still an ellipse, and every card was wearing
 * the same four of them with the anchors nudged sideways. The row read as one
 * pattern copied five times, because it was.
 *
 * What the reference actually has is curtains. The lit edge is not a dome, it
 * is a wavering crest with two or three peaks at different heights, troughs
 * between them, and no symmetry anywhere. So this generates that shape: a run
 * of control points across the card with jittered heights and jittered
 * spacing, smoothed through Catmull-Rom into one continuous curve, filled from
 * that curve down past the bottom edge. Blur it and you get light with a
 * silhouette instead of a blob.
 *
 * It is seeded and deterministic. Each tool passes its own seed, so its four
 * curtains are its own and nobody else's, and they are the same on every
 * render rather than shimmering on each paint.
 */

/** mulberry32: small, fast, and good enough for choosing where a crest sits */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The drawing space. 200 wide by 100 tall, stretched onto whatever the card is
 * by `preserveAspectRatio="none"`, so every number here is a percentage of the
 * card wearing it and the same curtain fits a 190px home card and a 100px menu
 * one. The curtains are drawn wider than the box on both sides and filled well
 * past the bottom: the parts outside are clipped, which is the point, since the
 * light is meant to have a source you cannot see.
 */
const W = 200
const H = 100
const BLEED = 26

/** how many curtains make up one card's light */
const LAYERS = 7

const FLOOR = H + BLEED * 2

/**
 * One curtain: a wavy crest, filled downward.
 *
 * `x0`/`x1` are where it starts and stops. A curtain that runs past both edges
 * of the card is a full-width one and its crest simply carries on off-stage; a
 * curtain that starts and stops inside the card has its two end points dropped
 * to the floor instead, so it rises out of the bottom, wanders, and dives back
 * under. That second kind is what the reference's hot spot actually is, and it
 * is the reason the bottom edge is not a uniform bright band: only the wide
 * curtains reach everywhere, and the bright ones are mounds sitting in one
 * place each.
 */
function curtain(
  seed: number,
  crest: number,
  amp: number,
  peaks: number,
  x0: number,
  x1: number,
): string {
  const rnd = rng(seed)
  const span = x1 - x0
  const step = span / peaks
  const local = x0 > -BLEED || x1 < W + BLEED

  const pts: Array<[number, number]> = []
  for (let i = 0; i <= peaks; i++) {
    // the interior points slide up to a third of a step either way, which is
    // what stops the peaks landing on a metronome
    const edge = i === 0 || i === peaks
    const x = x0 + step * i + (edge ? 0 : (rnd() - 0.5) * step * 0.66)
    // a local curtain is pinned to the floor at both ends so it tapers away
    // instead of stopping against a vertical cliff the blur cannot hide
    const y = edge && local ? FLOOR : crest + (rnd() - 0.5) * 2 * amp
    pts.push([x, y])
  }

  // Catmull-Rom through the points, emitted as cubic beziers. A spline rather
  // than quadratics through midpoints because the curve has to pass *through*
  // the crests: the whole shape is where its peaks are, and a curve that only
  // approaches them sands the character off.
  const n = pts.length
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2 < n ? i + 2 : n - 1]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(p2[0])} ${f(p2[1])}`
  }
  return `${d} L ${f(x1)} ${FLOOR} L ${f(x0)} ${FLOOR} Z`
}

const f = (n: number) => Math.round(n * 10) / 10

export interface Band {
  d: string
  /** "r, g, b" */
  color: string
  opacity: number
  /** how far this curtain climbs on hover, relative to the others */
  k: number
  /** how much this curtain opens out on hover, relative to the others */
  s: number
}

/** straight rgb lerp between two "r, g, b" strings */
function mix(a: string, b: string, t: number): string {
  const pa = a.split(',').map(Number)
  const pb = b.split(',').map(Number)
  return pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(', ')
}

/** the palette as one continuous run: 0 is the deep step, 1 is the hot core */
function ramp(tool: Tool, t: number): string {
  const { deep, mid, accent, core } = tool.aurora
  const stops = [deep, mid, accent, core]
  const x = Math.min(t, 0.999) * (stops.length - 1)
  const i = Math.floor(x)
  return mix(stops[i], stops[i + 1], x - i)
}

/**
 * A tool's curtains, back to front.
 *
 * There are seven and each is faint, where there were four and each was strong.
 * That is the difference between light that spreads and light that glows, and
 * it is worth being precise about why.
 *
 * A filled shape with a blurred edge has exactly one falloff, the blur's: it
 * goes from nothing to solid across about two sigma and then stops. Four of
 * those stacked gives four hard-ish steps, which is why the earlier version
 * read as sudden however much the blur went up, and turning the blur up far
 * enough to soften it flattened the wavy crest that was the point of drawing
 * shapes in the first place. The falloff and the silhouette were fighting over
 * one control. Seven faint curtains separate them: each keeps a crisp wavy
 * crest, and what climbs the card is the sum of seven of them crested a few
 * units apart, which is a long soft ramp.
 *
 * The other half of not glowing is that only the top three run the full width.
 * When every curtain spanned the card, every curtain reached the bottom edge,
 * so the bottom was the whole stack added up at every x: a uniform hot band
 * across all five cards, which is neither what the reference has nor
 * interesting. The lower four are mounds of between a half and nine tenths of
 * the card's width, placed by the tool's own seed, so each card's light has its
 * bright part somewhere of its own and the edge either side of it stays dim.
 *
 * The opacity ramp is deliberately flat, 12 to 18 percent. Steeper put almost
 * nothing above three quarters and a spike below it.
 *
 * `k` and `s` are what hover does, and both are graded so that hover spends
 * itself on the faint end of the stack.
 *
 * `k` is travel and `s` is how much the curtain opens out, and the deep, faint,
 * high curtains get nearly all of both while the bright mounds at the bottom
 * barely move. That grading is not a style choice, it is the only way the hover
 * can spread without becoming unreadable: scaling the whole stack evenly walks
 * the bright mounds up into the tagline, which measured at 1.5:1 against the
 * copy. Spreading the diffuse half instead makes the light reach visibly higher
 * and go softer doing it, which is what spreading looks like anyway, and leaves
 * the hot part sitting on the bottom edge where the source is.
 *
 * The two also make the hover a change of shape rather than of level: the
 * silhouette opens as it comes up instead of the whole picture sliding.
 */
export function auroraBands(tool: Tool): Band[] {
  const peaks = [3, 4, 3, 5, 4, 6, 5]
  const place = rng(tool.aurora.seed ^ 0x9e3779b9)
  return Array.from({ length: LAYERS }, (_, i) => {
    const t = i / (LAYERS - 1)
    let x0 = -BLEED
    let x1 = W + BLEED
    if (i >= 3) {
      // between half and nine tenths of the card, free to hang off either edge
      const w = W * (0.5 + place() * 0.4)
      x0 = -BLEED + place() * (W + BLEED * 2 - w)
      x1 = x0 + w
    }
    return {
      // crests run from just over half way down to past the bottom edge, and
      // wander less the lower they sit: a curtain at the very bottom is nearly
      // under the card and only its top few units ever show
      d: curtain(tool.aurora.seed + i * 37, 56 + 44 * t, 15 - 9 * t, peaks[i], x0, x1),
      color: ramp(tool, t),
      opacity: 0.12 + 0.06 * t,
      k: 1.4 - 0.9 * t,
      s: 1 - 0.85 * t,
    }
  })
}

/**
 * The blur, as an "x y" pair in user units of the 200x100 box, applied once to
 * the whole stack rather than per curtain.
 *
 * It is far wider than it is tall for the same reason the card is: a round blur
 * on a box this shape smears the crest upward, into the text, and sands off the
 * waviness. Blurring three times as hard sideways spreads each curtain along
 * the bottom edge, the direction it has room to go.
 *
 * The vertical figure is small on purpose now. It no longer has to soften the
 * falloff, since seven stacked curtains do that; all it has to do is take the
 * staircase off the gaps between them and keep the crests from looking cut out
 * of paper.
 */
export const AURORA_BLUR = '18 6'
