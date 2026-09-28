/**
 * Studio's timeline, rebuilt for a finger.
 *
 * The desktop timeline is a resizable strip of lanes with diamonds a few
 * pixels across, dragged with snapping, marquee-selected and nudged with the
 * arrow keys. None of that survives a fingertip. What does is the same model
 * with the geometry turned up:
 *
 *   The scrubber   a full-width bar you drag through time, with the moments
 *                  that have keyframes marked on it. A tap jumps there.
 *   Presets        a whole move in one press, which is how most animation on
 *                  a phone should start: Orbit, Push in, and the rest.
 *   Lanes          one row per animated property, keyframes as targets big
 *                  enough to hit. Tap one to jump to it and pick it; drag it
 *                  sideways to retime it. The picked one gets its easing and a
 *                  delete button in a bar of its own.
 *   The rest       adding keys, Loopify, clearing, the shot's length and frame
 *                  rate, and the shots themselves.
 *
 * Every drag here waits to see which way it is going before it takes the
 * finger, the same rule as the sliders: sideways is the timeline's, up and
 * down is the sheet scrolling.
 */

import { useMemo, useRef, type ReactNode } from 'react'
import {
  ChevronFirst,
  ChevronLast,
  Infinity as InfinityIcon,
  Pause,
  Play,
  Plus,
  Repeat,
  StepBack,
  StepForward,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useStudio } from '../../store'
import { activeShot } from '../../lib/sequence'
import { targetLabel } from '../../lib/evaluator'
import { EASING_NAMES } from '../../lib/easing'
import { ANIMATION_PRESETS } from '../../lib/presets'
import { endEditRun } from '../../lib/history'
import { ui } from '../../lib/ui'
import { Dropdown, Segments, SliderRow } from '../controls'
import type { EasingName } from '../../types'

const st = useStudio.getState

const secs = (ms: number) => `${(ms / 1000).toFixed(2)}s`

/**
 * A horizontal drag on a lane, direction-locked.
 *
 * Calls `onTap` for a press that never moved, `onDrag` with the finger's
 * position as a fraction of the lane once it has clearly gone sideways, and
 * lets a vertical swipe go to the page.
 */
function laneGesture(
  e: React.PointerEvent,
  lane: HTMLElement,
  { onTap, onDrag, onEnd }: { onTap: (frac: number) => void; onDrag: (frac: number) => void; onEnd?: () => void },
) {
  const el = e.currentTarget as HTMLElement
  const x0 = e.clientX
  const y0 = e.clientY
  let phase: 'wait' | 'drag' | 'gone' = 'wait'
  const frac = (x: number) => {
    const r = lane.getBoundingClientRect()
    return Math.min(1, Math.max(0, (x - r.left) / Math.max(1, r.width)))
  }
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0
    const dy = ev.clientY - y0
    if (phase === 'wait') {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) return finish('gone')
      if (Math.abs(dx) < 5) return
      phase = 'drag'
      el.setPointerCapture(ev.pointerId)
    }
    onDrag(frac(ev.clientX))
  }
  const up = (ev: PointerEvent) => {
    if (phase === 'wait') onTap(frac(ev.clientX))
    finish('gone')
  }
  const finish = (p: 'gone') => {
    const dragged = phase === 'drag'
    phase = p
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', cancel)
    if (dragged) onEnd?.()
  }
  const cancel = () => finish('gone')
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', cancel)
}

function Label({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
      <p className="t-eyebrow text-(--tx3) uppercase">{children}</p>
      {action}
    </div>
  )
}

function Block({ children }: { children: ReactNode }) {
  return <div className="border-b border-(--line) px-4 py-4 last:border-b-0">{children}</div>
}

function RoundButton({
  label,
  onClick,
  children,
  on,
  primary,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  on?: boolean
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      className={`m-press flex h-11 items-center justify-center rounded-full transition-colors ${
        primary
          ? 'w-16 bg-(--accent-fill) text-(--accent-tx)'
          : on
            ? 'w-11 bg-(--sel) text-(--tx)'
            : 'w-11 text-(--tx2) active:bg-(--panel3)'
      }`}
    >
      {children}
    </button>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Plus
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`m-press flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md bg-(--field) t-body-sm transition-colors active:bg-(--field-h) ${
        danger ? 'text-(--danger)' : 'text-(--tx2)'
      }`}
    >
      <Icon size={15} strokeWidth={1.9} />
      {label}
    </button>
  )
}

