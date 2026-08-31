/**
 * The shape bar's contents, kept apart from the component that renders them.
 *
 * The list is data, and two very different things need it: the toolbar, to draw
 * the buttons, and the global key handler, to work out what you just pressed.
 * Exporting it from the component file makes the bundler treat the toolbar as a
 * module with non-component exports and gives up on fast refresh for it, which
 * is a poor trade for saving a file.
 */

import {
  ArrowRight,
  Circle,
  Diamond,
  Eraser,
  Image as ImageIcon,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  StickyNote,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { notchFor } from '../lib/notch'
import type { DrawTool } from './types'

export interface ToolDef {
  id: DrawTool
  label: string
  icon: LucideIcon
  /** the digit printed in the corner, and the key that picks it */
  digit: string
  /** the letter that also picks it, the way Excalidraw doubles every shortcut up */
  letter: string
}

export const SHAPE_TOOLS: ToolDef[] = [
  { id: 'select', label: 'Selection', icon: MousePointer2, digit: '1', letter: 'v' },
  { id: 'rect', label: 'Rectangle', icon: Square, digit: '2', letter: 'r' },
  { id: 'diamond', label: 'Diamond', icon: Diamond, digit: '3', letter: 'd' },
  { id: 'ellipse', label: 'Ellipse', icon: Circle, digit: '4', letter: 'o' },
  { id: 'arrow', label: 'Arrow', icon: ArrowRight, digit: '5', letter: 'a' },
  { id: 'line', label: 'Line', icon: Minus, digit: '6', letter: 'l' },
  { id: 'freedraw', label: 'Draw', icon: Pencil, digit: '7', letter: 'x' },
  { id: 'text', label: 'Text', icon: Type, digit: '8', letter: 't' },
  { id: 'image', label: 'Image', icon: ImageIcon, digit: '9', letter: '' },
  // every digit is spoken for by the other nine tools, so this one keys off
  // its letter alone
  { id: 'note', label: 'Sticky note', icon: StickyNote, digit: '', letter: 's' },
  { id: 'eraser', label: 'Eraser', icon: Eraser, digit: '0', letter: 'e' },
]

/*
 * The pocket cut for the toolbar: lock, hand | the ten tools | export, more,
 * and the two rules between them. Sized from the row rather than guessed, and
 * kept here so the toolbar file exports nothing but components.
 */
export const DRAW_NOTCH = notchFor(2 + SHAPE_TOOLS.length + 2, 2)
