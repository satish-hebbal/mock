/**
 * Invoice, on a phone.
 *
 * The desktop tool's big idea, typing onto the page where each value prints,
 * is exactly the wrong one at this size. An A4 sheet fitted to a 390px screen
 * sets its body text at about five pixels, so there is nothing to aim a finger
 * at, and the keyboard would cover the half of the page being typed on.
 *
 * So the phone splits the one surface into three screens, each built for its
 * job:
 *
 *   Edit     a form, in the order the paper reads, with the controls the phone
 *            is good at: the system date picker, the system currency list, a
 *            number pad for figures, and line items as cards rather than a
 *            table's row. The balance stays pinned at the top, so every figure
 *            typed shows its effect on the one number that matters.
 *   Style    the page on top and the look underneath, since a look is a thing
 *            you judge by seeing it.
 *   Preview  the page, whole, and the two things you do once it is right:
 *            mark it, and download it.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Eye,
  FileDown,
  FileUp,
  Palette,
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  SquarePen,
  Stamp as StampIcon,
  Trash2,
  Undo2,
} from 'lucide-react'
import { ui } from '../lib/ui'
import { BareSections } from '../lib/touch'
import { HoldButton } from '../components/HoldButton'
import { Segments } from '../components/controls'
import {
  MobileEditor,
  MobileIconButton,
  MobilePrimary,
  MobileTopBar,
} from '../components/mobile/MobileShell'
import { InvoicePaper } from './InvoicePaper'
import { LookGroup } from './InvoiceInspector'
import { InvoiceExportDialog } from './InvoiceExportDialog'
import { StampDialog } from './StampDialog'
import { CURRENCIES, currencySymbol, fromISO, lineTotal, minorDigits, money, totals } from './money'
import { daysOfTerms, termsId, useInvoice } from './store'
import { downloadInvoicePDF } from './pdf'
import { downloadJSON, pickInvoiceFile } from './export'
import { addDays, PAGE_SIZE, STAMP_KINDS, TERMS, type InvoiceDoc, type Party } from './types'

const edit = (label: string, fn: (d: InvoiceDoc) => void) => useInvoice.getState().patch(fn, label)
const st = useInvoice.getState

/* ------------------------------------------------------------ fields */

const INPUT =
  'w-full rounded-md bg-(--field) px-3 text-(--tx) outline-none transition-colors placeholder:text-(--tx3) focus:bg-(--field-h) focus:ring-1 focus:ring-(--focus)'

function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="mb-1.5 flex items-baseline justify-between gap-2 t-caption text-(--tx2)">
      <span>{children}</span>
      {hint && <span className="text-(--tx3)">{hint}</span>}
    </span>
  )
}

/** Enter moves on rather than submitting nothing; a textarea keeps its newline. */
function done(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') e.currentTarget.blur()
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
  className = '',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'email' | 'url'
  hint?: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <Label hint={hint}>{label}</Label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={done}
        placeholder={placeholder}
        autoCapitalize={type === 'text' ? 'sentences' : 'off'}
        spellCheck={false}
        enterKeyHint="next"
        className={`${INPUT} h-11`}
      />
    </label>
  )
}

function Area({
  label,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={`${INPUT} resize-none py-2.5 leading-snug`}
      />
    </label>
  )
}

/**
 * A figure, typed on the number pad.
 *
 * Kept as the text being typed until it parses, so "4." and "0.0" survive the
 * keystroke that makes them, and written back as a number the moment it does.
 */
