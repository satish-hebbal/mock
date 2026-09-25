/**
 * The invoice document.
 *
 * Every other tool in the suite makes a picture. This one makes a *record*, and
 * that difference decides the whole shape of the file: the document is the
 * deliverable, not a set of instructions for producing one, so it is written to
 * be read by a human with a text editor and by an accountant's software six
 * years from now. Flat fields, ISO dates, numbers as numbers, no derived values
 * stored anywhere.
 *
 * Nothing that can be computed is kept. There is no `subtotal` and no `total`
 * on the document, because a stored total is a total that can disagree with the
 * lines above it, and an invoice whose arithmetic does not add up is not a
 * rounding bug, it is a dispute. `money.ts` computes them, once, and everything
 * that shows a number reads from there.
 *
 * The split below is the split a person makes when filling one in:
 *
 *   who      `from` and `to`, the two parties
 *   what     `items`, and the tax and discount applied over them
 *   when     the dates, the terms, and the number that names it
 *   how       payment rows, notes
 *   look     the part that is genuinely taste, kept apart from the record so
 *            restyling an invoice can never alter what it says
 */

const uid = () => crypto.randomUUID()

/** Today, as the only date format this document stores. */
export function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** `iso` moved by `days`, still as an ISO date. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(y, (m || 1) - 1, d || 1)
  t.setDate(t.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
}

/**
 * One side of the transaction.
 *
 * The same shape for the issuer and the client, because they carry the same
 * facts and the only real difference is how much of it each one fills in. A
 * separate `Client` type would be this minus two fields and a second migration
 * to keep in step.
 *
 * `taxIdLabel` travels with the number because the label is not decoration: ABN
 * in Australia, VAT in the EU, GSTIN in India, EIN in the US. Hard-coding one
 * of them makes the tool wrong everywhere else, and a blank label makes it
 * useless everywhere.
 */
export interface Party {
  name: string
  /** multi-line, kept as typed; the paper renders the breaks */
  address: string
  email: string
  /** issuer only in practice, but harmless on both */
  website: string
  taxIdLabel: string
  taxId: string
}

export interface LineItem {
  id: string
  description: string
  qty: number
  /** what one of them is: 'hour', 'day', 'item'. Blank is fine and common. */
  unit: string
  rate: number
}

/** Off, a percentage of the subtotal, or a flat amount. */
export type DiscountMode = 'off' | 'percent' | 'amount'

/**
 * How tax sits against the line prices.
 *
 *   off        no tax line at all, for anyone under a registration threshold
 *   exclusive  the rate is added on top; the commonest case worldwide
 *   inclusive  the rate is already inside the line prices and is only broken
 *              out for the record, which is how Australian and NZ invoices
 *              are usually written
 */
export type TaxMode = 'off' | 'exclusive' | 'inclusive'

export interface TaxSpec {
  mode: TaxMode
  /** 'GST', 'VAT', 'Sales tax': printed on the paper exactly as typed */
  label: string
  /** percent, not a fraction: 10 means 10% */
  rate: number
}

export interface DiscountSpec {
  mode: DiscountMode
  label: string
  /** percent when the mode is percent, currency units when it is amount */
  value: number
}

/** One row of the payment block: 'BSB' / '000-000', 'IBAN' / '…'. */
export interface PayRow {
  id: string
  label: string
  value: string
}

/**
 * What the stamp says.
 *
 * The four words are the ones that actually get stamped on an invoice, and they
 * are deliberately not a status field the rest of the document reads. Nothing
 * else branches on it: the stamp is a mark made on a piece of paper on a given
 * day, which is exactly what it is in the world, and keeping it that literal is
 * what stops it turning into a half-built accounting state machine.
 */
export type StampKind = 'paid' | 'received' | 'approved' | 'due'

export const STAMP_KINDS: { id: StampKind; label: string }[] = [
  { id: 'paid', label: 'Paid' },
  { id: 'received', label: 'Received' },
  { id: 'approved', label: 'Approved' },
  { id: 'due', label: 'Due' },
]

