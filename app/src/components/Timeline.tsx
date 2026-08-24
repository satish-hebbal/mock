import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStudio } from '../store'
import { targetLabel } from '../lib/evaluator'
import { EASING_NAMES } from '../lib/easing'
import { ANIMATION_PRESETS } from '../lib/presets'
import { Dropdown, MiniButton } from './controls'
import { KF_MARK } from '../lib/marks'
import { EasingGlyph } from './EasingGlyph'
import { ui } from '../lib/ui'
import {
  ChevronDown,
  Infinity as InfinityIcon,
  PanelBottomClose,
  PanelBottomOpen,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  SkipForward,
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
const RULER_H = 22
const ROW_H = 22 // one track lane
const MIN_H = TRANSPORT_H + RULER_H + ROW_H + 16
const HEIGHT_KEY = 'ms-timeline-height'
const SNAP_PX = 6 // magnet radius while dragging keyframes

/** Marquee rectangle in client coordinates. */
interface Marquee {
  x0: number
  y0: number
  x1: number
  y1: number
  additive: boolean
}

export function Timeline() {
  const project = useStudio((s) => s.project)
  const timeMs = useStudio((s) => s.timeMs)
  const playing = useStudio((s) => s.playing)
  const loop = useStudio((s) => s.loop)
  const selectedKfIds = useStudio((s) => s.selectedKeyframeIds)
  const st = useStudio.getState

  // collapsed by default and remembered in the store, so the top bar and the `\`
  // shortcut can drive the same state
  const collapsed = !useStudio((s) => s.timelineOpen)
  const setCollapsed = (v: boolean) => st().setTimelineOpen(!v)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [height, setHeight] = useState(() => {
    const saved = Number(localStorage.getItem(HEIGHT_KEY))
    return Number.isFinite(saved) && saved >= MIN_H ? saved : 210
  })
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [dragTime, setDragTime] = useState<number | null>(null)

  const laneRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)

  const duration = project.durationMs
  const frameMs = 1000 / project.fps

  const tracks = useMemo(() => {
    const byTarget = new Map<string, typeof project.keyframes>()
    for (const k of project.keyframes) {
      const arr = byTarget.get(k.target) ?? []
      arr.push(k)
      byTarget.set(k.target, arr)
    }
    return [...byTarget.entries()]
      .map(([target, kfs]) => ({
        target,
        label: targetLabel(target, project.scene),
        kfs: [...kfs].sort((a, b) => a.timeMs - b.timeMs),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [project.keyframes, project.scene])

  useEffect(() => {
    localStorage.setItem(HEIGHT_KEY, String(height))
  }, [height])

  // ----- panel resize -----

  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const max = Math.round(window.innerHeight * 0.7)
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      // dragging the grip is also a way to open a collapsed timeline
      if (!useStudio.getState().timelineOpen) setCollapsed(false)
      setHeight(Math.min(max, Math.max(MIN_H, startH - (ev.clientY - startY))))
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  // ----- time <-> pixels -----

  const msFromClientX = useCallback(
    (clientX: number) => {
      const el = laneRef.current
      if (!el) return 0
      const r = el.getBoundingClientRect()
      return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration
    },
    [duration],
  )

  const msPerPx = () => duration / Math.max(1, laneRef.current?.getBoundingClientRect().width ?? 1)

  const scrubFrom = (clientX: number) => {
    st().setPlaying(false)
    st().setTime(msFromClientX(clientX))
  }

  const startScrub = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    scrubFrom(e.clientX)
    const onMove = (ev: PointerEvent) => scrubFrom(ev.clientX)
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
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

    const grabbed = project.keyframes.find((k) => k.id === kfId)
    if (!grabbed) return
    const startX = e.clientX
    const startTime = grabbed.timeMs
    // snap candidates: every other keyframe, the playhead, and both ends
    const others = project.keyframes.filter((k) => !ids.includes(k.id)).map((k) => k.timeMs)
    const stops = [...others, timeMs, 0, duration]

    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let last = startTime

    const onMove = (ev: PointerEvent) => {
      const perPx = msPerPx()
      let target = startTime + (ev.clientX - startX) * perPx
      if (!ev.altKey) {
        // magnet to a nearby stop, else fall back to the frame grid
        const snap = stops.find((s) => Math.abs(s - target) < SNAP_PX * perPx)
        target = snap ?? Math.round(target / frameMs) * frameMs
      }
      target = Math.min(duration, Math.max(0, target))
      const delta = target - last
      if (Math.abs(delta) < 0.5) return
      st().moveKeyframesBy(ids, delta)
      last = target
      setDragTime(target)
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      setDragTime(null)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  // ----- marquee selection over the lanes -----

  const startMarquee = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const base = e.shiftKey ? selectedKfIds : []
    if (!e.shiftKey) st().selectKeyframes([])
    const box: Marquee = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, additive: e.shiftKey }
    let moved = false

    const onMove = (ev: PointerEvent) => {
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
    }
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      setMarquee(null)
      // a click on empty lane space (no drag) moves the playhead there
      if (!moved) scrubFrom(ev.clientX)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
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
    const sel = project.keyframes.filter((k) => selectedKfIds.includes(k.id))
    return sel[0]?.easing ?? 'smooth'
  }

  const pctOf = (ms: number) => `${(ms / duration) * 100}%`
  const secs = Math.floor(duration / 1000)

  return (
    <footer
      className="relative flex shrink-0 flex-col rounded-lg border border-(--line) bg-(--raised)"
      style={{ height: collapsed ? TRANSPORT_H : height }}
    >
      {/* resize grip: sits on the top edge, canvas above gives up the space */}
      <div
        onPointerDown={onResizeStart}
        onDoubleClick={() => setHeight(210)}
        title="Drag to resize the timeline"
        className="group absolute -top-1 right-0 left-0 z-20 flex h-2 cursor-ns-resize items-center justify-center"
      >
        <span className="h-0.5 w-10 rounded-full bg-transparent transition-colors group-hover:bg-(--tx3)" />
      </div>

      {/* transport bar */}
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <span className="rounded-xs bg-(--panel2) px-2 py-1 t-body-sm text-(--tx) tabular-nums">
          {fmtTime(timeMs)} / {fmtTime(duration)}
        </span>

        <div className="flex items-center gap-1">
          <MiniButton title="Step back one frame" onClick={() => st().setTime(Math.max(0, timeMs - frameMs))}>
            <SkipBack size={13} />
          </MiniButton>
          <button
            onClick={() => st().setPlaying(!playing)}
            className="flex h-8 items-center rounded-md bg-(--accent-fill) px-3.5 t-button text-(--accent-tx) hover:opacity-90"
            title="Play / pause (Space)"
          >
            {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
          </button>
          <MiniButton title="Step forward one frame" onClick={() => st().setTime(Math.min(duration, timeMs + frameMs))}>
            <SkipForward size={13} />
          </MiniButton>
          <MiniButton title="Loop playback" active={loop} onClick={() => st().setLoop(!loop)}>
            <Repeat size={13} />
          </MiniButton>
        </div>

        <label className="ml-2 flex items-center gap-1 t-caption text-(--tx3)">
          DUR
          <input
            type="number"
            min={0.5}
            max={30}
            step={0.5}
            value={duration / 1000}
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

        <div className="ml-auto flex items-center gap-1">
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
              const ids = selectedKfIds.length > 0 ? selectedKfIds : project.keyframes.map((k) => k.id)
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
            title="Clear all keyframes"
            onClick={() => {
              void ui
                .confirm({
                  title: 'Clear all keyframes?',
                  body: 'Every keyframe on every track goes. Ctrl+Z brings them back.',
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
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-2">
          {/* ruler + lanes share one horizontal coordinate space */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-stretch">
              <div className="w-36 shrink-0" />
              <div
                ref={laneRef}
                onPointerDown={startScrub}
                style={{ height: RULER_H }}
                className="relative flex-1 cursor-col-resize rounded-t bg-(--panel2)"
              >
                {Array.from({ length: secs + 1 }, (_, i) => {
                  // A tick sitting on (or nearly on) 100% has no room to its
                  // right, so its label hangs to the left of the line instead of
                  // starting where the ruler ends. Judged on position, not
                  // index: at a 3.5s duration the last tick is only 86% across
                  // and reads better numbered the normal way, after its line.
                  const last = (i * 1000) / duration > 0.96
                  return (
                    <span
                      key={i}
                      className="absolute top-0 h-full border-l border-(--line)"
                      style={{ left: pctOf(i * 1000) }}
                    >
                      <span
                        className={`absolute top-0 t-caption whitespace-nowrap text-(--tx3) ${
                          last ? 'right-0 pr-1' : 'left-0 pl-1'
                        }`}
                      >
                        {i}s
                      </span>
                    </span>
                  )
                })}
              </div>
            </div>

            {/* tracks */}
            <div ref={tracksRef} className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
              {tracks.length === 0 && (
                <p className="py-3 text-center t-caption text-(--tx3)">
                  No keyframes yet. Toggle a ◆ next to any property, or apply an animation preset.
                </p>
              )}
              {tracks.map((track, ti) => (
                <div
                  key={track.target}
                  className={`flex shrink-0 items-center ${ti % 2 ? 'bg-white/[0.015]' : ''}`}
                  style={{ height: ROW_H }}
                >
                  <button
                    className="group flex w-36 shrink-0 items-center gap-1 truncate px-1 text-left t-caption text-(--tx2) hover:text-(--tx)"
                    title="Remove this track (bakes the current value)"
                    onClick={() => st().toggleTrack(track.target)}
                  >
                    <Trash2 size={10} className="shrink-0 opacity-0 group-hover:opacity-100" />
                    <span className="truncate">{track.label}</span>
                  </button>
                  <div
                    onPointerDown={startMarquee}
                    onDoubleClick={(e) => st().addKeyframeAt(track.target, msFromClientX(e.clientX))}
                    title="Drag to box-select · double-click to add a keyframe"
                    className="relative h-full flex-1 bg-(--panel2)"
                  >
                    {/* connector between the first and last key on the lane */}
                    {track.kfs.length > 1 && (
                      <span
                        className="pointer-events-none absolute top-1/2 h-px -translate-y-1/2 bg-(--line2)"
                        style={{
                          left: pctOf(track.kfs[0].timeMs),
                          right: `${100 - (track.kfs[track.kfs.length - 1].timeMs / duration) * 100}%`,
                        }}
                      />
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
                          // generous invisible hit area around a small diamond
                          className="absolute top-1/2 flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center active:cursor-grabbing"
                          style={{ left: pctOf(k.timeMs) }}
                        >
                          <span
                            className={`${KF_MARK} ${
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
            <div className="pointer-events-none absolute inset-y-0 right-0 left-36 z-10">
              <div className="absolute inset-y-0 w-px bg-(--accent)" style={{ left: pctOf(timeMs) }}>
                <span className="absolute top-0 -left-[4px] h-0 w-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-(--accent)" />
              </div>
            </div>
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
