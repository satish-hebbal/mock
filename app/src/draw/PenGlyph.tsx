/**
 * The pens, standing in the tray.
 *
 * "Inspired by Apple's markup tools, and how far they take the skeuomorphism.
 * Pens in a tray beat a row of icons."
 *
 * The single most important thing about that sentence is the word *tray*. These
 * are not icons of pens, they are pens in a cup: the writing tip points up at
 * the canvas, the barrel runs down past the bottom edge of the bar and is
 * simply cut off by it. Nothing draws the bottom of a pen because in a real
 * tray you cannot see it. That is why the artwork is 92 units tall inside a bar
 * only 84 high, and why the bar clips its own contents.
 *
 * It also settles which way up they go. An earlier pass had them hanging
 * tip-downward like icons on a shelf, which reads as a row of pictures of pens;
 * turned the right way up they read as pens you could pick, and the selected
 * one rising out of the tray becomes obvious rather than decorative.
 *
 * Eight bespoke drawings would be eight things to keep in sync, so there is one
 * parametric pen: a barrel, a collar, and one of five tips. The difference
 * between a fineliner and a marker really is just proportions.
 */

export type TipKind = 'cone' | 'chisel' | 'bristle' | 'nib' | 'block'

/** The artwork's own coordinate system. Wider than the 38px it renders at. */
const W = 38
const CX = W / 2
const H = 92

interface Shape {
  /** barrel half-width */
  half: number
  tip: TipKind
  /** where the barrel proper starts, below the tip and collar */
  shoulder: number
  /** the barrel is see-through, for the highlighter */
  translucent?: boolean
}

const SHAPES: Record<string, Shape> = {
  pencil: { half: 6.4, tip: 'cone', shoulder: 28 },
  pen: { half: 6.2, tip: 'cone', shoulder: 27 },
  fineliner: { half: 5.2, tip: 'cone', shoulder: 26 },
  marker: { half: 9, tip: 'chisel', shoulder: 30 },
  highlighter: { half: 10.4, tip: 'chisel', shoulder: 28, translucent: true },
  brush: { half: 6.6, tip: 'bristle', shoulder: 36 },
  fountain: { half: 7.4, tip: 'nib', shoulder: 30 },
  eraser: { half: 9.6, tip: 'block', shoulder: 42 },
}

const WOOD = '#e8d3a9'
const METAL = '#c3c8d1'
const METAL_DARK = '#9aa1ac'

/**
 * The business end, in the ink colour.
 *
 * Carrying the ink here rather than on a separate swatch is what lets the tray
 * answer "what colour am I holding" at a glance: you look at the pen, the same
 * way you would in a real cup of pens.
 */
