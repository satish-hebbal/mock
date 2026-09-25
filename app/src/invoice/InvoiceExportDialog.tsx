/**
 * Export.
 *
 * Two destinations, and they are not variants of one thing. The PDF is what the
 * client receives; the JSON is what you keep. Everything else in this app
 * exports pictures at a choice of sizes and formats, and none of that applies
 * to a document whose size is a page and whose format is decided by what it is
 * for, so this dialog is short on purpose.
 *
 * The header already prints in one click, the way Quick Snap does elsewhere.
 * This is the considered path: it says what the file will be called, what is in
 * it, and why the print dialog is about to appear.
 */

import { useState } from 'react'
import { ClipboardCopy, Download, FileDown, FileText } from 'lucide-react'
import { Dialog } from '../components/Overlay'
import { Segments } from '../components/controls'
import { ui } from '../lib/ui'
import { copyJSON, docJSON, downloadJSON, fileStem, printInvoice } from './export'
import { money, totals } from './money'
import { useInvoice } from './store'
import { PAGE_SIZE } from './types'

type Tab = 'pdf' | 'json'

export function InvoiceExportDialog() {
  const doc = useInvoice((s) => s.doc)
  const close = () => useInvoice.getState().setDialog(null)
  const [tab, setTab] = useState<Tab>('pdf')
  const [busy, setBusy] = useState(false)

  const t = totals(doc)
  const page = PAGE_SIZE[doc.look.page]
  const bytes = new Blob([docJSON(doc)]).size

  return (
    <Dialog title="Export" onClose={close} aside={<span className="t-caption text-(--tx3)">E</span>}>
      <Segments
        options={[
          { id: 'pdf', label: 'PDF' },
          { id: 'json', label: 'Invoice file' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'pdf' ? (
        <>
          <div className="mb-3 rounded-md bg-(--field) px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="t-body-sm text-(--tx2)">
                {doc.number} · {doc.to.name || 'No client'}
              </span>
              <span className="t-body font-semibold tabular-nums text-(--tx)">
                {money(t.due, doc.currency)}
              </span>
            </div>
            <p className="mt-1 t-caption text-(--tx3)">
              {page.label}, one page, live text. {doc.stamp.on ? 'Stamped.' : 'Unstamped.'}
            </p>
          </div>

          {/*
            Saying where the file comes from, before the system dialog appears
            unannounced. It is the browser's own print view rather than a
            generated picture of the page, which is what keeps the text
            selectable and the rules vector.
          */}
          <p className="mb-4 t-body-sm leading-relaxed text-(--tx2)">
            This opens your browser's print view. Choose{' '}
            <span className="text-(--tx)">Save as PDF</span> as the destination, and leave margins
            at their default: the page already carries its own.
          </p>

          <button
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void printInvoice(doc).finally(() => {
                setBusy(false)
                close()
              })
            }}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-(--accent-fill) t-button text-(--accent-tx) hover:bg-(--accent-fill-hover) disabled:opacity-50"
          >
            <Download size={15} strokeWidth={1.9} />
            {busy ? 'Preparing the page…' : 'Open the print view'}
          </button>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2.5 rounded-md bg-(--field) px-3 py-2.5">
            <FileText size={16} strokeWidth={1.8} className="shrink-0 text-(--tx3)" />
            <div className="min-w-0">
              <div className="truncate t-body-sm text-(--tx)">{fileStem(doc)}.invoice.json</div>
              <div className="t-caption text-(--tx3) tabular-nums">
                {(bytes / 1024).toFixed(1)} KB · {doc.items.length} lines
              </div>
            </div>
          </div>

          <p className="mb-4 t-body-sm leading-relaxed text-(--tx2)">
            The whole document, and nothing about this session. Open it here to carry on editing,
            keep it beside the PDF as the record, or write one from a script: the importer repairs
            what it can, so a file that has been hand-edited still opens.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                void copyJSON(doc).catch(() => ui.error('The clipboard would not take it'))
                close()
              }}
              className="flex h-10 items-center justify-center gap-2 rounded-md bg-(--field) t-button text-(--tx2) transition-colors hover:bg-(--field-h) hover:text-(--tx)"
            >
              <ClipboardCopy size={15} strokeWidth={1.9} />
              Copy
            </button>
            <button
              onClick={() => {
                downloadJSON(doc)
                close()
              }}
              className="flex h-10 items-center justify-center gap-2 rounded-md bg-(--accent-fill) t-button text-(--accent-tx) hover:bg-(--accent-fill-hover)"
            >
              <FileDown size={15} strokeWidth={1.9} />
              Download
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}
