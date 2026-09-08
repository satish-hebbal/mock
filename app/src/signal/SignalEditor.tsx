/**
 * Signal, assembled.
 *
 * Two panels and a picture between them, the same arrangement as Shots. The
 * left one is what the picture is, the right one is what happens to it
 * afterwards, and the split exists because one column could not hold both:
 * fifty controls stacked in 280px is a scrollbar with a tool behind it.
 *
 * No timeline underneath. The clock has no keyframes on it, so a timeline would
 * be a scrubber for a value nothing else references. Transport lives on the
 * canvas instead, in the corner opposite Export.
 */

import { useEffect } from 'react'
import { useStudio } from '../store'
import { RightPanel } from '../components/RightPanel'
import { useSignal } from './store'
import { SignalCanvas } from './SignalCanvas'
import { SignalLeftPanel } from './SignalLeftPanel'
import { SignalInspector } from './SignalInspector'
import { SignalExportDialog } from './SignalExportDialog'

export function SignalEditor() {
  const hydrated = useSignal((s) => s.hydrated)
  const dialog = useSignal((s) => s.dialog)
  const hydrate = useSignal((s) => s.hydrate)
  const theme = useStudio((s) => s.theme)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  /*
   * A fresh document takes its paper from the app theme.
   *
   * Only a fresh one. Once somebody has chosen colours, or applied a palette,
   * flipping the app to light mode is not a request to repaint their artwork.
   * Same reasoning ASCII and Draw use for their paper and ink.
   */
  useEffect(() => {
    if (!hydrated) return
    const s = useSignal.getState()
    if (s.doc.ink.palette !== 'none') return
    const paper = theme === 'light' ? '#f5f6f6' : '#08090a'
    const ink = theme === 'light' ? '#0f1011' : '#f7f8f8'
    if (s.doc.ink.paper === paper) return
    s.patch((d) => {
      d.ink.paper = paper
      d.ink.ink = ink
    })
  }, [hydrated, theme])

  return (
    <>
      <main className="flex min-h-0 flex-1 gap-2">
        <SignalLeftPanel />
        <div className="relative flex min-w-0 flex-1 flex-col">{hydrated && <SignalCanvas />}</div>
        <RightPanel>
          <SignalInspector />
        </RightPanel>
      </main>
      {dialog === 'export' && <SignalExportDialog />}
    </>
  )
}
