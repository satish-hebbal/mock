/**
 * Colour, three at a time.
 *
 * A Signal picture is never more than three colours: what the lit pixels
 * become, what the unlit ones become, and the accent that occupies the band
 * between them. That constraint is the tool, not a limitation of it, and it is
 * why a palette here is four numbers rather than a ramp.
 *
 * `mix` travels with the palette because it is part of the look. A palette
 * built around a hot accent wants a wide band and one built for print wants
 * none at all, and shipping the three colours without the width that makes them
 * work is how a good palette arrives looking broken.
 *
 * The first group is the app's own. Everything else is arranged by temperature
 * and by era rather than alphabetically, because nobody has ever looked for a
 * palette by its first letter.
 */

export interface Palette {
  id: string
  name: string
  group: string
  ink: string
  paper: string
  accent: string
  /** 0..100, the width of the accent band this palette was designed against */
  mix: number
}

export const PALETTES: Palette[] = [
  // ----- The app's own -----
  { id: 'ribbit', name: 'Ribbit', group: 'House', ink: '#f7f8f8', paper: '#08090a', accent: '#5e6ad2', mix: 30 },
  { id: 'ribbit-light', name: 'Ribbit Light', group: 'House', ink: '#0f1011', paper: '#f5f6f6', accent: '#5e6ad2', mix: 25 },
  { id: 'indigo-wash', name: 'Indigo Wash', group: 'House', ink: '#828fff', paper: '#08090a', accent: '#d0d6e0', mix: 40 },
  { id: 'slate', name: 'Slate', group: 'House', ink: '#d0d6e0', paper: '#141516', accent: '#8a8f98', mix: 20 },

  // ----- Cyber -----
  { id: 'cyberpunk', name: 'Cyberpunk', group: 'Cyber', ink: '#00ffcc', paper: '#0a001a', accent: '#ff00ff', mix: 40 },
  { id: 'neon-nights', name: 'Neon Nights', group: 'Cyber', ink: '#ff44ff', paper: '#0a0020', accent: '#44ffff', mix: 35 },
  { id: 'toxic', name: 'Toxic', group: 'Cyber', ink: '#00ff66', paper: '#001100', accent: '#ffff00', mix: 30 },
  { id: 'hot-pink', name: 'Hot Pink', group: 'Cyber', ink: '#ff0088', paper: '#0d000d', accent: '#ff66ff', mix: 25 },

  // ----- Minimal -----
  { id: 'mono', name: 'Monochrome', group: 'Minimal', ink: '#ffffff', paper: '#000000', accent: '#888888', mix: 0 },
  { id: 'newsprint', name: 'Newsprint', group: 'Minimal', ink: '#1a1a1a', paper: '#f0f0e8', accent: '#444444', mix: 0 },
  { id: 'blueprint', name: 'Blueprint', group: 'Minimal', ink: '#ffffff', paper: '#00244d', accent: '#4d9fff', mix: 20 },
  { id: 'red-print', name: 'Red Print', group: 'Minimal', ink: '#ffffff', paper: '#cc1122', accent: '#ffcccc', mix: 20 },

  // ----- Warm -----
  { id: 'sunset', name: 'Sunset', group: 'Warm', ink: '#ff8844', paper: '#1a0808', accent: '#ffcc00', mix: 45 },
  { id: 'ember', name: 'Ember', group: 'Warm', ink: '#ff4422', paper: '#0a0200', accent: '#ff8800', mix: 50 },
  { id: 'gold-foil', name: 'Gold Foil', group: 'Warm', ink: '#d4a850', paper: '#0a0806', accent: '#ffd700', mix: 30 },
  { id: 'campfire', name: 'Campfire', group: 'Warm', ink: '#ff6622', paper: '#0a0400', accent: '#ffaa00', mix: 35 },
  { id: 'lava', name: 'Lava', group: 'Warm', ink: '#ff4400', paper: '#0a0200', accent: '#ffaa00', mix: 50 },

  // ----- Cool -----
  { id: 'deep-ocean', name: 'Deep Ocean', group: 'Cool', ink: '#0088ff', paper: '#000816', accent: '#00ccff', mix: 40 },
  { id: 'arctic', name: 'Arctic', group: 'Cool', ink: '#44ffaa', paper: '#000a0d', accent: '#00aaff', mix: 50 },
  { id: 'frozen', name: 'Frozen', group: 'Cool', ink: '#aaddff', paper: '#000816', accent: '#ffffff', mix: 20 },
  { id: 'midnight', name: 'Midnight', group: 'Cool', ink: '#4466aa', paper: '#020408', accent: '#8899cc', mix: 25 },
  { id: 'navy-gold', name: 'Navy Gold', group: 'Cool', ink: '#ffd700', paper: '#0a1628', accent: '#4488cc', mix: 40 },

  // ----- Nature -----
  { id: 'forest', name: 'Forest', group: 'Nature', ink: '#44aa44', paper: '#060a04', accent: '#88cc44', mix: 30 },
  { id: 'coral', name: 'Coral Reef', group: 'Nature', ink: '#ff6688', paper: '#001420', accent: '#ff44aa', mix: 40 },
  { id: 'olive', name: 'Olive Field', group: 'Nature', ink: '#f0f0d0', paper: '#5a6a3a', accent: '#a0b860', mix: 35 },
  { id: 'teal-burst', name: 'Teal Burst', group: 'Nature', ink: '#ff8800', paper: '#004455', accent: '#00ccaa', mix: 45 },

  // ----- Retro -----
  { id: 'terminal', name: 'Green Terminal', group: 'Retro', ink: '#33ff33', paper: '#001100', accent: '#66ff66', mix: 0 },
  { id: 'amber', name: 'Amber Monitor', group: 'Retro', ink: '#ffaa33', paper: '#0a0600', accent: '#ff8800', mix: 0 },
  { id: 'gameboy', name: 'Game Boy', group: 'Retro', ink: '#0f380f', paper: '#9bbc0f', accent: '#306230', mix: 0 },
  { id: 'dos', name: 'DOS', group: 'Retro', ink: '#aaaaaa', paper: '#000055', accent: '#ffffff', mix: 0 },

  // ----- Pop -----
  { id: 'pop-art', name: 'Pop Art', group: 'Pop', ink: '#ff0066', paper: '#ffff00', accent: '#0066ff', mix: 50 },
  { id: 'cotton-candy', name: 'Cotton Candy', group: 'Pop', ink: '#ff88cc', paper: '#100818', accent: '#88ccff', mix: 55 },
  { id: 'tropical', name: 'Tropical', group: 'Pop', ink: '#00ffaa', paper: '#001a0a', accent: '#ff4488', mix: 50 },
  { id: 'bubblegum', name: 'Bubblegum', group: 'Pop', ink: '#ff44aa', paper: '#1a0810', accent: '#44aaff', mix: 50 },
  { id: 'rave', name: 'Rave', group: 'Pop', ink: '#ff00e1', paper: '#7d00f2', accent: '#00f28d', mix: 45 },
  { id: 'magma-rose', name: 'Magma Rose', group: 'Pop', ink: '#fc62fc', paper: '#f23000', accent: '#f20081', mix: 40 },
  { id: 'ultraviolet', name: 'Ultraviolet', group: 'Pop', ink: '#ff9500', paper: '#c600f2', accent: '#3d00f2', mix: 35 },
  { id: 'electric-gold', name: 'Electric Gold', group: 'Pop', ink: '#ffcc00', paper: '#2000f2', accent: '#f28500', mix: 45 },

  // ----- Paper -----
  { id: 'cream', name: 'Cream Ink', group: 'Paper', ink: '#2a2a2a', paper: '#f5f0e6', accent: '#8b6e4e', mix: 20 },
  { id: 'lavender', name: 'Lavender Mist', group: 'Paper', ink: '#3d3456', paper: '#e8e0f0', accent: '#7b68ae', mix: 30 },
  { id: 'mint', name: 'Mint Paper', group: 'Paper', ink: '#1a4a3a', paper: '#e0f5ed', accent: '#3a8a6a', mix: 25 },
  { id: 'blush', name: 'Blush', group: 'Paper', ink: '#6b2040', paper: '#fce4ec', accent: '#d4607a', mix: 35 },
  { id: 'sky-memo', name: 'Sky Memo', group: 'Paper', ink: '#1a3050', paper: '#e3f0fc', accent: '#4a8bc2', mix: 20 },
  { id: 'stone', name: 'Stone', group: 'Paper', ink: '#ffffff', paper: '#6b7b8a', accent: '#c0d0dd', mix: 25 },
  { id: 'taupe', name: 'Warm Taupe', group: 'Paper', ink: '#ffffff', paper: '#8a7b6b', accent: '#d4b896', mix: 30 },

  // ----- Noir -----
  { id: 'deep-teal', name: 'Deep Teal', group: 'Noir', ink: '#06df9c', paper: '#02171a', accent: '#000000', mix: 0 },
  { id: 'dark-cherry', name: 'Dark Cherry', group: 'Noir', ink: '#df0681', paper: '#1a020c', accent: '#000000', mix: 0 },
  { id: 'warm-noir', name: 'Warm Noir', group: 'Noir', ink: '#ffa600', paper: '#1a0e02', accent: '#000000', mix: 0 },
]

export const PALETTE_GROUPS = [
  'House',
  'Cyber',
  'Minimal',
  'Warm',
  'Cool',
  'Nature',
  'Retro',
  'Pop',
  'Paper',
  'Noir',
] as const

export const PALETTE_BY_ID = new Map(PALETTES.map((p) => [p.id, p]))
