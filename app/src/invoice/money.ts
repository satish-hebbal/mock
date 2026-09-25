/**
 * The arithmetic, in one file, with no React in it.
 *
 * Everything that shows a number on the paper or in a panel comes through
 * `totals()`. That is not tidiness: two places computing the same subtotal is
 * how an invoice ends up printing a figure its own lines do not add to, and
 * that is the one bug in this tool that costs somebody money rather than time.
 *
 * ----- why this counts in minor units -----
 *
 * Binary floating point cannot hold 0.1, so a currency total accumulated in
 * floats drifts: 12 x 85.10 + 4.5 x 85.10 lands a fraction of a cent off, and
 * the fraction survives into a total that is then rounded somewhere else and
 * disagrees with the sum of the rounded lines by a cent. A cent is nothing and
 * an invoice that does not add up is everything, so every line is rounded to
 * minor units *first*, and the totals are integer sums of those. What is
 * printed is then literally what the lines say, because it was computed from
 * the same rounded numbers the eye is adding up.
 */

import type { DiscountSpec, InvoiceDoc, LineItem, TaxSpec } from './types'

/**
 * The currencies offered, and their minor units.
 *
 * `digits` is not decoration. Yen has no minor unit, so ¥1,200.00 is wrong in a
 * way a Japanese client notices immediately, and rounding a yen total to two
 * places can leave a half-yen that cannot be paid. Intl knows all of this, and
 * the list exists only so the picker is a short list of likely currencies
 * rather than every code in the standard.
 */
export const CURRENCIES: { code: string; name: string; digits: number }[] = [
  { code: 'USD', name: 'US dollar', digits: 2 },
  { code: 'EUR', name: 'Euro', digits: 2 },
  { code: 'GBP', name: 'Pound sterling', digits: 2 },
  { code: 'AUD', name: 'Australian dollar', digits: 2 },
  { code: 'CAD', name: 'Canadian dollar', digits: 2 },
  { code: 'NZD', name: 'New Zealand dollar', digits: 2 },
  { code: 'INR', name: 'Indian rupee', digits: 2 },
  { code: 'SGD', name: 'Singapore dollar', digits: 2 },
  { code: 'AED', name: 'UAE dirham', digits: 2 },
  { code: 'CHF', name: 'Swiss franc', digits: 2 },
  { code: 'SEK', name: 'Swedish krona', digits: 2 },
  { code: 'ZAR', name: 'South African rand', digits: 2 },
  { code: 'BRL', name: 'Brazilian real', digits: 2 },
  { code: 'JPY', name: 'Japanese yen', digits: 0 },
]

const DIGITS = new Map(CURRENCIES.map((c) => [c.code, c.digits]))

/** Minor units in `code`; two for anything this build has not heard of. */
export function minorDigits(code: string): number {
  return DIGITS.get(code) ?? 2
}

/** `v` rounded to the currency's smallest payable unit. */
export function roundTo(v: number, digits: number): number {
  if (!Number.isFinite(v)) return 0
  const f = 10 ** digits
  /*
   * The epsilon nudge is the standard fix for the one case people actually hit:
   * 1.005 is held as 1.00499999999999989, so `Math.round(1.005 * 100)` gives
   * 100 and the invoice shows 1.00 where every calculator on earth shows 1.01.
   * Scaling the error by the magnitude keeps it from mattering at large values.
   */
  return Math.round((v + Math.sign(v) * Number.EPSILON * Math.abs(v)) * f) / f
}

/** What one line comes to, rounded before anything is added to it. */
export function lineTotal(item: LineItem, digits: number): number {
  return roundTo((Number(item.qty) || 0) * (Number(item.rate) || 0), digits)
}

/**
 * The one unit every line shares, or '' when they do not share one.
 *
 * This decides where the unit is printed, and the answer is "exactly once per
 * row's worth of meaning". A bare `12` in a Quantity column does not say what
 * it counts, and the reader has to look one column right to find `/hour`
 * hanging off a price, which is the wrong place to learn what the number on
 * the left means.
 *
 * When every line is billed in the same unit (which is most invoices, because
 * most invoices are somebody's hours), the heading carries it once, `Quantity
 * (hour)`, and both the quantity and the price are clean numbers.
 *
 * When the lines disagree, no single heading can be true, so the unit goes
 * back onto each rate as `/hour`, `/day`, `/licence`. That form is used rather
 * than pluralising the quantity because `12 hours` requires knowing how to
 * pluralise a word the user typed, in a language this code does not know, and
 * `/hour` reads as "per hour" whatever the number in front of it is.
 *
 * A line with no unit at all counts as disagreeing, since a table of four
 * hours and one flat fee is precisely the case a shared heading would misstate.
 */
export function sharedUnit(items: LineItem[]): string {
  const first = items[0]?.unit?.trim() ?? ''
  if (!first) return ''
  return items.every((i) => (i.unit ?? '').trim() === first) ? first : ''
}

export interface Totals {
  subtotal: number
  /** always positive; the paper prints the minus sign */
  discount: number
  /** what tax is charged on, after any discount */
  taxable: number
  tax: number
  total: number
  paid: number
  /** what is still owed. Equal to the total until something has been paid */
  due: number
  digits: number
}

