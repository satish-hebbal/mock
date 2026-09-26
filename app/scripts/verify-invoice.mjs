/**
 * The invoice's arithmetic and its file format, checked without a browser.
 *
 * Every other verify script in here guards something that would look wrong.
 * This one guards something that would *be* wrong, which is a different
 * category: a picture that renders a shade off is a disappointment, and an
 * invoice whose total does not match its lines is a dispute with a client and,
 * depending on where they are, a tax filing that does not reconcile.
 *
 * Five things fail silently and all five reach the recipient rather than the
 * screen:
 *
 *   The total must be the sum of the printed lines. Not of the unrounded ones.
 *   Anybody who receives an invoice adds the right-hand column up, and if the
 *   total disagrees by a cent, every figure on the page is now in question.
 *
 *   Inclusive tax must not be added. The rate is already inside the prices, so
 *   adding it again overcharges by the rate, silently, on every invoice issued
 *   in Australia, New Zealand, the UK and most of the EU.
 *
 *   The discount comes off before tax is worked out. The other order charges
 *   tax on money that was never charged.
 *
 *   A currency with no minor unit must not be rounded to two places. A yen
 *   total ending .50 cannot be paid.
 *
 *   The file has to survive being hand-edited. The JSON is offered as the save
 *   format, so somebody will open it and put a string where a number goes, and
 *   an importer that trusts what it finds hands that string to the arithmetic.
 */

import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const R = (p) => jiti.import('../' + p)

const {
  totals,
  money,
  minorDigits,
  roundTo,
  lineTotal,
  sharedUnit,
  toISO,
  fromISO,
  daysInMonth,
} = await R('src/invoice/money.ts')
const { defaultInvoiceDoc, migrateDoc, makeItem, addDays, PAGE_SIZE } = await R('src/invoice/types.ts')
const { nextNumber } = await R('src/invoice/store.ts')

let fails = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else {
    console.log(`  FAIL ${name} ${detail}`)
    fails++
  }
}

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

/** A document with `items`, and whatever else needs overriding. */
function doc(items, over = {}) {
  const base = defaultInvoiceDoc()
  return {
    ...base,
    items: items.map((i) => makeItem(i)),
    tax: { ...base.tax, ...(over.tax ?? {}) },
    discount: { ...base.discount, ...(over.discount ?? {}) },
    currency: over.currency ?? base.currency,
    paid: over.paid ?? 0,
  }
}

console.log('\nlines and the subtotal')
{
  const d = doc([
    { qty: 12, rate: 85 },
    { qty: 4.5, rate: 85 },
    { qty: 2, rate: 85 },
  ])
  const t = totals(d)
  check('the reference invoice subtotals to 1572.50', near(t.subtotal, 1572.5), `got ${t.subtotal}`)

  /*
   * The case the whole minor-unit policy exists for. 0.1 has no exact binary
   * representation, so a naive sum of these three lines lands a hair off and
   * the total then rounds to a figure the printed lines do not add up to.
   */
  const drift = doc([
    { qty: 3, rate: 0.1 },
    { qty: 3, rate: 0.2 },
    { qty: 1, rate: 0.1 },
  ])
  const dt = totals(drift)
  check('a subtotal of thirds of a cent is exact', near(dt.subtotal, 1.0), `got ${dt.subtotal}`)

  /*
   * The invariant that matters most, stated directly: whatever is printed in
   * the right-hand column has to add up to what is printed as the subtotal.
   * This is the check that would catch a future change to the rounding order.
   */
  const many = doc(
    Array.from({ length: 23 }, (_, i) => ({ qty: 1 + (i % 7) * 0.25, rate: 33.33 + i * 1.07 })),
  )
  const mt = totals(many)
  const digits = minorDigits(many.currency)
  const printed = many.items.reduce((s, it) => s + lineTotal(it, digits), 0)
  check(
    'the subtotal is the sum of the printed lines, over 23 of them',
    near(mt.subtotal, roundTo(printed, digits)),
    `${mt.subtotal} vs ${roundTo(printed, digits)}`,
  )
}

