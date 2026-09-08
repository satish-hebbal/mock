import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const R = (p) => jiti.import('../' + p)

const { KERNELS, bayer, blueNoise, ditherImage } = await R('src/ascii/dither.ts')
const { nearest, paletteRGB, hexToRgb } = await R('src/ascii/palettes.ts')
const { glyphFor, brailleFor } = await R('src/ascii/painters.ts')
const { hash2, toInk, luma } = await R('src/ascii/sample.ts')
const { rampChars, RAMPS } = await R('src/ascii/ramps.ts')

let fails = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else {
    console.log(`  FAIL ${name} ${detail}`)
    fails++
  }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

console.log('\n--- error diffusion kernels ---')
for (const [name, k] of Object.entries(KERNELS)) {
  const total = k.reduce((s, e) => s + e.w, 0)
  // Atkinson is the deliberate exception: it passes on six eighths and lets the
  // rest evaporate, which is exactly why its whites and blacks come out clean
  const want = name === 'atkinson' ? 0.75 : 1
  check(`${name} weights sum to ${want}`, near(total, want, 1e-9), `got ${total}`)
  const backwards = k.filter((e) => e.dy < 0 || (e.dy === 0 && e.dx <= 0))
  check(`${name} only pushes error forward`, backwards.length === 0)
}
check('atkinson taps', KERNELS.atkinson.length === 6)
check('floyd-steinberg 7/16 to the right', near(KERNELS['floyd-steinberg'][0].w, 7 / 16, 1e-9))

console.log('\n--- bayer matrices ---')
const b2 = bayer(2)
check('bayer2 is 4 entries', b2.length === 4)
// the canonical 2x2 is [[0,2],[3,1]] / 4, centred by +0.5
check('bayer2 values', near(b2[0], 0.125) && near(b2[1], 0.625) && near(b2[2], 0.875) && near(b2[3], 0.375),
  `got ${Array.from(b2).join(', ')}`)
for (const size of [2, 4, 8, 16]) {
  const m = bayer(size)
  const uniq = new Set(Array.from(m))
  check(`bayer${size} has ${size * size} distinct thresholds`, uniq.size === size * size, `got ${uniq.size}`)
  const min = Math.min(...m)
  const max = Math.max(...m)
  check(`bayer${size} spans 0..1`, min > 0 && max < 1 && near(min + max, 1, 1e-9), `${min}..${max}`)
}

console.log('\n--- blue noise ---')
const bn = blueNoise(64)
check('blue noise is 64x64', bn.length === 4096)
const bnSorted = Array.from(bn).sort((a, b) => a - b)
check('blue noise is uniform (rank-based)', near(bnSorted[0], 0.5 / 4096, 1e-6) && near(bnSorted[4095], 4095.5 / 4096, 1e-6))
check('blue noise is cached (same object)', blueNoise(64) === bn)
// a blue-noise mask should have far less low-frequency energy than white noise:
// compare the variance of 4x4 block means. lower means better spectral shaping.
const blockVar = (arr) => {
  const means = []
  for (let by = 0; by < 16; by++)
    for (let bx = 0; bx < 16; bx++) {
      let s = 0
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) s += arr[(by * 4 + y) * 64 + bx * 4 + x]
      means.push(s / 16)
    }
  const mu = means.reduce((a, b) => a + b, 0) / means.length
  return means.reduce((a, b) => a + (b - mu) ** 2, 0) / means.length
}
const white = new Float32Array(4096)
for (let i = 0; i < 4096; i++) white[i] = Math.random()
const bnV = blockVar(bn)
const wnV = blockVar(white)
check('blue noise has less low-frequency energy than white noise', bnV < wnV,
  `blue ${bnV.toFixed(5)} vs white ${wnV.toFixed(5)}`)

console.log('\n--- palettes ---')
check('hexToRgb', JSON.stringify(hexToRgb('#8bac0f')) === JSON.stringify([139, 172, 15]))
check('gameboy has 4 colours', paletteRGB('gameboy').length === 4)
check('pico8 has 16 colours', paletteRGB('pico8').length === 16)
for (const id of ['bw', 'gray4', 'gameboy', 'c64', 'pico8', 'cga', 'nes', 'amber', 'phosphor']) {
  const p = paletteRGB(id)
  const bad = p.filter((c) => c.some((v) => !Number.isFinite(v) || v < 0 || v > 255))
  check(`${id} parses to valid RGB`, bad.length === 0, JSON.stringify(bad))
}
const bw = paletteRGB('bw')
check('nearest picks white for a bright pixel', nearest(bw, 240, 240, 240)[0] === 255)
check('nearest picks black for a dark pixel', nearest(bw, 12, 12, 12)[0] === 0)

