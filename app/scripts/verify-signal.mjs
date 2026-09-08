/**
 * Signal's engine, checked without a browser.
 *
 * Four things are worth a script rather than a reviewer's attention, because
 * all four fail silently and none of them fail where you are looking.
 *
 *   Fields must stay in range. A generator that writes 1.4 or NaN does not
 *   throw, it produces a frame that is quietly, uniformly wrong, and the
 *   difference between "this effect is too strong" and "this effect is broken"
 *   is invisible at a glance.
 *
 *   Generators must be reachable. A field nobody made a preset for is a field
 *   nobody will ever pick out of a wall of thirty buttons.
 *
 *   The embed masks must match the real masks. They are a second, hand-written
 *   copy of code that lives in `quantize.ts`, and a second copy of anything
 *   drifts. This runs both over the same coordinates and compares.
 *
 *   Lifted generators must be self-contained. The embed exporter stringifies a
 *   generator and emits only the helpers named in FIELD_HELPERS or
 *   FIGURE_HELPERS beside it. A generator that reaches for anything else works
 *   perfectly in the app and throws `x is not defined` in somebody's page.
 */

import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const R = (p) => jiti.import('../' + p)

const { FIELDS, FIELD_HELPERS, resolveParams } = await R('src/signal/fields.ts')
const { FIGURES, FIGURE_HELPERS } = await R('src/signal/figures.ts')
const { MASKS, MASK_LIST, ditherField, hexRgb } = await R('src/signal/quantize.ts')
const { PRESETS, PRESET_GROUPS } = await R('src/signal/presets.ts')
const { PALETTES } = await R('src/signal/palettes.ts')
const { FX_ORDER, hasFx, pixelPasses } = await R('src/lib/postfx.ts')
const { SOURCES } = await R('src/signal/sources.ts')
const { migrateDoc, defaultSignalDoc } = await R('src/signal/types.ts')

let fails = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else {
    console.log(`  FAIL ${name} ${detail}`)
    fails++
  }
}

const W = 64
const H = 48

// ---------------------------------------------------------------------------

console.log('\n--- field generators ---')
check('forty-two fields', FIELDS.length === 42, `got ${FIELDS.length}`)

for (const spec of FIELDS) {
  const buf = new Float32Array(W * H)
  let bad = null

  // three times through, at the extremes of every knob and at a time far
  // enough along to catch anything that drifts out of range as t grows
  const defaults = resolveParams(spec.params, {})
  for (const [t, intensity, scale] of [
    [0, 0, 0.5],
    [3.7, 50, 4],
    [900, 100, 12],
  ]) {
    buf.fill(-999)
    spec.fn(buf, W, H, t, intensity, scale, defaults)
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i]
      // negative is legal: it is the accent sentinel. NaN and >1 are not.
      if (!Number.isFinite(v) || v > 1) {
        bad = `t=${t} i=${intensity} s=${scale} → ${v} at ${i}`
        break
      }
      if (v === -999) {
        bad = `t=${t} left index ${i} unwritten`
        break
      }
    }
    if (bad) break
  }
  check(`${spec.id} writes every cell, finite and ≤ 1`, bad === null, bad ?? '')
}

console.log('\n--- fields are deterministic ---')
for (const spec of FIELDS) {
  const a = new Float32Array(W * H)
  const b = new Float32Array(W * H)
  const dp = resolveParams(spec.params, {})
  spec.fn(a, W, H, 2.5, 60, 5, dp)
  spec.fn(b, W, H, 2.5, 60, 5, dp)
  let same = true
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      same = false
      break
    }
  }
  // the export renders frame N on its own; if a generator carried state, the
  // frame it produced would depend on how many frames preceded it
  check(`${spec.id} is a pure function of t`, same)
}

// ---------------------------------------------------------------------------

console.log('\n--- masks ---')
check('every mask in MASK_LIST has an implementation', MASK_LIST.every((m) => typeof MASKS[m.id] === 'function'))
check('every implemented mask is offered', Object.keys(MASKS).every((id) => MASK_LIST.some((m) => m.id === id)))

for (const [id, fn] of Object.entries(MASKS)) {
  let lo = Infinity
  let hi = -Infinity
  let finite = true
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      const v = fn(x, y)
      if (!Number.isFinite(v)) finite = false
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  check(`${id} stays within 0..1`, finite && lo >= 0 && hi <= 1, `${lo}..${hi}`)
}

