/**
 * Finished pictures.
 *
 * A preset is a whole look in one press: a generator, its own controls, how
 * hard it is driven, the mask it is dithered against, three colours, and a post
 * chain. Handing somebody a finished picture and letting them take it apart is
 * far and away the fastest way to learn what fifty controls do, which is why
 * this list is the first thing in the panel rather than the last.
 *
 * Three rules govern what is in here.
 *
 * Every one of the sixty-eight generators appears at least once. A generator no
 * preset reaches is a generator nobody finds.
 *
 * A preset may set the generator's own controls, and the good ones do. The
 * whole point of Chladni is which two mode numbers you pick, and a preset that
 * shipped the defaults would be showing off the least interesting member of the
 * family. Anything left unset falls back to the generator's default.
 *
 * Nothing sets a value it does not care about. A preset is a patch, not a
 * document, so applying one leaves the canvas size, the duration and the frame
 * cap exactly where the user put them. Being handed a new look should not
 * resize your artboard.
 */

import type { FxChain } from '../lib/postfx'
import type { AccentMode, MaskId, SignalDoc, SourceKind } from './types'

export interface Preset {
  id: string
  name: string
  group: string
  kind: SourceKind
  /** id into FIELDS or FIGURES */
  source: string
  intensity: number
  scale: number
  speed: number
  ink: string
  paper: string
  accent: string
  mix: number
  mode?: AccentMode
  mask?: MaskId
  threshold?: number
  spread?: number
  pixelSize?: number
  randomness?: number
  detail?: number
  glyphs?: 'ramp' | 'custom'
  ramp?: string
  text?: string
  /** the generator's own controls, by key */
  params?: Record<string, number>
  fx?: FxChain
}

/** Shorthand, so a preset table stays a table. */
const fx = (...pairs: [keyof FxChain & string, number][]): FxChain =>
  Object.fromEntries(pairs.map(([k, v]) => [k, { amount: v }])) as FxChain

