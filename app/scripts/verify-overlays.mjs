/**
 * The overlay layer, checked without a browser.
 *
 * Captions, logos and shapes are drawn twice by two different pieces of code:
 * the DOM lays them out for the preview and a canvas re-draws them at export
 * resolution. The only reason those two can agree about what half of a letter
 * reveal looks like is that both ask this module, so this is where the shared
 * answer gets checked.
 *
 *   A reveal must start empty and finish whole. Anything else means a caption
 *   that is invisible in the exported file, or one that never finishes
 *   arriving, and neither is visible while scrubbing the middle of it.
 *
 *   It must never go backwards. A letter that appears, disappears and appears
 *   again reads as a flicker, and at 60fps nobody can tell you which frame it
 *   happened on.
 *
 *   Resolving animated overlays must leave un-animated ones alone, by
 *   identity, because the preview uses that to decide whether it has to redraw
 *   on every frame of the clock.
 */

import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const R = (p) => jiti.import('../' + p)

const {
  blockAlpha,
  glyphsAt,
  needsGlyphs,
  progressOf,
  resolveOverlays,
  revealOf,
  scaleOf,
  OVERLAY_ANIMATABLE,
} = await R('src/lib/overlays.ts')
const { targetLabel, getTargetValue, setTargetValue } = await R('src/lib/evaluator.ts')

let fails = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else {
    console.log(`  FAIL ${name} ${detail}`)
    fails++
  }
}

const LINE = 'Ship it today'
const KINDS = ['letters', 'words', 'rise']
const solid = (gs) => gs.filter((g) => g.alpha > 0.999).length
const lit = (gs) => gs.filter((g) => g.alpha > 0).length

// ---------------------------------------------------------------------------

console.log('\n--- reveals ---')
for (const kind of KINDS) {
  check(`${kind}: nothing has arrived at 0`, lit(glyphsAt(LINE, kind, 0)) === 0)

  const done = glyphsAt(LINE, kind, 1)
  check(`${kind}: everything is solid at 1`, solid(done) === LINE.length, `${solid(done)}/${LINE.length}`)
  check(`${kind}: nothing is still displaced at 1`, done.every((g) => g.rise === 0))
  check(`${kind}: the characters come back unchanged`, done.map((g) => g.char).join('') === LINE)

  // monotonic: sweeping the driver forward can only ever add paint
  let backwards = 0
  let prev = -1
  for (let i = 0; i <= 200; i++) {
    const total = glyphsAt(LINE, kind, i / 200).reduce((a, g) => a + g.alpha, 0)
    if (total < prev - 1e-9) backwards++
    prev = total
  }
  check(`${kind}: never goes backwards`, backwards === 0, `${backwards} steps lost paint`)

  // and it is actually mid-way at mid-way, rather than jumping at either end
  const half = lit(glyphsAt(LINE, kind, 0.5))
  check(`${kind}: half way through shows some of it`, half > 0 && half < LINE.length, `${half}`)

  // out of range is clamped, not extrapolated
  check(`${kind}: below zero is empty`, lit(glyphsAt(LINE, kind, -3)) === 0)
  check(`${kind}: above one is whole`, solid(glyphsAt(LINE, kind, 9)) === LINE.length)
}

{
  // words arrive whole: no frame may show part of one
  const word = 'alpha beta'
  let split = 0
  for (let i = 0; i <= 100; i++) {
    const gs = glyphsAt(word, 'words', i / 100)
    const first = gs.slice(0, 5).map((g) => g.alpha)
    const second = gs.slice(6).map((g) => g.alpha)
    if (new Set(first).size > 1 || new Set(second).size > 1) split++
  }
  check('words: a word is never half typed', split === 0, `${split} frames`)

  // spaces ride in with the character before them, so they never flicker
  const gs = glyphsAt(word, 'letters', 0.5)
  check('letters: a space is never brighter than the letter before it', gs[5].alpha <= gs[4].alpha)
}

{
  const empty = glyphsAt('', 'letters', 0.5)
  check('an empty line resolves to no glyphs', empty.length === 0)
  const spaces = glyphsAt('   ', 'letters', 0)
  check('a line of only spaces does not divide by zero', spaces.every((g) => Number.isFinite(g.alpha)))
  const newline = glyphsAt('a\nb', 'letters', 1)
  check('newlines survive the reveal', newline.map((g) => g.char).join('') === 'a\nb')
}

