import { create } from 'zustand'

/*
 * In-app replacements for window.prompt / confirm / alert. Native dialogs block
 * the render loop, can't be themed, and leak the origin ("localhost:3000 says"),
 * so nothing in the app should call them — use `ui.prompt/confirm/toast` and let
 * <UILayer /> render the result.
 */

export type ToastKind = 'info' | 'error' | 'success'

export interface PromptRequest {
  kind: 'prompt'
  title: string
  label?: string
  placeholder?: string
  initial?: string
  confirmLabel?: string
  resolve: (value: string | null) => void
}

export interface ConfirmRequest {
  kind: 'confirm'
  title: string
  body?: string
  confirmLabel?: string
  danger?: boolean
  resolve: (value: boolean) => void
}

export type Request = PromptRequest | ConfirmRequest

export interface Toast {
  id: number
  message: string
  kind: ToastKind
}

interface UIState {
  request: Request | null
  toasts: Toast[]
  /**
   * Bumped once per quick snap. The canvas watches this and replays its shutter
   * sweep; a counter rather than a boolean so two snaps in a row each get their
   * own animation instead of the second being swallowed while the first is
   * still running.
   */
  snap: number
}

export const useUI = create<UIState>(() => ({ request: null, toasts: [], snap: 0 }))

let toastId = 0

/** Imperative API usable from anywhere, including non-React modules. */
export const ui = {
  prompt(opts: Omit<PromptRequest, 'kind' | 'resolve'>): Promise<string | null> {
    return new Promise((resolve) => {
      useUI.setState({ request: { kind: 'prompt', ...opts, resolve } })
    })
  },
  confirm(opts: Omit<ConfirmRequest, 'kind' | 'resolve'>): Promise<boolean> {
    return new Promise((resolve) => {
      useUI.setState({ request: { kind: 'confirm', ...opts, resolve } })
    })
  },
  toast(message: string, kind: ToastKind = 'info') {
    const id = ++toastId
    useUI.setState((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(
      () => useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      kind === 'error' ? 6000 : 3500,
    )
  },
  error(message: string) {
    ui.toast(message, 'error')
  },
  /** Play the capture sweep over whatever is currently framed. */
  snap() {
    useUI.setState((s) => ({ snap: s.snap + 1 }))
  },
}

/** Settle the open request and close it. */
export function closeRequest(request: Request, value: string | null | boolean) {
  useUI.setState({ request: null })
  if (request.kind === 'prompt') request.resolve(value as string | null)
  else request.resolve(value as boolean)
}