/*
 * The embed masks, re-read out of the exporter's own source.
 *
 * Parsed from the file rather than imported, because `export.ts` reaches for
 * the DOM at module scope through its mediabunny import path and will not load
 * under node. A regex over the table is uglier than an import and is the only
 * way to check the thing that actually ships.
 */
console.log('\n--- embed masks match the real ones ---')
const exportSrc = await (await import('node:fs/promises')).readFile(
  new URL('../src/signal/export.ts', import.meta.url),
  'utf8',
)
const table = exportSrc.slice(
  exportSrc.indexOf('const EMBED_MASKS'),
  exportSrc.indexOf('/** `var <minified name>'),
)
const found = [...table.matchAll(/'?([\w-]+)'?:\s*\n?\s*'(function[^']*)'/g)]
check('all ten masks are in the embed table', found.length === Object.keys(MASKS).length, `got ${found.length}`)

for (const [, id, src] of found) {
  const real = MASKS[id]
  if (!real) {
    check(`${id} embed mask names a real mask`, false)
    continue
  }
  // eslint-disable-next-line no-new-func
  const embed = new Function('return ' + src)()
  let worst = 0
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      worst = Math.max(worst, Math.abs(real(x, y) - embed(x, y)))
    }
  }
  check(`${id} embed mask matches quantize.ts`, worst < 1e-9, `max delta ${worst}`)
}

// ---------------------------------------------------------------------------

/**
 * Every name a stringified generator reaches for that it does not itself bind.
 *
 * The embed exporter lifts a generator with `toString()` and emits only the
 * declared helpers beside it, so anything else it names is a crash waiting in
 * somebody's page. This finds those names by stripping what cannot be a free
 * reference and subtracting what the function binds itself.
 *
 * Two things make it fiddly, and both are worth naming because both produced a
 * false alarm before they were handled.
 *
 * Numeric literals with an exponent. `1e-12` contains an `e`, and a naive
 * identifier scan reports a generator as depending on a variable called `e`.
 * Numbers are stripped before anything else.
 *
 * Module namespaces. Under the loader used here, an import from another module
 * arrives as `_fields.fbm(...)` rather than as a bare `fbm`, because nothing
 * has bundled the two files together yet. Stripping the `.fbm` would leave
 * `_fields` looking like a free variable. So a member expression is checked by
 * its *property* instead: `_fields.fbm` counts as a reference to `fbm`, which
 * is exactly what it will be once the bundler inlines it.
 *
 * That last point is why this check is not the last word. It proves the set of
 * names is right; `verify-signal-embed.mjs` proves the bundler really does turn
 * them into bare bindings, by lifting every generator out of a real minified
 * build and running it.
 */
const GLOBALS = new Set([
  'Math', 'Number', 'String', 'Array', 'Object', 'JSON', 'Float32Array', 'Float64Array',
  'Uint8Array', 'Infinity', 'NaN', 'undefined', 'null', 'true', 'false',
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'continue',
  'break', 'new', 'typeof', 'in', 'of', 'do', 'switch', 'case', 'default', 'this', 'void',
])

function freeIdentifiers(fn) {
  let src = fn.toString()
  src = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
  src = src.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, ' ')
  // numbers first, so an exponent in `1e-12` never survives to look like a variable
  src = src.replace(/\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, ' ')

  // what the function binds itself has to be known before member expressions
  // can be judged, because `p.detail` is only uninteresting once `p` is known
  // to be a parameter
  const bound = new Set()
  const params = src.slice(src.indexOf('(') + 1, src.indexOf(')'))
  for (const m of params.matchAll(/[A-Za-z_$][\w$]*/g)) bound.add(m[0])
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1])
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g))
    for (const n of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) bound.add(n[0])
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g))
    for (const n of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) bound.add(n[0])
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) bound.add(m[1])
  for (const m of src.matchAll(/\bfunction\s*[\w$]*\s*\(([^)]*)\)/g))
    for (const n of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) bound.add(n[0])

  const referenced = new Set()
  src = src.replace(/\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)/g, (_m, obj, prop) => {
    // `Math.sin` and `p.detail` reach for nothing outside the function. An
    // unrecognised object is a module namespace, and what it will become once
    // the bundler inlines it is a bare reference to the property.
    if (!GLOBALS.has(obj) && !bound.has(obj)) referenced.add(prop)
    return ' '
  })
  // whatever dots are left hang off a parenthesised expression or a chain
  // (`(motion.text || 'X').toUpperCase()`), and a property is never a free
  // reference, so the object was already judged on the pass above
  src = src.replace(/\.\s*[A-Za-z_$][\w$]*/g, ' ')
  src = src.replace(/[A-Za-z_$][\w$]*\s*:/g, ' ')

  for (const m of src.matchAll(/[A-Za-z_$][\w$]*/g)) referenced.add(m[0])

  const free = new Set()
  for (const name of referenced) {
    if (GLOBALS.has(name) || bound.has(name)) continue
    free.add(name)
  }
  return free
}

