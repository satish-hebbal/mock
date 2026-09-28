/**
 * The app, below the tablet breakpoint.
 *
 * Every tool has a phone layout of its own rather than the desktop one folded
 * down, built on the shell in `MobileShell.tsx`: the work on top, the controls
 * at the thumb. Studio, Shots, Signal and ASCII are a picture with a sheet of
 * adjustments under it; Invoice is a form with a preview; Draw is the whole
 * page with a dock of tools.
 *
 * Like the old phone door this sits above the desktop editor rather than
 * inside it, so none of the desktop's hooks run here: no keyboard shortcuts,
 * no desktop panels, and each tool hydrates only when it is opened.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useStudio, type AppMode } from '../../store'
import { TouchUI } from '../../lib/touch'
import { modeFromLocation, writeMode } from '../../lib/routes'
import { TOOLS, toolGlow, toolTint } from '../../lib/tools'
import { seam } from '../../lib/interlock'
import { UILayer } from '../ui'
import { Mascot } from '../Mascot'
import { SiteMark } from '../ToolRail'
import { ToolAurora } from '../ToolAurora'
import { PondBackground, PondWeather } from '../PondBackground'
import type { EnvName } from '../../pond/environments'
import { SignalMobile } from '../../signal/SignalMobile'
import { AsciiMobile } from '../../ascii/AsciiMobile'
import { InvoiceMobile } from '../../invoice/InvoiceMobile'
import { ShotsMobile } from '../../shots/ShotsMobile'
import { DrawMobile } from '../../draw/DrawMobile'
import { StudioMobile } from './StudioMobile'

const ON_PHONE: AppMode[] = ['signal', 'ascii', 'invoice', 'shots', 'draw', 'studio']

/**
 * The Studio and Shots seam at phone size: the desktop's outline with a
 * shorter step, since a phone card is half the width of a desktop one and a
 * full step would take a fifth of its text column.
 */
const PHONE_SEAM = seam({ gutter: 12, step: 20, radius: 16, pad: 16 })

/**
 * The launcher, on a phone: the desktop's pond, reshaped for a tall screen.
 *
 * The same live water (koi, frogs, lily pads, weather) in the same rounded
 * frame, and the same shore: the engine measures the cards and raises the page
 * up round them, so two columns of three get a shore cut to their shape just as
 * the desktop's single row does, with the same interlocked pair at its head.
 *
 * It is one screen and never scrolls. The shore is drawn from where the cards
 * are, so a page that scrolled would drag the whole landscape up and down under
 * the thumb; everything is sized from the screen's height instead, and the
 * water takes whatever the cards and the foot leave. On a short phone that is
 * a strip of pond; on a tall one it is a picture.
 *
 * The frog sits on the water top left, level with the weather in the other
 * corner, and a tap anywhere on the pond does what a click does on the
 * desktop: pads dip, koi scatter, frogs jump.
 */
