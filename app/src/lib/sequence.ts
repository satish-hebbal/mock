import type { ProjectDoc, Shot, Transition, TransitionKind } from '../types'

/*
 * The sequence: how a list of shots becomes one running time.
 *
 * Everything in the app that needs to know "what is on screen at 4.2 seconds"
 * comes through here, so the ribbon, the playhead, preview playback and the
 * exporter can never disagree about where a shot starts or which two shots a
 * blend is between.
 */

/** Shortest a shot may be cut to. Below this there is nothing to see. */
export const MIN_SHOT_MS = 200

/** Longest blend between two shots. Past this it stops reading as a cut at all. */
export const MAX_TRANSITION_MS = 1500

/** How many shots one film may hold. */
export const MAX_SHOTS = 24

export const DEFAULT_TRANSITION_MS = 400

export function defaultTransition(): Transition {
  return { kind: 'cut', durationMs: DEFAULT_TRANSITION_MS }
}

export const TRANSITION_LABELS: Record<TransitionKind, string> = {
  cut: 'Cut',
  dissolve: 'Dissolve',
  fadeBlack: 'Fade through black',
  fadeWhite: 'Fade through white',
}

/** The shot every scene edit lands on. Never null: a project always has one. */
export function activeShot(project: ProjectDoc): Shot {
  return project.shots.find((s) => s.id === project.activeShotId) ?? project.shots[0]
}

export function shotIndex(project: ProjectDoc, id: string): number {
  const i = project.shots.findIndex((s) => s.id === id)
  return i < 0 ? 0 : i
}

/**
 * How much of an overlap a transition actually gets.
 *
 * A blend cannot eat more than half of either shot it joins, or the two shots
 * on the far side of it would start overlapping each other and the film would
 * run backwards. Clamped here rather than when the transition is set, so
 * shortening a shot re-tightens its blends instead of corrupting the layout.
 */
export function effectiveTransitionMs(prev: Shot | undefined, shot: Shot): number {
  if (!prev || shot.transition.kind === 'cut') return 0
  return Math.max(
    0,
    Math.min(
      shot.transition.durationMs,
      MAX_TRANSITION_MS,
      prev.durationMs * 0.5,
      shot.durationMs * 0.5,
    ),
  )
}

/** One shot placed on the running time of the film. */
export interface PlacedShot {
  shot: Shot
  index: number
  /** global ms at which this shot's own time zero sits */
  start: number
  /** global ms at which it ends */
  end: number
  /** overlap with the shot before it, already clamped */
  inMs: number
}

/**
 * Lay every shot out on one running time.
 *
 * Transitions overlap, so a shot starts `inMs` *before* its predecessor ends.
 * That is what makes a dissolve shorten the film: the two shots share those
 * frames rather than queueing for them.
 */
export function sequenceLayout(project: ProjectDoc): PlacedShot[] {
  const out: PlacedShot[] = []
  let cursor = 0
  project.shots.forEach((shot, index) => {
    const inMs = effectiveTransitionMs(project.shots[index - 1], shot)
    const start = index === 0 ? 0 : cursor - inMs
    out.push({ shot, index, start, end: start + shot.durationMs, inMs })
    cursor = start + shot.durationMs
  })
  return out
}

/** Running time of the whole film, blends accounted for. */
export function sequenceDuration(project: ProjectDoc): number {
  const layout = sequenceLayout(project)
  return layout.length === 0 ? 0 : layout[layout.length - 1].end
}

/** Global ms of a shot's own time zero. */
export function shotStart(project: ProjectDoc, shotId: string): number {
  const layout = sequenceLayout(project)
  return layout.find((p) => p.shot.id === shotId)?.start ?? 0
}

/** Turn a shot-local time into a time on the film. */
export function toGlobal(project: ProjectDoc, shotId: string, localMs: number): number {
  return shotStart(project, shotId) + localMs
}

/** What the film is showing at one moment. */
export interface SequenceSlice {
  /** the shot this moment belongs to once any blend has finished */
  to: PlacedShot
  toLocalMs: number
  /** the outgoing shot, set only while a transition is running */
  from: PlacedShot | null
  fromLocalMs: number
  /** 0 = entirely the outgoing shot, 1 = entirely `to` */
  mix: number
  kind: TransitionKind
}