console.log('\n--- lifted generators are self-contained ---')
const fieldHelperNames = new Set(FIELD_HELPERS.map((f) => f.name))
check('FIELD_HELPERS all have usable names', FIELD_HELPERS.every((f) => f.name.length > 0))
for (const spec of FIELDS) {
  const missing = [...freeIdentifiers(spec.fn)].filter((n) => !fieldHelperNames.has(n))
  check(`${spec.id} closes over nothing but FIELD_HELPERS`, missing.length === 0, missing.join(', '))
}

const figureHelperNames = new Set(FIGURE_HELPERS.map((f) => f.name))
check('FIGURE_HELPERS all have usable names', FIGURE_HELPERS.every((f) => f.name.length > 0))
for (const spec of FIGURES) {
  const missing = [...freeIdentifiers(spec.fn)].filter((n) => !figureHelperNames.has(n))
  check(`${spec.id} closes over nothing but FIGURE_HELPERS`, missing.length === 0, missing.join(', '))
}

/*
 * Every figure has to actually put marks on the canvas.
 *
 * Fields are checked by reading the buffer they fill, and nothing was doing the
 * equivalent for figures, so `subdivide` shipped drawing one empty rectangle at
 * every setting: the root cell lost a coin flip that decided whether the whole
 * picture existed, and losing it is silent. A recording context is enough to
 * catch that class without a browser, and it costs one small stub.
 *
 * The bar is deliberately low. This is not asking whether a figure looks good,
 * only whether it drew anything beyond the background `ground()` lays down.
 */
console.log('\n--- figures draw something ---')

function recorder() {
  let marks = 0
  const mark = () => void marks++
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    beginPath() {},
    moveTo: mark,
    lineTo: mark,
    arc: mark,
    ellipse: mark,
    roundRect: mark,
    fillRect: mark,
    strokeRect: mark,
    fillText: mark,
    fill: mark,
    stroke: mark,
    createRadialGradient: () => ({ addColorStop() {} }),
  }
  return {
    ctx,
    // `ground()` is one fillRect over the whole canvas, and it is not a mark
    get marks() {
      return marks - 1
    },
  }
}

const FIG_INK = { fg: [247, 248, 248], bg: [8, 9, 10], accent: [94, 106, 210] }
const FIG_MOTION = { rotateX: 30, rotateY: 0, rotateZ: 0, autoSpin: 30, flatten: 0, text: 'RIBBIT' }

for (const spec of FIGURES) {
  const r = recorder()
  const p = resolveParams(spec.params, {})
  let threw = null
  try {
    spec.fn(r.ctx, 256, 256, 0.7, 55, 4, FIG_INK, FIG_MOTION, p)
  } catch (e) {
    threw = e.message
  }
  check(`${spec.id} draws more than its background`, threw === null && r.marks >= 8, threw ?? `${r.marks} marks`)
}

/*
 * And specifically the one that was broken, across the range of the two
 * controls that decide how much layout there is. A single rectangle is the
 * failure signature: it means the recursion stopped at the root.
 */
const sub = FIGURES.find((f) => f.id === 'subdivide')
for (const split of [0.1, 0.5, 0.72, 1]) {
  const r = recorder()
  sub.fn(r.ctx, 512, 512, 0, 55, 4, FIG_INK, FIG_MOTION, {
    ...resolveParams(sub.params, {}),
    split,
  })
  check(`subdivide splits at least once at split ${split}`, r.marks >= 2, `${r.marks} marks`)
}