function MobileHome() {
  const theme = useStudio((s) => s.theme)
  const setMode = useStudio((s) => s.setMode)
  const tools = TOOLS.filter((t) => ON_PHONE.includes(t.id) && !t.soon)
  const contentRef = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<{ env: EnvName; theme: string } | null>(null)
  const env: EnvName = picked && picked.theme === theme ? picked.env : theme === 'light' ? 'midday' : 'overcast'

  return (
    <div className="h-full px-2 pt-[calc(env(safe-area-inset-top)+8px)] pb-[calc(env(safe-area-inset-bottom)+8px)]">
      <div className="home-pond relative h-full overflow-hidden rounded-2xl">
        <PondBackground contentRef={contentRef} env={env} light={theme === 'light'} />

        {/* the side inset leaves a strip of water down both sides of the cards,
            the way the desktop's row has water past both ends */}
        <div ref={contentRef} className="relative flex h-full flex-col overflow-hidden px-7 pb-3">
          {/* open water: whatever height the cards and the foot leave */}
          <div className="min-h-24 flex-1" />

          <div className="tool-row grid shrink-0 grid-cols-2 gap-3" style={PHONE_SEAM.row}>
            {tools.map((t, i) => (
              <button
                key={t.id}
                onClick={() => setMode(t.id)}
                style={{
                  ...PHONE_SEAM.parts[i]?.style,
                  ...toolTint(t),
                  ...toolGlow(0.62),
                  height: 'clamp(96px, 14.5dvh, 124px)',
                }}
                className={`tool-card m-press flex flex-col items-start justify-between p-4 text-left ${
                  PHONE_SEAM.parts[i]?.className ?? ''
                }`}
              >
                <span className="tool-card-fill">
                  <ToolAurora tool={t} />
                </span>
                <t.icon className="tool-card-icon" size={20} strokeWidth={1.75} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="t-body font-semibold text-(--tx)">{t.name}</span>
                    {t.beta && <span className="tool-card-chip">Beta</span>}
                  </div>
                  <p className="mt-0.5 truncate t-caption leading-snug text-(--tool-copy)">{t.tagline}</p>
                </div>
              </button>
            ))}
          </div>

          {/* the foot, on the shore: one quiet line and the theme */}
          {/* three columns, so the mark sits dead centre whatever the two
              sides measure */}
          <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center pt-3">
            <p className="min-w-0 truncate justify-self-start t-caption text-(--tx3)">
              <span className="font-semibold text-(--tx2)">Ribbit</span>
              <span className="mx-1.5">·</span>
              <span className="tabular-nums">v{__APP_VERSION__}</span>
            </p>
            {/* the one link that leaves for the web, as at the foot of the desktop rail */}
            <a
              href="https://www.satishhebbal.design/about"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Built by Satish Hebbal, opens satishhebbal.design"
              className="m-press flex h-9 w-9 justify-self-center shrink-0 items-center justify-center rounded-full text-(--tx3) active:bg-(--panel3) active:text-(--tx)"
            >
              <SiteMark size={17} />
            </a>
            {/* the theme as two glyphs with a thumb that slides between them */}
            <div
              role="radiogroup"
              aria-label="Theme"
              className="relative flex shrink-0 items-center justify-self-end rounded-full bg-(--field) p-0.5"
            >
              <span
                aria-hidden
                className="absolute top-0.5 left-0.5 h-8 w-8 rounded-full bg-(--sel) transition-transform duration-300 ease-settle"
                style={{ transform: theme === 'dark' ? 'translateX(100%)' : undefined }}
              />
              {(['light', 'dark'] as const).map((t) => {
                const Icon = t === 'light' ? Sun : Moon
                return (
                  <button
                    key={t}
                    role="radio"
                    aria-checked={theme === t}
                    aria-label={t === 'light' ? 'Light theme' : 'Dark theme'}
                    onClick={() => useStudio.getState().setTheme(t)}
                    className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                      theme === t ? 'text-(--tx)' : 'text-(--tx3)'
                    }`}
                  >
                    <Icon size={15} strokeWidth={1.9} />
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* the frog on the water, level with the weather in the other corner */}
        <div className="pond-mark absolute top-2.5 left-2.5 z-1">
          <Mascot size={30} awaken="contact" />
        </div>
        <PondWeather value={env} onChange={(next) => setPicked({ env: next, theme })} />
      </div>
    </div>
  )
}

export function MobileApp() {
  const theme = useStudio((s) => s.theme)
  const mode = useStudio((s) => s.mode)

  /*
   * The two things the phone needs from the studio's hydrate, without the
   * rest of it (the 3D project and its media): the theme, and which tool to
   * open. A link wins over the last session, as on the desktop.
   */
  useLayoutEffect(() => {
    const t = localStorage.getItem('ms-theme') === 'light' ? 'light' : 'dark'
    const saved = localStorage.getItem('ms-mode') as AppMode | null
    const linked = modeFromLocation()
    const next: AppMode =
      linked && linked !== 'home' ? linked : saved && ON_PHONE.includes(saved) ? saved : 'home'
    writeMode(next, true)
    useStudio.setState({ theme: t, mode: next })
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  useEffect(() => {
    const onPop = () => useStudio.setState({ mode: modeFromLocation() ?? 'home' })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return (
    <TouchUI value>
      <div className="m-app h-full bg-(--panel2) text-(--tx)">
        {mode === 'signal' ? (
          <SignalMobile />
        ) : mode === 'ascii' ? (
          <AsciiMobile />
        ) : mode === 'invoice' ? (
          <InvoiceMobile />
        ) : mode === 'shots' ? (
          <ShotsMobile />
        ) : mode === 'draw' ? (
          <DrawMobile />
        ) : mode === 'studio' ? (
          <StudioMobile />
        ) : (
          <MobileHome />
        )}
        <UILayer />
      </div>
    </TouchUI>
  )
}
