/**
 * The panel.
 *
 * The reference tool for this puts every one of its controls on screen at once,
 * which is honest about how many there are and useless as a way in: the first
 * thing you meet is forty sliders and no idea which three matter.
 *
 * So it is three pages, in the order the work goes. Art: the photograph, a
 * look, a style and the few settings that style listens to. Layers: filters
 * over the photograph before the style sees it. Look: colour, backdrop, the
 * finish, and where the treatment shows. Every choice that can be a picture is
 * one, every explanation is behind an info dot, and every group that only
 * matters to some styles appears only for them.
 *
 * The pages sit on a horizontal pager, matching Shots next door: a trackpad's
 * sideways scroll moves between them the way it already moves everything else.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Binary,
  Blend,
  Bookmark,
  ClipboardPaste,
  Droplet,
  Grid3x3,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  MousePointer2,
  Palette,
  Rainbow,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import { pickMediaFile, useStudio } from '../store'
import {
  ColorRow,
  Dropdown,
  InfoTip,
  MiniButton,
  Section,
  SegmentThumb,
  Segments,
  SliderRow,
  SubHeading,
} from '../components/controls'
import { reshuffleMesh } from '../lib/meshGradient'
import { ui } from '../lib/ui'
import { DITHER_ALGOS } from './dither'
import { GRADIENTS, gradientCss } from './gradients'
import { PALETTES } from './palettes'
import { COLOR_PRESETS, RECIPES } from './presets'
import { RAMPS, getRamp } from './ramps'
import { getStyle } from './styles'
import { PresetCatalog } from './AsciiPresets'
import { ParamControls } from './AsciiParams'
import { StylePicker } from './AsciiStylePicker'
import { LayersPage } from './AsciiLayers'
import { FinishSection, RevealSection } from './AsciiFinish'
import { lookCode, parseLookCode, useAscii, type AsciiSection } from './store'
import type { AsciiDoc, BlendId, ColorMode, CompositeId } from './types'

const iconProps = { size: 15, strokeWidth: 1.75 } as const

const pct = (v: number) => `${Math.round(v * 100)}%`
const px = (v: number) => `${Math.round(v)}px`

/** Every write goes through here, so labels (and so undo grouping) stay consistent. */
const edit = (label: string, fn: (d: AsciiDoc) => void) => useAscii.getState().patch(fn, label)

function HeaderIcon({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx3) transition-colors hover:bg-(--panel3) hover:text-(--tx)"
    >
      {children}
    </button>
  )
}

// ----- Art page -----

/**
 * The built-in looks, and the ones you saved.
 *
 * Saving, sharing and pasting are three glyphs in the header rather than three
 * buttons in the body: they are things you do once in a while to the look as a
 * whole, and the body is for picking one.
 */
