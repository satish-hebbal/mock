/**
 * The left panel: what the picture is.
 *
 * A look, then which generator, then that generator's own controls. Everything
 * about how the picture is *finished* (the dither, the colours, the post chain,
 * the canvas) is in the inspector on the right, because those are two different
 * jobs and putting fifty controls in one column meant the first thing anybody
 * met was a scrollbar.
 *
 * The panel is deliberately short on prose. An earlier draft explained each
 * group in a sentence under its heading, which is read once and then costs a
 * slice of a 280px column forever. The explanations did not go away, they moved
 * into the dot beside the heading and into tooltips, where they are available
 * on the second visit and invisible on the twentieth.
 */

import { useState } from 'react'
import { Layers, RotateCcw, Shuffle, Sparkles, Sliders, Waves } from 'lucide-react'
import { useStudio } from '../store'
import {
  InfoTip,
  MiniButton,
  Section,
  Segments,
  SliderRow,
  SubHeading,
} from '../components/controls'
import { NotchedFrame } from '../components/NotchedCanvas'
import { NOTCH_PAD, notchForPill } from '../lib/notch'
import { PRESETS, PRESET_GROUPS } from './presets'
import { firstOf, groupsOf, paramsFor, sourcesOf, sourceUses } from './sources'
import { useSignal } from './store'
import type { SignalDoc, SourceKind } from './types'

const iconProps = { size: 15, strokeWidth: 1.75 } as const

const pct = (v: number) => `${Math.round(v * 100)}%`
const deg = (v: number) => `${Math.round(v)}°`

/** Every write goes through here, so labels (and so undo grouping) stay consistent. */
const edit = (label: string, fn: (d: SignalDoc) => void) => useSignal.getState().patch(fn, label)

/** The three colours a preset is built from, which label it better than words. */
function PresetSwatch({ ink, paper, accent }: { ink: string; paper: string; accent: string }) {
  return (
    <span
      aria-hidden
      className="flex h-3.5 w-3.5 shrink-0 overflow-hidden rounded-full border border-(--line)"
    >
      <span className="h-full w-1/3" style={{ background: paper }} />
      <span className="h-full w-1/3" style={{ background: ink }} />
      <span className="h-full w-1/3" style={{ background: accent }} />
    </span>
  )
}

