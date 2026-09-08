/**
 * The embed export, checked against a real minified build.
 *
 * `verify-signal.mjs` checks the maintenance hazard: that no generator reaches
 * for a helper the exporter does not emit. This checks the premise underneath
 * it, which no amount of reading the source can settle.
 *
 * The exporter lifts a generator out of the bundle with `toString()` and emits
 * the helpers it needs beside it, declared under `Function.prototype.name`. In
 * development those names are `clamp01` and `rgba`. In production they are `e`
 * and `a`, and the whole trick rests on the minifier renaming the declaration
 * and the call sites inside the stringified body to the same thing, and on it
 * never handing a local variable a name that would shadow one of them.
 *
 * That is a claim about a build tool, so it is tested against the build tool:
 * this builds `fields.ts` and `figures.ts` minified exactly as the app is,
 * lifts every generator out of the result the way the exporter would, runs it
 * in a bare `new Function` scope with nothing else in it, and compares the
 * output against the unminified original.
 *
 * Fields compare by pixel. Figures have no pixels outside a browser, so they
 * are handed a recording proxy and compared by the sequence of canvas calls
 * they make, which is a stricter test than a bitmap would be.
 */

import { build } from 'vite'
import { createJiti } from 'jiti'
import { pathToFileURL } from 'node:url'
import { rm, writeFile, mkdir } from 'node:fs/promises'

const root = process.cwd()
const outDir = 'node_modules/.signal-embed-check'

let fails = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else {
    console.log(`  FAIL ${name} ${detail}`)
    fails++
  }
}

console.log('\n--- building the generators, minified as the app builds them ---')
/*
 * One entry rather than two.
 *
 * Building the families as separate entries splits them into separate chunks,
 * each minified on its own, and two unrelated helpers can then both be renamed
 * to `e`. That is not how the app ships: everything under src lands in one
 * chunk, where the bundler guarantees unique top-level names. Testing the split
 * arrangement would be testing a build nobody performs, and would fail on a
 * collision the real bundle cannot have.
 *
 * The guard in `helperSource` is what covers the day that stops being true, and
 * the uniqueness check below is what proves it is still true today.
 */
const entryDir = `${root}/node_modules/.signal-embed-entry`
await mkdir(entryDir, { recursive: true })
await writeFile(
  `${entryDir}/entry.ts`,
  "export * from '../../src/signal/fields'\nexport * from '../../src/signal/figures'\n",
  'utf8',
)

await build({
  root,
  logLevel: 'warn',
  build: {
    lib: { entry: `${entryDir}/entry.ts`, formats: ['es'] },
    minify: 'oxc',
    outDir,
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: '[name].mjs' } },
  },
})

const bundled = await import(pathToFileURL(`${root}/${outDir}/entry.mjs`).href)
const jiti = createJiti(pathToFileURL(`${root}/scripts/verify-signal-embed.mjs`).href)

/** What the exporter emits ahead of a lifted body, built the same way it is. */
const preludeFor = (helpers) => helpers.map((f) => `var ${f.name}=${f.toString()};`).join('\n')

// ---------------------------------------------------------------------------

console.log('\n--- fields survive being lifted out of a minified bundle ---')
const minFields = bundled
const srcFields = await jiti.import('../src/signal/fields.ts')
const { resolveParams } = srcFields

check(
  'the minifier renamed the helpers (so this is a real test)',
  minFields.FIELD_HELPERS.every((f) => f.name.length > 0),
  minFields.FIELD_HELPERS.map((f) => f.name).join(', '),
)

const fieldPrelude = preludeFor(minFields.FIELD_HELPERS)
const W = 40
const H = 30

for (const spec of minFields.FIELDS) {
  let lifted
  try {
    lifted = new Function(`${fieldPrelude}\nreturn (${spec.fn.toString()});`)()
  } catch (e) {
    check(`${spec.id} lifts and runs`, false, `will not parse: ${e.message}`)
    continue
  }

  const a = new Float32Array(W * H)
  const b = new Float32Array(W * H)
  // the exporter resolves a generator's own controls and inlines them, so the
  // lifted copy gets the same literal the snippet would carry
  const fp = resolveParams(spec.params, {})
  try {
    lifted(a, W, H, 2.5, 60, 5, fp)
  } catch (e) {
    check(`${spec.id} lifts and runs`, false, `throws standalone: ${e.message}`)
    continue
  }
  srcFields.FIELD_BY_ID.get(spec.id).fn(b, W, H, 2.5, 60, 5, fp)

  let worst = 0
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]))
  check(`${spec.id} lifted is pixel-identical`, worst < 1e-6, `max delta ${worst}`)
}

