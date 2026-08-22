import type { ShotsGradient } from './types'

// Curated background "wallpapers" (shots.so-style one-click presets).
// Kept as CSS-expressible gradients so preview and canvas export match exactly.

export interface Wallpaper {
  id: string
  name: string
  gradient: ShotsGradient
}

export const WALLPAPERS: Wallpaper[] = [
  { id: 'sunset', name: 'Sunset', gradient: { kind: 'linear', angle: 135, from: '#ff9a9e', to: '#fecfef' } },
  { id: 'peach', name: 'Peach', gradient: { kind: 'linear', angle: 120, from: '#ffecd2', to: '#fcb69f' } },
  { id: 'grape', name: 'Grape', gradient: { kind: 'linear', angle: 135, from: '#7f7fd5', to: '#86a8e7' } },
  { id: 'ocean', name: 'Ocean', gradient: { kind: 'linear', angle: 160, from: '#2193b0', to: '#6dd5ed' } },
  { id: 'mint', name: 'Mint', gradient: { kind: 'linear', angle: 135, from: '#43e97b', to: '#38f9d7' } },
  { id: 'lavender', name: 'Lavender', gradient: { kind: 'linear', angle: 135, from: '#c471f5', to: '#fa71cd' } },
  { id: 'rose', name: 'Rose', gradient: { kind: 'linear', angle: 120, from: '#f43b47', to: '#453a94' } },
  { id: 'sky', name: 'Sky', gradient: { kind: 'linear', angle: 160, from: '#4facfe', to: '#00f2fe' } },
  { id: 'ember', name: 'Ember', gradient: { kind: 'linear', angle: 135, from: '#f83600', to: '#fe8c00' } },
  { id: 'aubergine', name: 'Aubergine', gradient: { kind: 'radial', angle: 0, from: '#654ea3', to: '#2b1055' } },
  { id: 'slate', name: 'Slate', gradient: { kind: 'linear', angle: 145, from: '#485563', to: '#29323c' } },
  { id: 'midnight', name: 'Midnight', gradient: { kind: 'radial', angle: 0, from: '#232a4d', to: '#0b0f1e' } },
  { id: 'coral', name: 'Coral', gradient: { kind: 'linear', angle: 120, from: '#ff6a88', to: '#ff99ac' } },
  { id: 'forest', name: 'Forest', gradient: { kind: 'linear', angle: 150, from: '#134e5e', to: '#71b280' } },
  { id: 'gold', name: 'Gold', gradient: { kind: 'linear', angle: 120, from: '#f7971e', to: '#ffd200' } },
  { id: 'ice', name: 'Ice', gradient: { kind: 'linear', angle: 135, from: '#e0eafc', to: '#cfdef3' } },
]

export function getWallpaper(id: string): Wallpaper {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0]
}

// ————— Curated solid-color swatches —————
export const SOLID_COLORS: string[] = [
  '#0a0a0c',
  '#15151b',
  '#ffffff',
  '#f5f2ea',
  '#e8e4d8',
  '#6d7cff',
  '#ff6b6b',
  '#ffb86b',
  '#3ddc97',
  '#38bdf8',
  '#a78bfa',
  '#f472b6',
]

/** CSS background string for a gradient spec (preview parity with canvas export). */
export function gradientCss(g: ShotsGradient): string {
  return g.kind === 'radial'
    ? `radial-gradient(circle at 50% 40%, ${g.from}, ${g.to})`
    : `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`
}
