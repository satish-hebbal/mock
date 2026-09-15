import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Copy, Plus, Scissors, Trash2 } from 'lucide-react'
import { useStudio } from '../store'
import { cssBackground } from '../lib/backgroundCss'
import { SliderRow } from './controls'
import { MAX_TRANSITION_MS, TRANSITION_LABELS, sequenceDuration, sequenceLayout } from '../lib/sequence'
import { ui } from '../lib/ui'
import type { TransitionKind } from '../types'

/*
 * The film, as a strip you can take hold of.
 *
 * Every shot is a block on one running time, so the thing you are deciding,
 * how long this take holds before the next one starts, is the thing you drag.
 * The blocks are laid out from the same `sequenceLayout` the exporter walks, so
 * what the strip says about the running order is what will come out of the
 * encoder.
 */

const CHIP_H = 44
const EDGE = 8 // grab width of a chip's trailing edge

/** Runs one pointer drag with the cursor held across the whole document. */
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

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`

/** The mark a transition wears on the strip, and in the popover that sets it. */
const TRANSITION_GLYPH: Record<TransitionKind, string> = {
  cut: '│',
  dissolve: '⨯',
  fadeBlack: '◐',
  fadeWhite: '◑',
}

function TransitionPopover({
  shotId,
  kind,
  durationMs,
  onClose,
}: {
  shotId: string
  kind: TransitionKind
  durationMs: number
  onClose: () => void
}) {
  const st = useStudio.getState
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-1/2 z-40 mb-2 flex w-56 -translate-x-1/2 flex-col gap-2 rounded-lg border border-(--line) bg-(--raised) p-2 shadow-lg"
    >
      <p className="t-eyebrow text-(--tx3) uppercase">Transition in</p>
      <div className="flex flex-col gap-0.5">
        {(Object.keys(TRANSITION_LABELS) as TransitionKind[]).map((k) => (
          <button
            key={k}
            onClick={() => st().setTransition(shotId, { kind: k })}
            className={`flex items-center gap-2 rounded-xs px-2 py-1.5 text-left t-body-sm ${
              k === kind ? 'bg-(--sel) text-(--tx)' : 'text-(--tx2) hover:bg-(--panel3) hover:text-(--tx)'
            }`}
          >
            <span className="w-3 text-center text-(--tx3)">{TRANSITION_GLYPH[k]}</span>
            {TRANSITION_LABELS[k]}
          </button>
        ))}
      </div>
      {kind !== 'cut' && (
        <>
          {/* the house scrub field, in seconds like every other duration here */}
          <SliderRow
            label="Length"
            value={durationMs / 1000}
            min={0.1}
            max={MAX_TRANSITION_MS / 1000}
            step={0.05}
            format={(v) => `${v.toFixed(2)}s`}
            onChange={(v) => st().setTransition(shotId, { durationMs: Math.round(v * 1000) })}
          />
          <p className="t-caption text-(--tx3)">
            A blend overlaps both takes, so it shortens the film by {secs(durationMs)}.
            {kind === 'dissolve' &&
              ' Playback cuts at its midpoint; the blend itself is rendered on export.'}
          </p>
        </>
      )}
    </div>
  )
}

export function ShotRibbon() {
  const project = useStudio((s) => s.project)
  const thumbs = useStudio((s) => s.shotThumbs)
  const assets = useStudio((s) => s.assets)
  const st = useStudio.getState

  const stripRef = useRef<HTMLDivElement>(null)
  const [openTransition, setOpenTransition] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  // the drag's own copy: the handler that commits the move runs from a native
  // listener set up once, so it cannot see later renders' state
  const dropRef = useRef<number | null>(null)

  const layout = useMemo(() => sequenceLayout(project), [project])
  const total = Math.max(1, sequenceDuration(project))

  /*
   * A chip runs until the next one begins, not to its own end. With a blend the
   * two overlap in time, and a strip where blocks sit on top of each other
   * reads as a bug rather than as a dissolve; the badge on the seam is what
   * says those frames are shared.
   */
  const chips = layout.map((p, i) => {
    const nextStart = layout[i + 1]?.start ?? p.end
    return { ...p, left: p.start / total, width: Math.max(0.001, (nextStart - p.start) / total) }
  })

  // the thumbnail of the shot on screen goes stale as you work; refresh it
  // whenever the ribbon is shown and whenever you land on a different take
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => st().captureShotThumb())
    return () => cancelAnimationFrame(id)
  }, [project.activeShotId, st])

  const msPerPx = () => total / Math.max(1, stripRef.current?.getBoundingClientRect().width ?? 1)

  // ----- drag a chip's trailing edge to retime it -----

  const startResize = (e: React.PointerEvent, shotId: string, startMs: number) => {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    /*
     * The scale is fixed for the length of the drag. Retiming a shot changes
     * the running time it is being measured against, so recomputing it each
     * move made the strip pull away from the pointer as it grew.
     */
    const perPx = msPerPx()
    beginDrag(e, 'ew-resize', (ev) => {
      st().setShotDuration(shotId, startMs + (ev.clientX - startX) * perPx)
    })
  }

  // ----- drag a chip sideways to reorder -----

  const startMove = (e: React.PointerEvent, shotId: string, index: number) => {
    if (e.button !== 0) return
    const startX = e.clientX
    let moved = false

    beginDrag(
      e,
      'grabbing',
      (ev) => {
        if (!moved && Math.abs(ev.clientX - startX) < 6) return
        moved = true
        const box = stripRef.current?.getBoundingClientRect()
        if (!box) return
        const at = (ev.clientX - box.left) / Math.max(1, box.width)
        // land where the pointer is, measured against each chip's midpoint
        let target = chips.length - 1
        for (let i = 0; i < chips.length; i++) {
          if (at < chips[i].left + chips[i].width / 2) {
            target = i
            break
          }
        }
        dropRef.current = target
        setDropAt(target)
      },
      () => {
        const target = dropRef.current
        if (moved && target !== null && target !== index) st().moveShot(shotId, target)
        else if (!moved) st().selectShot(shotId, 0)
        dropRef.current = null
        setDropAt(null)
      },
    )
  }

  const removeShot = (id: string, name: string) => {
    void ui
      .confirm({
        title: `Delete ${name}?`,
        body: 'Its scene, its animation and its overlays go with it. Ctrl+Z brings them back.',
        confirmLabel: 'Delete shot',
        danger: true,
      })
      .then((ok) => {
        if (ok) st().removeShot(id)
      })
  }

  return (
    <div className="flex shrink-0 items-stretch gap-2 pb-1.5">
      <div className="flex w-36 shrink-0 items-center gap-1 pr-1">
        <span className="t-eyebrow text-(--tx3) uppercase">Shots</span>
        <span className="rounded-xs bg-(--panel2) px-1.5 py-0.5 t-caption text-(--tx2) tabular-nums">
          {project.shots.length}
        </span>
        <span className="ml-auto t-caption text-(--tx3) tabular-nums">{secs(total)}</span>
      </div>

      <div ref={stripRef} className="relative flex-1" style={{ height: CHIP_H }}>
        {chips.map((c, i) => {
          const shot = c.shot
          const active = shot.id === project.activeShotId
          const thumb = thumbs[shot.id]
          const bgUrl = shot.scene.background.imageAssetId
            ? (assets[shot.scene.background.imageAssetId]?.url ?? null)
            : null
          return (
            <div
              key={shot.id}
              className="absolute inset-y-0"
              style={{ left: `${c.left * 100}%`, width: `${c.width * 100}%` }}
            >
              <div
                onPointerDown={(e) => startMove(e, shot.id, i)}
                onDoubleClick={() => setRenaming(shot.id)}
                title={`${shot.name} · ${secs(shot.durationMs)}`}
                className={`group relative h-full cursor-grab overflow-hidden rounded-md border transition-colors active:cursor-grabbing ${
                  active
                    ? 'border-(--accent) ring-1 ring-(--accent-soft)'
                    : 'border-(--line) hover:border-(--line2)'
                }`}
                style={{ marginRight: 2 }}
              >
                {/* the shot's own backdrop, with its last rendered frame over it */}
                <div className="absolute inset-0" style={cssBackground(shot.scene.background, bgUrl)} />
                {thumb && (
                  <img
                    src={thumb}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-contain object-center"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

                <div className="absolute inset-x-1 bottom-0.5 flex items-end gap-1 overflow-hidden">
                  {renaming === shot.id ? (
                    <input
                      autoFocus
                      defaultValue={shot.name}
                      onPointerDown={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        st().renameShot(shot.id, e.target.value.trim() || shot.name)
                        setRenaming(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                      }}
                      className="w-full rounded-xs bg-black/60 px-1 t-caption text-white outline-none"
                    />
                  ) : (
                    <>
                      <span className="truncate t-caption text-white/90">{shot.name}</span>
                      <span className="ml-auto shrink-0 t-caption text-white/60 tabular-nums">
                        {secs(shot.durationMs)}
                      </span>
                    </>
                  )}
                </div>

                {/* per-chip actions, out of the way until the chip is hovered */}
                <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    title="Duplicate this shot"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => st().duplicateShot(shot.id)}
                    className="rounded-xs bg-black/55 p-0.5 text-white/80 hover:bg-black/80 hover:text-white"
                  >
                    <Copy size={10} />
                  </button>
                  {project.shots.length > 1 && (
                    <button
                      title="Delete this shot"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => removeShot(shot.id, shot.name)}
                      className="rounded-xs bg-black/55 p-0.5 text-white/80 hover:bg-(--danger) hover:text-white"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              </div>

              {/* trailing edge: drag to retime the shot */}
              <div
                onPointerDown={(e) => startResize(e, shot.id, shot.durationMs)}
                title={`Drag to retime ${shot.name}`}
                style={{ width: EDGE }}
                className="absolute inset-y-0 -right-0.5 z-10 cursor-ew-resize"
              >
                <span className="absolute inset-y-2 right-1 w-px bg-white/0 transition-colors hover:bg-white/50" />
              </div>

              {/* the seam with the shot before: what happens between them */}
              {i > 0 && (
                <div className="absolute top-0 -left-px z-20 h-full">
                  <button
                    title={`${TRANSITION_LABELS[shot.transition.kind]}${
                      shot.transition.kind === 'cut' ? '' : ` · ${secs(c.inMs)}`
                    }`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setOpenTransition(openTransition === shot.id ? null : shot.id)}
                    className={`absolute top-1/2 left-0 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[10px] transition-colors ${
                      shot.transition.kind === 'cut'
                        ? 'border-(--line2) bg-(--panel3) text-(--tx3) hover:text-(--tx)'
                        : 'border-(--accent) bg-(--raised) text-(--accent)'
                    }`}
                  >
                    {TRANSITION_GLYPH[shot.transition.kind]}
                  </button>
                  {openTransition === shot.id && (
                    <TransitionPopover
                      shotId={shot.id}
                      kind={shot.transition.kind}
                      durationMs={shot.transition.durationMs}
                      onClose={() => setOpenTransition(null)}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* where a dragged chip would land */}
        {dropAt !== null && chips[dropAt] && (
          <span
            className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-(--accent)"
            style={{ left: `${chips[dropAt].left * 100}%` }}
          />
        )}
      </div>

      <div className="flex shrink-0 flex-col justify-center gap-1">
        <button
          title="Add a shot after this one (copies it)"
          onClick={() => st().addShot()}
          className="flex h-5 w-7 items-center justify-center rounded-xs border border-(--line) text-(--tx2) hover:border-(--line2) hover:text-(--tx)"
        >
          <Plus size={12} />
        </button>
        <button
          title="Add an empty shot"
          onClick={() => st().addShot({ blank: true })}
          className="flex h-5 w-7 items-center justify-center rounded-xs border border-(--line) text-(--tx3) hover:border-(--line2) hover:text-(--tx)"
        >
          <Scissors size={11} />
        </button>
      </div>
    </div>
  )
}
