/**
 * The right column in Flow: the result, then the selected node.
 *
 * The result is always on top, so whatever you are adjusting further down,
 * the picture it changes is in view. A node's settings come from the same
 * param rows Studio uses, and a Style node gets Studio's own style grid, so
 * nothing in Flow has to be learnt twice.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeftToLine, Copy, Eye, EyeOff, ImagePlus, RefreshCw, Trash2 } from 'lucide-react'
import { ColorRow, Dropdown, InfoTip, MiniButton, Segments, SliderRow, SubHeading } from '../../components/controls'
import { FX_ORDER, FX_BY_ID } from '../../lib/postfx'
import { pickMediaFile } from '../../store'
import { ParamControls } from '../AsciiParams'
import { StyleGrid } from '../AsciiStylePicker'
import { FILTERS, getFilter } from '../filters'
import { GRADIENTS } from '../gradients'
import { RAMPS } from '../ramps'
import { getStyle } from '../styles'
import { useAscii } from '../store'
import type { ColorMode } from '../types'
import type { FlowRender } from './FlowEditor'
import { KIND_COLOR, KIND_LABEL, nodeIcon, nodeTitle } from './meta'
import { lookFromDoc, studioFromFlow, useFlow } from './store'
import type { FlowNode, MixMask, MixMode } from './types'

const pct = (v: number) => `${Math.round(v * 100)}%`

function Result({ render }: { render: FlowRender }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const c = render.result
    if (!el || !c) return
    el.width = c.width
    el.height = c.height
    el.getContext('2d')!.drawImage(c, 0, 0)
  }, [render.result, render.tick])
  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-md border border-(--line) bg-(--field)">
      {render.result ? (
        <canvas ref={ref} className="block h-auto w-full" />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center t-caption text-(--tx3)">No output yet</div>
      )}
    </div>
  )
}

/** Change one node through history, with a label so slider drags coalesce. */
function edit(id: string, label: string, fn: (n: FlowNode) => void) {
  useFlow.getState().patch((f) => {
    const n = f.nodes.find((q) => q.id === id)
    if (n) fn(n)
  }, label)
}

const MIX_MODES: { value: MixMode; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'screen', label: 'Screen' },
  { value: 'lighter', label: 'Add' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft light' },
  { value: 'color-dodge', label: 'Dodge' },
  { value: 'difference', label: 'Difference' },
]

const MIX_MASKS: { value: MixMask; label: string }[] = [
  { value: 'none', label: 'No mask' },
  { value: 'luma', label: 'Over, by its brightness' },
  { value: 'inverse', label: 'Over, by its shadows' },
  { value: 'left', label: 'Fade left to right' },
  { value: 'top', label: 'Fade top to bottom' },
  { value: 'radial', label: 'Centre only' },
]

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 'source', label: 'Photo' },
  { id: 'ink', label: 'Ink' },
  { id: 'duotone', label: 'Duo' },
  { id: 'gradient', label: 'Map' },
  { id: 'spectrum', label: 'Hue' },
]

