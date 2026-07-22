import type { GradeState } from '../types'

export const NEUTRAL_GRADE: GradeState = {
  exposure: 1,
  contrast: 1,
  saturation: 1,
  temperature: 0,
}

export function isNeutralGrade(g: GradeState): boolean {
  return g.exposure === 1 && g.contrast === 1 && g.saturation === 1 && g.temperature === 0
}

/**
 * Build a CSS `filter` string from a color grade. Applied to the preview frame
 * (background + 3D canvas) and, verbatim, to the export composite so the two
 * stay pixel-parity (PRD §6.6). Temperature is approximated with sepia + hue
 * rotation: warm rotates toward orange, cool toward blue.
 */
export function gradeFilter(g: GradeState): string {
  const parts: string[] = []
  if (g.exposure !== 1) parts.push(`brightness(${g.exposure})`)
  if (g.contrast !== 1) parts.push(`contrast(${g.contrast})`)
  if (g.saturation !== 1) parts.push(`saturate(${g.saturation})`)
  if (g.temperature !== 0) {
    const amt = Math.min(1, Math.abs(g.temperature))
    if (g.temperature > 0) parts.push(`sepia(${(amt * 0.5).toFixed(3)})`)
    else {
      // cool: sepia then rotate the warm tint toward blue
      parts.push(`sepia(${(amt * 0.5).toFixed(3)})`)
      parts.push('hue-rotate(180deg)')
    }
  }
  return parts.join(' ')
}
