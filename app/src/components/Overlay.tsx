import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CircleMinus } from 'lucide-react'

/*
 * The shell every modal surface in the app sits in.
 *
 * Seven dialogs had independently written the same root div, and had
 * independently arrived at the same three gaps.
 *
 * They appeared and vanished instantly. A dialog is the largest state change
 * the app makes: it covers the work, takes the keyboard, and blocks everything
 * behind it. Arriving in a single frame gives the eye nothing to follow, so the
 * canvas you were looking at is simply replaced by a panel and you have to
 * re-find yourself. A scrim that fades and a panel that comes up a few pixels
 * costs 190ms and answers "where did this come from" before it is asked.
 *
 * Escape was bound to the panel element, so it worked only while focus happened
 * to be inside. Click the scrim once, or a non-focusable heading, and the key
 * silently stopped working. It belongs on the document.
 *
 * And Tab walked straight out of the dialog into the editor behind it, where it
 * would happily focus tools that are covered by a scrim and cannot be seen. For
 * a keyboard user that is not a rough edge, it is a lost dialog.
 *
 * All three are fixed once, here.
 */

/** Deferred close, so a dismissal from inside the panel still plays the exit. */
const OverlayContext = createContext<(() => void) | null>(null)

/**
 * The standard titled dialog: scrim, panel, heading, close button.
 *
 * Five files had written this same panel out by hand, which is why five of them
 * had drifted into five slightly different sets of the same bugs. It is one
 * component now, so the next fix lands everywhere at once.
 */
export function Dialog({
  title,
  onClose,
  children,
  wide,
  aside,
  z,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  /** the wider column, for content that needs two of something side by side */
  wide?: boolean
  /** small note rendered next to the title (e.g. the key that toggles it) */
  aside?: ReactNode
  z?: number
}) {
  return (
    <Scrim onClose={onClose} z={z} label={title}>
      <DialogPanel title={title} wide={wide} aside={aside}>
        {children}
      </DialogPanel>
    </Scrim>
  )
}

/*
 * Separate from Dialog because the close button needs the *deferred* close from
 * the Scrim, and a component cannot consume a context it renders the provider
 * for.
 */
