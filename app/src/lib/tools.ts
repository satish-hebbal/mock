import type { CSSProperties } from 'react'
import { Boxes, Grid3x3, Image as ImageIcon, PenLine, Waves, type LucideIcon } from 'lucide-react'
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
 * are deliberately not the same across the five: five cards each lit from dead
 * centre is a row of five identical lamps, and the reference glow is off-centre
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
    tagline: 'Put a screen on a 3D device, light it, and export a video.',
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
    tagline: 'Frame screens on a backdrop worth posting, in seconds.',
    icon: ImageIcon,
    tint: ['224, 138, 62', '236, 186, 96'],
    // the only warm card in the row: rose under amber, gold breaking right
    aurora: {
      deep: '198, 58, 112',
      mid: '232, 124, 60',
      accent: '250, 196, 88',
      core: '255, 230, 196',
      seed: 3391,
      at: [34, 80],
    },
  },
  {
    id: 'draw',
    name: 'Draw',
    tagline: 'A hand-drawn whiteboard, and a tray of pens that behave like pens.',
    icon: PenLine,
    tint: ['64, 176, 140', '96, 200, 176'],
    // deep teal into emerald, with lime as the break. The one green in five
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
    tagline: 'Redraw a picture as characters, tiles or dither, and keep the text.',
    icon: Grid3x3,
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
    tagline: 'Dithered motion out of nothing. Take it away as a loop.',
    icon: Waves,
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
