import { screenAspectFor, type DeviceSpec } from './registry'

/*
 * How big each kind of device is, in scene units.
 *
 * One table, three readers: the procedural slab meshes are built from it, the
 * .glb models are scaled to the same screen height (the `fitHeight` in
 * deviceModels.json is these numbers), and the camera stage draws its proxy
 * boxes from it. Anywhere the app has to answer "how much room does an iPhone
 * take up" it answers from here, so the schematic and the render agree.
 */

export interface Dims {
  screenW: number
  screenH: number
  screenR: number
  bodyW: number
  bodyH: number
  bodyR: number
  bodyD: number
  bevel: number
}

export function dimsFor(spec: DeviceSpec, orientation: 'portrait' | 'landscape'): Dims {
  const aspect = screenAspectFor(spec, orientation)
  switch (spec.kind) {
    case 'phone': {
      const short = 0.94
      const w = aspect < 1 ? short : short * aspect
      const h = aspect < 1 ? short / aspect : short
      // classic phones get chunky bezels along the long axis
      const extra = spec.mask === 'none' ? 0.3 : 0.075
      return {
        screenW: w,
        screenH: h,
        screenR: 0.11,
        bodyW: w + (aspect < 1 ? 0.07 : extra),
        bodyH: h + (aspect < 1 ? extra : 0.07),
        bodyR: 0.15,
        bodyD: 0.075,
        bevel: 0.012,
      }
    }
    case 'tablet': {
      const width = aspect < 1 ? 1.6 : 2.1
      const height = width / aspect
      return {
        screenW: width,
        screenH: height,
        screenR: 0.07,
        bodyW: width + 0.12,
        bodyH: height + 0.12,
        bodyR: 0.12,
        bodyD: 0.06,
        bevel: 0.01,
      }
    }
    case 'laptop': {
      const width = 2.7
      return {
        screenW: width,
        screenH: width / aspect,
        screenR: 0.03,
        bodyW: width + 0.16,
        bodyH: width / aspect + 0.14,
        bodyR: 0.08,
        bodyD: 0.045,
        bevel: 0.008,
      }
    }
    case 'monitor': {
      const width = 3.1
      return {
        screenW: width,
        screenH: width / aspect,
        screenR: 0.04,
        bodyW: width + 0.1,
        bodyH: width / aspect + 0.1,
        bodyR: 0.08,
        bodyD: 0.09,
        bevel: 0.012,
      }
    }
    case 'tv': {
      const width = 4.0
      return {
        screenW: width,
        screenH: width / aspect,
        screenR: 0.015,
        bodyW: width + 0.08,
        bodyH: width / aspect + 0.08,
        bodyR: 0.03,
        bodyD: 0.06,
        bevel: 0.008,
      }
    }
    case 'watch': {
      // round face (aspect ~1) gets a fully circular screen/body radius
      const round = Math.abs(aspect - 1) < 0.05
      return {
        screenW: 0.62,
        screenH: 0.62 / aspect,
        screenR: round ? 0.31 : 0.2,
        bodyW: 0.72,
        bodyH: 0.62 / aspect + 0.1,
        bodyR: round ? 0.36 : 0.26,
        bodyD: 0.1,
        bevel: 0.018,
      }
    }
    case 'browser': {
      const width = 3.2
      const contentH = width / aspect
      return {
        screenW: width - 0.06,
        screenH: contentH,
        screenR: 0.02,
        bodyW: width,
        bodyH: contentH + 0.24,
        bodyR: 0.07,
        bodyD: 0.03,
        bevel: 0.004,
      }
    }
    case 'card': {
      const width = 2.6
      return {
        screenW: width,
        screenH: width / aspect,
        screenR: 0.1,
        bodyW: width,
        bodyH: width / aspect,
        bodyR: 0.1,
        bodyD: 0.02,
        bevel: 0.003,
      }
    }
  }
}
