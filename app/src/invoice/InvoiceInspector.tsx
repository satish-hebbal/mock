/**
 * The right panel: what the document looks like, and what has been done to it.
 *
 * It carries its own header rather than borrowing the shared one. That is not
 * duplication for its own sake: the shared header is built around Quick Snap
 * and Export, which is the right pair for a tool that makes a picture and the
 * wrong pair for one that makes a record. The two verbs here are Mark and PDF,
 * and the overflow carries the file actions that only this tool has.
 *
 * The collapse still uses the app's own `panelOpen`, so `]` closes this panel
 * the way it closes every other one, and the collapsed rail keeps the verbs.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CalendarDays,
  Check,
  ClipboardCopy,
  Download,
  Eraser,
  FileDown,
  FileUp,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  Keyboard,
  MessageSquare,
  MoreHorizontal,
  PanelRightOpen,
  PenLine,
  Plus,
  Redo2,
  Rows2,
  Rows3,
  Rows4,
  RotateCcw,
  Save as SaveIcon,
  Stamp as StampIcon,
  SquarePen,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useStudio } from '../store'
import { ui } from '../lib/ui'
import { pickMediaFile } from '../store'
import { HoldButton } from '../components/HoldButton'
import { FeedbackDialog } from '../components/FeedbackDialog'
import { InfoTip, Section, SubHeading } from '../components/controls'
import { TextRow } from './fields'
import { fromISO, money, stampDate, totals } from './money'
import { CurrencyPicker } from './CurrencyPicker'
import { persistInvoice, termsId, useInvoice } from './store'
import { washColors } from './palette'
import { copyJSON, downloadJSON, pickInvoiceFile, printInvoice } from './export'
import {
  ACCENTS,
  PAGE_SIZE,
  PAPER_FONTS,
  PAPERS,
  STAMP_KINDS,
  TERMS,
  type InvoiceDoc,
  type PageSize,
  type Template,
  type TypeFamily,
} from './types'

const iconProps = { size: 15, strokeWidth: 1.75 } as const

const edit = (label: string, fn: (d: InvoiceDoc) => void) =>
  useInvoice.getState().patch(fn, label)

function IconBtn({
  icon: Icon,
  onClick,
  title,
  disabled,
  active,
  pill,
}: {
  icon: LucideIcon
  onClick?: () => void
  title: string
  disabled?: boolean
  active?: boolean
  pill?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`flex items-center justify-center transition-colors ${
        pill ? 'h-8 w-8 rounded-full' : 'h-7 w-7 rounded-md'
      } ${
        active
          ? 'bg-(--sel) text-(--tx)'
          : pill
            ? 'bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)'
            : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
      } disabled:cursor-default disabled:opacity-35 ${
        pill ? 'disabled:hover:bg-(--field)' : 'disabled:hover:bg-transparent'
      }`}
    >
      <Icon size={15} strokeWidth={1.9} />
    </button>
  )
}

/** Everything the header does, so the collapsed rail offers the same verbs. */
function useActions() {
  const canUndo = useInvoice((s) => s.past.length > 0)
  const canRedo = useInvoice((s) => s.future.length > 0)
  const [saved, setSaved] = useState(false)
  const st = useInvoice.getState

  return {
    canUndo,
    canRedo,
    saved,
    undo: () => st().undo(),
    redo: () => st().redo(),
    stamp: () => st().setDialog('stamp'),
    pdf: () => void printInvoice(st().doc),
    saveJSON: () => downloadJSON(st().doc),
    openJSON: () => pickInvoiceFile((doc) => st().load(doc)),
    copy: () =>
      void copyJSON(st().doc).catch(() => ui.error('The clipboard would not take it')),
    save: async () => {
      await persistInvoice()
      setSaved(true)
      setTimeout(() => setSaved(false), 1400)
      ui.toast('Saved')
    },
  }
}