function DialogPanel({
  title,
  wide,
  aside,
  children,
}: {
  title: string
  wide?: boolean
  aside?: ReactNode
  children: ReactNode
}) {
  const close = useOverlayClose()
  return (
    <div
      className={`max-h-[85vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto rounded-xl border border-(--line) bg-(--raised) p-5`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="t-eyebrow text-(--tx) uppercase">{title}</h2>
          {aside}
        </div>
        <button
          onClick={close}
          aria-label="Close"
          title="Close"
          className="flex h-7 w-7 items-center justify-center rounded-full text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
        >
          <CircleMinus size={18} strokeWidth={1.75} />
        </button>
      </div>
      {children}
    </div>
  )
}

/**
 * Dismiss the enclosing overlay, animating out first.
 *
 * Anything inside a <Scrim> that closes it (a Cancel button, a title-bar X)
 * should call this rather than the `onClose` it was handed, or the panel is
 * torn out of the DOM mid-frame and the exit animation never runs.
 *
 * Deliberately not exported: a file that exports both components and a hook
 * loses fast refresh. Callers outside this file take the same function from the
 * render-prop form of <Scrim>, which is the same value by another route.
 */
function useOverlayClose(): () => void {
  const close = useContext(OverlayContext)
  if (!close) throw new Error('useOverlayClose must be called inside a <Scrim>')
  return close
}

/*
 * A stack, because dialogs do open on top of dialogs: the export dialog can
 * raise a confirm. Escape has to reach the topmost one only, otherwise a single
 * press closes the whole pile and takes the user somewhere they never asked to
 * go. Registration order is mount order, so the last entry is the top.
 */
const stack: Array<() => void> = []

/** How long the exit runs. Kept in step with `.overlay-panel[data-closing]`. */
const EXIT_MS = 130

const focusable =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function Scrim({
  onClose,
  z = 40,
  label,
  children,
  dismissible = true,
}: {
  onClose: () => void
  /** Matches the z-index the dialog already used, so stacking is unchanged. */
  z?: number
  /** Accessible name, when the panel has no visible heading to point at. */
  label?: string
  /**
   * A node, or a function handed the deferred close.
   *
   * The function form exists so a panel with its own close button does not have
   * to be split into a second component purely to reach `useOverlayClose`. Both
   * forms end up in the same place; use whichever keeps the caller readable.
   */
  children: ReactNode | ((close: () => void) => ReactNode)
  /**
   * False while the dialog is doing something it cannot abandon halfway.
   * Escape and the scrim stop responding; the panel's own buttons are left to
   * decide for themselves, since "Cancel" may well still be meaningful.
   */
  dismissible?: boolean
}) {
  const [closing, setClosing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const timer = useRef(0)
  /*
   * Captured in a layout effect rather than on mount-with-effect, because by
   * the time a passive effect runs React may already have moved focus into the
   * panel via an `autoFocus` prop, and we would then "restore" focus to the
   * dialog we are about to unmount.
   */
  const restoreTo = useRef<Element | null>(null)
  useLayoutEffect(() => {
    restoreTo.current = document.activeElement
  }, [])

  /*
   * `onClose` is read through a ref, and `closing` is tracked in one alongside
   * the state.
   *
   * Both exist so that `close` can be identity-stable. The Escape listener below
   * is registered once, for the life of the overlay, and a `close` rebuilt every
   * render would leave that listener holding the very first one: pressing Escape
   * would then settle the dialog with whatever its props were at mount, which
   * for a prompt means resolving with the empty string the user has since typed
   * over. The state copy still exists because rendering needs it; the ref is
   * what the callback reads.
   */
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const closingRef = useRef(false)
  /* read through a ref for the same reason `onClose` is: the Escape listener
     outlives any single render, and the guard changes mid-dialog */
  const dismissibleRef = useRef(dismissible)
  useEffect(() => {
    dismissibleRef.current = dismissible
  })

  const close = useCallback(() => {
    if (closingRef.current) return // a second Escape while leaving must not queue a second close
    closingRef.current = true
    setClosing(true)
    /*
     * Reduced motion still goes through the deferral, just without the wait.
     * Calling `onClose` directly here would be a second code path with its own
     * bugs, for the sake of 130ms.
     */
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    timer.current = window.setTimeout(() => onCloseRef.current(), reduced ? 0 : EXIT_MS)
  }, [])

  /* Escape, from anywhere, for the topmost overlay only. */
  useEffect(() => {
    const entry = () => {
      if (dismissibleRef.current) close()
    }
    stack.push(entry)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (stack[stack.length - 1] !== entry) return
      /*
       * Stopped, not just handled. The editor binds Escape globally to clear
       * the selection, and without this a single press both closed the dialog
       * and wiped what the user had selected underneath it.
       */
      e.preventDefault()
      e.stopPropagation()
      entry()
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      stack.splice(stack.indexOf(entry), 1)
      window.clearTimeout(timer.current)
    }
  }, [close])

  /* Focus in on arrival, and back where it came from on the way out. */
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    /*
     * Only take focus if the panel has not already claimed it. Several of these
     * dialogs autofocus a text field, and that is a better target than the
     * container: stealing it back would put the caret nowhere.
     */
    if (!panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(focusable)
      ;(first ?? panel).focus()
    }
    return () => {
      const back = restoreTo.current
      if (back instanceof HTMLElement && document.contains(back)) back.focus()
    }
  }, [])

  /* Tab cycles inside the panel instead of escaping into the covered editor. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const items = [...panel.querySelectorAll<HTMLElement>(focusable)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    )
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    /*
     * `document.activeElement` rather than `e.target`, because the event may
     * have bubbled from a child of the focused element.
     */
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <OverlayContext.Provider value={close}>
      <div
        className="overlay-scrim fixed inset-0 flex items-center justify-center bg-black/60 p-6"
        style={{ zIndex: z }}
        data-closing={closing || undefined}
        /*
         * `mousedown`, not `click`. With `click`, a drag that starts inside the
         * panel (selecting the text of a filename, dragging a slider to the
         * edge) and finishes over the scrim counts as a click on the scrim, and
         * the dialog closes underneath the user's hand mid-gesture.
         */
        onMouseDown={dismissible ? close : undefined}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className="overlay-panel contents outline-none"
          data-closing={closing || undefined}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      </div>
    </OverlayContext.Provider>
  )
}
