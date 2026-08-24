import { bezelFor } from './devices'
import type { ShotsDoc, ShotsImage } from './types'

/*
 * Layout presets, the arrangements you reach for rather than dial in.
 *
 * Two rules hold across all of them: every device is the **same size**, and the
 * gaps between them are **equal and tight**. That needs real measurement rather
 * than hand-picked offsets, because `offsetX` is a fraction of the frame while a
 * device's on-screen width depends on the frame's aspect and the device's own,
 * so the same offset that looks snug on a 4:3 canvas leaves a chasm on 16:9.
 * `measure()` works out how wide one device actually is in offset units, and the
 * arrangements step by that width plus a fixed gap.
 *
 * They are also all **flat**. Pseudo-3D tilt is a deliberate choice a person
 * makes on one shot, not something an arrangement should impose, so applying a
 * preset clears it, and the Tilt controls in the inspector stay the way to get
 * it back.
 *
 * Presets only ever touch placement. Device frame, media, shadow and finish on
 * each screen survive untouched, so trying arrangements never costs you the
 * styling you already settled.
 */

/** The placement half of a screen: what a preset is allowed to write. */
export interface Placement {
  scale: number
  offsetX: number
  offsetY: number
  rotate: number
  /** paint order, low to front; 0 leaves the screens stacked in authoring order */
  z: number
}

/** What the arrangements need to know about the frame they're filling. */
export interface LayoutContext {
  /** height / width of the padded content box */
  boxRatio: number
  /** width / height of one device card */
  deviceAspect: number
}

export interface LayoutPreset {
  id: string
  name: string
  /** screen counts this arrangement reads well at */
  counts: number[]
  build: (n: number, ctx: LayoutContext) => Placement[]
}

/** Gap between neighbours, as a fraction of the content box width. */
const GAP = 0.028

/**
 * How much of the content box an arrangement may span.
 *
 * Roomier as the screens multiply. One or two screens sit well inside the
 * frame on their own, but a four-up row fitted to the same 97% reads as
 * jammed against both edges long before it actually collides with anything,
 * because there is no longer any empty middle to relieve it. Holding four
 * back to 90% buys that margin, and the tighter `GAP` above hands most of it
 * straight back as size, so the screens end up no smaller for it.
 */
const marginFor = (n: number) => (n >= 4 ? 0.9 : 0.97)

interface Fit {
  /** how the row is shaped */
  gap?: number
  /**
   * Peak-to-peak vertical travel, as a fraction of box height. Only correct if
   * the arrangement's `offsetY` values are centred on zero, a preset that only
   * ever pushes downward reaches twice as far and will overflow.
   */
  vSpread?: number
  /** largest rotation any screen takes, in degrees */
  rotate?: number
  /** negative tucks neighbours behind each other; 0 places them edge to edge */
  overlap?: number
  /**
   * Neighbours all lean the same way, so they interleave.
   *
   * A leaning card's *bounding box* is far wider than the card, and spacing by
   * that box is what made Tilt and Fan drift apart: two phones at 7° were set
   * as far apart as two upright phones plus both their leaned-out corners,
   * even though those corners point in the same direction and never meet. The
   * true edge-to-edge pitch for parallel cards is the card's own width divided
   * by cos(angle), which is what this switches to. The end caps still reserve
   * the full bounding box, so nothing leaves the frame.
   */
  parallel?: boolean
  /**
   * How far the arrangement may breathe into the padding, as a multiplier on
   * the fitted scale.
   *
   * Padding is sized for one centred screen. Rotating a card costs height it
   * never gets back, so a tilted pair measured strictly against the padded box
   * lands visibly smaller than an upright pair at the same padding, which
   * reads as the preset being timid rather than as the padding doing its job.
   * Letting the leaned corners spill a little into the padding puts the two
   * back on equal footing.
   */
  fill?: number
}

/**
 * The largest common scale that keeps `n` screens inside the frame, and the
 * horizontal step between them.
 *
 * Width alone isn't enough. At one screen the card already fills the box on its
 * tight axis, so any arrangement that also moves screens *vertically* (Stagger,
 * Overlap, Fan) pushed them straight out through the bottom. Rotation costs
 * room on both axes too: a tall card leaning 9° is wider and taller than it
 * looks. Both are accounted for here, so no preset can overflow.
 */