function InspectorHeader() {
  const a = useActions()
  const name = useInvoice((s) => s.doc.name)
  const stamped = useInvoice((s) => s.doc.stamp.on)
  const [menuOpen, setMenuOpen] = useState(false)
  const [feedback, setFeedback] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  const menuItem = (Icon: LucideIcon, label: string, action: () => void) => (
    <button
      onClick={() => {
        setMenuOpen(false)
        action()
      }}
      className="flex items-center gap-2 rounded-xs px-2 py-1.5 text-left t-body-sm text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)"
    >
      <Icon size={14} strokeWidth={1.8} />
      {label}
    </button>
  )

  return (
    <div className="shrink-0 border-b border-(--line) px-3 py-2.5">
      <div className="flex items-center gap-1">
        <input
          value={name}
          onChange={(e) => useInvoice.getState().setName(e.target.value)}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
          }}
          className="min-w-0 flex-1 rounded-xs border border-transparent bg-transparent px-1.5 py-1 t-body font-medium text-(--tx) hover:border-(--line) focus:border-(--line2) focus:outline-none"
        />
        <IconBtn
          icon={PanelRightOpen}
          title="Hide the inspector (])"
          onClick={() => useStudio.getState().setPanelOpen(false)}
        />
      </div>

      <div className="mt-2 flex items-center gap-1">
        <IconBtn icon={Undo2} title="Undo" onClick={a.undo} disabled={!a.canUndo} pill />
        <IconBtn icon={Redo2} title="Redo" onClick={a.redo} disabled={!a.canRedo} pill />

        <div className="flex-1" />

        <HoldButton
          icon={<RotateCcw size={14} strokeWidth={2} />}
          label="Start over"
          hint="A fresh invoice, keeping your details and your look"
          onHold={() => {
            useInvoice.getState().startOver()
            ui.toast('Fresh invoice. Undo (Ctrl+Z) brings it back')
          }}
          spinIcon
        />

        <div className="relative" ref={menuRef}>
          <IconBtn
            icon={MoreHorizontal}
            title="More"
            onClick={() => setMenuOpen(!menuOpen)}
            active={menuOpen}
          />
          {menuOpen && (
            <div className="absolute top-9 right-0 z-30 flex w-56 flex-col gap-0.5 rounded-lg border border-(--line) bg-(--raised) p-1.5">
              {menuItem(SaveIcon, 'Save', () => void a.save())}
              <span className="my-1 h-px bg-(--line)" />
              {menuItem(FileDown, 'Save as .invoice.json', a.saveJSON)}
              {menuItem(FileUp, 'Open an invoice file…', a.openJSON)}
              {menuItem(ClipboardCopy, 'Copy the JSON', a.copy)}
              <span className="my-1 h-px bg-(--line)" />
              {menuItem(SquarePen, 'Start the next invoice', () => {
                useInvoice.getState().nextInvoice()
              })}
              {menuItem(MessageSquare, 'Send feedback…', () => setFeedback(true))}
              {menuItem(Keyboard, 'Keyboard shortcuts', () =>
                useStudio.getState().setDialog('shortcuts'),
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={a.stamp}
          title="Mark this invoice (M)"
          className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-(--field) t-button text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx)"
        >
          <StampIcon size={15} strokeWidth={1.9} />
          {stamped ? 'Re-mark' : 'Mark paid'}
        </button>
        <button
          onClick={a.pdf}
          title="Print or save as PDF (E)"
          className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-(--accent-fill) t-button text-(--accent-tx) hover:bg-(--accent-fill-hover)"
        >
          <Download size={15} strokeWidth={1.9} />
          PDF
        </button>
      </div>
      {feedback && <FeedbackDialog onClose={() => setFeedback(false)} />}
    </div>
  )
}

/* -------------------------------------------------------------------- look */

const TEMPLATES: { id: Template; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'The plain one. Nothing on the page that is not a fact.' },
  { id: 'modern', label: 'Modern', hint: 'A band of the accent across the head, and a tinted table head.' },
  { id: 'compact', label: 'Compact', hint: 'Tighter margins and type, for an invoice with many lines.' },
  { id: 'wash', label: 'Wash', hint: "A watercolour wash across the head, in your logo's colours." },
]

