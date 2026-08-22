import { useState } from 'react'
import { X } from 'lucide-react'
import { ui } from '../lib/ui'

/**
 * Where feedback goes. Set this to a real inbox before shipping.
 *
 * Left empty on purpose rather than guessed at: with no address the dialog
 * copies the note to the clipboard and says so, which is a worse experience but
 * an honest one. A button that silently drops what someone took the trouble to
 * write is the one outcome worth ruling out.
 */
const FEEDBACK_TO = ''

const MOODS = ['🤬', '🙄', '🙂', '😎', '😍']

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [mood, setMood] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const send = () => {
    const body = `${mood !== null ? `Mood: ${MOODS[mood]}\n\n` : ''}${note.trim()}`
    if (FEEDBACK_TO) {
      window.location.href = `mailto:${FEEDBACK_TO}?subject=${encodeURIComponent('Feedback')}&body=${encodeURIComponent(body)}`
    } else {
      void navigator.clipboard.writeText(body)
      ui.toast('Feedback copied to your clipboard')
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
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
          onClick={send}
          disabled={mood === null && !note.trim()}
          className="mt-3 h-10 w-full rounded-lg bg-(--accent-fill) t-button text-(--accent-tx) transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Send feedback
        </button>
      </div>
    </div>
  )
}