/**
 * Every figure the paper prints, from the lines up.
 *
 * The order is the order a tax office expects and the order the page reads in:
 * lines, then discount off the subtotal, then tax on what is left, then the
 * total, then anything already paid. Discount before tax is the part worth
 * saying out loud, because the other order quietly overcharges tax on money
 * that was never charged.
 */
export function totals(doc: InvoiceDoc): Totals {
  const digits = minorDigits(doc.currency)
  const subtotal = roundTo(
    doc.items.reduce((sum, it) => sum + lineTotal(it, digits), 0),
    digits,
  )
  const discount = discountAmount(doc.discount, subtotal, digits)
  const taxable = roundTo(subtotal - discount, digits)
  const tax = taxAmount(doc.tax, taxable, digits)
  /*
   * Inclusive tax is already inside the line prices, so it is broken out for
   * the record and NOT added again. Adding it is the classic way to overcharge
   * an Australian client by ten percent.
   */
  const total = roundTo(doc.tax.mode === 'exclusive' ? taxable + tax : taxable, digits)
  const paid = roundTo(Math.max(0, Number(doc.paid) || 0), digits)
  return { subtotal, discount, taxable, tax, total, paid, due: roundTo(total - paid, digits), digits }
}

/** The discount as a positive amount, never more than there is to discount. */
export function discountAmount(spec: DiscountSpec, subtotal: number, digits: number): number {
  const v = Number(spec.value) || 0
  if (spec.mode === 'off' || v <= 0) return 0
  const raw = spec.mode === 'percent' ? (subtotal * v) / 100 : v
  return roundTo(Math.min(Math.max(raw, 0), subtotal), digits)
}

/**
 * The tax figure, whichever side of the price it sits on.
 *
 * Exclusive is the multiplication everybody expects. Inclusive is the one that
 * gets written wrong: the tax already inside a gross amount is
 * `gross - gross / (1 + rate)`, not `gross * rate`, and at 10% those differ by
 * about a percent of the invoice.
 */
export function taxAmount(spec: TaxSpec, taxable: number, digits: number): number {
  const rate = Number(spec.rate) || 0
  if (spec.mode === 'off' || rate === 0) return 0
  if (spec.mode === 'inclusive') return roundTo(taxable - taxable / (1 + rate / 100), digits)
  return roundTo((taxable * rate) / 100, digits)
}

/**
 * A number as money, in the document's currency.
 *
 * Built once per currency and cached, because `Intl.NumberFormat` is expensive
 * to construct and the paper builds one per figure per keystroke otherwise:
 * a table of twenty lines re-formats sixty numbers on every character typed
 * into a description field.
 */
const formatters = new Map<string, Intl.NumberFormat>()

/**
 * The symbol a currency is written with, for the chip beside its name.
 *
 * `narrowSymbol` rather than the default, which gives "US$" and "A$" in some
 * locales: the chip is small, the code sits right beside it to disambiguate,
 * and the symbol is only there so the list can be scanned by eye.
 */
const symbols = new Map<string, string>()
export function currencySymbol(code: string): string {
  let s = symbols.get(code)
  if (s === undefined) {
    try {
      s =
        new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: code,
          currencyDisplay: 'narrowSymbol',
        })
          .formatToParts(0)
          .find((p) => p.type === 'currency')?.value ?? code
    } catch {
      s = code
    }
    symbols.set(code, s)
  }
  return s
}

export function money(v: number, currency: string): string {
  const key = `c:${currency}`
  let f = formatters.get(key)
  if (!f) {
    const digits = minorDigits(currency)
    try {
      f = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    } catch {
      // an unknown code should print a number rather than throw inside render
      f = new Intl.NumberFormat(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    }
    formatters.set(key, f)
  }
  return f.format(Number.isFinite(v) ? v : 0)
}

/** A quantity, without trailing zeros on whole numbers. 12, 4.5, 0.25. */
export function qty(v: number): string {
  const n = Number(v) || 0
  return n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

/*
 * ----- dates -----
 *
 * The document stores ISO and prints whatever the reader's locale does with
 * it, which is the only arrangement that survives being opened in another
 * country. 03/09/2026 is two different days depending on who is reading it;
 * '2026-09-03' is one day, and Intl turns it into the local way of writing
 * that day at the moment it is shown.
 */

/** ISO to a Date in local time, with no timezone shift. */
export function fromISO(iso: string): Date {
  const [y, m, d] = (iso || '').split('-').map(Number)
  if (!y || !m || !d) return new Date()
  return new Date(y, m - 1, d)
}

export function toISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** '15/09/2026' or '9/15/2026', whichever the reader's locale writes. */
export function shortDate(iso: string): string {
  return fromISO(iso).toLocaleDateString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/** 'Tuesday, 15 September 2026', for confirmations rather than for the paper. */
export function longDate(iso: string): string {
  return fromISO(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** '15 SEP 2026', the three-line form a rubber stamp is cut in. */
export function stampDate(iso: string): string {
  const d = fromISO(iso)
  const month = d.toLocaleDateString('en', { month: 'short' }).toUpperCase()
  return `${d.getDate()} ${month} ${d.getFullYear()}`
}

/** Days in a month, so the day wheel can stop at 30 rather than 31. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}
