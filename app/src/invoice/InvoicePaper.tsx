/**
 * The page.
 *
 * This component is the deliverable, and it is also the form. On screen it is
 * drawn `editable`: every value on the sheet is a field sitting in the place,
 * face and size it prints at, so filling in an invoice is typing onto it. The
 * print path draws the very same component with editing off, which is what
 * keeps there from being a second renderer that can drift out of step with the
 * first: one layout, two modes, and the only difference between them is that
 * one of them can be typed into.
 *
 * Editing changes two things about what is on the sheet, and both are
 * deliberate. Empty optional fields stay on the page with a placeholder, since
 * a field that disappears when it is cleared cannot be filled in again; and
 * the small "+ Tax", "+ Add a line" affordances appear where the things they
 * add would go. Neither is ever printed.
 *
 * ----- why the theme stops at the edge of the paper -----
 *
 * Every other surface in this app follows the app theme. Paper does not. An
 * invoice is printed, mailed and filed by somebody who has never heard of this
 * tool, and it is white with black text because that is what that document is.
 * Rendering it dark because the editor is dark would produce a beautiful
 * artefact that is unusable at the one moment it matters. So the page carries
 * its own two colours, chosen in the inspector, and the app's tokens are not
 * referenced anywhere below this line. Even the editing plates are mixed from
 * the page's own ink, through `--inv-ink`.
 *
 * ----- the geometry -----
 *
 * `PAGE_SIZE` is in CSS pixels at 96dpi, which is the unit `@page` speaks, so
 * the page is laid out at its true size and the preview scales the whole thing
 * with one transform. Nothing inside has to know it is being scaled, and the
 * print output is at 1:1 with no compensating factor anywhere.
 */

import { forwardRef, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeftRight, Coins, Copy, GripVertical, Percent, X } from 'lucide-react'
import { pickMediaFile } from '../store'
import { lineTotal, money, qty, sharedUnit, shortDate, stampDate, totals } from './money'
import { termsId, useInvoice } from './store'
import { focusSoon } from './focus'
import { washColors } from './palette'
import { Watercolor } from './Watercolor'
import { PAdd, PDate, PNum, PText, PTool } from './onPaper'
import { DENSITY, PAGE_SIZE, PAPER_FONTS, RULE_STYLES, type InvoiceDoc, type RuleStyle } from './types'

/** The id the page is drawn with, on screen and in the print frame alike. */
export const PAPER_ID = 'invoice-paper'

/** A tint of the ink, for the labels that sit under everything they label. */
const soft = (ink: string, pct: number) => `color-mix(in srgb, ${ink} ${pct}%, transparent)`

/**
 * Every write from the page goes through here, so undo grouping stays
 * consistent: `patch` coalesces consecutive edits carrying the same label, so
 * typing a client name is one undo step and moving to the next field starts
 * another.
 */
const edit = (label: string, fn: (d: InvoiceDoc) => void) =>
  useInvoice.getState().patch(fn, label)

const st = useInvoice.getState

/** Start a new line at the foot of the table, and put the cursor in it. */
function addLine() {
  st().addItem()
  const items = st().doc.items
  focusSoon(`desc-${items[items.length - 1].id}`)
}

interface PaperProps {
  doc: InvoiceDoc
  /** the resolved object URL for an uploaded mark, if there is one */
  logoUrl: string | null
  /** the page on screen: fields to type into, and the chips that add things */
  editable?: boolean
  /** true for the copy being printed: no animation */
  flat?: boolean
}

/**
 * The mark, stamped on.
 *
 * Drawn as a rotated box with a double rule, which is what a rubber stamp is:
 * an outer frame, an inner hairline, and letterforms that were cut wide enough
 * to survive being pressed into paper. The whole thing is one colour at partial
 * strength, because stamp ink sits *on* the fibres rather than replacing them
 * and a fully opaque mark reads as a sticker.
 *
 * It lands rather than appears. The keyframes are in `index.css` and the class
 * is only attached on the live page: the print copy gets the settled state, so
 * a PDF generated a frame after the stamp was applied is never caught mid-air.
 *
 * ----- the press -----
 *
 * Drawn with CSS borders and type, the mark came out as a vector: rules ruled
 * with a straight edge, letters with perfect counters, ink at one flat
 * strength end to end. A real stamp is none of those things. The rubber is
 * cut by hand, it meets the paper unevenly, and the ink pad is never evenly
 * loaded. So the ink layer goes through one SVG filter that does to it what
 * the press does to rubber:
 *
 *   wobble   low-frequency noise nudges every edge a pixel or two, so the
 *            frame is not quite straight and the letters not quite true
 *   grain    fine noise knocks out specks, where the paper's tooth never met
 *            the ink
 *   pressure a broad, slow noise thins the ink in patches, the half of the
 *            stamp that was pressed less firmly than the other
 *
 * The noise is seeded from the stamp's angle, which is itself rolled once when
 * the mark is made. So every stamp misprints differently, and each one
 * misprints the same way every time it is drawn, on screen and in the PDF
 * alike, rather than shimmering on each render.
 */
