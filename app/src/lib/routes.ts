import type { AppMode } from '../store'

/**
 * One path per tool, so a link can name the tool it opens.
 *
 * The app is five tools behind one shell, and until now the only way to point
 * someone at Draw was "open the app, then pick Draw from the menu". A mode is
 * already the one piece of state that decides what the whole window is, which
 * makes it the one piece of state that belongs in the address bar: /draw is
 * Draw, /ascii is ASCII, and the launcher keeps the root.
 *
 * This is deliberately not a router. There is one level, no params and no
 * nesting, so the whole thing is a lookup in both directions plus a
 * `pushState`, and pulling in a routing library to hold six strings would be
 * more moving parts than the feature has.
 */
const PATH_BY_MODE: Record<AppMode, string> = {
  home: '/',
  studio: '/studio',
  shots: '/shots',
  draw: '/draw',
  ascii: '/ascii',
  signal: '/signal',
}

const MODE_BY_PATH = new Map<string, AppMode>(
  Object.entries(PATH_BY_MODE).map(([mode, path]) => [path, mode as AppMode]),
)

/** Where `mode` lives. */
export function pathForMode(mode: AppMode): string {
  return PATH_BY_MODE[mode]
}

/**
 * The mode a path names, or null if it names nothing we have.
 *
 * Shared links get retyped, wrapped by chat clients and pasted with a trailing
 * slash, so '/Draw/' has to land on Draw rather than on a blank screen.
 */
export function modeForPath(pathname: string): AppMode | null {
  const clean = pathname.toLowerCase().replace(/\/+$/, '') || '/'
  return MODE_BY_PATH.get(clean) ?? null
}

/** The mode the current URL names, or null. */
export function modeFromLocation(): AppMode | null {
  return modeForPath(window.location.pathname)
}

/**
 * Point the address bar at `mode`.
 *
 * The no-op guard is what keeps the loop from closing on itself: going back
 * fires `popstate`, which sets the mode, which lands back here with the URL
 * already correct, and without the check that would push a duplicate entry and
 * make Back stop working.
 *
 * `replace` is for the first load, where the URL is being corrected rather than
 * navigated: landing on / and being restored into Draw should leave one entry
 * in the history, not a phantom launcher visit sitting behind it.
 */
export function writeMode(mode: AppMode, replace = false) {
  const path = pathForMode(mode)
  const here = window.location.pathname.replace(/\/+$/, '') || '/'
  if (!replace && here === path) return
  const url = path + window.location.search + window.location.hash
  if (replace) window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)
}
