/**
 * The panel.
 *
 * The reference tool for this puts every one of its controls on screen at once,
 * which is honest about how many there are and useless as a way in: the first
 * thing you meet is forty sliders and no idea which three matter.
 *
 * So this is ordered the way the work actually goes. A look first, because
 * being handed a finished picture and taking it apart is the fastest way to
 * learn what any of this does. Then the source, then what a cell becomes, then
 * how the grid is cut, and only then the tonal controls that assume you have
 * already decided the other three. Everything about *colour and finish* is on
 * the second page, because none of it means anything until the picture reads.
 *
 * Two pages rather than one long scroll, matching Shots next door, including
 * the horizontal pager: a trackpad's sideways scroll moves between them the way
 * it already moves everything else in the app.
 */

import { useEffect, useRef, type CSSProperties } from 'react'
import { Blend, Grid3x3, ImagePlus, RotateCcw, Trash2, Type } from 'lucide-react'
import { pickMediaFile, useStudio } from '../store'
import {
  ColorRow,
  InfoTip,
  MiniButton,
  Section,
  SegmentThumb,
  Segments,
  SliderRow,
  SubHeading,
} from '../components/controls'
import { reshuffleMesh } from '../lib/meshGradient'
import { DITHER_ALGOS } from './dither'
import { PALETTES } from './palettes'
import { COLOR_PRESETS, RECIPES } from './presets'
import { RAMPS, getRamp } from './ramps'
import { STYLES, STYLE_GROUPS, getStyle } from './styles'
import { PresetCatalog } from './AsciiPresets'
import { useAscii, type AsciiSection } from './store'
import type { AsciiDoc, BlendId, ColorMode } from './types'

const iconProps = { size: 15, strokeWidth: 1.75 } as const

const pct = (v: number) => `${Math.round(v * 100)}%`
const px = (v: number) => `${Math.round(v)}px`

/** Every write goes through here, so labels (and so undo grouping) stay consistent. */
const edit = (label: string, fn: (d: AsciiDoc) => void) => useAscii.getState().patch(fn, label)

// ----- Art page -----

