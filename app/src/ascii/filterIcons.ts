/**
 * One glyph per filter group, shared by the Layers page, the Flow palette and
 * the Flow node cards, so a warp looks like a warp wherever it turns up.
 */

import { Droplet, Gem, Palette, Tornado, Zap, type LucideIcon } from 'lucide-react'
import type { FilterGroup } from './filters'

export const GROUP_ICON: Record<FilterGroup, LucideIcon> = {
  warp: Tornado,
  blur: Droplet,
  glass: Gem,
  color: Palette,
  glitch: Zap,
}