const TYPEFACES: { id: TypeFamily; label: string }[] = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
]

const DENSITIES: { id: InvoiceDoc['look']['density']; label: string; icon: LucideIcon }[] = [
  { id: 'compact', label: 'Tight', icon: Rows4 },
  { id: 'cozy', label: 'Normal', icon: Rows3 },
  { id: 'airy', label: 'Airy', icon: Rows2 },
]

/** What the page sizes are called where people buy paper, under the name. */
const PAGE_DIMS: Record<PageSize, string> = { a4: '210 × 297', letter: '8.5 × 11 in' }

/**
 * One option drawn as what it produces.
 *
 * Words alone were the problem with this panel: "Classic", "Modern" and
 * "Compact" in a segmented row gave no idea what any of them would do to the
 * page, so the choice felt like it made no difference. Each option here
 * carries a small picture of its effect above its name, and the picture is the
 * part that is read.
 */
function Choice({
  on,
  onClick,
  label,
  hint,
  row,
  children,
}: {
  on: boolean
  onClick: () => void
  label: string
  hint?: string
  /** picture beside the name rather than above it, for a slim card */
  row?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      title={hint ?? label}
      className={`inv-choice flex items-center rounded-md border t-caption transition-colors ${
        row ? 'h-9 justify-center gap-2 px-2' : 'flex-col gap-1.5 px-1 pt-2.5 pb-1.5'
      } ${
        on ? 'is-picked text-(--tx)' : 'border-(--line) text-(--tx2) hover:border-(--line2) hover:text-(--tx)'
      }`}
    >
      <span className={`flex items-center justify-center ${row ? '' : 'h-11'}`}>{children}</span>
      {label}
    </button>
  )
}

/**
 * A page in miniature, for the template cards.
 *
 * Drawn from the same three decisions the paper makes (a band or not, where
 * the accent goes, how tight the rows are) so the thumbnail cannot promise a
 * difference the page does not deliver.
 */
function TemplateThumb({
  template,
  accent,
  palette,
}: {
  template: Template
  accent: string
  palette: string[]
}) {
  const modern = template === 'modern'
  const compact = template === 'compact'
  const wash = template === 'wash'
  const rows = compact ? 6 : 4
  const [a, b, c] = washColors(palette, accent)
  return (
    <span
      className="inv-thumb"
      style={{ padding: compact ? '4px 4px' : wash ? '11px 5px 6px' : '6px 5px' }}
    >
      {/* the wash in miniature: three soft pools of the same colours */}
      {wash && (
        <span
          className="inv-thumb-wash"
          style={{
            background: `radial-gradient(60% 90% at 20% 0%, ${a}99, transparent 70%), radial-gradient(55% 80% at 60% 10%, ${b ?? a}88, transparent 70%), radial-gradient(50% 90% at 95% 0%, ${c ?? a}88, transparent 70%)`,
          }}
        />
      )}
      {modern && <span className="inv-thumb-band" style={{ background: accent }} />}
      <span
        className="inv-thumb-title"
        style={{ background: modern ? accent : undefined, width: compact ? '45%' : '55%' }}
      />
      <span
        className="inv-thumb-head"
        style={modern ? { background: `color-mix(in srgb, ${accent} 28%, transparent)` } : undefined}
      />
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="inv-thumb-row" style={{ marginTop: compact ? 1.5 : 2.5 }} />
      ))}
      <span className="inv-thumb-rule" style={{ background: accent }} />
    </span>
  )
}

