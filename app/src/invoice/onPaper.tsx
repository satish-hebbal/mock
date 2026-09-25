/**
 * Fields that live on the page.
 *
 * The invoice is filled in where it is read. Every value on the sheet is one of
 * these, sitting in the exact spot, face and size it prints at, so typing a
 * client's name is typing it onto the invoice rather than into a form that
 * describes one. The idea is the one invoice-generator.com is built on, and the
 * reason it works there is the reason it works here: nobody has to learn which
 * field ends up where, because there is no "where" to learn.
 *
 * The rules these follow, so the forty call sites on the paper do not have to:
 *
 *   A field is as wide as what is in it. An input has a fixed width and a
 *   printed word does not, so each field is a one-cell grid whose width comes
 *   from an invisible copy of its own text. That is what lets a field sit
 *   inside a sentence, beside a colon, or against the right margin, and look
 *   like the word it replaces.
 *
 *   The page's own ink draws the affordances. Hover and focus plates are mixed
 *   from `--inv-ink`, which the paper sets, never from the app theme, for the
 *   same reason the paper itself ignores the theme.
 *
 *   Enter and Escape give the keyboard back, as every field in the app does,
 *   because single letters are shortcuts everywhere else.
 *
 *   A number is shown formatted until it is being edited. `$1,020.00` is what
 *   the page says, and `1020` is what a person types, so the field swaps
 *   between the two on focus rather than asking anybody to type a currency
 *   symbol or leaving the raw figure on the page.
 *
 * Nothing in this file is rendered into the PDF. The print path draws the page
 * again with editing off, and every call site falls back to plain text.
 */

import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

interface BaseProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** a multi-line field: addresses, notes, descriptions */
  multiline?: boolean
  /** fill the width of the parent rather than hugging the text */
  block?: boolean
  /** an alternative Enter, for the description that starts the next line */
  onEnter?: () => void
  onFocus?: (el: HTMLInputElement | HTMLTextAreaElement) => void
  onBlur?: () => void
  /** what `focusSoon` finds this field by */
  focusKey?: string
  inputMode?: 'decimal' | 'text'
  label: string
  style?: CSSProperties
}

/** The one input every field on the page is made of. */
export function PText({
  value,
  onChange,
  placeholder,
  multiline,
  block,
  onEnter,
  onFocus,
  onBlur,
  focusKey,
  inputMode,
  label,
  style,
}: BaseProps) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.currentTarget.blur()
      return
    }
    if (e.key !== 'Enter' || e.shiftKey) return
    if (onEnter) {
      e.preventDefault()
      onEnter()
    } else if (!multiline) {
      e.currentTarget.blur()
    }
  }

  const shared = {
    value,
    placeholder,
    spellCheck: false,
    'aria-label': label,
    'data-inv-focus': focusKey,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onKeyDown,
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => onFocus?.(e.currentTarget),
    onBlur,
  }

  return (
    <span
      className="inv-ed"
      data-block={block || undefined}
      data-multi={multiline || undefined}
      // the mirror that sizes the field; see the file comment
      data-v={value || placeholder || ''}
      style={style}
    >
      {multiline ? (
        <textarea {...shared} rows={1} />
      ) : (
        <input {...shared} size={1} inputMode={inputMode} />
      )}
    </span>
  )
}

/**
 * A number, printed formatted and typed raw.
 *
 * The draft only exists while the field has focus. A keystroke that parses is
 * committed at once, so the totals below move while the rate is being typed,
 * and an empty draft is left empty rather than turned into a zero under the
 * cursor.
 */
export function PNum({
  value,
  onChange,
  format,
  min,
  label,
  focusKey,
  onDone,
  style,
}: {
  value: number
  onChange: (v: number) => void
  format: (v: number) => string
  min?: number
  label: string
  focusKey?: string
  /** after the field lets go, with the value it settled on */
  onDone?: (v: number) => void
  style?: CSSProperties
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const settled = useRef(value)
  settled.current = value

  const parse = (raw: string) => {
    const n = Number(raw.replace(/[^0-9.-]/g, ''))
    if (!Number.isFinite(n)) return 0
    return min !== undefined ? Math.max(min, n) : n
  }

  return (
    <PText
      label={label}
      focusKey={focusKey}
      inputMode="decimal"
      value={draft ?? format(value)}
      // an empty draft (a zero, just focused) still shows what goes there,
      // and gives the field a width to be clicked and read at
      placeholder="0"
      style={{ fontVariantNumeric: 'tabular-nums', ...style }}
      onFocus={(el) => {
        setDraft(value ? String(value) : '')
        // the formatted text was replaced under the cursor, so select what is
        // there now rather than leaving a caret in a string that changed
        requestAnimationFrame(() => el.select())
      }}
      onChange={(v) => {
        setDraft(v)
        if (v.trim() !== '' && v.trim() !== '-') onChange(parse(v))
      }}
      onBlur={() => {
        const next = draft === null ? settled.current : parse(draft)
        if (draft !== null && next !== settled.current) onChange(next)
        setDraft(null)
        onDone?.(next)
      }}
    />
  )
}

/**
 * A date, printed the reader's way and picked with the platform's picker.
 *
 * The native input sits invisibly over the printed date. That keeps the page
 * showing `25 Sep 2026` rather than the browser's own field furniture, and it
 * keeps the one control the platform does better than anything written here:
 * it knows the user's calendar, week start and field order.
 */
export function PDate({
  value,
  onChange,
  display,
  label,
}: {
  value: string
  onChange: (v: string) => void
  display: string
  label: string
}) {
  return (
    <span className="inv-ed inv-ed-date">
      <span>{display}</span>
      <input
        type="date"
        aria-label={label}
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.()
          } catch {
            /* a picker that will not open still leaves the field typeable */
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur()
        }}
      />
    </span>
  )
}

/** A quiet "+ something" on the page, for the parts that are not there yet. */
export function PAdd({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="inv-add" onClick={onClick}>
      <span aria-hidden>+</span>
      {children}
    </button>
  )
}

/**
 * The small tools that appear beside a row on hover.
 *
 * They sit out in the page margin, where nothing prints, so they never cover
 * the text of the row they act on and never shift it when they appear.
 */
export function PTool({
  children,
  label,
  onClick,
  onPointerDown,
  danger,
  on,
}: {
  children: ReactNode
  label: string
  onClick?: () => void
  onPointerDown?: (e: React.PointerEvent) => void
  danger?: boolean
  /** the current choice, in a row of tools that are alternatives */
  on?: boolean
}) {
  return (
    <button
      type="button"
      className="inv-tool"
      data-danger={danger || undefined}
      data-grip={onPointerDown ? true : undefined}
      data-on={on || undefined}
      aria-pressed={on}
      title={label}
      aria-label={label}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {children}
    </button>
  )
}
