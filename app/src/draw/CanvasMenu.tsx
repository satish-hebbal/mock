/**
 * The right-click menu.
 *
 * A canvas that leaves the browser's own context menu in place is telling you,
 * every time you right-click, that this is a document rather than a tool: you
 * get Reload and View Source over a drawing, and inside a note you get Spell
 * check over a thing whose actual questions are what colour it is and how its
 * text is set. Right-click is where people look for "what can I do to this",
 * and for a sticky note the answer had been living two clicks deep in the
 * tray, behind a face change.
 *
 * So the menu is built from what is under the pointer rather than being one
 * fixed list with half of it greyed out. A note offers its paper and its text;
 * a label offers its text; anything else offers the actions that apply to
 * everything; bare canvas offers the two that are about the view.
 *
 * Every button cancels its own mousedown, which is what keeps the caret inside
 * the note while you format it: pick a colour mid-sentence and you are still
 * mid-sentence, rather than having been thrown out of the editor by the click
 * that changed the colour.
 */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Frame,
  List,
  MousePointer2,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { covers } from './marks'
import { useDraw } from './store'
import {
  FONT_NAMES,
  FONT_SIZES,
  FONT_STACKS,
  HIGHLIGHT_SWATCHES,
  NOTE_SWATCHES,
  type FontFamily,
  type TextAlign,
} from './types'

/** The order the faces are offered in: two hands, two uprights, then the odd two. */
const FONT_FAMILIES: FontFamily[] = ['hand', 'marker', 'normal', 'serif', 'display', 'code']

/** Eight swatches across is what sets the width; everything else fits inside it. */
const MENU_W = 244
/** How close to the canvas edge the menu is allowed to sit. */
const EDGE = 8

export interface MenuAt {
  /** where the click landed, in canvas-local pixels */
  x: number
  y: number
  /** the element under the pointer, or null for bare canvas */
  id: string | null
  /** what the text editor had selected when the menu was summoned, if anything */
  selection: { start: number; end: number } | null
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2">
      <p className="mb-1 px-1 t-caption text-(--tx3)">{label}</p>
      {children}
    </div>
  )
}