function LooksGroup() {
  const source = useSignal((s) => s.doc.source.id)
  const [group, setGroup] = useState<string>('House')
  const items = PRESETS.filter((p) => p.group === group)

  return (
    <Section
      title="Looks"
      icon={<Sparkles {...iconProps} />}
      badge={String(PRESETS.length)}
      defaultOpen
      actions={
        <InfoTip>
          A whole picture in one press: the generator, its own settings, the mask, three colours and
          the finish. Everything stays yours to move afterwards.
        </InfoTip>
      }
    >
      {/*
       * A hundred and twelve presets will not fit in a column, and a single
       * scrolling list of them is a worse way in than no list at all. The group
       * is picked first, which turns one impossible choice into two easy ones.
       */}
      <div className="mb-2 flex flex-wrap gap-1">
        {PRESET_GROUPS.map((g) => (
          <MiniButton key={g} active={group === g} onClick={() => setGroup(g)}>
            {g}
          </MiniButton>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1">
        {items.map((p) => (
          <button
            key={p.id}
            onClick={() => useSignal.getState().applyLook(p.id)}
            title={p.name}
            className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors ${
              source === p.source ? 'bg-(--sel)' : 'bg-(--field) hover:bg-(--field-h)'
            }`}
          >
            <PresetSwatch ink={p.ink} paper={p.paper} accent={p.accent} />
            <span className="truncate t-body-sm text-(--tx2)">{p.name}</span>
          </button>
        ))}
      </div>
    </Section>
  )
}

function GeneratorGroup() {
  const kind = useSignal((s) => s.doc.source.kind)
  const id = useSignal((s) => s.doc.source.id)
  const current = sourcesOf(kind).find((s) => s.id === id)

  const setKind = (k: SourceKind) => {
    if (k !== kind) useSignal.getState().setSource(k, firstOf(k))
  }

  return (
    <Section
      title="Generator"
      icon={<Waves {...iconProps} />}
      badge={current?.label}
      defaultOpen
      actions={
        <InfoTip>
          {current?.hint}
          {kind === 'field'
            ? ' Fields compute light per pixel, so they can be dithered.'
            : ' Figures draw marks straight to the canvas, so there is nothing to dither.'}
        </InfoTip>
      }
    >
      <Segments
        options={[
          { id: 'field', label: 'Fields' },
          { id: 'figure', label: 'Figures' },
        ]}
        value={kind}
        onChange={setKind}
      />

      {groupsOf(kind).map((group) => {
        const items = sourcesOf(kind).filter((s) => s.group === group)
        if (!items.length) return null
        return (
          <div key={group} className="mb-2 last:mb-0">
            <SubHeading>{group}</SubHeading>
            <div className="flex flex-wrap gap-1">
              {items.map((s) => (
                <MiniButton
                  key={s.id}
                  active={id === s.id}
                  title={s.hint}
                  onClick={() => useSignal.getState().setSource(kind, s.id)}
                >
                  {s.label}
                </MiniButton>
              ))}
            </div>
          </div>
        )
      })}
    </Section>
  )
}

/**
 * The three shared knobs, and then the generator's own.
 *
 * The reference tool gives every effect the same three and nothing else, which
 * is why half its library barely responds to any of them. Here a generator
 * declares what it has, so Chladni gets its two mode numbers and the attractor
 * gets its four coefficients, and the panel is drawn from that declaration
 * rather than from a list kept somewhere it could fall out of step.
 */
function ShapeGroup() {
  const source = useSignal((s) => s.doc.source)
  const spec = sourcesOf(source.kind).find((s) => s.id === source.id)
  const own = spec?.params ?? []
  const values = paramsFor(source.kind, source.id, source.params)
  const touched = Object.keys(source.params).length > 0

  return (
    <Section
      title="Shape"
      icon={<Sliders {...iconProps} />}
      badge={own.length ? String(own.length + 3) : undefined}
      defaultOpen
      actions={
        touched ? (
          <button
            onClick={() => useSignal.getState().resetParams()}
            title="Back to this generator's defaults"
            aria-label="Reset this generator's controls"
            className="flex h-6 w-6 items-center justify-center rounded-xs text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
          >
            <RotateCcw size={12} strokeWidth={2} />
          </button>
        ) : undefined
      }
    >
      <SliderRow
        label="Intensity"
        hint="How hard the generator is pushed."
        value={source.intensity}
        min={0}
        max={100}
        step={1}
        format={(v) => `${Math.round(v)}`}
        onChange={(v) => edit('signal-intensity', (d) => void (d.source.intensity = v))}
      />
      <SliderRow
        label="Scale"
        hint="How big the features are, before anything is dithered."
        value={source.scale}
        min={0.5}
        max={12}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onChange={(v) => edit('signal-scale', (d) => void (d.source.scale = v))}
      />
      <SliderRow
        label="Speed"
        hint="A multiplier on the clock. At 0 it holds still and is still exportable."
        value={source.speed}
        min={0}
        max={4}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => edit('signal-speed', (d) => void (d.source.speed = v))}
      />

      {own.length > 0 && (
        <>
          <SubHeading>{spec?.label}</SubHeading>
          {own.map((ps) => (
            <SliderRow
              key={ps.key}
              label={ps.label}
              hint={ps.hint}
              value={values[ps.key]}
              min={ps.min}
              max={ps.max}
              step={ps.step}
              format={
                ps.integer
                  ? (v) => `${Math.round(v)}`
                  : ps.step < 0.01
                    ? (v) => v.toFixed(3)
                    : (v) => v.toFixed(2)
              }
              onChange={(v) => useSignal.getState().setParam(ps.key, v)}
            />
          ))}
        </>
      )}
    </Section>
  )
}

function MotionGroup() {
  const kind = useSignal((s) => s.doc.source.kind)
  const id = useSignal((s) => s.doc.source.id)
  const motion = useSignal((s) => s.doc.motion)
  const wantsText = sourceUses(kind, id, 'text')
  const wantsRotate = sourceUses(kind, id, 'rotate')

  // the generator reads neither, so the section does not exist for it
  if (!wantsText && !wantsRotate) return null

  return (
    <Section
      title={wantsText ? 'Text' : 'Rotation'}
      icon={<Layers {...iconProps} />}
      defaultOpen
      actions={
        wantsText ? <InfoTip>Spaces and commas split it into separate lines.</InfoTip> : undefined
      }
    >
      {wantsText && (
        <input
          value={motion.text}
          onChange={(e) => edit('signal-text', (d) => void (d.motion.text = e.target.value))}
          placeholder="RIBBIT"
          aria-label="Text"
          className="h-7 w-full rounded-sm bg-(--field) px-2 t-body-sm text-(--tx) outline-none hover:bg-(--field-h) focus:bg-(--field-h)"
        />
      )}

      {wantsRotate && (
        <>
          <SliderRow label="Tilt" value={motion.rotateX} min={-90} max={90} step={1} format={deg}
            onChange={(v) => edit('signal-rx', (d) => void (d.motion.rotateX = v))} />
          <SliderRow label="Turn" value={motion.rotateY} min={-180} max={180} step={1} format={deg}
            onChange={(v) => edit('signal-ry', (d) => void (d.motion.rotateY = v))} />
          <SliderRow label="Roll" value={motion.rotateZ} min={-180} max={180} step={1} format={deg}
            onChange={(v) => edit('signal-rz', (d) => void (d.motion.rotateZ = v))} />
          <SliderRow label="Auto spin" hint="Degrees a second while playing." value={motion.autoSpin}
            min={0} max={100} step={1} format={(v) => `${Math.round(v)}`}
            onChange={(v) => edit('signal-spin', (d) => void (d.motion.autoSpin = v))} />
          <SliderRow label="Flatten" hint="Collapses the depth axis." value={motion.flatten}
            min={0} max={1} step={0.01} format={pct}
            onChange={(v) => edit('signal-flatten', (d) => void (d.motion.flatten = v))} />
        </>
      )}
    </Section>
  )
}

/*
 * Surprise me, cut into the panel rather than laid on it.
 *
 * It is the one control here worth pressing before you understand anything
 * else, and it used to be buried under a hundred and twelve preset buttons,
 * four groups deep in a scrolling column: the place you reached it from was the
 * place you least needed it. Moving it into the header made it visible; giving
 * it the header's own corner makes it a thing rather than a chip, the same way
 * Draw's tools are a thing and not a floating bar.
 *
 * The hole is 44 deep, which is the header's exact height, so the pocket floor
 * lands on the hairline under the header and the two read as one line. That is
 * not a coincidence to preserve by hand: 32 of button and six of air either
 * side is what `h-11` already was.
 */
const SURPRISE_W = 116
const SURPRISE_H = 32
const SURPRISE_NOTCH = notchForPill(SURPRISE_W, SURPRISE_H, 'corner')

function SurpriseButton({ notched, centerX }: { notched: boolean; centerX: number }) {
  return (
    <button
      onClick={() => useSignal.getState().shuffle()}
      title="A look you would not have gone looking for (R)"
      style={{
        width: SURPRISE_W,
        height: SURPRISE_H,
        // before the first measurement there is no hole to sit in, so it parks
        // where the hole is about to be rather than at a negative offset
        ...(notched
          ? { left: centerX - SURPRISE_NOTCH.width / 2 + NOTCH_PAD, top: NOTCH_PAD }
          : { right: 0, top: NOTCH_PAD }),
        /*
         * White in both themes, from the pair of ladder tokens that do not
         * swap: on the dark panel it is the brightest thing in the column,
         * which is what a button nobody has to understand should be, and on
         * the light one the hairline is what separates #fff from the #f5f6f6
         * behind it. Both are mixed from the same black, so the edge stays a
         * grey of the button rather than a colour laid over it.
         */
        background: 'var(--inverse-canvas)',
        color: 'var(--canvas)',
        borderColor: 'color-mix(in srgb, var(--canvas) 16%, transparent)',
      }}
      className="group absolute z-10 flex items-center justify-center gap-1.5 overflow-hidden rounded-md border t-body-sm font-medium"
    >
      {/*
        The pass of colour, under the label rather than over it: it is a
        surface the text is sitting on for a moment, not a film across it, and
        at these alphas the label never drops below its resting contrast.

        Two gradients on one layer, so one transform moves both and they cannot
        drift apart. The white core is the shine and the hues either side are
        what makes it read as a spectrum rather than a glare; the rainbow alone
        looks like a smear, and the highlight alone is every other button's
        sheen.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-[55%] group-hover:animate-[surprise-sheen_620ms_var(--ease-settle)_forwards]"
        style={{
          // parked a full band clear of the left edge; the keyframe carries it
          // from here to past the right, and `forwards` leaves it out there
          left: '-60%',
          background:
            'linear-gradient(100deg, transparent 34%, rgba(255,255,255,0.85) 50%, transparent 66%), linear-gradient(100deg, transparent 2%, rgba(255,90,110,0.5) 18%, rgba(255,190,90,0.5) 32%, rgba(105,220,150,0.5) 48%, rgba(90,190,255,0.55) 64%, rgba(180,130,255,0.5) 80%, transparent 98%)',
        }}
      />
      <Shuffle size={13} strokeWidth={2} className="relative" />
      <span className="relative">Surprise me</span>
    </button>
  )
}

export function SignalLeftPanel() {
  const open = useStudio((s) => s.toolPanelOpen)
  if (!open) return null

  return (
    <NotchedFrame
      className="w-[280px] shrink-0"
      notch={SURPRISE_NOTCH}
      bar={(p) => <SurpriseButton notched={p.notched} centerX={p.centerX} />}
    >
      <div className="flex h-full flex-col">
        {/* the title keeps the end of the header the pocket does not take */}
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-(--line) px-3">
          <Waves size={14} strokeWidth={1.9} className="text-(--tx2)" />
          <span className="t-body-sm font-semibold text-(--tx)">Pattern</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LooksGroup />
          <GeneratorGroup />
          <ShapeGroup />
          <MotionGroup />
        </div>
      </div>
    </NotchedFrame>
  )
}
