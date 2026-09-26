/**
 * Choices drawn as what they make.
 *
 * One tile component for every picture grid in the pattern panels: the looks,
 * the generators, the masks and the effects. The tile is the picture and
 * nothing else; its name arrives on a label above it while the pointer is on
 * it, with a line of what it does, and the tile itself starts playing. A grid of
 * forty names read as a wall of text to scan; a grid of forty pictures is
 * something you look across, and the name is there for the one you stop on.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { FxId } from '../lib/postfx'
import { useSignal } from './store'
import {
  FX_PX,
  LOOK_PX,
  SOURCE_PX,
  paintFx,
  paintDoc,
  paintLook,
  paintMask,
  paintSource,
  thumbPx,
  useLive,
  useStill,
  type Paint,
} from './thumbs'
import type { MaskId, SignalDoc, SourceKind } from './types'

/** Which side of its row a tile is on, so its label can open inward. */
function edgeOf(i: number, cols: number) {
  const col = i % cols
  return col === 0 ? 'start' : col === cols - 1 ? 'end' : undefined
}

export function TileGrid({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <div className="sg-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {children}
    </div>
  )
}

function LiveCanvas({ paint }: { paint: Paint }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLive(ref, paint)
  return <canvas ref={ref} className="sg-tile-live" aria-hidden />
}

export function Tile({
  label,
  hint,
  on,
  index,
  cols,
  onPick,
  art,
  live,
  mark,
}: {
  label: string
  hint?: string
  on: boolean
  /** position in its grid, which decides which way the label opens */
  index: number
  cols: number
  onPick: () => void
  art: ReactNode
  /** drawn every frame while the pointer is on the tile */
  live?: Paint
  /** a small badge in the corner, for a state the ring alone does not say */
  mark?: ReactNode
}) {
  const [hot, setHot] = useState(false)
  return (
    <button
      onClick={onPick}
      aria-pressed={on}
      aria-label={hint ? `${label}. ${hint}` : label}
      data-on={on || undefined}
      data-edge={edgeOf(index, cols)}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      className="sg-tile"
    >
      <span className="sg-tile-art">
        {art}
        {hot && live && <LiveCanvas paint={live} />}
      </span>
      {mark && <span className="sg-tile-mark">{mark}</span>}
      <span className="sg-tip" aria-hidden>
        <span className="sg-tip-name">{label}</span>
        {hint && <span className="sg-tip-hint">{hint}</span>}
      </span>
    </button>
  )
}

// ----- the pictures -----

export function LookArt({ id }: { id: string }) {
  const size = thumbPx(LOOK_PX)
  const url = useStill(`look:${id}:${size}`, () => paintLook(id, size))
  return url ? <img src={url} alt="" draggable={false} className="sg-tile-img" /> : null
}

/**
 * A generator, in the document's paper and ink.
 *
 * The still is a white-on-clear mask of the generator's light, laid over a
 * paper-coloured tile and filled with ink, so changing a colour recolours all
 * sixty-eight tiles in one style recalculation and redraws none of them.
 */
export function SourceArt({ kind, id }: { kind: SourceKind; id: string }) {
  const size = thumbPx(SOURCE_PX)
  const url = useStill(`src:${kind}:${id}:${size}`, () => paintSource(kind, id, size))
  const ink = useSignal((s) => s.doc.ink.ink)
  const paper = useSignal((s) => s.doc.ink.paper)
  return (
    <span className="sg-tile-fill" style={{ background: paper }}>
      {url && (
        <span
          className="sg-tile-fill"
          style={{ background: ink, maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` }}
        />
      )}
    </span>
  )
}

/**
 * A mask on a lit sphere, at one tile pixel per CSS pixel.
 *
 * Measured rather than assumed, because the tile's width is a share of the
 * panel's and a mask is a pixel pattern: drawn at any other size and scaled,
 * the pattern would be resampled into a moiré of itself.
 */
export function MaskArt({ mask }: { mask: MaskId }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const ink = useSignal((s) => s.doc.ink.ink)
  const paper = useSignal((s) => s.doc.ink.paper)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = Math.max(8, Math.round(el.clientWidth))
    el.width = w
    el.height = w
    paintMask(el, mask, ink, paper)
  }, [mask, ink, paper])
  return <canvas ref={ref} className="sg-tile-img sg-pixelated" aria-hidden />
}

export function FxArt({ id }: { id: FxId }) {
  const size = thumbPx(FX_PX)
  const url = useStill(`fx:${id}:${size}`, () => paintFx(id, size))
  return url ? <img src={url} alt="" draggable={false} className="sg-tile-img" /> : null
}

/** A saved look, drawn once from the document it saved. */
export function SlotArt({ id, doc }: { id: string; doc: SignalDoc }) {
  const size = thumbPx(28)
  const url = useStill(`slot:${id}:${size}`, () => paintDoc(doc, size))
  return url ? <img src={url} alt="" draggable={false} className="sg-tile-img" /> : null
}

/**
 * A choice among a few, drawn as a small picture over its name.
 *
 * The same shape as the invoice panel's cards, for the handful of choices here
 * that are settings rather than pictures: the canvas size, the accent mode, the
 * character set.
 */
export function Option({
  on,
  onClick,
  label,
  hint,
  children,
}: {
  on: boolean
  onClick: () => void
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      title={hint ?? label}
      className={`sg-option t-caption ${on ? 'is-picked text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'}`}
    >
      <span className="sg-option-art">{children}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}
