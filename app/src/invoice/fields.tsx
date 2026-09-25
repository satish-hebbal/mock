/**
 * The text field the inspector needed and the shared panel kit did not have.
 *
 * Most of the invoice is typed onto the page itself (see `onPaper.tsx`); this
 * is for the few words that belong to the panel instead. `controls.tsx` is
 * built for sliders, segments and colour chips, and a text field has
 * different rules, the two that matter written in here once:
 *
 *   A label is not a placeholder. Placeholder-only fields look immaculate
 *   empty and become unreadable the moment they are filled, because the only
 *   thing that said what a value was is the thing the value replaced. Every
 *   field here carries a standing label.
 *
 *   Escape and Enter give the keyboard back. Single letters are shortcuts
 *   everywhere else in this app, so a field that keeps focus after the user has
 *   finished with it quietly disables half the application.
 */

import type { ReactNode } from 'react'

/** The shape every field in this panel shares, so a column of them lines up. */
const FIELD =
  'w-full rounded-sm bg-(--field) px-2 t-body-sm text-(--tx) transition-colors outline-none placeholder:text-(--tx3) hover:bg-(--field-h) focus:bg-(--field-h) focus:ring-1 focus:ring-(--focus)'

function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1 flex items-baseline justify-between gap-2 t-caption text-(--tx2)">
      <span>{children}</span>
      {/* pushed to the right edge whether or not there is a label beside it */}
      {hint && <span className="ml-auto t-caption text-(--tx3)">{hint}</span>}
    </span>
  )
}

/** Hand the keyboard back to the app; bound on every field in this file. */
function release(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
  if (e.key === 'Enter' || e.key === 'Escape') {
    if (e.key === 'Enter' && e.currentTarget.tagName === 'TEXTAREA') return
    e.currentTarget.blur()
  }
}

export function TextRow({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  /** for numbers-as-text: an account number, a BSB, an invoice id */
  mono?: boolean
}) {
  return (
    <label className="mb-2 block">
      <Label hint={hint}>{label}</Label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={release}
        placeholder={placeholder}
        spellCheck={false}
        className={`${FIELD} h-7 ${mono ? 'font-mono tabular-nums' : ''}`}
      />
    </label>
  )
}