export interface Stamp {
  /** false until somebody marks it; an unmarked invoice prints clean */
  on: boolean
  kind: StampKind
  /** ISO. The date it was marked, which is not necessarily today */
  date: string
  color: string
  /** degrees; a stamp put on by hand is never square to the page */
  angle: number
}

/** The ink colours a stamp can be made in, in the order the dots are drawn. */
export const STAMP_COLORS = ['#dc4c3e', '#2f6df6', '#0f9d58', '#7c5cf5', '#26282c']

/** The accent rule's stroke: a straight line, or a subtle zigzag or wave. */
export type RuleStyle = 'line' | 'zigzag' | 'wave'
export const RULE_STYLES: RuleStyle[] = ['line', 'zigzag', 'wave']

export type Template = 'classic' | 'modern' | 'compact' | 'wash'
export type TypeFamily = 'sans' | 'serif' | 'mono'
export type PageSize = 'a4' | 'letter'

/**
 * Everything that is taste.
 *
 * Kept in its own object for one reason: an invoice is a document of record, so
 * the line between "what this says" and "how this looks" has to be somewhere a
 * person can see it. Applying a different template can then be a write to one
 * key rather than a pass over the whole document, and no amount of restyling
 * can put a digit out of place.
 */
export interface InvoiceLook {
  template: Template
  /** the one colour on the page that is a choice */
  accent: string
  /** the page itself: white, or one of two warm/cool papers */
  paper: string
  ink: string
  type: TypeFamily
  /** row rhythm: how much air the paper gives each line */
  density: 'compact' | 'cozy' | 'airy'
  page: PageSize
  /** an uploaded mark, kept in the asset store like every other image */
  logoAssetId: string | null
  /** drawn when there is no uploaded mark and this is non-empty */
  monogram: string
  showLogo: boolean
  /**
   * The logo's own colours, pulled out of it when it is uploaded, for the
   * Wash template to paint with. Stored rather than re-read on every render
   * because reading an image is asynchronous and the print path draws the page
   * synchronously; and stored in `look` because it is taste, not record.
   * Empty when there is no logo, and Wash falls back to the accent.
   */
  palette: string[]
  /** how the accent rule over the total is drawn: ruled, or a little hand-made */
  rule: RuleStyle
}

export interface InvoiceDoc {
  version: 1
  /** the document's name in the app, not on the paper */
  name: string

  number: string
  issueDate: string
  dueDate: string
  /** the words printed beside the due date: 'Net 14', 'Due on receipt' */
  terms: string
  /** ISO 4217, which picks the symbol and the minor units */
  currency: string
  /** free field printed under the number when filled: PO, project, reference */
  reference: string

  from: Party
  to: Party
  items: LineItem[]

  tax: TaxSpec
  discount: DiscountSpec
  /** already received against this invoice; what is left becomes Balance due */
  paid: number

  payTitle: string
  pay: PayRow[]
  notes: string
  footer: string

  look: InvoiceLook
  stamp: Stamp
}

export const makeItem = (partial: Partial<LineItem> = {}): LineItem => ({
  id: uid(),
  description: '',
  qty: 1,
  unit: '',
  rate: 0,
  ...partial,
})

export const makePayRow = (label = '', value = ''): PayRow => ({ id: uid(), label, value })

/**
 * A fresh invoice, already filled in.
 *
 * Not blank, on purpose. A blank invoice is a form, and a form is a wall: the
 * first thing you meet is fourteen empty fields and no idea which of them
 * matter. A filled one is a worked example you edit over the top of, so the
 * first thing you do is change a name rather than decide what a name field even
 * wants. Every tool in this suite opens on something rather than nothing, and
 * this is that rule applied to a document.
 *
 * The numbers are deliberately unround. 12.00 hours at a round rate reads as
 * placeholder text; 12.00, 4.50 and 2.00 read as a real week.
 */
