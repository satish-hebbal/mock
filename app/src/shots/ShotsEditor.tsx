import { useShots } from './store'
import { ShotsCanvas } from './ShotsCanvas'
import { ShotsInspector } from './ShotsInspector'
import { ShotsExportDialog } from './ShotsExportDialog'
import { RightPanel } from '../components/RightPanel'

export function ShotsEditor() {
  const hydrated = useShots((s) => s.hydrated)
  const dialog = useShots((s) => s.dialog)
  return (
    <>
      <main className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">{hydrated && <ShotsCanvas />}</div>
        <RightPanel>
          <ShotsInspector />
        </RightPanel>
      </main>
      {dialog === 'export' && <ShotsExportDialog />}
    </>
  )
}