function NumField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  className = '',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  prefix?: string
  suffix?: string
  className?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (Number.isFinite(value) ? String(value) : '')
  return (
    <label className={`block min-w-0 ${className}`}>
      <Label>{label}</Label>
      <span className={`${INPUT} flex h-11 items-center gap-1 focus-within:bg-(--field-h) focus-within:ring-1 focus-within:ring-(--focus)`}>
        {prefix && <span className="shrink-0 text-(--tx3)">{prefix}</span>}
        <input
          inputMode="decimal"
          value={shown}
          onFocus={(e) => {
            setDraft(shown)
            e.currentTarget.select()
          }}
          onChange={(e) => {
            const raw = e.target.value.replace(',', '.')
            setDraft(raw)
            const n = Number(raw)
            if (raw.trim() !== '' && Number.isFinite(n)) onChange(n)
            else if (raw.trim() === '') onChange(0)
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={done}
          className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
        />
        {suffix && <span className="shrink-0 text-(--tx3)">{suffix}</span>}
      </span>
    </label>
  )
}

/** The platform's own date picker, which on a phone is the best there is. */
function DateField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: ReactNode
}) {
  return (
    <label className="block min-w-0">
      <Label hint={hint}>{label}</Label>
      <input
        type="date"
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className={`${INPUT} h-11 appearance-none`}
      />
    </label>
  )
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-(--line) bg-(--raised) p-4">
      <div className="mb-3 flex min-h-6 items-center justify-between gap-2">
        <h3 className="t-body font-semibold text-(--tx)">{title}</h3>
        {action}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function RowButton({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Plus
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`m-press flex h-9 w-9 items-center justify-center rounded-full text-(--tx3) active:bg-(--panel3) ${
        danger ? 'active:text-(--danger)' : 'active:text-(--tx)'
      }`}
    >
      <Icon size={16} strokeWidth={1.9} />
    </button>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="m-press flex h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed border-(--line2) t-button text-(--tx2) active:bg-(--panel3)"
    >
      <Plus size={16} strokeWidth={2} />
      {label}
    </button>
  )
}

/* -------------------------------------------------------------- edit */

function daysUntil(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((fromISO(iso).getTime() - today.getTime()) / 86_400_000)
}