function measure(n: number, ctx: LayoutContext, fit: Fit = {}) {
  const gap = fit.gap ?? GAP
  const vSpread = fit.vSpread ?? 0
  const overlap = fit.overlap ?? 0
  const fill = fit.fill ?? 1
  const th = ((fit.rotate ?? 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(th))
  const sin = Math.abs(Math.sin(th))

  const ratio = Math.max(0.0001, ctx.boxRatio * ctx.deviceAspect)
  // card size at scale 1, each axis as a fraction of the box on that axis
  const unitW = Math.min(1, ratio)
  const unitH = Math.min(1, 1 / ratio)
  // bounding box once leaned over
  const bw = unitW * cos + unitH * ctx.boxRatio * sin
  const bh = unitW * (sin / Math.max(0.0001, ctx.boxRatio)) + unitH * cos

  // how far neighbours sit apart before the gap, see `Fit.parallel`
  const pitch = fit.parallel ? unitW / Math.max(0.0001, cos) : bw
  const across = pitch * (1 + overlap)

  /*
   * The group spans one full bounding box for the end cap plus `n - 1` pitches,
   * so the caps are measured against what actually leaves the frame while the
   * middle is measured against what actually separates two cards.
   */
  const acrossFit = (1 - (n - 1) * gap) / Math.max(0.0001, bw + (n - 1) * across)
  const downFit = (1 - vSpread) / Math.max(0.0001, bh)
  /*
   * `fill` lifts the vertical fit and the overall cap but never the horizontal
   * one. The room a rotation costs is vertical, so that is the term worth
   * relaxing; widthwise the screens are genuinely competing for the same span,
   * and letting a four-up arrangement grow past it would push the outer two
   * off the frame rather than into the padding.
   */
  const margin = marginFor(n)
  const scale = Math.min(fill, acrossFit * margin, downFit * margin * fill)

  return { scale, step: across * scale + gap }
}

/** Centre a row of `n` items whose neighbours sit `step` apart. */
const centred = (i: number, n: number, step: number) => (i - (n - 1) / 2) * step

const place = (p: Partial<Placement>): Placement => ({
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotate: 0,
  z: 0,
  ...p,
})

export const LAYOUT_PRESETS: LayoutPreset[] = [
  // ----- single screen -----
  { id: 'center', name: 'Centred', counts: [1], build: () => [place({})] },
  {
    id: 'tilted',
    name: 'Tilted',
    counts: [1],
    build: (n, ctx) => [place({ rotate: -8, scale: measure(n, ctx, { rotate: 8 }).scale })],
  },
  {
    id: 'closeup',
    name: 'Close-up',
    counts: [1],
    /*
     * The one preset that means to overflow: a close-up crops on purpose.
     * It sits low so the crop lands on the bottom of the phone and the top
     * keeps a margin. Centred, it grazed both edges at once and read as a
     * framing mistake rather than as a deliberate crop.
     */
    build: () => [place({ scale: 1.32, offsetY: 0.18 })],
  },

  // ----- two or more -----
  {
    id: 'row',
    name: 'Row',
    counts: [2, 3, 4],
    build: (n, ctx) => {
      const { scale, step } = measure(n, ctx)
      return Array.from({ length: n }, (_, i) => place({ offsetX: centred(i, n, step), scale }))
    },
  },
  {
    id: 'stagger',
    name: 'Stagger',
    counts: [2, 3, 4],
    build: (n, ctx) => {
      const lift = 0.05
      const { scale, step } = measure(n, ctx, { vSpread: lift * 2 })
      return Array.from({ length: n }, (_, i) =>
        place({
          offsetX: centred(i, n, step),
          // every other one rides higher, which reads as rhythm rather than a queue
          offsetY: i % 2 === 0 ? -lift : lift,
          scale,
        }),
      )
    },
  },
  {
    id: 'tilt',
    name: 'Tilt',
    counts: [2, 3, 4],
    build: (n, ctx) => {
      const angle = 7
      /*
       * Up to three screens all lean the same way and nest at their true
       * edges. Four is where a uniform lean stops reading as a deliberate
       * tilt and starts reading as a row sliding off its feet, so the set
       * mirrors instead: each half leans in toward the middle, hardest at
       * the ends and barely at all beside the centre line.
       *
       * Still the parallel pitch. Only the innermost pair actually converges,
       * and only by `2 * angle / (n - 1)`, which the gap covers; every other
       * neighbour shares a sign and stays near enough to parallel.
       */
      const mirrored = n >= 4
      // the mirrored set also dips in the middle, the opposite of Fan's arc:
      // the pair either side of the centre line settles lower than the ends
      const dip = 0.07
      const { scale, step } = measure(n, ctx, {
        rotate: angle,
        parallel: true,
        gap: mirrored ? 0.015 : 0.025,
        vSpread: mirrored ? dip : 0,
        fill: 1.12,
      })
      return Array.from({ length: n }, (_, i) => {
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1 // -1…1
        return place({
          offsetX: centred(i, n, step),
          // centred on zero, so the dip costs half its travel each way
          offsetY: mirrored ? (0.5 - Math.abs(t)) * dip : 0,
          rotate: mirrored ? -t * angle : -angle,
          scale,
        })
      })
    },
  },
  {
    id: 'fan',
    name: 'Fan',
    counts: [2, 3, 4],
    build: (n, ctx) => {
      const angle = 9
      const arc = 0.045
      /*
       * A hero fan: the middle screen stands square at the front and the rest
       * lean away behind it, each tucked a fifth of a device under its inner
       * neighbour. Splayed cards take the parallel pitch, close enough at
       * these angles and forgiving besides, since they overlap by design.
       */
      const { scale, step } = measure(n, ctx, {
        rotate: angle,
        vSpread: arc,
        parallel: true,
        gap: 0,
        overlap: -0.2,
        fill: 1.12,
      })
      return Array.from({ length: n }, (_, i) => {
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1 // -1…1
        return place({
          offsetX: centred(i, n, step),
          // outer screens drop away, so the set arcs, centred on zero so the
          // arc costs half its travel above and half below
          offsetY: (Math.abs(t) - 0.5) * arc,
          rotate: t * angle,
          scale,
          // nearer the middle sits nearer the front, so the fan reads as depth
          // rather than as a row that happens to overlap left to right
          z: -Math.abs(t),
        })
      })
    },
  },
  {
    id: 'overlap',
    name: 'Overlap',
    counts: [2, 3, 4],
    build: (n, ctx) => {
      const drop = 0.03
      // neighbours tuck behind by a fifth of a device: enough to read as a
      // stack, little enough that each screen still shows its own content
      const { scale, step } = measure(n, ctx, {
        gap: 0,
        overlap: -0.2,
        vSpread: drop * (n - 1),
      })
      return Array.from({ length: n }, (_, i) =>
        place({ offsetX: centred(i, n, step), offsetY: centred(i, n, drop), scale }),
      )
    },
  },
]

export function presetsForCount(n: number): LayoutPreset[] {
  return LAYOUT_PRESETS.filter((p) => p.counts.includes(n))
}

export function getLayoutPreset(id: string): LayoutPreset | null {
  return LAYOUT_PRESETS.find((p) => p.id === id) ?? null
}

/**
 * Measure the frame the arrangement has to fill. Padding and device come from
 * the first screen: presets keep every screen the same size, so one is
 * representative, and reading the live doc means the spacing stays right when
 * the canvas is resized or the device swapped.
 */
export function layoutContext(doc: ShotsDoc): LayoutContext {
  const first = doc.images[0]
  const pad = (first?.padding ?? 0.12) * Math.min(doc.size.width, doc.size.height)
  const boxW = Math.max(1, doc.size.width - 2 * pad)
  const boxH = Math.max(1, doc.size.height - 2 * pad)

  const bezel = first ? bezelFor(first.device) : null
  const meta = first ? doc.assets.find((a) => a.id === first.assetId) : undefined
  const deviceAspect = bezel
    ? bezel.frame.w / bezel.frame.h
    : meta
      ? meta.w / Math.max(1, meta.h)
      : 0.5

  return { boxRatio: boxH / boxW, deviceAspect }
}

/** Write a preset's placement onto the screens, leaving everything else alone. */
export function applyPlacements(images: ShotsImage[], placements: Placement[]) {
  images.forEach((im, i) => {
    const p = placements[i]
    if (!p) return
    im.scale = p.scale
    im.offsetX = p.offsetX
    im.offsetY = p.offsetY
    im.rotate = p.rotate
    // always written, so switching off an arrangement that restacked the
    // screens puts them back in authoring order instead of leaving its depth
    im.z = p.z
    // arrangements are flat; tilt stays something you reach for by hand
    im.style3d = false
    im.rotateX = 0
    im.rotateY = 0
  })
}

/** Arrange a doc's screens with a preset, measuring its own frame. */
export function applyLayoutToDoc(doc: ShotsDoc, presetId: string) {
  const preset = getLayoutPreset(presetId) ?? getLayoutPreset('row')
  if (!preset) return
  applyPlacements(doc.images, preset.build(doc.images.length, layoutContext(doc)))
}
