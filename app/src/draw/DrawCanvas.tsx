/**
 * The surface.
 *
 * Everything you do to the drawing happens through this one component, and it
 * is written around a single decision: an in-progress gesture does not touch
 * the store. A freehand stroke can produce several hundred pointer samples in a
 * second, and pushing each into a zustand slice means several hundred immer
 * drafts, several hundred subscriber notifications and several hundred React
 * renders, all to draw one line. So the element being drawn lives in a ref, is
 * painted straight onto the canvas each frame, and only becomes state when the
 * pointer comes up. Undo history gets one entry per gesture for free, which is
 * what you want anyway.
 *
 * Two canvases sit on top of each other. The lower one is the drawing; the
 * upper one is everything that is *about* the drawing and must never end up in
 * an export: selection boxes, resize grips, the marquee, the eraser's ring.
 * Keeping them apart means the export path never has to remember to leave the
 * furniture out.
 */

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import {
  CORNER_HANDLES,
  CURSOR_FOR_HANDLE,
  dropGeometry,
  handlePositions,
  hitTest,
  inBox,
  rotate,
  rotateCursor,
  sceneBounds,
  unionBounds,
  type Box,
  type CornerHandleId,
  type ResizeHandleId,
} from './geometry'
import { CanvasMenu, type MenuAt } from './CanvasMenu'
import { remapMarks } from './marks'
import { layoutNote, lineHeightFor, renderScene, toScene } from './render'
import {
  boxFrom,
  contentOffScreen,
  copiesOf,
  newLinear,
  newShape,
  newStroke,
  refitLinear,
  refitStroke,
  refitText,
  setSurfaceSize,
  useDraw,
} from './store'
import { FONT_STACKS, isLinear, isStroke, noteInk, paperIsDark, type DrawElement } from './types'
import { useStudio } from '../store'

/** How close counts as "on" a line, in screen pixels. */
const HIT_SLOP = 10
/** How far an alt-drag has to travel before it commits to making a copy. */
const CLONE_SLOP = 4
/** what the board writes on the clipboard, and the only thing it reads back */
const CLIP_TAG = 'ribbit/draw'
const HANDLE_SIZE = 8

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; startX: number; startY: number; scrollX: number; scrollY: number }
  | { kind: 'draw' }
  | { kind: 'marquee'; startX: number; startY: number; box: Box }
  | {
      kind: 'move'
      startX: number
      startY: number
      origin: Map<string, { x: number; y: number }>
      /** an alt-drag has already handed the drag over to a fresh copy */
      cloned: boolean
    }
  | {
      kind: 'resize'
      handle: ResizeHandleId
      box: Box
      angle: number
      origin: Map<string, DrawElement>
    }
  | { kind: 'rotate'; cx: number; cy: number; start: number; origin: Map<string, number> }
  | { kind: 'erase-object'; hit: Set<string> }

