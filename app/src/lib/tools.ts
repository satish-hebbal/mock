import type { CSSProperties } from 'react'
import {
  Boxes,
  Grid3x3,
  Image as ImageIcon,
  PenLine,
  ReceiptText,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import type { AppMode } from '../store'

/**
 * The tools, in one place.
 *
 * The app menu and the home screen both list them, and their copy had already
 * drifted apart, the same tool described two different ways depending on where
 * you read it.
 *
 * Each carries a `tint` for its glyph and an `aurora` for its card. The tint is
 * two UI accents picked to sit on a panel and clear contrast as ink; the aurora
 * is four artwork colours that are never used as ink and so are free to be as
 * saturated as they like.
 */
export interface Tool {
  /** where picking it takes you; 'home' for the ones that aren't built yet */
  id: AppMode
  name: string
  tagline: string
  icon: LucideIcon
  soon?: boolean
  /** usable, but still settling */
  beta?: boolean
  /** [near, far] glyph colours */
  tint: [string, string]
  aurora: Aurora
}

/**
 * The light under a card.
 *
 * Read off the reference: the glow is not one colour fading up, it is a hue
 * *travelling* over about four stops as it climbs out of the bottom edge, with
 * the hottest, palest part nearest the edge and the deepest, most saturated
 * part thrown furthest up and to one side. That is what keeps it from reading
 * as a gradient. Four named stops is the smallest set that reproduces it:
 *
 *   core    the near-white hot spot sitting on the bottom edge. Pale, barely
 *           the hue at all, and small.
 *   accent  the lobe that breaks the symmetry. It is a different hue from the
 *           card's own, put on the opposite side from the core, and it is the
 *           single thing doing most of the work: without it the glow is a
 *           lamp, with it the glow is weather.
 *   mid     the card's identity colour, the widest visible mass.
 *   deep    the darkest, most saturated step, thrown widest and highest so it
 *           is what the black at the top of the card fades into.
 *
 * `at` is where the core and the accent sit horizontally, as percentages. They
 * are deliberately not the same across the six: six cards each lit from dead
 * centre is a row of six identical lamps, and the reference glow is off-centre
 * in a way you notice before you can say why. The pairs below alternate sides
 * down the row so no two neighbours lean the same way.
 */
export interface Aurora {
  deep: string
  mid: string
  accent: string
  core: string
  /** [core x%, accent x%], for the parts still drawn in CSS */
  at: [number, number]
  /** picks this tool's curtains; see `aurora.ts` */
  seed: number
}

export const TOOLS: Tool[] = [
  {
    id: 'studio',
    name: '3D Studio',
    tagline: 'Film a screen in 3D.',
    icon: Boxes,
    tint: ['94, 106, 210', '130, 143, 255'],
    // indigo climbing into periwinkle, cut by a cyan lobe on the left
    aurora: {
      deep: '76, 62, 214',
      mid: '108, 126, 255',
      accent: '64, 196, 255',
      core: '206, 222, 255',
      seed: 1204,
      at: [64, 18],
    },
  },
  {
    id: 'shots',
    name: 'Shots',
    tagline: 'Screens on a backdrop.',
    icon: ImageIcon,
    tint: ['224, 138, 62', '236, 186, 96'],
    // the one warm card: burnt orange under amber, gold breaking right. The
    // deep used to be rose, which is Invoice's hue now; see its note
    aurora: {
      deep: '196, 76, 34',
      mid: '238, 140, 52',
      accent: '250, 196, 88',
      core: '255, 230, 196',
      seed: 3391,
      at: [34, 80],
    },
  },
  {
    id: 'draw',
    name: 'Draw',
    tagline: 'A whiteboard with pens.',
    icon: PenLine,
    tint: ['64, 176, 140', '96, 200, 176'],
    // deep teal into emerald, with lime as the break. The one green in six
    aurora: {
      deep: '22, 118, 160',
      mid: '40, 180, 148',
      accent: '154, 224, 118',
      core: '206, 250, 226',
      seed: 7718,
      at: [72, 26],
    },
  },
  {
    id: 'ascii',
    name: 'ASCII',
    tagline: 'Images as text or dither.',
    icon: Grid3x3,
    beta: true,
    tint: ['158, 118, 226', '196, 150, 244'],
    // violet-blue into orchid, magenta thrown hard right
    aurora: {
      deep: '98, 64, 216',
      mid: '168, 104, 240',
      accent: '238, 112, 186',
      core: '234, 214, 255',
      seed: 5063,
      at: [46, 88],
    },
  },
  {
    id: 'signal',
    name: 'Signal',
    tagline: 'Dithered motion loops.',
    icon: Waves,
    beta: true,
    tint: ['58, 168, 208', '110, 208, 236'],
    // cobalt into cyan, landing on aqua green. Next to Studio's indigo it needs
    // the green end to stay a separate card rather than a second blue one
    aurora: {
      deep: '34, 96, 214',
      mid: '48, 172, 220',
      accent: '88, 228, 186',
      core: '202, 242, 255',
      seed: 9142,
      at: [56, 14],
    },
  },
  {
    id: 'invoice',
    name: 'Invoice',
    tagline: 'Invoices, ready to send.',
    icon: ReceiptText,
    beta: true,
    tint: ['212, 78, 140', '240, 132, 184'],
    /*
     * Rose, because it is the one stretch of the wheel nobody else is on.
     *
     * It used to be red clay, and red clay is ten degrees from Shots' orange:
     * two places apart in the row they still read as the same card. Read round
     * the wheel the other five sit at amber, teal, cyan, indigo and violet,
     * which leaves the gap between violet and amber, and rose lands in the
     * middle of it, clear of both.
     *
     * ASCII throws a magenta accent, so this one keeps its break close in hue
     * (a paler pink rather than a second colour) and reads as one pigment at
     * two strengths, a plum deep under a rose mid. That also keeps it from
     * travelling the way Shots does, which is a difference that survives at
     * thumbnail size where hue alone would not.
     */
    aurora: {
      deep: '118, 26, 92',
      mid: '222, 70, 136',
      accent: '248, 146, 176',
      core: '255, 222, 236',
      seed: 6427,
      at: [28, 72],
    },
  },
]

/**
 * The card's own colours, handed to CSS as custom properties.
 *
 * Everything a tool card paints lives in the stylesheet, because the two things
 * that change it, hover and the theme, are both things a stylesheet knows and a
 * component does not. A stylesheet cannot reach into `TOOLS` for a colour,
 * though, so this passes them down to meet it and the geometry stays in one
 * place in `index.css` instead of being rebuilt as a string per card.
 *
 * Both ends of the tint travel, because the two grounds want opposite ones. On
 * the near-black canvas the icon takes the far tint, which is the light step and
 * clears 7:1 against it; on the light theme it takes the near tint darkened,
 * because the far one is a highlight colour and all but disappears on white.
 * The stylesheet picks between them, so neither file has to know the theme.
 */
export function toolTint(tool: Tool): CSSProperties {
  const { deep, mid, accent, core, at } = tool.aurora
  return {
    '--tool-tint': tool.tint[0],
    '--tool-tint-far': tool.tint[1],
    '--au-deep': deep,
    '--au-mid': mid,
    '--au-accent': accent,
    '--au-core': core,
    '--au-x': `${at[0]}%`,
    '--au-x2': `${at[1]}%`,
  } as CSSProperties
}

/**
 * How far up the glow is turned at rest, and how far below the card it sits.
 *
 * One number drives the whole card: every layer of the aurora, the lit bottom
 * edge, and the hairline round the outside all read their strength off `level`.
 * That is what makes hover a single line in the stylesheet rather than a second
 * copy of the background, and it is why the property is registered in
 * `index.css`, since a registered number is a number CSS can interpolate and an
 * unregistered one snaps.
 *
 * It is set as `--glow-rest` rather than `--glow` for a mundane but load-bearing
 * reason: an inline style beats any stylesheet rule no matter how specific, so a
 * card that named `--glow` itself could never be hovered. The stylesheet reads
 * this, and hover overrides the thing it read into.
 *
 *   1     the tool you are currently in
 *   0.62  a card on the home screen
 *   0.5   the same card in the app menu, which is half the height
 *   ~0.25 a tool that isn't built yet, lit enough to have a colour and not
 *         enough to look available
 *
 * `drop` is the other half of fitting a short card, and it is the half that
 * matters: the menu card's tagline runs to nearly nine tenths of its height
 * where the home card's stops at three quarters, so the glow has to move down
 * rather than only turn down. Sinking it keeps the lit bottom edge, which is
 * the part you actually recognise the card by, and hands the copy back a dark
 * ground to sit on.
 */
export function toolGlow(level: number, drop = 0): CSSProperties {
  return { '--glow-rest': level, '--au-drop': `${drop}%` } as CSSProperties
}