console.log('\n--- dither: tone preservation ---')
// a flat mid-grey dithered to 1-bit must average back to roughly mid-grey.
// this is the single property that separates working error diffusion from noise.
const mk = (w, h, fill) => {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const v = typeof fill === 'function' ? fill(i % w, Math.floor(i / w)) : fill
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
    d[i * 4 + 3] = 255
  }
  return { data: d, width: w, height: h }
}
const meanOf = (img) => {
  let s = 0
  for (let i = 0; i < img.data.length; i += 4) s += img.data[i]
  return s / (img.data.length / 4)
}
for (const algo of ['floyd-steinberg', 'atkinson', 'stucki', 'burkes', 'sierra-lite', 'bayer4', 'bayer8', 'blue-noise']) {
  for (const level of [64, 128, 192]) {
    const img = mk(96, 96, level)
    ditherImage(img, { algo, palette: bw, serpentine: true, amount: 1 })
    const only01 = Array.from(img.data).every((v, i) => i % 4 === 3 || v === 0 || v === 255)
    const m = meanOf(img)
    // atkinson deliberately discards a quarter of the error, so it clips: a
    // wider tolerance for it is correct behaviour, not a weaker test
    const tol = algo === 'atkinson' ? 46 : 12
    check(`${algo} @${level} outputs only palette colours`, only01)
    check(`${algo} @${level} preserves mean (${m.toFixed(1)})`, Math.abs(m - level) < tol, `off by ${(m - level).toFixed(1)}`)
  }
}

console.log('\n--- dither: gradient monotonicity ---')
{
  const w = 256
  const img = mk(w, 64, (x) => x)
  ditherImage(img, { algo: 'floyd-steinberg', palette: bw, serpentine: true, amount: 1 })
  // column-wise white coverage must rise across a left-to-right ramp
  const cov = []
  for (let x = 0; x < w; x += 16) {
    let on = 0
    for (let y = 0; y < 64; y++) if (img.data[(y * w + x) * 4] === 255) on++
    cov.push(on / 64)
  }
  let rising = true
  for (let i = 1; i < cov.length; i++) if (cov[i] < cov[i - 1] - 0.2) rising = false
  check('white coverage rises across a gradient', rising, cov.map((c) => c.toFixed(2)).join(' '))
  check('dark end is mostly black', cov[0] < 0.15, String(cov[0]))
  check('bright end is mostly white', cov[cov.length - 1] > 0.85, String(cov[cov.length - 1]))
}

console.log('\n--- dither: alpha survives ---')
{
  const img = mk(32, 32, 128)
  for (let i = 0; i < 32 * 32; i++) img.data[i * 4 + 3] = i % 2 ? 0 : 255
  ditherImage(img, { algo: 'floyd-steinberg', palette: bw, serpentine: true, amount: 1 })
  let ok = true
  for (let i = 0; i < 32 * 32; i++) if (img.data[i * 4 + 3] !== (i % 2 ? 0 : 255)) ok = false
  check('alpha channel is left untouched', ok)
}

console.log('\n--- ramps ---')
for (const r of RAMPS) check(`${r.id} starts with a space (lightest)`, r.chars[0] === ' ', JSON.stringify(r.chars[0]))
check('custom ramp falls back when emptied', rampChars('custom', '') === ' .:-=+*#%@')
check('custom ramp is used when given', rampChars('custom', ' .#') === ' .#')

console.log('\n--- glyph mapping ---')
{
  const chars = ' .:-=#'
  check('ink 0 gives the lightest', glyphFor(chars, 0, 0, 0, 0) === ' ')
  check('ink 1 gives the darkest', glyphFor(chars, 1, 0, 0, 0) === '#')
  let monotonic = true
  let prev = -1
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const idx = chars.indexOf(glyphFor(chars, Math.min(1, t), 0, 0, 0))
    if (idx < prev) monotonic = false
    prev = idx
  }
  check('ramp index is monotonic in ink', monotonic)
  // jitter must never walk off either end of the ramp
  let inRange = true
  for (let x = 0; x < 400; x++) {
    for (const ink of [0, 1]) {
      if (chars.indexOf(glyphFor(chars, ink, x, x * 3, 1)) < 0) inRange = false
    }
  }
  check('jitter never leaves the ramp', inRange)
}

