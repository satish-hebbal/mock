import { pickMediaFiles } from '../store'

/*
 * The empty-state prompt: one line of instruction and the button that carries
 * it out.
 *
 * Both editors start with nothing on the canvas, and in both the fastest way in
 * is a paste or a drop, which are invisible affordances. So the prompt names
 * them, and then still offers the button, because "drop a file here" is no help
 * to someone whose file is behind a file picker.
 *
 * Positioning is the caller's: the mockup viewport always has a device sitting
 * in the middle of it, so the prompt has to sit low, whereas an empty Shots
 * frame is genuinely empty and the prompt belongs in the centre of it.
 */
export function UploadPrompt({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-(--line) bg-(--raised) py-2 pr-2 pl-5">
      <span className="t-body text-(--tx2)">Upload media to get started (or paste / drop).</span>
      {/*
        Pill, not the default `rounded-md` button: this one is nested inside a
        pill-shaped prompt, and the radius scale carries "pill/full" precisely
        for that case. Keeps Linear's button padding (8px 14px) and type token.
      */}
      <button
        onClick={() => pickMediaFiles(onFiles)}
        className="rounded-full bg-(--accent-fill) px-3.5 py-2 t-button text-(--accent-tx) transition-opacity hover:opacity-90"
      >
        Upload
      </button>
    </div>
  )
}
