import { createContext, useContext } from 'react'

/**
 * Is this control being drawn for a finger?
 *
 * The panel kit in `controls.tsx` was sized for a pointer: 28px rows, a 24px
 * chevron, a slider you scrub with the mouse's relative motion. A fingertip is
 * about 44px across and has no hover, so the phone shell provides this as true
 * and each primitive answers with its touch size and touch behaviour. The
 * desktop editor provides nothing, gets the default, and is left exactly as it
 * was.
 *
 * A context rather than a media query, because the question is not what the
 * device is (a touchscreen laptop still wants the desktop panels) but which
 * layout the control is in.
 */
export const TouchUI = createContext(false)

export const useTouchUI = () => useContext(TouchUI)

/**
 * A section that is the whole of a sheet already titled with its name.
 *
 * "Looks" over a fold headed "Looks" is one heading too many, and a fold is
 * pointless when it is the only thing on the page, so inside this the section
 * drops its header and shows its body, keeping any header controls it had.
 */
export const BareSections = createContext(false)

/**
 * Where a bare section's header controls go: the sheet's own header, beside
 * its title, rather than a row of their own above the content.
 */
export const SheetActions = createContext<HTMLElement | null>(null)
