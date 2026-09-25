/**
 * Invoice state.
 *
 * The same shape as the four tools next door: one document, a past and a future
 * around it, and everything that is not the document kept outside it. What is
 * different is what counts as "not the document", and this tool draws that line
 * harder than the others do, because the document is the deliverable.
 *
 * So the zoom of the preview and the blob URL the logo is currently being shown
 * through are both state and neither is saved into the file. The file holds the invoice and nothing about the
 * session that produced it, which is what makes it something you can hand to an
 * accountant, commit to a repo, or generate from a script.
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { loadAsset, loadJSON, saveAsset, saveJSON } from '../lib/db'
import { coalesces, endEditRun } from '../lib/history'
import { track } from '../lib/analytics'
import { ui } from '../lib/ui'
import { extractPalette } from './palette'
import {
  addDays,
  defaultInvoiceDoc,
  makeItem,
  makePayRow,
  migrateDoc,
  TERMS,
  todayISO,
  type InvoiceDoc,
  type LineItem,
  type StampKind,
} from './types'

const DOC_KEY = 'invoice-current'

const clone = (d: InvoiceDoc): InvoiceDoc => JSON.parse(JSON.stringify(d)) as InvoiceDoc

export type InvoiceDialog = 'export' | 'stamp' | null

interface InvoiceState {
  hydrated: boolean
  doc: InvoiceDoc
  past: InvoiceDoc[]
  future: InvoiceDoc[]

  dialog: InvoiceDialog
  /** 0 fits the page to the canvas; anything else is a chosen zoom */
  zoom: number
  /** object URL for the uploaded mark, rebuilt per session and never saved */
  logoUrl: string | null

  commit: (label?: string) => void
  undo: () => void
  redo: () => void
  patch: (fn: (d: InvoiceDoc) => void, label?: string) => void

  addItem: () => void
  setItem: (id: string, patch: Partial<LineItem>) => void
  removeItem: (id: string) => void
  duplicateItem: (id: string) => void
  moveItem: (from: number, to: number) => void

  addPayRow: () => void
  setPayRow: (id: string, patch: { label?: string; value?: string }) => void
  removePayRow: (id: string) => void

  setTerms: (id: string) => void
  /** roll the number forward and clear the stamp: the next invoice in a series */
  nextInvoice: () => void
  startOver: () => void

  markStamp: (kind: StampKind, date: string, color: string) => void
  clearStamp: () => void

  importLogo: (file: Blob) => Promise<void>
  clearLogo: () => void
  /** read the logo's colours if the document has a logo but no palette yet */
  ensurePalette: () => Promise<void>

  setName: (v: string) => void
  setDialog: (d: InvoiceDialog) => void
  setZoom: (v: number) => void
  hydrate: () => Promise<void>
  /** replace the whole document, for a file that was opened */
  load: (doc: InvoiceDoc) => void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function persist(doc: InvoiceDoc) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveJSON(DOC_KEY, doc), 400)
}

/** Write now rather than in four hundred milliseconds, for an explicit Save. */
export async function persistInvoice() {
  clearTimeout(saveTimer)
  await saveJSON(DOC_KEY, useInvoice.getState().doc)
}

/**
 * The next number in a series, guessed from the one in hand.
 *
 * `INV-0007` becomes `INV-0008`, and `2026-014` becomes `2026-015`: the last
 * run of digits is incremented and its width is kept, so the zero padding a
 * person chose survives. A number with no digits in it is left alone rather
 * than mangled, because whatever scheme that is, this function does not
 * understand it and guessing would be worse than doing nothing.
 */
export function nextNumber(current: string): string {
  const m = /(\d+)(\D*)$/.exec(current)
  if (!m) return current
  const next = String(Number(m[1]) + 1).padStart(m[1].length, '0')
  return current.slice(0, m.index) + next + m[2]
}

/** Swap the object URL the logo is shown through, revoking the old one. */
function setLogoUrl(url: string | null) {
  const prev = useInvoice.getState().logoUrl
  if (prev && prev !== url) URL.revokeObjectURL(prev)
  useInvoice.setState({ logoUrl: url })
}

