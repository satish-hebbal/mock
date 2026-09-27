/**
 * The layer stack: filters over the photograph, before the style.
 *
 * Two halves. The stack you have, as compact cards that open one at a time;
 * and the filters you could add, as pictures of your photograph under each
 * one. A card closed is a single row: a grip to drag it, what it is, an eye,
 * and a bin. Everything else waits until you open it, so a stack of six stays
 * shorter than one filter's settings.
 */

import { useState } from 'react'
import { Copy, Eye, EyeOff, GripVertical, Layers, Trash2 } from 'lucide-react'
import { InfoTip, Section } from '../components/controls'
import { Tile, TileGrid } from '../signal/SignalTiles'
import { ParamControls } from './AsciiParams'
import { FilterArt } from './AsciiThumbs'
import { FILTERS, FILTER_GROUPS, getFilter, type FilterGroup } from './filters'
import { GROUP_ICON } from './filterIcons'
import { useAscii } from './store'

const COLS = 4

function Stack() {
  const layers = useAscii((s) => s.doc.layers)
  const active = useAscii((s) => s.activeLayer)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const st = useAscii.getState

  if (layers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-(--line) py-5 text-(--tx3)">
        <Layers size={18} strokeWidth={1.6} />
        <span className="t-caption">Pick a filter below to start a stack</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {layers.map((l, i) => {
        const spec = getFilter(l.kind)
        if (!spec) return null
        const Icon = GROUP_ICON[spec.group]
        const open = active === l.uid
        return (
          <div
            key={l.uid}
            onDragOver={(e) => {
              if (!drag) return
              e.preventDefault()
              setOver(i)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (drag) st().moveLayer(drag, i)
              setDrag(null)
              setOver(null)
            }}
            className={`rounded-md border transition-colors ${
              over === i && drag !== l.uid ? 'border-(--tx3)' : open ? 'border-(--line2) bg-(--field)' : 'border-(--line)'
            } ${drag === l.uid ? 'opacity-40' : ''}`}
          >
            <div className="flex h-8 items-center gap-1 pr-1 pl-0.5">
              <span
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  setDrag(l.uid)
                }}
                onDragEnd={() => {
                  setDrag(null)
                  setOver(null)
                }}
                title="Drag to reorder"
                className="flex h-6 w-5 cursor-grab items-center justify-center text-(--tx3) hover:text-(--tx2) active:cursor-grabbing"
              >
                <GripVertical size={13} strokeWidth={1.8} />
              </span>
              <button
                onClick={() => st().setActiveLayer(open ? null : l.uid)}
                aria-expanded={open}
                className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${l.on ? 'text-(--tx)' : 'text-(--tx3)'}`}
              >
                <Icon size={13} strokeWidth={1.8} className="shrink-0 text-(--tx2)" />
                <span className="truncate t-body-sm">{spec.label}</span>
              </button>
              <button
                onClick={() => st().toggleLayer(l.uid)}
                title={l.on ? 'Hide this layer' : 'Show this layer'}
                className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
              >
                {l.on ? <Eye size={13} strokeWidth={1.8} /> : <EyeOff size={13} strokeWidth={1.8} />}
              </button>
              <button
                onClick={() => st().duplicateLayer(l.uid)}
                title="Duplicate"
                className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
              >
                <Copy size={12} strokeWidth={1.8} />
              </button>
              <button
                onClick={() => st().removeLayer(l.uid)}
                title="Remove"
                className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
              >
                <Trash2 size={12} strokeWidth={1.8} />
              </button>
            </div>
            {open && (
              <div className="px-2 pb-2">
                <ParamControls
                  specs={spec.params}
                  values={l.params}
                  prefix={`ascii-layer-${l.uid}`}
                  onChange={(k, v, label) => st().setLayerParam(l.uid, k, v, label)}
                />
                {spec.positioned && (
                  <p className="mt-1 t-caption text-(--tx3)">Drag the handle on the picture to move it.</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Gallery() {
  const [group, setGroup] = useState<FilterGroup>('warp')
  const list = FILTERS.filter((f) => f.group === group)
  return (
    <>
      <div className="mb-2 grid grid-cols-5 gap-0.5 rounded-sm bg-(--field) p-0.5">
        {FILTER_GROUPS.map((g) => {
          const Icon = GROUP_ICON[g.id]
          const on = g.id === group
          return (
            <button
              key={g.id}
              onClick={() => setGroup(g.id)}
              title={g.label}
              aria-label={g.label}
              aria-pressed={on}
              className={`flex h-7 items-center justify-center rounded-xs transition-colors ${
                on ? 'bg-(--sel) text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'
              }`}
            >
              <Icon size={14} strokeWidth={1.8} />
            </button>
          )
        })}
      </div>
      <TileGrid cols={COLS}>
        {list.map((f, i) => (
          <Tile
            key={f.id}
            index={i}
            cols={COLS}
            label={f.label}
            hint={f.hint}
            on={false}
            onPick={() => useAscii.getState().addLayer(f.id)}
            art={<FilterArt spec={f} />}
          />
        ))}
      </TileGrid>
    </>
  )
}

export function LayersPage() {
  const count = useAscii((s) => s.doc.layers.filter((l) => l.on).length)
  return (
    <>
      <Section
        title="Stack"
        icon={<Layers size={15} strokeWidth={1.75} />}
        badge={count ? String(count) : undefined}
        defaultOpen
        actions={
          <InfoTip>
            Filters run on the photograph top to bottom, before the style cuts it up. Stack as many as you like.
          </InfoTip>
        }
      >
        <Stack />
      </Section>
      <Section title="Add a filter" defaultOpen>
        <Gallery />
      </Section>
    </>
  )
}
