/**
 * The tray.
 *
 * "Most of the work went into the toolbar. It changes shape rather than
 * swapping panels: pick a colour and the row of pens becomes the palette, open
 * the size controls and it becomes two sliders, minimise it and it rolls up
 * into a disc with the tool you're holding still in it. Every state morphs
 * smoothly into the next."
 *
 * The distinction is easy to read as decoration and it is not. A palette that
 * opens *next to* the toolbar is a second object: it has its own edges, it
 * covers something, and it leaves you tracking two things. A toolbar that
 * *becomes* the palette is still one object, still in the same place, and the
 * pens are visibly the thing that turned into the colours. You never lose it,
 * because it never went anywhere.
 *
 * Mechanically that is three things working together, and all three are needed
 * or it reads as a swap:
 *
 *   1. Every face is rendered at once, absolutely positioned, one on top of the
 *      next. Only the active one is opaque.
 *   2. The outgoing face blurs and shrinks slightly as it leaves while the
 *      incoming one arrives 60ms later, so the bar is never empty mid-change.
 *   3. The shell animates its *width* to whatever the active face measures, on
 *      a settling curve slower than either fade. That size change is the part
 *      you actually read as "it turned into something else".
 *
 * Sizes, easings and shadows are the real ones rather than eyeballed: an 84px
 * bar with a 42px radius is a true pill, and the pens standing in it are
 * clipped by its own floor, which is what makes them read as pens in a cup.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SQUEEZE, charge, useHold } from '../lib/hold'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpToLine,
  Check,
  ChevronDown,
  Copy,
  List,
  MoveDown,
  MoveUp,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
} from 'lucide-react'
import { ERASER, PENS, PEN_ORDER } from './pens'
import { PenGlyph } from './PenGlyph'
import { useDraw, type TrayFace } from './store'
import {
  FILL_SWATCHES,
  FONT_SIZES,
  INK_SWATCHES,
  NOTE_SWATCHES,
  STROKE_WIDTHS,
  type DrawStyle,
  type PenId,
  type TextAlign,
} from './types'

/** Under this the bar stands up on the left edge and trims its toolset. */
const NARROW = 680
const CHIP = 30
const CHIP_GAP = 5

function Round({
  label,
  onClick,
  disabled,
  danger,
  active,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      className="dw-round"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      data-tone={danger ? 'danger' : undefined}
      data-active={active ? '' : undefined}
    >
      {children}
    </button>
  )
}

/** Rough perceived lightness, for deciding what colour a tick should be. */
function isPale(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return true
  const n = parseInt(m[1], 16)
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150
}

/** A swatch, with the tick that pops in on the chosen one. */
function Chip({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className="dw-chip"
      onClick={onClick}
      title={color}
      aria-label={color}
      data-active={active ? '' : undefined}
      style={
        color === 'transparent'
          ? {
              backgroundImage:
                'linear-gradient(45deg,rgba(128,128,128,.28) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.28) 75%),linear-gradient(45deg,rgba(128,128,128,.28) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.28) 75%)',
              backgroundSize: '8px 8px',
              backgroundPosition: '0 0, 4px 4px',
            }
          : { background: color }
      }
    >
      <Check className="dw-tick" strokeWidth={3} color={isPale(color) ? '#111' : '#fff'} />
    </button>
  )
}

