/**
 * Ways into the editor that are not a file picker.
 *
 * Two views of the same list. `StarterRow` sits under the empty canvas as a
 * short row of pictures you can be looking at the ASCII of within a second of
 * arriving, which is the only honest way to explain what this tool does.
 * `PresetCatalog` is the full library in the panel, grouped the way Shots
 * groups it, for when the starter row is not the picture you wanted.
 *
 * Both go through the same hook, because the interesting part is not the grid:
 * it is that a preset is a *fetch*, so there is a gap between the press and the
 * picture, and a tile that does nothing visible for half a second gets pressed
 * again. The pressed tile holds a spinner and the rest go quiet until it lands.
 */

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { MoreGrid, Swatch } from '../components/catalog'
import { MiniButton } from '../components/controls'
import {
  getPresetPhoto,
  presetPhotosByCategory,
  type PresetPhotoCategory,
} from '../lib/presetPhotos'
import { useAscii } from './store'
import { ASCII_PRESET_CATEGORIES, STARTERS } from './starters'

function usePresetImport() {
  const [pending, setPending] = useState<string | null>(null)
  const current = useAscii((s) => s.doc.presetId)

  const choose = async (id: string) => {
    // pressing the one already on screen would cost a fetch and an undo entry
    // to arrive back where you started
    if (pending || id === current) return
    setPending(id)
    try {
      await useAscii.getState().importPreset(id)
    } finally {
      setPending(null)
    }
  }

  return { pending, current, choose }
}

/** The featured row, for the empty canvas. */
export function StarterRow() {
  const { pending, choose } = usePresetImport()

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="t-caption text-(--tx3)">Or start from one of these</p>
      {/* the same 384px as the drop zone above it, three across, so the two
          offers read as one block rather than a panel and a stray row */}
      <div className="grid w-96 max-w-full grid-cols-3 gap-2">
        {STARTERS.map((p) => (
          <button
            key={p.id}
            onClick={() => void choose(p.id)}
            disabled={pending !== null}
            title={`Start from ${p.name}`}
            aria-label={`Start from ${p.name}`}
            /*
             * The lift is on the image rather than the button so the shadow
             * stays put while the picture grows inside its own corner radius,
             * which is what makes it read as a photograph on a table instead
             * of a control that swells when you look at it.
             */
            className="group relative aspect-[3/2] w-full overflow-hidden rounded-md border border-(--line) transition-[border-color,opacity] duration-200 ease-settle hover:border-(--tx3) disabled:opacity-40"
          >
            <img
              src={p.thumb}
              alt=""
              loading="lazy"
              className="block h-full w-full scale-100 object-cover transition-transform duration-300 ease-settle group-hover:scale-105"
            />
            {pending === p.id && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                <Loader2 size={15} strokeWidth={2.2} className="animate-spin text-white" />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The whole library, grouped, for the Source section of the panel.
 *
 * It stays after a picture is loaded rather than being replaced by a thumbnail
 * of it. Trying the same treatment against three different photographs is the
 * normal way this tool gets used, and hiding the library behind Replace and a
 * file dialog turns that into a chore. The one you are on carries a tick.
 */
export function PresetCatalog() {
  const { pending, current, choose } = usePresetImport()
  const [picked, setPicked] = useState<PresetPhotoCategory | null>(null)

  /*
   * One folder on screen, not three.
   *
   * Three stacked rows with a heading each ran to about 200px, which pushed
   * Looks and Style off the bottom of the panel: the catalog was costing more
   * room than the controls it is meant to feed. A folder is a cheap thing to
   * pick, so it becomes a row of chips, the same way Characters picks a ramp
   * just below, and what is left is a single row of four that opens when you
   * want the rest of them.
   *
   * The chips follow the picture you are on until you touch them, so a preset
   * chosen from the canvas is the one showing its tick when you get here.
   */
  const cat = picked ?? getPresetPhoto(current)?.category ?? ASCII_PRESET_CATEGORIES[0].id

  return (
    <div className="mt-3 border-t border-(--line) pt-2.5">
      <div className="mb-1.5 flex flex-wrap gap-1">
        {ASCII_PRESET_CATEGORIES.map((c) => (
          <MiniButton key={c.id} active={cat === c.id} onClick={() => setPicked(c.id)}>
            {c.label}
          </MiniButton>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {/* keyed by folder, so switching closes an opened grid rather than
            dropping forty tiles of somewhere else into the panel */}
        <MoreGrid key={cat} cols={4}>
          {presetPhotosByCategory(cat).map((p) => (
            <Swatch
              key={p.id}
              title={p.name}
              active={current === p.id}
              onClick={() => void choose(p.id)}
              style={{ backgroundImage: `url(${p.thumb})` }}
            >
              {pending === p.id && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                  <Loader2 size={13} strokeWidth={2.2} className="animate-spin text-white" />
                </span>
              )}
            </Swatch>
          ))}
        </MoreGrid>
      </div>
    </div>
  )
}