function Tip({ id, shape, ink }: { id: string; shape: Shape; ink: string }) {
  const { half, tip, shoulder } = shape

  if (tip === 'cone') {
    const nose = id === 'pencil' ? 7 : id === 'fineliner' ? 10 : 9
    const noseHalf = id === 'fineliner' ? 1.7 : 2.2
    return (
      <>
        {/* the sharpened cone: bare wood on a pencil, a metal collar otherwise */}
        <path
          d={`M${CX - noseHalf} ${nose}L${CX + noseHalf} ${nose}L${CX + half} ${shoulder}L${CX - half} ${shoulder}Z`}
          fill={id === 'pencil' ? WOOD : METAL}
        />
        {/* the point itself */}
        <path d={`M${CX} 0L${CX + noseHalf} ${nose}L${CX - noseHalf} ${nose}Z`} fill={ink} />
      </>
    )
  }

  if (tip === 'chisel') {
    const t = half * 0.74
    return (
      <>
        {/*
         * A chisel tip is cut at an angle, so the wedge is a slanted quad
         * rather than a symmetrical cone. It is the silhouette that says
         * "marker" before any colour does.
         */}
        <path d={`M${CX - t} 3L${CX + t} 9L${CX + half} ${shoulder}L${CX - half} ${shoulder}Z`} fill={ink} />
        <path d={`M${CX - half} ${shoulder}L${CX + half} ${shoulder}L${CX + half} ${shoulder + 5}L${CX - half} ${shoulder + 5}Z`} fill={METAL_DARK} opacity={0.5} />
      </>
    )
  }

  if (tip === 'bristle') {
    return (
      <>
        {/* the bundle, coming to a point the way a loaded brush does */}
        <path
          d={`M${CX} 0C${CX + 2.2} 6,${CX + half * 0.82} 16,${CX + half * 0.9} ${shoulder - 8}L${CX - half * 0.9} ${shoulder - 8}C${CX - half * 0.82} 16,${CX - 2.2} 6,${CX} 0Z`}
          fill={ink}
        />
        {/* the ferrule: the crimped metal band that is most of a brush's look */}
        <rect x={CX - half} y={shoulder - 9} width={half * 2} height={11} rx={1.5} fill={METAL} />
        <rect x={CX - half} y={shoulder - 5.5} width={half * 2} height={1.4} fill={METAL_DARK} opacity={0.55} />
      </>
    )
  }

  if (tip === 'nib') {
    return (
      <>
        {/* the nib, and the slit and breather hole that are the whole of a nib */}
        <path d={`M${CX} 0L${CX + half * 0.92} ${shoulder - 6}L${CX - half * 0.92} ${shoulder - 6}Z`} fill="#d9c26a" />
        <path d={`M${CX} 4.5L${CX} ${shoulder - 13}`} stroke={ink} strokeWidth={1.3} strokeLinecap="round" />
        <circle cx={CX} cy={shoulder - 11} r={2} fill={ink} />
        <rect x={CX - half} y={shoulder - 7} width={half * 2} height={8} rx={1.5} fill={METAL} />
      </>
    )
  }

  // block: the eraser is all tip
  return <rect x={CX - half} y={0} width={half * 2} height={shoulder} rx={4} fill={ink} />
}

export function PenGlyph({
  spec,
  ink,
  height = H,
  gauge,
  studio = true,
}: {
  /** the eraser comes through here too, so this is deliberately not PenSpec */
  spec: { id: string; barrel: [string, string] }
  ink: string
  height?: number
  /** the current barrel size, printed down the body */
  gauge?: number
  /** lit as an object rather than shaded flat: Drawesome's look="studio" */
  studio?: boolean
}) {
  const shape = SHAPES[spec.id] ?? SHAPES.pen
  const [body, accent] = spec.barrel
  const { half, shoulder } = shape
  const uid = `pen-${spec.id}`

  return (
    <svg
      width={(height * W) / H}
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      fill="none"
      aria-hidden
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        {/*
         * A cylinder is dark at both edges and bright about a third of the way
         * across, never a simple left-to-right ramp. Getting that one stop
         * right is the difference between a pen and a coloured rectangle.
         */}
        <linearGradient id={`${uid}-round`} x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#000" stopOpacity="0.34" />
          <stop offset="0.32" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="0.66" stopColor="#000" stopOpacity="0.06" />
          <stop offset="1" stopColor="#000" stopOpacity="0.42" />
        </linearGradient>
      </defs>

      {/* the barrel, running off the bottom of the artwork on purpose */}
      <rect
        x={CX - half}
        y={shoulder}
        width={half * 2}
        height={H - shoulder}
        fill={body}
        opacity={shape.translucent ? 0.85 : 1}
      />

      {/* the collar, the one place the accent colour shows */}
      <rect x={CX - half} y={shoulder} width={half * 2} height={6} fill={accent} />

      <Tip id={spec.id} shape={shape} ink={ink} />

      {/* a pencil is hexagonal, and two facet lines are all it takes to say so */}
      {spec.id === 'pencil' && (
        <>
          <path d={`M${CX - half / 3} ${shoulder}V${H}`} stroke="#000" strokeOpacity={0.14} strokeWidth={1} />
          <path d={`M${CX + half / 3} ${shoulder}V${H}`} stroke="#000" strokeOpacity={0.14} strokeWidth={1} />
        </>
      )}

      {studio && (
        <rect
          x={CX - half}
          y={shoulder}
          width={half * 2}
          height={H - shoulder}
          fill={`url(#${uid}-round)`}
        />
      )}

      {gauge !== undefined && (
        <text
          x={CX}
          y={shoulder + 20}
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          fill="#fff"
          fillOpacity="0.85"
          style={{ letterSpacing: '-0.4px' }}
        >
          {Math.round(gauge)}
        </text>
      )}
    </svg>
  )
}