export const PRESETS: Preset[] = [
  // ----- House: the app's own palette, on the patterns that carry it best -----
  { id: 'h-warp', name: 'Marble', group: 'House', kind: 'field', source: 'warp', intensity: 58, scale: 3.4, speed: 0.5, ink: '#f7f8f8', paper: '#08090a', accent: '#5e6ad2', mix: 34, mask: 'blue-noise', pixelSize: 2, params: { warp: 1.15, octaves: 3, gain: 0.52 }, fx: fx(['bloom', 0.22], ['vignette', 0.3]) },
  { id: 'h-quasi', name: 'Lattice', group: 'House', kind: 'field', source: 'quasicrystal', intensity: 62, scale: 3.6, speed: 0.4, ink: '#d0d6e0', paper: '#08090a', accent: '#5e6ad2', mix: 40, mask: 'bayer8', pixelSize: 2, params: { waves: 7, drift: 0.22, rate: 0.7 }, fx: fx(['bloom', 0.28], ['vignette', 0.34]) },
  { id: 'h-iso', name: 'Survey', group: 'House', kind: 'figure', source: 'isolines', intensity: 55, scale: 4, speed: 0.35, ink: '#d0d6e0', paper: '#08090a', accent: '#5e6ad2', mix: 0, params: { levels: 16, step: 9, octaves: 3, weight: 0.7, accent: 4 }, fx: fx(['grain', 0.16], ['vignette', 0.34]) },
  { id: 'h-phyllo', name: 'Seedhead', group: 'House', kind: 'figure', source: 'phyllotaxis', intensity: 55, scale: 3.2, speed: 0.4, ink: '#f7f8f8', paper: '#08090a', accent: '#5e6ad2', mix: 0, params: { angle: 137.507, seeds: 1200, taper: 1.4, accent: 7 }, fx: fx(['bloom', 0.24], ['vignette', 0.36]) },
  { id: 'h-paper', name: 'House Paper', group: 'House', kind: 'field', source: 'liquid', intensity: 45, scale: 4, speed: 0.4, ink: '#0f1011', paper: '#f5f6f6', accent: '#5e6ad2', mix: 30, mask: 'halftone', pixelSize: 2, fx: fx(['grain', 0.15]) },
  { id: 'h-torus', name: 'House Torus', group: 'House', kind: 'figure', source: 'particle-ring', intensity: 55, scale: 4, speed: 0.7, ink: '#f7f8f8', paper: '#08090a', accent: '#5e6ad2', mix: 0, params: { points: 18, tube: 0.42 }, fx: fx(['bloom', 0.3], ['vignette', 0.4]) },

  // ----- Mathematic: the ones that are worth a caption -----
  { id: 'm-chladni', name: 'Chladni Plate', group: 'Mathematic', kind: 'field', source: 'chladni', intensity: 60, scale: 4, speed: 0.3, ink: '#f0ead8', paper: '#141210', accent: '#c8a24a', mix: 22, mask: 'blue-noise', pixelSize: 2, params: { m: 5, n: 9, sweep: 2.2, sharp: 11 }, fx: fx(['grain', 0.24], ['vignette', 0.4]) },
  { id: 'm-chladni2', name: 'Standing Wave', group: 'Mathematic', kind: 'field', source: 'chladni', intensity: 70, scale: 6, speed: 0.5, ink: '#00e5ff', paper: '#00121a', accent: '#ffffff', mix: 30, mask: 'bayer4', pixelSize: 2, params: { m: 11, n: 4, sweep: 3.5, sharp: 6 }, fx: fx(['bloom', 0.35], ['scanlines', 0.25]) },
  { id: 'm-quasi', name: 'Aperiodic', group: 'Mathematic', kind: 'field', source: 'quasicrystal', intensity: 66, scale: 4.5, speed: 0.5, ink: '#ffcc44', paper: '#100a02', accent: '#ff4466', mix: 45, mask: 'halftone', pixelSize: 2, params: { waves: 9, drift: 0.5, rate: 1.4 }, fx: fx(['bloom', 0.3], ['vignette', 0.35]) },
  { id: 'm-quasi-hex', name: 'Hex Lock', group: 'Mathematic', kind: 'field', source: 'quasicrystal', intensity: 58, scale: 3, speed: 0.25, ink: '#111111', paper: '#f2efe6', accent: '#c8402c', mix: 26, mode: 'hard', mask: 'halftone', pixelSize: 3, params: { waves: 3, drift: 0.08, rate: 0.4 }, fx: fx(['grain', 0.22]) },
  { id: 'm-newton', name: 'Newton Basins', group: 'Mathematic', kind: 'field', source: 'newton', intensity: 62, scale: 4, speed: 0.4, ink: '#a8ffea', paper: '#01100e', accent: '#ff2f87', mix: 42, mask: 'bayer8', pixelSize: 2, params: { roots: 5, iters: 20, spin: 0.6 }, fx: fx(['bloom', 0.32], ['vignette', 0.4]) },
  { id: 'm-newton7', name: 'Sevenfold', group: 'Mathematic', kind: 'field', source: 'newton', intensity: 55, scale: 5.5, speed: 0.25, ink: '#f7f8f8', paper: '#0a0208', accent: '#9e76e2', mix: 30, mask: 'blue-noise', pixelSize: 2, params: { roots: 7, iters: 26, spin: 0.25 }, fx: fx(['bloom', 0.25], ['grain', 0.18], ['vignette', 0.42]) },
  { id: 'm-orbit', name: 'Orbit Trap', group: 'Mathematic', kind: 'field', source: 'orbit', intensity: 64, scale: 3, speed: 0.35, ink: '#ffb347', paper: '#0d0400', accent: '#ff3d00', mix: 46, mask: 'bayer4', pixelSize: 2, params: { trap: 0.2, ring: 0.55, sharp: 9, iters: 30, orbit: 0.32 }, fx: fx(['bloom', 0.4], ['vignette', 0.42]) },
  { id: 'm-orbit-ring', name: 'Bubble Trap', group: 'Mathematic', kind: 'field', source: 'orbit', intensity: 58, scale: 2.6, speed: 0.3, ink: '#bfe9ff', paper: '#02070f', accent: '#5e6ad2', mix: 38, mask: 'blue-noise', pixelSize: 2, params: { trap: 0.9, ring: 0.9, sharp: 4, iters: 26, orbit: 0.4 }, fx: fx(['bloom', 0.34], ['vignette', 0.4]) },
  { id: 'm-inv', name: 'Apollonian', group: 'Mathematic', kind: 'field', source: 'inversion', intensity: 60, scale: 3, speed: 0.3, ink: '#f7f8f8', paper: '#0a0a0c', accent: '#00e0b8', mix: 32, mask: 'bayer8', pixelSize: 2, params: { circles: 4, radius: 0.9, spread: 0.8, passes: 18, contrast: 2.4, spin: 0.4 }, fx: fx(['bloom', 0.24], ['vignette', 0.4]) },
  { id: 'm-inv-6', name: 'Kleinian', group: 'Mathematic', kind: 'field', source: 'inversion', intensity: 55, scale: 4, speed: 0.2, ink: '#ffd9a0', paper: '#120602', accent: '#ff5522', mix: 40, mask: 'crosshatch', pixelSize: 2, params: { circles: 6, radius: 0.7, spread: 0.95, passes: 22, contrast: 3, spin: 0.2 }, fx: fx(['grain', 0.2], ['vignette', 0.45]) },
  { id: 'm-worley', name: 'Voronoi Walls', group: 'Mathematic', kind: 'field', source: 'worley', intensity: 62, scale: 3, speed: 0.45, ink: '#e8fff4', paper: '#04120e', accent: '#00ff9d', mix: 30, mask: 'bayer4', pixelSize: 2, params: { density: 1.6, edges: 0.85, jitter: 0.7 }, fx: fx(['bloom', 0.28], ['vignette', 0.34]) },
  { id: 'm-worley-cell', name: 'Cell Culture', group: 'Mathematic', kind: 'field', source: 'worley', intensity: 55, scale: 2.4, speed: 0.3, ink: '#2a2a2a', paper: '#f4f1e8', accent: '#b8593f', mix: 34, mask: 'halftone', pixelSize: 3, params: { density: 1.1, edges: 0.15, jitter: 0.45 }, fx: fx(['grain', 0.24]) },
  { id: 'm-zone', name: 'Zone Plate', group: 'Mathematic', kind: 'field', source: 'zone', intensity: 66, scale: 4, speed: 0.6, ink: '#ffffff', paper: '#000000', accent: '#ff0055', mix: 28, mask: 'bayer2', pixelSize: 2, params: { focal: 2.2, rate: 2.4, wander: 0.05, squeeze: 1 }, fx: fx(['chromatic', 0.22]) },
  { id: 'm-string', name: 'Cardioid', group: 'Mathematic', kind: 'figure', source: 'string-art', intensity: 60, scale: 4, speed: 0.4, ink: '#f7f8f8', paper: '#08090a', accent: '#ff9500', mix: 0, params: { points: 320, multiplier: 2, sweep: 0.9, weight: 0.4 }, fx: fx(['bloom', 0.3], ['vignette', 0.4]) },
  { id: 'm-string-3', name: 'Nephroid', group: 'Mathematic', kind: 'figure', source: 'string-art', intensity: 55, scale: 4, speed: 0.3, ink: '#111111', paper: '#f5f2ea', accent: '#c8402c', mix: 0, params: { points: 260, multiplier: 3, sweep: 0.4, weight: 0.55, rim: 1 }, fx: fx(['grain', 0.2]) },
  { id: 'm-harm', name: 'Harmonograph', group: 'Mathematic', kind: 'figure', source: 'harmonograph', intensity: 55, scale: 4, speed: 0.3, ink: '#e8e2d0', paper: '#14110c', accent: '#c8a24a', mix: 0, params: { ratio: 3, ratioY: 2, detune: 0.006, damping: 0.9, steps: 60, weight: 0.6 }, fx: fx(['grain', 0.22], ['vignette', 0.4]) },
  { id: 'm-harm-5', name: 'Rosette', group: 'Mathematic', kind: 'figure', source: 'harmonograph', intensity: 60, scale: 5, speed: 0.5, ink: '#8affff', paper: '#020a12', accent: '#ff44aa', mix: 0, params: { ratio: 5, ratioY: 3, detune: 0.002, damping: 0.35, steps: 90, weight: 0.5 }, fx: fx(['bloom', 0.36]) },
  { id: 'm-spiro', name: 'Spirograph', group: 'Mathematic', kind: 'figure', source: 'spirograph', intensity: 58, scale: 4, speed: 0.45, ink: '#f7f8f8', paper: '#08090a', accent: '#5e6ad2', mix: 0, params: { outer: 13, inner: 5, pen: 6, turns: 14, layers: 4, fan: 0.25 }, fx: fx(['bloom', 0.28], ['vignette', 0.38]) },
  { id: 'm-spiro-2', name: 'Gear Train', group: 'Mathematic', kind: 'figure', source: 'spirograph', intensity: 52, scale: 5, speed: 0.3, ink: '#1a1a1a', paper: '#efeae0', accent: '#0055cc', mix: 0, params: { outer: 21, inner: 8, pen: 11, turns: 22, layers: 2, fan: 0.5, weight: 0.5 }, fx: fx(['grain', 0.18]) },

  // ----- Cyber -----
  { id: 'c-swirl', name: 'Neon Swirl', group: 'Cyber', kind: 'field', source: 'swirl', intensity: 60, scale: 5, speed: 1.2, ink: '#00ffcc', paper: '#0a001a', accent: '#ff00ff', mix: 40, mask: 'bayer4', spread: 60, pixelSize: 3, params: { arms: 1.4, twist: 6, falloff: 0.25 }, fx: fx(['bloom', 0.4], ['chromatic', 0.3]) },
  { id: 'c-plasma', name: 'Neon Plasma', group: 'Cyber', kind: 'field', source: 'plasma', intensity: 65, scale: 6, speed: 0.8, ink: '#ff44ff', paper: '#0a0020', accent: '#44ffff', mix: 50, mask: 'bayer8', threshold: 130, spread: 55, fx: fx(['bloom', 0.45], ['chromatic', 0.25]) },
  { id: 'c-grid', name: 'Toxic Grid', group: 'Cyber', kind: 'field', source: 'warp-grid', intensity: 55, scale: 4, speed: 1, ink: '#00ff66', paper: '#001100', accent: '#ffff00', mix: 30, mask: 'crosshatch', spread: 45, pixelSize: 3, params: { cells: 4, bend: 0.08, weight: 0.06 }, fx: fx(['scanlines', 0.5], ['vignette', 0.4]) },
  { id: 'c-tunnel', name: 'Magenta Tunnel', group: 'Cyber', kind: 'field', source: 'tunnel', intensity: 70, scale: 5, speed: 1.3, ink: '#ff00aa', paper: '#0d000d', accent: '#ff66ff', mix: 35, mask: 'halftone', threshold: 140, params: { spokes: 18, rings: 6, rush: 4.5 }, fx: fx(['bloom', 0.4], ['vignette', 0.45]) },
  { id: 'c-circuit', name: 'Live Board', group: 'Cyber', kind: 'figure', source: 'circuit', intensity: 60, scale: 4, speed: 1, ink: '#00ff88', paper: '#001208', accent: '#88ffcc', mix: 0, fx: fx(['bloom', 0.35], ['scanlines', 0.3]) },
  { id: 'c-arc', name: 'Arc Storm', group: 'Cyber', kind: 'field', source: 'electric', intensity: 75, scale: 5, speed: 1.4, ink: '#66ddff', paper: '#000814', accent: '#ffffff', mix: 30, mask: 'blue-noise', spread: 70, fx: fx(['bloom', 0.5], ['chromatic', 0.2]) },
  { id: 'c-net', name: 'Hub', group: 'Cyber', kind: 'figure', source: 'network', intensity: 55, scale: 5, speed: 0.8, ink: '#00ffcc', paper: '#04141a', accent: '#ff00aa', mix: 0, params: { nodes: 46, reach: 0.17 }, fx: fx(['bloom', 0.3], ['grain', 0.15]) },
  { id: 'c-moire', name: 'Interference', group: 'Cyber', kind: 'field', source: 'moire', intensity: 68, scale: 4, speed: 0.6, ink: '#ff00e1', paper: '#0a0014', accent: '#00f28d', mix: 44, mask: 'bayer4', pixelSize: 2, params: { pitch: 9, angle: 3.2, spin: 0.7, shape: 0.35 }, fx: fx(['bloom', 0.3], ['chromatic', 0.25]) },
  { id: 'c-curl', name: 'Vapour Trail', group: 'Cyber', kind: 'field', source: 'curl', intensity: 62, scale: 3.4, speed: 0.7, ink: '#7cf9ff', paper: '#00121a', accent: '#ff2f87', mix: 38, mask: 'blue-noise', pixelSize: 2, params: { push: 0.5, stripes: 9, octaves: 2 }, fx: fx(['bloom', 0.34], ['vignette', 0.34]) },

  // ----- Terminal -----
  { id: 't-scan', name: 'Green Terminal', group: 'Terminal', kind: 'field', source: 'scan', intensity: 50, scale: 3, speed: 0.5, ink: '#33ff33', paper: '#001100', accent: '#66ff66', mix: 0, mask: 'bayer4', spread: 40, fx: fx(['scanlines', 0.55], ['crtPhosphor', 0.3], ['curvature', 0.3], ['vignette', 0.45]) },
  { id: 't-amber', name: 'Amber Monitor', group: 'Terminal', kind: 'field', source: 'matrix', intensity: 60, scale: 3, speed: 1, ink: '#ffaa33', paper: '#0a0600', accent: '#ff8800', mix: 0, mask: 'bayer4', threshold: 135, spread: 35, params: { trail: 4, fall: 0.6, flicker: 0.15 }, fx: fx(['scanlines', 0.5], ['grain', 0.3], ['vignette', 0.4]) },
  { id: 't-dos', name: 'DOS Maze', group: 'Terminal', kind: 'field', source: 'warp-grid', intensity: 40, scale: 3, speed: 0.3, ink: '#aaaaaa', paper: '#000055', accent: '#ffffff', mix: 0, mask: 'bayer4', pixelSize: 3, fx: fx(['crtPhosphor', 0.35], ['scanlines', 0.4], ['curvature', 0.25]) },
  { id: 't-bbs', name: 'BBS', group: 'Terminal', kind: 'field', source: 'checker', intensity: 40, scale: 5, speed: 0.4, ink: '#00aaff', paper: '#000022', accent: '#ffffff', mix: 0, mask: 'bayer4', pixelSize: 4, fx: fx(['crtPhosphor', 0.3], ['vignette', 0.4]) },
  { id: 't-counter', name: 'Departures', group: 'Terminal', kind: 'figure', source: 'grid-counter', intensity: 45, scale: 4, speed: 0.6, ink: '#ffcc44', paper: '#0a0800', accent: '#ffffff', mix: 0, fx: fx(['scanlines', 0.35], ['grain', 0.2]) },
  { id: 't-boot', name: 'Boot Sequence', group: 'Terminal', kind: 'figure', source: 'type-cascade', intensity: 40, scale: 4, speed: 0.8, ink: '#33ff88', paper: '#000a04', accent: '#88ffbb', mix: 0, text: 'RIBBIT, SIGNAL, DITHER, EXPORT', fx: fx(['scanlines', 0.4], ['bloom', 0.25]) },
  { id: 't-rain', name: 'Downpour', group: 'Terminal', kind: 'figure', source: 'matrix-rain', intensity: 60, scale: 4, speed: 1, ink: '#33ff33', paper: '#000000', accent: '#ccffcc', mix: 0, fx: fx(['bloom', 0.3], ['scanlines', 0.3]) },
  { id: 't-radar', name: 'Radar', group: 'Terminal', kind: 'figure', source: 'orbits', intensity: 50, scale: 5, speed: 0.7, ink: '#33ff99', paper: '#00120a', accent: '#ffffff', mix: 0, params: { orbits: 5, tilt: 0.9, spread: 1.4 }, fx: fx(['bloom', 0.3], ['scanlines', 0.3], ['vignette', 0.45]) },

  // ----- Print -----
  { id: 'p-swirl', name: 'Clean Swirl', group: 'Print', kind: 'field', source: 'swirl', intensity: 50, scale: 4, speed: 0.8, ink: '#ffffff', paper: '#000000', accent: '#888888', mix: 0, mask: 'bayer8', pixelSize: 2 },
  { id: 'p-ripple', name: 'Ink Ripple', group: 'Print', kind: 'field', source: 'ripple', intensity: 60, scale: 4, speed: 0.6, ink: '#000000', paper: '#ffffff', accent: '#666666', mix: 0, mask: 'halftone', spread: 55, pixelSize: 2, params: { rings: 3, decay: 0.55 } },
  { id: 'p-news', name: 'Newsprint', group: 'Print', kind: 'field', source: 'concentric', intensity: 50, scale: 5, speed: 0.5, ink: '#1a1a1a', paper: '#f0f0e8', accent: '#444444', mix: 0, mask: 'halftone', spread: 60, pixelSize: 3, fx: fx(['grain', 0.25]) },
  { id: 'p-stark', name: 'Stark', group: 'Print', kind: 'field', source: 'interference', intensity: 55, scale: 6, speed: 0.7, ink: '#ffffff', paper: '#000000', accent: '#ffffff', mix: 0, mask: 'crosshatch', spread: 40, pixelSize: 2, params: { sources: 6, spread: 0.3, orbit: 0.6 } },
  { id: 'p-diamond', name: 'Diamond Mono', group: 'Print', kind: 'field', source: 'diamond', intensity: 50, scale: 5, speed: 0.6, ink: '#e0e0e0', paper: '#0a0a0a', accent: '#808080', mix: 0, mask: 'diamond', pixelSize: 3, fx: fx(['vignette', 0.35]) },
  { id: 'p-riso', name: 'Risograph', group: 'Print', kind: 'field', source: 'liquid', intensity: 55, scale: 4, speed: 0.4, ink: '#2a2a2a', paper: '#f5f0e6', accent: '#d4607a', mix: 45, mode: 'hard', mask: 'halftone', pixelSize: 3, fx: fx(['grain', 0.3]) },
  { id: 'p-blue', name: 'Blueprint', group: 'Print', kind: 'field', source: 'warp-grid', intensity: 45, scale: 5, speed: 0.25, ink: '#ffffff', paper: '#00244d', accent: '#4d9fff', mix: 20, mask: 'lines', pixelSize: 2, params: { cells: 5, bend: 0.02, weight: 0.04 }, fx: fx(['gridLines', 0.25], ['grain', 0.15]) },
  { id: 'p-sort', name: 'Sorted', group: 'Print', kind: 'figure', source: 'pixel-sort', intensity: 55, scale: 4, speed: 0.7, ink: '#111111', paper: '#f0efe9', accent: '#cc2222', mix: 0, fx: fx(['grain', 0.2]) },
  { id: 'p-bars', name: 'Broadcast', group: 'Print', kind: 'figure', source: 'wave-bars', intensity: 50, scale: 5, speed: 0.6, ink: '#f5f5f0', paper: '#101014', accent: '#ff6622', mix: 0, fx: fx(['grain', 0.2], ['vignette', 0.3]) },
  { id: 'p-morph', name: 'Contact Sheet', group: 'Print', kind: 'figure', source: 'morph-grid', intensity: 50, scale: 4, speed: 0.5, ink: '#141414', paper: '#f2f0ea', accent: '#888888', mix: 0, fx: fx(['grain', 0.2]) },
  { id: 'p-iso', name: 'Contour Map', group: 'Print', kind: 'figure', source: 'isolines', intensity: 52, scale: 3.4, speed: 0.25, ink: '#2c2c2c', paper: '#f2ede0', accent: '#a8531f', mix: 0, params: { levels: 20, step: 8, octaves: 3, weight: 0.6, accent: 5 }, fx: fx(['grain', 0.22]) },

  // ----- Warm -----
  { id: 'w-heat', name: 'Desert Heat', group: 'Warm', kind: 'field', source: 'mirage', intensity: 65, scale: 4, speed: 0.7, ink: '#ffcc66', paper: '#1a0a00', accent: '#ff6600', mix: 40, mask: 'blue-noise', threshold: 120, spread: 60, fx: fx(['bloom', 0.3], ['vignette', 0.4]) },
  { id: 'w-sunset', name: 'Sunset Flow', group: 'Warm', kind: 'field', source: 'liquid', intensity: 55, scale: 5, speed: 0.9, ink: '#ff8844', paper: '#1a0808', accent: '#ffcc00', mix: 45, mask: 'bayer4', threshold: 130, fx: fx(['lightLeak', 0.4]) },
  { id: 'w-fire', name: 'Campfire', group: 'Warm', kind: 'field', source: 'particle-flow', intensity: 70, scale: 3, speed: 1.2, ink: '#ff6622', paper: '#0a0400', accent: '#ffaa00', mix: 35, mask: 'blue-noise', threshold: 110, spread: 65, pixelSize: 3, fx: fx(['bloom', 0.4], ['vignette', 0.4]) },
  { id: 'w-ember', name: 'Ember', group: 'Warm', kind: 'field', source: 'aurora', intensity: 60, scale: 4, speed: 0.5, ink: '#ff4422', paper: '#0a0200', accent: '#ff8800', mix: 50, mask: 'bayer8', threshold: 135, fx: fx(['bloom', 0.4]) },
  { id: 'w-terra', name: 'Terracotta', group: 'Warm', kind: 'field', source: 'topographic', intensity: 50, scale: 5, speed: 0.4, ink: '#cc6633', paper: '#1a0f08', accent: '#ff9966', mix: 30, mask: 'crosshatch', pixelSize: 3, params: { levels: 22, weight: 0.08, fill: 0.22 }, fx: fx(['grain', 0.3], ['vignette', 0.4]) },
  { id: 'w-chimney', name: 'Chimney', group: 'Warm', kind: 'field', source: 'smoke', intensity: 55, scale: 5, speed: 0.5, ink: '#e8b070', paper: '#120a04', accent: '#ffd9a0', mix: 30, mask: 'blue-noise', params: { octaves: 4, rise: 0.6 }, fx: fx(['fog', 0.3], ['vignette', 0.4]) },
  { id: 'w-gilt', name: 'Gilt', group: 'Warm', kind: 'figure', source: 'sacred', intensity: 45, scale: 5, speed: 0.4, ink: '#d4a850', paper: '#0a0806', accent: '#ffd700', mix: 0, params: { layers: 4, petals: 8, step: 0.7 }, fx: fx(['bloom', 0.3], ['vignette', 0.4]) },
  { id: 'w-ridge', name: 'Badlands', group: 'Warm', kind: 'field', source: 'ridge', intensity: 60, scale: 3.2, speed: 0.35, ink: '#ffcf9e', paper: '#140803', accent: '#ff6a1f', mix: 32, mask: 'blue-noise', pixelSize: 2, params: { octaves: 6, lacunarity: 2.2, gain: 0.62, offset: 1.02 }, fx: fx(['grain', 0.24], ['vignette', 0.42]) },

  // ----- Cool -----
  { id: 'k-ocean', name: 'Deep Ocean', group: 'Cool', kind: 'field', source: 'liquid', intensity: 60, scale: 5, speed: 0.6, ink: '#0088ff', paper: '#000816', accent: '#00ccff', mix: 40, mask: 'bayer4', fx: fx(['bloom', 0.3]) },
  { id: 'k-swell', name: 'Open Water', group: 'Cool', kind: 'field', source: 'swell', intensity: 58, scale: 3.4, speed: 0.5, ink: '#9fd8ff', paper: '#020a16', accent: '#ffffff', mix: 26, mask: 'lines', pixelSize: 2, params: { waves: 5, steepness: 0.7, spread: 1.4, heading: 25 }, fx: fx(['bloom', 0.22], ['vignette', 0.4]) },
  { id: 'k-ice', name: 'Ice Crystal', group: 'Cool', kind: 'field', source: 'fractal', intensity: 55, scale: 6, speed: 0.5, ink: '#88ccff', paper: '#000a1a', accent: '#ffffff', mix: 25, mask: 'diamond', threshold: 140, params: { iters: 34, breathe: 1.4 }, fx: fx(['sharpen', 0.4]) },
  { id: 'k-aurora', name: 'Arctic Aurora', group: 'Cool', kind: 'field', source: 'aurora', intensity: 65, scale: 4, speed: 0.7, ink: '#44ffaa', paper: '#000a0d', accent: '#00aaff', mix: 50, mask: 'blue-noise', threshold: 125, fx: fx(['bloom', 0.4], ['fog', 0.3]) },
  { id: 'k-tidal', name: 'Tidal Pool', group: 'Cool', kind: 'field', source: 'metaballs', intensity: 60, scale: 4, speed: 0.8, ink: '#00ddcc', paper: '#001016', accent: '#0066ff', mix: 35, mask: 'bayer8', pixelSize: 3, params: { count: 7, size: 1.2, spread: 0.34 }, fx: fx(['bloom', 0.3]) },
  { id: 'k-frost', name: 'Frost', group: 'Cool', kind: 'field', source: 'cellular', intensity: 50, scale: 5, speed: 0.4, ink: '#aaddff', paper: '#000816', accent: '#ffffff', mix: 20, mask: 'crosshatch', threshold: 135, spread: 40, params: { rate: 2, bias: 0.46 }, fx: fx(['sharpen', 0.3], ['vignette', 0.35]) },
  { id: 'k-star', name: 'Star Map', group: 'Cool', kind: 'figure', source: 'constellation', intensity: 50, scale: 5, speed: 0.4, ink: '#cfe4ff', paper: '#02060f', accent: '#7fb4ff', mix: 0, params: { stars: 120, reach: 0.1 }, fx: fx(['bloom', 0.25], ['vignette', 0.4]) },
  { id: 'k-orbit', name: 'Ephemeris', group: 'Cool', kind: 'figure', source: 'orbits', intensity: 50, scale: 5, speed: 0.6, ink: '#cfe4ff', paper: '#01050c', accent: '#5e6ad2', mix: 0, params: { orbits: 11, tilt: 0.24 }, fx: fx(['bloom', 0.3], ['vignette', 0.45]) },
  { id: 'k-breathe', name: 'Breathe', group: 'Cool', kind: 'figure', source: 'breath', intensity: 45, scale: 4, speed: 0.4, ink: '#aaddff', paper: '#000816', accent: '#ffffff', mix: 0, fx: fx(['bloom', 0.35], ['vignette', 0.4]) },

  // ----- Glitch -----
  { id: 'g-broken', name: 'Broken Signal', group: 'Glitch', kind: 'field', source: 'glitch-blocks', intensity: 90, scale: 4, speed: 2.5, ink: '#ffffff', paper: '#000000', accent: '#ff0000', mix: 30, mask: 'blue-noise', spread: 80, fx: fx(['glitch', 0.5], ['chromatic', 0.35], ['grain', 0.3]) },
  { id: 'g-corrupt', name: 'Data Corrupt', group: 'Glitch', kind: 'field', source: 'checker', intensity: 75, scale: 5, speed: 1.8, ink: '#00ff88', paper: '#000a04', accent: '#ff4444', mix: 45, mask: 'bayer4', spread: 60, pixelSize: 4, fx: fx(['glitch', 0.45], ['pixelate', 0.3]) },
  { id: 'g-wave', name: 'Wave Glitch', group: 'Glitch', kind: 'field', source: 'interference', intensity: 60, scale: 6, speed: 1.2, ink: '#ff66cc', paper: '#0a0010', accent: '#66ffcc', mix: 40, mask: 'bayer8', params: { sources: 8, orbit: 2 }, fx: fx(['waveDistort', 0.4], ['chromatic', 0.3]) },
  { id: 'g-storm', name: 'Pixel Storm', group: 'Glitch', kind: 'field', source: 'pixel-rain', intensity: 80, scale: 3, speed: 2, ink: '#ffcc00', paper: '#0a0800', accent: '#ff0044', mix: 35, mask: 'blue-noise', spread: 70, pixelSize: 3, fx: fx(['glitch', 0.4], ['bloom', 0.3]) },
  { id: 'g-static', name: 'Static Burst', group: 'Glitch', kind: 'field', source: 'electric', intensity: 85, scale: 4, speed: 3, ink: '#ffffff', paper: '#000000', accent: '#ffff00', mix: 20, mask: 'blue-noise', spread: 90, pixelSize: 1, fx: fx(['grain', 0.4], ['chromatic', 0.35], ['rgbSplit', 0.3]) },
  { id: 'g-vhs', name: 'VHS', group: 'Glitch', kind: 'field', source: 'scan', intensity: 65, scale: 3, speed: 1.2, ink: '#cccccc', paper: '#111111', accent: '#ff4444', mix: 25, mask: 'blue-noise', spread: 70, fx: fx(['rgbSplit', 0.3], ['waveDistort', 0.25], ['scanlines', 0.45], ['filmDust', 0.3], ['grain', 0.35]) },
  { id: 'g-soup', name: 'Alphabet Soup', group: 'Glitch', kind: 'figure', source: 'text-scatter', intensity: 70, scale: 4, speed: 1.4, ink: '#e0e0e0', paper: '#0a0a0c', accent: '#ff2266', mix: 0, fx: fx(['glitch', 0.35], ['chromatic', 0.25]) },
  { id: 'g-aliased', name: 'Aliased', group: 'Glitch', kind: 'field', source: 'zone', intensity: 78, scale: 6, speed: 1.4, ink: '#00ff41', paper: '#000800', accent: '#ff00ff', mix: 36, mask: 'none', pixelSize: 1, params: { focal: 4.4, rate: 5, wander: 0.12, squeeze: 1.6 }, fx: fx(['chromatic', 0.3], ['scanlines', 0.35]) },

  // ----- ASCII -----
  { id: 'a-matrix', name: 'Matrix ASCII', group: 'ASCII', kind: 'field', source: 'matrix', intensity: 70, scale: 3, speed: 1.5, ink: '#33ff33', paper: '#000000', accent: '#88ff88', mix: 0, glyphs: 'ramp', pixelSize: 3, params: { trail: 2.4, fall: 0.7 }, fx: fx(['scanlines', 0.4]) },
  { id: 'a-terrain', name: 'ASCII Terrain', group: 'ASCII', kind: 'field', source: 'terrain', intensity: 50, scale: 5, speed: 0.6, ink: '#ffffff', paper: '#000000', accent: '#888888', mix: 0, glyphs: 'ramp', pixelSize: 4, params: { octaves: 5, gain: 0.55 } },
  { id: 'a-typewriter', name: 'Typewriter', group: 'ASCII', kind: 'field', source: 'concentric', intensity: 55, scale: 4, speed: 0.5, ink: '#e0d8c0', paper: '#1a1610', accent: '#aa9060', mix: 30, glyphs: 'ramp', pixelSize: 3, fx: fx(['grain', 0.25]) },
  { id: 'a-code', name: 'Code Rain', group: 'ASCII', kind: 'field', source: 'pixel-rain', intensity: 65, scale: 3, speed: 1.2, ink: '#00ffaa', paper: '#000a06', accent: '#44ff88', mix: 0, glyphs: 'custom', ramp: ' 01{}[]<>/\\|', pixelSize: 3, fx: fx(['bloom', 0.3]) },
  { id: 'a-galaxy', name: 'ASCII Galaxy', group: 'ASCII', kind: 'field', source: 'galaxy', intensity: 60, scale: 5, speed: 0.8, ink: '#aaaaff', paper: '#000008', accent: '#ffaaff', mix: 25, glyphs: 'ramp', pixelSize: 3, params: { arms: 3, wind: 16 } },
  { id: 'a-vapour', name: 'Vapour', group: 'ASCII', kind: 'field', source: 'smoke', intensity: 55, scale: 5, speed: 0.5, ink: '#d0d6e0', paper: '#08090a', accent: '#5e6ad2', mix: 25, glyphs: 'custom', ramp: ' .:-=+*#%@', pixelSize: 4, fx: fx(['vignette', 0.35]) },
  { id: 'a-drain', name: 'Drain', group: 'ASCII', kind: 'field', source: 'vortex', intensity: 60, scale: 5, speed: 0.9, ink: '#ffaa33', paper: '#0a0600', accent: '#ffffff', mix: 20, glyphs: 'ramp', pixelSize: 3, fx: fx(['vignette', 0.4]) },
  { id: 'a-warp', name: 'ASCII Marble', group: 'ASCII', kind: 'field', source: 'warp', intensity: 58, scale: 3, speed: 0.4, ink: '#c9d4ff', paper: '#04060f', accent: '#5e6ad2', mix: 22, glyphs: 'custom', ramp: ' `.-:;=+xX#@', pixelSize: 3, params: { warp: 1.3 } },
  { id: 'a-chladni', name: 'ASCII Plate', group: 'ASCII', kind: 'field', source: 'chladni', intensity: 62, scale: 4, speed: 0.3, ink: '#f0ead8', paper: '#12100c', accent: '#c8a24a', mix: 20, glyphs: 'ramp', pixelSize: 3, params: { m: 6, n: 10, sweep: 2, sharp: 9 } },

  // ----- Dimensional -----
  { id: 'd-wire', name: 'Wire Sunset', group: 'Dimensional', kind: 'figure', source: 'wire-terrain', intensity: 60, scale: 4, speed: 0.6, ink: '#ff66aa', paper: '#0a0014', accent: '#ffcc66', mix: 0, params: { cols: 34, rows: 22, height: 1.2 }, fx: fx(['bloom', 0.35], ['vignette', 0.45]) },
  { id: 'd-survey', name: 'Survey Flight', group: 'Dimensional', kind: 'figure', source: 'wire-terrain', intensity: 45, scale: 6, speed: 0.4, ink: '#66ffcc', paper: '#001014', accent: '#ffffff', mix: 0, params: { cols: 50, rows: 30, height: 0.7 }, fx: fx(['scanlines', 0.3], ['vignette', 0.4]) },
  { id: 'd-torus', name: 'Torus', group: 'Dimensional', kind: 'figure', source: 'particle-ring', intensity: 55, scale: 4, speed: 0.8, ink: '#ffffff', paper: '#000000', accent: '#888888', mix: 0, params: { points: 20, tube: 0.4 }, fx: fx(['vignette', 0.4]) },
  { id: 'd-sphere', name: 'Sphere', group: 'Dimensional', kind: 'figure', source: 'sphere', intensity: 60, scale: 4, speed: 0.5, ink: '#111111', paper: '#f0efe9', accent: '#666666', mix: 0, fx: fx(['grain', 0.2]) },
  { id: 'd-haul', name: 'Long Haul', group: 'Dimensional', kind: 'field', source: 'drift', intensity: 65, scale: 5, speed: 1, ink: '#c9d4ff', paper: '#04060f', accent: '#5e6ad2', mix: 35, mask: 'bayer8', fx: fx(['bloom', 0.3], ['vignette', 0.45]) },
  { id: 'd-kaleido', name: 'Kaleidoscope', group: 'Dimensional', kind: 'field', source: 'kaleidoscope', intensity: 60, scale: 6, speed: 0.7, ink: '#ffcc66', paper: '#12060a', accent: '#ff4488', mix: 45, mask: 'halftone', pixelSize: 2, params: { mirrors: 9 }, fx: fx(['bloom', 0.3], ['vignette', 0.4]) },
  { id: 'd-aperture', name: 'Aperture', group: 'Dimensional', kind: 'figure', source: 'dot-tunnel', intensity: 55, scale: 4, speed: 0.9, ink: '#f7f8f8', paper: '#08090a', accent: '#5e6ad2', mix: 0, params: { rings: 26, dots: 30, shear: 2.6 }, fx: fx(['bloom', 0.3], ['vignette', 0.4]) },

  // ----- Quiet -----
  { id: 'q-water', name: 'Still Water', group: 'Quiet', kind: 'field', source: 'ripple', intensity: 40, scale: 3, speed: 0.3, ink: '#d0d6e0', paper: '#0d0e10', accent: '#5e6ad2', mix: 15, mask: 'blue-noise', pixelSize: 2, params: { rings: 1.4, rate: 2, decay: 0.7 }, fx: fx(['vignette', 0.3]) },
  { id: 'q-heart', name: 'Resting Rate', group: 'Quiet', kind: 'field', source: 'heartbeat', intensity: 45, scale: 4, speed: 0.4, ink: '#e8b0b0', paper: '#0f0608', accent: '#ff6688', mix: 25, mask: 'bayer8', fx: fx(['bloom', 0.25], ['vignette', 0.35]) },
  { id: 'q-bodies', name: 'Two Bodies', group: 'Quiet', kind: 'field', source: 'gravity', intensity: 45, scale: 4, speed: 0.35, ink: '#c0c8d8', paper: '#06070a', accent: '#8a8f98', mix: 20, mask: 'bayer4', fx: fx(['vignette', 0.4]) },
  { id: 'q-currents', name: 'Currents', group: 'Quiet', kind: 'figure', source: 'flow-lines', intensity: 40, scale: 4, speed: 0.35, ink: '#d0d6e0', paper: '#08090a', accent: '#5e6ad2', mix: 0, params: { lines: 220, steps: 60, stride: 3, weight: 0.7 }, fx: fx(['grain', 0.15], ['vignette', 0.35]) },
  { id: 'q-dots', name: 'Halftone Dots', group: 'Quiet', kind: 'figure', source: 'dot-grid', intensity: 45, scale: 4, speed: 0.4, ink: '#0f1011', paper: '#f5f6f6', accent: '#5e6ad2', mix: 0, fx: fx(['grain', 0.15]) },
  { id: 'q-bloom', name: 'Slow Bloom', group: 'Quiet', kind: 'figure', source: 'dot-bloom', intensity: 40, scale: 4, speed: 0.35, ink: '#f7f8f8', paper: '#08090a', accent: '#828fff', mix: 0, fx: fx(['bloom', 0.3], ['vignette', 0.4]) },
  { id: 'q-horizon', name: 'Horizon', group: 'Quiet', kind: 'field', source: 'mirage', intensity: 40, scale: 3, speed: 0.3, ink: '#f0e0c0', paper: '#12100a', accent: '#d4a850', mix: 20, mask: 'lines', pixelSize: 2, fx: fx(['grain', 0.2], ['vignette', 0.4]) },
  { id: 'q-drift', name: 'Slow Curl', group: 'Quiet', kind: 'field', source: 'curl', intensity: 42, scale: 2.6, speed: 0.25, ink: '#c8cfda', paper: '#0a0b0d', accent: '#5e6ad2', mix: 18, mask: 'blue-noise', pixelSize: 2, params: { push: 0.22, stripes: 5 }, fx: fx(['vignette', 0.36]) },

  // ----- Type -----
  { id: 'y-ribbon', name: 'Ribbon', group: 'Type', kind: 'figure', source: 'text-wave', intensity: 55, scale: 5, speed: 0.8, ink: '#f7f8f8', paper: '#08090a', accent: '#5e6ad2', mix: 0, text: 'RIBBIT', fx: fx(['bloom', 0.25], ['vignette', 0.35]) },
  { id: 'y-marquee', name: 'Marquee', group: 'Type', kind: 'figure', source: 'type-cascade', intensity: 50, scale: 5, speed: 0.7, ink: '#ffcc00', paper: '#12060a', accent: '#ff4488', mix: 0, text: 'SIGNAL, DITHER, LOOP', fx: fx(['bloom', 0.3], ['scanlines', 0.25]) },
  { id: 'y-press', name: 'Letterpress', group: 'Type', kind: 'figure', source: 'text-wave', intensity: 45, scale: 6, speed: 0.5, ink: '#141414', paper: '#f2f0ea', accent: '#cc2222', mix: 0, text: 'RIBBIT', fx: fx(['grain', 0.25]) },
]

