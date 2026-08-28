import { useState } from 'react'
import { X } from 'lucide-react'
import { ui } from '../lib/ui'
import { track } from '../lib/analytics'

/**
 * Where feedback goes. Web3Forms relays the POST below to the inbox that
 * registered this key, so no address ships in the bundle and there is no server
 * to run. The key is public by design: it can only ever deliver to that one
 * inbox, which is why it sits here in plain sight instead of in an env var.
 * Vite inlines env vars into the bundle anyway, so hiding it would have been
 * theatre with an extra deploy step attached.
 *
 * Rotate it at web3forms.com (form "ribbit"). Emptied, the dialog falls back to
 * copying the note to the clipboard and saying so, because a button that
 * silently drops what someone took the trouble to write is the one outcome
 * worth ruling out.
 */
const ACCESS_KEY = '89a9d86a-df8f-4a75-b71c-b9443ec962be'

const MOODS = ['🤬', '🙄', '🙂', '😎', '😍']

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [mood, setMood] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  const send = async () => {
    const body = `${mood !== null ? `Mood: ${MOODS[mood]}\n\n` : ''}${note.trim()}`

    const toClipboard = async (message: string, kind: 'info' | 'error') => {
      await navigator.clipboard.writeText(body).catch(() => {})
      ui.toast(message, kind)
    }

    if (!ACCESS_KEY) {
      await toClipboard('Feedback copied to your clipboard', 'info')
      onClose()
      return
    }

    setSending(true)
    try {
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: ACCESS_KEY,
          subject: `Mockup Studio feedback ${mood !== null ? MOODS[mood] : ''}`.trim(),
          from_name: 'Mockup Studio',
          mood: mood !== null ? `${MOODS[mood]} (${mood + 1} of ${MOODS.length})` : 'not given',
          message: note.trim() || '(no note)',
          page: window.location.href,
        }),
      })
      const data = (await res.json().catch(() => null)) as { success?: boolean } | null
      if (!res.ok || !data?.success) throw new Error(String(res.status))
      /*
       * The mood and whether prose came with it, never the note itself. What
       * someone wrote belongs in the inbox behind this form and nowhere else,
       * and a rating that can be charted over releases is the part analytics
       * can actually use.
       */
      track('feedback_sent', { mood: mood !== null ? mood + 1 : null, has_note: !!note.trim() })
      ui.toast('Thanks, your feedback is on its way', 'success')
      onClose()
    } catch {
      // The note is the part that took effort, so hand it back rather than
      // lose it to a dropped connection.
      await toClipboard('Could not send that. It is on your clipboard instead.', 'error')
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={() => !sending && onClose()}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && !sending && onClose()}
        className="w-[360px] rounded-xl border border-(--line) bg-(--raised) p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="t-subhead text-(--tx)">Send feedback</p>
            <p className="t-body-sm text-(--tx3)">We read them all.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--field) text-(--tx2) hover:bg-(--field-h) hover:text-(--tx)"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {/*
          The faces come before the box on purpose. One tap is the whole
          interaction for most people, and asking for prose first is what makes
          a feedback form feel like homework.
        */}
        <div className="mt-4 flex gap-2">
          {MOODS.map((m, i) => (
            <button
              key={m}
              onClick={() => setMood(i)}
              aria-label={`Mood ${i + 1} of ${MOODS.length}`}
              aria-pressed={mood === i}
              className={`flex h-11 flex-1 items-center justify-center rounded-full text-xl transition-colors ${
                mood === i ? 'bg-(--sel)' : 'bg-(--field) hover:bg-(--field-h)'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <p className="mt-4 t-body-sm text-(--tx2)">How can we improve your experience?</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Write your feedback…"
          rows={5}
          className="mt-2 w-full resize-none rounded-lg bg-(--field) p-3 t-body-sm text-(--tx) placeholder:text-(--tx3) focus:outline-none"
        />

        <button
          onClick={() => void send()}
          disabled={sending || (mood === null && !note.trim())}
          className="mt-3 h-10 w-full rounded-lg bg-(--accent-fill) t-button text-(--accent-tx) transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
      </div>
    </div>
  )
}
