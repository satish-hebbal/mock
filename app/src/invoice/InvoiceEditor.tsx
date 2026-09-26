/**
 * Invoice, assembled.
 *
 * Two columns: the page, and the inspector beside it. The page is the form.
 * Every value on it is typed where it prints, the way invoice-generator.com
 * does it, so there is no column of fields describing the document at a
 * remove from it. What is left for the inspector is only what has no place on
 * the paper: the currency and the terms behind the figures, the look, the
 * stamp, and the file.
 *
 * There is no timeline, no canvas bar and nothing cut into the panel's top
 * edge. The notch exists to put tools within reach of the thing they act on,
 * and here the thing they act on is the text itself.
 */

import { useEffect } from 'react'
import { InvoiceCanvas } from './InvoiceCanvas'
import { InvoiceInspector } from './InvoiceInspector'
import { InvoiceExportDialog } from './InvoiceExportDialog'
import { StampDialog } from './StampDialog'
import { useInvoice } from './store'

export function InvoiceEditor() {
  const hydrated = useInvoice((s) => s.hydrated)
  const dialog = useInvoice((s) => s.dialog)
  const hydrate = useInvoice((s) => s.hydrate)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  /*
   * Nothing here follows the app theme, unlike every other editor in the suite,
   * and the absence is deliberate enough to be worth a note where somebody
   * would go looking for it. ASCII, Draw and Signal all take their paper from
   * the theme on a fresh document, because their paper is artwork. This one's
   * is paper: it is white because invoices are, and flipping the editor to dark
   * is not a request for a dark invoice.
   */

  return (
    <>
      <main className="flex min-h-0 flex-1 gap-2">
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-(--line) bg-(--panel)">
          {hydrated && <InvoiceCanvas />}
        </div>
        <InvoiceInspector />
      </main>
      {dialog === 'export' && <InvoiceExportDialog />}
      {dialog === 'stamp' && <StampDialog />}
    </>
  )
}
