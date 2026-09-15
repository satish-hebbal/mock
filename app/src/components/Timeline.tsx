import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStudio } from '../store'
import { targetLabel } from '../lib/evaluator'
import { EASING_NAMES } from '../lib/easing'
import { ANIMATION_PRESETS } from '../lib/presets'
import { activeShot, sequenceDuration, sequenceLayout, shotStart } from '../lib/sequence'
import { Dropdown, MiniButton } from './controls'
import { ShotRibbon } from './ShotRibbon'
import { KF_MARK_LANE } from '../lib/marks'
import { EasingGlyph } from './EasingGlyph'
import { ui } from '../lib/ui'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Film,
  Infinity as InfinityIcon,
  PanelBottomClose,
  PanelBottomOpen,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Wand2,
} from 'lucide-react'
import type { EasingName } from '../types'

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `00:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

const TRANSPORT_H = 44 // transport bar, always visible
const RIBBON_H = 36 // the shot strip and its bottom gap
const RULER_H = 22
const LANE_H = 22 // the bar itself
const ROW_H = 30 // one track: the bar plus the air around it
const MIN_H = TRANSPORT_H + RIBBON_H + RULER_H + ROW_H + 16
const HEIGHT_KEY = 'ms-timeline-height'
const LABEL_W = 144 // track-label gutter; the ribbon and ruler share it
const SNAP_PX = 6 // magnet radius while dragging keyframes

/** Marquee rectangle in client coordinates. */
interface Marquee {
  x0: number
  y0: number
  x1: number
  y1: number
  additive: boolean
}

/**
 * Runs one pointer drag: captures the pointer, holds `cursor` over the whole
 * document until it comes back up, and suppresses text selection for as long as
 * it lasts. The document-wide hold is what keeps a scrub honest: a captured
 * drag still paints whatever cursor sits under the pointer, so sweeping down
 * over the lanes would otherwise flicker the cursor and leave a trail of
 * selected labels behind it.
 */
function beginDrag(
  e: React.PointerEvent,
  cursor: string,
  onMove: (ev: PointerEvent) => void,
  onEnd?: (ev: PointerEvent) => void,
) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const body = document.body
  const prevCursor = body.style.cursor
  const prevSelect = body.style.userSelect
  body.style.cursor = cursor
  body.style.userSelect = 'none'
  const end = (ev: PointerEvent) => {
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', end)
    el.removeEventListener('pointercancel', end)
    body.style.cursor = prevCursor
    body.style.userSelect = prevSelect
    onEnd?.(ev)
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
}

/*
 * The playhead and the clock are the only things here that move at sixty frames
 * a second, and both are one number wide. Subscribing to the store from inside
 * them, and writing the result straight to the DOM, keeps a scrub from
 * re-rendering every lane and every keyframe on every tick: the timeline is now
 * the one panel that is guaranteed to be on screen while something is playing,
 * so that re-render was the most expensive thing in the app.
 */

function Playhead({ originMs, spanMs }: { originMs: number; spanMs: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const paint = (timeMs: number) => {
      if (ref.current) ref.current.style.left = `${((originMs + timeMs) / spanMs) * 100}%`
    }
    paint(useStudio.getState().timeMs)
    return useStudio.subscribe((s) => paint(s.timeMs))
  }, [originMs, spanMs])

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-10" style={{ left: LABEL_W }}>
      <div ref={ref} className="absolute inset-y-0 w-px bg-(--accent)">
        <span className="absolute top-0 -left-[4px] h-0 w-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-(--accent)" />
      </div>
    </div>
  )
}

function TimeReadout({ sequence }: { sequence: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const paint = () => {
      const s = useStudio.getState()
      const shot = activeShot(s.project)
      const at = sequence ? shotStart(s.project, shot.id) + s.timeMs : s.timeMs
      const of = sequence ? sequenceDuration(s.project) : shot.durationMs
      if (ref.current) ref.current.textContent = `${fmtTime(at)} / ${fmtTime(of)}`
    }
    paint()
    return useStudio.subscribe(paint)
  }, [sequence])

  return (
    <span
      ref={ref}
      className="rounded-xs bg-(--panel2) px-2 py-1 t-body-sm text-(--tx) tabular-nums"
      title={sequence ? 'Position in the whole film' : 'Position in this shot'}
    />
  )
}

export function Timeline() {
  const project = useStudio((s) => s.project)
  const playing = useStudio((s) => s.playing)
  const loop = useStudio((s) => s.loop)
  const scrubMode = useStudio((s) => s.scrubMode)
  const selectedKfIds = useStudio((s) => s.selectedKeyframeIds)
  const st = useStudio.getState

  // collapsed by default and remembered in the store, so the top bar and the `\`
  // shortcut can drive the same state
  const collapsed = !useStudio((s) => s.timelineOpen)
  const setCollapsed = (v: boolean) => st().setTimelineOpen(!v)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [height, setHeight] = useState(() => {
    const saved = Number(localStorage.getItem(HEIGHT_KEY))
    return Number.isFinite(saved) && saved >= MIN_H ? saved : 280
  })
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [dragTime, setDragTime] = useState<number | null>(null)

  const laneRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)

  const shot = activeShot(project)
  const sequence = scrubMode === 'sequence' && project.shots.length > 1
  const frameMs = 1000 / project.fps

  /*
   * One coordinate space for the ruler, the lanes and the playhead.
   *
   * In Shot the space is this take, from its own zero. In Film it is the whole
   * compiled running time, and the take being edited occupies a window inside
   * it. Everything below converts through this pair rather than dividing by a
   * duration itself, which is what lets the same lane code draw both.
   */
  const filmMs = useMemo(() => Math.max(1, sequenceDuration(project)), [project])
  const originMs = sequence ? shotStart(project, shot.id) : 0
  const spanMs = sequence ? filmMs : shot.durationMs

  const fracOfLocal = useCallback(
    (localMs: number) => (originMs + localMs) / spanMs,
    [originMs, spanMs],
  )
  const pctOf = (localMs: number) => `${fracOfLocal(localMs) * 100}%`

  const tracks = useMemo(() => {
    const byTarget = new Map<string, typeof shot.keyframes>()
    for (const k of shot.keyframes) {
      const arr = byTarget.get(k.target) ?? []
      arr.push(k)
      byTarget.set(k.target, arr)
    }
    return [...byTarget.entries()]
      .map(([target, kfs]) => {
        const sorted = [...kfs].sort((a, b) => a.timeMs - b.timeMs)
        /*
         * Shortening a shot leaves its later keyframes past the out point
         * rather than destroying their timing, so the lane draws what is
         * inside the take and counts the rest. They come back the moment the
         * shot is lengthened again.
         */
        const inside = sorted.filter((k) => k.timeMs <= shot.durationMs + 1)
        return {
          target,
          label: targetLabel(target, shot.scene.devices),
          kfs: inside,
          beyond: sorted.length - inside.length,
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [shot.keyframes, shot.scene.devices, shot.durationMs])

  useEffect(() => {
    localStorage.setItem(HEIGHT_KEY, String(height))
  }, [height])

  // ----- panel resize -----

  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const max = Math.round(window.innerHeight * 0.7)
    beginDrag(e, 'ns-resize', (ev) => {
      // dragging the grip is also a way to open a collapsed timeline
      if (!useStudio.getState().timelineOpen) setCollapsed(false)
      setHeight(Math.min(max, Math.max(MIN_H, startH - (ev.clientY - startY))))
    })
  }

  // ----- time <-> pixels -----

  /** Where a pointer is, in the coordinate space the ruler is drawn in. */
  const spanMsFromClientX = useCallback(
    (clientX: number) => {
      const el = laneRef.current
      if (!el) return 0
      const r = el.getBoundingClientRect()
      return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * spanMs
    },
    [spanMs],
  )

  /** The same position, expressed as a time inside the shot being edited. */
  const localFromClientX = useCallback(
    (clientX: number) =>
      Math.min(shot.durationMs, Math.max(0, spanMsFromClientX(clientX) - originMs)),
    [spanMsFromClientX, originMs, shot.durationMs],
  )

  const msPerPx = () => spanMs / Math.max(1, laneRef.current?.getBoundingClientRect().width ?? 1)

  const scrubFrom = (clientX: number) => {
    st().setPlaying(false)
    // In Film a scrub can cross into another take, which is the point of it:
    // the store hands the playhead to whichever shot owns that moment.
    if (sequence) st().setGlobalTime(spanMsFromClientX(clientX))
    else st().setTime(spanMsFromClientX(clientX))
  }

  const startScrub = (e: React.PointerEvent) => {
    scrubFrom(e.clientX)
    beginDrag(e, 'grabbing', (ev) => scrubFrom(ev.clientX))
  }

  // ----- keyframe drag (moves the whole selection, with snapping) -----

  const startKeyframeDrag = (e: React.PointerEvent, kfId: string) => {
    e.stopPropagation()
    e.preventDefault()

    // dragging an unselected keyframe makes it the selection first, so what you
    // grab is always what moves
    let ids = selectedKfIds
    if (e.shiftKey) ids = [...new Set([...selectedKfIds, kfId])]
    else if (!selectedKfIds.includes(kfId)) ids = [kfId]
    st().selectKeyframes(ids)

    const grabbed = shot.keyframes.find((k) => k.id === kfId)
    if (!grabbed) return
    const startX = e.clientX
    const startTime = grabbed.timeMs
    // snap candidates: every other keyframe, the playhead, and both ends
    const others = shot.keyframes.filter((k) => !ids.includes(k.id)).map((k) => k.timeMs)
    const stops = [...others, st().timeMs, 0, shot.durationMs]

    let last = startTime

    beginDrag(
      e,
      'grabbing',
      (ev) => {
        const perPx = msPerPx()
        let target = startTime + (ev.clientX - startX) * perPx
        if (!ev.altKey) {
          // magnet to a nearby stop, else fall back to the frame grid
          const snap = stops.find((s) => Math.abs(s - target) < SNAP_PX * perPx)
          target = snap ?? Math.round(target / frameMs) * frameMs
        }
        target = Math.min(shot.durationMs, Math.max(0, target))
        const delta = target - last
        if (Math.abs(delta) < 0.5) return
        st().moveKeyframesBy(ids, delta)
        last = target
        setDragTime(target)
      },
      () => setDragTime(null),
    )
  }

  // ----- marquee selection over the lanes -----

  const startMarquee = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const base = e.shiftKey ? selectedKfIds : []
    if (!e.shiftKey) st().selectKeyframes([])
    const box: Marquee = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, additive: e.shiftKey }
    let moved = false

    beginDrag(
      e,
      'crosshair',
      (ev) => {
        box.x1 = ev.clientX
        box.y1 = ev.clientY
        if (Math.abs(box.x1 - box.x0) + Math.abs(box.y1 - box.y0) > 4) moved = true
        if (!moved) return
        setMarquee({ ...box })
        // hit-test the rendered diamonds, cheap and always in sync with layout
        const rect = {
          left: Math.min(box.x0, box.x1),
          right: Math.max(box.x0, box.x1),
          top: Math.min(box.y0, box.y1),
          bottom: Math.max(box.y0, box.y1),
        }
        const hits: string[] = []
        for (const node of tracksRef.current?.querySelectorAll<HTMLElement>('[data-kf]') ?? []) {
          const b = node.getBoundingClientRect()
          const cx = b.left + b.width / 2
          const cy = b.top + b.height / 2
          if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom)
            hits.push(node.dataset.kf!)
        }
        st().selectKeyframes([...new Set([...base, ...hits])])
      },
      (ev) => {
        setMarquee(null)
        // a click on empty lane space (no drag) moves the playhead there
        if (!moved) scrubFrom(ev.clientX)
      },
    )
  }

  // ----- keyboard nudging -----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable) return
      const s = useStudio.getState()
      if (s.mode !== 'studio' || s.selectedKeyframeIds.length === 0) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const step = (e.shiftKey ? 10 : 1) * (1000 / s.project.fps)
      s.moveKeyframesBy(s.selectedKeyframeIds, e.key === 'ArrowRight' ? step : -step)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const easingOfSelection = (): EasingName => {
    const sel = shot.keyframes.filter((k) => selectedKfIds.includes(k.id))
    return sel[0]?.easing ?? 'smooth'
  }

  /*
   * Ruler marks across whatever is currently being measured.
   *
   * A second apiece is right for one take; a film of twenty is minutes long,
   * and a line every second there is a grey band with no numbers in it. The
   * step opens up until the marks are readable again.
   */
  const tickStep = ([1, 2, 5, 10, 15, 30, 60] as const).find((s) => spanMs / (s * 1000) <= 14) ?? 120
  const ticks = Math.floor(spanMs / (tickStep * 1000))

  /** Where each shot begins, for the seams drawn across the lanes in Film. */
  const seams = useMemo(
    () => (sequence ? sequenceLayout(project).slice(1).map((p) => p.start / filmMs) : []),
    [sequence, project, filmMs],
  )

  return (
    <footer
      className="relative flex shrink-0 flex-col rounded-lg border border-(--line) bg-(--raised)"
      style={{ height: collapsed ? TRANSPORT_H : height }}
    >
      {/* resize grip: sits on the top edge, canvas above gives up the space */}
      <div
        onPointerDown={onResizeStart}
        onDoubleClick={() => setHeight(280)}
        title="Drag to resize the timeline"
        className="group absolute -top-1 right-0 left-0 z-20 flex h-2 cursor-ns-resize items-center justify-center"
      >
        <span className="h-0.5 w-10 rounded-full bg-transparent transition-colors group-hover:bg-(--tx3)" />
      </div>

      {/* transport bar */}
      <div className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto px-3">
        <TimeReadout sequence={sequence} />

        <div className="flex shrink-0 items-center gap-1">
          <MiniButton
            title="Step back one frame"
            onClick={() => st().setTime(Math.max(0, st().timeMs - frameMs))}
          >
            <SkipBack size={13} />
          </MiniButton>
          <button
            onClick={() => st().setPlaying(!playing)}
            className="flex h-8 items-center rounded-md bg-(--accent-fill) px-3.5 t-button text-(--accent-tx) hover:bg-(--accent-fill-hover)"
            title="Play / pause (Space)"
          >
            {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
          </button>
          <MiniButton
            title="Step forward one frame"
            onClick={() => st().setTime(Math.min(shot.durationMs, st().timeMs + frameMs))}
          >
            <SkipForward size={13} />
          </MiniButton>
          <MiniButton title="Loop playback" active={loop} onClick={() => st().setLoop(!loop)}>
            <Repeat size={13} />
          </MiniButton>
        </div>

        {/*
          The strip lives in the expanded timeline, which is collapsed by
          default. Collapsed, the bar stands in for it: which take you are on
          and how to step between them. Expanded, the ribbon says all of that
          better, so only the way to start another take stays.
        */}
        <div className="ml-1 flex items-center gap-1">
          {collapsed && project.shots.length > 1 && (
            <>
              <MiniButton
                title="Previous shot (,)"
                onClick={() => {
                  const i = project.shots.findIndex((x) => x.id === project.activeShotId)
                  if (i > 0) st().selectShot(project.shots[i - 1].id, 0)
                }}
              >
                <ChevronLeft size={12} />
              </MiniButton>
              <span
                className="rounded-xs bg-(--panel2) px-1.5 py-1 t-caption text-(--tx2) tabular-nums"
                title={shot.name}
              >
                {project.shots.findIndex((x) => x.id === project.activeShotId) + 1}/
                {project.shots.length}
              </span>
              <MiniButton
                title="Next shot (.)"
                onClick={() => {
                  const i = project.shots.findIndex((x) => x.id === project.activeShotId)
                  const next = project.shots[i + 1]
                  if (next) st().selectShot(next.id, 0)
                }}
              >
                <ChevronRight size={12} />
              </MiniButton>
            </>
          )}
          <MiniButton title="Add a shot after this one (Alt+M)" onClick={() => st().addShot()}>
            <Plus size={12} />
          </MiniButton>
        </div>

        {project.shots.length > 1 && (
          <div className="flex items-center gap-0.5 rounded-xs bg-(--panel2) p-0.5">
            <MiniButton
              title="Play and scrub this shot on its own"
              active={!sequence}
              onClick={() => st().setScrubMode('shot')}
            >
              <Square size={11} /> Shot
            </MiniButton>
            <MiniButton
              title="Play and scrub the whole film, transitions included"
              active={sequence}
              onClick={() => st().setScrubMode('sequence')}
            >
              <Film size={11} /> Film
            </MiniButton>
          </div>
        )}

        <label className="ml-2 flex items-center gap-1 t-caption text-(--tx3)" title={`Length of ${shot.name}`}>
          DUR
          <input
            type="number"
            min={0.5}
            max={30}
            step={0.5}
            value={Number((shot.durationMs / 1000).toFixed(2))}
            onChange={(e) => st().setDuration(Number(e.target.value) * 1000)}
            onKeyDown={(e) => {
              // hand focus back, or the isTyping guard swallows every shortcut
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
            }}
            className="w-13 rounded-xs border border-(--line) bg-transparent px-1 py-0.5 text-right t-body-sm text-(--tx) tabular-nums"
          />
          s
        </label>
        <label className="flex items-center gap-1 t-caption text-(--tx3)">
          FPS
          <Dropdown
            className="w-16"
            value={project.fps}
            onChange={(v) => st().setFps(v)}
            options={[24, 30, 60].map((f) => ({ value: f, label: String(f) }))}
          />
        </label>

        {selectedKfIds.length > 0 && (
          <span className="rounded-xs bg-(--sel) px-2 py-1 t-caption text-(--tx)">
            {selectedKfIds.length} selected
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <div className="relative">
            <MiniButton onClick={() => setPresetsOpen(!presetsOpen)} active={presetsOpen}>
              <Wand2 size={12} />
              Presets
              <ChevronDown size={12} className={`transition-transform ${presetsOpen ? 'rotate-180' : ''}`} />
            </MiniButton>
            {presetsOpen && (
              <div className="absolute right-0 bottom-full z-30 mb-1.5 flex w-44 flex-col gap-1 rounded-lg border border-(--line) bg-(--raised) p-2">
                {ANIMATION_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      st().applyAnimationPreset(p.id)
                      setPresetsOpen(false)
                    }}
                    className="rounded-xs px-2 py-1.5 text-left t-body-sm text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Dropdown
            className="w-28"
            align="right"
            title="Easing for selected keyframes"
            value={easingOfSelection()}
            onChange={(v) => {
              const ids = selectedKfIds.length > 0 ? selectedKfIds : shot.keyframes.map((k) => k.id)
              st().setKeyframeEasing(ids, v as EasingName)
            }}
            options={EASING_NAMES.map((e) => ({
              value: e.id,
              label: e.label,
              icon: <EasingGlyph easing={e.id} />,
            }))}
          />

          <MiniButton
            title="Add keyframes for all camera properties at the playhead"
            onClick={() => {
              for (const prop of ['tiltX', 'tiltY', 'zoom', 'panX', 'panY'] as const)
                st().addKeyframeAt(`camera.${prop}`)
            }}
          >
            <Plus size={12} /> Add KF
          </MiniButton>
          <MiniButton title="First frame == last frame" onClick={() => st().makeLoopFriendly()}>
            <InfinityIcon size={12} /> Loopify
          </MiniButton>
          <MiniButton
            title="Clear this shot's keyframes"
            onClick={() => {
              void ui
                .confirm({
                  title: `Clear keyframes in ${shot.name}?`,
                  body: 'Every keyframe on every track of this shot goes. Ctrl+Z brings them back.',
                  confirmLabel: 'Clear all',
                  danger: true,
                })
                .then((ok) => {
                  if (ok) st().clearAllKeyframes()
                })
            }}
          >
            <Trash2 size={12} />
          </MiniButton>
          <MiniButton
            title={collapsed ? 'Expand the timeline (\\)' : 'Collapse the timeline (\\)'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelBottomOpen size={13} /> : <PanelBottomClose size={13} />}
          </MiniButton>
        </div>
      </div>

      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-2 select-none">
          <ShotRibbon />

          {/* ruler + lanes share one horizontal coordinate space */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-stretch">
              <div className="shrink-0" style={{ width: LABEL_W }} />
              <div
                ref={laneRef}
                onPointerDown={startScrub}
                style={{ height: RULER_H }}
                className="relative flex-1 cursor-grab rounded-t bg-(--panel2) active:cursor-grabbing"
              >
                {Array.from({ length: ticks + 1 }, (_, i) => {
                  // A tick sitting on (or nearly on) 100% has no room to its
                  // right, so its label hangs to the left of the line instead of
                  // starting where the ruler ends. Judged on position, not
                  // index: at a 3.5s duration the last tick is only 86% across
                  // and reads better numbered the normal way, after its line.
                  const secs = i * tickStep
                  const at = (secs * 1000) / spanMs
                  const last = at > 0.96
                  return (
                    <span
                      key={i}
                      className="absolute top-0 h-full border-l border-(--line)"
                      style={{ left: `${at * 100}%` }}
                    >
                      <span
                        className={`absolute top-0 t-caption whitespace-nowrap text-(--tx3) ${
                          last ? 'right-0 pr-1' : 'left-0 pl-1'
                        }`}
                      >
                        {secs}s
                      </span>
                    </span>
                  )
                })}
                {/*
                  In Film, the stretch of the ruler this take occupies. Without
                  it the lanes below would look like they were drawn against the
                  whole film, and a keyframe two thirds of the way through a
                  three-second shot would appear to sit at an arbitrary place.
                */}
                {sequence && (
                  <span
                    className="pointer-events-none absolute inset-y-0 border-x border-(--accent)/60 bg-(--accent-soft)"
                    style={{
                      left: `${(originMs / spanMs) * 100}%`,
                      width: `${(shot.durationMs / spanMs) * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>

            {/* tracks */}
            <div ref={tracksRef} className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
              {tracks.length === 0 && (
                <p className="py-3 text-center t-caption text-(--tx3)">
                  No keyframes in {shot.name} yet. Toggle a ◆ next to any property, or apply an
                  animation preset.
                </p>
              )}
              {tracks.map((track) => (
                <div
                  key={track.target}
                  className="flex shrink-0 items-center"
                  style={{ height: ROW_H }}
                >
                  <button
                    className="group flex shrink-0 items-center gap-1 truncate px-1 text-left t-caption text-(--tx2) hover:text-(--tx)"
                    style={{ width: LABEL_W }}
                    title="Remove this track (bakes the current value)"
                    onClick={() => st().toggleTrack(track.target)}
                  >
                    <Trash2 size={10} className="shrink-0 opacity-0 group-hover:opacity-100" />
                    <span className="truncate">{track.label}</span>
                  </button>
                  {/*
                    The lane is a trough with a bar in it, the way an editor
                    draws a layer: the row it sits in carries the spacing, so
                    lanes read as separate objects without needing stripes
                    behind them to tell them apart.

                    The gestures live on the full-height row rather than on the
                    trough, so the air between lanes is somewhere a marquee can
                    start instead of a dead strip.
                  */}
                  <div
                    onPointerDown={startMarquee}
                    onDoubleClick={(e) => st().addKeyframeAt(track.target, localFromClientX(e.clientX))}
                    title="Drag to box-select · double-click to add a keyframe"
                    className="relative h-full flex-1"
                  >
                    {/*
                      The trough, and inside it the stretch this property is
                      actually animating over, drawn as a solid bar rather than
                      a hairline. The bar is the part of the row that means
                      something, it is what the keys are pinned to, and at a
                      bar's width it is also something you can aim at.

                      Clipped, so the bar's ends and the film's seams stop at
                      the trough's rounded corners. The keys are deliberately
                      outside it: one sitting on zero would lose its left half
                      to that same clip.
                    */}
                    <div
                      className="absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-xs bg-(--panel2)"
                      style={{ height: LANE_H }}
                    >
                      {/* the take's own window, when the lane is measuring the film */}
                      {sequence && (
                        <span
                          className="pointer-events-none absolute inset-y-0 bg-(--raised)"
                          style={{
                            left: `${(originMs / spanMs) * 100}%`,
                            width: `${(shot.durationMs / spanMs) * 100}%`,
                          }}
                        />
                      )}
                      {seams.map((x, i) => (
                        <span
                          key={i}
                          className="pointer-events-none absolute inset-y-0 w-px bg-(--line)"
                          style={{ left: `${x * 100}%` }}
                        />
                      ))}
                      {track.kfs.length > 1 && (
                        <span
                          className="pointer-events-none absolute inset-y-0 rounded-xs border border-(--line2) bg-(--panel3)"
                          style={{
                            left: pctOf(track.kfs[0].timeMs),
                            right: `${100 - fracOfLocal(track.kfs[track.kfs.length - 1].timeMs) * 100}%`,
                          }}
                        />
                      )}
                    </div>

                    {track.beyond > 0 && (
                      <span
                        title={`${track.beyond} keyframe${
                          track.beyond === 1 ? '' : 's'
                        } past the end of ${shot.name}. Lengthen the shot to reach ${
                          track.beyond === 1 ? 'it' : 'them'
                        } again.`}
                        className="pointer-events-auto absolute top-1/2 z-10 -translate-y-1/2 rounded-xs bg-(--panel3) px-1 t-caption text-(--tx3)"
                        style={{ left: `calc(${pctOf(shot.durationMs)} + 6px)` }}
                      >
                        +{track.beyond}
                      </span>
                    )}
                    {track.kfs.map((k) => {
                      const active = selectedKfIds.includes(k.id)
                      return (
                        <button
                          key={k.id}
                          data-kf={k.id}
                          title={`${fmtTime(k.timeMs)} · ${k.value.toFixed(2)} · ${k.easing}`}
                          onPointerDown={(e) => startKeyframeDrag(e, k.id)}
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            st().removeKeyframes([k.id])
                          }}
                          // the hit area runs the full height of the lane, so a
                          // grab that lands anywhere in the row still takes the
                          // key nearest it rather than nothing at all
                          className="absolute top-1/2 flex w-[26px] -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center active:cursor-grabbing"
                          style={{ left: pctOf(k.timeMs), height: LANE_H }}
                        >
                          <span
                            className={`${KF_MARK_LANE} ${
                              active
                                ? 'bg-(--accent) ring-2 ring-(--accent-soft)'
                                : 'bg-(--tx2) hover:bg-(--tx)'
                            }`}
                          />
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* playhead spans the ruler and every lane below it */}
            <Playhead originMs={originMs} spanMs={spanMs} />
          </div>
        </div>
      )}

      {/* live time readout while dragging keyframes */}
      {dragTime !== null && (
        <span className="pointer-events-none absolute top-11 left-1/2 z-30 -translate-x-1/2 rounded-xs bg-(--panel3) px-2 py-1 t-caption text-(--tx) tabular-nums">
          {fmtTime(dragTime)}
        </span>
      )}

      {/* marquee */}
      {marquee && (
        <div
          className="pointer-events-none fixed z-40 border border-(--accent) bg-(--accent-soft)"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
    </footer>
  )
}