export function defaultInvoiceDoc(): InvoiceDoc {
  const issue = todayISO()
  return {
    version: 1,
    name: 'Invoice',
    number: 'INV-0001',
    issueDate: issue,
    dueDate: addDays(issue, 14),
    terms: 'Net 14',
    currency: 'USD',
    reference: '',

    from: {
      name: 'Your Studio',
      address: '12 Paper Lane\nFitzroy VIC 3065',
      email: 'hello@yourstudio.com',
      website: 'yourstudio.com',
      taxIdLabel: 'ABN',
      taxId: '51 824 753 556',
    },
    to: {
      name: 'Northwind Pty Ltd',
      address: '400 Collins Street\nMelbourne VIC 3000',
      email: 'accounts@northwind.com',
      website: '',
      taxIdLabel: '',
      taxId: '',
    },
    items: [
      makeItem({ description: 'Component design', qty: 12, unit: 'hour', rate: 85 }),
      makeItem({ description: 'Motion prototypes', qty: 4.5, unit: 'hour', rate: 85 }),
      makeItem({ description: 'Figma handoff', qty: 2, unit: 'hour', rate: 85 }),
    ],

    tax: { mode: 'exclusive', label: 'GST', rate: 10 },
    discount: { mode: 'off', label: 'Discount', value: 0 },
    paid: 0,

    payTitle: 'Bank details for payment',
    pay: [
      makePayRow('Bank', 'Northbank'),
      makePayRow('BSB', '000-000'),
      makePayRow('Account number', '1234 5678'),
      makePayRow('Name', 'Your Studio'),
    ],
    notes: '',
    footer: 'Thank you for your business.',

    look: {
      template: 'classic',
      accent: '#dc4c3e',
      paper: '#ffffff',
      ink: '#16181c',
      type: 'sans',
      density: 'cozy',
      page: 'a4',
      logoAssetId: null,
      monogram: '',
      showLogo: true,
      palette: [],
      rule: 'line',
    },
    stamp: {
      on: false,
      kind: 'paid',
      date: issue,
      color: STAMP_COLORS[0],
      angle: -3,
    },
  }
}

/**
 * The paper, in points, at 1pt per CSS pixel.
 *
 * A4 at 96dpi is 794 x 1123 and US Letter is 816 x 1056, and those are the
 * numbers the preview is laid out at so that what is on screen is the page at
 * 1:1 rather than an approximation of it. The print path sets `@page` to the
 * matching size, so the PDF comes out at the real thing without a scale factor
 * anywhere in between.
 */
export const PAGE_SIZE: Record<PageSize, { w: number; h: number; label: string; css: string }> = {
  a4: { w: 794, h: 1123, label: 'A4', css: 'A4' },
  letter: { w: 816, h: 1056, label: 'US Letter', css: 'Letter' },
}

/**
 * The three faces the document can wear, as a font stack each.
 *
 * Only families that are already on the machine. A webfont would have to be
 * embedded for the PDF to be right, and an invoice that renders in Times on the
 * recipient's machine because a font failed to load is worse than one that was
 * always going to be set in the system's own text face.
 *
 * Shared with the inspector, which sets each typeface option in its own face.
 */
export const PAPER_FONTS: Record<TypeFamily, string> = {
  sans: '"Inter", "Segoe UI", -apple-system, system-ui, "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
  mono: '"SF Mono", "Cascadia Mono", "Roboto Mono", ui-monospace, Menlo, Consolas, monospace',
}

/** The three papers on offer: plain white, a warm stock, and a cool one. */
export const PAPERS: { id: string; label: string; paper: string; ink: string }[] = [
  { id: 'white', label: 'White', paper: '#ffffff', ink: '#16181c' },
  { id: 'ivory', label: 'Ivory', paper: '#fbf8f2', ink: '#211d17' },
  { id: 'mist', label: 'Mist', paper: '#f6f8fa', ink: '#131820' },
]