console.log('\n--- the helpers themselves are self-contained ---')
for (const list of [FIELD_HELPERS, FIGURE_HELPERS]) {
  const names = new Set(list.map((f) => f.name))
  for (const fn of list) {
    const missing = [...freeIdentifiers(fn)].filter((n) => !names.has(n))
    check(`helper ${fn.name} needs nothing else`, missing.length === 0, missing.join(', '))
  }
}

// ---------------------------------------------------------------------------

console.log('\n--- the catalogue ---')
const ids = SOURCES.map((s) => `${s.kind}:${s.id}`)
check('every generator id is unique', new Set(ids).size === ids.length)
check('seventy-one generators', SOURCES.length === 71, `got ${SOURCES.length}`)
check('every generator declares what it reads', SOURCES.every((s) => s.uses.length > 0))
check('every generator has a hint', SOURCES.every((s) => s.hint.length > 8))
check(
  'only the generators that read text say so',
  SOURCES.filter((s) => s.uses.includes('text')).length === 2,
)
check(
  'only the generators that rotate say so',
  SOURCES.filter((s) => s.uses.includes('rotate')).length === 2,
)

console.log('\n--- presets ---')
check('every preset id is unique', new Set(PRESETS.map((p) => p.id)).size === PRESETS.length)
for (const p of PRESETS) {
  const known = SOURCES.some((s) => s.kind === p.kind && s.id === p.source)
  check(`${p.id} names a real generator`, known, `${p.kind}:${p.source}`)
}
check('every preset sits in a declared group', PRESETS.every((p) => PRESET_GROUPS.includes(p.group)))

/* The point of the whole list: nothing in the tool is unreachable. */
for (const s of SOURCES) {
  const reached = PRESETS.some((p) => p.kind === s.kind && p.source === s.id)
  check(`${s.kind}:${s.id} is reachable from a preset`, reached)
}

const hex = /^#[0-9a-fA-F]{6}$/
console.log('\n--- colour ---')
check('every palette id is unique', new Set(PALETTES.map((p) => p.id)).size === PALETTES.length)
check(
  'every palette colour is a full hex triple',
  PALETTES.every((p) => hex.test(p.ink) && hex.test(p.paper) && hex.test(p.accent)),
)
check('every palette mix is 0..100', PALETTES.every((p) => p.mix >= 0 && p.mix <= 100))
check(
  'every preset colour is a full hex triple',
  PRESETS.every((p) => hex.test(p.ink) && hex.test(p.paper) && hex.test(p.accent)),
)
check('hexRgb round-trips', (() => {
  const [r, g, b] = hexRgb('#5e6ad2')
  return r === 0x5e && g === 0x6a && b === 0xd2
})())
check('hexRgb accepts shorthand', (() => {
  const [r, g, b] = hexRgb('#f0a')
  return r === 255 && g === 0 && b === 170
})())

// a two-tone tool is useless if ink and paper are the same colour
for (const p of PALETTES) {
  check(`${p.id} has ink distinct from paper`, p.ink.toLowerCase() !== p.paper.toLowerCase())
}

// ---------------------------------------------------------------------------

console.log('\n--- the dither pass ---')
const field = new Float32Array(W * H)
for (let i = 0; i < field.length; i++) field[i] = (i % W) / W

const base = { mask: 'bayer4', threshold: 128, spread: 50, pixelSize: 1, randomness: 0, glyphs: 'off', ramp: '' }
const bits = ditherField(field, W, H, base)
check('dither writes one byte per pixel', bits.length >= W * H)
check('dither emits only 0 and 1', bits.slice(0, W * H).every((v) => v === 0 || v === 1))

// a ramp from black to white must come out mostly dark on the left and mostly
// light on the right, whatever the mask: that is the one property a dither has
const left = bits.slice(0, 8).reduce((a, b) => a + b, 0)
const rightRow = Array.from(bits.slice(W - 8, W)).reduce((a, b) => a + b, 0)
check('dither tracks the ramp', left < rightRow, `${left} vs ${rightRow}`)

