import type { CSSProperties } from 'react'
import { getWallpaper, gradientCss } from './wallpapers'
import { getPresetPhoto } from './presetPhotos'
import { meshCss } from '../lib/meshGradient'
import { ALPHA_CHECKER } from '../lib/checker'
import type { ShotsBackground } from './types'

/**
 * CSS for a background, shared by the live preview (ShotsCanvas) and any
 * other spot that wants a faithful swatch of it — e.g. the aspect-ratio
 * picker, whose previews are painted in whatever background is active rather
 * than a flat placeholder.
 */
export function bgCss(bg: ShotsBackground, imageUrl: string | null): CSSProperties {
  switch (bg.type) {
    case 'transparent':
      return ALPHA_CHECKER
    case 'solid':
      return { background: bg.color }
    case 'gradient':
      return { background: gradientCss(bg.gradient) }
    case 'wallpaper':
      return { background: gradientCss(getWallpaper(bg.wallpaperId).gradient) }
    case 'photo': {
      const photo = getPresetPhoto(bg.photoId)
      return photo
        ? { backgroundImage: `url(${photo.src})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: '#15151b' }
    }
    case 'mesh':
      return meshCss(bg.mesh)
    case 'image':
      return imageUrl
        ? { backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: '#15151b' }
  }
}