console.log('\nwhere the unit is printed')
{
  /*
   * A heading that says `Quantity (hour)` over a line billed per licence is a
   * worse failure than no heading at all, because it is a specific false
   * statement about a number. The shared case is an improvement; the mixed
   * case has to fall back, and this is the check that keeps it falling back.
   */
  const U = (units) => sharedUnit(units.map((unit) => makeItem({ unit })))
  check('one unit on every line goes in the heading', U(['hour', 'hour', 'hour']) === 'hour')
  check('mixed units cannot share a heading', U(['hour', 'day']) === '')
  check('a blank among them counts as mixed', U(['hour', '', 'hour']) === '')
  check('no units at all means no heading unit', U(['', '']) === '')
  check('whitespace is not a unit', U([' ', ' ']) === '')
  check('a unit is matched after trimming', U(['hour', ' hour ']) === 'hour')
  check('a single line still shares with itself', U(['licence']) === 'licence')
  check('an empty table does not throw', sharedUnit([]) === '')
  /* the field is free text, so a document from a file may not carry it */
  check('a missing unit key is tolerated', sharedUnit([{ qty: 1, rate: 1 }]) === '')
}

console.log('\ntax')
{
  const lines = [{ qty: 1, rate: 1000 }]
  const ex = totals(doc(lines, { tax: { mode: 'exclusive', label: 'GST', rate: 10 } }))
  check('exclusive tax is added on top', near(ex.tax, 100) && near(ex.total, 1100), `${ex.tax}/${ex.total}`)

  const inc = totals(doc(lines, { tax: { mode: 'inclusive', label: 'GST', rate: 10 } }))
  check(
    'inclusive tax is broken out and NOT added',
    near(inc.total, 1000) && near(inc.tax, 90.91),
    `total ${inc.total}, tax ${inc.tax}`,
  )

  const off = totals(doc(lines, { tax: { mode: 'off', label: 'GST', rate: 10 } }))
  check('tax off charges nothing', off.tax === 0 && near(off.total, 1000))

  const zero = totals(doc(lines, { tax: { mode: 'exclusive', label: 'GST', rate: 0 } }))
  check('a zero rate is not a tax line', zero.tax === 0 && near(zero.total, 1000))
}

console.log('\ndiscount')
{
  const lines = [{ qty: 1, rate: 1000 }]
  const pct = totals(
    doc(lines, {
      discount: { mode: 'percent', label: 'Discount', value: 10 },
      tax: { mode: 'exclusive', label: 'GST', rate: 10 },
    }),
  )
  check(
    'the discount comes off before tax is worked out',
    near(pct.discount, 100) && near(pct.tax, 90) && near(pct.total, 990),
    `discount ${pct.discount}, tax ${pct.tax}, total ${pct.total}`,
  )

  /* Tax off for these two, so the figure under test is the discount alone.
     The default document is registered for GST, which is right for the tool
     and would otherwise be a second variable in a one-variable check. */
  const noTax = { mode: 'off', label: '', rate: 0 }
  const flat = totals(
    doc(lines, { tax: noTax, discount: { mode: 'amount', label: 'Discount', value: 250 } }),
  )
  check('a flat discount comes straight off', near(flat.total, 750), `got ${flat.total}`)

  /* A discount bigger than the invoice is a typo, not a refund. */
  const over = totals(
    doc(lines, { tax: noTax, discount: { mode: 'amount', label: 'Discount', value: 5000 } }),
  )
  check('a discount cannot exceed the subtotal', near(over.total, 0), `got ${over.total}`)

  const negative = totals(doc(lines, { discount: { mode: 'percent', label: 'D', value: -20 } }))
  check('a negative discount is ignored rather than added', negative.discount === 0)
}

console.log('\nwhat is still owed')
{
  const t = totals(doc([{ qty: 1, rate: 1000 }], { paid: 400, tax: { mode: 'off', rate: 0, label: '' } }))
  check('balance due is the total less what was paid', near(t.due, 600), `got ${t.due}`)

  const overpaid = totals(
    doc([{ qty: 1, rate: 100 }], { paid: 250, tax: { mode: 'off', rate: 0, label: '' } }),
  )
  check(
    'an overpayment shows as a credit rather than being clamped away',
    near(overpaid.due, -150),
    `got ${overpaid.due}`,
  )
}

console.log('\ncurrencies')
{
  check('yen has no minor unit', minorDigits('JPY') === 0)
  check('an unknown code falls back to two places', minorDigits('XYZ') === 2)

  const yen = totals(doc([{ qty: 3, rate: 1200.4 }], { currency: 'JPY' }))
  check('a yen total is a whole number of yen', Number.isInteger(yen.total), `got ${yen.total}`)

  /* Not asserting the exact string: the separator and symbol placement are the
     reader's locale's business, and pinning them here would fail in CI. */
  const printed = money(1572.5, 'USD')
  check('money() prints two places and a separator', /1[,. ]572[.,]50/.test(printed), printed)
  check('money() survives a NaN rather than printing one', !/NaN/.test(money(NaN, 'USD')))
}

