/*
 * Environment moods.
 *
 * The studio rig lights the product; a mood lights the world around it. They do
 * different jobs, so a mood adds a layer rather than replacing the lamps: a sky
 * dome, a ground, and optionally a sun or moon, all rendered into the same cube
 * map the softboxes already live in. A glossy phone body picks the whole thing
 * up as reflections, which is what actually sells "shot at sunset" over "shot
 * in a studio with orange lights".
 *
 * These are built from geometry rather than HDRI files on purpose. The app
 * ships its models locally and works offline, and a set of real environment
 * maps would cost megabytes per preset and a network round trip on first pick.
 * Coloured planes cost nothing, load instantly, and stay controllable: the
 * horizon can follow a slider in a way a baked photograph cannot.
 */

export interface EnvMood {
  id: string
  name: string
  /** what a photographer would recognise it as, shown on the picker card */
  note: string
  /** the dome, top to bottom: [zenith, horizon, ground] */
  dome: [string, string, string]
  /** sun or moon disc; omitted for overcast moods where there is no visible source */
  sun?: {
    color: string
    intensity: number
    /** degrees off the camera axis, matching how the key is placed */
    azimuth: number
    elevation: number
    /** disc radius in scene units: a low sun is small and hard, an overcast sky is not */
    size: number
  }
  /**
   * What this mood implies for the sky/ground bounce lamp. Picking a mood seeds
   * these into the scene so the lighting agrees with the reflections, and they
   * stay editable afterwards.
   */
  hemi: { sky: string; ground: string; intensity: number }
  /** how strongly the dome shows up next to the studio softboxes */
  strength: number
}

export const ENV_MOODS: EnvMood[] = [
  {
    id: 'studio',
    name: 'Studio',
    note: 'Black room. Only your softboxes show.',
    // near-black: the softboxes are the only thing meant to show in reflections
    dome: ['#141418', '#0a0a0c', '#08080a'],
    hemi: { sky: '#2a2d35', ground: '#141414', intensity: 0.15 },
    strength: 0,
  },
  {
    id: 'sunset',
    name: 'Sunset',
    note: 'Low warm sun, deep blue overhead.',
    dome: ['#1d2b52', '#e0713a', '#2a1a16'],
    sun: { color: '#ff9d4d', intensity: 6, azimuth: 62, elevation: 6, size: 0.9 },
    hemi: { sky: '#e08a52', ground: '#2e1f18', intensity: 1.3 },
    strength: 1,
  },
  {
    id: 'dawn',
    name: 'Dawn',
    note: 'Soft pink horizon, cool sky.',
    dome: ['#2b3f6b', '#dcb0c2', '#33303a'],
    sun: { color: '#ffd9c2', intensity: 4, azimuth: -55, elevation: 9, size: 1.1 },
    hemi: { sky: '#c8b4cc', ground: '#33303a', intensity: 1.1 },
    strength: 0.9,
  },
  {
    id: 'night',
    name: 'Night',
    note: 'Blue dome, small hard moon.',
    dome: ['#1b2f63', '#263d74', '#090c16'],
    // small and hard: a moon is a point source, which is what makes night night
    sun: { color: '#dce8ff', intensity: 9, azimuth: 48, elevation: 46, size: 0.35 },
    hemi: { sky: '#4a6ab0', ground: '#07090f', intensity: 1.6 },
    strength: 0.85,
  },
  {
    id: 'warehouse',
    name: 'Warehouse',
    note: 'Grey roof light straight down.',
    // the light is the roof, so the zenith is the brightest thing in the room
    dome: ['#8e8f93', '#4a4b50', '#232427'],
    hemi: { sky: '#7e8087', ground: '#26272a', intensity: 1.1 },
    strength: 0.8,
  },
  {
    id: 'forest',
    name: 'Forest',
    note: 'Green bounce from below, sun through leaves.',
    dome: ['#8fae7c', '#3f5a3a', '#1e2a1c'],
    sun: { color: '#e8f0c8', intensity: 3.5, azimuth: 30, elevation: 62, size: 0.5 },
    hemi: { sky: '#7d9a6d', ground: '#1e2a1c', intensity: 1.1 },
    strength: 0.75,
  },
  {
    id: 'apartment',
    name: 'Apartment',
    note: 'One broad window, warm neutral room.',
    dome: ['#c4c0b6', '#8a8378', '#3b3630'],
    // a window rather than a sun: broad, sideways, and the only source in the room
    sun: { color: '#fff2dc', intensity: 2.6, azimuth: -70, elevation: 26, size: 2.6 },
    hemi: { sky: '#b0a999', ground: '#3b3630', intensity: 0.95 },
    strength: 0.7,
  },
]

export const DEFAULT_MOOD = ENV_MOODS[0]

export function getMood(id: string | undefined): EnvMood {
  return ENV_MOODS.find((m) => m.id === id) ?? DEFAULT_MOOD
}

/** Two-stop swatch for the mood picker, reading top-of-sky to ground. */
export function moodSwatch(m: EnvMood): string {
  const [zenith, horizon, ground] = m.dome
  return `linear-gradient(180deg, ${zenith} 0%, ${horizon} 55%, ${ground} 100%)`
}
