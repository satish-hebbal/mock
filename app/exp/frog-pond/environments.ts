// The four kinds of weather. Everything that makes the pond look like a time of day lives here, and
// switching blends every number from one set to the next, so the light drifts rather than cuts.

export type EnvName = 'overcast' | 'rain' | 'sunset' | 'midday'

export type Env = {
  ambient: number[] // fill light from the whole sky
  key: number[] // colour and strength of the moon or sun
  lightDir: number[] // toward the moon or sun: x right, y down, z up out of the water
  water: number[] // colour the water column adds over the bed
  clarity: number // how much of the bed shows through
  causticGain: number
  shadowStrength: number
  softness: number // how blurred shadows cast by the page cards are: diffuse light blurs them
  exposure: number
  grade: number[] // rgb tint, then saturation
  sky: number[] // sky reflected on the side toward the light
  sky2: number[] // and on the far side
  glow: number[] // the moon or sun reflection: x, y as fractions of the pond, radius in design px
  glowColor: number[]
  glowStrength: number
  glitter: number // sparks off ripples facing the sun
  ringShine: number // how strongly ripple crests catch the sky
  haze: number[] // warm air on the sun's side
  fireflies: number
  edgeDark: number
  focusDark: number // dimming behind the page content
  rain: number // 0 dry .. 1 pouring
  croak: number // how chatty the frogs are
}

export const ENV_NAMES: EnvName[] = ['overcast', 'rain', 'sunset', 'midday']

export const ENVIRONMENTS: Record<EnvName, Env> = {
  // heavy grey sky, the moon a smudge behind cloud: the calm before the rain
  overcast: {
    ambient: [0.02, 0.045, 0.055],
    key: [0.36, 0.44, 0.58],
    lightDir: [0.5, -0.55, 0.67],
    water: [0.004, 0.012, 0.015],
    clarity: 0.75,
    causticGain: 1,
    shadowStrength: 1,
    softness: 1.3,
    exposure: 1.5,
    grade: [0.92, 1, 1.08, 0.72],
    sky: [0.006, 0.01, 0.016],
    sky2: [0.006, 0.01, 0.016],
    glow: [0.82, 0.2, 80],
    glowColor: [0.62, 0.72, 0.85],
    glowStrength: 1,
    glitter: 0,
    ringShine: 0.9,
    haze: [0, 0, 0],
    fireflies: 1,
    edgeDark: 0.6,
    focusDark: 0.35,
    rain: 0,
    croak: 1,
  },
  // the cloud has opened: flat light, murky water, the surface pocked with drops, frogs delighted
  rain: {
    ambient: [0.03, 0.045, 0.055],
    key: [0.16, 0.2, 0.26],
    lightDir: [0.3, -0.3, 0.9],
    water: [0.006, 0.013, 0.016],
    clarity: 0.55,
    causticGain: 0.4,
    shadowStrength: 0.35,
    softness: 2.2,
    exposure: 1.55,
    grade: [0.9, 1, 1.1, 0.6],
    sky: [0.016, 0.02, 0.026],
    sky2: [0.016, 0.02, 0.026],
    glow: [0.5, 0.3, 300],
    glowColor: [0.5, 0.55, 0.6],
    glowStrength: 0.15,
    glitter: 0,
    ringShine: 1.2,
    haze: [0.004, 0.006, 0.008],
    fireflies: 0,
    edgeDark: 0.65,
    focusDark: 0.35,
    rain: 1,
    croak: 3,
  },
  // a low sun off the left edge: long shadows to the right, warm light, a violet sky behind
  sunset: {
    ambient: [0.05, 0.03, 0.05],
    key: [1.1, 0.55, 0.22],
    lightDir: [-0.85, -0.15, 0.38],
    water: [0.012, 0.01, 0.012],
    clarity: 0.7,
    causticGain: 0.8,
    shadowStrength: 0.9,
    softness: 1,
    exposure: 1.35,
    grade: [1.08, 0.96, 0.86, 1],
    sky: [0.09, 0.04, 0.015],
    sky2: [0.02, 0.012, 0.03],
    glow: [0.04, 0.4, 300],
    glowColor: [1, 0.55, 0.22],
    glowStrength: 1.6,
    glitter: 0.8,
    ringShine: 0.8,
    haze: [0.06, 0.025, 0.008],
    fireflies: 0.35,
    edgeDark: 0.55,
    focusDark: 0.38,
    rain: 0,
    croak: 1.5,
  },
  // the sun nearly overhead: clear water down to the bed, crisp short shadows, glitter on every ripple
  midday: {
    ambient: [0.1, 0.14, 0.15],
    key: [1.25, 1.2, 1.05],
    lightDir: [0.22, -0.28, 0.93],
    water: [0.012, 0.03, 0.03],
    clarity: 1,
    causticGain: 1.2,
    shadowStrength: 1,
    softness: 0.7,
    exposure: 1.15,
    grade: [1, 1, 1, 1],
    sky: [0.05, 0.08, 0.11],
    sky2: [0.05, 0.08, 0.11],
    glow: [0.66, 0.28, 70],
    glowColor: [1, 0.97, 0.9],
    glowStrength: 1.2,
    glitter: 1,
    ringShine: 0.8,
    haze: [0, 0, 0],
    fireflies: 0,
    edgeDark: 0.3,
    focusDark: 0.45,
    rain: 0,
    croak: 0.7,
  },
}

const normalize = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

export function mixEnv(a: Env, b: Env, t: number): Env {
  const out = {} as Record<string, number | number[]>
  for (const key of Object.keys(a) as (keyof Env)[]) {
    const x = a[key]
    const y = b[key]
    out[key] = Array.isArray(x) ? x.map((v, i) => v + ((y as number[])[i] - v) * t) : x + ((y as number) - x) * t
  }
  const env = out as unknown as Env
  env.lightDir = normalize(env.lightDir)
  return env
}
