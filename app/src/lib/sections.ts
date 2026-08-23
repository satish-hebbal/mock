import { Box, Camera, Crop, Image as ImageIcon, Plus, type LucideIcon } from 'lucide-react'
import type { ToolSection } from '../store'

/**
 * The left rail's sections, in order. The rail draws the buttons and the panel
 * draws the bodies, so the names and glyphs live here where both can read them
 * without either file importing the other.
 *
 * Ordered the way a shot gets built, not the way it gets rendered: pick the
 * device, decide the shape of the picture, dress and light the set, and only
 * then stand somewhere and frame it. Camera sits fourth for that reason rather
 * than because it has little to offer — it carries the stage, which is the
 * longest-lived surface in the panel. Add stays last because inserting an
 * overlay is the step after the shot is composed, not part of composing it.
 */
export const SECTIONS: { id: ToolSection; label: string; icon: LucideIcon }[] = [
  { id: 'devices', label: 'Devices', icon: Box },
  { id: 'frame', label: 'Frame', icon: Crop },
  { id: 'background', label: 'Scene', icon: ImageIcon },
  { id: 'camera', label: 'Camera', icon: Camera },
  { id: 'add', label: 'Add', icon: Plus },
]
