/**
 * The node palette.
 *
 * Five kinds of node, as five glyphs across the top, and under them pictures
 * of what each node in that kind does to your photograph. Click one to drop it
 * in the middle of the view, or drag it to where it should go. The pictures
 * are the same thumbnails Studio's panel uses, so a node looks the same in
 * both places.
 */

import { useState } from 'react'
import { Image as ImageIcon, Layers, Merge, Monitor, Sparkles, Type, type LucideIcon } from 'lucide-react'
import { FX_ORDER } from '../../lib/postfx'
import { Tile, TileGrid } from '../../signal/SignalTiles'
import { SubHeading } from '../../components/controls'
import { FilterArt, FinishArt, StyleArt } from '../AsciiThumbs'
import { GROUP_ICON } from '../filterIcons'
import { FILTERS, FILTER_GROUPS } from '../filters'
import { STYLES, STYLE_FAMILIES } from '../styles'
import { useFlow } from './store'
import { DRAG_MIME } from './meta'
import type { NodeKind } from './types'

type Cat = 'source' | 'style' | 'filter' | 'finish' | 'combine'

const CATS: { id: Cat; label: string; icon: LucideIcon }[] = [
  { id: 'source', label: 'Picture', icon: ImageIcon },
  { id: 'filter', label: 'Filters', icon: Layers },
  { id: 'style', label: 'Styles', icon: Type },
  { id: 'finish', label: 'Finish', icon: Sparkles },
  { id: 'combine', label: 'Combine', icon: Merge },
]


/** Where a click-added node lands: the middle of what the graph is showing. */
function addAtCentre(kind: NodeKind, what?: string) {
  const f = useFlow.getState()
  const el = document.querySelector('[data-flow-graph]') as HTMLElement | null
  const { x, y, zoom } = f.flow.view
  const w = el?.clientWidth ?? 800
  const h = el?.clientHeight ?? 600
  // a little scatter so a second click does not stack exactly on the first
  const jitter = (f.flow.nodes.length % 5) * 18
  f.addNode(kind, (w / 2 - x) / zoom - 94 + jitter, (h / 2 - y) / zoom - 60 + jitter, what)
}

function dragProps(kind: NodeKind, what?: string) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind, what }))
      e.dataTransfer.effectAllowed = 'copy'
    },
  }
}

function Card({ icon: Icon, label, hint, kind, what }: { icon: LucideIcon; label: string; hint: string; kind: NodeKind; what?: string }) {
  return (
    <button
      {...dragProps(kind, what)}
      onClick={() => addAtCentre(kind, what)}
      title={hint}
      className="flex w-full items-center gap-2.5 rounded-md border border-(--line) px-2.5 py-2 text-left transition-colors hover:border-(--line2) hover:bg-(--field)"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-(--field) text-(--tx2)">
        <Icon size={15} strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block t-body-sm font-medium text-(--tx)">{label}</span>
        <span className="block truncate t-caption text-(--tx3)">{hint}</span>
      </span>
    </button>
  )
}

const COLS = 3

export function FlowPalette() {
  const [cat, setCat] = useState<Cat>('filter')

  return (
    <div className="flex w-[232px] shrink-0 flex-col border-r border-(--line)">
      <div className="shrink-0 border-b border-(--line) p-2">
        <div className="grid grid-cols-5 gap-0.5 rounded-sm bg-(--field) p-0.5">
          {CATS.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              title={c.label}
              aria-label={c.label}
              aria-pressed={cat === c.id}
              className={`flex h-7 items-center justify-center rounded-xs transition-colors ${
                cat === c.id ? 'bg-(--sel) text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'
              }`}
            >
              <c.icon size={14} strokeWidth={1.8} />
            </button>
          ))}
        </div>
        <p className="mt-1.5 px-0.5 t-caption text-(--tx3)">Click to add, or drag onto the graph.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {cat === 'source' && (
          <div className="flex flex-col gap-1.5">
            <Card icon={ImageIcon} label="Image" hint="A photograph: Studio's, or one of its own" kind="image" />
            <Card icon={Monitor} label="Output" hint="What the graph exports" kind="output" />
          </div>
        )}
        {cat === 'combine' && (
          <div className="flex flex-col gap-1.5">
            <Card icon={Merge} label="Mix" hint="Two branches blended, with an optional mask" kind="mix" />
            <Card icon={Monitor} label="Output" hint="What the graph exports" kind="output" />
          </div>
        )}
        {cat === 'style' &&
          STYLE_FAMILIES.map((f) => (
            <div key={f.id} className="mb-3">
              <SubHeading icon={<f.icon size={11} strokeWidth={2} />}>{f.label}</SubHeading>
              <TileGrid cols={COLS}>
                {STYLES.filter((s) => s.family === f.id).map((s, i) => (
                  <div key={s.id} className="[&>button]:w-full" {...dragProps('style', s.id)}>
                    <Tile
                      index={i}
                      cols={COLS}
                      label={s.label}
                      hint={s.hint}
                      on={false}
                      onPick={() => addAtCentre('style', s.id)}
                      art={<StyleArt id={s.id} />}
                    />
                  </div>
                ))}
              </TileGrid>
            </div>
          ))}
        {cat === 'filter' &&
          FILTER_GROUPS.map((g) => {
            const Icon = GROUP_ICON[g.id]
            return (
              <div key={g.id} className="mb-3">
                <SubHeading icon={<Icon size={11} strokeWidth={2} />}>{g.label}</SubHeading>
                <TileGrid cols={COLS}>
                  {FILTERS.filter((f) => f.group === g.id).map((f, i) => (
                    <div key={f.id} className="[&>button]:w-full" {...dragProps('filter', f.id)}>
                      <Tile
                        index={i}
                        cols={COLS}
                        label={f.label}
                        hint={f.hint}
                        on={false}
                        onPick={() => addAtCentre('filter', f.id)}
                        art={<FilterArt spec={f} />}
                      />
                    </div>
                  ))}
                </TileGrid>
              </div>
            )
          })}
        {cat === 'finish' && (
          <TileGrid cols={COLS}>
            {FX_ORDER.map((f, i) => (
              <div key={f.id} className="[&>button]:w-full" {...dragProps('finish', f.id)}>
                <Tile
                  index={i}
                  cols={COLS}
                  label={f.label}
                  hint={f.hint}
                  on={false}
                  onPick={() => addAtCentre('finish', f.id)}
                  art={<FinishArt id={f.id} />}
                />
              </div>
            ))}
          </TileGrid>
        )}
      </div>
    </div>
  )
}