/** Accents, chosen to stay legible as a hairline rule on any of the papers. */
export const ACCENTS = [
  '#dc4c3e',
  '#e07a2f',
  '#0f9d58',
  '#2f6df6',
  '#7c5cf5',
  '#c2367f',
  '#0f7f8f',
  '#26282c',
]

/** Payment terms, and what each one does to the due date. */
export const TERMS: { id: string; label: string; days: number }[] = [
  { id: 'receipt', label: 'Due on receipt', days: 0 },
  { id: 'net7', label: 'Net 7', days: 7 },
  { id: 'net14', label: 'Net 14', days: 14 },
  { id: 'net30', label: 'Net 30', days: 30 },
  { id: 'net60', label: 'Net 60', days: 60 },
]

/**
 * How much air a row gets, as a multiplier on the paper's own rhythm.
 *
 * One number rather than a set of paddings, because every vertical measure on
 * the page is derived from it: if the table loosens and the header does not,
 * the page stops looking typeset and starts looking like two decisions.
 */
export const DENSITY: Record<InvoiceLook['density'], number> = {
  compact: 0.82,
  cozy: 1,
  airy: 1.22,
}

/**
 * The saved document, normalised.
 *
 * Signal learned this the expensive way and wrote it down: a document saved
 * before a field existed, read by a panel that assumes it, unmounts the whole
 * app rather than the one tool, and a try/catch around `hydrate` never sees it
 * because nothing throws until render. So a document is repaired once, here, on
 * the way in, and every reader past this point can assume the shape.
 *
 * This one also has to tolerate hand-edited files, which no other tool in the
 * suite does. The JSON is offered as the save format, which means somebody will
 * open it, change a rate, and fix the total by hand while they are in there;
 * and somebody else will generate one from a script with strings where the
 * numbers go. Both are reasonable things to do to a file the tool advertised as
 * editable, so numbers are coerced rather than trusted, and an item list that
 * came back empty is given a row to stand on.
 */
export function migrateDoc(saved: unknown): InvoiceDoc | null {
  if (!saved || typeof saved !== 'object') return null
  const d = saved as Partial<InvoiceDoc>
  if (d.version !== 1) return null

  const base = defaultInvoiceDoc()
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === 'string' ? Number(v.replace(/[^0-9.-]/g, '')) : Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)

  const items = Array.isArray(d.items)
    ? d.items.map((it) =>
        makeItem({
          ...it,
          id: str(it?.id) || uid(),
          description: str(it?.description),
          unit: str(it?.unit),
          qty: num(it?.qty, 0),
          rate: num(it?.rate, 0),
        }),
      )
    : base.items
  const pay = Array.isArray(d.pay)
    ? d.pay.map((r) => ({ id: str(r?.id) || uid(), label: str(r?.label), value: str(r?.value) }))
    : base.pay

  return {
    ...base,
    ...d,
    version: 1,
    // an invoice with no lines has nothing to be about, and an empty table on
    // the paper looks like the tool failed rather than like a blank document
    items: items.length ? items : [makeItem()],
    pay,
    from: { ...base.from, ...(d.from ?? {}) },
    to: { ...base.to, ...(d.to ?? {}) },
    tax: { ...base.tax, ...(d.tax ?? {}), rate: num(d.tax?.rate, base.tax.rate) },
    discount: {
      ...base.discount,
      ...(d.discount ?? {}),
      value: num(d.discount?.value, base.discount.value),
    },
    paid: num(d.paid, 0),
    look: {
      ...base.look,
      ...(d.look ?? {}),
      rule: RULE_STYLES.includes(d.look?.rule as RuleStyle) ? (d.look?.rule as RuleStyle) : 'line',
      // a hand-edited file can put anything here, and the wash paints with it
      palette: Array.isArray(d.look?.palette)
        ? d.look.palette.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
        : [],
    },
    stamp: { ...base.stamp, ...(d.stamp ?? {}) },
  }
}