console.log('\nrounding')
{
  check('half rounds up where the float says otherwise', roundTo(1.005, 2) === 1.01, String(roundTo(1.005, 2)))
  check('negatives round away from zero symmetrically', roundTo(-1.005, 2) === -1.01, String(roundTo(-1.005, 2)))
  check('a non-finite value becomes zero rather than NaN', roundTo(Infinity, 2) === 0)
}

console.log('\ndates')
{
  check('toISO/fromISO round-trips with no timezone shift', toISO(fromISO('2026-09-15')) === '2026-09-15')
  check('addDays crosses a month boundary', addDays('2026-09-25', 14) === '2026-10-09')
  check('addDays crosses a year boundary', addDays('2026-12-28', 7) === '2027-01-04')
  check('February 2028 has 29 days', daysInMonth(2028, 1) === 29)
  check('February 2027 has 28 days', daysInMonth(2027, 1) === 28)
  /*
   * The roller can leave the 31st selected while the month turns to one with
   * 30, and a Date built from that silently becomes the 1st of the next month.
   * The dialog clamps; this is the fact it clamps against.
   */
  check('September has 30 days', daysInMonth(2026, 8) === 30)
}

console.log('\nthe numbering series')
{
  check('a padded number keeps its width', nextNumber('INV-0007') === 'INV-0008')
  check('a rollover keeps the padding', nextNumber('INV-0099') === 'INV-0100')
  check('only the last run of digits moves', nextNumber('2026-014') === '2026-015')
  check('a trailing suffix is preserved', nextNumber('INV-007a') === 'INV-008a')
  check('a number with no digits is left alone', nextNumber('DRAFT') === 'DRAFT')
}

console.log('\nthe file format')
{
  const fresh = defaultInvoiceDoc()
  const round = migrateDoc(JSON.parse(JSON.stringify(fresh)))
  check('a fresh document round-trips through JSON', JSON.stringify(round) === JSON.stringify(fresh))

  check('a future version is refused rather than guessed at', migrateDoc({ version: 2 }) === null)
  check('a non-object is refused', migrateDoc('nope') === null && migrateDoc(null) === null)

  /* The hand-edited file: strings where numbers go, and a currency symbol
     typed into a rate because that is what the field looks like on the page. */
  const edited = migrateDoc({
    version: 1,
    items: [{ description: 'Design', qty: '3', rate: '$120.50' }],
  })
  const et = totals(edited)
  check(
    'strings and stray symbols are coerced to numbers',
    near(et.subtotal, 361.5),
    `got ${et.subtotal}`,
  )

  const empty = migrateDoc({ version: 1, items: [] })
  check('a document with no lines is given one to stand on', empty.items.length === 1)

  const sparse = migrateDoc({ version: 1 })
  check(
    'missing branches are filled from the defaults',
    !!sparse.look && !!sparse.stamp && !!sparse.from && !!sparse.tax,
  )
  check('a missing paid amount is zero, not NaN', sparse.paid === 0)

  const junk = migrateDoc({ version: 1, paid: 'lots', tax: { rate: 'ten' } })
  check(
    'unparseable numbers fall back rather than poisoning the totals',
    junk.paid === 0 && Number.isFinite(junk.tax.rate),
  )

  /*
   * Every id has to be distinct, or React keys collide and two lines edit as
   * one. A file written by hand is the likely source of a duplicate.
   */
  const dupes = migrateDoc({
    version: 1,
    items: [
      { id: 'x', description: 'a' },
      { id: 'x', description: 'b' },
    ],
  })
  check('ids survive a file that reused one', dupes.items.length === 2)
}

console.log('\nthe page')
{
  check('A4 is 794 x 1123 at 96dpi', PAGE_SIZE.a4.w === 794 && PAGE_SIZE.a4.h === 1123)
  check('Letter is 816 x 1056 at 96dpi', PAGE_SIZE.letter.w === 816 && PAGE_SIZE.letter.h === 1056)
  check(
    'both page sizes name a CSS @page size',
    PAGE_SIZE.a4.css === 'A4' && PAGE_SIZE.letter.css === 'Letter',
  )
}

console.log(fails === 0 ? '\ninvoice: all checks passed\n' : `\ninvoice: ${fails} FAILED\n`)
process.exit(fails === 0 ? 0 : 1)