function StyleSettings({ node }: { node: Extract<FlowNode, { kind: 'style' }> }) {
  const [searching] = useState(false)
  const look = node.look
  const spec = getStyle(look.style)
  const set = (label: string, fn: (l: typeof look) => void) =>
    edit(node.id, label, (n) => {
      if (n.kind === 'style') fn(n.look)
    })

  return (
    <>
      <StyleGrid
        value={look.style}
        searching={searching}
        onPick={(id) =>
          set('', (l) => {
            const was = getStyle(l.style)
            const now = getStyle(id)
            l.style = id
            if (now.square !== was.square) l.grid.aspect = now.square ? 1 : 1.8
            if (now.cell) l.grid.cell = now.cell
            else if (now.group === 'raster' && was.group !== 'raster') l.grid.cell = Math.max(l.grid.cell, 18)
          })
        }
      />
      <div className="mt-3">
        {spec.params && (
          <ParamControls
            specs={spec.params}
            values={look.styleParams?.[look.style]}
            prefix={`flow-${node.id}-sp`}
            onChange={(k, v, label) =>
              set(label, (l) => {
                l.styleParams ??= {}
                const bag = (l.styleParams[l.style] ??= {})
                bag[k] = v
              })
            }
          />
        )}
        {spec.ramp && (
          <div className="my-0.5 flex items-center gap-2">
            <span className="w-16 shrink-0 t-caption text-(--tx3)">Characters</span>
            <Dropdown
              className="min-w-0 flex-1"
              value={look.ramp}
              options={RAMPS.map((r) => ({ value: r.id, label: r.label }))}
              onChange={(v) => set('', (l) => void (l.ramp = v))}
            />
          </div>
        )}
        {spec.group !== 'process' && (
          <SliderRow
            label="Cell"
            value={look.grid.cell}
            min={3}
            max={64}
            step={1}
            format={(v) => `${v}px`}
            onChange={(v) => set(`flow-${node.id}-cell`, (l) => void (l.grid.cell = v))}
          />
        )}
        <SliderRow
          label="Contrast"
          value={look.tone.contrast}
          min={0}
          max={200}
          step={1}
          onChange={(v) => set(`flow-${node.id}-contrast`, (l) => void (l.tone.contrast = v))}
        />
        <SliderRow
          label="Brightness"
          value={look.tone.brightness}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => set(`flow-${node.id}-bright`, (l) => void (l.tone.brightness = v))}
        />
        {spec.group !== 'process' && (
          <>
            <SubHeading>Colour</SubHeading>
            <Segments options={COLOR_MODES} value={look.color.mode} compact onChange={(m) => set('', (l) => void (l.color.mode = m))} />
            {(look.color.mode === 'ink' || look.color.mode === 'duotone') && (
              <ColorRow label="Ink" value={look.color.ink} onChange={(v) => set(`flow-${node.id}-ink`, (l) => void (l.color.ink = v))} />
            )}
            {look.color.mode === 'duotone' && (
              <ColorRow label="Highlights" value={look.color.ink2} onChange={(v) => set(`flow-${node.id}-ink2`, (l) => void (l.color.ink2 = v))} />
            )}
            {look.color.mode === 'gradient' && (
              <Dropdown
                value={look.color.gradient ?? 'thermal'}
                options={GRADIENTS.map((g) => ({ value: g.id, label: g.label }))}
                onChange={(v) => set('', (l) => void (l.color.gradient = v))}
              />
            )}
          </>
        )}
        <SubHeading>Backdrop</SubHeading>
        <Segments
          compact
          options={[
            { id: 'paper', label: 'Paper' },
            { id: 'source', label: 'Photo' },
            { id: 'blurred', label: 'Blur' },
            { id: 'transparent', label: 'None' },
          ]}
          value={look.backdrop.mode === 'mesh' ? 'paper' : look.backdrop.mode}
          onChange={(m) => set('', (l) => void (l.backdrop.mode = m))}
        />
        {look.backdrop.mode === 'paper' && (
          <ColorRow label="Paper" value={look.backdrop.color} onChange={(v) => set(`flow-${node.id}-paper`, (l) => void (l.backdrop.color = v))} />
        )}
        <div className="mt-2">
          <MiniButton
            title="Copy every setting from Studio's current look into this node"
            onClick={() =>
              edit(node.id, '', (n) => {
                if (n.kind === 'style') n.look = lookFromDoc(useAscii.getState().doc)
              })
            }
          >
            <ArrowLeftToLine size={12} strokeWidth={2} />
            Take Studio's look
          </MiniButton>
        </div>
      </div>
    </>
  )
}

function NodeSettings({ node }: { node: FlowNode }) {
  switch (node.kind) {
    case 'image':
      return (
        <>
          <Segments
            options={[
              { id: 'studio', label: "Studio's picture" },
              { id: 'own', label: 'Its own' },
            ]}
            value={node.image.source === 'studio' ? 'studio' : 'own'}
            onChange={(v) => {
              if (v === 'studio') edit(node.id, '', (n) => void (n.kind === 'image' && (n.image = { source: 'studio' })))
              else pickMediaFile((f) => void useFlow.getState().loadImage(node.id, f, (f as File).name), false)
            }}
          />
          <MiniButton onClick={() => pickMediaFile((f) => void useFlow.getState().loadImage(node.id, f, (f as File).name), false)}>
            <ImagePlus size={13} strokeWidth={1.9} />
            Choose a picture
          </MiniButton>
          <p className="mt-2 t-caption text-(--tx3)">Two Image nodes into a Mix is how two photographs meet.</p>
        </>
      )
    case 'filter': {
      const spec = getFilter(node.filter.kind)
      return (
        <>
          <Dropdown
            value={node.filter.kind}
            options={FILTERS.map((f) => ({ value: f.id, label: f.label }))}
            onChange={(v) =>
              edit(node.id, '', (n) => {
                const s = getFilter(v)
                if (n.kind === 'filter' && s) n.filter = { kind: v, params: {} }
              })
            }
          />
          <div className="mt-2">
            {spec && (
              <ParamControls
                specs={spec.params}
                values={node.filter.params}
                prefix={`flow-${node.id}`}
                onChange={(k, v, label) =>
                  edit(node.id, label, (n) => {
                    if (n.kind === 'filter') n.filter.params[k] = v
                  })
                }
              />
            )}
          </div>
        </>
      )
    }
    case 'style':
      return <StyleSettings node={node} />
    case 'finish': {
      const spec = FX_BY_ID[node.finish.fx]
      return (
        <>
          <Dropdown
            value={node.finish.fx}
            options={FX_ORDER.map((f) => ({ value: f.id, label: f.label }))}
            onChange={(v) => edit(node.id, '', (n) => void (n.kind === 'finish' && (n.finish.fx = v)))}
          />
          <div className="mt-2">
            <SliderRow
              label="Amount"
              value={node.finish.settings.amount}
              min={0}
              max={1}
              step={0.01}
              format={pct}
              onChange={(v) => edit(node.id, `flow-${node.id}-amt`, (n) => void (n.kind === 'finish' && (n.finish.settings.amount = v)))}
            />
            {spec?.colors?.map((key) => (
              <ColorRow
                key={key}
                label={key === 'color' ? 'Colour' : 'Second colour'}
                value={(node.finish.settings[key] as string | undefined) ?? '#ffffff'}
                onChange={(v) => edit(node.id, `flow-${node.id}-${key}`, (n) => void (n.kind === 'finish' && (n.finish.settings[key] = v)))}
              />
            ))}
          </div>
        </>
      )
    }
    case 'mix':
      return (
        <>
          <Dropdown
            value={node.mix.mode}
            options={MIX_MODES}
            onChange={(v) => edit(node.id, '', (n) => void (n.kind === 'mix' && (n.mix.mode = v)))}
          />
          <div className="mt-2">
            <SliderRow
              label="Amount"
              value={node.mix.amount}
              min={0}
              max={1}
              step={0.01}
              format={pct}
              onChange={(v) => edit(node.id, `flow-${node.id}-mix`, (n) => void (n.kind === 'mix' && (n.mix.amount = v)))}
            />
            <Dropdown
              value={node.mix.mask}
              options={MIX_MASKS}
              onChange={(v) => edit(node.id, '', (n) => void (n.kind === 'mix' && (n.mix.mask = v)))}
            />
          </div>
        </>
      )
    default:
      return <p className="t-caption text-(--tx3)">The graph's result. Export takes the picture from here.</p>
  }
}

