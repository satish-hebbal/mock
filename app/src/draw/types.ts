/**
 * The drawing model.
 *
 * Two traditions meet in this tool and the model has to hold both. Excalidraw
 * thinks in *elements*: a rectangle is a rectangle, you select it, move it,
 * restyle it, and it redraws itself hand-drawn each time. Drawesome thinks in
 * *strokes*: what the nib laid down is what you have, and the eraser takes away
 * area rather than objects.
 *
 * So both live here as members of one union. Shapes carry the style knobs the
 * properties panel edits; freehand carries the pen it was drawn with and the
 * pressure at every sample, because a stroke's width is a fact about the
 * gesture and cannot be recovered later. The eraser is an element too: it has
 * to be, if erasing is to be undoable, re-orderable and exportable rather than
 * a destructive paint onto a bitmap.
 */

/** Everything the toolbar can put in your hand. */
export type DrawTool =
  | 'hand'
  | 'select'
  | 'rect'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'image'
  | 'eraser'

/** The seven pens in the tray. */
export type PenId = 'pencil' | 'pen' | 'fineliner' | 'marker' | 'highlighter' | 'brush' | 'fountain'

/** How a closed shape is filled in. Excalidraw's set. */
export type FillStyle = 'hachure' | 'cross-hatch' | 'solid'

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'

/** Excalidraw calls this Sloppiness; roughjs calls it roughness. 0/1/2. */
export type Sloppiness = 0 | 1 | 2

export type Edges = 'sharp' | 'round'

export type Arrowhead = 'none' | 'arrow' | 'triangle' | 'dot'

export type FontFamily = 'hand' | 'normal' | 'code'

export type TextAlign = 'left' | 'center' | 'right'

/**
 * The style knobs shared by every element, and the shape of the "current
 * settings" the properties panel edits. A new element is born holding a copy,
 * which is why changing the panel with nothing selected changes what you draw
 * next rather than nothing at all.
 */
export interface DrawStyle {
  stroke: string
  /** a fill, or 'transparent' */
  fill: string
  fillStyle: FillStyle
  strokeWidth: number
  strokeStyle: StrokeStyle
  sloppiness: Sloppiness
  edges: Edges
  /** 0..1 */
  opacity: number
  fontSize: number
  fontFamily: FontFamily
  textAlign: TextAlign
  startArrow: Arrowhead
  endArrow: Arrowhead
}

interface ElementBase extends DrawStyle {
  id: string
  /**
   * Fixes this element's randomness. Roughness is generated, not stored, so
   * without a stable seed every repaint would redraw the same rectangle with a
   * different wobble and the whole canvas would boil while you panned it.
   */
  seed: number
  /** scene-space top-left of the element's box */
  x: number
  y: number
  w: number
  h: number
  /** radians, about the box centre */
  angle: number
  /** bumped on every geometric edit, so the geometry cache knows to re-generate */
  version: number
  locked?: boolean
}

export interface ShapeElement extends ElementBase {
  kind: 'rect' | 'diamond' | 'ellipse'
}

/**
 * Arrows and lines. Points are relative to (x, y) so moving the element is a
 * two-number edit rather than a walk over the path.
 */
export interface LinearElement extends ElementBase {
  kind: 'arrow' | 'line'
  points: [number, number][]
}

/**
 * A pen stroke. `points` are [dx, dy, pressure, t]: position relative to the
 * element origin, the pressure the device reported (or 0.5 where it reports
 * none), and the timestamp, which is what lets a pen thin out with speed on
 * a mouse that has no pressure to give.
 */
export interface FreedrawElement extends ElementBase {
  kind: 'freedraw'
  pen: PenId
  points: [number, number, number, number][]
  /** the barrel size the pen was held at, in scene units */
  size: number
}

/**
 * An erase. Geometrically it is a freehand stroke; it differs only in being
 * composited destination-out against the ink beneath it, which is what makes
 * it take away area rather than whole strokes.
 */
export interface EraserElement extends ElementBase {
  kind: 'erase'
  points: [number, number, number, number][]
  size: number
}

export interface TextElement extends ElementBase {
  kind: 'text'
  text: string
}

