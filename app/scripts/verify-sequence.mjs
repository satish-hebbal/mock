/**
 * The shot sequence, checked without a browser.
 *
 * Four things here fail silently, and all four fail in the exported file
 * rather than on screen, which is the worst place to find out.
 *
 *   The layout has to be monotonic. Every shot must start after the one before
 *   it, whatever lengths and blends are set, or the exporter walks time
 *   backwards and the encoder gets frames out of order.
 *
 *   A blend must shorten the film by exactly its own length, because a
 *   transition is an overlap. If the clamp and the layout disagree about how
 *   long a blend actually got, the running time the dialog quotes is not the
 *   running time that comes out.
 *
 *   Every frame must belong to somebody. The exporter decides up front which
 *   shot renders each frame; a frame owned by nobody is a hole in the video and
 *   a frame owned by two is a duplicate.
 *
 *   The migration has to be lossless. A project saved before shots existed is
 *   somebody's work, and it has to open as the same single take, not as a
 *   default scene.
 */

import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const R = (p) => jiti.import('../' + p)

const {
  activeShot,
  effectiveTransitionMs,
  fadeShowsIncoming,
  fadeVeil,
  planFrames,
  resolveSequence,
  sequenceDuration,
  sequenceLayout,
  MAX_TRANSITION_MS,
} = await R('src/lib/sequence.ts')

let fails = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else {
    console.log(`  FAIL ${name} ${detail}`)
    fails++
  }
}

const near = (a, b, eps = 0.001) => Math.abs(a - b) < eps

/** A project of `lengths`, joined by `joins` (one per gap). */
function film(lengths, joins = []) {
  const shots = lengths.map((durationMs, i) => ({
    id: `s${i}`,
    name: `Shot ${i + 1}`,
    durationMs,
    scene: {},
    overlays: [],
    keyframes: [],
    transition: joins[i - 1] ?? { kind: 'cut', durationMs: 400 },
  }))
  return { version: 3, name: 't', fps: 30, exportSize: { width: 16, height: 9 }, shots, activeShotId: shots[0].id, assets: [] }
}

const D = (ms) => ({ kind: 'dissolve', durationMs: ms })
const F = (ms) => ({ kind: 'fadeBlack', durationMs: ms })

// ---------------------------------------------------------------------------

console.log('\n--- layout ---')
{
  const p = film([3000, 2000, 4000])
  const l = sequenceLayout(p)
  check('cuts queue end to end', l.map((x) => x.start).join() === '0,3000,5000')
  check('a cut film is the sum of its shots', sequenceDuration(p) === 9000)
  check('active shot falls back to the first', activeShot({ ...p, activeShotId: 'gone' }).id === 's0')
}

{
  const p = film([3000, 2000, 4000], [D(500), F(1000)])
  const l = sequenceLayout(p)
  check('a blend pulls the next shot earlier', l[1].start === 2500 && l[2].start === 3500)
  check('the film loses exactly the blend time', sequenceDuration(p) === 9000 - 500 - 1000)
  check('starts are strictly increasing', l.every((x, i) => i === 0 || x.start > l[i - 1].start))
}

{
  // a blend longer than either neighbour would let shot n+1 start before shot n
  const p = film([600, 800], [D(5000)])
  const l = sequenceLayout(p)
  check('a blend cannot eat more than half a shot', l[1].start === 600 - 300, `start ${l[1].start}`)
  check('clamped blends keep the film positive', sequenceDuration(p) > 0)
  check(
    'the cap applies before the halves',
    effectiveTransitionMs({ durationMs: 60000 }, { durationMs: 60000, transition: D(9000) }) ===
      MAX_TRANSITION_MS,
  )
  check('a cut never overlaps', effectiveTransitionMs({ durationMs: 9000 }, { durationMs: 9000, transition: { kind: 'cut', durationMs: 800 } }) === 0)
}

console.log('\n--- resolving a moment ---')
{
  const p = film([3000, 3000], [D(600)])
  const start = sequenceLayout(p)[1].start // 2400

  const before = resolveSequence(p, 1000)
  check('outside a blend there is one shot', before.from === null && before.to.shot.id === 's0')
  check('...at its own local time', before.toLocalMs === 1000)

  const mid = resolveSequence(p, start + 300)
  check('inside a blend both shots are live', mid.from?.shot.id === 's0' && mid.to.shot.id === 's1')
  check('...and the mix is halfway', near(mid.mix, 0.5))
  check('...each at its own local time', mid.fromLocalMs === 2700 && mid.toLocalMs === 300)

  const after = resolveSequence(p, start + 601)
  check('past the blend only the newcomer is live', after.from === null && after.to.shot.id === 's1')

  const end = resolveSequence(p, 99999)
  check('past the end clamps to the last frame', end.to.shot.id === 's1' && end.toLocalMs === 3000)
  check('before the start clamps to zero', resolveSequence(p, -500).toLocalMs === 0)
}

