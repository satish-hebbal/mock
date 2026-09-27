/**
 * Flow: the same engine as Studio, wired as a graph.
 *
 * Studio is one fixed pipeline (layers, a style, a finish) edited through a
 * panel. Flow is the pipeline taken apart into nodes you can wire however you
 * like: two styles of the same photograph mixed together, a halftone screened
 * over an oil painting, a mask made from one branch and applied to another. No
 * node does anything Studio cannot; they are the same functions, which is why
 * a straight chain can go back to Studio as an ordinary document.
 *
 * A node's output is always a picture the size the graph is being drawn at.
 * Ports are named, so a Mix knows which input is the base and which goes over
 * it, and every input takes one wire.
 */

import type { FxId, FxSettings } from '../../lib/postfx'
import type { ParamBag } from '../params'
import type { AsciiDoc } from '../types'

export type NodeKind = 'image' | 'filter' | 'style' | 'finish' | 'mix' | 'output'

export type PortId = 'in' | 'a' | 'b'

/** The look a Style node renders with: a whole Studio treatment, less the picture and the layers. */
export type StyleLook = Pick<
  AsciiDoc,
  'style' | 'ramp' | 'customRamp' | 'grid' | 'tone' | 'color' | 'dither' | 'backdrop' | 'fx' | 'finish' | 'styleParams'
>

export type MixMode = 'source-over' | 'screen' | 'multiply' | 'overlay' | 'soft-light' | 'difference' | 'lighter' | 'color-dodge'

export type MixMask = 'none' | 'luma' | 'inverse' | 'left' | 'top' | 'radial'

export interface ImageData_ {
  /** 'studio' follows whatever picture Studio has; an asset id is a picture of this node's own */
  source: 'studio' | string
  name?: string
}

export interface FilterNodeData {
  kind: string
  params: ParamBag
}

export interface FinishNodeData {
  fx: FxId
  settings: FxSettings
}

export interface MixNodeData {
  mode: MixMode
  amount: number
  mask: MixMask
}

export type NodeData =
  | { kind: 'image'; image: ImageData_ }
  | { kind: 'filter'; filter: FilterNodeData }
  | { kind: 'style'; look: StyleLook }
  | { kind: 'finish'; finish: FinishNodeData }
  | { kind: 'mix'; mix: MixNodeData }
  | { kind: 'output' }

export type FlowNode = {
  id: string
  x: number
  y: number
  /** passes its main input straight through, so a branch can be compared with and without */
  bypass?: boolean
} & NodeData

export interface FlowEdge {
  id: string
  from: string
  to: string
  port: PortId
}

export interface FlowDoc {
  version: 1
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** pan and zoom of the graph canvas */
  view: { x: number; y: number; zoom: number }
}

/** The inputs a node kind takes, in the order they are drawn down its left edge. */
export function inputsOf(kind: NodeKind): PortId[] {
  switch (kind) {
    case 'image':
      return []
    case 'mix':
      return ['a', 'b']
    default:
      return ['in']
  }
}

export function hasOutput(kind: NodeKind): boolean {
  return kind !== 'output'
}

export const PORT_LABEL: Record<PortId, string> = { in: 'In', a: 'Base', b: 'Over' }

export const NODE_W = 188