export const useInvoice = create<InvoiceState>()(
  immer((set, get) => ({
    hydrated: false,
    doc: defaultInvoiceDoc(),
    past: [],
    future: [],
    dialog: null,
    zoom: 0,
    logoUrl: null,

    commit: (label) => {
      if (coalesces(label)) return
      set((s) => {
        s.past.push(clone(s.doc))
        if (s.past.length > 100) s.past.shift()
        s.future = []
      })
    },

    undo: () => {
      endEditRun()
      set((s) => {
        const prev = s.past.pop()
        if (!prev) return
        s.future.push(clone(s.doc))
        s.doc = prev
      })
      persist(get().doc)
    },

    redo: () => {
      endEditRun()
      set((s) => {
        const next = s.future.pop()
        if (!next) return
        s.past.push(clone(s.doc))
        s.doc = next
      })
      persist(get().doc)
    },

    patch: (fn, label) => {
      get().commit(label)
      set((s) => {
        fn(s.doc)
      })
      persist(get().doc)
    },

    addItem: () => {
      get().patch((d) => {
        /*
         * The new row inherits the unit and the rate of the one above it. Most
         * invoices are several lines at one rate, so carrying them over turns
         * the commonest case into typing a description and a quantity, and the
         * uncommon case into changing a number that is already there.
         */
        const last = d.items[d.items.length - 1]
        d.items.push(makeItem({ unit: last?.unit ?? '', rate: last?.rate ?? 0 }))
      })
    },

    setItem: (id, patch) => {
      // labelled per field, so typing into one cell coalesces into a single
      // undo step and moving to the next cell starts a new one
      const key = `inv-item-${id}-${Object.keys(patch).join()}`
      get().patch((d) => {
        const it = d.items.find((x) => x.id === id)
        if (it) Object.assign(it, patch)
      }, key)
    },

    removeItem: (id) => {
      get().patch((d) => {
        d.items = d.items.filter((x) => x.id !== id)
        // never leave the table empty: an invoice with no lines is not a state
        // worth being in, and an empty table reads as a broken tool
        if (!d.items.length) d.items.push(makeItem())
      })
    },

    duplicateItem: (id) => {
      get().patch((d) => {
        const i = d.items.findIndex((x) => x.id === id)
        if (i < 0) return
        d.items.splice(i + 1, 0, makeItem({ ...d.items[i] }))
      })
    },

    moveItem: (from, to) => {
      if (from === to) return
      get().patch((d) => {
        const [row] = d.items.splice(from, 1)
        if (row) d.items.splice(to, 0, row)
      })
    },

    addPayRow: () => get().patch((d) => void d.pay.push(makePayRow())),

    setPayRow: (id, patch) => {
      get().patch((d) => {
        const row = d.pay.find((r) => r.id === id)
        if (row) Object.assign(row, patch)
      }, `inv-pay-${id}-${Object.keys(patch).join()}`)
    },

    removePayRow: (id) => get().patch((d) => void (d.pay = d.pay.filter((r) => r.id !== id))),

    /*
     * Picking terms moves the due date with them, because the two are the same
     * fact written twice and leaving them to disagree is how an invoice goes
     * out saying "Net 30" over a date fourteen days away. The date stays
     * editable afterwards: terms are a shortcut to a date, not a constraint on
     * one.
     */
    setTerms: (id) => {
      get().patch((d) => {
        const term = TERM_BY_ID.get(id)
        if (!term) return
        d.terms = term.label
        d.dueDate = addDays(d.issueDate, term.days)
      })
    },

    nextInvoice: () => {
      get().patch((d) => {
        d.number = nextNumber(d.number)
        d.issueDate = todayISO()
        d.dueDate = addDays(d.issueDate, daysOfTerms(d.terms))
        d.stamp.on = false
        d.paid = 0
      })
      track('project_created', { editor: 'invoice' })
      ui.toast(`Ready for ${get().doc.number}`)
    },

    startOver: () => {
      get().commit()
      set((s) => {
        // the look survives, the record does not. Somebody who has set their
        // accent and their paper has not asked for those back when they say
        // "new invoice", and the numbering scheme is theirs too
        const look = { ...s.doc.look }
        const from = { ...s.doc.from }
        const currency = s.doc.currency
        const fresh = defaultInvoiceDoc()
        s.doc = { ...fresh, look, from, currency, number: nextNumber(s.doc.number) }
      })
      persist(get().doc)
    },

    /**
     * Put the mark on the paper.
     *
     * One action for all three of what the dialog collects, so a stamp lands as
     * a single undo step rather than as three the user has to press Ctrl+Z
     * through. The angle is rolled here rather than chosen: a stamp nobody
     * aimed is never square to the page, and a fixed tilt on every invoice
     * reads as a graphic rather than as a mark somebody made.
     */
    markStamp: (kind, date, color) => {
      get().patch((d) => {
        d.stamp.on = true
        d.stamp.kind = kind
        d.stamp.date = date
        d.stamp.color = color
        d.stamp.angle = -6 + Math.random() * 9
        // marking it paid settles the balance, which is the whole point of
        // saying so; the other three words make no claim about the money
        if (kind === 'paid') d.paid = 0
      })
      track('studio_look_applied', { editor: 'invoice', stamp: kind })
    },

    clearStamp: () => get().patch((d) => void (d.stamp.on = false)),

    importLogo: async (file) => {
      if (!file.type.startsWith('image/')) {
        ui.error('A logo has to be an image')
        return
      }
      const id = crypto.randomUUID()
      try {
        await saveAsset(id, file)
      } catch {
        ui.error('There was no room to save that logo')
        return
      }
      // the colours come out before the patch, so the logo and the palette
      // that belongs to it land as one undo step
      const palette = await extractPalette(file).catch(() => [])
      setLogoUrl(URL.createObjectURL(file))
      get().patch((d) => {
        d.look.logoAssetId = id
        d.look.showLogo = true
        d.look.palette = palette
      })
      track('media_imported', { editor: 'invoice', kind: 'logo' })
    },

    clearLogo: () => {
      setLogoUrl(null)
      get().patch((d) => {
        d.look.logoAssetId = null
        d.look.palette = []
      })
    },

    ensurePalette: async () => {
      const { logoUrl, doc } = get()
      if (!logoUrl || doc.look.palette.length) return
      const palette = await extractPalette(logoUrl).catch(() => [])
      if (!palette.length) return
      /*
       * Straight onto the document rather than through `patch`: this is the
       * logo's palette being read for the first time (a logo uploaded before
       * palettes were kept), not an edit, and an undo step for it would put
       * back a state the user never saw.
       */
      set((s) => void (s.doc.look.palette = palette))
      persist(get().doc)
    },

    setName: (v) => {
      set((s) => void (s.doc.name = v))
      persist(get().doc)
    },

    setDialog: (dialog) => set((s) => void (s.dialog = dialog)),

    setZoom: (v) => set((s) => void (s.zoom = v)),

    load: (doc) => {
      get().commit()
      set((s) => {
        s.doc = doc
      })
      // the incoming document names an asset this browser may never have seen,
      // so the mark is re-resolved rather than left pointing at the old one
      void resolveLogo(doc)
      persist(doc)
    },

    hydrate: async () => {
      if (get().hydrated) return
      try {
        const doc = migrateDoc(await loadJSON<unknown>(DOC_KEY))
        if (doc) {
          set((s) => void (s.doc = doc))
          await resolveLogo(doc)
        }
      } catch {
        /* an unreadable document is not a reason to refuse to open the tool */
      }
      set((s) => void (s.hydrated = true))
    },
  })),
)