function StampMark({ doc, flat, onClick }: { doc: InvoiceDoc; flat?: boolean; onClick?: () => void }) {
  const { stamp } = doc
  // one filter per mark; useId's colons are not legal in a url(#...) fragment
  const id = `inv-press-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  if (!stamp.on) return null
  const seed = Math.round(Math.abs(stamp.angle) * 1000) % 997

  return (
    <div
      className={flat ? 'inv-stamp' : 'inv-stamp inv-stamp-land'}
      onClick={onClick}
      title={onClick ? 'Change the mark' : undefined}
      style={{
        ['--inv-stamp-angle' as string]: `${stamp.angle}deg`,
        color: stamp.color,
        cursor: onClick ? 'pointer' : undefined,
      }}
    >
      <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
        <filter id={id} x="-6%" y="-12%" width="112%" height="124%" colorInterpolationFilters="sRGB">
          {/* wobble: the rubber was cut by hand and pressed unevenly */}
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={1} seed={seed} result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale={2.2} xChannelSelector="R" yChannelSelector="G" result="bent" />
          {/* grain: specks where the paper's tooth never met the ink */}
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves={2} seed={seed + 1} result="tooth" />
          <feColorMatrix
            in="tooth"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -16 0 0 0 12.3"
            result="grain"
          />
          {/* pressure: the pad was loaded unevenly, so the ink thins in patches */}
          <feTurbulence type="fractalNoise" baseFrequency="0.028 0.05" numOctaves={2} seed={seed + 2} result="pad" />
          <feColorMatrix
            in="pad"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1.8 0 0 0 1.9"
            result="pressure"
          />
          <feComposite in="grain" in2="pressure" operator="arithmetic" k1={1} result="ink" />
          <feComposite in="bent" in2="ink" operator="in" />
        </filter>
      </svg>
      <div className="inv-stamp-ink" style={{ filter: `url(#${id})`, borderColor: stamp.color }}>
        <span className="inv-stamp-inner" style={{ borderColor: stamp.color }}>
          <span className="inv-stamp-kind">{stamp.kind}</span>
          <span className="inv-stamp-date">{stampDate(stamp.date)}</span>
        </span>
      </div>
    </div>
  )
}

/** The issuer's mark: an uploaded image, else a monogram, else nothing. */
function Logo({ doc, logoUrl, size }: { doc: InvoiceDoc; logoUrl: string | null; size: number }) {
  const { look } = doc
  if (!look.showLogo) return null
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        style={{ height: size, maxWidth: size * 3, objectFit: 'contain', display: 'block' }}
      />
    )
  }
  const text = look.monogram.trim()
  if (!text) return null
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: size,
        minWidth: size,
        padding: `0 ${size * 0.22}px`,
        borderRadius: size * 0.28,
        background: look.accent,
        color: '#fff',
        fontSize: size * 0.44,
        fontWeight: 600,
        letterSpacing: '0.02em',
        lineHeight: 1,
      }}
    >
      {text.slice(0, 3).toUpperCase()}
    </span>
  )
}

/**
 * The mark's corner, on the page being edited.
 *
 * With a mark in place, clicking it swaps it. With none, the corner offers one
 * as a dashed drop target, because the corner where a logo goes is exactly
 * where somebody looks for the way to add one.
 */
function LogoSlot({ doc, logoUrl, size }: { doc: InvoiceDoc; logoUrl: string | null; size: number }) {
  if (!doc.look.showLogo) return null
  const pick = () => pickMediaFile((f) => void st().importLogo(f), false)
  if (logoUrl || doc.look.monogram.trim()) {
    return (
      <button type="button" className="inv-logo" onClick={pick} title="Replace the logo">
        <Logo doc={doc} logoUrl={logoUrl} size={size} />
      </button>
    )
  }
  return (
    <button
      type="button"
      className="inv-logo-add"
      onClick={pick}
      style={{ height: Math.round(size * 1.9), width: Math.round(size * 4.2) }}
    >
      + Add your logo
    </button>
  )
}

/**
 * A label beside a value, the unit the whole meta block is built from.
 *
 * On the printed page an empty value drops the whole row, which is what keeps
 * the block tidy as fields are left blank: a client with no tax number prints
 * no tax row rather than an empty one. On the page being edited the row stays,
 * because a row that vanished when it was cleared could never be filled in.
 */
function Meta({ label, children, ink }: { label: ReactNode; children: ReactNode; ink: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, lineHeight: 1.5, alignItems: 'baseline' }}>
      {label && (
        <span style={{ color: soft(ink, 55), fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
      )}
      <span style={{ color: soft(ink, 85), minWidth: 0 }}>{children}</span>
    </div>
  )
}

