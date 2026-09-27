/**
 * What a node is called, what it looks like, and the colour it wears, shared by
 * the graph, the palette and the inspector.
 */

import {
  Image as ImageIcon,
  Merge,
  Monitor,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { FX_BY_ID } from '../../lib/postfx'
import { GROUP_ICON } from '../filterIcons'
import { getFilter } from '../filters'
import { getStyle } from '../styles'
import type { FlowNode, NodeKind } from './types'

/** The drag payload type for palette items dropped on the graph. */
export const DRAG_MIME = 'application/x-ribbit-node'

/** A hue per kind of node, for its chip, its ports and the wires leaving it. */
export const KIND_COLOR: Record<NodeKind, string> = {
  image: '#34c3a0',
  filter: '#9b7bff',
  style: '#f5b83d',
  finish: '#ff6fae',
  mix: '#4fa8ff',
  output: '#e8e8ea',
}

export function nodeTitle(n: FlowNode): string {
  switch (n.kind) {
    case 'image':
      return n.image.source === 'studio' ? 'Studio picture' : (n.image.name ?? 'Picture')
    case 'filter':
      return getFilter(n.filter.kind)?.label ?? 'Filter'
    case 'style':
      return getStyle(n.look.style).label
    case 'finish':
      return FX_BY_ID[n.finish.fx]?.label ?? 'Effect'
    case 'mix':
      return 'Mix'
    default:
      return 'Output'
  }
}

export function nodeIcon(n: FlowNode): LucideIcon {
  switch (n.kind) {
    case 'image':
      return ImageIcon
    case 'filter': {
      const spec = getFilter(n.filter.kind)
      return spec ? GROUP_ICON[spec.group] : Workflow
    }
    case 'style':
      return getStyle(n.look.style).icon
    case 'finish':
      return Sparkles
    case 'mix':
      return Merge
    default:
      return Monitor
  }
}

export const KIND_LABEL: Record<NodeKind, string> = {
  image: 'Picture',
  filter: 'Filter',
  style: 'Style',
  finish: 'Finish',
  mix: 'Mix',
  output: 'Output',
}

