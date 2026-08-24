/**
 * The tools, cut into the top edge of the canvas.
 *
 * This has now been three things. A floating bar across the top plus a docked
 * 316px properties panel, which spent most of the window on chrome. Then a slim
 * rail down the right, which was better but still a slab of furniture laid over
 * the picture and left the settings popover with nowhere to open. Now it sits
 * in a notch cut out of the canvas, the way Studio's transform tools do.
 *
 * That is not a stylistic echo, it is the same argument: the tools act on the
 * thing you are looking at, so they belong over it, and cutting them *into* the
 * panel means they cost the drawing no pixels at all. The canvas is genuinely
 * that shape, so nothing is covered. The notch is sized around this exact row
 * by `notchFor`, so the pocket fits the buttons rather than the buttons being
 * nudged to fit a pocket.
 *
 * The digits stay printed in the corners. A drawing tool lives or dies on
 * whether you can change tools without looking.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  Download,
  EllipsisVertical,
  Frame,
  Hand,
  Lock,
  LockOpen,
  Minus,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react'
import { FRAME_BUTTON, FRAME_INSET, NOTCH_BUTTON, NOTCH_GAP, NOTCH_PAD } from '../lib/notch'
import { pickMediaFile } from '../store'
import { DRAW_NOTCH, SHAPE_TOOLS } from './shapeTools'
import { useDraw } from './store'
import { BOARD_SWATCHES, PAPER_SWATCHES, SHEET_NAMES, type GridStyle } from './types'

function Btn({
  label,
  digit,
  active,
  onClick,
  children,
}: {
  label: string
  digit?: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{ width: NOTCH_BUTTON, height: NOTCH_BUTTON }}
      className={`relative z-10 flex shrink-0 items-center justify-center rounded-md transition-colors ${
        active ? 'bg-(--sel) text-(--tx)' : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
      }`}
    >
      {children}
      {digit && (
        <span
          aria-hidden
          className={`absolute right-0.5 bottom-0 text-[9px] leading-none ${
            active ? 'text-(--tx)' : 'text-(--tx3)'
          }`}
        >
          {digit}
        </span>
      )}
    </button>
  )
}

const Rule = () => (
  <span
    aria-hidden
    className="shrink-0 self-center bg-(--line)"
    style={{ width: 1, height: NOTCH_BUTTON - 12 }}
  />
)

/**
 * A row of sheet swatches. Both families are picked exactly the same way.
 *
 * Wraps rather than scrolls, because the families have grown past what fits on
 * one line and a swatch you have to scroll to find is a swatch nobody uses.
 */