function Slider({
  value,
  min,
  max,
  step = 1,
  width = 132,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  width?: number
  onChange: (v: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))

  const scrub = (e: React.PointerEvent) => {
    const el = ref.current!
    el.setPointerCapture(e.pointerId)
    const apply = (clientX: number) => {
      const r = el.getBoundingClientRect()
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      onChange(Math.round((min + t * (max - min)) / step) * step)
    }
    apply(e.clientX)
    const move = (ev: PointerEvent) => apply(ev.clientX)
    const up = () => {
      el.releasePointerCapture(e.pointerId)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={ref}
      className="dw-slider"
      style={{ width }}
      onPointerDown={scrub}
      role="slider"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
    >
      <span className="dw-slider-track" />
      <span className="dw-slider-fill" style={{ width: `${pct}%` }} />
      <span className="dw-slider-knob" style={{ left: `${pct}%` }} />
    </div>
  )
}

const G = ({ children }: { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round">
    {children}
  </svg>
)

/**
 * The shape face's opener, which is also its readout.
 *
 * What was here before was a rectangle with a line through it, which named
 * nothing: it read as the placeholder an image failed to load into, and it sat
 * there unchanged whatever the shape settings said. Both its neighbours are
 * readouts, the wheel is the ink and the dot is the size, so this is one too.
 * A small shape wearing the current fill, fill style and corner treatment, so
 * what the button opens is what the button is already showing.
 */
function ShapeGlyph({ style }: { style: DrawStyle }) {
  /*
   * Named after the shape it cuts rather than by useId, whose output carries
   * punctuation that a url(#…) reference has to escape. Two glyphs with the
   * same corners want the same hole anyway, and two with different corners get
   * different names, so there is nothing here for a collision to break.
   */
  const hole = `dw-shape-fill-${style.edges}`
  const r = style.edges === 'round' ? 3.2 : 0.5
  const box = { x: 2.5, y: 3.5, width: 11, height: 9, rx: r }
  const filled = style.fill !== 'transparent'
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeLinecap="round">
      {filled && style.fillStyle === 'solid' && <rect {...box} fill={style.fill} />}
      {filled && style.fillStyle !== 'solid' && (
        <>
          {/* the hatching is drawn long and clipped, so it meets the edges the
              way the real fill does instead of stopping short of them */}
          <clipPath id={hole}>
            <rect {...box} />
          </clipPath>
          <g clipPath={`url(#${hole})`} stroke={style.fill} strokeWidth={1.1}>
            <path d="M-1 13 L11 1 M2 16 L14 4 M5 19 L17 7" />
            {style.fillStyle === 'cross-hatch' && <path d="M-1 3 L11 15 M2 0 L14 12 M5 -3 L17 9" />}
          </g>
        </>
      )}
      <rect {...box} stroke="currentColor" strokeWidth={1.4} />
    </svg>
  )
}

/** The note face's opener: a little card wearing the current paper colour, square-cut like the real thing. */
function NoteGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2.5" y="2.5" width="11" height="11" fill={color} stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
    </svg>
  )
}

/** A row of picture-options, for the shape face. */
function Picks<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string; icon: ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      {options.map((o) => (
        <button
          key={String(o.id)}
          onClick={() => onChange(o.id)}
          title={o.label}
          aria-label={o.label}
          className="dw-round"
          style={{ width: 32, height: 32 }}
          data-active={value === o.id ? '' : undefined}
        >
          {o.icon}
        </button>
      ))}
    </div>
  )
}

/** Radius of the charge ring inside a 42px button, clear of its own edge. */
const RING_R = 19
const RING_C = 2 * Math.PI * RING_R

/**
 * Clearing the canvas, behind a hold.
 *
 * Throwing away everything on the sheet is the one irreversible-feeling action
 * in the tray, and it sat one stray click away from a row of pens. A confirm
 * dialog is the usual guard and a poor one: it interrupts to ask a question you
 * answer without reading. Holding makes the deliberation continuous instead —
 * you can feel it filling and let go at any point, so the intent is proven by
 * the gesture rather than asserted in a second click.
 *
 * The timing and the curve come from the same hook the Start over button uses,
 * so the two feel like the same control wearing different shapes. Only the
 * drawing differs: a pill can sweep its own cap across itself, a circle fills
 * a ring round its edge.
 */