/**
 * Resolve a time on the film to the shot (or pair of shots) showing then.
 *
 * Inside a transition the later shot is the one that "owns" the moment, and the
 * earlier one rides along as `from`; outside one, `from` is null and the answer
 * is a single shot at a single local time.
 */
export function resolveSequence(project: ProjectDoc, globalMs: number): SequenceSlice {
  const layout = sequenceLayout(project)
  const total = layout.length === 0 ? 0 : layout[layout.length - 1].end
  const t = Math.min(total, Math.max(0, globalMs))

  // the latest shot that has begun; ties go to the newcomer, which is what
  // makes a transition resolve to its incoming side
  let idx = 0
  for (let i = 0; i < layout.length; i++) if (t >= layout[i].start) idx = i

  const to = layout[idx]
  const blend = to.inMs
  const prev = idx > 0 ? layout[idx - 1] : null
  const inBlend = prev !== null && blend > 0 && t < to.start + blend

  return {
    to,
    toLocalMs: Math.min(to.shot.durationMs, Math.max(0, t - to.start)),
    from: inBlend ? prev : null,
    fromLocalMs: inBlend && prev ? Math.min(prev.shot.durationMs, Math.max(0, t - prev.start)) : 0,
    mix: inBlend ? Math.min(1, Math.max(0, (t - to.start) / blend)) : 1,
    kind: inBlend ? to.shot.transition.kind : 'cut',
  }
}

/**
 * The veil a fade puts over the frame at a given point in the blend.
 *
 * A fade through black is two half-dips, not a cross-fade: the outgoing shot
 * sinks to full black at the midpoint and the incoming one climbs back out of
 * it, so neither side ever needs the other's pixels. `null` for the kinds that
 * do (a dissolve) and for a cut.
 */
export function fadeVeil(kind: TransitionKind, mix: number): { color: string; alpha: number } | null {
  if (kind !== 'fadeBlack' && kind !== 'fadeWhite') return null
  const alpha = 1 - Math.abs(mix * 2 - 1)
  return { color: kind === 'fadeBlack' ? '#000000' : '#ffffff', alpha: Math.min(1, Math.max(0, alpha)) }
}

/** Which side of a fade a moment belongs to: the outgoing shot, or the incoming one. */
export function fadeShowsIncoming(mix: number): boolean {
  return mix >= 0.5
}

/** What one frame of an export is made of. */
export interface FramePlan {
  /** index into `sequenceLayout` of the shot that composes and encodes it */
  owner: number
  /** the outgoing shot a dissolve needs held from its own pass, if any */
  under: number | null
  /** how far through the blend, 1 outside one */
  mix: number
  /** the fade colour laid over the frame, if any */
  veil: { color: string; alpha: number } | null
}

/**
 * Decide who renders every frame of the film, before a pixel is drawn.
 *
 * Only one shot is mounted at a time, so the exporter walks them in order and
 * has to know in advance which frames each one owes. Two rules do it: a
 * dissolve needs both sides at once, so the incoming shot owns those frames and
 * the outgoing one has to have kept them; a fade never does, because each half
 * dips to the veil colour on its own, so the frames simply belong to whichever
 * side of the midpoint they fall.
 *
 * Pure, and kept here rather than in the exporter, so the invariants that make
 * a video watchable (every frame owned exactly once, in order) can be checked
 * without a browser.
 */
export function planFrames(project: ProjectDoc, fps: number): FramePlan[] {
  const frameMs = 1000 / fps
  const total = Math.max(1, Math.round((sequenceDuration(project) / 1000) * fps))
  const plan: FramePlan[] = []

  for (let i = 0; i < total; i++) {
    const slice = resolveSequence(project, i * frameMs)
    if (!slice.from) {
      plan.push({ owner: slice.to.index, under: null, mix: 1, veil: null })
    } else if (slice.kind === 'dissolve') {
      plan.push({ owner: slice.to.index, under: slice.from.index, mix: slice.mix, veil: null })
    } else {
      const incoming = fadeShowsIncoming(slice.mix)
      plan.push({
        owner: incoming ? slice.to.index : slice.from.index,
        under: null,
        mix: slice.mix,
        veil: fadeVeil(slice.kind, slice.mix),
      })
    }
  }
  return plan
}