function Sheets({ swatches, current }: { swatches: string[]; current: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {swatches.map((c) => (
        <button
          key={c}
          onClick={() => useDraw.getState().setBackground(c)}
          title={SHEET_NAMES[c] ?? c}
          aria-label={SHEET_NAMES[c] ?? c}
          className={`h-6 w-6 shrink-0 rounded-sm border transition-transform hover:scale-110 ${
            current.toLowerCase() === c.toLowerCase() ? 'is-picked' : 'border-(--line)'
          }`}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="mb-2.5">
    <p className="mb-1.5 t-caption text-(--tx3)">{label}</p>
    {children}
  </div>
)

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div
      className="grid gap-0.5 rounded-sm bg-(--field) p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`h-6 truncate rounded-xs px-1 t-caption transition-colors ${
            value === o.id ? 'bg-(--sel) text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Everything you touch once a session: the paper, the grid, and how the tray
 * carries itself.
 *
 * It opens *downward into the canvas*, which is the other reason the tools came
 * off the right edge: anchored to a rail button two thirds of the way down the
 * side, this panel ran off the bottom of the window and got clipped.
 */
function MoreMenu({ depth }: { depth: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const grid = useDraw((s) => s.doc.grid)
  const background = useDraw((s) => s.doc.background)
  const tray = useDraw((s) => s.tray)
  const gauge = useDraw((s) => s.trayGauge)
  const inkMode = useDraw((s) => s.inkMode)
  const eraserMode = useDraw((s) => s.eraserMode)
  const st = useDraw.getState

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const t = setTimeout(() => window.addEventListener('pointerdown', away), 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', away)
    }
  }, [open])

  const solid = background !== 'transparent' && background !== 'checker'
  const surface = solid ? 'solid' : background === 'transparent' ? 'transparent' : 'checker'

  return (
    <div ref={ref} className="relative shrink-0">
      <Btn label="Canvas & tray settings" active={open} onClick={() => setOpen((v) => !v)}>
        <EllipsisVertical size={16} strokeWidth={1.75} />
      </Btn>

      {open && (
        <div
          className="absolute z-50 w-60 rounded-lg border border-(--line) bg-(--raised) p-3 shadow-xl"
          style={{ top: depth - NOTCH_PAD + 8, right: -NOTCH_PAD }}
        >
          <Row label="Paper">
            <Sheets swatches={PAPER_SWATCHES} current={background} />
          </Row>

          {/*
           * The dark end, as its own row rather than five more chips on the end
           * of the light one. They behave differently enough to be worth
           * naming: the ink turns to chalk, the grid inverts, and a drawing
           * made on one looks like a different kind of drawing.
           */}
          <Row label="Board">
            <div className="flex items-center gap-1.5">
              <Sheets swatches={BOARD_SWATCHES} current={background} />
              <label
                className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-sm border border-(--line)"
                title="Custom sheet colour"
                style={{ background: solid ? background : 'var(--field)' }}
              >
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(background) ? background : '#ffffff'}
                  onChange={(e) => st().setBackground(e.target.value)}
                  aria-label="Custom sheet colour"
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
            </div>
          </Row>

          <Row label="Surface">
            <Seg
              value={surface}
              /* back to the sheet you were on, not to white */
              onChange={(v) => st().setBackground(v === 'solid' ? st().lastSheet : v)}
              options={[
                { id: 'solid', label: 'Solid' },
                { id: 'transparent', label: 'None' },
                { id: 'checker', label: 'Checker' },
              ]}
            />
          </Row>

          {/* ruled, dotted, or nothing: the three anyone actually wants */}
          <Row label="Grid">
            <Seg
              value={grid}
              onChange={(v: GridStyle) => st().setGrid(v)}
              options={[
                { id: 'off' as const, label: 'Off' },
                { id: 'lines' as const, label: 'Lines' },
                { id: 'dots' as const, label: 'Dots' },
              ]}
            />
          </Row>

          <div className="mb-2.5 h-px bg-(--line)" />

          <Row label="Eraser">
            <Seg
              value={eraserMode}
              onChange={(v) => st().setEraserMode(v)}
              options={[
                { id: 'area' as const, label: 'Area' },
                { id: 'object' as const, label: 'Objects' },
              ]}
            />
          </Row>

          <Row label="Tray">
            <Seg
              value={tray.placement}
              onChange={(v) => st().setTray({ placement: v, offset: null })}
              options={[
                { id: 'bottom' as const, label: 'Bottom' },
                { id: 'left' as const, label: 'Left' },
              ]}
            />
          </Row>

          <Row label="Depth">
            <Seg
              value={tray.depth}
              onChange={(v) => st().setTray({ depth: v })}
              options={[
                { id: 'flat' as const, label: 'Flat' },
                { id: 'soft' as const, label: 'Soft' },
                { id: 'regular' as const, label: 'Reg' },
                { id: 'strong' as const, label: 'Strong' },
              ]}
            />
          </Row>

          {/*
           * "auto keeps the highlighter on its own and shares the rest", which
           * is the only one of the three anybody wants by default.
           */}
          <Row label="Ink follows">
            <Seg
              value={inkMode}
              onChange={(v) => st().setInkMode(v)}
              options={[
                { id: 'auto' as const, label: 'Auto' },
                { id: 'shared' as const, label: 'All' },
                { id: 'per-tool' as const, label: 'Each' },
              ]}
            />
          </Row>

          <div className="mb-2.5 flex gap-1">
            <button
              onClick={() => st().setTrayGauge(!gauge)}
              aria-pressed={gauge}
              title="Print the current size on each barrel"
              className={`flex h-7 flex-1 items-center justify-center gap-1 rounded-sm t-caption transition-colors ${
                gauge ? 'bg-(--sel) text-(--tx)' : 'bg-(--field) text-(--tx2) hover:text-(--tx)'
              }`}
            >
              {gauge && <Check size={12} />}
              Gauge
            </button>
            <button
              onClick={() => st().setTray({ offset: null })}
              title="Put the tray back on its edge"
              className="h-7 flex-1 rounded-sm bg-(--field) t-caption text-(--tx2) transition-colors hover:text-(--tx)"
            >
              Re-seat
            </button>
          </div>

          <div className="mb-2.5 h-px bg-(--line)" />

          <button
            onClick={() => {
              setOpen(false)
              st().clear()
            }}
            className="flex h-7 w-full items-center gap-2 rounded-sm px-2 t-caption text-(--tx2) transition-colors hover:bg-(--panel3) hover:text-(--danger)"
          >
            <Trash2 size={13} />
            Reset the canvas
          </button>
        </div>
      )}
    </div>
  )
}

/** The row itself, laid out identically whether it is in the hole or floating. */
function ToolRow({ depth }: { depth: number }) {
  const tool = useDraw((s) => s.tool)
  const locked = useDraw((s) => s.toolLocked)
  const st = useDraw.getState

  return (
    <>
      <Btn
        label={locked ? 'Keep the tool in hand — on' : 'Keep the tool in hand — off'}
        active={locked}
        onClick={() => st().setToolLocked(!locked)}
      >
        {locked ? <Lock size={15} strokeWidth={1.75} /> : <LockOpen size={15} strokeWidth={1.75} />}
      </Btn>
      <Btn label="Pan — H, or hold Space" active={tool === 'hand'} onClick={() => st().setTool('hand')}>
        <Hand size={16} strokeWidth={1.75} />
      </Btn>

      <Rule />

      {SHAPE_TOOLS.map((def) => (
        <Btn
          key={def.id}
          label={
            def.letter
              ? `${def.label} — ${def.digit} or ${def.letter.toUpperCase()}`
              : `${def.label} — ${def.digit}`
          }
          digit={def.digit}
          active={tool === def.id}
          onClick={() => {
            // the image tool has nothing to drag out; it opens the picker
            if (def.id === 'image') pickMediaFile((f) => void st().importImage(f))
            else st().setTool(def.id)
          }}
        >
          <def.icon size={16} strokeWidth={1.75} />
        </Btn>
      ))}

      <Rule />

      <Btn label="Export — Ctrl+Shift+E" onClick={() => st().setDialog('export')}>
        <Download size={15} strokeWidth={1.9} />
      </Btn>
      <MoreMenu depth={depth} />
    </>
  )
}

/** Mounted into the notch by NotchedCanvas, or floated if the panel is narrow. */
export function DrawNotchBar({
  notched,
  centerX,
  depth,
}: {
  notched: boolean
  centerX: number
  depth: number
}) {
  if (!notched) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
        <div
          style={{ padding: NOTCH_PAD - 1 }}
          className="pointer-events-auto rounded-lg border border-(--line) bg-(--raised)/85 backdrop-blur-md"
        >
          <div className="relative flex" style={{ gap: NOTCH_GAP }}>
            <ToolRow depth={depth} />
          </div>
        </div>
      </div>
    )
  }

  /*
   * Placed from the same whole-pixel centre the path is cut at, rather than
   * centring with a half-width translate: on an odd-width panel those land on
   * different halves of a pixel and the icons drift out of their own hole.
   */
  return (
    <div
      className="absolute z-20 flex"
      style={{
        left: centerX - DRAW_NOTCH.width / 2 + NOTCH_PAD,
        top: NOTCH_PAD,
        gap: NOTCH_GAP,
      }}
    >
      <ToolRow depth={depth} />
    </div>
  )
}