/** The figure everything else adds up to, pinned where it cannot scroll away. */
function Balance({ onPreview }: { onPreview: () => void }) {
  const doc = useInvoice((s) => s.doc)
  const t = totals(doc)
  const left = daysUntil(doc.dueDate)
  const stamp = doc.stamp.on ? STAMP_KINDS.find((k) => k.id === doc.stamp.kind)?.label : null
  return (
    <button
      onClick={onPreview}
      className="m-press flex w-full items-center gap-3 rounded-2xl border border-(--line) bg-(--raised) px-4 py-3 text-left shadow-[0_8px_24px_rgb(0_0_0/0.12)]"
    >
      <div className="min-w-0 flex-1">
        <p className="t-caption text-(--tx3)">Balance due</p>
        <p className="truncate t-headline font-semibold tabular-nums text-(--tx)">{money(t.due, doc.currency)}</p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 t-caption tabular-nums ${
          stamp
            ? 'text-white'
            : left < 0
              ? 'bg-(--danger)/15 text-(--danger)'
              : 'bg-(--field) text-(--tx2)'
        }`}
        style={stamp ? { background: doc.stamp.color } : undefined}
      >
        {stamp ?? (left < 0 ? `${-left}d overdue` : left === 0 ? 'Due today' : `Due in ${left}d`)}
      </span>
      <Eye size={18} strokeWidth={1.8} className="shrink-0 text-(--tx3)" />
    </button>
  )
}

function InvoiceCard() {
  const doc = useInvoice((s) => s.doc)
  const term = termsId(doc.terms)
  return (
    <Card title="Invoice">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Number" value={doc.number} onChange={(v) => edit('inv-number', (d) => void (d.number = v))} />
        <Field
          label="Reference"
          value={doc.reference}
          placeholder="PO, project"
          onChange={(v) => edit('inv-ref', (d) => void (d.reference = v))}
        />
      </div>
      <label className="block">
        <Label>Currency</Label>
        {/* the system list: thumb-sized, searchable by typing on a keyboard, and
            a wheel on iOS, which beats any menu drawn inside a scrolling page */}
        <span className="relative block">
          <span className={`${INPUT} flex h-11 items-center gap-2`}>
            <span className="w-8 shrink-0 text-(--tx3)">{currencySymbol(doc.currency)}</span>
            <span className="min-w-0 flex-1 truncate">
              {doc.currency} · {CURRENCIES.find((c) => c.code === doc.currency)?.name}
            </span>
          </span>
          <select
            value={doc.currency}
            onChange={(e) => edit('inv-currency', (d) => void (d.currency = e.target.value))}
            aria-label="Currency"
            className="absolute inset-0 h-full w-full opacity-0"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <DateField
          label="Issued"
          value={doc.issueDate}
          onChange={(v) =>
            edit('inv-issued', (d) => {
              d.issueDate = v
              // the terms are a schedule, so the due date moves with the issue date
              if (termsId(d.terms)) d.dueDate = addDays(v, daysOfTerms(d.terms))
            })
          }
        />
        <DateField
          label="Due"
          value={doc.dueDate}
          onChange={(v) =>
            edit('inv-due', (d) => {
              d.dueDate = v
              if (termsId(d.terms)) d.terms = 'Due by'
            })
          }
        />
      </div>
      <div>
        <Label hint={term ? undefined : <PenLine size={12} strokeWidth={1.9} />}>Pay within</Label>
        {/* chips on one scrolling line: five of them do not fit a phone's width
            as a segmented row without cutting "Due on receipt" to "Du…" */}
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
          {TERMS.map((t) => (
            <button
              key={t.id}
              onClick={() => st().setTerms(t.id)}
              aria-pressed={term === t.id}
              className={`m-press h-9 shrink-0 rounded-full px-3.5 t-body-sm transition-colors ${
                term === t.id ? 'bg-(--tx) text-(--raised)' : 'bg-(--field) text-(--tx2)'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </Card>
  )
}

function PartyCard({ side, title }: { side: 'from' | 'to'; title: string }) {
  const p = useInvoice((s) => s.doc[side])
  const set = (key: keyof Party) => (v: string) => edit(`inv-${side}-${key}`, (d) => void (d[side][key] = v))
  return (
    <Card title={title}>
      <Field label="Name" value={p.name} onChange={set('name')} />
      <Area label="Address" value={p.address} onChange={set('address')} rows={2} />
      <Field label="Email" type="email" value={p.email} onChange={set('email')} />
      {side === 'from' && <Field label="Website" type="url" value={p.website} onChange={set('website')} />}
      <div className="grid grid-cols-[5.5rem_1fr] gap-3">
        <Field label="Tax label" value={p.taxIdLabel} placeholder="ABN" onChange={set('taxIdLabel')} />
        <Field label="Tax number" value={p.taxId} onChange={set('taxId')} />
      </div>
    </Card>
  )
}

function ItemsCard() {
  const items = useInvoice((s) => s.doc.items)
  const currency = useInvoice((s) => s.doc.currency)
  const digits = minorDigits(currency)
  const sym = currencySymbol(currency)
  const count = items.length

  return (
    <Card title="Items" action={<span className="t-caption text-(--tx3) tabular-nums">{count}</span>}>
      {items.map((it, i) => (
        <div key={it.id} className="rounded-xl border border-(--line) p-3">
          <div className="mb-2 flex items-center gap-1">
            <span className="flex-1 t-caption text-(--tx3) tabular-nums">
              {i + 1} · <span className="text-(--tx2)">{money(lineTotal(it, digits), currency)}</span>
            </span>
            {i > 0 && <RowButton icon={ArrowUp} label="Move up" onClick={() => st().moveItem(i, i - 1)} />}
            {i < count - 1 && <RowButton icon={ArrowDown} label="Move down" onClick={() => st().moveItem(i, i + 1)} />}
            <RowButton icon={Copy} label="Duplicate" onClick={() => st().duplicateItem(it.id)} />
            {count > 1 && <RowButton icon={Trash2} label="Remove" danger onClick={() => st().removeItem(it.id)} />}
          </div>
          <div className="flex flex-col gap-3">
            <Field
              label="Description"
              value={it.description}
              placeholder="What was done"
              onChange={(v) => st().setItem(it.id, { description: v })}
            />
            <div className="grid grid-cols-[1fr_1fr_1.35fr] gap-2">
              <NumField label="Qty" value={it.qty} onChange={(v) => st().setItem(it.id, { qty: v })} />
              <Field label="Unit" value={it.unit} placeholder="hour" onChange={(v) => st().setItem(it.id, { unit: v })} />
              <NumField label="Rate" prefix={sym} value={it.rate} onChange={(v) => st().setItem(it.id, { rate: v })} />
            </div>
          </div>
        </div>
      ))}
      <AddButton label="Add an item" onClick={() => st().addItem()} />
    </Card>
  )
}

function TotalsCard() {
  const doc = useInvoice((s) => s.doc)
  const t = totals(doc)
  const sym = currencySymbol(doc.currency)
  const line = (label: string, v: number, strong?: boolean) => (
    <div className={`flex items-baseline justify-between ${strong ? 't-body font-semibold text-(--tx)' : 't-body-sm text-(--tx2)'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{money(v, doc.currency)}</span>
    </div>
  )

  return (
    <Card title="Totals">
      <div>
        <Label>Discount</Label>
        <Segments
          options={[
            { id: 'off', label: 'None' },
            { id: 'percent', label: 'Percent' },
            { id: 'amount', label: 'Amount' },
          ]}
          value={doc.discount.mode}
          onChange={(m) => edit('inv-disc-mode', (d) => void (d.discount.mode = m))}
        />
        {doc.discount.mode !== 'off' && (
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Label"
              value={doc.discount.label}
              onChange={(v) => edit('inv-disc-label', (d) => void (d.discount.label = v))}
            />
            <NumField
              label={doc.discount.mode === 'percent' ? 'Percent' : 'Amount'}
              prefix={doc.discount.mode === 'amount' ? sym : undefined}
              suffix={doc.discount.mode === 'percent' ? '%' : undefined}
              value={doc.discount.value}
              onChange={(v) => edit('inv-disc-value', (d) => void (d.discount.value = v))}
            />
          </div>
        )}
      </div>

      <div>
        <Label>Tax</Label>
        <Segments
          options={[
            { id: 'off', label: 'None' },
            { id: 'exclusive', label: 'Added' },
            { id: 'inclusive', label: 'Included' },
          ]}
          value={doc.tax.mode}
          onChange={(m) => edit('inv-tax-mode', (d) => void (d.tax.mode = m))}
        />
        {doc.tax.mode !== 'off' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Label" value={doc.tax.label} onChange={(v) => edit('inv-tax-label', (d) => void (d.tax.label = v))} />
            <NumField
              label="Rate"
              suffix="%"
              value={doc.tax.rate}
              onChange={(v) => edit('inv-tax-rate', (d) => void (d.tax.rate = v))}
            />
          </div>
        )}
      </div>

      <NumField label="Already paid" prefix={sym} value={doc.paid} onChange={(v) => edit('inv-paid', (d) => void (d.paid = v))} />

      <div className="flex flex-col gap-1.5 border-t border-(--line) pt-3">
        {line('Subtotal', t.subtotal)}
        {t.discount > 0 && line(doc.discount.label || 'Discount', -t.discount)}
        {doc.tax.mode !== 'off' &&
          line(`${doc.tax.label || 'Tax'} ${doc.tax.rate}%${doc.tax.mode === 'inclusive' ? ' incl.' : ''}`, t.tax)}
        {line('Total', t.total, true)}
        {t.paid > 0 && line('Paid', -t.paid)}
        {t.paid > 0 && line('Balance due', t.due, true)}
      </div>
    </Card>
  )
}

function PaymentCard() {
  const doc = useInvoice((s) => s.doc)
  return (
    <Card title="Payment and notes">
      <Field label="Heading" value={doc.payTitle} onChange={(v) => edit('inv-pay-title', (d) => void (d.payTitle = v))} />
      {doc.pay.map((r) => (
        <div key={r.id} className="grid grid-cols-[1fr_1.4fr_auto] items-end gap-2">
          <Field label="Label" value={r.label} onChange={(v) => st().setPayRow(r.id, { label: v })} />
          <Field label="Value" value={r.value} onChange={(v) => st().setPayRow(r.id, { value: v })} />
          <div className="pb-1">
            <RowButton icon={Trash2} label="Remove" danger onClick={() => st().removePayRow(r.id)} />
          </div>
        </div>
      ))}
      <AddButton label="Add a payment line" onClick={() => st().addPayRow()} />
      <Area label="Notes" value={doc.notes} placeholder="Anything the client should know" rows={3} onChange={(v) => edit('inv-notes', (d) => void (d.notes = v))} />
      <Field label="Footer" value={doc.footer} onChange={(v) => edit('inv-footer', (d) => void (d.footer = v))} />
    </Card>
  )
}

function FileCard() {
  const item = (Icon: typeof Plus, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="m-press flex h-12 items-center gap-3 rounded-md px-1 text-left t-body-sm text-(--tx2) active:bg-(--panel3)"
    >
      <Icon size={17} strokeWidth={1.8} className="text-(--tx3)" />
      {label}
    </button>
  )
  return (
    <Card title="This invoice">
      <div className="-my-1 flex flex-col">
        {item(SquarePen, 'Start the next invoice', () => {
          st().nextInvoice()
          ui.toast('Next invoice started. Undo brings this one back')
        })}
        {item(FileDown, 'Save as .invoice.json', () => downloadJSON(st().doc))}
        {item(FileUp, 'Open an invoice file', () => pickInvoiceFile((doc) => st().load(doc)))}
      </div>
      <div className="flex justify-center">
        <HoldButton
          icon={<RotateCcw size={14} strokeWidth={2} />}
          label="Start over"
          hint="Hold for a fresh invoice, keeping your details and look"
          onHold={() => {
            st().startOver()
            ui.toast('Fresh invoice. Undo brings it back')
          }}
          spinIcon
        />
      </div>
    </Card>
  )
}

function EditPage({ onPreview }: { onPreview: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="sticky top-0 z-10 bg-linear-to-b from-(--panel2) from-70% to-transparent px-3 pt-1 pb-4">
        <Balance onPreview={onPreview} />
      </div>
      <div className="flex flex-col gap-3 px-3 pb-8">
        <InvoiceCard />
        <PartyCard side="to" title="Bill to" />
        <ItemsCard />
        <TotalsCard />
        <PartyCard side="from" title="From" />
        <PaymentCard />
        <FileCard />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ the page */

/**
 * The paper, read-only, fitted to the width and scrolled.
 *
 * Laid out at its true size and scaled with one transform, like the desktop
 * canvas, so what is shown is the page that prints rather than a reflow of it.
 */
function PaperView({ pad = 16 }: { pad?: number }) {
  const doc = useInvoice((s) => s.doc)
  const logoUrl = useInvoice((s) => s.logoUrl)
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.4)
  const page = PAGE_SIZE[doc.look.page]

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setScale(Math.max(0.1, (el.clientWidth - pad * 2) / page.w))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [page.w, pad])

  return (
    <div ref={box} className="dot-grid h-full w-full overflow-y-auto overscroll-contain" style={{ padding: pad }}>
      <div className="mx-auto" style={{ width: page.w * scale, height: page.h * scale }}>
        <div
          className="inv-sheet"
          style={{ width: page.w, height: page.h, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          <InvoicePaper doc={doc} logoUrl={logoUrl} />
        </div>
      </div>
    </div>
  )
}

function PreviewPage() {
  const stamped = useInvoice((s) => s.doc.stamp.on)
  return (
    <>
      <div className="min-h-0 flex-1">
        <PaperView />
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-(--line) bg-(--panel2) px-3 py-3">
        <button
          onClick={() => st().setDialog('stamp')}
          className="m-press flex h-12 items-center justify-center gap-2 rounded-xl border border-(--line2) bg-(--raised) t-button text-(--tx)"
        >
          <StampIcon size={17} strokeWidth={1.9} />
          {stamped ? 'Re-mark' : 'Mark paid'}
        </button>
        <button
          onClick={() => void downloadInvoicePDF(st().doc)}
          className="m-press flex h-12 items-center justify-center gap-2 rounded-xl bg-(--accent-fill) t-button text-(--accent-tx)"
        >
          <Download size={17} strokeWidth={1.9} />
          Download PDF
        </button>
      </div>
    </>
  )
}

/* ----------------------------------------------------------- assembly */

function Bar() {
  const canUndo = useInvoice((s) => s.past.length > 0)
  const canRedo = useInvoice((s) => s.future.length > 0)
  const number = useInvoice((s) => s.doc.number)
  const client = useInvoice((s) => s.doc.to.name)
  return (
    <MobileTopBar
      title={number || 'Invoice'}
      subtitle={client ? `to ${client}` : undefined}
      actions={
        <>
          <MobileIconButton icon={Undo2} label="Undo" onClick={() => st().undo()} disabled={!canUndo} />
          <MobileIconButton icon={Redo2} label="Redo" onClick={() => st().redo()} disabled={!canRedo} />
        </>
      }
      primary={<MobilePrimary icon={Download} label="PDF" onClick={() => void downloadInvoicePDF(st().doc)} />}
    />
  )
}

export function InvoiceMobile() {
  const hydrated = useInvoice((s) => s.hydrated)
  const dialog = useInvoice((s) => s.dialog)
  const hydrate = useInvoice((s) => s.hydrate)
  const [tab, setTab] = useState('edit')

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  if (!hydrated) return <div className="h-full" />

  return (
    <>
      <MobileEditor
        bar={<Bar />}
        stage={<PaperView pad={20} />}
        tab={tab}
        onTab={setTab}
        tabs={[
          { id: 'edit', label: 'Edit', icon: PenLine, page: <EditPage onPreview={() => setTab('preview')} /> },
          {
            id: 'style',
            label: 'Style',
            icon: Palette,
            panel: (
              <BareSections value>
                <LookGroup />
              </BareSections>
            ),
          },
          { id: 'preview', label: 'Preview', icon: Eye, page: <PreviewPage /> },
        ]}
      />
      {dialog === 'export' && <InvoiceExportDialog />}
      {dialog === 'stamp' && <StampDialog />}
    </>
  )
}
