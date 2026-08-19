import { bezelFor } from './devices'
import type { ShotsDoc, ShotsImage } from './types'

/*
 * Layout presets — the arrangements you reach for rather than dial in.
 *
 * Two rules hold across all of them: every device is the **same size**, and the
 * gaps between them are **equal and tight**. That needs real measurement rather
 * than hand-picked offsets, because `offsetX` is a fraction of the frame while a
 * device's on-screen width depends on the frame's aspect and the device's own —
 * so the same offset that looks snug on a 4:3 canvas leaves a chasm on 16:9.
 * `measure()` works out how wide one device actually is in offset units, and the
 * arrangements step by that width plus a fixed gap.
 *
 * They are also all **flat**. Pseudo-3D tilt is a deliberate choice a person
 * makes on one shot, not something an arrangement should impose — so applying a
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
const GAP = 0.035

/** Never let an arrangement touch the padding edge. */
const MARGIN = 0.97

interface Fit {
  /** how the row is shaped */
  gap?: number
  /**
   * Peak-to-peak vertical travel, as a fraction of box height. Only correct if
   * the arrangement's `offsetY` values are centred on zero — a preset that only
   * ever pushes downward reaches twice as far and will overflow.
   */
  vSpread?: number
  /** largest rotation any screen takes, in degrees */
  rotate?: number
  /** negative tucks neighbours behind each other; 0 places them edge to edge */
  overlap?: number
}

/**
 * The largest common scale that keeps `n` screens inside the frame, and the
 * horizontal step between them.
 *
 * Width alone isn't enough. At one screen the card already fills the box on its
 * tight axis, so any arrangement that also moves screens *vertically* — Stagger,
 * Overlap, Fan — pushed them straight out through the bottom. Rotation costs
 * room on both axes too: a tall card leaning 9° is wider and taller than it
 * looks. Both are accounted for here, so no preset can overflow.
 */
function measure(n: number, ctx: LayoutContext, fit: Fit = {}) {
  const gap = fit.gap ?? GAP
  const vSpread = fit.vSpread ?? 0
  const overlap = fit.overlap ?? 0
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

  const stepFactor = 1 + overlap
  const acrossFit =
    (1 - (n - 1) * gap) / Math.max(0.0001, bw * (1 + (n - 1) * stepFactor))
  const downFit = (1 - vSpread) / Math.max(0.0001, bh)
  const scale = Math.min(1, acrossFit * MARGIN, downFit * MARGIN)

  return { scale, step: bw * scale * stepFactor + gap }
}

/** Centre a row of `n` items whose neighbours sit `step` apart. */
const centred = (i: number, n: number, step: number) => (i - (n - 1) / 2) * step

const place = (p: Partial<Placement>): Placement => ({
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotate: 0,
  ...p,
})

export const LAYOUT_PRESETS: LayoutPreset[] = [
  // ————— single screen —————
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
    // the one preset that means to overflow — a close-up crops on purpose
    build: () => [place({ scale: 1.32, offsetY: 0.1 })],
  },

  // ————— two or more —————
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
      const { scale, step } = measure(n, ctx, { rotate: angle })
      return Array.from({ length: n }, (_, i) =>
        place({ offsetX: centred(i, n, step), rotate: -angle, scale }),
      )
    },
  },
  {
    id: 'fan',
    name: 'Fan',
    counts: [2, 3, 4],
    build: (n, ctx) => {
      const angle = 9
      const arc = 0.045
      const { scale, step } = measure(n, ctx, { rotate: angle, vSpread: arc })
      return Array.from({ length: n }, (_, i) => {
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1 // -1…1
        return place({
          offsetX: centred(i, n, step),
          // outer screens drop away, so the set arcs — centred on zero so the
          // arc costs half its travel above and half below
          offsetY: (Math.abs(t) - 0.5) * arc,
          rotate: t * angle,
          scale,
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
      // neighbours tuck behind by about a third of a device
      const { scale, step } = measure(n, ctx, {
        gap: 0,
        overlap: -0.34,
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
 * the first screen — presets keep every screen the same size, so one is
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