function LooksGroup() {
  return (
    <Section
      title="Looks"
      defaultOpen
      actions={<InfoTip>A whole picture in one press. Everything below is still yours to move afterwards.</InfoTip>}
    >
      <div className="grid grid-cols-2 gap-1">
        {RECIPES.map((r) => (
          <button
            key={r.id}
            onClick={() => useAscii.getState().applyLook(r.id)}
            title={r.hint}
            style={{ '--icon-tint': r.tint } as CSSProperties}
            className="flex items-center gap-2 rounded-sm bg-(--field) px-2 py-1.5 text-left transition-colors hover:bg-(--field-h)"
          >
            <r.icon className="look-icon shrink-0" size={15} strokeWidth={1.9} />
            <span className="truncate t-body-sm text-(--tx2)">{r.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-1">
        <MiniButton onClick={() => useAscii.getState().reset()} title="Back to the plain defaults">
          <RotateCcw size={13} strokeWidth={1.9} />
          Reset
        </MiniButton>
      </div>
    </Section>
  )
}

function SourceGroup() {
  const url = useAscii((s) => s.url)
  const size = useAscii((s) => s.doc.size)

  return (
    <Section title="Source" defaultOpen>
      {url ? (
        <>
          <div className="mb-2 overflow-hidden rounded-md border border-(--line)">
            <img src={url} alt="" className="block max-h-28 w-full object-cover" />
          </div>
          {/* one row: the two things you can do to the picture on the left, and
              what it currently is on the right, rather than three short lines
              stacked down the panel's left edge */}
          <div className="flex items-center gap-1">
            <MiniButton
              onClick={() => pickMediaFile((f) => void useAscii.getState().importImage(f), false)}
              title="Swap in another image"
            >
              {/* the glyph does the asking: a plus over a picture reads as "put
                  one in" before the label beside it has been read at all */}
              <ImagePlus size={13} strokeWidth={1.9} />
              Replace
            </MiniButton>
            <MiniButton onClick={() => useAscii.getState().clearImage()} title="Remove the image">
              <Trash2 size={13} strokeWidth={1.9} />
            </MiniButton>
            <span
              title="The document this picture is being cut into"
              className="ml-auto shrink-0 t-caption text-(--tx3) tabular-nums"
            >
              {size.width} × {size.height}
            </span>
          </div>
        </>
      ) : (
        <button
          onClick={() => pickMediaFile((f) => void useAscii.getState().importImage(f), false)}
          className="media-drop relative flex w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-(--line) py-6 text-(--tx3) transition-colors hover:border-(--tx3) hover:text-(--tx2)"
        >
          <span className="media-glow" aria-hidden />
          {/* the same glyph the Replace button wears, so "put a picture in
              here" looks the same before and after there is one */}
          <ImagePlus size={16} strokeWidth={1.75} />
          <span className="t-caption">Add an image, or drop one anywhere</span>
        </button>
      )}
      {/* the full library, one row per folder until a row is opened, in both
          states: the canvas shows six before there is a picture, and this is
          where the rest of them are and where you swap between them after */}
      <PresetCatalog />
    </Section>
  )
}

function StyleGroup() {
  const style = useAscii((s) => s.doc.style)
  return (
    <Section
      title="Style"
      icon={<Grid3x3 {...iconProps} />}
      defaultOpen
      /* the dot carries the style you are on; every other style explains itself
         on hover through its own button, so nothing needs a line of its own */
      actions={<InfoTip>{getStyle(style).hint}</InfoTip>}
    >
      {STYLE_GROUPS.map((g) => (
        <div key={g.id} className="mb-2 last:mb-0">
          <SubHeading>{g.label}</SubHeading>
          <div className="flex flex-wrap gap-1">
            {STYLES.filter((s) => s.group === g.id).map((s) => (
              <MiniButton
                key={s.id}
                active={style === s.id}
                title={s.hint}
                onClick={() => useAscii.getState().setStyle(s.id)}
              >
                <s.icon size={13} strokeWidth={1.9} />
                {s.label}
              </MiniButton>
            ))}
          </div>
        </div>
      ))}
    </Section>
  )
}

function CharactersGroup() {
  const doc = useAscii((s) => s.doc)
  // Blocks brings its own ramp and braille has no ramp at all, so the picker
  // would be a control that does nothing on two of the three glyph styles
  if (doc.style !== 'characters') return null

  const ramp = getRamp(doc.ramp)
  return (
    <Section title="Characters" icon={<Type {...iconProps} />} defaultOpen>
      <div className="mb-2 flex flex-wrap gap-1">
        {RAMPS.map((r) => (
          <MiniButton
            key={r.id}
            active={doc.ramp === r.id}
            title={r.hint}
            onClick={() => edit('ascii-ramp', (d) => void (d.ramp = r.id))}
          >
            {r.label}
          </MiniButton>
        ))}
      </div>

      {doc.ramp === 'custom' ? (
        <input
          value={doc.customRamp}
          onChange={(e) => edit('ascii-custom-ramp', (d) => void (d.customRamp = e.target.value))}
          spellCheck={false}
          aria-label="Custom ramp, lightest character first"
          className="mb-1.5 h-7 w-full rounded-sm bg-(--field) px-2 t-mono text-(--tx) outline-none focus:ring-2 focus:ring-(--focus)"
        />
      ) : (
        /* the ramp itself, because the name of a ramp tells you nothing and
           the characters tell you everything */
        <p className="mb-1.5 truncate rounded-sm bg-(--field) px-2 py-1 t-mono text-(--tx2)">
          {ramp.chars.replace(/ /g, '·')}
        </p>
      )}

      <SliderRow
        label="Scatter"
        hint="How often a cell takes the character one step either side of its own"
        value={doc.grid.jitter}
        min={0}
        max={1}
        step={0.01}
        format={pct}
        onChange={(v) => edit('ascii-jitter', (d) => void (d.grid.jitter = v))}
      />
    </Section>
  )
}

function GridGroup() {
  const doc = useAscii((s) => s.doc)
  const spec = getStyle(doc.style)
  if (doc.style === 'dither') return null

  return (
    <Section title="Grid" defaultOpen>
      <SliderRow
        label="Cell"
        hint="Cell width in document pixels. Smaller means more of them, and more detail."
        value={doc.grid.cell}
        min={3}
        max={64}
        step={1}
        format={px}
        onChange={(v) => edit('ascii-cell', (d) => void (d.grid.cell = v))}
      />
      {!spec.square && (
        <SliderRow
          label="Aspect"
          hint="Cell height over cell width. 1.8 matches a monospace character cell."
          value={doc.grid.aspect}
          min={0.5}
          max={3}
          step={0.05}
          onChange={(v) => edit('ascii-aspect', (d) => void (d.grid.aspect = v))}
        />
      )}
      {spec.gap && (
        <SliderRow
          label="Grout"
          hint="How much of each cell is left unpainted"
          value={doc.grid.gap}
          min={0}
          max={0.5}
          step={0.01}
          format={pct}
          onChange={(v) => edit('ascii-gap', (d) => void (d.grid.gap = v))}
        />
      )}
    </Section>
  )
}

function ToneGroup() {
  const tone = useAscii((s) => s.doc.tone)
  return (
    <Section title="Tone" defaultOpen>
      <SliderRow
        label="Brightness"
        value={tone.brightness}
        min={-100}
        max={100}
        step={1}
        onChange={(v) => edit('ascii-brightness', (d) => void (d.tone.brightness = v))}
      />
      <SliderRow
        label="Contrast"
        value={tone.contrast}
        min={0}
        max={200}
        step={1}
        onChange={(v) => edit('ascii-contrast', (d) => void (d.tone.contrast = v))}
      />
      <SliderRow
        label="Gamma"
        hint="Bends the midtones without moving black or white"
        value={tone.gamma}
        min={0.2}
        max={3}
        step={0.01}
        onChange={(v) => edit('ascii-gamma', (d) => void (d.tone.gamma = v))}
      />
      <SliderRow
        label="Coverage"
        hint="How far into the dark end of the ramp the picture is allowed to go"
        value={tone.coverage}
        min={0}
        max={1}
        step={0.01}
        format={pct}
        onChange={(v) => edit('ascii-coverage', (d) => void (d.tone.coverage = v))}
      />
      <SliderRow
        label="Density"
        hint="Cells lighter than this are left empty, which is what keeps a sky clean"
        value={tone.density}
        min={0}
        max={0.6}
        step={0.01}
        format={pct}
        onChange={(v) => edit('ascii-density', (d) => void (d.tone.density = v))}
      />
      <SliderRow
        label="Edges"
        hint="Darkens cells that sit on an edge, which brings back outlines the grid lost"
        value={tone.edge}
        min={0}
        max={1}
        step={0.01}
        format={pct}
        onChange={(v) => edit('ascii-edge', (d) => void (d.tone.edge = v))}
      />
      <div className="mt-1.5">
        <MiniButton
          active={tone.invert}
          onClick={() => edit('', (d) => void (d.tone.invert = !d.tone.invert))}
          title="Send the light to the other end of the ramp"
        >
          Invert
        </MiniButton>
      </div>
    </Section>
  )
}

function DitherGroup() {
  const doc = useAscii((s) => s.doc)
  if (doc.style !== 'dither') return null
  const d = doc.dither

  return (
    <Section title="Dither engine" defaultOpen>
      <SubHeading>Error diffusion</SubHeading>
      <div className="mb-2 flex flex-wrap gap-1">
        {DITHER_ALGOS.filter((a) => a.family === 'diffusion').map((a) => (
          <MiniButton
            key={a.id}
            active={d.algo === a.id}
            title={a.hint}
            onClick={() => edit('', (doc2) => void (doc2.dither.algo = a.id as typeof d.algo))}
          >
            {a.label}
          </MiniButton>
        ))}
      </div>

      <SubHeading>Ordered</SubHeading>
      <div className="mb-2 flex flex-wrap gap-1">
        {DITHER_ALGOS.filter((a) => a.family === 'ordered').map((a) => (
          <MiniButton
            key={a.id}
            active={d.algo === a.id}
            title={a.hint}
            onClick={() => edit('', (doc2) => void (doc2.dither.algo = a.id as typeof d.algo))}
          >
            {a.label}
          </MiniButton>
        ))}
      </div>

      <SubHeading>Palette</SubHeading>
      <div className="mb-2 grid grid-cols-2 gap-1">
        {PALETTES.map((p) => (
          <button
            key={p.id}
            onClick={() => edit('', (doc2) => void (doc2.dither.palette = p.id))}
            title={p.hint}
            aria-pressed={d.palette === p.id}
            className={`flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-left transition-colors ${
              d.palette === p.id ? 'bg-(--sel) text-(--tx)' : 'bg-(--field) text-(--tx2) hover:bg-(--field-h)'
            }`}
          >
            <span className="flex h-3.5 shrink-0 overflow-hidden rounded-xs">
              {(p.colors.length > 0 ? p.colors : ['#444', '#888', '#ccc']).slice(0, 4).map((c, i) => (
                <span key={i} className="h-3.5 w-2" style={{ background: c }} />
              ))}
            </span>
            <span className="truncate t-body-sm">{p.label}</span>
          </button>
        ))}
      </div>

      <SliderRow
        label="Pixel size"
        hint="Source pixels per dithered pixel. This is the whole chunkiness control."
        value={d.scale}
        min={1}
        max={12}
        step={1}
        format={(v) => `${v}×`}
        onChange={(v) => edit('ascii-dscale', (doc2) => void (doc2.dither.scale = v))}
      />
      <SliderRow
        label="Strength"
        hint="How much of each pixel's error is passed to its neighbours"
        value={d.amount}
        min={0}
        max={1}
        step={0.01}
        format={pct}
        onChange={(v) => edit('ascii-damount', (doc2) => void (doc2.dither.amount = v))}
      />
      <div className="mt-1.5">
        <MiniButton
          active={d.serpentine}
          onClick={() => edit('', (doc2) => void (doc2.dither.serpentine = !doc2.dither.serpentine))}
          title="Scan alternate rows backwards, which hides the diagonal drift error diffusion leaves"
        >
          Serpentine
        </MiniButton>
      </div>
    </Section>
  )
}

// ----- Look page -----

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 'source', label: 'Source' },
  { id: 'ink', label: 'One ink' },
  { id: 'duotone', label: 'Duotone' },
]

const BLENDS: BlendId[] = [
  'multiply',
  'overlay',
  'screen',
  'color',
  'hue',
  'saturation',
  'luminosity',
  'soft-light',
  'hard-light',
  'color-burn',
  'color-dodge',
]

function ColorGroup() {
  const c = useAscii((s) => s.doc.color)
  const style = useAscii((s) => s.doc.style)

  return (
    <Section title="Colour" icon={<Blend {...iconProps} />} defaultOpen>
      {style !== 'dither' && (
        <>
          <Segments
            options={COLOR_MODES}
            value={c.mode}
            onChange={(mode) => edit('', (d) => void (d.color.mode = mode))}
          />
          {c.mode === 'ink' && <ColorRow label="Ink" value={c.ink} onChange={(v) => edit('ascii-ink', (d) => void (d.color.ink = v))} />}
          {c.mode === 'duotone' && (
            <>
              <ColorRow label="Shadows" value={c.ink} onChange={(v) => edit('ascii-ink', (d) => void (d.color.ink = v))} />
              <ColorRow label="Highlights" value={c.ink2} onChange={(v) => edit('ascii-ink2', (d) => void (d.color.ink2 = v))} />
            </>
          )}
        </>
      )}

      <SubHeading>Grade</SubHeading>
      <div className="mb-2 flex flex-wrap gap-1">
        {COLOR_PRESETS.map((p) => (
          <MiniButton
            key={p.id}
            active={c.preset === p.id}
            onClick={() =>
              edit('', (d) => {
                Object.assign(d.color, p.patch)
                d.color.preset = p.id
              })
            }
          >
            {p.label}
          </MiniButton>
        ))}
      </div>

      <SliderRow
        label="Saturation"
        value={c.saturation}
        min={0}
        max={2}
        step={0.01}
        format={pct}
        onChange={(v) =>
          edit('ascii-sat', (d) => {
            d.color.saturation = v
            d.color.preset = ''
          })
        }
      />
      <SliderRow
        label="Grayscale"
        value={c.grayscale}
        min={0}
        max={1}
        step={0.01}
        format={pct}
        onChange={(v) =>
          edit('ascii-gray', (d) => {
            d.color.grayscale = v
            d.color.preset = ''
          })
        }
      />
      <SliderRow
        label="Opacity"
        hint="How solid the marks are over the backdrop"
        value={c.opacity}
        min={0}
        max={1}
        step={0.01}
        format={pct}
        onChange={(v) => edit('ascii-opacity', (d) => void (d.color.opacity = v))}
      />

      <div className="mt-2">
        <SubHeading>Tint</SubHeading>
        <ColorRow label="Tint" value={c.tint} onChange={(v) => edit('ascii-tint', (d) => void (d.color.tint = v))} />
        <SliderRow
          label="Amount"
          value={c.tintOpacity}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(v) =>
            edit('ascii-tint-amt', (d) => {
              d.color.tintOpacity = v
              d.color.preset = ''
            })
          }
        />
        <div className="mt-1 flex flex-wrap gap-1">
          {BLENDS.map((b) => (
            <MiniButton
              key={b}
              active={c.blend === b}
              onClick={() => edit('', (d) => void (d.color.blend = b))}
            >
              {b.replace('-', ' ')}
            </MiniButton>
          ))}
        </div>
      </div>
    </Section>
  )
}

function BackdropGroup() {
  const bd = useAscii((s) => s.doc.backdrop)
  return (
    <Section title="Backdrop" defaultOpen>
      <Segments
        options={[
          { id: 'paper', label: 'Paper' },
          { id: 'blurred', label: 'Blurred' },
          { id: 'source', label: 'Photo' },
        ]}
        value={bd.mode === 'mesh' || bd.mode === 'transparent' ? 'paper' : bd.mode}
        onChange={(mode) => edit('', (d) => void (d.backdrop.mode = mode))}
      />
      <div className="mb-2 flex gap-1">
        <MiniButton
          active={bd.mode === 'mesh'}
          onClick={() => edit('', (d) => void (d.backdrop.mode = 'mesh'))}
        >
          Mesh
        </MiniButton>
        <MiniButton
          active={bd.mode === 'transparent'}
          onClick={() => edit('', (d) => void (d.backdrop.mode = 'transparent'))}
          title="No backdrop at all, so the PNG carries real alpha"
        >
          Transparent
        </MiniButton>
        {bd.mode === 'mesh' && (
          <MiniButton
            onClick={() => edit('', (d) => void (d.backdrop.mesh = reshuffleMesh(d.backdrop.mesh)))}
            title="Reshuffle the mesh"
          >
            <RotateCcw size={13} strokeWidth={1.9} />
          </MiniButton>
        )}
      </div>

      {bd.mode !== 'transparent' && bd.mode !== 'mesh' && (
        <ColorRow label="Paper" value={bd.color} onChange={(v) => edit('ascii-paper', (d) => void (d.backdrop.color = v))} />
      )}
      {bd.mode === 'blurred' && (
        <SliderRow
          label="Blur"
          value={bd.blur}
          min={0}
          max={120}
          step={1}
          format={px}
          onChange={(v) => edit('ascii-bd-blur', (d) => void (d.backdrop.blur = v))}
        />
      )}
      {(bd.mode === 'blurred' || bd.mode === 'source') && (
        <SliderRow
          label="Strength"
          value={bd.opacity}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(v) => edit('ascii-bd-op', (d) => void (d.backdrop.opacity = v))}
        />
      )}
    </Section>
  )
}