function HoldRound({
  label,
  hint,
  onHold,
  children,
}: {
  label: string
  hint: string
  onHold: () => void
  children: ReactNode
}) {
  const { progress, phase, nudge, clearNudge, reset, handlers } = useHold(onHold)
  const fired = phase === 'fired'
  const holding = phase === 'holding'

  /* raw `progress` is the clock; `p` is what the eye is shown */
  const p = fired ? 1 : charge(progress)
  const scale = fired ? 1 : 1 - SQUEEZE * p

  return (
    <span className="relative inline-flex shrink-0">
      {nudge && (
        <span aria-hidden onAnimationEnd={clearNudge} className="dw-hold-hint hold-hint">
          Press and hold
        </span>
      )}
      <button
        {...handlers}
        onAnimationEnd={reset}
        data-tone="danger"
        data-holding={holding ? '' : undefined}
        title={`${hint} (press and hold)`}
        aria-label={`${label}. Press and hold to confirm.`}
        className={`dw-round ${fired ? 'hold-pop' : ''}`}
      >
        <svg className="dw-hold-ring" viewBox="0 0 42 42" aria-hidden>
          <circle className="dw-hold-track" cx="21" cy="21" r={RING_R} />
          <circle
            className="dw-hold-arc"
            cx="21"
            cy="21"
            r={RING_R}
            strokeDasharray={RING_C}
            /* full circumference of offset is an empty ring; zero is a closed one */
            strokeDashoffset={RING_C * (1 - p)}
          />
        </svg>
        <span
          style={{ transform: `scale(${scale})` }}
          className={`flex ${holding ? '' : 'transition-transform duration-200 ease-out'}`}
        >
          {children}
        </span>
      </button>
    </span>
  )
}

/**
 * The note face's controls: paper colour, size, and how the text sits in it.
 * Nothing here is a shape property — no fill, no sloppiness, no stroke width —
 * a note is a card with words on it, not a wobbly rectangle wearing one.
 */
function NoteControls({
  style,
  setStyle,
}: {
  style: DrawStyle
  setStyle: (patch: Partial<DrawStyle>, label?: string) => void
}) {
  return (
    <>
      <div className="dw-swatches">
        {NOTE_SWATCHES.map((c) => (
          <Chip
            key={c}
            color={c}
            active={style.noteColor.toLowerCase() === c.toLowerCase()}
            onClick={() => setStyle({ noteColor: c }, 'draw-notecolor')}
          />
        ))}
      </div>
      {/* "custom is the swatch that opens the hex field and spectrum" */}
      <label className="dw-custom" title="Custom paper colour">
        <span />
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(style.noteColor) ? style.noteColor : '#fdf2a1'}
          onChange={(e) => setStyle({ noteColor: e.target.value }, 'draw-notecolor')}
          aria-label="Custom paper colour"
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>

      <span className="dw-divider" />

      <Picks
        value={style.fontSize}
        onChange={(v) => setStyle({ fontSize: v }, 'draw-fontsize')}
        options={FONT_SIZES.map((size, i) => ({
          id: size,
          label: ['Small', 'Medium', 'Large', 'Extra large'][i],
          icon: (
            <span aria-hidden style={{ fontSize: 9 + i * 2, fontWeight: 600, lineHeight: 1 }}>
              A
            </span>
          ),
        }))}
      />

      <span className="dw-divider" />

      {/*
       * One exclusive row of four rather than a bullet toggle beside three
       * alignment radios: a bulleted note reads left-aligned the way every
       * list does, so "bulleted" and "aligned" are really one choice with
       * four answers, not two independent ones that could disagree.
       */}
      <Picks<'bullet' | TextAlign>
        value={style.bulleted ? 'bullet' : style.textAlign}
        onChange={(v) => {
          if (v === 'bullet') setStyle({ bulleted: true }, 'draw-format')
          else setStyle({ bulleted: false, textAlign: v }, 'draw-format')
        }}
        options={[
          { id: 'bullet', label: 'Bulleted', icon: <List size={15} strokeWidth={1.9} /> },
          { id: 'left', label: 'Align left', icon: <TextAlignStart size={15} strokeWidth={1.9} /> },
          { id: 'center', label: 'Align centre', icon: <TextAlignCenter size={15} strokeWidth={1.9} /> },
          { id: 'right', label: 'Align right', icon: <TextAlignEnd size={15} strokeWidth={1.9} /> },
        ]}
      />
    </>
  )
}