for (const m of MASK_LIST) {
  const out = ditherField(field, W, H, { ...base, mask: m.id })
  const lit = Array.from(out.slice(0, W * H)).reduce((a, b) => a + b, 0)
  // 'none' is a hard cut with no pattern, so it is allowed to be degenerate at
  // the edges; every other mask should light somewhere between none and all
  const ok = m.id === 'none' ? lit >= 0 : lit > 0 && lit < W * H
  check(`${m.id} produces a mixed frame`, ok, `${lit} of ${W * H} lit`)
}

const randomised = ditherField(field, W, H, { ...base, pixelSize: 4, randomness: 60 })
const randomisedAgain = ditherField(field, W, H, { ...base, pixelSize: 4, randomness: 60 })
check(
  'pixel-size randomness is hashed, not rolled',
  Array.from(randomised.slice(0, W * H)).every((v, i) => v === randomisedAgain[i]),
)

// ---------------------------------------------------------------------------

console.log('\n--- the finishing chain ---')
check('every fx id is unique', new Set(FX_ORDER.map((f) => f.id)).size === FX_ORDER.length)
check('every fx has a hint', FX_ORDER.every((f) => f.hint.length > 8))
check('every fx declares a cost', FX_ORDER.every((f) => f.cost === 'draw' || f.cost === 'pixel'))
check('an empty chain is skippable', hasFx({}) === false)
check('a zeroed chain is skippable', hasFx({ bloom: { amount: 0 } }) === false)
check('a live chain is not', hasFx({ bloom: { amount: 0.2 } }) === true)
check('pixel passes are counted', pixelPasses({ grain: { amount: 1 }, bloom: { amount: 1 } }) === 1)

// every preset's chain must name effects that exist
for (const p of PRESETS) {
  const unknown = Object.keys(p.fx ?? {}).filter((id) => !FX_ORDER.some((f) => f.id === id))
  check(`${p.id} uses only real effects`, unknown.length === 0, unknown.join(', '))
}

// ---------------------------------------------------------------------------

console.log('\n--- documents saved by an older build still open ---')
{
  /*
   * The regression this guards is the worst kind the tool has had: adding a
   * field to the document shipped a build where yesterday's saved document had
   * no `source.params`, a panel read a key off undefined during render, and
   * React unmounted the entire suite. A black screen, from one absent key.
   */
  const modern = defaultSignalDoc()

  // strip every group down to nothing and check the defaults come back
  const bare = { version: 1 }
  const filled = migrateDoc(bare)
  check('a document with only a version migrates', filled !== null)
  if (filled) {
    for (const group of ['source', 'motion', 'quantize', 'ink', 'canvas']) {
      const missing = Object.keys(modern[group]).filter((k) => filled[group][k] === undefined)
      check(`${group} is complete after migration`, missing.length === 0, missing.join(', '))
    }
    check('params is an object, never undefined', typeof filled.source.params === 'object' && filled.source.params !== null)
    check('fx is an object, never undefined', typeof filled.fx === 'object' && filled.fx !== null)
  }

  // a real pre-upgrade shape: everything today except the three newest fields
  const old = JSON.parse(JSON.stringify(modern))
  delete old.source.params
  delete old.quantize.detail
  delete old.canvas.preview
  const up = migrateDoc(old)
  check('a pre-upgrade document migrates', up !== null)
  if (up) {
    check('source.params is restored', typeof up.source.params === 'object')
    check('quantize.detail is restored', typeof up.quantize.detail === 'number')
    check('canvas.preview is restored', up.canvas.preview === 'fit' || up.canvas.preview === 'exact')
    // and every generator can be resolved against it without throwing
    let threw = null
    for (const src of SOURCES) {
      try {
        resolveParams(src.params, up.source.params)
      } catch (e) {
        threw = src.id + ': ' + e.message
        break
      }
    }
    check('every generator resolves against a migrated document', threw === null, threw ?? '')
  }

  // what a user actually kept must not be overwritten by a default
  const kept = migrateDoc({ ...JSON.parse(JSON.stringify(modern)), name: 'Mine' })
  check('migration keeps what the document already had', kept?.name === 'Mine')
  check('nonsense does not migrate', migrateDoc(null) === null && migrateDoc({ version: 9 }) === null)
}

console.log(fails === 0 ? '\nAll Signal checks passed.\n' : `\n${fails} check(s) failed.\n`)
process.exit(fails === 0 ? 0 : 1)
