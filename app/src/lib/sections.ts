import { Box, Camera, Crop, Image as ImageIcon, Plus, type LucideIcon } from 'lucide-react'
import type { ToolSection } from '../store'

/**
 * The left rail's sections, in order. The rail draws the buttons and the panel
 * draws the bodies, so the names and glyphs live here where both can read them
 * without either file importing the other.
 *
 * Ordered by how much work each one has to offer, not by where it sits in a
 * render pipeline. Camera is deliberately low: its whole panel is eight angle
 * presets and a straighten button, so a shot is usually one click and done,
 * and holding second place meant the sections you actually live in (the
 * backdrop, the lighting, the frame) all sat below something you had finished
 * with. Add stays last because inserting an overlay is the step after the shot
 * is composed, not part of composing it.
 */
export const SECTIONS: { id: ToolSection; label: string; icon: LucideIcon }[] = [
  { id: 'devices', label: 'Devices', icon: Box },
  { id: 'frame', label: 'Frame', icon: Crop },
  { id: 'background', label: 'Scene', icon: ImageIcon },
  { id: 'camera', label: 'Camera', icon: Camera },
  { id: 'add', label: 'Add', icon: Plus },
]