/*
 * ----- the two floating clusters -----
 *
 * Undo/redo and the zoom controls are the same kind of thing: a small group of
 * buttons riding over the drawing, in opposite corners. They were built
 * separately and drifted — one at a 4px inset with a 36px plate and 36px
 * buttons, the other at 16px with a 42px plate and 32px buttons — which is
 * exactly the sort of near-miss the eye reads as sloppiness without being able
 * to name. They share a plate now, so they cannot drift again.
 *
 * The size comes from `lib/notch`'s own derivation: FRAME_BUTTON tall at
 * FRAME_INSET from the edge is the one size that both sits on the notch band's
 * centre line and keeps its corner concentric with the panel's.
 */
function Plate({ children, style }: { children: ReactNode; style: React.CSSProperties }) {
  return (
    <div
      className="dw-plate pointer-events-auto absolute z-20 flex items-stretch overflow-hidden rounded-md border border-(--line) bg-(--raised) shadow-lg"
      style={{ height: FRAME_BUTTON, ...style }}
    >
      {children}
    </div>
  )
}

function PlateBtn({
  label,
  onClick,
  disabled,
  wide,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  /** for the zoom readout, which is text rather than a glyph */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{ width: wide ? 52 : FRAME_BUTTON }}
      /*
       * Disabled goes dimmer by *colour*, not by opacity.
       *
       * These plates are near-black, and `--tx2` at 30% opacity over them lands
       * around #2e3033: not "unavailable" but genuinely invisible, which is how
       * a fresh canvas ended up looking like it had two broken buttons in the
       * corner. Dropping to the tertiary ink at full strength still reads as
       * off, and still reads.
       */
      className={`flex h-full items-center justify-center transition-colors ${
        disabled
          ? 'cursor-default text-(--tx3)'
          : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
      }`}
    >
      {children}
    </button>
  )
}

