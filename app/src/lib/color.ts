/** Tiny hex helpers shared by the CSS preview and the export painter. */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const n = parseInt(full.slice(0, 6) || '000000', 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * `rgba()` for a hex colour. Fading a gradient stop to `transparent` instead
 * would interpolate through transparent *black* and leave a grey halo, so
 * every soft edge fades to the same colour at zero alpha.
 */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
