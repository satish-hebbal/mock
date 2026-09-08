/**
 * Marks on a run of text — a marker swipe, a line struck through it — and
 * keeping them stuck to the words they were drawn over.
 *
 * A mark is a pair of offsets into a string, which is a fine way to store one
 * and a terrible way to leave one alone: the moment anybody types a character
 * above it, every offset below the caret is wrong, and a highlight that slides
 * off its own sentence is worse than no highlight at all. So the one
 * interesting function here is `remapMarks`, which runs on every keystroke.
 *
 * It works from the edit rather than from the keystroke, because a textarea
 * does not report what changed — only what the value is now. The common prefix
 * and common suffix of the old and new strings bracket everything that could
 * possibly have moved, and whatever sits between them is the edit, whether
 * that was a typed letter, a paste, a deletion, or an IME committing a whole
 * word at once. Offsets before it stand, offsets after it shift, offsets
 * inside it collapse onto it. Nothing here needs to know which it was.
 *
 * Highlights carry a colour and strikes do not, which is the only difference
 * between them and the reason everything below is written once, generically:
 * two colours cannot both be the top one, and two strikes are the same strike.
 */

export interface TextMark {
  start: number
  end: number
  /** highlights are one per colour; a strike has none and merges with its neighbours */
  color?: string
}

const norm = <T extends TextMark>(marks: T[]): T[] =>
  marks.filter((m) => m.end > m.start).sort((a, b) => a.start - b.start)

/**
 * Merge touching runs that carry the same value, so a phrase marked in three
 * goes does not stay three records for the rest of its life.
 */
function coalesce<T extends TextMark>(marks: T[]): T[] {
  const out: T[] = []
  for (const m of norm(marks)) {
    const last = out[out.length - 1]
    if (last && last.color === m.color && m.start <= last.end) last.end = Math.max(last.end, m.end)
    else out.push({ ...m })
  }
  return out
}

/**
 * Lay a mark over [start, end), or lift whatever is there when `value` is null.
 *
 * Existing marks are cut around the new one rather than layered under it. One
 * that the new mark lands in the middle of comes back as the two ends that
 * survive.
 */
export function applyMark<T extends TextMark>(
  list: T[] | undefined,
  start: number,
  end: number,
  value: Omit<T, 'start' | 'end'> | null,
): T[] {
  const a = Math.min(start, end)
  const b = Math.max(start, end)
  if (b <= a) return list ?? []

  const kept: T[] = []
  for (const m of list ?? []) {
    if (m.end <= a || m.start >= b) {
      kept.push({ ...m })
      continue
    }
    if (m.start < a) kept.push({ ...m, end: a })
    if (m.end > b) kept.push({ ...m, start: b })
  }
  if (value) kept.push({ ...value, start: a, end: b } as T)
  return coalesce(kept)
}

/**
 * Move marks through an edit, given the string before and after it.
 *
 * A mark whose text was replaced outright keeps its mark over whatever
 * replaced it, which is what makes typing inside a highlighted word feel like
 * writing in highlighter rather than knocking a hole in it.
 */
export function remapMarks<T extends TextMark>(list: T[] | undefined, before: string, after: string): T[] {
  if (!list?.length) return list ?? []
  if (before === after) return list

  const max = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < max && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < max - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++

  const cutEnd = before.length - suffix
  const added = after.length - suffix - prefix
  const delta = after.length - before.length

  const move = (pos: number, isEnd: boolean) => {
    if (pos <= prefix) return pos
    if (pos >= cutEnd) return pos + delta
    // inside the replaced span: starts collapse to its front, ends to its back
    return isEnd ? prefix + added : prefix
  }

  return coalesce(
    list.map((m) => ({
      ...m,
      start: Math.max(0, Math.min(after.length, move(m.start, false))),
      end: Math.max(0, Math.min(after.length, move(m.end, true))),
    })),
  )
}

/** The parts of [lineStart, lineEnd) that carry a mark, clipped to the line. */
export function marksOn<T extends TextMark>(list: T[] | undefined, lineStart: number, lineEnd: number): T[] {
  if (!list?.length || lineEnd <= lineStart) return []
  const out: T[] = []
  for (const m of list) {
    const start = Math.max(m.start, lineStart)
    const end = Math.min(m.end, lineEnd)
    if (end > start) out.push({ ...m, start, end })
  }
  return out
}

/**
 * Is every character of [start, end) marked? What a toggle has to know before
 * it can decide whether it is switching something on or off.
 */
export function covers(list: TextMark[] | undefined, start: number, end: number): boolean {
  if (end <= start) return false
  let at = start
  for (const m of norm([...(list ?? [])])) {
    if (m.start > at) return false
    at = Math.max(at, m.end)
    if (at >= end) return true
  }
  return at >= end
}