/* ------------------------------------------------------------ transport */

function Transport() {
  const playing = useStudio((s) => s.playing)
  const loop = useStudio((s) => s.loop)
  const timeMs = useStudio((s) => s.timeMs)
  const fps = useStudio((s) => s.project.fps)
  const shot = useStudio((s) => activeShot(s.project))
  const lane = useRef<HTMLDivElement>(null)

  const dur = Math.max(1, shot.durationMs)
  const frame = 1000 / fps
  const at = Math.min(1, Math.max(0, timeMs / dur))
  const stops = useMemo(
    () => [...new Set(shot.keyframes.map((k) => Math.round(k.timeMs)))].sort((a, b) => a - b),
    [shot.keyframes],
  )

  const seek = (ms: number) => {
    st().setPlaying(false)
    st().setTime(Math.min(dur, Math.max(0, ms)))
  }
  const toKey = (dir: -1 | 1) => {
    const next =
      dir < 0 ? [...stops].reverse().find((t) => t < timeMs - 1) : stops.find((t) => t > timeMs + 1)
    seek(next ?? (dir < 0 ? 0 : dur))
  }

  return (
    <Block>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="t-body font-semibold tabular-nums text-(--tx)">{secs(timeMs)}</span>
        <span className="t-caption tabular-nums text-(--tx3)">of {secs(dur)}</span>
      </div>

      {/* the scrubber: drag through time, tap to jump */}
      <div
        ref={lane}
        role="slider"
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={dur}
        aria-valuenow={Math.round(timeMs)}
        onPointerDown={(e) =>
          lane.current &&
          laneGesture(e, lane.current, { onTap: (f) => seek(f * dur), onDrag: (f) => seek(f * dur) })
        }
        className="relative h-12 touch-pan-y overflow-hidden rounded-md bg-(--field) select-none"
      >
        <div className="absolute inset-y-0 left-0 bg-(--sel)" style={{ width: `${at * 100}%` }} />
        {/* the moments something is keyed, as ticks along the floor */}
        {stops.map((t) => (
          <span
            key={t}
            className="absolute bottom-1.5 h-2 w-2 -translate-x-1/2 rotate-45 rounded-[2px] bg-(--tx3)"
            style={{ left: `${(t / dur) * 100}%` }}
          />
        ))}
        <span
          className="absolute inset-y-1.5 w-1 -translate-x-1/2 rounded-full bg-(--accent)"
          style={{ left: `${at * 100}%` }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <RoundButton label="Previous keyframe" onClick={() => toKey(-1)}>
          <ChevronFirst size={19} strokeWidth={1.9} />
        </RoundButton>
        <RoundButton label="Back one frame" onClick={() => seek(timeMs - frame)}>
          <StepBack size={18} strokeWidth={1.9} />
        </RoundButton>
        <RoundButton label={playing ? 'Pause' : 'Play'} primary onClick={() => st().setPlaying(!playing)}>
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </RoundButton>
        <RoundButton label="Forward one frame" onClick={() => seek(timeMs + frame)}>
          <StepForward size={18} strokeWidth={1.9} />
        </RoundButton>
        <RoundButton label="Next keyframe" onClick={() => toKey(1)}>
          <ChevronLast size={19} strokeWidth={1.9} />
        </RoundButton>
        <RoundButton label="Loop" on={loop} onClick={() => st().setLoop(!loop)}>
          <Repeat size={17} strokeWidth={1.9} />
        </RoundButton>
      </div>
    </Block>
  )
}

/* -------------------------------------------------------------- presets */

function Presets() {
  return (
    <Block>
      <Label>Presets</Label>
      <div className="grid grid-cols-3 gap-2">
        {ANIMATION_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              st().applyAnimationPreset(p.id)
              st().setTime(0)
              st().setPlaying(true)
            }}
            className="m-press flex h-11 items-center justify-center gap-1.5 truncate rounded-md bg-(--field) px-2 t-body-sm text-(--tx2) active:bg-(--field-h)"
          >
            <Wand2 size={13} strokeWidth={1.9} className="shrink-0 text-(--tx3)" />
            <span className="truncate">{p.name}</span>
          </button>
        ))}
      </div>
    </Block>
  )
}

/* ---------------------------------------------------------------- lanes */

