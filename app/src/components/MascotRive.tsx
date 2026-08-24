import { useEffect } from 'react'
import {
  Alignment,
  Fit,
  Layout,
  RuntimeLoader,
  useRive,
  useStateMachineInput,
} from '@rive-app/react-canvas'
import riveWasmUrl from '@rive-app/canvas/rive.wasm?url'
import tod from '../assets/tod-b.riv'

/*
 * Rive's runtime defaults to pulling its 1.8MB wasm from unpkg, with jsdelivr as
 * a fallback. Ribbit installs a service worker and is expected to work offline,
 * so both are pointed at the copy Vite emits from node_modules instead: same
 * bytes, versioned with the package, no third party in the critical path.
 *
 * Module scope on purpose: the loader is a singleton and this file is only
 * reached through the lazy import in <Mascot />, so it runs once, right before
 * the first instance is constructed.
 */
RuntimeLoader.setWasmUrl(riveWasmUrl)
RuntimeLoader.setWasmFallbackUrl(null)

/*
 * Authored names inside tod.riv. The state machine holds two looping timelines,
 * idle and PET, and `isHovered` is the boolean that moves between them. The
 * pointer does not start an animation here, it just reports where it is and
 * lets the machine decide. Rename either of these in the editor and the hover
 * silently stops working, since a missing input resolves to null rather than
 * throwing.
 */
const STATE_MACHINE = 'State Machine 1'
const HOVER_INPUT = 'isHovered'

interface Props {
  /** Pointer is on the frog: hovering it, or held down on a touch screen. */
  petting: boolean
  /** Fired once the artboard is loaded, so the still frog can hand over. */
  onReady: () => void
}

/*
 * The moving half of <Mascot />. Split into its own module so the ~400KB of
 * runtime plus the wasm land in a chunk of their own rather than the entry
 * bundle; the home screen paints the SVG immediately and this arrives after.
 */
export default function MascotRive({ petting, onReady }: Props) {
  const { rive, RiveComponent } = useRive({
    src: tod,
    stateMachines: STATE_MACHINE,
    autoplay: true,
    // The file carries a view model. Binding its default instance is what the
    // Rive editor does when previewing, so this matches how the art was authored.
    autoBind: true,
    // The hover is driven from React against the input below rather than from
    // listeners baked into the file, so the hit area stays the layout box the
    // rest of the page can see, since the canvas is drawn wider than that.
    shouldDisableRiveListeners: true,
    enableRiveAssetCDN: false,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    onLoad: onReady,
  })

  const isHovered = useStateMachineInput(rive, STATE_MACHINE, HOVER_INPUT, false)

  /*
   * Written in an effect rather than straight from the pointer handler because
   * the input only exists once the file has loaded. Someone who is already
   * hovering when the chunk lands gets the pet on arrival instead of having to
   * move the mouse out and back.
   */
  useEffect(() => {
    if (isHovered) isHovered.value = petting
  }, [isHovered, petting])

  return <RiveComponent className="h-full w-full" aria-hidden="true" />
}