/** A sheet at the true proportions of the page size, for the page cards. */
function PageThumb({ page }: { page: PageSize }) {
  const { w, h } = PAGE_SIZE[page]
  const height = 22
  return (
    <span
      className="inv-thumb inv-thumb-plain"
      style={{ height, width: Math.round((height * w) / h) }}
    />
  )
}

/** Square ink chips with a check, the same family as the stamp's inks. */
function Swatch({
  color,
  on,
  onClick,
  label,
}: {
  color: string
  on: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      title={label}
      data-on={on || undefined}
      className="inv-swatch"
      style={{ background: color }}
    >
      <Check size={13} strokeWidth={3} className="inv-ink-check" aria-hidden />
    </button>
  )
}

/**
 * Any colour, in the same chip as the presets.
 *
 * A rainbow until it is used, which is the one mark everybody reads as "pick
 * your own"; after that it wears the chosen colour and the check, so a custom
 * accent looks exactly as chosen as a preset one does. The platform's own
 * picker sits invisibly over the chip, and every change it reports goes
 * through the same undo label, so dragging round the wheel is one step to
 * undo rather than hundreds.
 */
function CustomSwatch({
  value,
  on,
  onChange,
}: {
  value: string
  on: boolean
  onChange: (c: string) => void
}) {
  return (
    <label
      title="Pick any colour"
      data-on={on || undefined}
      className="inv-swatch inv-swatch-custom"
      style={on ? { background: value } : undefined}
    >
      <input
        type="color"
        aria-label="Pick any accent colour"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {on ? (
        <Check size={13} strokeWidth={3} className="inv-ink-check" aria-hidden />
      ) : (
        <Plus size={13} strokeWidth={2.6} aria-hidden />
      )}
    </label>
  )
}

/**
 * A paper stock, shown as a box of it with a sheet standing up out of the top.
 *
 * The sheet is the real colour of the stock. Under the pointer it rises a
 * little further, as if being drawn out to look at, and the chosen one stays
 * drawn out with a check printed beside its name (the styles, and why the
 * layers stack as they do, are with `.inv-paper-card` in `index.css`). The three stocks are close in colour on
 * purpose (white, a warm white, a cool white), and seen as swatches they were
 * three near-identical dots; seen as paper, the difference is the thing you
 * notice.
 */
function PaperCard({
  label,
  paper,
  on,
  onClick,
}: {
  label: string
  paper: string
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      data-on={on || undefined}
      className="inv-paper-card"
    >
      <span className="inv-paper-sheet" style={{ background: paper }} />
      <span className="inv-paper-face t-caption">
        {on && <Check size={11} strokeWidth={3} aria-hidden />}
        {label}
      </span>
    </button>
  )
}

