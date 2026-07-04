import { useMemo, useRef, useState } from 'react'
import { useStudio } from '../store'
import { targetLabel } from '../lib/evaluator'
import { EASING_NAMES } from '../lib/easing'
import { ANIMATION_PRESETS } from '../lib/presets'
import { MiniButton } from './controls'
import type { EasingName } from '../types'

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `00:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function Timeline() {
  const project = useStudio((s) => s.project)
  const timeMs = useStudio((s) => s.timeMs)
  const playing = useStudio((s) => s.playing)
  const loop = useStudio((s) => s.loop)
  const selectedKfIds = useStudio((s) => s.selectedKeyframeIds)
  const st = useStudio.getState

  const [collapsed, setCollapsed] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const rulerRef = useRef<HTMLDivElement>(null)
  const dragKf = useRef<string | null>(null)

  const duration = project.durationMs

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

  const msFromEvent = (e: React.PointerEvent) => {
    const el = rulerRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    return frac * duration
  }

  const scrub = (e: React.PointerEvent) => {
    st().setPlaying(false)
    st().setTime(msFromEvent(e))
  }

  const easingOfSelection = (): EasingName => {
    const sel = project.keyframes.filter((k) => selectedKfIds.includes(k.id))
    return sel[0]?.easing ?? 'smooth'
  }

  return (
    <footer className="shrink-0 border-t border-(--line) bg-(--panel)">
      {/* transport bar */}
      <div className="flex h-11 items-center gap-2 px-3">
        <span className="rounded bg-(--panel2) px-2 py-1 font-mono text-[11px] text-(--tx)">
          {fmtTime(timeMs)} / {fmtTime(duration)}
        </span>

        <div className="flex items-center gap-1">
          <MiniButton title="Step back" onClick={() => st().setTime(Math.max(0, timeMs - 1000 / project.fps))}>
            ◁
          </MiniButton>
          <button
            onClick={() => st().setPlaying(!playing)}
            className="rounded bg-orange-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-orange-500"
            title="Play / pause (Space)"
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <MiniButton title="Step forward" onClick={() => st().setTime(Math.min(duration, timeMs + 1000 / project.fps))}>
            ▷
          </MiniButton>
          <MiniButton title="Loop" active={loop} onClick={() => st().setLoop(!loop)}>
            ⟲
          </MiniButton>
        </div>

        <label className="ml-2 flex items-center gap-1 text-[10px] text-(--tx3)">
          DUR
          <input
            type="number"
            min={0.5}
            max={30}
            step={0.5}
            value={duration / 1000}
            onChange={(e) => st().setDuration(Number(e.target.value) * 1000)}
            className="w-13 rounded border border-(--line) bg-transparent px-1 py-0.5 text-right font-mono text-[11px] text-(--tx)"
          />
          s
        </label>
        <label className="flex items-center gap-1 text-[10px] text-(--tx3)">
          FPS
          <select
            value={project.fps}
            onChange={(e) => st().setFps(Number(e.target.value))}
            className="rounded border border-(--line) bg-(--panel) px-1 py-0.5 text-[11px] text-(--tx)"
          >
            {[24, 30, 60].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <div className="relative ml-auto flex items-center gap-1">
          <MiniButton onClick={() => setPresetsOpen(!presetsOpen)} active={presetsOpen}>
            Presets ▾
          </MiniButton>
          {presetsOpen && (
            <div className="absolute right-0 bottom-9 z-30 flex w-44 flex-col gap-1 rounded-lg border border-(--line) bg-(--panel) p-2 shadow-xl">
              {ANIMATION_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    st().applyAnimationPreset(p.id)
                    setPresetsOpen(false)
                  }}
                  className="rounded px-2 py-1.5 text-left text-[11px] text-(--tx2) hover:bg-orange-600/15 hover:text-(--tx)"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}

          <select
            title="Easing for selected keyframes"
            value={easingOfSelection()}
            onChange={(e) => {
              const ids = selectedKfIds.length > 0 ? selectedKfIds : project.keyframes.map((k) => k.id)
              st().setKeyframeEasing(ids, e.target.value as EasingName)
            }}
            className="rounded border border-(--line) bg-(--panel) px-1 py-1 text-[10px] tracking-wide text-(--tx2) uppercase"
          >
            {EASING_NAMES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>

          <MiniButton onClick={() => st().selectKeyframes(project.keyframes.map((k) => k.id))}>
            Select all
          </MiniButton>
          <MiniButton
            title="Add keyframes for all camera properties at the playhead"
            onClick={() => {
              for (const prop of ['tiltX', 'tiltY', 'zoom', 'panX', 'panY'] as const)
                st().addKeyframeAt(`camera.${prop}`)
            }}
          >
            + Add KF
          </MiniButton>
          <MiniButton title="First frame == last frame" onClick={() => st().makeLoopFriendly()}>
            Loopify
          </MiniButton>
          <MiniButton title="Clear all keyframes" onClick={() => st().clearAllKeyframes()}>
            Clear
          </MiniButton>
          <MiniButton title="Collapse" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? '▴' : '▾'}
          </MiniButton>
        </div>
      </div>

      {!collapsed && (
        <div className="px-3 pb-2">
          {/* ruler */}
          <div
            ref={rulerRef}
            className="relative h-6 cursor-col-resize rounded bg-(--panel2)"
            onPointerDown={(e) => {
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
              scrub(e)
            }}
            onPointerMove={(e) => {
              if ((e.buttons & 1) === 1) scrub(e)
            }}
          >
            {Array.from({ length: Math.floor(duration / 1000) + 1 }, (_, i) => (
              <span
                key={i}
                className="absolute top-0 h-full border-l border-(--line) pl-1 text-[8px] text-(--tx3)"
                style={{ left: `${((i * 1000) / duration) * 100}%` }}
              >
                {i}s
              </span>
            ))}
            {/* playhead */}
            <span
              className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-orange-500"
              style={{ left: `${(timeMs / duration) * 100}%` }}
            >
              <span className="absolute -top-0.5 -left-[5px] h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-orange-500" />
            </span>
          </div>

          {/* tracks */}
          <div className="mt-1 flex max-h-28 flex-col gap-0.5 overflow-y-auto">
            {tracks.length === 0 && (
              <p className="py-1 text-center text-[10px] text-(--tx3)">
                No keyframes yet — toggle a ◆ next to any property, or apply an animation preset.
              </p>
            )}
            {tracks.map((track) => (
              <div key={track.target} className="flex items-center gap-2">
                <button
                  className="w-36 shrink-0 truncate rounded px-1 text-left text-[9px] tracking-wide text-(--tx3) uppercase hover:text-red-400"
                  title="Click to remove this track"
                  onClick={() => st().toggleTrack(track.target)}
                >
                  {track.label}
                </button>
                <div className="relative h-4 flex-1 rounded bg-(--panel2)">
                  {track.kfs.map((k) => (
                    <button
                      key={k.id}
                      title={`${fmtTime(k.timeMs)} · ${k.value.toFixed(2)} · ${k.easing}`}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        dragKf.current = k.id
                        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                        st().selectKeyframes(
                          e.shiftKey ? [...new Set([...selectedKfIds, k.id])] : [k.id],
                        )
                      }}
                      onPointerMove={(e) => {
                        if (dragKf.current !== k.id || (e.buttons & 1) !== 1) return
                        const ruler = rulerRef.current
                        if (!ruler) return
                        const r = ruler.getBoundingClientRect()
                        const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
                        st().moveKeyframe(k.id, frac * duration)
                      }}
                      onPointerUp={() => {
                        dragKf.current = null
                      }}
                      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${(k.timeMs / duration) * 100}%` }}
                    >
                      <span
                        className={`block h-2 w-2 rotate-45 ${
                          selectedKfIds.includes(k.id)
                            ? 'bg-orange-400 ring-2 ring-orange-500/50'
                            : 'bg-orange-600'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </footer>
  )
}