console.log('\n--- fade, which is one alpha rather than many ---')
{
  check('a fade is clear at zero', blockAlpha('fade', 0) === 0)
  check('a fade is solid at one', blockAlpha('fade', 1) === 1)
  check('a fade is half way at half way', blockAlpha('fade', 0.5) === 0.5)
  check('every other kind leaves the block alone', ['none', 'letters', 'words', 'rise'].every((k) => blockAlpha(k, 0.2) === 1))
  check('a fade never needs per-glyph drawing', !needsGlyphs({ type: 'text', text: LINE, reveal: 'fade', progress: 0.3 }))
  check('a finished reveal never needs it either', !needsGlyphs({ type: 'text', text: LINE, reveal: 'rise', progress: 1 }))
  check('an unfinished one does', needsGlyphs({ type: 'text', text: LINE, reveal: 'rise', progress: 0.3 }))
}

console.log('\n--- defaults, for overlays saved before any of this existed ---')
{
  const old = { id: 'o1', type: 'image', assetId: 'a', x: 0.5, y: 0.5, opacity: 1, rotation: 0, width: 0.2 }
  check('an overlay with no scale reads as 1', scaleOf(old) === 1)
  const oldText = { id: 'o2', type: 'text', text: 'hi', x: 0, y: 0, opacity: 1, rotation: 0 }
  check('text with no reveal is just there', revealOf(oldText) === 'none')
  check('text with no progress has already arrived', progressOf(oldText) === 1)
  check('...so it draws the plain string', !needsGlyphs(oldText))
}

console.log('\n--- resolving against the clock ---')
{
  const o = { id: 'o1', type: 'text', text: 'hi', x: 0.5, y: 0.5, opacity: 1, rotation: 0 }
  const overlays = [o]
  const kf = (target, timeMs, value) => ({ id: `k${timeMs}${target}`, target, timeMs, value, easing: 'linear' })

  check('no tracks hands back the very same array', resolveOverlays(overlays, [], 0) === overlays)
  check(
    'a camera track is not an overlay track',
    resolveOverlays(overlays, [kf('camera.zoom', 0, 1)], 0) === overlays,
  )

  const tracks = [kf('ov.o1.opacity', 0, 0), kf('ov.o1.opacity', 1000, 1)]
  const mid = resolveOverlays(overlays, tracks, 500)
  check('an animated overlay is a copy, not the original', mid[0] !== o)
  check('...sampled at the playhead', Math.abs(mid[0].opacity - 0.5) < 1e-9, String(mid[0].opacity))
  check('...leaving everything else alone', mid[0].x === 0.5 && mid[0].text === 'hi')
  check('the original is never mutated', o.opacity === 1)

  const untouched = resolveOverlays([o, { ...o, id: 'o2' }], tracks, 500)
  check('an overlay with no tracks of its own is passed through', untouched[1].opacity === 1)
}

console.log('\n--- target paths ---')
{
  const shot = {
    overlays: [{ id: 'o1', type: 'text', text: 'Hello world', x: 0.25, y: 0.5, opacity: 0.8, rotation: 12 }],
    scene: { devices: [], camera: {} },
  }
  check('every animatable property reads back', OVERLAY_ANIMATABLE.every((p) => Number.isFinite(getTargetValue(shot, `ov.o1.${p}`))))
  check('x reads what the overlay holds', getTargetValue(shot, 'ov.o1.x') === 0.25)
  check('scale falls back to 1', getTargetValue(shot, 'ov.o1.scale') === 1)
  check('progress falls back to arrived', getTargetValue(shot, 'ov.o1.progress') === 1)

  setTargetValue(shot, 'ov.o1.x', 0.75)
  check('writing lands on the overlay', shot.overlays[0].x === 0.75)
  setTargetValue(shot, 'ov.missing.x', 0.1)
  check('writing to a layer that is gone is a no-op, not a throw', shot.overlays.length === 1)
  check('reading one gives zero', getTargetValue(shot, 'ov.missing.x') === 0)

  const label = targetLabel('ov.o1.opacity', [], shot.overlays)
  check('a track is named after its layer', label.includes('Hello world') && label.includes('Opacity'), label)
  check(
    'a long line is cut short',
    targetLabel('ov.o1.x', [], [{ ...shot.overlays[0], text: 'a'.repeat(80) }]).length < 30,
  )
  check('a layer that is gone still labels', targetLabel('ov.zz.x', [], []).startsWith('Layer'))
}

console.log(fails === 0 ? '\nAll overlay checks passed.\n' : `\n${fails} check(s) failed.\n`)
process.exit(fails === 0 ? 0 : 1)
