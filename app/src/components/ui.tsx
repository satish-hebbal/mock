import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleMinus, Info } from 'lucide-react'
import { closeRequest, useUI, type Request, type ToastKind } from '../lib/ui'

function RequestDialog({ request }: { request: Request }) {
  const [draft, setDraft] = useState(request.kind === 'prompt' ? (request.initial ?? '') : '')

  useEffect(() => {
    setDraft(request.kind === 'prompt' ? (request.initial ?? '') : '')
  }, [request])

  const cancel = () => closeRequest(request, request.kind === 'prompt' ? null : false)
  const accept = () => closeRequest(request, request.kind === 'prompt' ? draft.trim() : true)
  const danger = request.kind === 'confirm' && request.danger

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={cancel}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
          if (e.key === 'Enter' && request.kind === 'prompt' && draft.trim()) accept()
        }}
        className="w-full max-w-sm rounded-xl border border-(--line) bg-(--raised) p-5"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="t-body font-semibold text-(--tx)">{request.title}</h2>
          <button
            onClick={cancel}
            aria-label="Close"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-(--tx3) hover:bg-(--panel3) hover:text-(--tx)"
          >
            <CircleMinus size={16} strokeWidth={1.75} />
          </button>
        </div>

        {request.kind === 'prompt' ? (
          <>
            {request.label && <p className="mb-2 t-body-sm text-(--tx2)">{request.label}</p>}
            <input
              autoFocus
              value={draft}
              placeholder={request.placeholder}
              onChange={(e) => setDraft(e.target.value)}
              className="mb-4 w-full rounded-md bg-(--field) px-3 py-2 t-body-sm text-(--tx) outline-none placeholder:text-(--tx3) focus:ring-2 focus:ring-(--focus)"
            />
          </>
        ) : (
          request.body && <p className="mb-4 t-body-sm leading-relaxed text-(--tx2)">{request.body}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={cancel}
            className="rounded-md bg-(--field) px-3.5 py-2 t-button text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)"
          >
            Cancel
          </button>
          <button
            autoFocus={request.kind === 'confirm'}
            onClick={accept}
            disabled={request.kind === 'prompt' && draft.trim() === ''}
            className={`rounded-md px-3.5 py-2 t-button disabled:opacity-40 ${
              danger ? 'bg-(--danger) text-white' : 'bg-(--accent-fill) text-(--accent-tx)'
            } hover:opacity-90`}
          >
            {request.confirmLabel ?? (request.kind === 'prompt' ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

const TOAST_ICON: Record<ToastKind, typeof Info> = {
  info: Info,
  error: AlertTriangle,
  success: CheckCircle2,
}

/** Mount once, near the app root. */
export function UILayer() {
  const request = useUI((s) => s.request)
  const toasts = useUI((s) => s.toasts)

  return (
    <>
      {request && <RequestDialog request={request} />}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[70] flex flex-col items-end gap-2">
        {toasts.map((t) => {
          const Icon = TOAST_ICON[t.kind]
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg border px-3 py-2 t-body-sm ${
                t.kind === 'error'
                  ? 'border-(--danger) bg-(--raised) text-(--danger)'
                  : 'border-(--line) bg-(--raised) text-(--tx2)'
              }`}
            >
              {/*
                The glyph is centred inside a box exactly one line tall, which
                is what puts it on the text's optical centre instead of near
                it. Aligning the icon itself left it riding high — a 14px glyph
                at the top of a 21px line box sits 2.5px above the middle — and
                the `mt-px` that used to be here only closed a seventh of that.
                Deriving the box from `1lh` also means it stays right if the
                type scale ever moves, which a hand-tuned nudge would not.

                The row still starts at the top, so a message long enough to
                wrap keeps the icon beside its *first* line rather than
                drifting to the middle of the block.
              */}
              <span className="flex h-[1lh] shrink-0 items-center">
                <Icon size={14} className={t.kind === 'success' ? 'text-(--success)' : ''} />
              </span>
              <span>{t.message}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