function LookGroup() {
  const look = useInvoice((s) => s.doc.look)
  const logoUrl = useInvoice((s) => s.logoUrl)
  const st = useInvoice.getState
  const paperId = PAPERS.find((p) => p.paper === look.paper)?.id ?? ''
  const pickLogo = () => pickMediaFile((f) => void st().importLogo(f), false)
  const monogram = look.monogram.trim().slice(0, 3).toUpperCase()

  return (
    <Section
      title="Look"
      icon={<FileText {...iconProps} />}
      badge={TEMPLATES.find((t) => t.id === look.template)?.label}
      actions={
        <InfoTip>
          Only the presentation lives here. Nothing in this group can change a figure, a date or a
          name, which is why an invoice can be restyled after it has been sent without anyone
          having to re-read it.
        </InfoTip>
      }
    >
      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {TEMPLATES.map((t) => (
          <Choice
            key={t.id}
            on={look.template === t.id}
            label={t.label}
            hint={t.hint}
            onClick={() => {
              edit('inv-template', (d) => void (d.look.template = t.id))
              if (t.id === 'wash') void st().ensurePalette()
            }}
          >
            <TemplateThumb template={t.id} accent={look.accent} palette={look.palette} />
          </Choice>
        ))}
      </div>

      <SubHeading>Accent</SubHeading>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {ACCENTS.map((c) => (
          <Swatch
            key={c}
            color={c}
            label={`Accent ${c}`}
            on={look.accent.toLowerCase() === c}
            onClick={() => edit('inv-accent', (d) => void (d.look.accent = c))}
          />
        ))}
        <CustomSwatch
          value={look.accent}
          on={!ACCENTS.includes(look.accent.toLowerCase())}
          onChange={(c) => edit('inv-accent', (d) => void (d.look.accent = c))}
        />
      </div>

      <SubHeading>Paper</SubHeading>
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {PAPERS.map((p) => (
          <PaperCard
            key={p.id}
            label={p.label}
            paper={p.paper}
            on={paperId === p.id}
            onClick={() =>
              edit('inv-paper', (d) => {
                d.look.paper = p.paper
                d.look.ink = p.ink
              })
            }
          />
        ))}
      </div>

      <SubHeading>Typeface</SubHeading>
      {/* each option set in the face it picks, since a typeface is the one
          choice its own name cannot describe */}
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {TYPEFACES.map((f) => (
          <Choice
            key={f.id}
            on={look.type === f.id}
            label={f.label}
            onClick={() => edit('inv-type', (d) => void (d.look.type = f.id))}
          >
            <span className="text-[22px] leading-none" style={{ fontFamily: PAPER_FONTS[f.id] }}>
              Aa
            </span>
          </Choice>
        ))}
      </div>

      <SubHeading>Density</SubHeading>
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {DENSITIES.map(({ id, label, icon: Icon }) => (
          <Choice
            key={id}
            on={look.density === id}
            label={label}
            onClick={() => edit('inv-density', (d) => void (d.look.density = id))}
          >
            <Icon size={20} strokeWidth={1.6} />
          </Choice>
        ))}
      </div>

      <SubHeading>Page</SubHeading>
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        {(['a4', 'letter'] as const).map((id) => (
          <Choice
            key={id}
            on={look.page === id}
            label={PAGE_SIZE[id].label}
            hint={PAGE_DIMS[id]}
            row
            onClick={() => edit('inv-page', (d) => void (d.look.page = id))}
          >
            <PageThumb page={id} />
          </Choice>
        ))}
      </div>

      <SubHeading icon={<ImageIcon size={12} strokeWidth={1.9} />}>Mark</SubHeading>
      {/*
        The mark itself, not a button that says it is there. It sits on a
        swatch of the chosen paper, because that is the only background it will
        ever be seen on, and a logo drawn in white-on-transparent looks fine on
        a dark panel and vanishes on the page.

        An uploaded image if there is one, and otherwise up to three letters
        set in the accent. The monogram is not a placeholder for a missing
        logo: a one-person studio with no wordmark is the commonest case this
        tool has, and two initials in a coloured chip is a better answer for
        them than an empty corner.
      */}
      <div className="mb-2 flex items-stretch gap-2">
        <button
          onClick={pickLogo}
          title={logoUrl ? 'Replace the logo' : 'Upload a logo'}
          className="inv-mark-preview"
          data-img={logoUrl ? true : undefined}
          style={{ background: look.paper }}
        >
          {logoUrl ? (
            <img src={logoUrl} alt="Your logo" />
          ) : monogram ? (
            <span className="inv-mark-mono" style={{ background: look.accent }}>
              {monogram}
            </span>
          ) : (
            <span className="inv-mark-empty">
              <ImagePlus size={16} strokeWidth={1.7} />
              Upload a logo
            </span>
          )}
        </button>
        {logoUrl && (
          <div className="flex flex-col justify-center gap-1">
            <button
              onClick={pickLogo}
              title="Replace the logo"
              aria-label="Replace the logo"
              className="inv-row-action"
            >
              <ImageIcon size={13} strokeWidth={1.9} />
            </button>
            <button
              onClick={() => st().clearLogo()}
              title="Remove the logo"
              aria-label="Remove the logo"
              className="inv-row-action hover:text-(--danger)!"
            >
              <Trash2 size={13} strokeWidth={1.9} />
            </button>
          </div>
        )}
      </div>
      {!logoUrl && (
        <TextRow
          label="Monogram"
          hint="up to 3 letters"
          value={look.monogram}
          onChange={(v) => edit('inv-mono', (d) => void (d.look.monogram = v.slice(0, 3)))}
        />
      )}
    </Section>
  )
}