export interface ImageElement extends ElementBase {
  kind: 'image'
  assetId: string
  /** natural aspect, kept so a fresh drop lands undistorted */
  ratio: number
}

export type DrawElement =
  | ShapeElement
  | LinearElement
  | FreedrawElement
  | EraserElement
  | TextElement
  | ImageElement

export type ElementKind = DrawElement['kind']

/** Ruled, dotted, or nothing. */
export type GridStyle = 'off' | 'lines' | 'dots'

/** The saved document. */
export interface DrawDoc {
  version: 1
  elements: DrawElement[]
  /** a CSS colour, 'transparent', or 'checker' */
  background: string
  /** the faint grid under the drawing */
  grid: GridStyle
}

/** Where we are looking. Screen = (scene + scroll) * zoom. */
export interface Viewport {
  scrollX: number
  scrollY: number
  zoom: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 30

/*
 * ----- Palettes -----
 * Excalidraw's own five-up rows, which are chosen to stay legible on both the
 * white board and a dark one, plus Drawesome's wider tray palette for the pens.
 */

export const STROKE_SWATCHES = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00']

export const FILL_SWATCHES = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99']

/*
 * ----- what you draw on -----
 *
 * Two families, because they are two different things rather than a dozen
 * shades of one. Paper is a sheet you put dark ink on; a board is a surface you
 * put chalk on. Which you are on decides the neutral ink, the grid colour and
 * the whole feel of the tool, so the picker says so out loud instead of leaving
 * you to work out why the pen went white.
 *
 * The paper row deliberately runs past the near-whites into toned stock. Five
 * shades of almost-white is five ways of saying the same thing; manila, aged
 * and parchment are the point at which choosing a paper starts to change what
 * the drawing feels like, which is the only reason to offer the choice.
 */
export const PAPER_SWATCHES = [
  '#ffffff',
  '#f8f9fa',
  '#f5faff',
  '#fffce8',
  '#f2e9d6',
  '#e8dcc0',
  '#dcc9a0',
  '#e3ded4',
]

/**
 * The dark end.
 *
 * Blackboard and slate first, because those are the ones people reach for. Then
 * blueprint, which is the one dark ground that is genuinely a drawing
 * convention rather than a dark theme. Then a real chalkboard green: not a
 * saturated green but the desaturated slate-green a school board actually is,
 * which is what stops it reading as a lime rectangle. The last two are dark
 * paper rather than board — kraft and sepia — for anyone who wants a dark sheet
 * without the classroom. Ink and grid follow all of them automatically.
 */
export const BOARD_SWATCHES = ['#14161a', '#23262b', '#122536', '#35503f', '#2b2320', '#3b3128']

/**
 * What each sheet is called.
 *
 * A tooltip reading "#dcc9a0" tells you nothing you cannot already see; the
 * name is the part that is worth knowing, and it is how anyone would describe
 * the one they want out loud.
 */
export const SHEET_NAMES: Record<string, string> = {
  '#ffffff': 'White',
  '#f8f9fa': 'Bright white',
  '#f5faff': 'Cool white',
  '#fffce8': 'Cream',
  '#f2e9d6': 'Manila',
  '#e8dcc0': 'Aged',
  '#dcc9a0': 'Parchment',
  '#e3ded4': 'Dusty',
  '#14161a': 'Blackboard',
  '#23262b': 'Slate',
  '#122536': 'Blueprint',
  '#35503f': 'Chalkboard',
  '#2b2320': 'Dark kraft',
  '#3b3128': 'Sepia',
}

/** Both families, for anything that just wants the whole set. */
export const CANVAS_SWATCHES = [...PAPER_SWATCHES, ...BOARD_SWATCHES]

/**
 * The tray palette. Drawesome ships eighteen and clamps a custom set to what
 * the bar can hold; this is the same count, laid out as three rows of six so
 * the palette state of the tray is close to the footprint of the row of pens
 * it replaces.
 */
export const INK_SWATCHES = [
  '#1e1e1e',
  '#495057',
  '#868e96',
  '#e03131',
  '#c2255c',
  '#9c36b5',
  '#6741d9',
  '#3b5bdb',
  '#1971c2',
  '#0c8599',
  '#099268',
  '#2f9e44',
  '#66a80f',
  '#f08c00',
  '#e8590c',
  '#d9480f',
  '#a61e4d',
  '#ffffff',
]

/** Stroke widths, Excalidraw's thin / bold / extra bold. */
export const STROKE_WIDTHS = [1, 2, 4]

/** Text sizes, Excalidraw's S / M / L / XL. */
export const FONT_SIZES = [16, 20, 28, 36]

export const FONT_STACKS: Record<FontFamily, string> = {
  /*
   * Excalidraw ships Virgil, a hand-drawn face, and the whole look leans on it.
   * We can't ship a font we don't have a licence to, so this reaches for the
   * handwriting faces that are actually installed: Segoe Print on Windows, then
   * the Comic faces, then whatever the system calls cursive. It is not Virgil,
   * but it is hand-drawn, which is the part that matters next to a wobbly box.
   */
  hand: '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Comic Neue", cursive',
  normal: 'var(--font-text), system-ui, sans-serif',
  code: 'var(--font-mono), ui-monospace, monospace',
}

/*
 * ----- Ink that can be seen -----
 *
 * A drawing tool that defaults to near-black ink is a drawing tool that hands
 * you an invisible pen the moment the paper is dark, and "why is nothing
 * happening" is a terrible first thirty seconds. So the neutral ink is a
 * function of what is actually behind the drawing rather than a constant.
 *
 * Only the *neutrals* move. Once you have picked red, red is what you get on
 * any paper, because at that point the colour is a decision rather than a
 * default, and second-guessing it would be worse than the problem.
 */

/** Near-black for pale paper. Matches Excalidraw's default stroke. */
export const INK_DARK = '#1e1e1e'
/** Near-white for dark paper. The bar's own ink colour. */
export const INK_LIGHT = '#f4f3f1'

/** Perceived lightness, 0..1. */
export function lightness(hex: string): number {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 1
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  // Rec. 601 luma: close enough for "is this dark", and cheap
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255
}

/**
 * Is the surface under the drawing dark?
 *
 * 'transparent' and 'checker' have no colour of their own: what shows through
 * is the app, so they follow the app's theme.
 */
export function paperIsDark(background: string, appDark: boolean): boolean {
  if (background === 'transparent' || background === 'checker') return appDark
  return lightness(background) < 0.5
}

/** The ink to hand someone who has not asked for a particular colour. */
export const neutralInk = (background: string, appDark: boolean): string =>
  paperIsDark(background, appDark) ? INK_LIGHT : INK_DARK

/** Is this one of the two neutrals, i.e. a default rather than a choice? */
export const isNeutralInk = (c: string): boolean => {
  const v = c.trim().toLowerCase()
  return v === INK_DARK || v === INK_LIGHT
}

export const DEFAULT_STYLE: DrawStyle = {
  stroke: '#1e1e1e',
  fill: 'transparent',
  fillStyle: 'hachure',
  strokeWidth: 2,
  strokeStyle: 'solid',
  sloppiness: 1,
  edges: 'round',
  opacity: 1,
  fontSize: 20,
  fontFamily: 'hand',
  textAlign: 'left',
  startArrow: 'none',
  endArrow: 'arrow',
}

export function defaultDrawDoc(): DrawDoc {
  return { version: 1, elements: [], background: '#ffffff', grid: 'off' }
}

/** Elements whose geometry is a path of samples rather than a box. */
export function isStroke(el: DrawElement): el is FreedrawElement | EraserElement {
  return el.kind === 'freedraw' || el.kind === 'erase'
}

export function isLinear(el: DrawElement): el is LinearElement {
  return el.kind === 'arrow' || el.kind === 'line'
}

/** The tool a kind was drawn with, for restoring the toolbar after a select. */
export const KIND_TOOL: Record<ElementKind, DrawTool> = {
  rect: 'rect',
  diamond: 'diamond',
  ellipse: 'ellipse',
  arrow: 'arrow',
  line: 'line',
  freedraw: 'freedraw',
  erase: 'eraser',
  text: 'text',
  image: 'image',
}
