/**
 * Exercises the SVG surface directly: no DOM, no canvas, just the writer.
 * Checks the markup is well formed and that the geometry lands where the
 * painters asked for it.
 */
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const { SvgSurface } = await jiti.import('../src/ascii/surface.ts')
const { PAINTERS } = await jiti.import('../src/ascii/painters.ts')

let fails = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else {
    console.log(`  FAIL ${name} ${detail}`)
    fails++
  }
}

/* A very small XML well-formedness check: tags must nest and close. */
function wellFormed(xml) {
  const stack = []
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m
  let consumed = 0
  while ((m = re.exec(xml))) {
    consumed = re.lastIndex
    const [, closing, name, , selfClose] = m
    if (selfClose) continue
    if (closing) {
      if (stack.pop() !== name) return `mismatched </${name}>`
    } else stack.push(name)
  }
  if (consumed !== xml.length) return 'trailing content outside any tag'
  return stack.length ? `unclosed <${stack[stack.length - 1]}>` : ''
}

const cell = (over) => ({
  s: null,
  x: 0,
  y: 0,
  w: 10,
  h: 18,
  col: 0,
  row: 0,
  ink: 0.6,
  color: 'rgb(255, 0, 0)',
  r: 255,
  g: 0,
  b: 0,
  ...over,
})
const env = { chars: ' .:-=#', jitter: 0, gap: 0, fine: undefined }

console.log('\n--- every painter emits well-formed markup ---')
for (const [id, painter] of Object.entries(PAINTERS)) {
  const s = new SvgSurface(10)
  s.font(16)
  const fine = { cols: 4, rows: 8, ink: new Float32Array(32).fill(1) }
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const c = cell({ x: col * 10, y: row * 18, col, row, ink: 0.2 + col * 0.2 })
      c.s = s
      painter(c, { ...env, fine })
    }
  }
  const body = s.body()
  const err = wellFormed(`<svg>${body}</svg>`)
  check(`${id} well formed`, err === '', err)
  check(`${id} drew something`, body.length > 0)
  check(`${id} has no NaN`, !/NaN|undefined/.test(body), body.slice(0, 120))
}

console.log('\n--- text runs coalesce ---')
{
  const s = new SvgSurface(10)
  s.font(16)
  // one row of five contiguous cells, same colour
  for (let col = 0; col < 5; col++) s.text(col * 10 + 5, 9, 'X', 'rgb(1, 2, 3)')
  const body = s.body()
  const texts = body.match(/<text/g) ?? []
  check('five same-colour cells become one <text>', texts.length === 1, `got ${texts.length}`)
  check('the run carries all five characters', /XXXXX/.test(body), body)
  check('textLength spans five cells', /textLength="50"/.test(body), body)
  check('run starts at the first cell edge, not its centre', /x="0"/.test(body), body)
}

console.log('\n--- runs break where they should ---')
{
  const s = new SvgSurface(10)
  s.font(16)
  s.text(5, 9, 'A', 'rgb(1, 1, 1)')
  s.text(15, 9, 'B', 'rgb(2, 2, 2)') // colour changes
  check('a colour change ends the run', (s.body().match(/<text/g) ?? []).length === 2)
}
{
  const s = new SvgSurface(10)
  s.font(16)
  s.text(5, 9, 'A', 'rgb(1, 1, 1)')
  s.text(35, 9, 'B', 'rgb(1, 1, 1)') // a gap: cells were skipped
  check('a skipped cell ends the run', (s.body().match(/<text/g) ?? []).length === 2)
}
{
  const s = new SvgSurface(10)
  s.font(16)
  s.text(5, 9, 'A', 'rgb(1, 1, 1)')
  s.text(5, 27, 'B', 'rgb(1, 1, 1)') // next row
  check('a new row ends the run', (s.body().match(/<text/g) ?? []).length === 2)
}
{
  const s = new SvgSurface(10)
  s.font(16)
  s.text(5, 9, 'A', 'rgb(1, 1, 1)')
  s.rect(0, 0, 5, 5, 'rgb(9, 9, 9)')
  s.text(15, 9, 'B', 'rgb(1, 1, 1)')
  const body = s.body()
  check('a shape between glyphs ends the run', (body.match(/<text/g) ?? []).length === 2)
  check('paint order is preserved', body.indexOf('<rect') > body.indexOf('A'), body)
}

console.log('\n--- xml escaping ---')
{
  const s = new SvgSurface(10)
  s.font(16)
  for (const ch of ['<', '>', '&']) s.text(5, 9, ch, 'rgb(0, 0, 0)')
  const body = s.body()
  check('markup characters are escaped', !/>[<>&]+</.test(body.replace(/&lt;|&gt;|&amp;/g, '')), body)
  check('escapes are present', /&lt;|&gt;|&amp;/.test(body), body)
  check('still well formed', wellFormed(`<svg>${body}</svg>`) === '', wellFormed(`<svg>${body}</svg>`))
}

console.log('\n--- geometry ---')
{
  const s = new SvgSurface(10)
  s.circle(12.3456, 7.1, 3, 'rgb(0, 0, 0)')
  check('coordinates are rounded, not dumped at full precision', /cx="12.35"/.test(s.body()), s.body())
}
{
  const s = new SvgSurface(10)
  s.polygon(
    [
      [0, 0],
      [10, 0],
      [5, 8],
    ],
    'rgb(0, 0, 0)',
  )
  check('polygon points are a valid list', /points="0,0 10,0 5,8"/.test(s.body()), s.body())
}
{
  const s = new SvgSurface(10)
  s.polygon([[0, 0]], 'rgb(0, 0, 0)')
  check('a degenerate polygon is dropped rather than emitted', s.body() === '', s.body())
}
{
  const s = new SvgSurface(10)
  // a half turn: the large-arc flag must stay 0 at exactly PI, and the sweep
  // must match the canvas drawing direction
  s.arc(10, 10, 5, 0, Math.PI, 1, 'rgb(0, 0, 0)')
  const body = s.body()
  check('arc emits a path with a sweep flag of 1', /A5 5 0 0 1/.test(body), body)
  check('arc starts at the from-angle', /M15 10/.test(body), body)
}
{
  const s = new SvgSurface(10)
  s.arc(10, 10, 5, 0, Math.PI * 1.5, 1, 'rgb(0, 0, 0)')
  check('an arc past a half turn sets the large flag', /A5 5 0 1 1/.test(s.body()), s.body())
}

console.log(fails === 0 ? '\nALL CHECKS PASSED\n' : `\n${fails} CHECK(S) FAILED\n`)
process.exit(fails === 0 ? 0 : 1)
