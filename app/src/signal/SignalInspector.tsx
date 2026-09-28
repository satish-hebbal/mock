/**
 * The right panel: how the frame is finished.
 *
 * The split with the left panel is between *what the picture is* and *what
 * happens to it afterwards*, which is also the order the work goes in. Nothing
 * here changes the pattern; everything here changes how it is quantised,
 * coloured, treated and framed.
 *
 * That split is what fixed the density problem. Fifty controls in one 280px
 * column is a scrollbar with a tool behind it. Split in two, with the rarely
 * touched groups folded, most sessions never scroll either side.
 */

import { useState } from 'react'
import {
  ArrowLeftRight,
  Check,
  Dices,
  Grid3x3,
  Minimize2,
  Monitor,
  Palette,
  RotateCcw,
  Save,
  Scan,
  Sparkles,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import {
  Disclosure,
  Dropdown,
  InfoTip,
  MiniButton,
  Section,
  Segments,
  SliderRow,
  SubHeading,
} from '../components/controls'
import { FX_ORDER, pixelPasses, type FxId } from '../lib/postfx'
import { ui } from '../lib/ui'
import { MASK_LIST, hexRgb } from './quantize'
import { PALETTES, PALETTE_GROUPS } from './palettes'
import { FxArt, MaskArt, Option, SlotArt, Tile, TileGrid } from './SignalTiles'
import { useSignal } from './store'
import { fxLive } from './thumbs'
import { CANVAS_PRESETS, type AccentMode, type SignalDoc } from './types'

const iconProps = { size: 15, strokeWidth: 1.75 } as const

const pct = (v: number) => `${Math.round(v * 100)}%`
const px = (v: number) => `${Math.round(v)}px`
const secs = (v: number) => `${v.toFixed(1)}s`
const int = (v: number) => `${Math.round(v)}`

const edit = (label: string, fn: (d: SignalDoc) => void) => useSignal.getState().patch(fn, label)

/** Five characters from a ramp, spread from its light end to its dark one, spaces dropped. */
function glyphSample(ramp: string) {
  const chars = [...ramp.replace(/\s/g, '')]
  if (chars.length <= 5) return chars.join('') || '?'
  return Array.from({ length: 5 }, (_, i) => chars[Math.round((i * (chars.length - 1)) / 4)]).join('')
}

/** Ink that reads on a chip of `hex`, by its perceived lightness. */
function inkOn(hex: string) {
  const [r, g, b] = hexRgb(hex)
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? 'rgb(0 0 0 / 0.78)' : 'rgb(255 255 255 / 0.9)'
}

/** One colour of the three, as a chip of itself that opens the picker. */
function InkChip({
  role,
  value,
  onChange,
}: {
  role: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="sg-ink" title={`${role}: pick a colour`} style={{ background: value, color: inkOn(value) }}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={role}
      />
      <span className="sg-ink-role">{role}</span>
      <span className="sg-ink-hex">{value.replace('#', '')}</span>
    </label>
  )
}

const ACCENT_MODES: { id: AccentMode; label: string; hint: string }[] = [
  { id: 'blend', label: 'Blend', hint: 'The accent fades in and out through the midtones.' },
  { id: 'hard', label: 'Hard', hint: 'The midtones become flat accent, posterised.' },
  { id: 'pattern', label: 'Pattern', hint: 'Only the lit dither pixels in the midtones take the accent.' },
]

/**
 * A run of tone from paper to ink, with the accent where each mode puts it.
 *
 * Drawn with CSS stops rather than rendered, because what differs between the
 * three is only the shape of the band: a soft hump, a flat block, or a stripe
 * of accent with the paper showing between.
 */
function accentRamp(mode: AccentMode, paper: string, ink: string, accent: string) {
  if (mode === 'blend') return `linear-gradient(90deg, ${paper} 12%, ${accent} 50%, ${ink} 88%)`
  if (mode === 'hard') return `linear-gradient(90deg, ${paper} 0 33%, ${accent} 33% 67%, ${ink} 67%)`
  const stripes: string[] = []
  for (let at = 33; at < 67; at += 4) {
    stripes.push(`${accent} ${at}% ${at + 2}%`, `${paper} ${at + 2}% ${at + 4}%`)
  }
  return `linear-gradient(90deg, ${paper} 0 33%, ${stripes.join(', ')}, ${ink} 67%)`
}

/**
 * A sheet at a canvas's proportions, and at its size relative to the others:
 * the long side grows with the pixel count, so 512 and 1024 are both square
 * and plainly not the same square.
 */
function sheetSize(w: number, h: number) {
  const long = 12 + 14 * (Math.max(w, h) / 1920)
  return w >= h
    ? { width: long, height: (long * h) / w }
    : { width: (long * w) / h, height: long }
}

export function DitherGroup() {
  const kind = useSignal((s) => s.doc.source.kind)
  const q = useSignal((s) => s.doc.quantize)

  // a figure has no luminance buffer, so there is nothing here to apply
  if (kind === 'figure') {
    return (
      <Section title="Dither" icon={<Grid3x3 {...iconProps} />} defaultOpen={false} badge="n/a">
        <p className="t-caption text-(--tx3)">Figures draw marks, not light. Pick a field to dither.</p>
      </Section>
    )
  }

  const mask = MASK_LIST.find((m) => m.id === q.mask)

  return (
    <Section
      title="Dither"
      icon={<Grid3x3 {...iconProps} />}
      badge={mask?.label}
      defaultOpen
      actions={<InfoTip>{mask?.hint}</InfoTip>}
    >
      {/* each mask on the same lit sphere, in the document's colours: the
          difference between Bayer 8 and blue noise is a texture, and a texture
          is the one thing its name cannot tell you */}
      <div className="mb-3">
        <TileGrid cols={5}>
          {MASK_LIST.map((m, i) => (
            <Tile
              key={m.id}
              index={i}
              cols={5}
              label={m.label}
              hint={m.hint}
              on={q.mask === m.id}
              onPick={() => edit('signal-mask', (d) => void (d.quantize.mask = m.id))}
              art={<MaskArt mask={m.id} />}
            />
          ))}
        </TileGrid>
      </div>

      <SliderRow label="Threshold" hint="The level a pixel has to beat to light up."
        value={q.threshold} min={0} max={255} step={1} format={int}
        onChange={(v) => edit('signal-threshold', (d) => void (d.quantize.threshold = v))} />
      <SliderRow label="Spread" hint="How far the mask may push a value either side. This is the dither."
        value={q.spread} min={0} max={100} step={1} format={int}
        onChange={(v) => edit('signal-spread', (d) => void (d.quantize.spread = v))} />
      <SliderRow label="Pixel size" hint="Source pixels per dithered block."
        value={q.pixelSize} min={1} max={16} step={1} format={px}
        onChange={(v) => edit('signal-pixel', (d) => void (d.quantize.pixelSize = v))} />
      <SliderRow label="Randomness" hint="Per-block variation in pixel size, hashed so the export matches."
        value={q.randomness} min={0} max={100} step={1} format={int}
        onChange={(v) => edit('signal-random', (d) => void (d.quantize.randomness = v))} />
      <SliderRow label="Detail"
        hint="How finely the light underneath is computed. The dither always runs at full size, so 2 or 3 costs almost nothing to look at and a great deal less to draw."
        value={q.detail} min={1} max={4} step={1} format={(v) => (v <= 1 ? 'Every pixel' : `1 in ${Math.round(v)}`)}
        onChange={(v) => edit('signal-detail', (d) => void (d.quantize.detail = v))} />

      <SubHeading icon={<Type size={11} strokeWidth={2} />}>Characters</SubHeading>
      {/* each set shown as what it prints: dots, the stock ramp, or yours */}
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        {(
          [
            { id: 'off', label: 'Pixels', art: <span className="sg-glyph-dots" /> },
            { id: 'ramp', label: 'Ramp', art: <span className="sg-glyphs">.:+#@</span> },
            {
              id: 'custom',
              label: 'Custom',
              art: <span className="sg-glyphs">{glyphSample(q.ramp)}</span>,
            },
          ] as const
        ).map((o) => (
          <Option
            key={o.id}
            on={q.glyphs === o.id}
            label={o.label}
            onClick={() => edit('signal-glyphs', (d) => void (d.quantize.glyphs = o.id))}
          >
            {o.art}
          </Option>
        ))}
      </div>
      {q.glyphs === 'custom' && (
        <input
          value={q.ramp}
          onChange={(e) => edit('signal-ramp', (d) => void (d.quantize.ramp = e.target.value))}
          spellCheck={false}
          aria-label="Character ramp, lightest first"
          className="h-7 w-full rounded-sm bg-(--field) px-2 t-mono text-(--tx) outline-none hover:bg-(--field-h) focus:bg-(--field-h)"
        />
      )}
    </Section>
  )
}

/*
 * The collapsed row for forty-eight swatches.
 *
 * "Palettes (48)" is a count standing where a thing should be: it says how much
 * is behind the fold without saying what any of it looks like, and a number is
 * the one part of a palette nobody is choosing by. Four overlapping chips say
 * it the way a stack of faces says how many people are in a room. You see the
 * kind of thing that is in there before deciding whether to open it.
 *
 * The active palette leads the stack, and that is the part that earns its
 * place rather than decorating. Closed, this fold otherwise hides the single
 * fact you most want from it, which is the palette you are on right now; the
 * three colour rows above show the colours but not that they came from a
 * palette, and nothing else in the panel names it.
 */
const STACK_N = 4

function PaletteStack({ activeId }: { activeId: string }) {
  const active = PALETTES.find((p) => p.id === activeId)
  /*
   * An even spread across the list rather than the first four. The list is
   * grouped, so the head of it is four variations on the house blue: sampling
   * across the groups is what makes the stack read as a range of things rather
   * than as one palette shown four times.
   */
  const spread = Array.from(
    { length: STACK_N },
    (_, i) => PALETTES[Math.floor((i * PALETTES.length) / STACK_N)],
  )
  const shown = [...(active ? [active] : []), ...spread.filter((p) => p.id !== active?.id)].slice(
    0,
    STACK_N,
  )

  return (
    // aria-hidden: the fold's accessible name is its label, and four unlabelled
    // colour chips read out as nothing anybody can act on
    <span aria-hidden className="flex shrink-0 items-center">
      {shown.map((p, i) => (
        <span
          key={p.id}
          className="relative flex h-3.5 w-3.5 overflow-hidden rounded-full"
          style={{
            // overlapped by a third, and the ring is the ground this panel is
            // actually painted on rather than a line: it cuts the chip behind
            // instead of drawing a border around the one in front. `--raised`
            // and not `--panel`, because the inspector is one of the things
            // that genuinely lifts off the canvas
            marginLeft: i === 0 ? 0 : -5,
            zIndex: STACK_N - i,
            boxShadow: '0 0 0 1.5px var(--raised)',
          }}
        >
          <span className="h-full w-1/3" style={{ background: p.paper }} />
          <span className="h-full w-1/3" style={{ background: p.ink }} />
          <span className="h-full w-1/3" style={{ background: p.accent }} />
        </span>
      ))}
    </span>
  )
}

export function ColourGroup() {
  const ink = useSignal((s) => s.doc.ink)
  const kind = useSignal((s) => s.doc.source.kind)
  const [palettes, setPalettes] = useState(false)

  const setColour = (key: 'ink' | 'paper' | 'accent') => (v: string) =>
    edit(`signal-${key}`, (d) => {
      d.ink[key] = v
      d.ink.palette = 'none'
    })

  return (
    <Section
      title="Colour"
      icon={<Palette {...iconProps} />}
      defaultOpen
      actions={<InfoTip>Three colours, always: lit, unlit, and the accent that occupies the band between.</InfoTip>}
    >
      {/*
       * The three colours as chips of themselves, in the order they sit in the
       * picture: paper under everything, ink on it, the accent between. The
       * swap is on the seam it trades across.
       */}
      <div className="sg-inks mb-3">
        <InkChip role="Paper" value={ink.paper} onChange={setColour('paper')} />
        <InkChip role="Ink" value={ink.ink} onChange={setColour('ink')} />
        <InkChip role="Accent" value={ink.accent} onChange={setColour('accent')} />
        <button
          onClick={() => useSignal.getState().swapInk()}
          title="Trade ink and paper (I)"
          aria-label="Trade ink and paper"
          className="sg-swap"
          // the seam between the first two chips of a 1fr 1fr 0.72fr strip
          style={{ left: 'calc((100% - 8px) / 2.72 + 2px)' }}
        >
          <ArrowLeftRight size={11} strokeWidth={2.2} />
        </button>
      </div>

      {/* folded by default: a wall of swatches is worth having and worth hiding */}
      <Disclosure
        label={`${PALETTES.length} palettes`}
        icon={<PaletteStack activeId={ink.palette} />}
        open={palettes}
        onToggle={setPalettes}
        actions={
          <button
            onClick={() => useSignal.getState().shufflePalette()}
            title="A palette at random, never the one you are on"
            aria-label="Random palette"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
          >
            <Dices size={13} strokeWidth={1.9} />
          </button>
        }
      >
        {PALETTE_GROUPS.map((group) => {
          const items = PALETTES.filter((p) => p.group === group)
          if (!items.length) return null
          return (
            <div key={group} className="mb-2 last:mb-0">
              <SubHeading>{group}</SubHeading>
              <div className="flex flex-wrap gap-1">
                {items.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => useSignal.getState().applyPalette(p.id)}
                    title={p.name}
                    aria-label={p.name}
                    aria-pressed={ink.palette === p.id}
                    className={`flex h-7 w-7 overflow-hidden rounded-sm border transition-colors ${
                      ink.palette === p.id ? 'border-(--tx2)' : 'border-(--line) hover:border-(--tx3)'
                    }`}
                  >
                    <span className="h-full w-1/3" style={{ background: p.paper }} />
                    <span className="h-full w-1/3" style={{ background: p.ink }} />
                    <span className="h-full w-1/3" style={{ background: p.accent }} />
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </Disclosure>

      {/* a figure paints the accent in one place only, so the band that places
          it in a dithered picture has nothing to act on */}
      {kind === 'field' && (
        <>
          <SliderRow label="Accent mix" hint="Width of the midtone band the accent occupies. At 0 the picture is two colours."
            value={ink.mix} min={0} max={100} step={1} format={int}
            onChange={(v) => edit('signal-mix', (d) => void (d.ink.mix = v))} />
          {/* each mode as the run of tone it paints, dark to light, in the
              document's own three colours */}
          {ink.mix > 0 && (
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {ACCENT_MODES.map((m) => (
                <Option
                  key={m.id}
                  on={ink.mode === m.id}
                  label={m.label}
                  hint={m.hint}
                  onClick={() => edit('signal-accent-mode', (d) => void (d.ink.mode = m.id))}
                >
                  <span
                    className="sg-ramp"
                    style={{ background: accentRamp(m.id, ink.paper, ink.ink, ink.accent) }}
                  />
                </Option>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  )
}

/**
 * The finishing chain.
 *
 * Twenty-six effects is too many for twenty-six always-visible sliders, so an
 * effect is a picture in the library until it is on, and a slider led by that
 * picture once it is. The ones on sit above the library, because the chain you
 * are working on should not be scattered through the twenty you are not.
 */
export function FinishGroup() {
  const fx = useSignal((s) => s.doc.fx)
  const big = useSignal((s) => s.doc.canvas.width * s.doc.canvas.height) > 1_200_000
  const active = FX_ORDER.filter((f) => (fx[f.id]?.amount ?? 0) > 0)
  const passes = pixelPasses(fx)

  /*
   * Turning an effect off deletes its entry rather than zeroing it, so an
   * untouched chain serialises as `{}` and the renderer can skip the whole
   * stage on one check. Turning one on lands at 0.4 rather than 1: full
   * strength on first press is how somebody decides an effect is useless when
   * what they actually saw was it at ten times the sensible amount.
   */
  const toggle = (id: FxId, on: boolean) =>
    edit(`signal-fx-${id}`, (d) => {
      if (on) d.fx[id] = { ...d.fx[id], amount: 0.4 }
      else delete d.fx[id]
    })

  return (
    <Section
      title="Finish"
      icon={<Sparkles {...iconProps} />}
      badge={active.length ? String(active.length) : undefined}
      defaultOpen
      actions={
        active.length ? (
          <button
            onClick={() => edit('signal-fx-clear', (d) => void (d.fx = {}))}
            title="Turn everything off"
            aria-label="Turn every effect off"
            className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
          >
            <RotateCcw size={12} strokeWidth={2} />
          </button>
        ) : undefined
      }
    >
      {active.map((spec) => (
        <div key={spec.id} className="mb-1.5 flex items-center gap-1">
          <span className="sg-fx-chip" aria-hidden>
            <FxArt id={spec.id} />
          </span>
          <div className="min-w-0 flex-1">
            <SliderRow
              label={spec.label}
              hint={spec.hint}
              value={fx[spec.id]?.amount ?? 0}
              min={0.01}
              max={1}
              step={0.01}
              format={pct}
              onChange={(v) =>
                edit(`signal-fx-${spec.id}`, (d) => void (d.fx[spec.id] = { ...d.fx[spec.id], amount: v }))
              }
            />
          </div>
          {spec.colors?.map((slot) => (
            <input
              key={slot}
              type="color"
              aria-label={`${spec.label} colour`}
              value={fx[spec.id]?.[slot] ?? (slot === 'color' ? '#ff4400' : '#6496ff')}
              onChange={(e) =>
                edit(`signal-fx-${spec.id}-${slot}`, (d) => {
                  const cur = d.fx[spec.id]
                  if (cur) cur[slot] = e.target.value
                })
              }
              className="h-7 w-7 shrink-0 cursor-pointer rounded-sm border border-(--line) bg-(--field)"
            />
          ))}
          {/* the amount and the way out belong to one effect, so they share its row */}
          <button
            onClick={() => toggle(spec.id, false)}
            title={`Turn ${spec.label} off`}
            aria-label={`Turn ${spec.label} off`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-(--field) text-(--tx3) transition-colors hover:bg-(--field-h) hover:text-(--tx)"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      ))}

      {/*
       * The whole library as pictures, every effect shown on the same sample,
       * so what differs from tile to tile is only the effect. The ones already
       * on stay in the grid with a check rather than vanishing from it, so the
       * library keeps its shape and a second press takes one off again.
       */}
      {active.length > 0 && <SubHeading>Add</SubHeading>}
      <TileGrid cols={5}>
        {FX_ORDER.map((spec, i) => {
          const on = (fx[spec.id]?.amount ?? 0) > 0
          return (
            <Tile
              key={spec.id}
              index={i}
              cols={5}
              label={spec.label}
              hint={spec.hint}
              on={on}
              onPick={() => toggle(spec.id, !on)}
              art={<FxArt id={spec.id} />}
              live={fxLive(spec.id)}
              mark={on ? <Check size={9} strokeWidth={3.4} /> : undefined}
            />
          )
        })}
      </TileGrid>

      {/* said only when it is true, and as a thing to do rather than a scolding */}
      {passes >= 3 && big && (
        <p className="mt-2 t-caption text-(--tx3)">
          {passes} of these read every pixel. Drop the frame cap if the panel lags; the export is
          unaffected.
        </p>
      )}
    </Section>
  )
}

export function CanvasGroup() {
  const canvas = useSignal((s) => s.doc.canvas)
  const match = CANVAS_PRESETS.find((p) => p.width === canvas.width && p.height === canvas.height)

  return (
    <Section
      title="Canvas"
      icon={<Monitor {...iconProps} />}
      badge={`${canvas.width}×${canvas.height}`}
      defaultOpen={false}
      actions={
        <InfoTip>
          The preview runs at this size and is scaled to fit, so what is on screen is the export at
          1:1. There is no export multiplier: a dither is measured in pixels.
        </InfoTip>
      }
    >
      {/* each size as a sheet of its own proportions, which is how a size is
          actually chosen: square, wide or tall first, then how many pixels */}
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {CANVAS_PRESETS.map((p) => (
          <Option
            key={p.id}
            on={match?.id === p.id}
            label={p.width === p.height ? `${p.width}` : `${p.width}×${p.height}`}
            hint={p.label}
            onClick={() =>
              edit('signal-canvas', (d) => {
                d.canvas.width = p.width
                d.canvas.height = p.height
              })
            }
          >
            <span
              className="sg-sheet"
              style={sheetSize(p.width, p.height)}
            />
          </Option>
        ))}
      </div>

      <SliderRow label="Width" value={canvas.width} min={128} max={2560} step={8} format={px}
        onChange={(v) => edit('signal-w', (d) => void (d.canvas.width = Math.round(v)))} />
      <SliderRow label="Height" value={canvas.height} min={128} max={2560} step={8} format={px}
        onChange={(v) => edit('signal-h', (d) => void (d.canvas.height = Math.round(v)))} />
      <SliderRow label="Duration" hint="How long a video export runs. It does not change the picture."
        value={canvas.duration} min={1} max={30} step={0.5} format={secs}
        onChange={(v) => edit('signal-duration', (d) => void (d.canvas.duration = v))} />

      <SubHeading>Preview</SubHeading>
      <Segments
        compact
        options={[
          { id: 'fit', label: 'Fit', icon: <><Minimize2 size={11} strokeWidth={2} />Fit</> },
          { id: 'exact', label: 'Exact', icon: <><Scan size={11} strokeWidth={2} />Exact</> },
        ]}
        value={canvas.preview}
        onChange={(v) => edit('signal-preview', (d) => void (d.canvas.preview = v))}
      />
      {/*
       * The one place the preview and the file can differ, so it is stated
       * where the choice is made rather than left for somebody to discover in
       * an export. Only shown on Exact, where the cost is the surprise.
       */}
      {canvas.preview === 'exact' && (
        <p className="mb-2 t-caption text-(--tx3)">
          Every preview pixel computed, even the ones scaled away. Slow above 1000px.
        </p>
      )}
      <Dropdown
        value={canvas.fpsCap}
        title="Caps the preview only. A video is encoded frame by frame at whatever rate you pick."
        options={[
          { value: 60, label: 'Uncapped' },
          { value: 30, label: '30 fps' },
          { value: 24, label: '24 fps' },
          { value: 15, label: '15 fps' },
        ]}
        onChange={(v) => edit('signal-cap', (d) => void (d.canvas.fpsCap = v))}
      />
    </Section>
  )
}

export function SavedGroup() {
  const slots = useSignal((s) => s.slots)
  return (
    <Section
      title="Saved"
      icon={<Save {...iconProps} />}
      badge={slots.length ? String(slots.length) : undefined}
      defaultOpen={false}
      actions={<InfoTip>Eight slots, kept in this browser. Separate from the document, which saves itself.</InfoTip>}
    >
      <MiniButton
        onClick={() => {
          void ui
            .prompt({ title: 'Save this look', label: 'Name', initial: 'Untitled' })
            .then((name) => {
              if (name !== null) useSignal.getState().saveSlot(name)
            })
        }}
      >
        Save this look
      </MiniButton>
      <div className="mt-2 flex flex-col gap-1">
        {slots.map((slot) => (
          <div key={slot.id} className="flex items-center gap-1">
            <button
              onClick={() => useSignal.getState().loadSlot(slot.id)}
              className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-sm bg-(--field) pr-2 pl-1 text-left t-body-sm text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)"
            >
              <span className="sg-fx-chip" aria-hidden>
                <SlotArt id={slot.id} doc={slot.doc} />
              </span>
              <span className="truncate">{slot.name}</span>
            </button>
            <button
              onClick={() => useSignal.getState().deleteSlot(slot.id)}
              aria-label={`Delete ${slot.name}`}
              className="flex h-9 w-7 shrink-0 items-center justify-center rounded-sm text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
            >
              <Trash2 size={13} strokeWidth={1.9} />
            </button>
          </div>
        ))}
      </div>
    </Section>
  )
}

export function SignalInspector() {
  return (
    <>
      <DitherGroup />
      <ColourGroup />
      <FinishGroup />
      <CanvasGroup />
      <SavedGroup />
    </>
  )
}