const PlateRule = () => <span aria-hidden className="w-px self-stretch bg-(--line)" />

/** Undo and redo, in the top-right corner of the canvas. */
export function DrawCorner() {
  const canUndo = useDraw((s) => s.past.length > 0)
  const canRedo = useDraw((s) => s.future.length > 0)
  const st = useDraw.getState

  return (
    <Plate style={{ top: FRAME_INSET, right: FRAME_INSET }}>
      <PlateBtn label="Undo — Ctrl+Z" onClick={() => st().undo()} disabled={!canUndo}>
        <Undo2 size={16} strokeWidth={1.9} />
      </PlateBtn>
      <PlateRule />
      <PlateBtn label="Redo — Ctrl+Shift+Z" onClick={() => st().redo()} disabled={!canRedo}>
        <Redo2 size={16} strokeWidth={1.9} />
      </PlateBtn>
    </Plate>
  )
}

/** Zoom, bottom-left, with the way back to the drawing sitting next to it. */
export function ZoomBar() {
  const zoom = useDraw((s) => s.viewport.zoom)
  const empty = useDraw((s) => s.doc.elements.length === 0)
  const st = useDraw.getState

  return (
    <Plate style={{ bottom: FRAME_INSET, left: FRAME_INSET }}>
      <PlateBtn label="Zoom out — Ctrl+−" onClick={() => st().zoomBy(1 / 1.2)}>
        <Minus size={15} strokeWidth={2} />
      </PlateBtn>
      <PlateRule />
      <PlateBtn label="Reset to 100% — Ctrl+0" onClick={() => st().resetZoom()} wide>
        <span className="t-caption tabular-nums">{Math.round(zoom * 100)}%</span>
      </PlateBtn>
      <PlateRule />
      <PlateBtn label="Zoom in — Ctrl+=" onClick={() => st().zoomBy(1.2)}>
        <Plus size={15} strokeWidth={2} />
      </PlateBtn>
      <PlateRule />
      {/*
       * The way back. On an infinite canvas it is genuinely easy to pan into
       * empty space and lose the drawing, and hunting for it by dragging is
       * miserable; this puts everything back in frame in one press.
       */}
      <PlateBtn
        label="Fit the drawing to the window — Shift+1"
        onClick={() => st().zoomToFit()}
        disabled={empty}
      >
        <Frame size={15} strokeWidth={1.9} />
      </PlateBtn>
    </Plate>
  )
}
