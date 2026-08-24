import { useEffect, useMemo, useRef, useState } from 'react'
import { useStudio } from '../store'
import { endEditRun } from '../lib/history'
import { clampCamera } from '../lib/camera'
import { focalFromFov } from '../lib/studio'
import {
  BOX_EDGES,
  SCREEN_FACE,
  add,
  applySceneRotation,
  cameraBasis,
  cameraDistance,
  cameraPosition,
  cameraTarget,
  deviceProxy,
  frustumCorners,
  len,
  makeStage,
  partCorners,
  rayAt,
  rayPlaneZ0,
  raySphere,
  scale,
  sub,
  tiltForPosition,
  vec,
  type StageView,
  type Vec,
} from '../lib/stage'

/*
 * The camera stage: the set seen from outside itself.
 *
 * Numbers alone never told you where the lens was standing. Tilt Y 36° reads
 * as nothing until you have watched the canvas swing, and even then a scene
 * with three devices in it gives no clue which one you are about to orbit
 * behind. This is the split view a 3D app gives you for exactly that reason,
 * one window on the shot, one window on the set, shrunk to the size of a
 * panel and reduced to what it has to say: how big the subject is, where the
 * lens is, and what it has in frame.
 *
 * Drag the lens and the real camera moves under it, because both write the
 * same camera state the viewport renders from. There is no second scene to
 * keep in sync.
 */

const W = 256
const H = 240
/* Room for the lens handle, which is 14px across and sits right on the fit. */
const PAD = 16

/** Height of the floor plane, matching where the contact shadow is laid down. */
const FLOOR = -1.3

const VANTAGES: { id: string; label: string; view: StageView; title: string }[] = [
  { id: 'three', label: '¾', view: { yaw: -38, pitch: 22 }, title: 'Three-quarter view' },
  { id: 'top', label: 'Top', view: { yaw: 0, pitch: 89 }, title: 'Looking straight down' },
  { id: 'front', label: 'Front', view: { yaw: 0, pitch: 6 }, title: 'Level with the set' },
  { id: 'side', label: 'Side', view: { yaw: -90, pitch: 6 }, title: 'From stage left' },
]

type Grab = 'lens' | 'target' | 'view'