export function FlowInspector({ render }: { render: FlowRender }) {
  const selected = useFlow((s) => s.flow.nodes.find((n) => n.id === s.selected))
  const flow = useFlow((s) => s.flow)
  const straight = typeof studioFromFlow(flow) !== 'string'
  const st = useFlow.getState

  return (
    <>
      <Result render={render} />
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-(--line)">
        {selected ? (
          <div className="p-3">
            <div className="mb-2.5 flex items-center gap-2">
              {(() => {
                const Icon = nodeIcon(selected)
                const color = KIND_COLOR[selected.kind]
                return (
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm"
                    style={{ background: `color-mix(in srgb, ${color} 22%, transparent)`, color }}
                  >
                    <Icon size={13} strokeWidth={2} />
                  </span>
                )
              })()}
              <div className="min-w-0 flex-1">
                <p className="truncate t-body-sm font-semibold text-(--tx)">{nodeTitle(selected)}</p>
                <p className="t-caption text-(--tx3)">{KIND_LABEL[selected.kind]}</p>
              </div>
              {selected.kind !== 'image' && selected.kind !== 'output' && (
                <button
                  onClick={() => edit(selected.id, '', (n) => void (n.bypass = !n.bypass))}
                  title={selected.bypass ? 'Turn back on' : 'Bypass'}
                  className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
                >
                  {selected.bypass ? <EyeOff size={13} strokeWidth={1.9} /> : <Eye size={13} strokeWidth={1.9} />}
                </button>
              )}
              <button
                onClick={() => st().duplicateNode(selected.id)}
                title="Duplicate (Ctrl+D)"
                className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
              >
                <Copy size={12} strokeWidth={1.9} />
              </button>
              <button
                onClick={() => st().removeNode(selected.id)}
                title="Remove (Delete)"
                className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
              >
                <Trash2 size={12} strokeWidth={1.9} />
              </button>
            </div>
            <NodeSettings node={selected} />
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            <p className="t-caption text-(--tx3)">Select a node to change it. Drag between the round ports to wire nodes together.</p>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t border-(--line) p-2">
        <MiniButton onClick={() => st().fromStudio()} title="Replace this graph with Studio's current look, as nodes">
          <RefreshCw size={12} strokeWidth={2} />
          From Studio
        </MiniButton>
        <MiniButton
          onClick={() => st().toStudio()}
          title={straight ? 'Open this chain in Studio as an ordinary document' : 'Only a straight chain (picture, filters, one style, effects) fits Studio'}
        >
          <ArrowLeftToLine size={12} strokeWidth={2} className="rotate-180" />
          To Studio
        </MiniButton>
        <span className="ml-auto">
          <InfoTip>Flow uses the same engine as Studio. A straight chain goes back to Studio as an ordinary document.</InfoTip>
        </span>
      </div>
    </>
  )
}