console.log('\n--- fades ---')
{
  check('a fade peaks opaque at the midpoint', near(fadeVeil('fadeBlack', 0.5).alpha, 1))
  check('a fade is clear at both ends', fadeVeil('fadeWhite', 0).alpha === 0 && fadeVeil('fadeWhite', 1).alpha === 0)
  check('white fades through white', fadeVeil('fadeWhite', 0.5).color === '#ffffff')
  check('a dissolve has no veil', fadeVeil('dissolve', 0.5) === null && fadeVeil('cut', 0.5) === null)
  check('the handover is at the midpoint', !fadeShowsIncoming(0.49) && fadeShowsIncoming(0.5))
}

console.log('\n--- frame ownership (the plan the exporter walks) ---')
for (const [label, p] of [
  ['cuts', film([1000, 1000, 1000])],
  ['dissolves', film([1500, 1500, 2000], [D(400), D(700)])],
  ['fades', film([1200, 1800], [F(600)])],
  ['mixed', film([2000, 900, 2500, 1000], [D(300), F(800), D(1200)])],
]) {
  for (const fps of [24, 30, 60]) {
    const tag = `${label} @${fps}`
    const plan = planFrames(p, fps)
    const owned = p.shots.map(() => 0)
    const held = p.shots.map(() => 0)
    let holes = 0

    for (const f of plan) {
      if (!Number.isInteger(f.owner) || f.owner < 0 || f.owner >= p.shots.length) holes++
      else owned[f.owner]++
      if (f.under !== null) held[f.under]++
    }

    check(`${tag}: every frame has exactly one owner`, holes === 0, `${holes} orphaned`)
    check(`${tag}: the counts add up`, owned.reduce((a, b) => a + b, 0) === plan.length)
    check(`${tag}: no shot renders nothing`, owned.every((n) => n > 0), owned.join())

    /*
     * The exporter renders shot by shot and encodes as it goes, so a shot may
     * only be asked to hold frames for the one directly after it, and a held
     * frame must belong to that next shot. Anything else is a frame the loop
     * would need to travel back in time for.
     */
    let backwards = 0
    plan.forEach((f) => {
      if (f.under !== null && f.under !== f.owner - 1) backwards++
    })
    check(`${tag}: a blend only ever reaches one shot back`, backwards === 0, `${backwards} bad`)

    // and a fade must never ask for the other side's pixels
    const fadeNeedsBoth = plan.some((f) => f.veil && f.under !== null)
    check(`${tag}: fades never hold a frame`, !fadeNeedsBoth)
  }
}

console.log('\n--- migration ---')
{
  const { migrateProject, defaultProject } = await R('src/lib/project.ts')
  const v2 = {
    version: 2,
    name: 'Old',
    durationMs: 4200,
    fps: 24,
    exportSize: { width: 800, height: 600 },
    scene: { devices: [{ id: 'd1' }], camera: { zoom: 2 } },
    overlays: [{ id: 'o1', type: 'text' }],
    keyframes: [{ id: 'k1', target: 'camera.zoom', timeMs: 0, value: 1, easing: 'smooth' }],
    assets: [{ id: 'a1' }],
  }
  const up = migrateProject(v2)
  check('a v2 project becomes one shot', up.version === 3 && up.shots.length === 1)
  check('its length becomes the shot length', up.shots[0].durationMs === 4200)
  check('its scene, keyframes and overlays travel with it', up.shots[0].scene.camera.zoom === 2 && up.shots[0].keyframes.length === 1 && up.shots[0].overlays.length === 1)
  check('project-level settings stay project-level', up.fps === 24 && up.exportSize.width === 800 && up.assets.length === 1)
  check('the migrated shot is the active one', activeShot(up).id === up.shots[0].id)
  check('a v3 project passes through untouched', migrateProject(up) === up)
  check('a fresh project is one shot on the current version', (() => {
    const d = defaultProject()
    return d.version === 3 && d.shots.length === 1 && d.activeShotId === d.shots[0].id
  })())
}

console.log(fails === 0 ? '\nAll sequence checks passed.\n' : `\n${fails} check(s) failed.\n`)
process.exit(fails === 0 ? 0 : 1)
