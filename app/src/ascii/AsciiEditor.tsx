/**
 * ASCII, assembled.
 *
 * The panel on the left, the picture in the middle, and a thin bar over the
 * canvas holding the two things you press rather than adjust. No inspector on
 * the right: unlike the 3D studio there is no selection here, so there is
 * nothing for a second panel to be about, and a column of empty chrome next to
 * a picture is worse than no column.
 */

import { useEffect } from 'react'
import { Download } from 'lucide-react'
import { useStudio } from '../store'
import { useAscii } from './store'
import { AsciiCanvas } from './AsciiCanvas'
import { AsciiLeftPanel } from './AsciiLeftPanel'
import { AsciiExportDialog } from './AsciiExportDialog'

function ExportButton() {
  const ready = useAscii((s) => s.bitmap !== null)
  return (
    <button
      onClick={() => useAscii.getState().setDialog('export')}
      disabled={!ready}
      title="Export (E)"
      className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-md bg-(--accent-fill) px-3 t-button text-(--accent-tx) hover:bg-(--accent-fill-hover) disabled:opacity-40"
    >
      <Download size={14} strokeWidth={1.9} />
      Export
    </button>
  )
}

export function AsciiEditor() {
  const hydrated = useAscii((s) => s.hydrated)
  const dialog = useAscii((s) => s.dialog)
  const hydrate = useAscii((s) => s.hydrate)
  const theme = useStudio((s) => s.theme)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  /*
   * A fresh document takes its paper from the app theme.
   *
   * Only a fresh one. Once there is a picture, the paper is a decision somebody
   * made, and flipping the app to light mode is not a request to repaint their
   * artwork. This is the same reasoning Draw uses for its ink.
   */
  useEffect(() => {
    if (!hydrated) return
    const s = useAscii.getState()
    if (s.doc.assetId) return
    const paper = theme === 'light' ? '#f5f6f6' : '#08090a'
    const ink = theme === 'light' ? '#0f1011' : '#f7f8f8'
    if (s.doc.backdrop.color === paper) return
    s.patch((d) => {
      d.backdrop.color = paper
      d.color.ink = ink
    })
  }, [hydrated, theme])

  return (
    <>
      <main className="flex min-h-0 flex-1 gap-2">
        <AsciiLeftPanel />
        <div className="relative flex min-w-0 flex-1 flex-col">
          {hydrated && <AsciiCanvas />}
          {/* the bar does not take a row of its own: it floats in the canvas's
              top right, where there is always empty space above the picture */}
          <div className="pointer-events-none absolute top-3 right-3 flex gap-2">
            <ExportButton />
          </div>
        </div>
      </main>
      {dialog === 'export' && <AsciiExportDialog />}
    </>
  )
}
