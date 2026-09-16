import { sampleKeyframes } from './evaluator'
import type { Keyframe, Overlay, TextOverlay, TextRevealKind } from '../types'

/*
 * Overlays, resolved.
 *
 * Captions, logos and shapes are stuck to the front of the frame rather than
 * standing in the scene, so they are the one part of a shot that the 3D
 * runtime never touches. Their animation is evaluated here instead, once, and
 * handed to whoever is drawing: the DOM preview and the export canvas both ask
 * this module rather than each working out what a half-finished letter reveal
 * looks like, which is the only way the two can agree.
 */

/** Every overlay property that can carry keyframes, as `ov.<id>.<prop>`. */
export const OVERLAY_ANIMATABLE = ['x', 'y', 'opacity', 'rotation', 'scale', 'progress'] as const
export type OverlayProp = (typeof OVERLAY_ANIMATABLE)[number]

export const OVERLAY_PROP_LABELS: Record<OverlayProp, string> = {
  x: 'X',
  y: 'Y',
  opacity: 'Opacity',
  rotation: 'Rotate',
  scale: 'Scale',
  progress: 'Reveal',
}

/** The overlay's own scale, defaulting for anything saved before it existed. */
export const scaleOf = (o: Overlay) => (typeof o.scale === 'number' ? o.scale : 1)

/** How the text arrives, defaulting to simply being there. */
export const revealOf = (o: TextOverlay): TextRevealKind => o.reveal ?? 'none'

/** How far through that arrival, defaulting to finished. */
export const progressOf = (o: TextOverlay) => (typeof o.progress === 'number' ? o.progress : 1)

/**
 * The overlays as they look at `timeMs`.
 *
 * Takes the two lists rather than the shot they came from, so a caller can
 * hold them without also holding the scene beside them: overlays do not change
 * when a camera does, and a preview that redrew captions on every frame of an
 * orbit would be paying for nothing. Returns the array it was given when
 * nothing on it is animated.
 */
export function resolveOverlays(
  overlays: Overlay[],
  keyframes: Keyframe[],
  timeMs: number,
): Overlay[] {
  const tracks = keyframes.filter((k) => k.target.startsWith('ov.'))
  if (tracks.length === 0) return overlays

  const sampled = sampleKeyframes(tracks, timeMs)
  return overlays.map((o) => {
    let out = o
    for (const prop of OVERLAY_ANIMATABLE) {
      const v = sampled.get(`ov.${o.id}.${prop}`)
      if (v === undefined) continue
      if (out === o) out = { ...o }
      ;(out as unknown as Record<string, number>)[prop] = v
    }
    return out
  })
}

// ----- text reveal -----

/**
 * One character of a revealing line: whether to draw it, how solid, and how far
 * it still has to travel.
 *
 * Per character rather than per word or per line because that is the unit the
 * animations people actually ask for work in, and because a shared per-glyph
 * answer is what lets the canvas place letters exactly where the browser does.
 */
export interface Glyph {
  char: string
  /** 0..1; 0 means the character is not on screen yet */
  alpha: number
  /** how far it is still displaced, as a fraction of the font size */
  rise: number
}

/**
 * How many characters of overlap a staggered reveal runs.
 *
 * With no overlap the letters pop one at a time and the line reads as a
 * teletype. A few characters in flight at once is what makes the same
 * animation read as one movement that sweeps across the line.
 */
const STAGGER = 4

/**
 * Break a line into glyphs at a point in its reveal.
 *
 * `letters` and `words` are hard cuts, the typewriter: a character is either
 * typed or it is not. `rise` and `fade` are soft, each character running its
 * own little fade through a window that slides along the line.
 */
export function glyphsAt(text: string, kind: TextRevealKind, progress: number): Glyph[] {
  const chars = [...text]
  const p = Math.min(1, Math.max(0, progress))

  if (kind === 'none' || kind === 'fade') {
    // fade is handled as one alpha over the whole block, so every glyph is solid
    return chars.map((char) => ({ char, alpha: 1, rise: 0 }))
  }

  if (kind === 'letters' || kind === 'words') {
    /*
     * Newlines and the spaces between words are not typed, they are already
     * part of the layout; counting them would make the cursor pause on empty
     * air. Words step by whole runs so the line arrives a word at a time.
     */
    const units: number[] = [] // the unit index each character belongs to
    let unit = -1
    let inWord = false
    for (const char of chars) {
      const space = char === ' ' || char === '\n'
      if (kind === 'letters') {
        if (!space) unit++
        units.push(unit)
      } else {
        if (space) inWord = false
        else if (!inWord) {
          unit++
          inWord = true
        }
        units.push(unit)
      }
    }
    const count = unit + 1
    const shown = p * count
    return chars.map((char, i) => ({
      char,
      // a space rides in with the character before it, so it never flickers
      alpha: units[i] < shown ? 1 : 0,
      rise: 0,
    }))
  }

  // rise: a window of STAGGER characters in flight, sweeping left to right
  const n = chars.length
  const head = p * (n + STAGGER)
  return chars.map((char, i) => {
    const local = Math.min(1, Math.max(0, (head - i) / STAGGER))
    return { char, alpha: local, rise: 1 - local }
  })
}

/** The alpha a `fade` reveal puts over the whole block. */
export function blockAlpha(kind: TextRevealKind, progress: number): number {
  if (kind !== 'fade') return 1
  return Math.min(1, Math.max(0, progress))
}

/** Does this overlay need per-character drawing, or will the plain string do? */
export function needsGlyphs(o: TextOverlay): boolean {
  const kind = revealOf(o)
  if (kind === 'none' || kind === 'fade') return false
  return progressOf(o) < 1
}

/** How far a risen glyph is pushed down, as a fraction of the font size. */
export const RISE_DISTANCE = 0.45