console.log('\n--- determinism (preview must equal export) ---')
{
  const a = []
  const b = []
  for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) a.push(hash2(x, y, 3))
  for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) b.push(hash2(x, y, 3))
  check('hash2 is stable across calls', a.join() === b.join())
  const salted = a.filter((v, i) => v === hash2(Math.floor(i / 50), i % 50, 9)).length
  check('hash2 varies with salt', salted < a.length * 0.1, `${salted} collisions`)
  const uniq = new Set(a.map((v) => Math.floor(v * 20)))
  check('hash2 spreads across its range', uniq.size >= 18, `${uniq.size}/20 buckets`)
}

console.log('\n--- braille ---')
{
  const fine = { cols: 4, rows: 8, ink: new Float32Array(32) }
  check('all-empty cell is U+2800', brailleFor(0, 0, fine).charCodeAt(0) === 0x2800)
  fine.ink.fill(1)
  check('all-full cell is U+28FF', brailleFor(0, 0, fine).charCodeAt(0) === 0x28ff, brailleFor(0, 0, fine).charCodeAt(0).toString(16))
  fine.ink.fill(0)
  fine.ink[0] = 1 // top-left dot only -> dot 1 -> bit 0x01
  check('top-left dot sets bit 1', brailleFor(0, 0, fine).charCodeAt(0) === 0x2801, brailleFor(0, 0, fine).charCodeAt(0).toString(16))
  fine.ink.fill(0)
  fine.ink[3 * 4 + 1] = 1 // x=1, y=3 -> bit 0x80
  check('bottom-right dot sets bit 8', brailleFor(0, 0, fine).charCodeAt(0) === 0x2880, brailleFor(0, 0, fine).charCodeAt(0).toString(16))
  check('out-of-range cell is blank, not a crash', brailleFor(99, 99, fine).charCodeAt(0) === 0x2800)
}

console.log('\n--- tone mapping ---')
{
  const mkGrid = (lums) => ({
    cols: lums.length,
    rows: 1,
    rgb: new Uint8ClampedArray(lums.length * 3),
    lum: Float32Array.from(lums),
    edge: new Float32Array(lums.length),
    alpha: new Float32Array(lums.length).fill(1),
  })
  const neutral = { brightness: 0, contrast: 100, gamma: 1, coverage: 1, density: 0, edge: 0, invert: false }
  const g = mkGrid([0, 0.25, 0.5, 0.75, 1])

  let { ink, lum } = toInk(g, neutral)
  check('neutral tone: ink is 1 - luminance', near(ink[0], 1) && near(ink[4], 0) && near(ink[2], 0.5, 1e-6),
    Array.from(ink).join(', '))
  check('neutral tone: mapped luminance passes through', near(lum[0], 0) && near(lum[4], 1))

  ;({ ink } = toInk(g, { ...neutral, invert: true }))
  check('invert flips the ramp', near(ink[0], 0) && near(ink[4], 1))

  ;({ ink } = toInk(g, { ...neutral, coverage: 0.5 }))
  check('coverage scales the darkest cell', near(ink[0], 0.5), String(ink[0]))

  ;({ ink } = toInk(g, { ...neutral, density: 0.3 }))
  check('density blanks cells under the floor', ink[3] === 0 && ink[0] > 0,
    `${ink[3]} / ${ink[0]}`)

  ;({ ink } = toInk(g, { ...neutral, contrast: 200 }))
  check('contrast pushes away from mid', ink[1] > 0.9 && ink[3] < 0.1, `${ink[1]} ${ink[3]}`)
  check('contrast leaves mid grey alone', near(toInk(g, { ...neutral, contrast: 200 }).ink[2], 0.5, 1e-5))

  ;({ ink } = toInk(g, { ...neutral, gamma: 2 }))
  check('gamma lifts the midtones', ink[2] < 0.5 - 1e-3, String(ink[2]))

  const clear = mkGrid([0, 0, 0])
  clear.alpha.fill(0)
  check('transparent cells get no ink', Array.from(toInk(clear, neutral).ink).every((v) => v === 0))

  ;({ ink } = toInk({ ...g, edge: Float32Array.from([0, 0, 1, 0, 0]) }, { ...neutral, edge: 1 }))
  check('edge emphasis darkens an edge cell', near(ink[2], 1), String(ink[2]))
}

console.log('\n--- luminance ---')
check('luma of white is 1', near(luma(255, 255, 255), 1, 1e-6))
check('luma of black is 0', near(luma(0, 0, 0), 0))
check('green weighs most', luma(0, 255, 0) > luma(255, 0, 0) && luma(255, 0, 0) > luma(0, 0, 255))

console.log(fails === 0 ? '\nALL CHECKS PASSED\n' : `\n${fails} CHECK(S) FAILED\n`)
process.exit(fails === 0 ? 0 : 1)
