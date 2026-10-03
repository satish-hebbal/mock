import { useEffect, useRef, type RefObject } from 'react'
import { Cloud, CloudRain, Sun, Sunset, type LucideIcon } from 'lucide-react'
import type { EnvName } from '../pond/environments'
import type { Pond } from '../pond/engine'
import { useStudio } from '../store'

/**
 * The live pond behind the home page.
 *
 * The engine (src/pond) is loaded with a dynamic import, so it arrives as its own chunk after the
 * page has painted and costs the first render nothing. It is created when the home page mounts and
 * disposed when it unmounts, which is what opening a tool does, so no frame loop runs and no GPU
 * memory is held while a tool is on screen.
 *
 * The SVG is the shore: a solid shape in the page colour that the engine draws around the card row,
 * with a thin steel rim along its edge. It sits over the canvas so its edge stays crisp however low
 * the pond's render scale goes.
 */
export function PondBackground({ contentRef, env, light }: { contentRef: RefObject<HTMLElement | null>; env: EnvName; light: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fillRef = useRef<SVGPathElement>(null)
  const rimBaseRef = useRef<SVGPathElement>(null)
  const rimRef = useRef<SVGPathElement>(null)
  const rimGlintRef = useRef<SVGPathElement>(null)
  const glintRef = useRef<SVGLinearGradientElement>(null)
  const pondRef = useRef<Pond | null>(null)
  // what the pond should start with, whenever the engine finishes loading
  const latest = useRef({ env, light })
  useEffect(() => {
    latest.current = { env, light }
  })

  useEffect(() => {
    let cancelled = false
    import('../pond/engine').then(({ createPond }) => {
      const host = hostRef.current
      const canvas = canvasRef.current
      const content = contentRef.current
      if (cancelled || !host || !canvas || !content) return
      pondRef.current = createPond(
        {
          host,
          canvas,
          content,
          shoreFill: fillRef.current!,
          shoreRims: [rimBaseRef.current!, rimRef.current!, rimGlintRef.current!],
          shoreGlint: glintRef.current!,
        },
        latest.current,
      )
      pondRef.current.setPaused(useStudio.getState().sheetCovering)
    })
    return () => {
      cancelled = true
      pondRef.current?.dispose()
      pondRef.current = null
    }
  }, [contentRef])

  useEffect(() => pondRef.current?.setEnvironment(env), [env])
  useEffect(() => pondRef.current?.setLight(light), [light])
  // the app menu blurs the pond; see `setPaused`
  const covered = useStudio((s) => s.sheetCovering)
  useEffect(() => pondRef.current?.setPaused(covered), [covered])

  return (
    <div ref={hostRef} className="pond-host" aria-hidden="true">
      <canvas ref={canvasRef} className="pond-canvas" />
      <svg className="pond-shore">
        <defs>
          {/* matte brushed steel: low contrast grey bands along the rim's length */}
          <linearGradient id="pond-steel" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#3b3f44" />
            <stop offset="0.15" stopColor="#5c6167" />
            <stop offset="0.3" stopColor="#44484d" />
            <stop offset="0.45" stopColor="#666b71" />
            <stop offset="0.6" stopColor="#474b50" />
            <stop offset="0.75" stopColor="#5e6369" />
            <stop offset="0.9" stopColor="#42464b" />
            <stop offset="1" stopColor="#3b3f44" />
          </linearGradient>
          {/* a faint sheen the engine slides along the rim under the pointer */}
          <linearGradient ref={glintRef} id="pond-glint" gradientUnits="userSpaceOnUse" x1="-440" x2="0" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.28" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path ref={fillRef} className="pond-shore-fill" />
        <path ref={rimBaseRef} className="pond-rim-base" />
        <path ref={rimRef} className="pond-rim" />
        <path ref={rimGlintRef} className="pond-rim-glint" />
      </svg>
    </div>
  )
}

const WEATHER: { name: EnvName; label: string; icon: LucideIcon }[] = [
  { name: 'overcast', label: 'Overcast', icon: Cloud },
  { name: 'rain', label: 'Rain', icon: CloudRain },
  { name: 'sunset', label: 'Sunset', icon: Sunset },
  { name: 'midday', label: 'Midday', icon: Sun },
]

/** The pond's weather, four small glyphs in its top right corner. */
export function PondWeather({ value, onChange }: { value: EnvName; onChange: (env: EnvName) => void }) {
  return (
    <div className="pond-weather" role="radiogroup" aria-label="Pond weather">
      {WEATHER.map((w) => (
        <button
          key={w.name}
          role="radio"
          aria-checked={w.name === value}
          aria-label={w.label}
          title={w.label}
          onClick={() => onChange(w.name)}
        >
          <w.icon size={14} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  )
}