/**
 * Point `logoUrl` at whatever blob the document names, or at nothing.
 *
 * A document can arrive from a file written on another machine, and its asset
 * id will mean nothing here. That is not an error worth a dialog: the invoice
 * is intact and only the mark is missing, so the flag is cleared and the paper
 * falls back to the monogram. Saying so out loud is still worth it, because
 * otherwise the logo silently disappears and the tool looks like it lost it.
 */
async function resolveLogo(doc: InvoiceDoc) {
  const id = doc.look.logoAssetId
  if (!id) {
    setLogoUrl(null)
    return
  }
  try {
    const blob = await loadAsset(id)
    if (blob) {
      setLogoUrl(URL.createObjectURL(blob))
      // a logo saved before palettes were kept gets its colours read now
      void useInvoice.getState().ensurePalette()
      return
    }
  } catch {
    /* falls through to the same place a missing blob does */
  }
  /*
   * Written straight to the document rather than through `patch`, because this
   * is not an edit: nobody asked for the logo to be removed, the asset is
   * simply not in this browser. Going through `patch` would push an undo entry
   * for something the user did not do, and Ctrl+Z would then appear to put back
   * a mark that still is not there.
   */
  setLogoUrl(null)
  useInvoice.setState((s) => {
    s.doc.look.logoAssetId = null
  })
  ui.toast('That invoice came from elsewhere, so its logo is not here')
}

/*
 * Terms are looked up twice (by id when picked, by label when rolled forward),
 * so both directions are built once here rather than being scanned for.
 */
const TERM_BY_ID = new Map(TERMS.map((t) => [t.id, t]))
const TERM_BY_LABEL = new Map(TERMS.map((t) => [t.label, t]))

/** How many days the written terms mean, or a fortnight if they are freehand. */
export function daysOfTerms(label: string): number {
  return TERM_BY_LABEL.get(label)?.days ?? 14
}

/** Which terms row is currently selected, or '' for something hand-written. */
export function termsId(label: string): string {
  return TERM_BY_LABEL.get(label)?.id ?? ''
}