export const InvoicePaper = forwardRef<HTMLDivElement, PaperProps>(function InvoicePaper(
  { doc, logoUrl, editable, flat },
  ref,
) {
  const E = !!editable
  const { look } = doc
  const page = PAGE_SIZE[look.page]
  const d = DENSITY[look.density]
  const sum = totals(doc)
  const ink = look.ink
  const accent = look.accent
  const cur = doc.currency
  const fmt = (v: number) => money(v, cur)
  /* '' when the lines are billed in different units; see `sharedUnit` */
  const unit = sharedUnit(doc.items)

  const modern = look.template === 'modern'
  const compact = look.template === 'compact'
  const wash = look.template === 'wash'

  /* One number drives the page's vertical rhythm; see DENSITY. */
  const pad = Math.round(56 * (compact ? 0.86 : 1))
  const rowPad = Math.round(9 * d)
  const gap = Math.round(26 * d)
  const base = compact ? 11.5 : 12.5

  /** Printed when filled, and always there to fill while editing. */
  const shows = (v: unknown) => E || !!(typeof v === 'string' ? v.trim() : v)

  /** A string on the page: a field while editing, the plain words otherwise. */
  const txt = (
    value: string,
    label: string,
    key: string,
    set: (doc: InvoiceDoc, v: string) => void,
    opts: {
      placeholder?: string
      multiline?: boolean
      block?: boolean
      style?: CSSProperties
    } = {},
  ): ReactNode =>
    E ? (
      <PText
        value={value}
        label={label}
        placeholder={opts.placeholder}
        multiline={opts.multiline}
        block={opts.block}
        style={opts.style}
        onChange={(v) => edit(key, (doc) => set(doc, v))}
      />
    ) : (
      value
    )

  const rule = (weight = 1) => ({
    height: weight,
    background: soft(ink, weight > 1 ? 70 : 14),
    width: '100%',
  })

  /**
   * The rule that closes the sums and introduces the figure being asked for.
   *
   * This is the accent's job on every template, and it exists because the
   * accent previously had no job on two of the three. Modern wore it as a band
   * and a title; Classic and Compact reached for it only in the monogram and
   * in a balance-due line, both of which are off by default, so on a plain
   * invoice the swatches changed nothing and a control that does nothing is
   * worse than no control.
   *
   * It goes here rather than on the total's *digits* because a coloured figure
   * is a template's voice and a coloured rule is a typographer's. A hairline
   * directly under the last sum and directly over the amount due is the one
   * mark on a page of facts that is allowed to be a choice, and it points at
   * the number the whole document exists to communicate.
   *
   * 1.5px rather than 1: at a single pixel a mid-tone accent on white reads as
   * a slightly warm grey rather than as a colour, and the point of the mark is
   * that it is unmistakably the colour you picked.
   */
  const accentRule = (
    <AccentRule
      kind={look.rule}
      accent={accent}
      pad={rowPad}
      onKind={E ? (k) => edit('inv-rule', (x) => void (x.look.rule = k)) : undefined}
    />
  )

  /* ----- reordering lines, by the grip in the left margin -----
   *
   * Rows are close to a uniform height, so the target index is the drag
   * distance divided by the stride and the rows in between move by exactly one
   * stride each. The stride is measured from the live DOM at the start of each
   * drag rather than written down, and the pointer's travel is divided by the
   * canvas zoom, because the pointer moves in screen pixels and the rows move
   * in page pixels. */
  const rowEls = useRef(new Map<string, HTMLTableRowElement>())
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number } | null>(null)
  const stride = useRef(0)

  const onGrab = (e: React.PointerEvent, id: string, from: number) => {
    e.preventDefault()
    const el = rowEls.current.get(id)
    const other = rowEls.current.get(doc.items[from === 0 ? 1 : from - 1]?.id ?? '')
    stride.current = el && other ? Math.abs(other.offsetTop - el.offsetTop) : (el?.offsetHeight ?? 32)
    const scale = el && el.offsetHeight ? el.getBoundingClientRect().height / el.offsetHeight : 1
    const count = doc.items.length
    const startY = e.clientY
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)

    const move = (ev: PointerEvent) => {
      const dy = (ev.clientY - startY) / scale
      const to = Math.min(count - 1, Math.max(0, from + Math.round(dy / (stride.current || 1))))
      setDrag({ id, from, to, dy })
    }
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture?.(ev.pointerId)
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      setDrag((g) => {
        if (g && g.from !== g.to) st().moveItem(g.from, g.to)
        return null
      })
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
    setDrag({ id, from, to: from, dy: 0 })
  }

  /** Where row `i` has to sit while something is being dragged over it. */
  const shift = (i: number) => {
    if (!drag || i === drag.from) return 0
    const { from, to } = drag
    if (from < to && i > from && i <= to) return -stride.current
    if (from > to && i < from && i >= to) return stride.current
    return 0
  }

  /* ----- what sits between the lines and the total ----- */
  const discountOn = doc.discount.mode !== 'off'
  const taxOn = doc.tax.mode !== 'off'
  /*
   * "+ Amount paid" opens a row for a figure that is still zero, and a zero
   * payment is otherwise not printed at all, so the row is held open locally
   * until the field lets go. Left at zero, it folds away again.
   */
  const [paidOpen, setPaidOpen] = useState(false)
  const paidShown = sum.paid > 0 || (E && paidOpen)

  const num = { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }

  return (
    <div
      ref={ref}
      id={PAPER_ID}
      className="inv-page"
      data-editable={E || undefined}
      style={{
        width: page.w,
        height: page.h,
        background: look.paper,
        color: ink,
        fontFamily: PAPER_FONTS[look.type],
        fontSize: base,
        lineHeight: 1.45,
        position: 'relative',
        overflow: 'hidden',
        ['--inv-ink' as string]: ink,
        ['--inv-paper' as string]: look.paper,
      }}
    >
      {/* Modern wears its accent as a band across the head of the page. The
          other two keep the colour for rules and figures, where it is a
          highlight rather than a livery. */}
      {/* Wash paints the logo's colours across the head of the page, and sets
          the page's content a little lower so the title sits in the paint's
          fading lower edge rather than in the thick of it */}
      {wash && (
        <Watercolor colors={washColors(look.palette, accent)} width={page.w} height={300} />
      )}
      {modern && (
        <div style={{ position: 'absolute', insetInline: 0, top: 0, height: 10, background: accent }} />
      )}

      <div
        style={{
          padding: `${pad + (modern ? 14 : wash ? 44 : 0)}px ${pad}px ${Math.round(pad * 0.7)}px`,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          // above the wash, which is absolutely placed before it
          position: 'relative',
        }}
      >
        {/* ----- head: who is billing, and the mark ----- */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: compact ? 26 : 34,
                fontWeight: 700,
                letterSpacing: '-0.025em',
                lineHeight: 1.05,
                color: modern ? accent : ink,
              }}
            >
              Invoice
            </div>
            <div style={{ marginTop: 3, fontSize: base * 1.05, color: soft(ink, 60) }}>
              {txt(doc.from.name, 'Your business name', 'inv-from-name', (x, v) => void (x.from.name = v), {
                placeholder: 'Your business name',
              })}
            </div>
          </div>
          {E ? (
            <LogoSlot doc={doc} logoUrl={logoUrl} size={compact ? 30 : 38} />
          ) : (
            <Logo doc={doc} logoUrl={logoUrl} size={compact ? 30 : 38} />
          )}
        </div>

        {/* ----- the two columns of facts ----- */}
        <div style={{ display: 'flex', gap: 32, marginTop: Math.round(gap * 0.85) }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {shows(doc.from.taxId) && (
              <Meta
                ink={ink}
                label={
                  E ? (
                    <>
                      {txt(doc.from.taxIdLabel, 'Your tax label', 'inv-from-taxlabel', (x, v) => void (x.from.taxIdLabel = v), {
                        placeholder: 'Tax ID',
                      })}
                      :
                    </>
                  ) : doc.from.taxIdLabel ? (
                    `${doc.from.taxIdLabel}:`
                  ) : (
                    ''
                  )
                }
              >
                {txt(doc.from.taxId, 'Your tax number', 'inv-from-taxid', (x, v) => void (x.from.taxId = v), {
                  placeholder: '00 000 000 000',
                })}
              </Meta>
            )}
            {shows(doc.from.email) && (
              <Meta ink={ink} label="Email:">
                {txt(doc.from.email, 'Your email', 'inv-from-email', (x, v) => void (x.from.email = v), {
                  placeholder: 'you@studio.com',
                })}
              </Meta>
            )}
            {shows(doc.from.website) && (
              <Meta ink={ink} label="Web:">
                {txt(doc.from.website, 'Your website', 'inv-from-web', (x, v) => void (x.from.website = v), {
                  placeholder: 'studio.com',
                })}
              </Meta>
            )}
            {shows(doc.from.address) && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ color: soft(ink, 55), fontWeight: 600 }}>Address:</span>
                <div style={{ flex: E ? 1 : undefined, minWidth: 0, color: soft(ink, 85), whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {txt(doc.from.address, 'Your address', 'inv-from-addr', (x, v) => void (x.from.address = v), {
                    placeholder: 'Street, city, postcode',
                    multiline: true,
                    block: true,
                  })}
                </div>
              </div>
            )}
          </div>

          <div style={{ width: '44%', textAlign: 'right' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              {shows(doc.to.name) && (
                <Meta ink={ink} label="Invoice to:">
                  {txt(doc.to.name, 'Client name', 'inv-to-name', (x, v) => void (x.to.name = v), {
                    placeholder: 'Client name',
                  })}
                </Meta>
              )}
              {shows(doc.number) && (
                <Meta ink={ink} label="Invoice ID:">
                  {txt(doc.number, 'Invoice number', 'inv-number', (x, v) => void (x.number = v), {
                    placeholder: 'INV-0001',
                  })}
                </Meta>
              )}
              {shows(doc.reference) && (
                <Meta ink={ink} label="Reference:">
                  {txt(doc.reference, 'Reference', 'inv-ref', (x, v) => void (x.reference = v), {
                    placeholder: 'PO or project',
                  })}
                </Meta>
              )}
              <Meta ink={ink} label="Date of issue:">
                {E ? (
                  <PDate
                    label="Date of issue"
                    value={doc.issueDate}
                    display={shortDate(doc.issueDate)}
                    onChange={(v) => edit('inv-issued', (x) => void (x.issueDate = v))}
                  />
                ) : (
                  shortDate(doc.issueDate)
                )}
              </Meta>
              <Meta ink={ink} label="Payment due:">
                {E ? (
                  <PDate
                    label="Payment due"
                    value={doc.dueDate}
                    display={shortDate(doc.dueDate)}
                    onChange={(v) =>
                      edit('inv-due', (x) => {
                        x.dueDate = v
                        // a date picked by hand is the truth now, so the terms
                        // stop claiming a schedule the dates no longer follow
                        if (termsId(x.terms)) x.terms = 'Due by'
                      })
                    }
                  />
                ) : (
                  shortDate(doc.dueDate)
                )}
              </Meta>
            </div>
            {/* the client's own details, which only some invoices carry and
                which are printed only when they are filled in */}
            {shows(doc.to.address) && (
              <div style={{ marginTop: 6, color: soft(ink, 62), whiteSpace: 'pre-wrap' }}>
                {txt(doc.to.address, 'Client address', 'inv-to-addr', (x, v) => void (x.to.address = v), {
                  placeholder: 'Client address',
                  multiline: true,
                  block: true,
                })}
              </div>
            )}
            {shows(doc.to.email) && (
              <div style={{ marginTop: 2, color: soft(ink, 62) }}>
                {txt(doc.to.email, 'Client email', 'inv-to-email', (x, v) => void (x.to.email = v), {
                  placeholder: 'Client email',
                })}
              </div>
            )}
            {shows(doc.to.taxId) && (
              <div style={{ marginTop: 2, color: soft(ink, 62) }}>
                {E ? (
                  <>
                    {txt(doc.to.taxIdLabel, 'Client tax label', 'inv-to-taxlabel', (x, v) => void (x.to.taxIdLabel = v), {
                      placeholder: 'Tax ID',
                    })}
                    {': '}
                  </>
                ) : doc.to.taxIdLabel ? (
                  `${doc.to.taxIdLabel}: `
                ) : null}
                {txt(doc.to.taxId, 'Client tax number', 'inv-to-taxid', (x, v) => void (x.to.taxId = v), {
                  placeholder: 'Client tax number',
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ ...rule(), margin: `${Math.round(gap * 0.9)}px 0 ${Math.round(gap * 0.6)}px` }} />

        {/* ----- the lines ----- */}
        <div>
          <div
            style={{
              fontSize: base * 1.25,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              marginBottom: Math.round(10 * d),
            }}
          >
            Description of services
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col />
              {/* the quantity column takes the extra when it is carrying a
                  unit, in its heading or (while editing) beside each figure */}
              <col style={{ width: unit || E ? '19%' : '15%' }} />
              <col style={{ width: unit || E ? '16%' : '18%' }} />
              <col style={{ width: '18%' }} />
            </colgroup>
            <thead>
              <tr style={{ color: soft(ink, 45) }}>
                {[
                  'Description',
                  unit && !E ? `Quantity (${unit})` : 'Quantity',
                  'Unit price',
                  'Total',
                ].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      textAlign: i === 0 ? 'left' : 'right',
                      fontWeight: modern ? 600 : 400,
                      fontSize: base * 0.92,
                      /*
                       * Modern sets its column heads on a band of the accent,
                       * which is the second place it wears the colour and the
                       * one that makes it read as a different template rather
                       * than Classic with a stripe on top. The band bleeds past
                       * the first and last columns by a shadow rather than by
                       * padding, so the heads stay aligned with the figures
                       * under them.
                       */
                      ...(modern
                        ? {
                            padding: `${Math.round(rowPad * 0.75)}px 0`,
                            background: soft(accent, 12),
                            color: accent,
                            boxShadow:
                              i === 0
                                ? `-8px 0 0 ${soft(accent, 12)}`
                                : i === 3
                                  ? `8px 0 0 ${soft(accent, 12)}`
                                  : undefined,
                          }
                        : { padding: `0 0 ${rowPad}px` }),
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doc.items.map((it, i) => {
                const dragging = drag?.id === it.id
                return (
                  <tr
                    key={it.id}
                    ref={(el) => {
                      if (el) rowEls.current.set(it.id, el)
                      else rowEls.current.delete(it.id)
                    }}
                    className={E ? 'inv-row' : undefined}
                    data-dragging={dragging || undefined}
                    style={{
                      borderTop: `1px solid ${soft(ink, 9)}`,
                      ...(E && drag
                        ? {
                            transform: `translateY(${dragging ? drag.dy : shift(i)}px)`,
                            // the row under the finger must not animate to where
                            // the finger already is; everything else must, or the
                            // table teleports
                            transition: dragging ? 'none' : 'transform 180ms var(--ease-settle)',
                            position: 'relative',
                            zIndex: dragging ? 2 : undefined,
                            background: dragging ? look.paper : undefined,
                          }
                        : null),
                    }}
                  >
                    <td
                      style={{
                        padding: `${rowPad}px 8px ${rowPad}px 0`,
                        wordBreak: 'break-word',
                        position: E ? 'relative' : undefined,
                      }}
                    >
                      {E && (
                        <span className="inv-tools inv-tools-left">
                          <PTool label="Drag to reorder" onPointerDown={(e) => onGrab(e, it.id, i)}>
                            <GripVertical size={13} strokeWidth={1.8} />
                          </PTool>
                        </span>
                      )}
                      {E ? (
                        <PText
                          multiline
                          block
                          label={`Line ${i + 1} description`}
                          placeholder="What was it for?"
                          focusKey={`desc-${it.id}`}
                          value={it.description}
                          // Enter finishes the line and starts the next, which is
                          // how every list anybody has ever typed behaves
                          onEnter={addLine}
                          onChange={(v) => st().setItem(it.id, { description: v })}
                        />
                      ) : (
                        it.description || <span style={{ color: soft(ink, 30) }}>–</span>
                      )}
                    </td>
                    <td style={{ padding: `${rowPad}px 0`, ...num }}>
                      {E ? (
                        <>
                          <PNum
                            label={`Line ${i + 1} quantity`}
                            value={it.qty}
                            format={qty}
                            onChange={(v) => st().setItem(it.id, { qty: v })}
                          />
                          <PText
                            label={`Line ${i + 1} unit`}
                            value={it.unit}
                            placeholder="unit"
                            style={{ marginLeft: 4, color: soft(ink, 45) }}
                            onChange={(v) => st().setItem(it.id, { unit: v })}
                          />
                        </>
                      ) : (
                        qty(it.qty)
                      )}
                    </td>
                    <td style={{ padding: `${rowPad}px 0`, ...num }}>
                      {E ? (
                        <PNum
                          label={`Line ${i + 1} unit price`}
                          value={it.rate}
                          min={0}
                          format={fmt}
                          onChange={(v) => st().setItem(it.id, { rate: v })}
                        />
                      ) : (
                        <>
                          {fmt(it.rate)}
                          {/*
                            The unit is printed exactly once per row's worth of
                            meaning. When the whole table shares one it is in the
                            heading and this is just a price; when the lines
                            disagree it has to travel with each rate instead.
                          */}
                          {!unit && it.unit && <span style={{ color: soft(ink, 45) }}>/{it.unit}</span>}
                        </>
                      )}
                    </td>
                    <td style={{ padding: `${rowPad}px 0`, ...num, position: E ? 'relative' : undefined }}>
                      {fmt(lineTotal(it, sum.digits))}
                      {E && (
                        <span className="inv-tools inv-tools-right">
                          <PTool label="Duplicate this line" onClick={() => st().duplicateItem(it.id)}>
                            <Copy size={12} strokeWidth={1.9} />
                          </PTool>
                          <PTool label="Remove this line" danger onClick={() => st().removeItem(it.id)}>
                            <X size={13} strokeWidth={2} />
                          </PTool>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {E && (
            <div style={{ marginTop: Math.round(8 * d) }}>
              <PAdd onClick={addLine}>Add a line</PAdd>
            </div>
          )}
        </div>

        {/* ----- what it comes to ----- */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: Math.round(gap * 0.8) }}>
          <div style={{ width: '54%', fontVariantNumeric: 'tabular-nums' }}>
            {/*
              The subtotal only appears when something happens between it and
              the total. On an invoice with no tax and no discount the subtotal
              *is* the total, and printing the same figure twice under two names
              is the sort of thing that makes a reader check whether they have
              misunderstood the document.
            */}
            {(E ? discountOn || taxOn : sum.discount > 0 || taxOn) && (
              <TotalRow label="Subtotal" value={fmt(sum.subtotal)} ink={ink} pad={rowPad} />
            )}
            {(E ? discountOn : sum.discount > 0) && (
              <TotalRow
                ink={ink}
                pad={rowPad}
                label={
                  E ? (
                    <>
                      {txt(doc.discount.label, 'Discount label', 'inv-dislabel', (x, v) => void (x.discount.label = v), {
                        placeholder: 'Discount',
                      })}
                      {doc.discount.mode === 'percent' && (
                        <>
                          {' ('}
                          <PNum
                            label="Discount percent"
                            focusKey="discount"
                            value={doc.discount.value}
                            min={0}
                            format={qty}
                            onChange={(v) => edit('inv-disvalue', (x) => void (x.discount.value = v))}
                          />
                          {'%)'}
                        </>
                      )}
                    </>
                  ) : doc.discount.mode === 'percent' ? (
                    `${doc.discount.label} (${doc.discount.value}%)`
                  ) : (
                    doc.discount.label
                  )
                }
                value={
                  E && doc.discount.mode === 'amount' ? (
                    <>
                      {/* clear of the field's plate, which bleeds 4px left */}
                      <span style={{ marginRight: 5 }}>−</span>
                      <PNum
                        label="Discount amount"
                        focusKey="discount"
                        value={doc.discount.value}
                        min={0}
                        format={fmt}
                        onChange={(v) => edit('inv-disvalue', (x) => void (x.discount.value = v))}
                      />
                    </>
                  ) : (
                    `−${fmt(sum.discount)}`
                  )
                }
                tools={
                  E && (
                    <>
                      <PTool
                        label={doc.discount.mode === 'percent' ? 'Make it an amount' : 'Make it a percentage'}
                        onClick={() =>
                          edit('inv-dismode', (x) => {
                            x.discount.mode = x.discount.mode === 'percent' ? 'amount' : 'percent'
                          })
                        }
                      >
                        {doc.discount.mode === 'percent' ? (
                          <Coins size={12} strokeWidth={1.9} />
                        ) : (
                          <Percent size={12} strokeWidth={1.9} />
                        )}
                      </PTool>
                      <PTool
                        label="Remove the discount"
                        danger
                        onClick={() => edit('inv-dismode', (x) => void (x.discount.mode = 'off'))}
                      >
                        <X size={13} strokeWidth={2} />
                      </PTool>
                    </>
                  )
                }
              />
            )}
            {taxOn && (
              <TotalRow
                ink={ink}
                pad={rowPad}
                label={
                  E ? (
                    <>
                      {txt(doc.tax.label, 'Tax label', 'inv-taxlabel', (x, v) => void (x.tax.label = v), {
                        placeholder: 'Tax',
                      })}{' '}
                      <PNum
                        label="Tax rate"
                        focusKey="tax"
                        value={doc.tax.rate}
                        min={0}
                        format={qty}
                        onChange={(v) => edit('inv-taxrate', (x) => void (x.tax.rate = v))}
                      />
                      %{doc.tax.mode === 'inclusive' ? ' (incl.)' : ''}
                    </>
                  ) : (
                    `${doc.tax.label} ${doc.tax.rate}%${doc.tax.mode === 'inclusive' ? ' (incl.)' : ''}`
                  )
                }
                value={fmt(sum.tax)}
                tools={
                  E && (
                    <>
                      {/* added on top, or already inside the prices: the one
                          tax choice with no words of its own on the page but
                          "(incl.)", so it lives with the row it changes */}
                      <PTool
                        label={
                          doc.tax.mode === 'inclusive'
                            ? 'Add it on top of the prices'
                            : 'Prices already include it'
                        }
                        onClick={() =>
                          edit('inv-taxmode', (x) => {
                            x.tax.mode = x.tax.mode === 'inclusive' ? 'exclusive' : 'inclusive'
                          })
                        }
                      >
                        <ArrowLeftRight size={12} strokeWidth={1.9} />
                      </PTool>
                      <PTool
                        label="Remove the tax"
                        danger
                        onClick={() => edit('inv-taxmode', (x) => void (x.tax.mode = 'off'))}
                      >
                        <X size={13} strokeWidth={2} />
                      </PTool>
                    </>
                  )
                }
              />
            )}

            {/* the sums that are not on the page yet, offered where they go */}
            {E && (!discountOn || !taxOn || !paidShown) && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {!discountOn && (
                  <PAdd
                    onClick={() => {
                      edit('inv-dismode', (x) => void (x.discount.mode = 'percent'))
                      focusSoon('discount')
                    }}
                  >
                    Discount
                  </PAdd>
                )}
                {!taxOn && (
                  <PAdd
                    onClick={() => {
                      edit('inv-taxmode', (x) => void (x.tax.mode = 'exclusive'))
                      focusSoon('tax')
                    }}
                  >
                    Tax
                  </PAdd>
                )}
                {!paidShown && (
                  <PAdd
                    onClick={() => {
                      setPaidOpen(true)
                      focusSoon('paid')
                    }}
                  >
                    Amount paid
                  </PAdd>
                )}
              </div>
            )}

            {/*
              Accent only when this is the last rule before the figure being
              asked for. On a part-paid invoice the number that matters is the
              balance below, so this one steps back to a hairline and the colour
              moves down with the meaning.
            */}
            {paidShown ? <div style={{ ...rule(), margin: `${rowPad}px 0` }} /> : accentRule}

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: soft(ink, 60) }}>{paidShown ? 'Total' : 'Total amount due:'}</span>
              <span style={{ fontSize: base * 1.9, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {fmt(sum.total)}
              </span>
            </div>

            {paidShown && (
              <>
                <TotalRow
                  label="Amount paid"
                  ink={ink}
                  pad={rowPad}
                  tools={
                    E && (
                      <PTool
                        label="Remove the amount paid"
                        danger
                        onClick={() => {
                          edit('inv-paid', (x) => void (x.paid = 0))
                          setPaidOpen(false)
                        }}
                      >
                        <X size={13} strokeWidth={2} />
                      </PTool>
                    )
                  }
                  value={
                    E ? (
                      <>
                        <span style={{ marginRight: 5 }}>−</span>
                        <PNum
                          label="Amount paid"
                          focusKey="paid"
                          value={doc.paid}
                          min={0}
                          format={fmt}
                          onChange={(v) => edit('inv-paid', (x) => void (x.paid = v))}
                          onDone={(v) => v <= 0 && setPaidOpen(false)}
                        />
                      </>
                    ) : (
                      `−${fmt(sum.paid)}`
                    )
                  }
                />
                {accentRule}
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: soft(ink, 60) }}>Balance due:</span>
                  <span style={{ fontSize: base * 1.5, fontWeight: 700, color: accent }}>{fmt(sum.due)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div style={{ ...rule(), margin: `${Math.round(gap * 0.85)}px 0` }} />

        {/* ----- how to pay, and the mark that says it was ----- */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, position: 'relative' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {(E || doc.pay.some((r) => r.label || r.value)) && (
              <>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {txt(doc.payTitle, 'Payment heading', 'inv-paytitle', (x, v) => void (x.payTitle = v), {
                    placeholder: 'How to pay',
                  })}
                </div>
                {doc.pay.map((r) =>
                  E ? (
                    <div key={r.id} className="inv-row" style={{ position: 'relative', color: soft(ink, 80), lineHeight: 1.55 }}>
                      <span style={{ color: soft(ink, 55) }}>
                        <PText
                          label="Payment row label"
                          focusKey={`pay-${r.id}`}
                          value={r.label}
                          placeholder="Label"
                          onChange={(v) => st().setPayRow(r.id, { label: v })}
                        />
                        {': '}
                      </span>
                      <PText
                        label="Payment row value"
                        value={r.value}
                        placeholder="Value"
                        onChange={(v) => st().setPayRow(r.id, { value: v })}
                      />
                      <span className="inv-tools inv-tools-left">
                        <PTool label="Remove this row" danger onClick={() => st().removePayRow(r.id)}>
                          <X size={13} strokeWidth={2} />
                        </PTool>
                      </span>
                    </div>
                  ) : r.label || r.value ? (
                    <div key={r.id} style={{ color: soft(ink, 80), lineHeight: 1.55 }}>
                      {r.label && <span style={{ color: soft(ink, 55) }}>{r.label}: </span>}
                      {r.value}
                    </div>
                  ) : null,
                )}
                {E && (
                  <div style={{ marginTop: 4 }}>
                    <PAdd
                      onClick={() => {
                        st().addPayRow()
                        const rows = st().doc.pay
                        focusSoon(`pay-${rows[rows.length - 1].id}`)
                      }}
                    >
                      Payment detail
                    </PAdd>
                  </div>
                )}
              </>
            )}
            {shows(doc.notes) && (
              <div style={{ marginTop: 10, color: soft(ink, 70), whiteSpace: 'pre-wrap', maxWidth: '92%' }}>
                {txt(doc.notes, 'Notes', 'inv-notes', (x, v) => void (x.notes = v), {
                  placeholder: 'Notes: a thank you, late fees, anything the client should read',
                  multiline: true,
                  block: true,
                })}
              </div>
            )}
          </div>

          {/*
            The stamp is anchored to this row rather than to the page, so it
            sits beside the payment block the way one put on by hand would: over
            the empty right half, clear of the text, and above the footer.
          */}
          <div style={{ position: 'relative', width: '42%', minHeight: 96 }}>
            <StampMark
              doc={doc}
              flat={flat}
              onClick={E ? () => st().setDialog('stamp') : undefined}
            />
          </div>
        </div>

        {/* the footer is pushed to the bottom of the page rather than trailing
            the content, so a two-line invoice and a full one both close the
            same way */}
        <div style={{ flex: 1, minHeight: 12 }} />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            color: soft(ink, 45),
            fontSize: base * 0.94,
          }}
        >
          <span style={{ minWidth: 0 }}>
            {txt(doc.footer, 'Footer', 'inv-footer', (x, v) => void (x.footer = v), {
              placeholder: 'A closing line',
            })}
          </span>
          <span>{doc.from.website}</span>
        </div>
      </div>
    </div>
  )
})

function TotalRow({
  label,
  value,
  ink,
  pad,
  tools,
}: {
  label: ReactNode
  value: ReactNode
  ink: string
  pad: number
  /** the hover tools, out in the right margin */
  tools?: ReactNode
}) {
  return (
    <div
      className={tools ? 'inv-row' : undefined}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        padding: `${Math.round(pad * 0.45)}px 0`,
        position: tools ? 'relative' : undefined,
      }}
    >
      <span style={{ color: soft(ink, 60) }}>{label}</span>
      <span style={{ color: soft(ink, 92), whiteSpace: 'nowrap' }}>{value}</span>
      {tools && <span className="inv-tools inv-tools-right">{tools}</span>}
    </div>
  )
}

/*
 * ----- the accent rule, and how it is drawn -----
 *
 * Ruled by default. The zigzag and the wave are for invoices that want to look
 * made rather than generated, and both are kept subtle on purpose: a
 * three-pixel swing, at the same weight as the straight line, so the mark still
 * reads as a rule under a sum and not as a decoration competing with the total.
 *
 * Each is one tile of path repeated by an SVG pattern, so it runs to any width
 * without a seam and prints as vectors. Each tile draws a little past both of
 * its edges and is clipped back, which is what makes the joins between tiles
 * continuous rather than leaving a notch at every repeat.
 */
const RULE_H = 6
const RULE_TILES: Record<Exclude<RuleStyle, 'line'>, { w: number; d: string }> = {
  zigzag: { w: 8, d: 'M-4 1.5 L0 4.5 L4 1.5 L8 4.5 L12 1.5' },
  wave: { w: 12, d: 'M-12 3 Q-9 0.8 -6 3 T0 3 T6 3 T12 3 T18 3' },
}

/** A small picture of each stroke, for the tools that pick one. */
function RuleGlyph({ kind }: { kind: RuleStyle }) {
  const d =
    kind === 'line'
      ? 'M1 4 H15'
      : kind === 'zigzag'
        ? 'M1 5.5 L3.3 2.5 L5.6 5.5 L7.9 2.5 L10.2 5.5 L12.5 2.5 L14.8 5.5'
        : 'M1 4 Q2.75 1.5 4.5 4 T8 4 T11.5 4 T15 4'
  return (
    <svg width={16} height={8} viewBox="0 0 16 8" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const RULE_LABEL: Record<RuleStyle, string> = {
  line: 'A straight line',
  zigzag: 'A subtle zigzag',
  wave: 'A subtle wave',
}

/**
 * The rule over the figure being asked for, and, while editing, the three
 * strokes it can be drawn in, offered in the margin when it is hovered.
 *
 * The hover target is the rule's whole band of air rather than the 1.5px line
 * itself, which nobody could land a pointer on.
 */
function AccentRule({
  kind,
  accent,
  pad,
  onKind,
}: {
  kind: RuleStyle
  accent: string
  pad: number
  onKind?: (k: RuleStyle) => void
}) {
  const id = `inv-rule-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const tile = kind === 'line' ? null : RULE_TILES[kind]

  return (
    <div
      className={onKind ? 'inv-row' : undefined}
      style={{ padding: `${pad}px 0`, position: onKind ? 'relative' : undefined }}
    >
      {tile ? (
        <svg
          width="100%"
          height={RULE_H}
          aria-hidden
          // the same 1.5px of layout as the straight line, so switching the
          // stroke never moves the total underneath it
          style={{ display: 'block', margin: `${-(RULE_H - 1.5) / 2}px 0` }}
        >
          <defs>
            <pattern id={id} patternUnits="userSpaceOnUse" width={tile.w} height={RULE_H}>
              <path
                d={tile.d}
                fill="none"
                stroke={accent}
                strokeWidth={1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </pattern>
          </defs>
          <rect width="100%" height={RULE_H} fill={`url(#${id})`} />
        </svg>
      ) : (
        <div style={{ height: 1.5, background: accent, width: '100%' }} />
      )}
      {onKind && (
        // on the line itself rather than out in the margin, which is narrower
        // than three tools: the page clips anything past its own edge
        <span className="inv-tools inv-tools-pill">
          {RULE_STYLES.map((k) => (
            <PTool key={k} label={RULE_LABEL[k]} on={kind === k} onClick={() => onKind(k)}>
              <RuleGlyph kind={k} />
            </PTool>
          ))}
        </span>
      )}
    </div>
  )
}

