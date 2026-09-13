// Photo background presets: real images rather than generated CSS, sourced
// from public/preset-bgs/<category>/ (processed by scripts/optimize-presets.mjs).
//
// The frame fills from a single source per preset via drawCover() in
// render.ts, the same way an uploaded background image does, so nothing here
// needs multiple crops for different aspect ratios.

export type PresetPhotoCategory = 'abstract' | 'nature' | 'table' | 'anime' | 'fabric'

export interface PresetPhoto {
  id: string
  name: string
  category: PresetPhotoCategory
  /** public URL of the full-size WebP */
  src: string
  /** small copy for the picker grid */
  thumb: string
}

/**
 * The shipped folders, in the order the picker lists them.
 *
 * `count` is how many `<category>-NN.webp` pairs the optimize script has
 * written. Adding a folder is a row here and nothing else: the picker builds
 * its sections from this list rather than carrying a copy of it.
 */
export const PRESET_PHOTO_CATEGORIES: {
  id: PresetPhotoCategory
  label: string
  count: number
}[] = [
  { id: 'abstract', label: 'Abstract', count: 36 },
  { id: 'nature', label: 'Nature', count: 41 },
  { id: 'anime', label: 'Anime', count: 21 },
  { id: 'table', label: 'Table', count: 7 },
  { id: 'fabric', label: 'Fabric', count: 8 },
]

function buildCategory(category: PresetPhotoCategory, label: string, count: number): PresetPhoto[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(2, '0')
    const id = `${category}-${n}`
    return {
      id,
      name: `${label} ${n}`,
      category,
      src: `/preset-bgs/${category}/${id}.webp`,
      thumb: `/preset-bgs/${category}/${id}-thumb.webp`,
    }
  })
}

export const PRESET_PHOTOS: PresetPhoto[] = PRESET_PHOTO_CATEGORIES.flatMap((c) =>
  buildCategory(c.id, c.label, c.count),
)

export function getPresetPhoto(id: string | null | undefined): PresetPhoto | null {
  return PRESET_PHOTOS.find((p) => p.id === id) ?? null
}

export function presetPhotosByCategory(category: PresetPhotoCategory): PresetPhoto[] {
  return PRESET_PHOTOS.filter((p) => p.category === category)
}

/**
 * A shipped preset, fetched as a blob.
 *
 * Shots and Studio paint a background straight from the URL, so they never need
 * this. An editor that takes a picture as its *source* does: ASCII decodes it,
 * saves it as an asset and sizes its document from it, all of which is the code
 * path an upload already goes down. Handing that path a blob means a preset and
 * a dropped file are the same thing from there on, rather than a second import
 * that has to be kept in step with the first.
 */
export async function loadPresetPhotoBlob(id: string): Promise<Blob | null> {
  const photo = getPresetPhoto(id)
  if (!photo) return null
  try {
    const res = await fetch(photo.src)
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}