export const PRESET_GROUPS = [
  'House',
  'Mathematic',
  'Cyber',
  'Terminal',
  'Print',
  'Warm',
  'Cool',
  'Glitch',
  'ASCII',
  'Dimensional',
  'Quiet',
  'Type',
] as const

/**
 * Apply a preset onto a document, in place.
 *
 * The quantize fields reset to the preset's values or to their defaults rather
 * than being left alone, because a half-applied look is worse than no look: a
 * preset built for a fine blue-noise mask arriving on top of somebody's
 * pixel-size-eight setting is a picture neither of them designed. The
 * generator's own controls reset the same way, by being replaced wholesale.
 *
 * The canvas block is the deliberate exception. Size, duration and frame cap
 * are the user's staging, not part of the look.
 */
export function applyPreset(doc: SignalDoc, p: Preset) {
  doc.source.kind = p.kind
  doc.source.id = p.source
  doc.source.intensity = p.intensity
  doc.source.scale = p.scale
  doc.source.speed = p.speed
  doc.source.params = p.params ? { ...p.params } : {}

  doc.ink.ink = p.ink
  doc.ink.paper = p.paper
  doc.ink.accent = p.accent
  doc.ink.mix = p.mix
  doc.ink.mode = p.mode ?? 'blend'
  doc.ink.palette = 'none'

  doc.quantize.mask = p.mask ?? 'bayer4'
  doc.quantize.threshold = p.threshold ?? 128
  doc.quantize.spread = p.spread ?? 50
  doc.quantize.pixelSize = p.pixelSize ?? 2
  doc.quantize.randomness = p.randomness ?? 0
  doc.quantize.detail = p.detail ?? 2
  doc.quantize.glyphs = p.glyphs ?? 'off'
  if (p.ramp) doc.quantize.ramp = p.ramp

  if (p.text) doc.motion.text = p.text

  doc.fx = p.fx ? JSON.parse(JSON.stringify(p.fx)) : {}
}