export function DrawCanvas() {
  const sceneRef = useRef<HTMLCanvasElement>(null)
  const uiRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const doc = useDraw((s) => s.doc)
  const viewport = useDraw((s) => s.viewport)
  const tool = useDraw((s) => s.tool)
  const selectedIds = useDraw((s) => s.selectedIds)
  const editingTextId = useDraw((s) => s.editingTextId)
  const eraserSize = useDraw((s) => s.eraserSize)
  const eraserMode = useDraw((s) => s.eraserMode)
  const images = useDraw((s) => s.images)
  const theme = useStudio((s) => s.theme)

  /** the element under the pointer right now, outside of React's knowledge */
  const live = useRef<DrawElement | null>(null)
  const gesture = useRef<Gesture>({ kind: 'none' })
  const spaceDown = useRef(false)
  const pointer = useRef({ x: 0, y: 0, inside: false })
  /** where the last paste landed, so a second one does not hide under it */
  const lastPaste = useRef<{ x: number; y: number } | null>(null)
  const size = useRef({ w: 0, h: 0 })
  const imgCache = useRef(new Map<string, HTMLImageElement>())
  const [, force] = useReducer((n: number) => n + 1, 0)
  const frame = useRef(0)
  /** the right-click menu, and where it was opened */
  const [menu, setMenu] = useState<MenuAt | null>(null)
  /*
   * Stable, and it has to be. The menu hangs its dismissal listeners off this,
   * and the canvas re-renders on every animation frame it paints; handing it a
   * fresh closure each time tore those listeners down and re-armed them on a
   * timeout that the next render cleared before it could fire. The menu would
   * then sit there ignoring every click outside it.
   */
  const closeMenu = useCallback(() => setMenu(null), [])

  /**
   * The live element's geometry has changed.
   *
   * Geometry is memoised on id and version, so a stroke that grows a point
   * without moving its version on would be painted from the cached outline it
   * had when it was a single dot, and drawing would look like it had stopped
   * working. Dropping the old entry as the version moves keeps the cache at one
   * record per element rather than one per frame of the drag.
   */
  const bump = (el: DrawElement) => {
    dropGeometry(el)
    el.version++
  }

  /** Repaint on the next frame, coalescing however many times we are asked. */
  const invalidate = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      force()
    })
  }

  // ----- bitmaps -----
  useEffect(() => {
    for (const [id, url] of Object.entries(images)) {
      if (imgCache.current.has(id)) continue
      const img = new Image()
      img.onload = () => invalidate()
      img.src = url
      imgCache.current.set(id, img)
    }
  }, [images])

  // ----- sizing -----
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect()
      size.current = { w: r.width, h: r.height }
      setSurfaceSize(r.width, r.height)
      for (const c of [sceneRef.current, uiRef.current]) {
        if (!c) continue
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        c.width = Math.round(r.width * dpr)
        c.height = Math.round(r.height * dpr)
        c.style.width = `${r.width}px`
        c.style.height = `${r.height}px`
      }
      force()
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  // ----- the drawing -----
  useEffect(() => {
    const ctx = sceneRef.current?.getContext('2d')
    if (!ctx || !size.current.w) return
    renderScene({
      ctx,
      width: size.current.w,
      height: size.current.h,
      viewport,
      doc,
      images: { get: (id) => imgCache.current.get(id) },
      live: live.current,
      hideId: editingTextId,
      dark: theme === 'dark',
    })
  })

  // ----- the furniture -----
  useEffect(() => {
    const canvas = uiRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas || !size.current.w) return
    const dpr = canvas.width / size.current.w
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.current.w, size.current.h)

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6965db'
    /*
     * The marquee has to read as a faint gray on whatever paper it is dragged
     * across, not just whatever the app chrome's theme happens to be — a dark
     * custom paper under a light-themed app would otherwise get a marquee
     * tuned for a white sheet. So it borrows the same paper-vs-ink call the
     * grid and default stroke colour already make, and stays a low-alpha wash
     * of that ink rather than a solid line.
     */
    const marqueeInk = paperIsDark(doc.background, theme === 'dark') ? '#f4f3f1' : '#1e1e1e'
    // Figma's own selection blue: kept distinct from the app's purple --accent
    // so a picked element reads as "selected" rather than "brand-colored"
    const selectionBlue = '#0d99ff'
    const g = gesture.current
    const z = viewport.zoom
    const sx = (x: number) => (x + viewport.scrollX) * z
    const sy = (y: number) => (y + viewport.scrollY) * z

    // the object eraser shows you what it is about to take before it takes it
    if (g.kind === 'erase-object' && g.hit.size) {
      ctx.save()
      ctx.strokeStyle = accent
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1
      for (const el of doc.elements) {
        if (!g.hit.has(el.id)) continue
        const b = sceneBounds(el)
        ctx.strokeRect(sx(b.x), sy(b.y), b.w * z, b.h * z)
      }
      ctx.restore()
    }

    if (g.kind === 'marquee') {
      ctx.save()
      ctx.fillStyle = marqueeInk + '14'
      ctx.strokeStyle = marqueeInk + '2e'
      ctx.lineWidth = 1
      ctx.fillRect(sx(g.box.x), sy(g.box.y), g.box.w * z, g.box.h * z)
      ctx.strokeRect(sx(g.box.x), sy(g.box.y), g.box.w * z, g.box.h * z)
      ctx.restore()
    }

    // the selection, with grips when a single unrotated thing is picked
    const picked = doc.elements.filter((e) => selectedIds.includes(e.id))
    if (picked.length && !editingTextId) {
      const single = picked.length === 1 ? picked[0] : null
      const box = single ? { x: single.x, y: single.y, w: single.w, h: single.h } : unionBounds(picked)!
      const angle = single?.angle ?? 0
      ctx.save()
      ctx.translate(sx(box.x + box.w / 2), sy(box.y + box.h / 2))
      ctx.rotate(angle)
      ctx.strokeStyle = selectionBlue
      ctx.lineWidth = 1
      ctx.setLineDash([])
      const w = box.w * z
      const h = box.h * z
      ctx.strokeRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8)

      // grips are hidden on a stroke: resizing a pen mark by its corner is not
      // a thing anyone reaches for, and the box around one is mostly air
      if (!single || !isStroke(single)) {
        ctx.fillStyle = theme === 'dark' ? '#18191a' : '#ffffff'
        const grips: [number, number][] = [
          [-w / 2 - 4, -h / 2 - 4],
          [0, -h / 2 - 4],
          [w / 2 + 4, -h / 2 - 4],
          [w / 2 + 4, 0],
          [w / 2 + 4, h / 2 + 4],
          [0, h / 2 + 4],
          [-w / 2 - 4, h / 2 + 4],
          [-w / 2 - 4, 0],
        ]
        for (const [gx, gy] of grips) {
          ctx.beginPath()
          ctx.roundRect(gx - HANDLE_SIZE / 2, gy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE, 2)
          ctx.fill()
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    // the eraser's ring, so its size is something you can see rather than guess
    if (tool === 'eraser' && eraserMode === 'area' && pointer.current.inside) {
      ctx.save()
      ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(pointer.current.x, pointer.current.y, (eraserSize / 2) * z, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

  })

  // ----- keyboard: space to pan, the way every canvas tool does it -----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) {
        spaceDown.current = true
        force()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false
        force()
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const isTyping = () =>
    !!document.activeElement?.closest('input, textarea, [contenteditable="true"]')

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  /** How far outside a corner grip still counts as "rotate this", not "miss". */
  const ROTATE_RING = HANDLE_SIZE + 10

  /**
   * Which grip is under the pointer, if any — a resize handle exactly on a
   * grip, or (Figma-style) 'rotate' in the ring just outside a corner one, so
   * there is no separate handle to draw or aim for.
   */
  const handleAt = (
    px: number,
    py: number,
  ): { id: ResizeHandleId } | { id: 'rotate'; corner: CornerHandleId; angle: number } | null => {
    const s = useDraw.getState()
    const picked = s.doc.elements.filter((e) => s.selectedIds.includes(e.id))
    if (picked.length === 0) return null
    const single = picked.length === 1 ? picked[0] : null
    if (single && isStroke(single)) return null
    const box = single ? { x: single.x, y: single.y, w: single.w, h: single.h } : unionBounds(picked)!
    const angle = single?.angle ?? 0
    const pos = handlePositions(box, angle)
    for (const [id, [hx, hy]] of Object.entries(pos) as [ResizeHandleId, [number, number]][]) {
      const sxp = (hx + s.viewport.scrollX) * s.viewport.zoom
      const syp = (hy + s.viewport.scrollY) * s.viewport.zoom
      if (Math.abs(px - sxp) <= HANDLE_SIZE && Math.abs(py - syp) <= HANDLE_SIZE) return { id }
    }
    for (const corner of CORNER_HANDLES) {
      const [hx, hy] = pos[corner]
      const sxp = (hx + s.viewport.scrollX) * s.viewport.zoom
      const syp = (hy + s.viewport.scrollY) * s.viewport.zoom
      const d = Math.hypot(px - sxp, py - syp)
      if (d > HANDLE_SIZE && d <= ROTATE_RING) return { id: 'rotate', corner, angle }
    }
    return null
  }

  /** Topmost element under the pointer. */
  const elementAt = (scene: { x: number; y: number }) => {
    const s = useDraw.getState()
    const tol = HIT_SLOP / s.viewport.zoom
    for (let i = s.doc.elements.length - 1; i >= 0; i--) {
      const el = s.doc.elements[i]
      if (el.kind === 'erase' || el.locked) continue
      if (hitTest(el, scene.x, scene.y, tol)) return el
    }
    return null
  }

  /**
   * Did this event start on something floating over the board rather than on
   * the board itself?
   *
   * Everything overlaid — the text editor, the right-click menu, the scroll-
   * back button — sits *inside* the wrapper, so its events bubble into these
   * handlers, and the board would read a press on a menu item as a press on
   * the paper behind it: clear the selection and start a marquee. Worse, it
   * captures the pointer, so the pointerup lands on the canvas instead of the
   * button and the click the menu item was waiting for never happens at all.
   * The board only listens to the board.
   */
  const fromOverlay = (e: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
    const t = e.target as HTMLElement | null
    return !!t && t !== e.currentTarget && t.tagName !== 'CANVAS'
  }

  // ----- pointer -----
  const onPointerDown = (e: React.PointerEvent) => {
    if (fromOverlay(e)) return

    if (e.button === 1 || (e.button === 0 && (spaceDown.current || tool === 'hand'))) {
      const p = localPoint(e)
      gesture.current = {
        kind: 'pan',
        startX: p.x,
        startY: p.y,
        scrollX: viewport.scrollX,
        scrollY: viewport.scrollY,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)

    const s = useDraw.getState()
    const p = localPoint(e)
    const scene = toScene(p.x, p.y, s.viewport)

    if (s.editingTextId) {
      commitText()
      return
    }

    // ----- select -----
    if (tool === 'select') {
      const grip = handleAt(p.x, p.y)
      if (grip) {
        const picked = s.doc.elements.filter((el) => s.selectedIds.includes(el.id))
        const single = picked.length === 1 ? picked[0] : null
        const box = single ? { x: single.x, y: single.y, w: single.w, h: single.h } : unionBounds(picked)!
        if (grip.id === 'rotate') {
          gesture.current = {
            kind: 'rotate',
            cx: box.x + box.w / 2,
            cy: box.y + box.h / 2,
            start: Math.atan2(scene.y - (box.y + box.h / 2), scene.x - (box.x + box.w / 2)),
            origin: new Map(picked.map((el) => [el.id, el.angle])),
          }
        } else {
          gesture.current = {
            kind: 'resize',
            handle: grip.id,
            box,
            angle: single?.angle ?? 0,
            origin: new Map(picked.map((el) => [el.id, JSON.parse(JSON.stringify(el)) as DrawElement])),
          }
        }
        s.commit()
        return
      }

      const hitEl = elementAt(scene)
      if (hitEl) {
        const already = s.selectedIds.includes(hitEl.id)
        const ids = e.shiftKey
          ? already
            ? s.selectedIds.filter((id) => id !== hitEl.id)
            : [...s.selectedIds, hitEl.id]
          : already
            ? s.selectedIds
            : [hitEl.id]
        s.select(ids)
        const moving = s.doc.elements.filter((el) => ids.includes(el.id) && !el.locked)
        gesture.current = {
          kind: 'move',
          startX: scene.x,
          startY: scene.y,
          origin: new Map(moving.map((el) => [el.id, { x: el.x, y: el.y }])),
          cloned: false,
        }
        s.commit()
      } else {
        if (!e.shiftKey) s.select([])
        gesture.current = { kind: 'marquee', startX: scene.x, startY: scene.y, box: { x: scene.x, y: scene.y, w: 0, h: 0 } }
      }
      invalidate()
      return
    }

    // ----- text -----
    if (tool === 'text') {
      /*
       * The whole reason the text tool did not work.
       *
       * A pointerdown on the canvas is followed by a compatibility mousedown,
       * and mousedown's default action moves focus to the nearest focusable
       * ancestor. The editor root carries tabIndex={-1} so that shortcuts
       * work, which makes it exactly that ancestor. So the sequence was:
       * place the label, focus its textarea, and then have the browser take
       * focus straight back off it a moment later. The textarea blurred, an
       * untouched label commits as empty, and the label deleted itself before
       * a single character could be typed.
       *
       * Cancelling the pointerdown suppresses the compatibility mouse events,
       * and with them the focus change, so the caret stays where it was put.
       */
      e.preventDefault()
      s.placeText(scene.x, scene.y)
      return
    }

    // ----- sticky note -----
    if (tool === 'note') {
      // same focus-stealing trap as the text tool, same fix
      e.preventDefault()
      s.placeNote(scene.x, scene.y)
      return
    }

    // ----- eraser -----
    if (tool === 'eraser') {
      if (eraserMode === 'object') {
        const hit = new Set<string>()
        const target = elementAt(scene)
        if (target) hit.add(target.id)
        gesture.current = { kind: 'erase-object', hit }
        invalidate()
        return
      }
      live.current = newStroke('erase', scene.x, scene.y, e.pressure || 0.5, e.timeStamp)
      gesture.current = { kind: 'draw' }
      invalidate()
      return
    }

    // ----- everything that draws -----
    if (tool === 'freedraw') {
      live.current = newStroke('freedraw', scene.x, scene.y, e.pressure || 0.5, e.timeStamp)
    } else if (tool === 'arrow' || tool === 'line') {
      live.current = newLinear(tool, scene.x, scene.y)
    } else if (tool === 'rect' || tool === 'diamond' || tool === 'ellipse') {
      live.current = newShape(tool, scene.x, scene.y)
    } else {
      return
    }
    gesture.current = { kind: 'draw' }
    invalidate()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const s = useDraw.getState()
    const p = localPoint(e)
    pointer.current = { x: p.x, y: p.y, inside: true }
    const scene = toScene(p.x, p.y, s.viewport)
    const g = gesture.current

    if (g.kind === 'none') {
      if (tool === 'eraser') invalidate()
      return
    }

    if (g.kind === 'pan') {
      s.setViewport({
        scrollX: g.scrollX + (p.x - g.startX) / s.viewport.zoom,
        scrollY: g.scrollY + (p.y - g.startY) / s.viewport.zoom,
      })
      return
    }

    if (g.kind === 'marquee') {
      g.box = boxFrom(g.startX, g.startY, scene.x, scene.y)
      invalidate()
      return
    }

    if (g.kind === 'move') {
      let dx = scene.x - g.startX
      let dy = scene.y - g.startY
      // shift constrains the drag to one axis, as it does everywhere else
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }

      /*
       * Alt turns the drag into a copy, the way it does in every design tool:
       * the originals go back where they started and a fresh set travels on
       * with the pointer.
       *
       * Alt is read live rather than remembered from the press, so reaching for
       * it part way through a drag works too, which is how people actually use
       * it. It waits for real movement first, so an alt-click that never went
       * anywhere cannot leave a duplicate sitting exactly on top of its
       * original, invisible until the day you drag the wrong one away.
       *
       * Once the copy exists it stays, even if alt comes back up: the undo
       * entry the drag already took covers the whole gesture, so one Ctrl+Z
       * puts everything back.
       */
      if (e.altKey && !g.cloned && Math.hypot(dx, dy) * s.viewport.zoom > CLONE_SLOP) {
        const originals = s.doc.elements.filter((el) => g.origin.has(el.id))
        const copies = copiesOf(originals)
        for (let i = 0; i < copies.length; i++) {
          // copied from where the drag began, not from the few pixels it has
          // already travelled: those pixels belong to the copy
          const o = g.origin.get(originals[i].id)
          if (!o) continue
          copies[i].x = o.x
          copies[i].y = o.y
        }
        useDraw.setState((st) => {
          for (const el of st.doc.elements) {
            const o = g.origin.get(el.id)
            if (!o) continue
            el.x = o.x
            el.y = o.y
          }
          st.doc.elements.push(...copies)
          st.selectedIds = copies.map((c) => c.id)
        })
        g.origin = new Map(copies.map((c) => [c.id, { x: c.x, y: c.y }]))
        g.cloned = true
      }

      useDraw.setState((st) => {
        for (const el of st.doc.elements) {
          const o = g.origin.get(el.id)
          if (!o) continue
          el.x = o.x + dx
          el.y = o.y + dy
        }
      })
      return
    }

    if (g.kind === 'rotate') {
      const now = Math.atan2(scene.y - g.cy, scene.x - g.cx)
      let delta = now - g.start
      // shift snaps to fifteen degrees
      if (e.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12)
      useDraw.setState((st) => {
        for (const el of st.doc.elements) {
          const a = g.origin.get(el.id)
          if (a === undefined) continue
          el.angle = a + delta
        }
      })
      return
    }

    if (g.kind === 'resize') {
      applyResize(g, scene, e.shiftKey, e.altKey)
      return
    }

    if (g.kind === 'erase-object') {
      const target = elementAt(scene)
      if (target && !g.hit.has(target.id)) {
        g.hit.add(target.id)
        invalidate()
      }
      return
    }

    // ----- drawing -----
    const el = live.current
    if (!el) return

    if (isStroke(el)) {
      let x = scene.x - el.x
      let y = scene.y - el.y
      /*
       * "Hold Shift while drawing and the stroke locks to the nearest of eight
       * directions." Measured from the first sample, so the whole stroke rides
       * one ruler rather than snapping segment by segment.
       */
      if (e.shiftKey && el.points.length > 1) {
        const [ox, oy] = el.points[0]
        const a = Math.round(Math.atan2(y - oy, x - ox) / (Math.PI / 4)) * (Math.PI / 4)
        const len = Math.hypot(x - ox, y - oy)
        x = ox + Math.cos(a) * len
        y = oy + Math.sin(a) * len
      }
      /*
       * Coalesced events are the difference between a smooth stroke and a
       * polygon on a high-rate pointer: the browser batches samples between
       * frames and only hands over the last one unless asked.
       */
      const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
      if (events.length > 1 && !e.shiftKey) {
        for (const ce of events) {
          const cp = localPoint(ce)
          const cs = toScene(cp.x, cp.y, s.viewport)
          el.points.push([cs.x - el.x, cs.y - el.y, ce.pressure || 0.5, ce.timeStamp])
        }
      } else {
        el.points.push([x, y, e.pressure || 0.5, e.timeStamp])
      }
      bump(el)
      invalidate()
      return
    }

    if (isLinear(el)) {
      let x = scene.x - el.x
      let y = scene.y - el.y
      if (e.shiftKey) {
        const a = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4)
        const len = Math.hypot(x, y)
        x = Math.cos(a) * len
        y = Math.sin(a) * len
      }
      el.points[el.points.length - 1] = [x, y]
      bump(el)
      invalidate()
      return
    }

    // shapes drag out from their origin corner, or from their centre with alt
    const originX = el.x
    const originY = el.y
    let w = scene.x - originX
    let h = scene.y - originY
    if (e.shiftKey) {
      const m = Math.max(Math.abs(w), Math.abs(h))
      w = Math.sign(w) * m
      h = Math.sign(h) * m
    }
    if (e.altKey) {
      el.x = originX - w
      el.y = originY - h
      el.w = Math.abs(w) * 2
      el.h = Math.abs(h) * 2
    } else {
      el.x = Math.min(originX, originX + w)
      el.y = Math.min(originY, originY + h)
      el.w = Math.abs(w)
      el.h = Math.abs(h)
    }
    bump(el)
    invalidate()
  }

  const onPointerUp = () => {
    const s = useDraw.getState()
    const g = gesture.current
    gesture.current = { kind: 'none' }

    if (g.kind === 'marquee') {
      const found = inBox(
        s.doc.elements.filter((e) => e.kind !== 'erase' && !e.locked),
        g.box,
      )
      s.select(found.map((e) => e.id))
      invalidate()
      return
    }

    if (g.kind === 'erase-object') {
      if (g.hit.size) s.removeElements([...g.hit])
      invalidate()
      return
    }

    // move / resize / rotate mutate the doc directly for speed, so the save
    // that addElement would have triggered has to be asked for here
    if (g.kind === 'move' || g.kind === 'resize' || g.kind === 'rotate') {
      s.touch()
      invalidate()
      return
    }

    const el = live.current
    live.current = null
    if (!el) {
      invalidate()
      return
    }

    /*
     * A shape dragged out to nothing is a misfire, not an element. Strokes are
     * exempt: a single tap really is a dot, and throwing it away would make the
     * pens feel like they were ignoring you.
     */
    if (isStroke(el)) {
      refitStroke(el)
      // an erase that touched nothing is not worth an undo entry
      if (el.kind === 'erase' && el.points.length < 2 && el.w < 1) {
        invalidate()
        return
      }
    } else if (isLinear(el)) {
      if (Math.hypot(el.points[1][0], el.points[1][1]) < 2) {
        invalidate()
        return
      }
      refitLinear(el)
    } else if (el.w < 2 && el.h < 2) {
      invalidate()
      return
    }

    s.addElement(el)
    if (!s.toolLocked && el.kind !== 'freedraw' && el.kind !== 'erase') {
      s.setTool('select')
      s.select([el.id])
    }
    invalidate()
  }

  /** Resize, in the element's own frame so a rotated box still grows sideways. */
  function applyResize(
    g: Extract<Gesture, { kind: 'resize' }>,
    scene: { x: number; y: number },
    shift: boolean,
    alt: boolean,
  ) {
    const { box, handle, angle } = g
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    const [px, py] = angle ? rotate(scene.x, scene.y, cx, cy, -angle) : [scene.x, scene.y]

    let { x, y, w, h } = box
    const right = x + w
    const bottom = y + h
    if (handle.includes('w')) {
      x = alt ? px : Math.min(px, right)
      w = alt ? (cx - px) * 2 : right - Math.min(px, right)
      if (alt) x = cx - w / 2
    }
    if (handle.includes('e')) {
      w = alt ? (px - cx) * 2 : Math.max(px - x, 0)
      if (alt) x = cx - w / 2
    }
    if (handle.includes('n')) {
      y = alt ? py : Math.min(py, bottom)
      h = alt ? (cy - py) * 2 : bottom - Math.min(py, bottom)
      if (alt) y = cy - h / 2
    }
    if (handle.includes('s')) {
      h = alt ? (py - cy) * 2 : Math.max(py - y, 0)
      if (alt) y = cy - h / 2
    }
    w = Math.abs(w)
    h = Math.abs(h)

    // corner grips keep the aspect under shift; images keep it always
    const first = g.origin.values().next().value
    const keepRatio =
      (shift && handle.length === 2) || (g.origin.size === 1 && first?.kind === 'image' && handle.length === 2)
    if (keepRatio && box.w > 0 && box.h > 0) {
      const ratio = box.w / box.h
      if (w / h > ratio) w = h * ratio
      else h = w / ratio
      if (handle.includes('w')) x = right - w
      if (handle.includes('n')) y = bottom - h
    }

    const sx = box.w > 0 ? w / box.w : 1
    const sy = box.h > 0 ? h / box.h : 1

    useDraw.setState((st) => {
      for (const el of st.doc.elements) {
        const o = g.origin.get(el.id)
        if (!o) continue
        el.x = x + (o.x - box.x) * sx
        el.y = y + (o.y - box.y) * sy
        el.w = Math.max(1, o.w * sx)
        el.h = Math.max(1, o.h * sy)
        if (isStroke(el) && isStroke(o)) {
          el.points = o.points.map(([dx, dy, p, t]) => [dx * sx, dy * sy, p, t])
          el.size = o.size * Math.min(sx, sy)
        } else if (isLinear(el) && isLinear(o)) {
          el.points = o.points.map(([dx, dy]) => [dx * sx, dy * sy])
        } else if (el.kind === 'text' && o.kind === 'text') {
          // text scales by growing the type, not by stretching the glyphs
          el.fontSize = Math.max(6, o.fontSize * Math.min(sx, sy))
        }
        el.version++
      }
    })
    invalidate()
  }

  // ----- wheel: pan by default, zoom with the modifier down -----
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = useDraw.getState()
      if (e.ctrlKey || e.metaKey) {
        const r = wrap.getBoundingClientRect()
        s.zoomBy(Math.exp(-e.deltaY / 200), { x: e.clientX - r.left, y: e.clientY - r.top })
      } else {
        const z = s.viewport.zoom
        s.setViewport({
          scrollX: s.viewport.scrollX - (e.shiftKey ? e.deltaY : e.deltaX) / z,
          scrollY: s.viewport.scrollY - (e.shiftKey ? 0 : e.deltaY) / z,
        })
      }
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  // ----- text editing -----
  const editing = doc.elements.find((e) => e.id === editingTextId)

  /*
   * Watching the id rather than the element, deliberately: the element is a
   * fresh object on every keystroke, so focusing on *it* would re-focus the
   * textarea on each one and collapse the caret to the end mid-word.
   *
   * A layout effect rather than a passive one, also deliberately. The app
   * refocuses its root on the next frame after any click that did not land in a
   * text field, and placing a label is a click on the *canvas*, so that
   * refocus is already scheduled by the time this runs. Focusing here, during
   * the synchronous commit, means the caret is in the textarea before that
   * frame arrives; as a passive effect it was a race, and losing it blurred the
   * editor, which committed an empty label, which deleted it. The label
   * disappeared the instant it was placed.
   */
  useLayoutEffect(() => {
    if (editingTextId) textRef.current?.focus()
  }, [editingTextId])

  /*
   * Copy, cut and paste, hung off the platform's own clipboard events rather
   * than off a Ctrl+C of our own.
   *
   * That is what makes the system clipboard the storage: the elements travel as
   * JSON on text/plain, so a copy survives a reload and crosses into a second
   * tab, and no permission prompt or async clipboard read is involved because
   * the event hands over the data directly.
   *
   * Anything that is not ours is left alone, so pasting a screenshot still
   * reaches the image import that App already runs, and a caret inside the text
   * editor keeps the platform's own copy and paste.
   */
  useEffect(() => {
    const typing = () => {
      const el = document.activeElement as HTMLElement | null
      return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)
    }

    const write = (e: ClipboardEvent, cut: boolean) => {
      if (typing()) return
      const s = useDraw.getState()
      const wanted = new Set(s.selectedIds)
      const picked = s.doc.elements.filter((el) => wanted.has(el.id))
      if (picked.length === 0 || !e.clipboardData) return
      e.clipboardData.setData('text/plain', JSON.stringify({ type: CLIP_TAG, elements: picked }))
      // only now, so a clipboard we could not write to still gets its default
      e.preventDefault()
      // a locked element can be copied but not cut, same as it cannot be deleted
      if (cut) s.removeElements(picked.filter((el) => !el.locked).map((el) => el.id))
    }

    const onCopy = (e: ClipboardEvent) => write(e, false)
    const onCut = (e: ClipboardEvent) => write(e, true)

    const onPaste = (e: ClipboardEvent) => {
      if (typing()) return
      const raw = e.clipboardData?.getData('text/plain')
      if (!raw || !raw.includes(CLIP_TAG)) return
      let elements: DrawElement[]
      try {
        const parsed = JSON.parse(raw) as { type?: string; elements?: DrawElement[] }
        if (parsed.type !== CLIP_TAG || !Array.isArray(parsed.elements)) return
        elements = parsed.elements
      } catch {
        return
      }
      e.preventDefault()
      const s = useDraw.getState()
      // where you are looking: under the pointer, or the middle of the view
      const p = pointer.current
      const at = p.inside
        ? toScene(p.x, p.y, s.viewport)
        : toScene(size.current.w / 2, size.current.h / 2, s.viewport)
      /*
       * Ctrl+V twice without moving the mouse would otherwise drop the second
       * copy exactly on the first, where it is invisible and reads as a paste
       * that did nothing. Landing on the same spot steps the next one along
       * instead, and the run resets as soon as the pointer moves.
       */
      const prev = lastPaste.current
      const spot =
        prev && Math.hypot(at.x - prev.x, at.y - prev.y) < 1
          ? { x: prev.x + 12, y: prev.y + 12 }
          : at
      lastPaste.current = spot
      s.pasteElements(elements, spot)
      invalidate()
    }

    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCut)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCut)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

  const commitText = () => useDraw.getState().endTextEdit()

  const onDoubleClick = (e: React.PointerEvent) => {
    if (fromOverlay(e)) return
    const s = useDraw.getState()
    const p = localPoint(e)
    const scene = toScene(p.x, p.y, s.viewport)
    const hitEl = elementAt(scene)
    if (hitEl?.kind === 'text' || hitEl?.kind === 'note') {
      s.editText(hitEl.id)
      return
    }
    // double-clicking bare canvas starts a label, the way Excalidraw does
    if (tool === 'select' && !hitEl) s.placeText(scene.x, scene.y)
  }

  /**
   * Right-click, which the board answers itself rather than leaving to the
   * browser: Reload and View Source are never the question being asked over a
   * drawing, and inside a note they sit exactly where its colour and its text
   * settings ought to be.
   *
   * It runs through the textarea as well — the note's editor is transparent
   * and the note is what you think you are clicking, so a right-click on it
   * should offer the note's own menu rather than a spell-checker's.
   */
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    // right-clicking the menu is not a request for another one; the note's own
    // editor, on the other hand, is exactly where the menu is wanted
    if ((e.target as HTMLElement).closest('[data-canvas-menu]')) return
    const s = useDraw.getState()
    const p = localPoint(e)
    const hitEl = elementAt(toScene(p.x, p.y, s.viewport))
    /*
     * Right-clicking something outside the selection takes it, the way every
     * canvas tool does; right-clicking inside a multi-selection leaves that
     * selection alone, because the menu is about to act on all of it.
     */
    if (hitEl && !s.selectedIds.includes(hitEl.id)) {
      // through endTextEdit rather than straight to select, so a label being
      // typed somewhere else settles the way it would on any other click away
      if (s.editingTextId) s.endTextEdit()
      s.select([hitEl.id])
    }
    /*
     * What the caret had selected at the moment of the click, which is what a
     * highlight is going to be laid over. Read here rather than in the menu
     * because the menu is a click away, and by then the browser may have moved
     * the caret; right-click leaves a selection it lands inside alone.
     */
    const ta = textRef.current
    const editing = useDraw.getState().editingTextId
    const selection =
      editing && hitEl?.id === editing && ta && ta.selectionEnd > ta.selectionStart
        ? { start: ta.selectionStart, end: ta.selectionEnd }
        : null
    setMenu({ x: p.x, y: p.y, id: hitEl?.id ?? null, selection })
    invalidate()
  }

  const selectHit = tool === 'select' ? handleAt(pointer.current.x, pointer.current.y) : null
  const cursor =
    gesture.current.kind === 'pan'
      ? 'grabbing'
      : spaceDown.current || tool === 'hand'
        ? 'grab'
        : selectHit
          ? selectHit.id === 'rotate'
            ? rotateCursor(selectHit.corner, selectHit.angle)
            : CURSOR_FOR_HANDLE[selectHit.id]
          : tool === 'select'
            ? 'default'
            : tool === 'text'
              ? 'text'
              : tool === 'eraser' && eraserMode === 'area'
                ? 'none'
                : 'crosshair'

  const showScrollBack = contentOffScreen(doc.elements, viewport)

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full touch-none overflow-hidden"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        pointer.current.inside = false
        invalidate()
      }}
      onDoubleClick={onDoubleClick as unknown as React.MouseEventHandler}
      onContextMenu={onContextMenu}
    >
      <canvas ref={sceneRef} className="absolute inset-0" />
      <canvas ref={uiRef} className="pointer-events-none absolute inset-0" />

      {/*
       * Text is edited in a real textarea rather than by drawing a caret on the
       * canvas: it costs one overlaid element and buys IME, selection,
       * autocorrect, spellcheck and every keyboard shortcut the platform has,
       * none of which are worth reimplementing.
       */}
      {editing && editing.kind === 'text' && (
        <textarea
          ref={textRef}
          value={editing.text}
          onChange={(e) => {
            const ctx = sceneRef.current!.getContext('2d')!
            useDraw.setState((st) => {
              const el = st.doc.elements.find((x) => x.id === editing.id)
              if (el?.kind === 'text') {
                const next = e.target.value
                // before the text moves on, or every mark below the caret is
                // left pointing at the wrong characters
                el.highlights = remapMarks(el.highlights, el.text, next)
                el.strikes = remapMarks(el.strikes, el.text, next)
                el.text = next
                refitText(el, ctx)
                el.version++
              }
            })
          }}
          onBlur={() => {
            /*
             * Deferred by a frame, because a blur is ambiguous: it is either
             * the user clicking away (commit) or something taking focus off a
             * label they are still typing (don't). Asking on the next frame
             * settles it, and if the caret came back there is nothing to do.
             */
            requestAnimationFrame(() => {
              if (document.activeElement === textRef.current) return
              commitText()
            })
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              e.preventDefault()
              commitText()
            }
          }}
          // as on a note: a right-click formats what is selected, so it must
          // not be the thing that clears the selection
          onMouseDown={(e) => {
            if (e.button === 2) e.preventDefault()
          }}
          spellCheck={false}
          /*
           * No soft wrapping. The canvas renderer breaks lines on an explicit
           * newline and nothing else, so a textarea left to wrap at its own
           * width would reflow the text while you type and then have it snap
           * back to one long line the moment you clicked away.
           */
          wrap="off"
          className="absolute resize-none overflow-hidden border-none bg-transparent p-0 outline-none"
          style={{
            left: (editing.x + viewport.scrollX) * viewport.zoom,
            /*
             * Lifted by the half-leading. Canvas draws from the top of the em
             * box (textBaseline 'top'); CSS centres that em box inside a taller
             * line box and so sits the glyphs (lineHeight - fontSize) / 2 lower.
             * Without this correction the editor and the finished text disagree
             * by exactly that much, which is the offset between the two copies.
             */
            top:
              (editing.y + viewport.scrollY) * viewport.zoom -
              ((lineHeightFor(editing.fontSize) - editing.fontSize) / 2) * viewport.zoom,
            width: Math.max(editing.w, editing.fontSize) * viewport.zoom + 4,
            height: editing.h * viewport.zoom + 4,
            font: `${editing.fontSize * viewport.zoom}px ${FONT_STACKS[editing.fontFamily]}`,
            // the same line height the renderer uses, in px rather than a ratio
            lineHeight: `${lineHeightFor(editing.fontSize) * viewport.zoom}px`,
            color: editing.stroke,
            // the blinking caret is the whole point of a text tool, so it is
            // painted in the ink rather than left to the browser's default
            caretColor: editing.stroke,
            textAlign: editing.textAlign,
            opacity: editing.opacity,
          }}
        />
      )}

      {/*
       * A note is edited differently: the card, its shadow and its wrapped,
       * shrink-to-fit, possibly-bulleted text keep painting on the canvas
       * exactly as they will once you click away, so this textarea draws no
       * visible glyphs of its own at all — just the caret and the native
       * selection highlight — sitting over the card's own content box. What
       * you see while typing is the real render, not a stand-in for it.
       */}
      {editing &&
        editing.kind === 'note' &&
        (() => {
          const ctx = sceneRef.current?.getContext('2d')
          if (!ctx) return null
          const layout = layoutNote(ctx, editing)
          const align = editing.bulleted ? 'left' : editing.textAlign
          return (
            <textarea
              ref={textRef}
              value={editing.text}
              onChange={(e) => {
                useDraw.setState((st) => {
                  const el = st.doc.elements.find((x) => x.id === editing.id)
                  if (el?.kind === 'note') {
                    const next = e.target.value
                    el.highlights = remapMarks(el.highlights, el.text, next)
                    el.strikes = remapMarks(el.strikes, el.text, next)
                    el.text = next
                    el.version++
                  }
                })
              }}
              onBlur={() => {
                requestAnimationFrame(() => {
                  if (document.activeElement === textRef.current) return
                  commitText()
                })
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') {
                  e.preventDefault()
                  commitText()
                }
              }}
              /*
               * A right-click keeps whatever was selected. Left to itself the
               * browser collapses the selection to wherever the press landed,
               * so aiming a hair outside your own highlighted phrase turned
               * "highlight this" into "highlight the entire note" — with the
               * menu quietly relabelling itself on the way past.
               */
              onMouseDown={(e) => {
                if (e.button === 2) e.preventDefault()
              }}
              spellCheck={false}
              wrap="soft"
              className="absolute resize-none overflow-hidden border-none bg-transparent p-0 outline-none"
              style={{
                left: (editing.x + layout.pad + viewport.scrollX) * viewport.zoom,
                top:
                  (editing.y + layout.pad + viewport.scrollY) * viewport.zoom -
                  ((layout.lineHeight - layout.fontSize) / 2) * viewport.zoom,
                /*
                 * Exactly the column the renderer wrapped to, not a pixel more:
                 * the two have to break in the same places or the caret drifts
                 * a line away from the glyphs it is supposed to be sitting in.
                 * The bullet's hanging indent comes off the same width, as
                 * padding, since the box sizes borders in.
                 */
                width: layout.contentWidth * viewport.zoom,
                paddingLeft: (editing.bulleted ? layout.indent : 0) * viewport.zoom,
                height: Math.max(1, editing.h - layout.pad * 2) * viewport.zoom + 2,
                font: `${layout.fontSize * viewport.zoom}px ${FONT_STACKS[editing.fontFamily]}`,
                lineHeight: `${layout.lineHeight * viewport.zoom}px`,
                color: 'transparent',
                caretColor: noteInk(editing.noteColor),
                textAlign: align,
                opacity: editing.opacity,
              }}
            />
          )
        })()}

      {menu && <CanvasMenu at={menu} onClose={closeMenu} />}

      {/*
       * Excalidraw's escape hatch for a canvas you have panned away from. It
       * used to sit at the bottom, which is where the pen tray now lives, so it
       * has moved to the top where nothing else is competing.
       */}
      {showScrollBack && (
        <button
          onClick={() => useDraw.getState().scrollToContent()}
          className="absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-(--line) bg-(--raised) px-4 py-2 t-body-sm text-(--tx) shadow-lg transition-colors hover:bg-(--panel3)"
        >
          Scroll back to content
        </button>
      )}
    </div>
  )
}