function Item({
  icon: Icon,
  label,
  hint,
  danger,
  onClick,
}: {
  icon: LucideIcon
  label: string
  hint?: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 w-full items-center gap-2 rounded-sm px-2 t-caption transition-colors ${
        danger ? 'text-(--tx2) hover:bg-(--panel3) hover:text-(--danger)' : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
      }`}
    >
      <Icon size={13} strokeWidth={1.8} />
      {label}
      {hint && <span className="ml-auto t-caption text-(--tx3)">{hint}</span>}
    </button>
  )
}

/** A segmented row of icon options, on the same field track the tray uses. */
function Icons<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string; icon: ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <div
      className="grid gap-0.5 rounded-sm bg-(--field) p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((o) => (
        <button
          key={String(o.id)}
          title={o.label}
          aria-label={o.label}
          aria-pressed={value === o.id}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(o.id)}
          className={`flex h-7 items-center justify-center rounded-xs transition-colors ${
            value === o.id ? 'bg-(--sel) text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  )
}

export function CanvasMenu({ at, onClose }: { at: MenuAt; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const elements = useDraw((s) => s.doc.elements)
  const selectedIds = useDraw((s) => s.selectedIds)
  const editingTextId = useDraw((s) => s.editingTextId)
  const style = useDraw((s) => s.style)
  const st = useDraw.getState

  const target = at.id ? (elements.find((e) => e.id === at.id) ?? null) : null
  const isNote = target?.kind === 'note'
  // both kinds carry text worth setting; only a note draws bullets for it
  const hasText = isNote || target?.kind === 'text'
  /*
   * What the menu shows lit is the thing it was opened on, not the settings
   * the next element would be born with. The tray reads `style` because it is
   * as much a "what am I about to draw" readout as a selection editor; a menu
   * summoned by right-clicking one particular note is only ever about that
   * note, and lighting up an alignment it does not have would be a lie.
   */
  const shown = target ?? style
  /*
   * Is the run the toggle would act on already struck through? Asked of the
   * exact range the click will use, so a toggle over a half-struck selection
   * strikes the rest of it rather than lifting the part that was done.
   */
  const struck =
    !!target &&
    (target.kind === 'text' || target.kind === 'note') &&
    covers(target.strikes, at.selection?.start ?? 0, at.selection?.end ?? target.text.length)

  /*
   * Keep it on the canvas. The board clips its own overflow, so a menu opened
   * near the bottom-right would simply have its lower half cut off rather than
   * scrolling into view; measuring after layout and pulling it back inside is
   * the whole of the fix.
   */
  useLayoutEffect(() => {
    const el = ref.current
    const parent = el?.parentElement
    if (!el || !parent) return
    const box = parent.getBoundingClientRect()
    el.style.left = `${Math.max(EDGE, Math.min(at.x, box.width - el.offsetWidth - EDGE))}px`
    el.style.top = `${Math.max(EDGE, Math.min(at.y, box.height - el.offsetHeight - EDGE))}px`
  })

  /*
   * A menu is about a thing. When the thing stops being the thing — deleted,
   * or simply deselected by a click or an Escape somewhere else — the menu has
   * nothing left to act on, and every button in it would be aimed at whatever
   * happens to be selected next. So it goes when its subject goes.
   */
  const orphaned = !!at.id && (!target || !selectedIds.includes(at.id))
  useEffect(() => {
    if (orphaned) onClose()
  }, [orphaned, onClose])

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      /*
       * Ahead of the board's own Escape, which clears the selection. Closing a
       * menu should put nothing else away with it, and the selection is what
       * the menu was about to act on.
       */
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    // a press that opened the menu must not immediately count as one outside it
    const t = setTimeout(() => window.addEventListener('pointerdown', away), 0)
    window.addEventListener('keydown', key, true)
    // panning or zooming moves the drawing out from under a menu pinned to the screen
    window.addEventListener('wheel', onClose, { passive: true })
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('wheel', onClose)
    }
  }, [onClose])

  /** Do it, then get out of the way, the way a context menu is expected to. */
  const act = (fn: () => void) => () => {
    fn()
    onClose()
  }

  const alignments: { id: 'bullet' | TextAlign; label: string; icon: ReactNode }[] = [
    ...(isNote ? [{ id: 'bullet' as const, label: 'Bulleted', icon: <List size={14} strokeWidth={1.9} /> }] : []),
    { id: 'left', label: 'Align left', icon: <TextAlignStart size={14} strokeWidth={1.9} /> },
    { id: 'center', label: 'Align centre', icon: <TextAlignCenter size={14} strokeWidth={1.9} /> },
    { id: 'right', label: 'Align right', icon: <TextAlignEnd size={14} strokeWidth={1.9} /> },
  ]

  return (
    <div
      ref={ref}
      role="menu"
      data-canvas-menu
      className="absolute z-40 rounded-lg border border-(--line) bg-(--raised) p-2 shadow-xl"
      style={{ width: MENU_W, left: at.x, top: at.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {isNote && (
        <Group label="Paper">
          <div className="grid grid-cols-8 gap-1">
            {NOTE_SWATCHES.map((c) => (
              <button
                key={c}
                title={c}
                aria-label={c}
                onMouseDown={(e) => e.preventDefault()}
                onClick={act(() => st().setStyle({ noteColor: c }, 'draw-notecolor'))}
                className={`h-6 w-full rounded-sm border transition-transform hover:scale-110 ${
                  shown.noteColor.toLowerCase() === c.toLowerCase() ? 'is-picked' : 'border-(--line)'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Group>
      )}

      {hasText && (
        <Group label={at.selection ? 'Highlight selection' : 'Highlight'}>
          <div className="grid grid-cols-7 gap-1">
            {HIGHLIGHT_SWATCHES.map((c) => (
              <button
                key={c}
                title={c}
                aria-label={`Highlight ${c}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={act(() => st().setHighlight(c, at.selection ?? undefined))}
                className="h-6 w-full rounded-sm border border-(--line) transition-transform hover:scale-110"
                style={{ background: c }}
              />
            ))}
            {/* the way back off, since a marker you cannot lift is a stain */}
            <button
              title="No highlight"
              aria-label="No highlight"
              onMouseDown={(e) => e.preventDefault()}
              onClick={act(() => st().setHighlight(null, at.selection ?? undefined))}
              className="h-6 w-full rounded-sm border border-(--line) text-(--tx3) transition-transform hover:scale-110"
              style={{
                backgroundImage:
                  'linear-gradient(to top left, transparent calc(50% - 1px), currentColor calc(50% - 1px), currentColor calc(50% + 1px), transparent calc(50% + 1px))',
              }}
            />
          </div>
        </Group>
      )}

      {hasText && (
        <Group label="Text">
          {/* each sample is set in the face it picks, which says more about it
              than any name would */}
          <Icons<FontFamily>
            value={shown.fontFamily}
            onChange={(v) => {
              st().setStyle({ fontFamily: v }, 'draw-font')
              onClose()
            }}
            options={FONT_FAMILIES.map((id) => ({
              id,
              label: FONT_NAMES[id],
              icon: (
                <span aria-hidden style={{ fontFamily: FONT_STACKS[id], fontSize: 13, lineHeight: 1 }}>
                  Aa
                </span>
              ),
            }))}
          />
          <div className="h-1" />
          <Icons<'bullet' | TextAlign>
            value={isNote && shown.bulleted ? 'bullet' : shown.textAlign}
            onChange={(v) => {
              if (v === 'bullet') st().setStyle({ bulleted: true }, 'draw-format')
              else st().setStyle({ bulleted: false, textAlign: v }, 'draw-format')
              onClose()
            }}
            options={alignments}
          />
          <div className="h-1" />
          <Icons
            value={shown.fontSize}
            onChange={(v) => {
              st().setStyle({ fontSize: v }, 'draw-fontsize')
              onClose()
            }}
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
          <div className="h-1" />
          {/* a toggle rather than a one-way action: crossing a line out and
              changing your mind about it are the same gesture */}
          <button
            aria-pressed={struck}
            onMouseDown={(e) => e.preventDefault()}
            onClick={act(() => st().setStrike(!struck, at.selection ?? undefined))}
            className={`flex h-7 w-full items-center gap-2 rounded-sm px-2 t-caption transition-colors ${
              struck ? 'bg-(--sel) text-(--tx)' : 'bg-(--field) text-(--tx2) hover:text-(--tx)'
            }`}
          >
            <Strikethrough size={13} strokeWidth={1.9} />
            {struck ? 'Strikethrough on' : 'Strikethrough'}
          </button>
        </Group>
      )}

      {target ? (
        <>
          {hasText && editingTextId !== target.id && (
            <Item icon={Type} label="Edit text" hint="Double-click" onClick={act(() => st().editText(target.id))} />
          )}
          <Item icon={Copy} label="Duplicate" hint="Ctrl+D" onClick={act(() => st().duplicateSelection())} />
          <Item icon={ArrowUpToLine} label="Bring to front" onClick={act(() => st().reorder('front'))} />
          <Item icon={ArrowDownToLine} label="Send to back" onClick={act(() => st().reorder('back'))} />
          <Item
            icon={Trash2}
            label="Delete"
            hint="Del"
            danger
            onClick={act(() => st().removeElements(selectedIds.length ? selectedIds : [target.id]))}
          />
        </>
      ) : (
        <>
          <Item icon={MousePointer2} label="Select all" hint="Ctrl+A" onClick={act(() => st().selectAll())} />
          <Item icon={Frame} label="Fit to window" hint="Shift+1" onClick={act(() => st().zoomToFit())} />
        </>
      )}
    </div>
  )
}
