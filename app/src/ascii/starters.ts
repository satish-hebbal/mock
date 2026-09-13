/**
 * Which shipped photographs this editor offers, and which it leads with.
 *
 * Not all of them. The preset library also carries wood tables and folded
 * fabric, which are exactly right behind a phone in Shots and useless here: a
 * flat texture has no subject, and a grid of characters cut from one is grey
 * noise with a grain to it. What survives the treatment is a picture with a
 * shape in it and some distance between its darkest and lightest parts, so the
 * three categories below are the ones offered, in the order they read best.
 *
 * `STARTERS` is the short row the empty canvas shows. Six, because it sits
 * under a drop zone and is meant to be scanned in one look rather than
 * shopped; the full grid is a panel away. They are picked to be different from
 * one another rather than to be the six best: a face, a landscape and a smear
 * of colour each land somewhere completely different once they are characters,
 * which is the point of putting them next to each other.
 */

import { PRESET_PHOTOS, type PresetPhoto, type PresetPhotoCategory } from '../lib/presetPhotos'

export const ASCII_PRESET_CATEGORIES: { id: PresetPhotoCategory; label: string }[] = [
  { id: 'anime', label: 'Anime' },
  { id: 'nature', label: 'Nature' },
  { id: 'abstract', label: 'Abstract' },
]

const STARTER_IDS = [
  'anime-07',
  'nature-01',
  'abstract-12',
  'anime-01',
  'nature-12',
  'abstract-01',
]

const byId = (id: string) => PRESET_PHOTOS.find((p) => p.id === id)

/** The featured row. Anything missing from the library is dropped, not faked. */
export const STARTERS: PresetPhoto[] = STARTER_IDS.map(byId).filter(
  (p): p is PresetPhoto => p !== undefined,
)

