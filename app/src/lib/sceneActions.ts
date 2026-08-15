/**
 * Scene edits that more than one surface can trigger. The top bar and the
 * inspector both offer "add a logo" or "upload a background", so the behaviour
 * lives here once instead of drifting between the two.
 */
import { pickMediaFile, useStudio } from '../store'
import { ui } from './ui'
import type { Overlay, TextOverlay } from '../types'

const uid = () => crypto.randomUUID()

/**
 * Import a file and hand back the new asset, undoing the auto-bind to the
 * selected device — backgrounds and logos are not screen media.
 */
async function importUnboundAsset(file: Blob) {
  const before = new Set(useStudio.getState().project.assets.map((a) => a.id))
  await useStudio.getState().importMedia(file)
  const added = useStudio.getState().project.assets.find((a) => !before.has(a.id))
  if (!added) return null
  const dev = useStudio.getState().project.scene.devices.find((d) => d.screen.assetId === added.id)
  if (dev) useStudio.getState().updateDeviceScreen(dev.id, { assetId: null })
  return added
}

/** Pick an image and use it as the scene background. */
export function importBackgroundImage() {
  pickMediaFile(async (f) => {
    const added = await importUnboundAsset(f)
    if (added) useStudio.getState().setBackground({ imageAssetId: added.id, type: 'image' })
  }, false)
}

export function addTextOverlay() {
  const o: TextOverlay = {
    id: `ovl_${uid()}`,
    type: 'text',
    text: 'Your headline',
    x: 0.5,
    y: 0.14,
    opacity: 1,
    rotation: 0,
    size: 0.055,
    weight: 700,
    color: '#ffffff',
    font: 'system-ui',
    align: 'center',
    bg: null,
  }
  useStudio.getState().addOverlay(o)
}

export function addShapeOverlay() {
  useStudio.getState().addOverlay({
    id: `ovl_${uid()}`,
    type: 'shape',
    shape: 'rect',
    x: 0.5,
    y: 0.85,
    opacity: 0.9,
    rotation: 0,
    width: 0.22,
    height: 0.08,
    color: '#111827',
    radius: 0.04,
  } as Overlay)
}

export function addLogoOverlay() {
  pickMediaFile(async (f) => {
    const added = await importUnboundAsset(f)
    if (!added) return
    useStudio.getState().addOverlay({
      id: `ovl_${uid()}`,
      type: 'image',
      assetId: added.id,
      x: 0.12,
      y: 0.1,
      opacity: 1,
      rotation: 0,
      width: 0.12,
    } as Overlay)
  }, false)
}

/** Capture "my device isn't here" requests into a local backlog (PRD §6.2). */
export async function requestDevice() {
  const name = await ui.prompt({
    title: 'Request a device',
    label: 'Which device should we add?',
    placeholder: 'e.g. Pixel Tablet, Galaxy Fold',
    confirmLabel: 'Send request',
  })
  if (!name) return
  try {
    const key = 'ms-device-requests'
    const list = JSON.parse(localStorage.getItem(key) || '[]') as string[]
    list.push(name)
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // ignore storage failures
  }
  ui.toast('Thanks — your request was logged.', 'success')
}
