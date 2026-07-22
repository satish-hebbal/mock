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
        className="w-full max-w-sm rounded-xl border border-(--line) bg-(--panel) p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-(--tx)">{request.title}</h2>
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
            {request.label && <p className="mb-2 text-[11px] text-(--tx2)">{request.label}</p>}
            <input
              autoFocus
              value={draft}
              placeholder={request.placeholder}
              onChange={(e) => setDraft(e.target.value)}
              className="mb-4 w-full rounded-[5px] bg-(--field) px-2.5 py-2 text-[12px] text-(--tx) outline-none placeholder:text-(--tx3) focus:ring-1 focus:ring-(--accent)"
            />
          </>
        ) : (
          request.body && <p className="mb-4 text-[12px] leading-relaxed text-(--tx2)">{request.body}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={cancel}
            className="rounded-[5px] bg-(--field) px-3 py-1.5 text-[11px] text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)"
          >
            Cancel
          </button>
          <button
            autoFocus={request.kind === 'confirm'}
            onClick={accept}
            disabled={request.kind === 'prompt' && draft.trim() === ''}
            className={`rounded-[5px] px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40 ${
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
              className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg border px-3 py-2 text-[12px] shadow-xl ${
                t.kind === 'error'
                  ? 'border-(--danger) bg-(--panel) text-(--danger)'
                  : 'border-(--line) bg-(--panel) text-(--tx2)'
              }`}
            >
              <Icon
                size={14}
                className={`mt-px shrink-0 ${t.kind === 'success' ? 'text-(--accent)' : ''}`}
              />
              <span>{t.message}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
