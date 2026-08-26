import type { CSSProperties } from 'react'
import { Boxes, Image as ImageIcon, PenLine, type LucideIcon } from 'lucide-react'
import type { AppMode } from '../store'

/**
 * The tools, in one place.
 *
 * The app menu and the home screen both list them, and their copy had already
 * drifted apart, the same tool described two different ways depending on where
 * you read it.
 *
 * Each carries a `tint`: two colours for the soft blobs behind its card. A flat
 * surface made the four read as one grey block, and giving each its own quiet
 * wash makes them recognisable at a glance without resorting to a border or a
 * loud fill. The values stay low enough to sit under the text, not behind it.
 */
export interface Tool {
  /** where picking it takes you; 'home' for the ones that aren't built yet */
  id: AppMode
  name: string
  tagline: string
  icon: LucideIcon
  soon?: boolean
  /** [near, far] blob colours */
  tint: [string, string]
}

export const TOOLS: Tool[] = [
  {
    id: 'studio',
    name: '3D Studio',
    tagline: 'Put a screen on a 3D device, light it, and export a video.',
    icon: Boxes,
    tint: ['94, 106, 210', '130, 143, 255'],
  },
  {
    id: 'shots',
    name: 'Shots',
    tagline: 'Frame screens on a backdrop worth posting, in seconds.',
    icon: ImageIcon,
    tint: ['224, 138, 62', '236, 186, 96'],
  },
  {
    id: 'draw',
    name: 'Draw',
    tagline: 'A hand-drawn whiteboard, and a tray of pens that behave like pens.',
    icon: PenLine,
    tint: ['64, 176, 140', '96, 200, 176'],
  },
]

/**
 * The soft blob wash behind a tool card. Two off-centre radials over the panel
 * surface: `strength` is scaled right down for tools that aren't built yet, so
 * they recede without needing a separate style.
 */
export function toolWash(tool: Tool, strength = 1): string {
  const [near, far] = tool.tint
  const a = (base: number) => (base * strength).toFixed(3)
  return [
    `radial-gradient(120% 95% at 12% 8%, rgba(${near}, ${a(0.2)}), transparent 62%)`,
    `radial-gradient(110% 85% at 88% 92%, rgba(${far}, ${a(0.14)}), transparent 60%)`,
    `var(--field)`,
  ].join(', ')
}

/**
 * The selected tool card, lit.
 *
 * `.is-picked` is deliberately quiet: it sits over colour swatches and
 * thumbnails you're judging, so it can't add light of its own without changing
 * what you're looking at. A tool card is the opposite case: it isn't a value
 * you picked, it's the room you're standing in, and it should read as switched
 * on. So this spends exactly what that class withholds, and spends all of it
 * from the tool's own near tint: a hot spot behind the icon, a tinted edge, and
 * a brighter chip. Each tool warms in its own colour rather than every
 * selection glowing the same borrowed blue.
 *
 * It arrives in three pieces because a tool card does: the hairline is the
 * card's own background, the surface is a fill layer inset inside it, and the
 * chip sits on top of both.
 *
 * There is no bloom under the card any more. A box-shadow is drawn from the
 * border box, so on an interlocked card it blooms around a rectangle the card
 * is no longer shaped like, and the parts of it outside the clip are cut away
 * regardless. `drop-shadow` does follow the cut silhouette, but it has no
 * spread to pull the falloff back in the way `-14px` was doing, so the lit card
 * ended up sitting in a halo twice the size of the one it replaced and read as
 * a different component from the two beside it. The tint carries the state on
 * its own, at the same weight as an unlit card.
 */
export function toolLit(tool: Tool): {
  card: CSSProperties
  fill: CSSProperties
  chip: CSSProperties
} {
  const [near] = tool.tint
  return {
    // lighting the card starts with lighting its hairline, which is this
    card: { background: `rgba(${near}, 0.5)` },
    fill: {
      // the hot spot rides above the standard wash, turned up a quarter
      background: [
        `radial-gradient(75% 62% at 16% 0%, rgba(${near}, 0.22), transparent 66%)`,
        toolWash(tool, 1.25),
      ].join(', '),
      // a top highlight is what actually sells "lit from above"
      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.09)',
    },
    // the chip stops being a grey inset and becomes the brightest thing on the card
    chip: {
      background: `rgba(${near}, 0.3)`,
      boxShadow: `inset 0 0 0 1px rgba(${near}, 0.45)`,
    },
  }
}