const FX_ROWS: { key: keyof AsciiDoc['fx']; label: string; hint: string }[] = [
  { key: 'bloom', label: 'Bloom', hint: 'Light spilling off the bright characters' },
  { key: 'chromatic', label: 'Chromatic', hint: 'Red and blue landing a hair apart' },
  { key: 'scanlines', label: 'Scan lines', hint: 'The gaps between the rows a tube lit' },
  { key: 'glitch', label: 'Glitch', hint: 'Bands of the frame tearing sideways' },
  { key: 'grain', label: 'Grain', hint: 'Film grain over the whole frame' },
  { key: 'curvature', label: 'Curvature', hint: 'The bulge of the glass. The expensive one.' },
  { key: 'vignette', label: 'Vignette', hint: 'The corners falling away' },
]

function EffectsGroup() {
  const fx = useAscii((s) => s.doc.fx)
  const any = FX_ROWS.some((r) => fx[r.key] > 0)
  return (
    <Section
      title="Effects"
      defaultOpen
      badge={any ? String(FX_ROWS.filter((r) => fx[r.key] > 0).length) : undefined}
      actions={
        any ? (
          <button
            onClick={() =>
              edit('', (d) => {
                for (const r of FX_ROWS) d.fx[r.key] = 0
              })
            }
            title="Turn every effect off"
            className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
          >
            <RotateCcw size={12} strokeWidth={2} />
          </button>
        ) : undefined
      }
    >
      {FX_ROWS.map((r) => (
        <SliderRow
          key={r.key}
          label={r.label}
          hint={r.hint}
          value={fx[r.key]}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(v) => edit(`ascii-fx-${r.key}`, (d) => void (d.fx[r.key] = v))}
        />
      ))}
    </Section>
  )
}

