/**
 * The finish and the reveal.
 *
 * Finish is the shared post chain, all of it, as pictures: tap a tile to put
 * the effect on, and it joins a short list of sliders above the grid; tap it
 * again, or its cross, to take it off. The list only ever holds what is on, so
 * twenty-six effects cost the panel one grid and however many rows you chose.
 *
 * Reveal is where the treatment shows at all: a spot, a split or a band, with
 * the untouched photograph outside it. Its handle lives on the canvas, which
 * is where you would reach for it anyway.
 */

import { Circle, CircleOff, Columns2, FlipHorizontal2, Rows2, Sparkles, SquareDashed, X } from 'lucide-react'
import { ColorRow, InfoTip, MiniButton, Section, Segments, SliderRow } from '../components/controls'
import { FX_ORDER, type FxId, type FxSettings } from '../lib/postfx'
import { Tile, TileGrid } from '../signal/SignalTiles'
import { FinishArt } from './AsciiThumbs'
import { chainOf, NAMED_FX } from './postfx'
import { useAscii } from './store'
import type { AsciiDoc, AsciiFx, AsciiReveal } from './types'

const pct = (v: number) => `${Math.round(v * 100)}%`
const edit = (label: string, fn: (d: AsciiDoc) => void) => useAscii.getState().patch(fn, label)
const isNamed = (id: FxId): id is keyof AsciiFx => (NAMED_FX as string[]).includes(id)

const COLOR_DEFAULTS: Partial<Record<FxId, Partial<FxSettings>>> = {
  colorOverlay: { color: '#5e6ad2' },
  fog: { color: '#c9d4e0' },
  lightLeak: { color: '#ff7a3d', color2: '#ff3da8', x: 0.15, y: 0.2 },
  gridLines: { color: '#ffffff' },
  matrixRain: { color: '#4dff88' },
  godRays: { x: 0.5, y: 0.2 },
}

function setFx(id: FxId, patch: Partial<FxSettings>, label: string) {
  edit(label, (d) => {
    if (isNamed(id)) {
      if (patch.amount !== undefined) d.fx[id] = patch.amount
      const rest = { ...patch }
      delete rest.amount
      if (Object.keys(rest).length) d.finish[id] = { ...(d.finish[id] ?? { amount: 0 }), ...rest }
      return
    }
    d.finish[id] = { ...(d.finish[id] ?? { amount: 0, ...COLOR_DEFAULTS[id] }), ...patch }
  })
}

export function FinishSection() {
  const doc = useAscii((s) => s.doc)
  const chain = chainOf(doc)
  const on = FX_ORDER.filter((f) => (chain[f.id]?.amount ?? 0) > 0)
  const COLS = 4

  return (
    <Section
      title="Finish"
      icon={<Sparkles size={15} strokeWidth={1.75} />}
      badge={on.length ? String(on.length) : undefined}
      defaultOpen
      actions={
        on.length > 0 ? (
          <button
            onClick={() =>
              edit('', (d) => {
                for (const k of NAMED_FX) d.fx[k] = 0
                d.finish = {}
              })
            }
            title="Take every effect off"
            className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
          >
            <CircleOff size={12} strokeWidth={2} />
          </button>
        ) : (
          <InfoTip>Effects over the whole frame, the screen the picture is on. Tap to add.</InfoTip>
        )
      }
    >
      {on.length > 0 && (
        <div className="mb-2.5 flex flex-col">
          {on.map((f) => {
            const s = chain[f.id]!
            return (
              <div key={f.id}>
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1">
                    <SliderRow
                      label={f.label}
                      hint={f.hint}
                      value={s.amount}
                      min={0}
                      max={1}
                      step={0.01}
                      format={pct}
                      onChange={(v) => setFx(f.id, { amount: Math.max(0.01, v) }, `ascii-fin-${f.id}`)}
                    />
                  </div>
                  <button
                    onClick={() => setFx(f.id, { amount: 0 }, '')}
                    title={`Remove ${f.label}`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>
                {f.colors?.map((key) => (
                  <ColorRow
                    key={key}
                    label={key === 'color' ? `${f.label} colour` : 'Second colour'}
                    value={(s[key] as string | undefined) ?? '#ffffff'}
                    onChange={(v) => setFx(f.id, { [key]: v }, `ascii-fin-${f.id}-${key}`)}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}
      <TileGrid cols={COLS}>
        {FX_ORDER.map((f, i) => {
          const active = (chain[f.id]?.amount ?? 0) > 0
          return (
            <Tile
              key={f.id}
              index={i}
              cols={COLS}
              label={f.label}
              hint={f.hint}
              on={active}
              onPick={() => setFx(f.id, { amount: active ? 0 : 0.5, ...(active ? {} : COLOR_DEFAULTS[f.id]) }, '')}
              art={<FinishArt id={f.id} />}
            />
          )
        })}
      </TileGrid>
    </Section>
  )
}

const REVEAL_MODES: { id: AsciiReveal['mode']; label: string; icon: React.ReactNode }[] = [
  { id: 'off', label: 'Everywhere', icon: <SquareDashed size={13} strokeWidth={1.9} /> },
  { id: 'spot', label: 'Spotlight', icon: <Circle size={13} strokeWidth={1.9} /> },
  { id: 'split', label: 'Split', icon: <Columns2 size={13} strokeWidth={1.9} /> },
  { id: 'band', label: 'Band', icon: <Rows2 size={13} strokeWidth={1.9} /> },
]

export function RevealSection() {
  const rv = useAscii((s) => s.doc.reveal)
  const set = (label: string, fn: (r: AsciiReveal) => void) => edit(label, (d) => fn(d.reveal))
  return (
    <Section
      title="Reveal"
      icon={<Circle size={15} strokeWidth={1.75} />}
      defaultOpen
      actions={<InfoTip>Show the treatment in one region only, with the untouched photograph around it. Drag the handle on the picture.</InfoTip>}
    >
      <Segments options={REVEAL_MODES} value={rv.mode} onChange={(m) => set('', (r) => void (r.mode = m))} />
      {rv.mode !== 'off' && (
        <>
          <SliderRow
            label={rv.mode === 'spot' ? 'Radius' : rv.mode === 'band' ? 'Width' : 'Softness span'}
            value={rv.size}
            min={0.02}
            max={1}
            step={0.01}
            format={pct}
            onChange={(v) => set('ascii-rv-size', (r) => void (r.size = v))}
          />
          <SliderRow
            label="Feather"
            value={rv.feather}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            onChange={(v) => set('ascii-rv-feather', (r) => void (r.feather = v))}
          />
          {rv.mode !== 'spot' && (
            <SliderRow
              label="Angle"
              value={rv.angle}
              min={0}
              max={360}
              step={1}
              format={(v) => `${Math.round(v)}°`}
              onChange={(v) => set('ascii-rv-angle', (r) => void (r.angle = v))}
            />
          )}
          <div className="mt-1.5">
            <MiniButton active={rv.invert} onClick={() => set('', (r) => void (r.invert = !r.invert))} title="Swap which side shows the treatment">
              <FlipHorizontal2 size={12} strokeWidth={2} />
              Invert
            </MiniButton>
          </div>
        </>
      )}
    </Section>
  )
}
