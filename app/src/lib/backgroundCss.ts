import type { CSSProperties } from 'react'
import { meshCss } from './meshGradient'
import { getWallpaper, gradientCss } from './wallpapers'
import { getPresetPhoto } from './presetPhotos'
import { rgba } from './color'
import { ALPHA_CHECKER } from './checker'
import type { BackgroundState } from '../types'

/*
 * CSS for a Studio backdrop.
 *
 * The live viewport paints the scene through this, and the exporter repaints
 * the same thing onto a canvas, so anything else that wants a faithful
 * miniature of the current backdrop can share it rather than approximating.
 * The frame-ratio previews do exactly that: each candidate shape is filled
 * with the backdrop you are actually going to export, which is what makes
 * them worth looking at instead of empty outlines.
 */
export function cssBackground(bg: BackgroundState, imageUrl: string | null): CSSProperties {
  switch (bg.type) {
    case 'solid':
      return { background: bg.color }
    case 'gradient':
      return {
        background:
          bg.gradient.kind === 'radial'
            ? `radial-gradient(circle at 50% 50%, ${bg.gradient.from}, ${bg.gradient.to})`
            : `linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.from}, ${bg.gradient.to})`,
      }
    case 'wallpaper':
      return { background: gradientCss(getWallpaper(bg.wallpaperId).gradient) }
    case 'mesh':
      return meshCss(bg.mesh)
    case 'photo': {
      const photo = getPresetPhoto(bg.photoId)
      return photo
        ? { backgroundImage: `url(${photo.src})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: '#111' }
    }
    case 'studio': {
      // Painted in the same order as the export canvas: paper, then the pool of
      // light the key throws on it, the floor falloff, and the corner hold.
      const s = bg.sweep
      const hotW = Math.round(s.spread * 200)
      const hotH = Math.round(s.spread * 150)
      return {
        backgroundColor: s.color,
        backgroundImage: [
          `radial-gradient(120% 105% at 50% ${s.hotY * 100}%, ${rgba('#000000', 0)} 42%, ${rgba('#000000', s.vignette)} 100%)`,
          `linear-gradient(to bottom, ${rgba('#000000', 0)} 46%, ${rgba('#000000', s.floor)} 100%)`,
          `radial-gradient(${hotW}% ${hotH}% at 50% ${s.hotY * 100}%, ${s.hot} 0%, ${rgba(s.hot, 0)} 70%)`,
        ].join(','),
      }
    }
    case 'image':
      return imageUrl
        ? { backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: '#111' }
    case 'transparent':
      return ALPHA_CHECKER
  }
}