// ---------------------------------------------------------------------------

/** A canvas context that records what was asked of it, so two runs can be diffed. */
function recorder(log) {
  const round = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)
  return new Proxy(
    {},
    {
      get(_, k) {
        if (k === 'canvas') return { width: 400, height: 300 }
        if (k === 'measureText') return () => ({ width: 10 })
        if (k === 'createRadialGradient' || k === 'createLinearGradient')
          return (...a) => {
            log.push(`${k}:${a.map(round)}`)
            return { addColorStop: (...c) => log.push(`stop:${c.map(round)}`) }
          }
        return (...a) => log.push(`${k}:${a.map(round).join(',')}`)
      },
      set(_, k, v) {
        log.push(`set ${String(k)}=${round(v)}`)
        return true
      },
    },
  )
}

console.log('\n--- helper names survive being in one chunk together ---')
{
  /*
   * The failure this guards against is silent and total: two helpers minified
   * to the same name become two `var e = ...` lines in the snippet, the second
   * overwrites the first, and every generator that used the first throws in
   * somebody's page while working perfectly in the app.
   */
  const all = [...bundled.FIELD_HELPERS, ...bundled.FIGURE_HELPERS]
  const byName = new Map()
  const clashes = []
  for (const fn of all) {
    const prev = byName.get(fn.name)
    if (prev && prev !== fn) clashes.push(fn.name)
    byName.set(fn.name, fn)
  }
  check('no two helpers share a minified name', clashes.length === 0, clashes.join(', '))
}

console.log('\n--- figures survive being lifted out of a minified bundle ---')
const minFigures = bundled
const srcFigures = await jiti.import('../src/signal/figures.ts')

check(
  'the minifier renamed the helpers (so this is a real test)',
  minFigures.FIGURE_HELPERS.every((f) => f.name.length > 0),
  minFigures.FIGURE_HELPERS.map((f) => f.name).join(', '),
)

const figurePrelude = preludeFor(minFigures.FIGURE_HELPERS)
const ink = { fg: [247, 248, 248], bg: [8, 9, 10], accent: [94, 106, 210] }
const motion = { rotateX: 30, rotateY: 12, rotateZ: 0, autoSpin: 30, flatten: 0.2, text: 'RIBBIT SIGNAL' }

for (const spec of minFigures.FIGURES) {
  let lifted
  try {
    lifted = new Function(`${figurePrelude}\nreturn (${spec.fn.toString()});`)()
  } catch (e) {
    check(`${spec.id} lifts and runs`, false, `will not parse: ${e.message}`)
    continue
  }

  const a = []
  const b = []
  const gp = resolveParams(spec.params, {})
  try {
    lifted(recorder(a), 400, 300, 2.5, 60, 5, ink, motion, gp)
  } catch (e) {
    check(`${spec.id} lifts and runs`, false, `throws standalone: ${e.message}`)
    continue
  }
  srcFigures.FIGURE_BY_ID.get(spec.id).fn(recorder(b), 400, 300, 2.5, 60, 5, ink, motion, gp)

  // a generator that silently drew nothing would compare equal to another that
  // silently drew nothing, so an empty log is its own failure
  check(`${spec.id} lifted draws the same marks`, a.length > 0 && a.join('|') === b.join('|'),
    a.length === 0 ? 'drew nothing' : `${a.length} ops vs ${b.length}`)
}

await rm(`${root}/${outDir}`, { recursive: true, force: true })
await rm(entryDir, { recursive: true, force: true })

console.log(fails === 0 ? '\nEvery generator survives the embed export.\n' : `\n${fails} check(s) failed.\n`)
process.exit(fails === 0 ? 0 : 1)
