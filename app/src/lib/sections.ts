import { Box, Camera, Crop, Image as ImageIcon, Plus, type LucideIcon } from 'lucide-react'
import type { ToolSection } from '../store'

/**
 * The left rail's sections, in order. The rail draws the buttons and the panel
 * draws the bodies, so the names and glyphs live here where both can read them
 * without either file importing the other.
 */
export const SECTIONS: { id: ToolSection; label: string; icon: LucideIcon }[] = [
  { id: 'devices', label: 'Devices', icon: Box },
  { id: 'camera', label: 'Camera', icon: Camera },
  { id: 'frame', label: 'Frame', icon: Crop },
  { id: 'background', label: 'Scene', icon: ImageIcon },
  { id: 'add', label: 'Add', icon: Plus },
]
