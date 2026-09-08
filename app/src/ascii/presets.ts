/**
 * Colour presets and recipes.
 *
 * The difference between the two is scope, and it is worth being strict about
 * it. A colour preset only ever touches `doc.color`, so picking one while you
 * are three sliders into a look does not throw the look away. A recipe is the
 * whole picture at once, and is allowed to move anything.
 *
 * Recipes lead the panel rather than hiding in a menu. A tool with this many
 * knobs is unusable cold, and the fastest way to teach the knobs is to hand
 * somebody a finished look and let them take it apart.
 */

import {
  Contrast,
  DraftingCompass,
  Gamepad2,
  GripVertical,
  Newspaper,
  Blocks,
  Sunset,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import type { AsciiColor, AsciiDoc } from './types'

export interface ColorPreset {
  id: string
  label: string
  patch: Partial<AsciiColor>
}

export const COLOR_PRESETS: ColorPreset[] = [
  { id: 'none', label: 'None', patch: { saturation: 1, grayscale: 0, tintOpacity: 0 } },
  { id: 'bw', label: 'B&W', patch: { saturation: 1, grayscale: 1, tintOpacity: 0 } },
  {
    id: 'sepia',
    label: 'Sepia',
    patch: { grayscale: 1, tint: '#a06a34', tintOpacity: 0.55, blend: 'color', saturation: 1 },
  },
  {
    id: 'warm',
    label: 'Warm',
    patch: { grayscale: 0, tint: '#ff8a3d', tintOpacity: 0.3, blend: 'soft-light', saturation: 1.15 },
  },
  {
    id: 'cool',
    label: 'Cool',
    patch: { grayscale: 0, tint: '#4da3ff', tintOpacity: 0.3, blend: 'soft-light', saturation: 1.05 },
  },
  {
    id: 'vintage',
    label: 'Vintage',
    patch: { grayscale: 0.35, tint: '#c99a5b', tintOpacity: 0.4, blend: 'overlay', saturation: 0.75 },
  },
  {
    id: 'fade',
    label: 'Fade',
    patch: { grayscale: 0.5, tint: '#8a8f98', tintOpacity: 0.25, blend: 'screen', saturation: 0.8 },
  },
  {
    id: 'cyber',
    label: 'Cyber',
    patch: { grayscale: 0, tint: '#ff2fd0', tintOpacity: 0.45, blend: 'hard-light', saturation: 1.4 },
  },
]

/**
 * A recipe is a deep patch, not a whole document.
 *
 * Which means it inherits everything it does not mention, and in particular it
 * never touches `assetId` or `size`: applying a look is not a reason to lose
 * the picture you were looking at.
 */
export type DeepPatch = {
  [K in keyof AsciiDoc]?: AsciiDoc[K] extends object ? Partial<AsciiDoc[K]> : AsciiDoc[K]
}

export interface Recipe {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  /**
   * The glyph's colour, as an "r, g, b" triple.
   *
   * A triple rather than a hex string because the stylesheet has to take it
   * apart: the light theme needs the same hue mixed down toward black, and
   * `color-mix` needs a colour it can read, not one baked into a fill.
   *
   * These are picked to survive both grounds, which rules out the near-whites
   * the looks themselves are built on. Noir and Micro are genuinely monochrome
   * treatments and would otherwise both want #f7f8f8, so they take a neutral
   * slate: it reads on the dark panel, it darkens cleanly on the light one, and
   * it still says "no colour here".
   */
  tint: string
  patch: DeepPatch
}

export const RECIPES: Recipe[] = [
  {
    id: 'terminal',
    label: 'Terminal',
    hint: 'Green phosphor, scan lines, and the bulge of the glass.',
    icon: Terminal,
    tint: '61, 220, 132',
    patch: {
      style: 'characters',
      ramp: 'standard',
      grid: { cell: 10, aspect: 1.8, jitter: 0, gap: 0 },
      tone: { brightness: 0, contrast: 118, gamma: 1, coverage: 0.9, density: 0.05, edge: 0.15, invert: false },
      color: { mode: 'ink', ink: '#4dff88', paper: '#001108', tintOpacity: 0, saturation: 1, grayscale: 0, opacity: 1, preset: 'none' },
      backdrop: { mode: 'paper', color: '#001108', opacity: 1, blur: 24 },
      fx: { vignette: 0.45, scanlines: 0.5, curvature: 0.35, bloom: 0.4, chromatic: 0.08, grain: 0.08, glitch: 0 },
    },
  },
  {
    id: 'noir',
    label: 'Noir',
    hint: 'High contrast, no colour, and grain over the whole thing.',
    icon: Contrast,
    tint: '148, 163, 184',
    patch: {
      style: 'characters',
      ramp: 'detailed',
      grid: { cell: 8, aspect: 1.8, jitter: 0, gap: 0 },
      tone: { brightness: -4, contrast: 148, gamma: 0.92, coverage: 1, density: 0.04, edge: 0.2, invert: false },
      color: { mode: 'ink', ink: '#f2f3f3', paper: '#08090a', grayscale: 1, saturation: 1, tintOpacity: 0, opacity: 1, preset: 'bw' },
      backdrop: { mode: 'paper', color: '#08090a', opacity: 1, blur: 24 },
      fx: { vignette: 0.55, scanlines: 0, curvature: 0, bloom: 0.1, chromatic: 0, grain: 0.22, glitch: 0 },
    },
  },
  {
    id: 'vaporwave',
    label: 'Vaporwave',
    hint: 'Magenta duotone, split channels, and a torn signal.',
    icon: Sunset,
    tint: '255, 47, 208',
    patch: {
      style: 'blocks',
      ramp: 'blocks',
      grid: { cell: 12, aspect: 1.8, jitter: 0, gap: 0 },
      tone: { brightness: 6, contrast: 122, gamma: 1.05, coverage: 0.95, density: 0.03, edge: 0, invert: false },
      color: { mode: 'duotone', ink: '#5a1aff', ink2: '#ff2fd0', paper: '#1b0033', saturation: 1.3, grayscale: 0, tint: '#00e5ff', tintOpacity: 0.18, blend: 'screen', opacity: 1, preset: 'none' },
      backdrop: { mode: 'paper', color: '#1b0033', opacity: 1, blur: 24 },
      fx: { vignette: 0.3, scanlines: 0.35, curvature: 0.15, bloom: 0.45, chromatic: 0.4, grain: 0.06, glitch: 0.18 },
    },
  },
  {
    id: 'gameboy',
    label: 'Game Boy',
    hint: 'Four greens, Bayer ordered, at handheld resolution.',
    icon: Gamepad2,
    tint: '154, 190, 26',
    patch: {
      style: 'dither',
      grid: { cell: 6, aspect: 1, jitter: 0, gap: 0 },
      tone: { brightness: 4, contrast: 112, gamma: 1, coverage: 1, density: 0, edge: 0, invert: false },
      dither: { algo: 'bayer4', palette: 'gameboy', serpentine: true, amount: 1, scale: 5 },
      color: { mode: 'source', paper: '#0f380f', saturation: 1, grayscale: 0, tintOpacity: 0, opacity: 1, preset: 'none' },
      backdrop: { mode: 'paper', color: '#0f380f', opacity: 1, blur: 24 },
      fx: { vignette: 0.2, scanlines: 0, curvature: 0, bloom: 0, chromatic: 0, grain: 0, glitch: 0 },
    },
  },
  {
    id: 'newsprint',
    label: 'Newsprint',
    hint: 'A rotated halftone screen on off-white paper.',
    icon: Newspaper,
    tint: '214, 170, 110',
    patch: {
      style: 'dither',
      grid: { cell: 5, aspect: 1, jitter: 0, gap: 0 },
      tone: { brightness: 8, contrast: 126, gamma: 1, coverage: 1, density: 0, edge: 0, invert: false },
      dither: { algo: 'halftone', palette: 'bw', serpentine: false, amount: 1, scale: 2 },
      color: { mode: 'source', paper: '#f3efe6', grayscale: 1, saturation: 1, tintOpacity: 0, opacity: 1, preset: 'bw' },
      backdrop: { mode: 'paper', color: '#f3efe6', opacity: 1, blur: 24 },
      fx: { vignette: 0.12, scanlines: 0, curvature: 0, bloom: 0, chromatic: 0, grain: 0.12, glitch: 0 },
    },
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    hint: 'Edges only, white on process blue.',
    icon: DraftingCompass,
    tint: '92, 148, 240',
    patch: {
      style: 'cross',
      grid: { cell: 9, aspect: 1, jitter: 0, gap: 0.15 },
      tone: { brightness: -10, contrast: 100, gamma: 1, coverage: 0.9, density: 0.12, edge: 0.95, invert: false },
      color: { mode: 'ink', ink: '#dbe7ff', paper: '#12315e', saturation: 1, grayscale: 0, tintOpacity: 0, opacity: 1, preset: 'none' },
      backdrop: { mode: 'paper', color: '#12315e', opacity: 1, blur: 24 },
      fx: { vignette: 0.25, scanlines: 0, curvature: 0, bloom: 0, chromatic: 0, grain: 0.05, glitch: 0 },
    },
  },
  {
    id: 'bricks',
    label: 'Bricks',
    hint: 'Studded plates in the source colours, lit from above.',
    icon: Blocks,
    tint: '224, 168, 62',
    patch: {
      style: 'lego',
      grid: { cell: 22, aspect: 1, jitter: 0, gap: 0 },
      tone: { brightness: 4, contrast: 106, gamma: 1, coverage: 1, density: 0, edge: 0, invert: false },
      color: { mode: 'source', paper: '#141516', saturation: 1.15, grayscale: 0, tintOpacity: 0, opacity: 1, preset: 'none' },
      backdrop: { mode: 'paper', color: '#141516', opacity: 1, blur: 24 },
      fx: { vignette: 0.3, scanlines: 0, curvature: 0, bloom: 0, chromatic: 0, grain: 0, glitch: 0 },
    },
  },
  {
    id: 'braille',
    label: 'Micro',
    hint: 'Braille dots, which resolve four times the vertical detail.',
    icon: GripVertical,
    tint: '148, 163, 184',
    patch: {
      style: 'braille',
      grid: { cell: 7, aspect: 1.8, jitter: 0, gap: 0 },
      tone: { brightness: 0, contrast: 130, gamma: 1, coverage: 1, density: 0.02, edge: 0.1, invert: false },
      color: { mode: 'ink', ink: '#f7f8f8', paper: '#08090a', saturation: 1, grayscale: 0, tintOpacity: 0, opacity: 1, preset: 'none' },
      backdrop: { mode: 'paper', color: '#08090a', opacity: 1, blur: 24 },
      fx: { vignette: 0.2, scanlines: 0, curvature: 0, bloom: 0.15, chromatic: 0, grain: 0, glitch: 0 },
    },
  },
]

/**
 * Fold a recipe into a document, in place.
 *
 * One level of merge, which is exactly as deep as the schema goes. Written out
 * rather than reached for from a library because a generic deep merge would
 * also merge `size` and `mesh`, and a recipe has no business moving either.
 *
 * Mutating rather than returning a new document, because the only caller holds
 * an immer draft. Rebuilding the object from spreads works right up until one
 * of the untouched fields is a nested draft proxy, at which point it is being
 * carried out of the producer that owns it, and the failure shows up later and
 * somewhere else. A plain mutator is correct on a draft and on a plain object
 * alike, which is the whole reason to prefer one here.
 */
export function applyRecipe(doc: AsciiDoc, patch: DeepPatch): void {
  if (patch.style) doc.style = patch.style
  if (patch.ramp) doc.ramp = patch.ramp
  Object.assign(doc.grid, patch.grid)
  Object.assign(doc.tone, patch.tone)
  Object.assign(doc.color, patch.color)
  Object.assign(doc.dither, patch.dither)
  Object.assign(doc.backdrop, patch.backdrop)
  Object.assign(doc.fx, patch.fx)
}
