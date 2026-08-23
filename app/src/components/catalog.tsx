import { isValidElement, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

/*
 * The catalog primitives, shared by both editors.
 *
 * Shots grew these first — a swatch, and a grid that shows one row of them and
 * folds the rest behind a tile that wears what it is hiding. Studio's Scene
 * panel now carries the same catalogs (the same gradients, the same shipped
 * photos), so it uses the same components rather than a second implementation
 * that drifts. One place to change how a preset is browsed.
 */

/** Swatch button used by every colour / gradient grid. */
export function Swatch({
  style,
  active,
  onClick,
  title,
  children,
}: {
  style?: React.CSSProperties
  active?: boolean
  onClick: () => void
  title?: string
  children?: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      /*
       * A heavy `border-radius` rather than the superellipse clip. The clip
       * gave a true continuous curve but cost a real border, a real shadow and
       * a focus ring, since it cuts everything outside the path. A generous
       * radius reads nearly the same at swatch size and stays an ordinary box.
       *
       * No outline in any state: a swatch exists to show a colour, and a ring
       * around it is another colour sitting against the one you are judging.
       * The check mark below carries "chosen" instead.
       */
      style={style}
      className="relative flex h-9 items-center justify-center overflow-hidden rounded-xl bg-cover bg-center"
    >
      {children}
      {active && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
          <Check size={13} strokeWidth={2.6} className="text-white drop-shadow" />
        </span>
      )}
    </button>
  )
}

/**
 * The tile that opens and closes a `MoreGrid`.
 *
 * It wears the presets it is hiding: the next one fills the face and the two
 * after it peek out above as a short stack, so the tile reads as "more of
 * these underneath" instead of as a separate button parked in the grid. The
 * arrow carries the state: down to open, up to close. The stack drops away
 * once the rest are on screen, since there is nothing left to hint at.
 *
 * Grids whose tiles are not simple styled boxes (the corner styles, the shadow
 * scenes) hand back no preview, and the tile falls back to a plain field with
 * the same arrow.
 */
export function MoreTile({
  open,
  total,
  peek,
  onClick,
}: {
  open: boolean
  total: number
  peek: (React.CSSProperties | undefined)[]
  onClick: () => void
}) {
  // the stack is only ever drawn behind a face, so one missing preview drops
  // the lot rather than leaving layers hanging over a bare field
  const [face, mid, back] = open || !peek[0] ? [] : peek

  return (
    <button
      onClick={onClick}
      title={open ? 'Show fewer' : `Show all ${total}`}
      aria-label={open ? 'Show fewer' : `Show all ${total}`}
      aria-expanded={open}
      /*
       * No shape of its own beyond the radius. A grid item stretches to its row
       * by default, so leaving the height alone makes this take whatever the
       * tiles beside it are: 36px tall beside the wide colour swatches, square
       * beside the square shadow scenes. Pinning `aspect-square` made it
       * correct in one grid and a tall odd block in the other.
       */
      className="group relative flex items-center justify-center rounded-xl bg-(--field) text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx)"
    >
      {/* back to front: each layer is a little taller and a little narrower
          than the one in front of it, so only its top edge shows */}
      {back && (
        <span
          aria-hidden
          className="absolute inset-x-3 -top-1 bottom-0 rounded-xl bg-cover bg-center opacity-40"
          style={back}
        />
      )}
      {mid && (
        <span
          aria-hidden
          className="absolute inset-x-1.5 -top-0.5 bottom-0 rounded-xl bg-cover bg-center opacity-70"
          style={mid}
        />
      )}
      {face && (
        <>
          <span aria-hidden className="absolute inset-0 rounded-xl bg-cover bg-center" style={face} />
          {/* the arrow has to stay legible over whatever the preset is, and a
              scrim is the only thing that holds for a black swatch and a bright
              photo alike; it lifts on hover so the colour still gets seen */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-xl bg-black/45 transition-colors group-hover:bg-black/25"
          />
        </>
      )}
      <span className={`relative flex ${face ? 'text-white drop-shadow' : ''}`}>
        {open ? <ChevronUp size={15} strokeWidth={2.2} /> : <ChevronDown size={15} strokeWidth={2.2} />}
      </span>
    </button>
  )
}

/** The inline style a grid tile paints itself with, when it has one. */
function tileStyle(node: ReactNode): React.CSSProperties | undefined {
  return isValidElement<{ style?: React.CSSProperties }>(node) ? node.props.style : undefined
}

/**
 * A grid that shows a single row and hides the rest behind a "more" tile.
 *
 * These catalogs only grow, and the panel is 280px of shared vertical space
 * that Canvas, Shadow Scene, Portrait and Background are all competing for.
 * Sixteen presets stacked four rows deep push everything below them off the
 * bottom, and you scroll past a wall of colour to reach a slider. One row per
 * catalog keeps every heading reachable without scrolling, and the tile at the
 * end of it opens whichever one you actually came for.
 *
 * The toggle lives *in* the grid rather than under it, taking the last slot of
 * the visible rows, so it costs no extra height and reads as "and more of
 * these" rather than as a separate control. It keeps that slot once the grid
 * opens and the rest flow in after it, so the thing just clicked is still
 * under the cursor to click again. It disappears entirely when the contents
 * already fit, so a group never grows a control it does not need.
 */
export function MoreGrid({
  cols,
  rows = 1,
  children,
}: {
  cols: number
  rows?: number
  children: ReactNode[]
}) {
  const [open, setOpen] = useState(false)
  const items = children.flat().filter(Boolean)
  const full = cols * rows
  if (items.length <= full) return <>{items}</>

  const hidden = items.slice(full - 1)

  return (
    <>
      {items.slice(0, full - 1)}
      <MoreTile
        open={open}
        total={items.length}
        peek={hidden.slice(0, 3).map(tileStyle)}
        onClick={() => setOpen(!open)}
      />
      {open && hidden}
    </>
  )
}
