/**
 * The currency, picked from a list you can search.
 *
 * The shared Dropdown was built for short lists of settings and has two
 * failures here. Its menu is a child of the panel section it sits in, and the
 * section clips its contents so it can fold shut, so the list was cut off after
 * three rows. And it prints each option as one grey string, "USD · US dollar",
 * which is readable one at a time and slow to scan fourteen deep.
 *
 * So this one floats: the menu is portalled to the body and positioned against
 * the trigger, flipping above it when there is no room below, and nothing in
 * the panel can clip it. Each row sets symbol, code and name in columns so the
 * eye can run down any one of them, and typing filters by all three, because
 * people look for "yen", "JPY" and "¥" in roughly equal numbers.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { CURRENCIES, currencySymbol } from './money'

/**
 * A currency as a small gold coin: a milled rim, a sunken face, and the symbol
 * struck into it. Every coin is the same gold, so the list reads as one set and
 * the symbol is the only thing that tells them apart.
 */
export function CurrencyCoin({ code }: { code: string }) {
  const symbol = currencySymbol(code)
  return (
    <span className="inv-coin" data-long={symbol.length > 1 ? symbol.length : undefined} aria-hidden>
      <span className="inv-coin-face">{symbol}</span>
    </span>
  )
}

/** Air between the menu and the edge of the window. */
const EDGE = 8
const MENU_H = 300

export function CurrencyPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const current = CURRENCIES.find((c) => c.code === value)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return CURRENCIES
    return CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        currencySymbol(c.code).toLowerCase() === q,
    )
  }, [query])

  const open = () => {
    const r = trigger.current?.getBoundingClientRect()
    if (!r) return
    const up = window.innerHeight - r.bottom < MENU_H + EDGE && r.top > window.innerHeight - r.bottom
    setAt({ left: r.left, width: r.width, top: up ? r.top - 4 : r.bottom + 4, up })
    setQuery('')
    setActive(Math.max(0, CURRENCIES.findIndex((c) => c.code === value)))
  }
  const close = () => {
    setAt(null)
    trigger.current?.focus()
  }
  const pick = (code: string) => {
    onChange(code)
    close()
  }

  // the chosen row starts in view rather than possibly twelve rows down
  useLayoutEffect(() => {
    if (!at) return
    list.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [at, active])

  useEffect(() => {
    if (!at) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) setAt(null)
    }
    // a scroll anywhere but inside the list moves the trigger out from under
    // a menu positioned against it, so the menu closes rather than floating off
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) setAt(null)
    }
    const onResize = () => setAt(null)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [at])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (shown.length ? (i + step + shown.length) % shown.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = shown[active]
      if (c) pick(c.code)
    } else if (e.key === 'Escape') {
      // the picker sits in a panel whose own Escape would do something larger
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={!!at}
        onClick={() => (at ? setAt(null) : open())}
        className="flex h-8 w-full items-center gap-2 rounded-sm bg-(--field) pr-2 pl-1.5 text-left transition-colors hover:bg-(--field-h)"
      >
        <CurrencyCoin code={value} />
        <span className="t-body-sm font-semibold tabular-nums text-(--tx)">{value}</span>
        <span className="min-w-0 flex-1 truncate t-body-sm text-(--tx2)">{current?.name ?? ''}</span>
        <ChevronDown
          size={13}
          strokeWidth={2}
          className={`shrink-0 text-(--tx3) transition-transform duration-150 ${at ? 'rotate-180' : ''}`}
        />
      </button>

      {at &&
        createPortal(
          <div
            ref={menu}
            onKeyDown={onKey}
            className="inv-pop fixed z-[60] flex flex-col overflow-hidden rounded-md border border-(--line) bg-(--raised) shadow-lg"
            data-up={at.up || undefined}
            style={{
              left: at.left,
              top: at.top,
              width: Math.max(at.width, 240),
              maxHeight: MENU_H,
              transform: at.up ? 'translateY(-100%)' : undefined,
            }}
          >
            <label className="flex h-9 shrink-0 items-center gap-2 border-b border-(--line) px-2.5">
              <Search size={13} strokeWidth={2} className="shrink-0 text-(--tx3)" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                placeholder="Search currencies"
                spellCheck={false}
                aria-label="Search currencies"
                className="min-w-0 flex-1 bg-transparent t-body-sm text-(--tx) outline-none placeholder:text-(--tx3)"
              />
            </label>
            <div ref={list} role="listbox" aria-label="Currency" className="min-h-0 flex-1 overflow-y-auto p-1">
              {shown.length === 0 && (
                <p className="px-2 py-3 text-center t-caption text-(--tx3)">No currency matches that</p>
              )}
              {shown.map((c, i) => {
                const on = c.code === value
                return (
                  <button
                    key={c.code}
                    type="button"
                    role="option"
                    aria-selected={on}
                    data-active={i === active || undefined}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => pick(c.code)}
                    className={`flex h-8 w-full items-center gap-2 rounded-xs px-1.5 text-left transition-colors ${
                      i === active ? 'bg-(--panel3)' : ''
                    }`}
                  >
                    <CurrencyCoin code={c.code} />
                    <span
                      className={`w-9 t-body-sm font-semibold tabular-nums ${on ? 'text-(--tx)' : 'text-(--tx2)'}`}
                    >
                      {c.code}
                    </span>
                    <span className={`min-w-0 flex-1 truncate t-body-sm ${on ? 'text-(--tx)' : 'text-(--tx2)'}`}>
                      {c.name}
                    </span>
                    {on && <Check size={13} strokeWidth={2.4} className="shrink-0 text-(--tx)" />}
                  </button>
                )
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