// ----- the panel itself -----

const TABS: { id: AsciiSection; label: string }[] = [
  { id: 'art', label: 'Art' },
  { id: 'look', label: 'Look' },
]

export function AsciiLeftPanel() {
  const open = useStudio((s) => s.toolPanelOpen)
  const section = useAscii((s) => s.section)
  const hasImage = useAscii((s) => s.bitmap !== null)
  const pager = useRef<HTMLDivElement>(null)
  const settled = useRef(false)
  /* the window where a programmatic scroll must not be read back as a gesture,
     for the same reason Shots needs one: the first frame still reports the page
     being left, and handing that back snaps the panel to where it started */
  const driving = useRef(0)
  const index = Math.max(0, TABS.findIndex((t) => t.id === section))

  useEffect(() => {
    const el = pager.current
    if (!el || !el.clientWidth) return
    const target = index * el.clientWidth
    if (Math.abs(el.scrollLeft - target) < 2) return
    driving.current = Date.now() + 700
    el.scrollTo({ left: target, behavior: settled.current ? 'smooth' : 'auto' })
  }, [index, open])

  useEffect(() => {
    settled.current = true
  }, [])

  const onScroll = () => {
    const el = pager.current
    if (!el || !el.clientWidth || Date.now() < driving.current) return
    const id = TABS[Math.round(el.scrollLeft / el.clientWidth)]?.id
    if (id) useAscii.getState().setSection(id)
  }

  if (!open) return null

  return (
    <div className="flex w-[280px] shrink-0 flex-col overflow-hidden rounded-lg border border-(--line) bg-(--raised)">
      <div className="flex h-14 shrink-0 items-center border-b border-(--line) px-2">
        <div className="relative grid w-full grid-cols-2 gap-0.5 rounded-md bg-(--field) p-0.5">
          <SegmentThumb count={TABS.length} index={index} radius="rounded-sm" />
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => useAscii.getState().setSection(t.id)}
              aria-pressed={section === t.id}
              className={`relative z-10 flex h-7 items-center justify-center rounded-sm t-body-sm font-medium transition-colors ${
                section === t.id ? 'text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={pager}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
      >
        <div className="w-full shrink-0 snap-start overflow-y-auto">
          <SourceGroup />
          {hasImage && (
            <>
              <LooksGroup />
              <StyleGroup />
              <CharactersGroup />
              <DitherGroup />
              <GridGroup />
              <ToneGroup />
            </>
          )}
        </div>
        <div className="w-full shrink-0 snap-start overflow-y-auto">
          <ColorGroup />
          <BackdropGroup />
          <EffectsGroup />
        </div>
      </div>
    </div>
  )
}