function Lane({ target, label }: { target: string; label: string }) {
  const shot = useStudio((s) => activeShot(s.project))
  const selected = useStudio((s) => s.selectedKeyframeIds)
  const fps = useStudio((s) => s.project.fps)
  const timeMs = useStudio((s) => s.timeMs)
  const lane = useRef<HTMLDivElement>(null)
  const kfs = shot.keyframes.filter((k) => k.target === target && k.timeMs <= shot.durationMs + 1)
  const dur = Math.max(1, shot.durationMs)
  const frame = 1000 / fps

  const grab = (e: React.PointerEvent, id: string, startMs: number) => {
    e.stopPropagation()
    if (!lane.current) return
    let last = startMs
    laneGesture(e, lane.current, {
      onTap: () => {
        st().selectKeyframes([id])
        st().setPlaying(false)
        st().setTime(startMs)
      },
      onDrag: (f) => {
        if (last === startMs) st().selectKeyframes([id])
        // on the frame grid, so a retimed key always lands on a real frame
        const to = Math.min(dur, Math.max(0, Math.round((f * dur) / frame) * frame))
        const delta = to - last
        if (Math.abs(delta) < 0.5) return
        st().moveKeyframesBy([id], delta)
        st().setTime(to)
        last = to
      },
      onEnd: () => endEditRun(),
    })
  }

  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1 truncate t-caption text-(--tx2)">{label}</p>
      <div
        ref={lane}
        onPointerDown={(e) =>
          lane.current &&
          laneGesture(e, lane.current, {
            // a tap on empty lane moves the playhead, as it does on the desktop
            onTap: (f) => {
              st().selectKeyframes([])
              st().setPlaying(false)
              st().setTime(f * dur)
            },
            onDrag: () => {},
          })
        }
        className="relative h-10 touch-pan-y rounded-md bg-(--field) select-none"
      >
        <span
          className="pointer-events-none absolute inset-y-0 w-px bg-(--accent) opacity-70"
          style={{ left: `${Math.min(1, timeMs / dur) * 100}%` }}
        />
        {kfs.map((k) => {
          const on = selected.includes(k.id)
          return (
            <button
              key={k.id}
              aria-label={`${label} keyframe at ${secs(k.timeMs)}`}
              aria-pressed={on}
              onPointerDown={(e) => grab(e, k.id, k.timeMs)}
              className="absolute top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 touch-pan-y items-center justify-center"
              style={{ left: `${(k.timeMs / dur) * 100}%` }}
            >
              <span
                className={`h-3.5 w-3.5 rotate-45 rounded-[3px] transition-transform ${
                  on ? 'scale-125 bg-(--accent) ring-2 ring-(--accent-soft)' : 'bg-(--tx2)'
                }`}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Keyframes() {
  const shot = useStudio((s) => activeShot(s.project))
  const selected = useStudio((s) => s.selectedKeyframeIds)
  const picked = shot.keyframes.filter((k) => selected.includes(k.id))

  const tracks = useMemo(() => {
    const targets = [...new Set(shot.keyframes.map((k) => k.target))]
    return targets
      .map((t) => ({ target: t, label: targetLabel(t, shot.scene.devices, shot.overlays) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [shot.keyframes, shot.scene.devices, shot.overlays])

  const easing: EasingName = (picked[0] ?? shot.keyframes[0])?.easing ?? 'smooth'

  return (
    <Block>
      <Label>Keyframes</Label>

      {tracks.length === 0 ? (
        <p className="mb-3 rounded-md bg-(--field) px-3 py-3 t-body-sm text-(--tx3)">
          Nothing moves yet. Pick a preset above, or set the camera where it should start, press Key the
          camera, move the playhead, change the view and key it again.
        </p>
      ) : (
        <div className="mb-3">
          {tracks.map((t) => (
            <Lane key={t.target} target={t.target} label={t.label} />
          ))}
        </div>
      )}

      {/* the picked keyframe's own bar: when it is, how it eases, and away */}
      {picked.length > 0 && (
        <div className="m-fade mb-3 rounded-xl border border-(--line) p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="t-body-sm font-medium text-(--tx)">
              {picked.length === 1
                ? `${targetLabel(picked[0].target, shot.scene.devices, shot.overlays)} at ${secs(picked[0].timeMs)}`
                : `${picked.length} keyframes`}
            </span>
            <button
              onClick={() => st().removeKeyframes(picked.map((k) => k.id))}
              aria-label="Delete keyframe"
              className="m-press flex h-9 w-9 items-center justify-center rounded-full text-(--danger) active:bg-(--panel3)"
            >
              <Trash2 size={16} strokeWidth={1.9} />
            </button>
          </div>
          <Dropdown
            title="Easing"
            value={easing}
            onChange={(v) => st().setKeyframeEasing(picked.map((k) => k.id), v as EasingName)}
            options={EASING_NAMES.map((e) => ({ value: e.id, label: `Easing · ${e.label}` }))}
          />
        </div>
      )}

      {picked.length === 0 && tracks.length > 0 && (
        <div className="mb-3">
          <Dropdown
            title="Easing for every keyframe"
            value={easing}
            onChange={(v) => st().setKeyframeEasing(shot.keyframes.map((k) => k.id), v as EasingName)}
            options={EASING_NAMES.map((e) => ({ value: e.id, label: `All easing · ${e.label}` }))}
          />
        </div>
      )}

      <div className="flex gap-2">
        <ActionButton
          icon={Plus}
          label="Key the camera"
          onClick={() => {
            for (const prop of ['tiltX', 'tiltY', 'zoom', 'panX', 'panY'] as const)
              st().addKeyframeAt(`camera.${prop}`)
            ui.toast(`Camera keyed at ${secs(st().timeMs)}`)
          }}
        />
        <ActionButton icon={InfinityIcon} label="Loopify" onClick={() => st().makeLoopFriendly()} />
        {tracks.length > 0 && (
          <ActionButton
            icon={Trash2}
            label="Clear"
            danger
            onClick={() => {
              void ui
                .confirm({
                  title: `Clear keyframes in ${shot.name}?`,
                  body: 'Every keyframe on every track of this shot goes. Undo brings them back.',
                  confirmLabel: 'Clear all',
                  danger: true,
                })
                .then((ok) => ok && st().clearAllKeyframes())
            }}
          />
        )}
      </div>
    </Block>
  )
}

/* ---------------------------------------------------------- shot + film */

function Length() {
  const shot = useStudio((s) => activeShot(s.project))
  const fps = useStudio((s) => s.project.fps)
  return (
    <Block>
      <Label>Length</Label>
      <SliderRow
        label="Duration"
        value={shot.durationMs / 1000}
        min={0.5}
        max={30}
        step={0.5}
        format={(v) => `${v.toFixed(1)}s`}
        onChange={(v) => st().setDuration(v * 1000)}
      />
      <div className="mt-2">
        <Segments
          options={[24, 30, 60].map((f) => ({ id: String(f), label: `${f} fps` }))}
          value={String(fps)}
          onChange={(v) => st().setFps(Number(v))}
        />
      </div>
    </Block>
  )
}

function Shots() {
  const shots = useStudio((s) => s.project.shots)
  const activeId = useStudio((s) => s.project.activeShotId)
  const scrubMode = useStudio((s) => s.scrubMode)
  return (
    <Block>
      <Label>Shots</Label>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
        {shots.map((s, i) => (
          <button
            key={s.id}
            onClick={() => st().selectShot(s.id, 0)}
            aria-pressed={s.id === activeId}
            className={`m-press flex h-11 min-w-16 shrink-0 flex-col items-center justify-center rounded-md px-3 transition-colors ${
              s.id === activeId ? 'bg-(--sel) text-(--tx)' : 'bg-(--field) text-(--tx2)'
            }`}
          >
            <span className="t-body-sm font-medium tabular-nums">{i + 1}</span>
            <span className="t-caption leading-none text-(--tx3) tabular-nums">{secs(s.durationMs)}</span>
          </button>
        ))}
        <button
          onClick={() => st().addShot()}
          aria-label="Add a shot"
          className="m-press flex h-11 w-12 shrink-0 items-center justify-center rounded-md border border-dashed border-(--line2) text-(--tx2)"
        >
          <Plus size={17} strokeWidth={1.9} />
        </button>
      </div>
      {shots.length > 1 && (
        <div className="mt-3">
          <Segments
            options={[
              { id: 'shot', label: 'Play this shot' },
              { id: 'sequence', label: 'Play the film' },
            ]}
            value={scrubMode}
            onChange={(v) => st().setScrubMode(v)}
          />
        </div>
      )}
    </Block>
  )
}

export function StudioAnimate() {
  return (
    <>
      <Transport />
      <Presets />
      <Keyframes />
      <Length />
      <Shots />
    </>
  )
}