/* ----------------------------------------------------------------- details */

/** Whole days from today to `iso`: negative once it has passed. */
function daysUntil(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((fromISO(iso).getTime() - today.getTime()) / 86_400_000)
}

/** 'Fri, 9 Oct', short enough for a line under a control. */
const dayMonth = (iso: string) =>
  fromISO(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * The facts behind the page that have no spot on it.
 *
 * Everything the reader sees is typed on the paper. These two are not seen,
 * they are *applied*: the currency decides how every figure is written, and
 * the days to pay move the due date. Tax is not here because it has a row on
 * the page, and is added, switched and removed there. The days to pay say,
 * right under them, what they just did to the invoice, because a setting whose
 * effect you cannot see is a setting nobody understands.
 */
function DetailsGroup() {
  const doc = useInvoice((s) => s.doc)
  const { currency } = doc
  const current = termsId(doc.terms)
  const due = daysUntil(doc.dueDate) - daysUntil(doc.issueDate)

  return (
    <Section title="Details" icon={<CalendarDays {...iconProps} />} badge={currency}>
      <SubHeading>Currency</SubHeading>
      <CurrencyPicker
        value={currency}
        onChange={(v) => edit('inv-currency', (d) => void (d.currency = v))}
      />

      {/*
        "Terms" meant nothing to anyone who has not sent a hundred invoices, so
        the control says what it is: how long the client has to pay. Picking
        one moves the due date on the page, and the line under it says where
        to. The date stays editable on the page: these are a shortcut to a
        date, not a lock on one, which is why a date picked by hand leaves all
        five unselected rather than snapping back.
      */}
      <div className="mt-3">
        <SubHeading>Pay within</SubHeading>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {TERMS.map((t) => (
          <button
            key={t.id}
            onClick={() => useInvoice.getState().setTerms(t.id)}
            aria-pressed={current === t.id}
            title={t.label}
            className={`inv-choice flex h-11 flex-col items-center justify-center rounded-md border transition-colors ${
              current === t.id
                ? 'is-picked text-(--tx)'
                : 'border-(--line) text-(--tx2) hover:border-(--line2) hover:text-(--tx)'
            }`}
          >
            <span className="t-body-sm leading-none font-semibold tabular-nums">
              {t.days === 0 ? 'Now' : t.days}
            </span>
            <span className="mt-1 text-[10px] leading-none text-(--tx3)">
              {t.days === 0 ? 'on receipt' : 'days'}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 mb-1 t-caption text-(--tx3)">
        Due <span className="text-(--tx2)">{dayMonth(doc.dueDate)}</span>
        {current
          ? due > 0
            ? `, ${due} days after it is issued`
            : ', the day it is issued'
          : ', picked by hand on the page'}
      </p>

    </Section>
  )
}

/* ------------------------------------------------------------------- status */

/**
 * Where the invoice stands.
 *
 * Open, it is a figure and a date: what is owed and how long is left, which is
 * the one thing anybody opens an old invoice to find out. Marked, it is the
 * stamp itself in miniature, in its own ink, because the stamp is what the
 * status *is* on this document and a sentence describing it was a step
 * removed.
 */
function StatusGroup() {
  const doc = useInvoice((s) => s.doc)
  const t = totals(doc)
  const { stamp } = doc
  const label = STAMP_KINDS.find((k) => k.id === stamp.kind)?.label ?? 'Paid'
  const left = daysUntil(doc.dueDate)
  const st = useInvoice.getState

  return (
    <Section title="Status" icon={<StampIcon {...iconProps} />} badge={stamp.on ? label : 'Open'}>
      {stamp.on ? (
        <>
          <div className="mb-2 flex h-20 items-center justify-center rounded-md bg-(--field)">
            <span className="inv-mini-stamp" style={{ color: stamp.color }}>
              <span className="inv-mini-stamp-kind">{label}</span>
              <span className="inv-mini-stamp-date">{stampDate(stamp.date)}</span>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => st().setDialog('stamp')}
              className="flex h-7 items-center justify-center gap-1.5 rounded-sm bg-(--field) t-body-sm text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx)"
            >
              <PenLine size={13} strokeWidth={1.9} />
              Change
            </button>
            <button
              onClick={() => st().clearStamp()}
              className="flex h-7 items-center justify-center gap-1.5 rounded-sm bg-(--field) t-body-sm text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--danger)"
            >
              <Eraser size={13} strokeWidth={1.9} />
              Unmark
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-2 rounded-md bg-(--field) px-3 py-2.5">
            <div className="t-caption text-(--tx3)">Outstanding</div>
            <div className="mt-0.5 t-headline font-semibold tabular-nums text-(--tx)">
              {money(t.due, doc.currency)}
            </div>
            <div className={`mt-0.5 t-caption ${left < 0 ? 'text-(--danger)' : 'text-(--tx2)'}`}>
              {left < 0
                ? `${-left} ${-left === 1 ? 'day' : 'days'} overdue`
                : left === 0
                  ? 'Due today'
                  : `Due ${dayMonth(doc.dueDate)}, in ${left} ${left === 1 ? 'day' : 'days'}`}
            </div>
          </div>
          <button
            onClick={() => st().setDialog('stamp')}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-sm bg-(--field) t-button text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx)"
          >
            <StampIcon size={14} strokeWidth={1.9} />
            Mark this invoice
          </button>
        </>
      )}
    </Section>
  )
}

/* -------------------------------------------------------------------- panel */

function CollapsedRail() {
  const a = useActions()
  return (
    <div className="flex w-13 shrink-0 flex-col items-center gap-1 rounded-lg border border-(--line) bg-(--raised) py-2">
      <IconBtn
        icon={PanelRightOpen}
        title="Show the inspector (])"
        onClick={() => useStudio.getState().setPanelOpen(true)}
      />
      <span className="my-1 h-px w-6 shrink-0 bg-(--line)" />
      <button
        onClick={a.pdf}
        title="Print or save as PDF (E)"
        aria-label="Print or save as PDF"
        className="flex h-8 w-8 items-center justify-center rounded-md bg-(--accent-fill) text-(--accent-tx) hover:bg-(--accent-fill-hover)"
      >
        <Download size={15} strokeWidth={2} />
      </button>
      <span className="my-1 h-px w-6 shrink-0 bg-(--line)" />
      <IconBtn icon={Undo2} title="Undo" onClick={a.undo} disabled={!a.canUndo} />
      <IconBtn icon={Redo2} title="Redo" onClick={a.redo} disabled={!a.canRedo} />
      <IconBtn icon={StampIcon} title="Mark this invoice (M)" onClick={a.stamp} />
      <IconBtn icon={FileDown} title="Save as .invoice.json" onClick={a.saveJSON} />
      <IconBtn
        icon={SaveIcon}
        title={a.saved ? 'Saved' : 'Save'}
        onClick={() => void a.save()}
        active={a.saved}
      />
    </div>
  )
}

export function InvoiceInspector() {
  const open = useStudio((s) => s.panelOpen)
  if (!open) return <CollapsedRail />
  return (
    <div className="flex w-[316px] shrink-0 flex-col overflow-hidden rounded-lg border border-(--line) bg-(--raised)">
      <InspectorHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DetailsGroup />
        <StatusGroup />
        <LookGroup />
      </div>
    </div>
  )
}