function LooksGroup() {
  const saved = useAscii((s) => s.saved)
  const style = useAscii((s) => s.doc.style)
  const st = useAscii.getState

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(lookCode(st().doc))
      ui.toast('Recipe code copied. Paste it here, anywhere, to get this look back')
    } catch {
      ui.error('The clipboard would not take it')
    }
  }
  const pasteCode = async () => {
    try {
      const look = parseLookCode(await navigator.clipboard.readText())
      if (!look) {
        ui.error('No recipe code on the clipboard')
        return
      }
      st().applySaved(look)
      ui.toast('Recipe applied')
    } catch {
      ui.error('The clipboard could not be read')
    }
  }

  return (
    <Section
      title="Looks"
      icon={<Sparkles {...iconProps} />}
      defaultOpen
      actions={
        <>
          <HeaderIcon title="Save this look as a recipe" onClick={() => st().saveLook(`${getStyle(style).label} ${saved.length + 1}`)}>
            <Bookmark size={13} strokeWidth={1.9} />
          </HeaderIcon>
          <HeaderIcon title="Copy this look as a recipe code" onClick={() => void copyCode()}>
            <Share2 size={13} strokeWidth={1.9} />
          </HeaderIcon>
          <HeaderIcon title="Apply a recipe code from the clipboard" onClick={() => void pasteCode()}>
            <ClipboardPaste size={13} strokeWidth={1.9} />
          </HeaderIcon>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-1">
        {RECIPES.map((r) => (
          <button
            key={r.id}
            onClick={() => st().applyLook(r.id)}
            title={r.hint}
            style={{ '--icon-tint': r.tint } as CSSProperties}
            className="flex items-center gap-2 rounded-sm bg-(--field) px-2 py-1.5 text-left transition-colors hover:bg-(--field-h)"
          >
            <r.icon className="look-icon shrink-0" size={15} strokeWidth={1.9} />
            <span className="truncate t-body-sm text-(--tx2)">{r.label}</span>
          </button>
        ))}
      </div>
      {saved.length > 0 && (
        <>
          <SubHeading icon={<Bookmark size={11} strokeWidth={2} />}>Yours</SubHeading>
          <div className="grid grid-cols-2 gap-1">
            {saved.map((r) => {
              const Icon = getStyle(r.look.style).icon
              return (
                <div key={r.id} className="group relative">
                  <button
                    onClick={() => st().applySaved(r.look)}
                    onDoubleClick={() => {
                      const name = window.prompt('Rename recipe', r.name)
                      if (name) st().renameSaved(r.id, name)
                    }}
                    title={`${r.name}. Double-click to rename`}
                    className="flex w-full items-center gap-2 rounded-sm bg-(--field) py-1.5 pr-6 pl-2 text-left transition-colors hover:bg-(--field-h)"
                  >
                    <Icon className="shrink-0 text-(--tx2)" size={14} strokeWidth={1.9} />
                    <span className="truncate t-body-sm text-(--tx2)">{r.name}</span>
                  </button>
                  <button
                    onClick={() => st().deleteSaved(r.id)}
                    title="Delete recipe"
                    className="absolute top-1/2 right-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-xs text-(--tx3) opacity-0 transition-opacity group-hover:opacity-100 hover:text-(--tx)"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
      <div className="mt-2 flex gap-1">
        <MiniButton onClick={() => st().reset()} title="Back to the plain defaults">
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
    <Section title="Source" icon={<ImageIcon {...iconProps} />} defaultOpen>
      {url ? (
        <>
          <div className="mb-2 overflow-hidden rounded-md border border-(--line)">
            <img src={url} alt="" className="block max-h-28 w-full object-cover" />
          </div>
          <div className="flex items-center gap-1">
            <MiniButton
              onClick={() => pickMediaFile((f) => void useAscii.getState().importImage(f), false)}
              title="Swap in another image"
            >
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
          <ImagePlus size={16} strokeWidth={1.75} />
          <span className="t-caption">Add an image, or drop one anywhere</span>
        </button>
      )}
      <PresetCatalog />
    </Section>
  )
}

/**
 * The settings the chosen style has beyond the shared grid: nothing for most
 * of them, a few rows for the rest. Titled with the style, so it is obvious
 * whose settings these are.
 */
function StyleSettingsGroup() {
  const doc = useAscii((s) => s.doc)
  const spec = getStyle(doc.style)
  if (!spec.params?.length) return null
  return (
    <Section title={spec.label} icon={<SlidersHorizontal {...iconProps} />} defaultOpen>
      <ParamControls
        specs={spec.params}
        values={doc.styleParams[doc.style]}
        prefix={`ascii-sp-${doc.style}`}
        onChange={(k, v) => useAscii.getState().setStyleParam(k, v)}
      />
    </Section>
  )
}

/**
 * Character sets, drawn as their own characters.
 *
 * The name of a ramp tells you nothing and the characters tell you everything,
 * so each button is a sample of the set and the name waits on hover.
 */
function CharactersGroup() {
  const doc = useAscii((s) => s.doc)
  const spec = getStyle(doc.style)
  if (!spec.ramp) return null

  const ramp = getRamp(doc.ramp)
  return (
    <Section
      title="Characters"
      icon={<Type {...iconProps} />}
      badge={ramp.label}
      defaultOpen
      actions={<InfoTip>{ramp.hint}</InfoTip>}
    >
      <div className="mb-2 grid grid-cols-4 gap-1">
        {RAMPS.map((r) => {
          const on = doc.ramp === r.id
          const chars = r.id === 'custom' ? doc.customRamp : r.chars
          // a spread sample, lightest to darkest, rather than just the first few
          const sample = Array.from({ length: 4 }, (_, i) => chars[Math.round(((i + 1) / 4) * (chars.length - 1))] ?? '').join('')
          return (
            <button
              key={r.id}
              onClick={() => edit('ascii-ramp', (d) => void (d.ramp = r.id))}
              title={`${r.label}. ${r.hint}`}
              aria-label={r.label}
              aria-pressed={on}
              className={`flex h-8 items-center justify-center overflow-hidden rounded-sm t-mono tracking-wider transition-colors ${
                on ? 'bg-(--sel) text-(--tx)' : 'bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
              }`}
            >
              {r.id === 'custom' ? <span className="t-caption">Aa…</span> : sample}
            </button>
          )
        })}
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
  if (spec.group === 'process') return null

  return (
    <Section title="Grid" icon={<Grid3x3 {...iconProps} />} defaultOpen>
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
  const cells = getStyle(useAscii((s) => s.doc.style)).group !== 'process'
  return (
    <Section title="Tone" icon={<Blend {...iconProps} />} defaultOpen>
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
      {/* coverage, density and edges shape how cells take ink, so they mean
          nothing to a style that paints the whole frame */}
      {cells && (
        <>
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
        </>
      )}
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

  const algos = (family: 'diffusion' | 'ordered') => (
    <div className="mb-2 flex flex-wrap gap-1">
      {DITHER_ALGOS.filter((a) => a.family === family).map((a) => (
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
  )

  return (
    <Section title="Dither engine" icon={<Binary {...iconProps} />} defaultOpen>
      <SubHeading>Error diffusion</SubHeading>
      {algos('diffusion')}
      <SubHeading>Ordered</SubHeading>
      {algos('ordered')}

      <SubHeading>Palette</SubHeading>
      {/* a palette is its colours, so the button is the strip of them */}
      <div className="mb-2 grid grid-cols-4 gap-1">
        {PALETTES.map((p) => (
          <button
            key={p.id}
            onClick={() => edit('', (doc2) => void (doc2.dither.palette = p.id))}
            title={`${p.label}. ${p.hint}`}
            aria-label={p.label}
            aria-pressed={d.palette === p.id}
            className={`flex h-7 items-center justify-center rounded-sm px-1 transition-colors ${
              d.palette === p.id ? 'bg-(--sel) ring-1 ring-(--tx2)' : 'bg-(--field) hover:bg-(--field-h)'
            }`}
          >
            <span className="flex h-3.5 w-full overflow-hidden rounded-xs">
              {(p.colors.length > 0 ? p.colors : ['#e24', '#fb2', '#2c6', '#29f']).slice(0, 8).map((c, i) => (
                <span key={i} className="h-3.5 flex-1" style={{ background: c }} />
              ))}
            </span>
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

const COLOR_MODES: { id: ColorMode; label: string; icon: ReactNode }[] = [
  { id: 'source', label: 'Photo colours', icon: <ImageIcon size={13} strokeWidth={1.9} /> },
  { id: 'ink', label: 'One ink', icon: <Droplet size={13} strokeWidth={1.9} /> },
  { id: 'duotone', label: 'Duotone', icon: <Blend size={13} strokeWidth={1.9} /> },
  { id: 'gradient', label: 'Gradient map', icon: <Palette size={13} strokeWidth={1.9} /> },
  { id: 'spectrum', label: 'Spectrum', icon: <Rainbow size={13} strokeWidth={1.9} /> },
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

const COMPOSITES: { value: CompositeId; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'screen', label: 'Screen' },
  { value: 'lighter', label: 'Add' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft light' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'color-dodge', label: 'Dodge' },
  { value: 'difference', label: 'Difference' },
]

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace('-', ' ')

function ColorGroup() {
  const c = useAscii((s) => s.doc.color)
  const style = useAscii((s) => s.doc.style)
  const cells = getStyle(style).group !== 'process'

  return (
    <Section title="Colour" icon={<Palette {...iconProps} />} defaultOpen>
      {cells && (
        <>
          <Segments
            options={COLOR_MODES}
            value={c.mode}
            onChange={(mode) => edit('', (d) => void (d.color.mode = mode))}
          />
          {c.mode === 'ink' && (
            <ColorRow label="Ink" value={c.ink} onChange={(v) => edit('ascii-ink', (d) => void (d.color.ink = v))} />
          )}
          {c.mode === 'duotone' && (
            <>
              <ColorRow label="Shadows" value={c.ink} onChange={(v) => edit('ascii-ink', (d) => void (d.color.ink = v))} />
              <ColorRow label="Highlights" value={c.ink2} onChange={(v) => edit('ascii-ink2', (d) => void (d.color.ink2 = v))} />
            </>
          )}
          {c.mode === 'gradient' && (
            <div className="mb-2 grid grid-cols-4 gap-1">
              {GRADIENTS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => edit('', (d) => void (d.color.gradient = g.id))}
                  title={g.label}
                  aria-label={g.label}
                  aria-pressed={c.gradient === g.id}
                  className={`h-6 rounded-sm transition-shadow ${
                    c.gradient === g.id ? 'ring-2 ring-(--tx) ring-offset-1 ring-offset-(--raised)' : 'hover:ring-1 hover:ring-(--line2)'
                  }`}
                  style={{ background: gradientCss(g.id) }}
                />
              ))}
            </div>
          )}
          {c.mode === 'spectrum' && (
            <SliderRow
              label="Start hue"
              value={c.hue}
              min={0}
              max={360}
              step={1}
              format={(v) => `${Math.round(v)}°`}
              onChange={(v) => edit('ascii-hue', (d) => void (d.color.hue = v))}
            />
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
      <div className="my-0.5 flex items-center gap-2">
        <span className="w-16 shrink-0 t-caption text-(--tx3)" title="How the art lands on the backdrop">
          Blend
        </span>
        <Dropdown
          className="min-w-0 flex-1"
          value={c.composite ?? 'source-over'}
          options={COMPOSITES}
          onChange={(v) => edit('', (d) => void (d.color.composite = v))}
        />
      </div>

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
        {c.tintOpacity > 0 && (
          <Dropdown
            value={c.blend}
            options={BLENDS.map((b) => ({ value: b, label: cap(b) }))}
            onChange={(b) => edit('', (d) => void (d.color.blend = b))}
          />
        )}
      </div>
    </Section>
  )
}

function BackdropGroup() {
  const bd = useAscii((s) => s.doc.backdrop)
  return (
    <Section title="Backdrop" icon={<ImageIcon {...iconProps} />} defaultOpen>
      <Segments
        options={[
          { id: 'paper', label: 'Paper' },
          { id: 'blurred', label: 'Blurred' },
          { id: 'source', label: 'Photo' },
          { id: 'mesh', label: 'Mesh' },
          { id: 'transparent', label: 'None' },
        ]}
        value={bd.mode}
        onChange={(mode) => edit('', (d) => void (d.backdrop.mode = mode))}
      />
      {bd.mode === 'mesh' && (
        <div className="mb-2">
          <MiniButton
            onClick={() => edit('', (d) => void (d.backdrop.mesh = reshuffleMesh(d.backdrop.mesh)))}
            title="Reshuffle the mesh"
          >
            <RotateCcw size={13} strokeWidth={1.9} />
            Reshuffle
          </MiniButton>
        </div>
      )}

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

/**
 * What the pointer does to the preview.
 *
 * Last on the page because it changes nothing you export: it is how the
 * picture behaves under your hand, not what the picture is.
 */
function CursorGroup() {
  const cursor = useAscii((s) => s.doc.cursor)
  const frame = getStyle(useAscii((s) => s.doc.style)).group === 'process'
  const on = cursor.mode === 'scatter'
  return (
    <Section title="Cursor" icon={<MousePointer2 {...iconProps} />} defaultOpen>
      <Segments
        options={[
          { id: 'off', label: 'Off' },
          { id: 'scatter', label: 'Scatter' },
        ]}
        value={cursor.mode}
        onChange={(mode) => edit('', (d) => void (d.cursor.mode = mode))}
      />
      {on && (
        <>
          <SliderRow
            label="Radius"
            hint="How far from the pointer the cells come loose"
            value={cursor.radius}
            min={40}
            max={600}
            step={1}
            format={px}
            onChange={(v) => edit('ascii-cursor-radius', (d) => void (d.cursor.radius = v))}
          />
          <SliderRow
            label="Strength"
            hint="How far a cell under the pointer can be thrown"
            value={cursor.strength}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            onChange={(v) => edit('ascii-cursor-strength', (d) => void (d.cursor.strength = v))}
          />
          <p className="mt-1 mb-2 t-caption text-(--tx3)">
            {frame ? 'This style has no cells to move, so the pointer leaves it alone.' : 'Preview only. Exports stay still.'}
          </p>
        </>
      )}
    </Section>
  )
}

// ----- the panel itself -----

const TABS: { id: AsciiSection; label: string; icon: typeof Type }[] = [
  { id: 'art', label: 'Art', icon: Type },
  { id: 'layers', label: 'Layers', icon: Layers },
  { id: 'look', label: 'Look', icon: Sparkles },
]

export function AsciiLeftPanel() {
  const open = useStudio((s) => s.toolPanelOpen)
  const section = useAscii((s) => s.section)
  const hasImage = useAscii((s) => s.bitmap !== null)
  const layerCount = useAscii((s) => s.doc.layers.length)
  const pager = useRef<HTMLDivElement>(null)
  const settled = useRef(false)
  /* the window where a programmatic scroll must not be read back as a gesture,
     for the same reason Shots needs one: the first frame still reports the page
     being left, and handing that back snaps the panel to where it started */
  const driving = useRef(0)
  const index = Math.max(0, TABS.findIndex((t) => t.id === section))
  const [, force] = useState(0)

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
    force(1)
  }, [])

  const onScroll = () => {
    const el = pager.current
    if (!el || !el.clientWidth || Date.now() < driving.current) return
    const id = TABS[Math.round(el.scrollLeft / el.clientWidth)]?.id
    if (id) useAscii.getState().setSection(id)
  }

  if (!open) return null

  return (
    <div className="flex w-[296px] shrink-0 flex-col overflow-hidden rounded-lg border border-(--line) bg-(--raised)">
      <div className="flex h-14 shrink-0 items-center border-b border-(--line) px-2">
        <div className="relative grid w-full grid-cols-3 gap-0.5 rounded-md bg-(--field) p-0.5">
          <SegmentThumb count={TABS.length} index={index} radius="rounded-sm" />
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => useAscii.getState().setSection(t.id)}
              aria-pressed={section === t.id}
              className={`relative z-10 flex h-7 items-center justify-center gap-1.5 rounded-sm t-body-sm font-medium transition-colors ${
                section === t.id ? 'text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'
              }`}
            >
              <t.icon size={13} strokeWidth={1.9} />
              {t.label}
              {t.id === 'layers' && layerCount > 0 && (
                <span className="rounded-xs bg-(--panel3) px-1 t-caption text-(--tx2) tabular-nums">{layerCount}</span>
              )}
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
              <StylePicker />
              <StyleSettingsGroup />
              <CharactersGroup />
              <DitherGroup />
              <GridGroup />
              <ToneGroup />
            </>
          )}
        </div>
        <div className="w-full shrink-0 snap-start overflow-y-auto">
          {hasImage ? (
            <LayersPage />
          ) : (
            <p className="p-4 t-caption text-(--tx3)">Add a picture first. Layers work on the photograph.</p>
          )}
        </div>
        <div className="w-full shrink-0 snap-start overflow-y-auto">
          <ColorGroup />
          <BackdropGroup />
          {hasImage && <FinishSection />}
          <RevealSection />
          <CursorGroup />
        </div>
      </div>
    </div>
  )
}