const line = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`

const poly = (pts: { x: number; y: number }[]) =>
  pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

export function CameraStage() {
  const cam = useStudio((s) => s.project.scene.camera)
  const devices = useStudio((s) => s.project.scene.devices)
  const selectedId = useStudio((s) => s.selectedDeviceId)
  const exportSize = useStudio((s) => s.project.exportSize)

  const [view, setView] = useState<StageView>(VANTAGES[0].view)
  const svgRef = useRef<SVGSVGElement>(null)
  const grab = useRef<Grab | null>(null)
  const last = useRef({ x: 0, y: 0 })

  /*
   * The subject, as boxes. Rebuilt only when a device actually changes: the
   * corners go through every device transform and the scene rotation, and a
   * drag on the lens must not pay for that on every pointer move.
   */
  const { rotateX, rotateY } = cam
  const subject = useMemo(() => {
    const shapes = devices.map((d) => ({
      id: d.id,
      parts: deviceProxy(d).map((part) => ({
        screen: part.screen,
        corners: partCorners(part, d).map((c) => applySceneRotation(c, rotateX, rotateY)),
      })),
    }))
    return { shapes, points: shapes.flatMap((s) => s.parts.flatMap((p) => p.corners)) }
  }, [devices, rotateX, rotateY])

  const target = cameraTarget(cam)
  const lens = cameraPosition(cam)

  /*
   * One scale for the whole widget, fixed on a sphere rather than on what the
   * current vantage happens to project to. Turning the stage around therefore
   * never resizes it, and orbiting the lens, which keeps its distance, does
   * not either. Only a dolly changes the fit, and there the subject shrinking
   * away from the lens is exactly the thing being shown.
   */
  const { center, radius } = useMemo(() => {
    const pts = subject.points
    if (pts.length === 0) return { center: vec(0, 0, 0), radius: 4 }
    let lo = pts[0]
    let hi = pts[0]
    for (const p of pts) {
      lo = vec(Math.min(lo.x, p.x), Math.min(lo.y, p.y), Math.min(lo.z, p.z))
      hi = vec(Math.max(hi.x, p.x), Math.max(hi.y, p.y), Math.max(hi.z, p.z))
    }
    const c = vec((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2)
    let r = 0
    for (const p of pts) r = Math.max(r, len(sub(p, c)))
    return { center: c, radius: r }
  }, [subject])

  const fit = Math.max(2.2, radius, len(sub(lens, center)), len(sub(target, center)))
  const stage = useMemo(() => makeStage(view, center, fit, W, H, PAD), [view, center, fit])
  const px = stage.project

  // ----- gestures -----

  /** Pointer position in the SVG's own coordinates, whatever it is scaled to. */
  const localPoint = (e: React.PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const kind = (e.target as SVGElement).dataset?.grab as Grab | undefined
    grab.current = kind ?? 'view'
    last.current = localPoint(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!grab.current) return
    const p = localPoint(e)
    const st = useStudio.getState()

    if (grab.current === 'view') {
      setView((v) => ({
        yaw: v.yaw - (p.x - last.current.x) * 0.55,
        pitch: Math.max(-89, Math.min(89, v.pitch + (p.y - last.current.y) * 0.55)),
      }))
      last.current = p
      return
    }

    const { origin, dir } = rayAt(stage, view, p.x, p.y, W, H)

    if (grab.current === 'lens') {
      // ride the sphere the lens already orbits on, so a drag changes the two
      // angles and never the dolly
      const hit = raySphere(origin, dir, target, cameraDistance(cam), lens)
      const t = tiltForPosition(hit, target)
      st.setAnimatable('camera.tiltY', Number(t.tiltY.toFixed(2)), 'gesture-orbit')
      st.setAnimatable('camera.tiltX', Number(t.tiltX.toFixed(2)), 'gesture-orbit')
      return
    }

    // the target lives on z = 0, which is also the plane the devices stand in
    const hit = rayPlaneZ0(origin, dir)
    if (!hit) return
    st.setAnimatable('camera.panX', Number(clampCamera('panX', hit.x).toFixed(3)), 'gesture-pan')
    st.setAnimatable('camera.panY', Number(clampCamera('panY', hit.y).toFixed(3)), 'gesture-pan')
  }

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (grab.current && grab.current !== 'view') endEditRun()
    grab.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  /*
   * Dolly on scroll, the same gesture the canvas uses.
   *
   * Bound natively rather than through React's `onWheel`: React registers
   * wheel handlers passively, so it cannot stop the event, and the panel this
   * sits in scrolls: a scroll over the stage would dolly the camera *and*
   * scroll the catalog out from under the pointer.
   */
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const st = useStudio.getState()
      const zoom = clampCamera('zoom', st.project.scene.camera.zoom * Math.exp(-e.deltaY * 0.0012))
      st.setAnimatable('camera.zoom', Number(zoom.toFixed(3)), 'gesture-zoom')
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ----- geometry -----

  const gridHalf = Math.max(2, Math.min(6, Math.ceil(radius)))
  const grid: string[] = []
  for (let i = -gridHalf; i <= gridHalf; i++) {
    grid.push(line(px(vec(i, FLOOR, -gridHalf)), px(vec(i, FLOOR, gridHalf))))
    grid.push(line(px(vec(-gridHalf, FLOOR, i)), px(vec(gridHalf, FLOOR, i))))
  }

  const basis = cameraBasis(cam)
  const far = frustumCorners(cam, exportSize.width / exportSize.height).map(px)
  const apex = px(basis.pos)

  /* A stubby body behind the lens, built on the camera's own basis so a roll
     visibly tips it. The frustum rectangle alone reads the same either way. */
  const bodyEdges: string[] = []
  {
    const hw = Math.max(0.12, radius * 0.1)
    const back = add(basis.pos, scale(basis.forward, -hw * 1.5))
    const corners: Vec[] = []
    for (const ix of [-1, 1])
      for (const iy of [-1, 1])
        for (const iz of [-1, 1])
          corners.push(
            add(
              add(back, scale(basis.right, ix * hw)),
              add(scale(basis.up, iy * hw * 0.8), scale(basis.forward, iz * hw)),
            ),
          )
    const proj = corners.map(px)
    for (const [a, b] of BOX_EDGES) bodyEdges.push(line(proj[a], proj[b]))
  }

  const targetPt = px(target)
  const camDepth = apex.depth
  const subjectDepth =
    subject.points.length > 0
      ? subject.points.reduce((acc, p) => acc + px(p).depth, 0) / subject.points.length
      : 0

  const subjectLayer = (
    <g key="subject">
      {subject.shapes.map((shape) => {
        const on = shape.id === selectedId
        return (
          <g key={shape.id}>
            {shape.parts.map((part, pi) => {
              const proj = part.corners.map(px)
              return (
                <g key={pi}>
                  {part.screen && (
                    <polygon
                      points={poly(SCREEN_FACE.map((i) => proj[i]))}
                      fill="var(--accent)"
                      opacity={on ? 0.22 : 0.12}
                    />
                  )}
                  <path
                    d={BOX_EDGES.map(([a, b]) => line(proj[a], proj[b])).join('')}
                    stroke={on ? 'var(--tx2)' : 'var(--tx3)'}
                    strokeWidth={on ? 1.2 : 1}
                    fill="none"
                  />
                </g>
              )
            })}
          </g>
        )
      })}
    </g>
  )

  const cameraLayer = (
    <g key="camera">
      <polygon points={poly(far)} fill="var(--accent)" opacity={0.09} />
      <polygon
        points={poly(far)}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
      <path
        d={far.map((c) => line(apex, c)).join('')}
        stroke="var(--accent)"
        strokeWidth={0.9}
        opacity={0.65}
        fill="none"
      />
      <path d={bodyEdges.join('')} stroke="var(--accent)" strokeWidth={1.1} fill="none" />
      <circle cx={apex.x} cy={apex.y} r={3.2} fill="var(--accent)" />
      {/* the handle is bigger than the glyph: 3px of lens is not a drag target */}
      <circle
        cx={apex.x}
        cy={apex.y}
        r={14}
        fill="transparent"
        data-grab="lens"
        style={{ cursor: 'grab' }}
      >
        <title>Drag to orbit the camera</title>
      </circle>
    </g>
  )

  return (
    <div className="select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none rounded-md border border-(--line) bg-(--panel2)"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ cursor: 'crosshair' }}
      >
        {/* the floor the product stands on, and the shadow is cast onto */}
        <path d={grid.join('')} stroke="var(--line2)" strokeWidth={0.7} opacity={0.5} fill="none" />
        <path
          d={
            line(px(vec(-gridHalf, FLOOR, 0)), px(vec(gridHalf, FLOOR, 0))) +
            line(px(vec(0, FLOOR, -gridHalf)), px(vec(0, FLOOR, gridHalf)))
          }
          stroke="var(--line2)"
          strokeWidth={1}
          fill="none"
        />

        {/* what the lens is aimed at */}
        <path
          d={line(apex, targetPt)}
          stroke="var(--tx3)"
          strokeWidth={0.8}
          strokeDasharray="3 3"
          fill="none"
        />

        {/* far things first, so the near ones cover them */}
        {camDepth <= subjectDepth ? [cameraLayer, subjectLayer] : [subjectLayer, cameraLayer]}

        <circle cx={targetPt.x} cy={targetPt.y} r={4} fill="none" stroke="var(--tx2)" strokeWidth={1.1} />
        <circle
          cx={targetPt.x}
          cy={targetPt.y}
          r={11}
          fill="transparent"
          data-grab="target"
          style={{ cursor: 'move' }}
        >
          <title>Drag to pan the shot</title>
        </circle>
      </svg>

      <div className="mt-1.5 flex items-center gap-1">
        {VANTAGES.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.view)}
            title={v.title}
            className={`h-6 flex-1 rounded-xs t-caption transition-colors ${
              view.yaw === v.view.yaw && view.pitch === v.view.pitch
                ? 'bg-(--sel) text-(--tx)'
                : 'bg-(--field) text-(--tx3) hover:bg-(--field-h) hover:text-(--tx2)'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <p className="mt-1.5 t-caption tabular-nums text-(--tx3)">
        {focalFromFov(cam.fov)}mm · {cam.tiltY.toFixed(0)}° / {cam.tiltX.toFixed(0)}° ·{' '}
        {cameraDistance(cam).toFixed(1)}u
      </p>
      <p className="mt-1 t-caption leading-snug text-(--tx3)">
        Drag the lens to orbit, the ring to pan, and scroll to dolly. Drag anywhere else to
        turn the stage and look at the set from another side.
      </p>
    </div>
  )
}