export function PenTray() {
  const tray = useDraw((s) => s.tray)
  const face = useDraw((s) => s.trayFace)
  const collapsed = useDraw((s) => s.trayCollapsed)
  const tool = useDraw((s) => s.tool)
  const pen = useDraw((s) => s.pen)
  const penInk = useDraw((s) => s.penInk)
  const penSize = useDraw((s) => s.penSize)
  const eraserSize = useDraw((s) => s.eraserSize)
  const style = useDraw((s) => s.style)
  const gauge = useDraw((s) => s.trayGauge)
  const selectedIds = useDraw((s) => s.selectedIds)
  const elements = useDraw((s) => s.doc.elements)
  const st = useDraw.getState

  const shellRef = useRef<HTMLDivElement>(null)
  const panelRefs = useRef<Partial<Record<TrayFace, HTMLDivElement | null>>>({})
  const [box, setBox] = useState<{ w: number; h: number }>()
  const [room, setRoom] = useState(1200)
  const dragging = useRef(false)
  /** did the last press travel far enough to be a drag rather than a click? */
  const dragMoved = useRef(false)

  const holdingEraser = tool === 'eraser'
  const narrow = room < NARROW
  const vertical = narrow || tray.placement === 'left'

  const heldSpec = holdingEraser ? ERASER : PENS[pen]
  const heldSize = holdingEraser ? eraserSize : penSize[pen]
  const heldInk = holdingEraser ? '#e8e0d4' : penInk[pen]
  const heldRange = holdingEraser ? ERASER.range : PENS[pen].range

  /** Shapes are in play, so the bar should be offering their properties. */
  const shapey =
    selectedIds.length > 0 || ['rect', 'diamond', 'ellipse', 'arrow', 'line', 'text', 'note'].includes(tool)

  /*
   * A note's properties are nothing like a shape's — colour and a bit of text
   * formatting instead of fill and sloppiness — so the "shape" face shows one
   * or the other rather than both at once. Reaching for the note tool means
   * it, and so does having only notes selected; a mixed selection falls back
   * to the shape controls rather than trying to show both.
   */
  const selected = selectedIds.length ? elements.filter((e) => selectedIds.includes(e.id)) : []
  const noteMode = tool === 'note' || (selected.length > 0 && selected.every((e) => e.kind === 'note'))

  /*
   * Measure the active face and let the shell animate to it. This is what makes
   * the morph work without a table of hard-coded sizes per state, so a trimmed
   * toolset or a clamped palette resizes the bar correctly for free.
   */
  useLayoutEffect(() => {
    const el = panelRefs.current[face]
    if (!el) return
    // both axes: standing on an edge the bar grows downward instead of sideways
    const measure = () => setBox({ w: el.scrollWidth, h: el.scrollHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [face, vertical, narrow, tool, pen, shapey, style.fill, holdingEraser, noteMode, style.bulleted])

  // how much canvas the bar has to live in, for the responsive rule
  useEffect(() => {
    const parent = shellRef.current?.parentElement
    if (!parent) return
    const ro = new ResizeObserver(() => setRoom(parent.getBoundingClientRect().width))
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  /*
   * "swatches — your own palette, clamped to what the bar can hold." So the
   * palette is trimmed to the room actually available rather than being allowed
   * to run the bar off the side of the canvas.
   */
  const fits = Math.max(4, Math.floor((room - 320) / (CHIP + CHIP_GAP)))
  const swatches = vertical
    ? INK_SWATCHES.slice(0, 8)
    : INK_SWATCHES.slice(0, Math.min(INK_SWATCHES.length, fits))

  /*
   * "draggable lets people pick it up and move it themselves."
   *
   * Including while it is rolled up, which is the state you most want to move
   * it in: a disc is what you leave on screen when you want the canvas clear,
   * so being forced to expand it, drag it, and roll it up again is exactly
   * backwards. Collapsed, the whole disc is the handle; a press that never
   * travels is still a click and still opens it, which `dragMoved` decides.
   */
  const onPointerDown = (e: React.PointerEvent) => {
    if (!tray.draggable) return
    if (!collapsed && (e.target as HTMLElement).closest('button, input, [role="slider"], label')) return
    dragMoved.current = false
    const shell = shellRef.current!
    const parent = shell.parentElement!
    const pr = parent.getBoundingClientRect()
    const sr = shell.getBoundingClientRect()
    const grabX = e.clientX - sr.left
    const grabY = e.clientY - sr.top
    dragging.current = true
    shell.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      // a few pixels of slop, so a slightly shaky click still counts as a click
      if (Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) > 4) {
        dragMoved.current = true
      }
      if (!dragMoved.current) return
      st().setTray({
        offset: {
          x: Math.min(pr.width - sr.width - 4, Math.max(4, ev.clientX - pr.left - grabX)),
          y: Math.min(pr.height - sr.height - 4, Math.max(4, ev.clientY - pr.top - grabY)),
        },
      })
    }
    const up = () => {
      dragging.current = false
      shell.releasePointerCapture(e.pointerId)
      shell.removeEventListener('pointermove', move)
      shell.removeEventListener('pointerup', up)
      /*
       * Unrolling is handled here rather than left to the button underneath.
       * Capturing the pointer for the drag redirects the compatibility mouse
       * events to the shell, so `click` never reaches the disc's own button and
       * a tap did nothing at all: the bar could be dragged but not reopened.
       */
      if (collapsed && !dragMoved.current) useDraw.getState().setTrayCollapsed(false)
    }
    shell.addEventListener('pointermove', move)
    shell.addEventListener('pointerup', up)
  }

  const goto = (f: TrayFace) => st().setTrayFace(face === f ? 'tools' : f)
  const setStyle = (patch: Partial<DrawStyle>, label?: string) => st().setStyle(patch, label)

  // the trimmed set the article drops to on a narrow canvas
  const visiblePens: PenId[] = narrow ? ['pencil', 'pen', 'marker', 'highlighter', 'brush'] : PEN_ORDER

  /*
   * Where the bar will be once it has finished changing shape.
   *
   * Read from the target rather than from getBoundingClientRect, because the
   * width animates over half a second and measuring mid-transition would clamp
   * against a size the bar is only briefly.
   */
  const footprint = collapsed
    ? vertical
      ? { w: 66 * 0.848, h: 66 * 0.848 }
      : { w: 84 * 0.667, h: 84 * 0.667 }
    : vertical
      ? { w: 66, h: box?.h ?? 84 }
      : { w: box?.w ?? 84, h: 84 }

  /*
   * Keep a bar that was put somewhere by hand on the canvas when its footprint
   * changes. Rolled up it is 56px across; opened it can be nine hundred, so one
   * parked in a corner would unroll straight off the edge and most of the tools
   * would be unreachable. Re-clamping on every size change is what makes "drop
   * it in the corner and roll it up" a safe thing to do.
   */
  const offX = tray.offset?.x
  const offY = tray.offset?.y
  useLayoutEffect(() => {
    const parent = shellRef.current?.parentElement
    const off = useDraw.getState().tray.offset
    if (!parent || !off) return
    const pr = parent.getBoundingClientRect()
    const x = Math.min(Math.max(4, pr.width - footprint.w - 4), Math.max(4, off.x))
    const y = Math.min(Math.max(4, pr.height - footprint.h - 4), Math.max(4, off.y))
    if (Math.abs(x - off.x) > 0.5 || Math.abs(y - off.y) > 0.5) {
      useDraw.getState().setTray({ offset: { x, y } })
    }
  }, [collapsed, footprint.w, footprint.h, offX, offY, room])

  const pos: React.CSSProperties = tray.offset
    ? { left: tray.offset.x, top: tray.offset.y }
    : vertical
      ? { left: tray.inset, top: '50%', transform: 'translateY(-50%)' }
      : {
          bottom: tray.inset,
          left: tray.align === 'start' ? tray.inset : tray.align === 'end' ? undefined : '50%',
          right: tray.align === 'end' ? tray.inset : undefined,
          transform: tray.align === 'center' ? 'translateX(-50%)' : undefined,
        }

  const back = (
    <Round label="Back to the tools" onClick={() => st().setTrayFace('tools')}>
      <ArrowLeft size={18} strokeWidth={1.9} />
    </Round>
  )

  const dot = Math.max(5, Math.min(26, heldSize))
  const dotStyle: React.CSSProperties = {
    width: dot,
    height: dot,
    background: holdingEraser ? 'var(--dw-ink-soft)' : style.stroke,
    opacity: holdingEraser ? 0.6 : style.opacity,
  }

  return (
    <div
      ref={shellRef}
      className="dw-bar pointer-events-auto absolute z-30"
      data-depth={tray.depth}
      data-vertical={vertical ? '' : undefined}
      data-collapsed={collapsed ? '' : undefined}
      onPointerDown={onPointerDown}
      style={{
        ...pos,
        width: collapsed || vertical ? undefined : box?.w,
        height: collapsed ? undefined : vertical ? box?.h : undefined,
        // the fold shrinks toward the edge the bar lives on, not toward nothing
        transformOrigin: vertical ? 'left center' : 'center bottom',
        cursor: tray.draggable && !collapsed ? (dragging.current ? 'grabbing' : 'grab') : undefined,
      }}
    >
      {/* ----- the pens ----- */}
      <div
        ref={(el) => void (panelRefs.current.tools = el)}
        className="dw-panel"
        data-active={face === 'tools' && !collapsed ? '' : undefined}
      >
        <div className="dw-seated">
          {visiblePens.map((id) => {
            const spec = PENS[id]
            const on = tool === 'freedraw' && pen === id
            return (
              <button
                key={id}
                className="dw-tool"
                data-active={on ? '' : undefined}
                onClick={() => st().setPen(id)}
                onDoubleClick={() => st().setTrayFace('size')}
                title={`${spec.name} — ${spec.key.toUpperCase()}`}
                aria-label={spec.name}
                aria-pressed={on}
              >
                <PenGlyph
                  spec={spec}
                  ink={penInk[id]}
                  studio={tray.look === 'studio'}
                  gauge={gauge ? penSize[id] : undefined}
                />
              </button>
            )
          })}
          <button
            className="dw-tool"
            data-active={holdingEraser ? '' : undefined}
            onClick={() => st().setTool('eraser')}
            onDoubleClick={() => st().setTrayFace('size')}
            title="Eraser — E"
            aria-label="Eraser"
            aria-pressed={holdingEraser}
          >
            <PenGlyph spec={ERASER} ink="#e8e0d4" studio={tray.look === 'studio'} />
          </button>
        </div>

        <span className="dw-divider" />

        <div className="dw-row">
          {/* the control that opens the palette is itself the readout of the ink */}
          <Round label="Ink" onClick={() => goto('ink')}>
            <span className="dw-wheel">
              <span className="dw-wheel-ink" style={{ background: style.stroke }} />
            </span>
          </Round>
          <Round label="Size and opacity" onClick={() => goto('size')}>
            <span className="dw-dot" style={dotStyle} />
          </Round>
          {shapey && (
            <Round label={noteMode ? 'Note style' : 'Shape style'} onClick={() => goto('shape')}>
              {noteMode ? <NoteGlyph color={style.noteColor} /> : <ShapeGlyph style={style} />}
            </Round>
          )}

          <span className="dw-divider" />

          {/*
           * No undo or redo here any more. They moved to the top-right corner
           * of the canvas, and two sets of the same pair on one screen is worse
           * than either: you stop knowing which one you reached for, and both
           * claim the same accessible name.
           */}
          {!narrow && (
            <HoldRound
              label="Clear the canvas"
              hint="Clear the canvas"
              onHold={() => st().clear()}
            >
              <Trash2 size={17} strokeWidth={1.9} />
            </HoldRound>
          )}
          <Round label="Roll the bar up" onClick={() => st().setTrayCollapsed(true)}>
            <ChevronDown size={18} strokeWidth={1.9} className={vertical ? 'rotate-90' : ''} />
          </Round>
        </div>
      </div>

      {/* ----- the palette the pens turn into ----- */}
      <div
        ref={(el) => void (panelRefs.current.ink = el)}
        className="dw-panel"
        data-active={face === 'ink' && !collapsed ? '' : undefined}
      >
        <div className="dw-row">
          {back}
          <div className="dw-swatches">
            {swatches.map((c) => (
              <Chip
                key={c}
                color={c}
                active={style.stroke.toLowerCase() === c.toLowerCase()}
                onClick={() => st().setInk(c)}
              />
            ))}
          </div>
          {/* "custom is the swatch that opens the hex field and spectrum" */}
          <label className="dw-custom" title="Custom colour">
            <span />
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(style.stroke) ? style.stroke : '#1e1e1e'}
              onChange={(e) => st().setInk(e.target.value)}
              aria-label="Custom colour"
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          {!vertical && (
            <span className="dw-hex">
              <input
                value={style.stroke}
                onChange={(e) => st().setInk(e.target.value)}
                spellCheck={false}
                aria-label="Colour hex"
              />
            </span>
          )}
        </div>
      </div>

      {/* ----- the sliders the pens turn into ----- */}
      <div
        ref={(el) => void (panelRefs.current.size = el)}
        className="dw-panel"
        data-active={face === 'size' && !collapsed ? '' : undefined}
      >
        <div className="dw-row">
          {back}
          <span className="dw-dot" style={dotStyle} />
          <Slider
            value={heldSize}
            min={heldRange[0]}
            max={heldRange[1]}
            step={0.5}
            width={vertical ? 92 : 140}
            onChange={(v) => st().setPenSize(v)}
          />
          <span className="dw-hex" style={{ pointerEvents: 'none' }}>
            {heldSize.toFixed(heldSize < 10 ? 1 : 0)}
          </span>
          {/*
           * "controls lets you switch size and opacity off separately. That
           * matters on the vertical rail, where two sliders stacked on top of
           * each other end up taller than the canvas."
           */}
          {!vertical && !holdingEraser && (
            <>
              <span className="dw-divider" />
              <Slider
                value={style.opacity * 100}
                min={10}
                max={100}
                width={112}
                onChange={(v) => setStyle({ opacity: v / 100 }, 'draw-opacity')}
              />
              <span className="dw-hex" style={{ pointerEvents: 'none' }}>
                {Math.round(style.opacity * 100)}%
              </span>
            </>
          )}
        </div>
      </div>

      {/* ----- shape properties, as another face rather than another panel ----- */}
      <div
        ref={(el) => void (panelRefs.current.shape = el)}
        className="dw-panel"
        data-active={face === 'shape' && !collapsed ? '' : undefined}
      >
        <div className="dw-row">
          {back}
          {noteMode && <NoteControls style={style} setStyle={setStyle} />}
          {!noteMode && (
            <>
            <div className="dw-swatches">
              {FILL_SWATCHES.map((c) => (
                <Chip
                  key={c}
                  color={c}
                  active={style.fill.toLowerCase() === c.toLowerCase()}
                  onClick={() => setStyle({ fill: c }, 'draw-fill')}
                />
              ))}
            </div>
            {style.fill !== 'transparent' && (
              <Picks
                value={style.fillStyle}
                onChange={(v) => setStyle({ fillStyle: v }, 'draw-fillstyle')}
                options={[
                  {
                    id: 'hachure' as const,
                    label: 'Hachure',
                    icon: (
                      <G>
                        <path d="M3 10l6-6M6 12l6-6M9 13.5l4-4" strokeWidth={1.2} />
                      </G>
                    ),
                  },
                  {
                    id: 'cross-hatch' as const,
                    label: 'Cross-hatch',
                    icon: (
                      <G>
                        <path d="M3 10l6-6M6 12l6-6M6 3l6 6M3 6l6 6" strokeWidth={1.1} />
                      </G>
                    ),
                  },
                  {
                    id: 'solid' as const,
                    label: 'Solid',
                    icon: (
                      <G>
                        <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" strokeWidth={0} />
                      </G>
                    ),
                  },
                ]}
              />
            )}
            <span className="dw-divider" />
            <Picks
              value={style.strokeWidth}
              onChange={(v) => setStyle({ strokeWidth: v }, 'draw-sw')}
              options={STROKE_WIDTHS.map((w, i) => ({
                id: w,
                label: ['Thin', 'Bold', 'Extra bold'][i],
                icon: (
                  <G>
                    <path d="M3 8h10" strokeWidth={w === 1 ? 1 : w === 2 ? 2.2 : 3.6} />
                  </G>
                ),
              }))}
            />
            <Picks
              value={style.strokeStyle}
              onChange={(v) => setStyle({ strokeStyle: v }, 'draw-ss')}
              options={[
                {
                  id: 'solid' as const,
                  label: 'Solid',
                  icon: (
                    <G>
                      <path d="M3 8h10" strokeWidth={2} />
                    </G>
                  ),
                },
                {
                  id: 'dashed' as const,
                  label: 'Dashed',
                  icon: (
                    <G>
                      <path d="M3 8h10" strokeWidth={2} strokeDasharray="3.5 3" />
                    </G>
                  ),
                },
                {
                  id: 'dotted' as const,
                  label: 'Dotted',
                  icon: (
                    <G>
                      <path d="M3 8h10" strokeWidth={2} strokeDasharray="0.5 3" />
                    </G>
                  ),
                },
              ]}
            />
            <span className="dw-divider" />
            {/* sloppiness, shown as the thing it does: one box drawn three ways */}
            <Picks
              value={style.sloppiness}
              onChange={(v) => setStyle({ sloppiness: v }, 'draw-slop')}
              options={[
                {
                  id: 0 as const,
                  label: 'Architect',
                  icon: (
                    <G>
                      <rect x="2.5" y="3.5" width="11" height="9" strokeWidth={1.3} />
                    </G>
                  ),
                },
                {
                  id: 1 as const,
                  label: 'Artist',
                  icon: (
                    <G>
                      <path d="M3 4.2q5-.9 10 0M13.4 4q.4 4-.1 8M13 12.4q-5 .8-10 .1M2.7 12.2q-.4-4 .1-8" strokeWidth={1.3} />
                    </G>
                  ),
                },
                {
                  id: 2 as const,
                  label: 'Cartoonist',
                  icon: (
                    <G>
                      <path
                        d="M2.6 4.6q5-1.8 10.6-.3M13.8 3.6q.7 4.6-.4 8.6M13.6 12.9q-5.4 1.4-10.8-.2M2.3 13q-1-4.3.1-8.7M3.4 3.9q5.2-1 10 .4"
                        strokeWidth={1.2}
                      />
                    </G>
                  ),
                },
              ]}
            />
            <Picks
              value={style.edges}
              onChange={(v) => setStyle({ edges: v }, 'draw-edges')}
              options={[
                {
                  id: 'sharp' as const,
                  label: 'Sharp edges',
                  icon: (
                    <G>
                      <path d="M3 13V3h10" strokeWidth={1.6} />
                    </G>
                  ),
                },
                {
                  id: 'round' as const,
                  label: 'Round edges',
                  icon: (
                    <G>
                      <path d="M3 13V7a4 4 0 0 1 4-4h6" strokeWidth={1.6} />
                    </G>
                  ),
                },
              ]}
            />
            </>
          )}

          {/*
           * Stacking order and the two whole-element actions. These lived in
           * the properties panel before it was removed, and unlike delete and
           * duplicate they have no keyboard equivalent, so without them here
           * there would be no way at all to put one shape behind another.
           * Only shown with something actually selected: they are meaningless
           * as a default for the next shape.
           */}
          {selectedIds.length > 0 && (
            <>
              <span className="dw-divider" />
              <Picks
                value={'' as string}
                onChange={(v) => st().reorder(v as 'back' | 'backward' | 'forward' | 'front')}
                options={[
                  { id: 'back', label: 'Send to back', icon: <ArrowDownToLine size={15} /> },
                  { id: 'backward', label: 'Send backward', icon: <MoveDown size={15} /> },
                  { id: 'forward', label: 'Bring forward', icon: <MoveUp size={15} /> },
                  { id: 'front', label: 'Bring to front', icon: <ArrowUpToLine size={15} /> },
                ]}
              />
              <span className="dw-divider" />
              <Round label="Duplicate — Ctrl+D" onClick={() => st().duplicateSelection()}>
                <Copy size={16} strokeWidth={1.9} />
              </Round>
              <Round label="Delete — Del" danger onClick={() => st().removeElements(selectedIds)}>
                <Trash2 size={16} strokeWidth={1.9} />
              </Round>
            </>
          )}
        </div>
      </div>

      {/* ----- rolled up, with the tool you are holding still in it ----- */}
      <div className="dw-collapsed" data-shown={collapsed ? '' : undefined}>
        <PenGlyph spec={heldSpec} ink={heldInk} studio={tray.look === 'studio'} height={68} />
      </div>
      {collapsed && (
        <button
          className="dw-expand-hit"
          onClick={() => {
            // a press that turned into a drag has already done its job
            if (dragMoved.current) return
            st().setTrayCollapsed(false)
          }}
          title="Open the tools — drag to move it"
          aria-label="Open the tools"
        />
      )}
    </div>
  )
}
