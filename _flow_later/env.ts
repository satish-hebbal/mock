/**
 * The environment a graph is drawn in: Studio's picture and document size, the
 * pictures Image nodes brought with them, and the width to draw at.
 */

import { useAscii } from '../store'
import type { EvalEnv } from './evaluate'
import { flowAssets } from './store'

/** The env a graph is drawn in at a given width. */
export function envFor(w: number, quality: EvalEnv['quality']): EvalEnv {
  const a = useAscii.getState()
  const docW = a.doc.size.width || 1600
  const docH = a.doc.size.height || 1200
  return {
    studio: a.bitmap,
    assets: flowAssets,
    docW,
    docH,
    w: Math.round(w),
    h: Math.round((w * docH) / docW),
    quality,
  }
}

