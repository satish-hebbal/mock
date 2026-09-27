/**
 * Parameters, described once.
 *
 * The new styles, every layer and every Flow node carry a handful of settings
 * each, a hundred and more in all. Writing a slider by hand for each of them is
 * how a panel ends up with three spellings of "Strength" and two ranges for the
 * same angle. So a setting is a row of data here, and one component in
 * `AsciiParams.tsx` draws any list of them: the panel, the layer cards and the
 * node inspector all read the same description and cannot drift apart.
 *
 * Values live in flat records keyed by the param's own `key`. Absent keys fall
 * back to the default, which is what lets a document saved before a param
 * existed open without a migration.
 */

export type ParamValue = number | string | boolean

export type ParamFormat = 'pct' | 'px' | 'deg' | 'x' | 'int' | 'num'

interface ParamBase {
  key: string
  label: string
  /** one short line, shown on hover rather than printed in the panel */
  hint?: string
}

export interface RangeParam extends ParamBase {
  kind: 'range'
  min: number
  max: number
  step: number
  def: number
  fmt?: ParamFormat
}

export interface ColorParam extends ParamBase {
  kind: 'color'
  def: string
}

export interface ChoiceParam extends ParamBase {
  kind: 'choice'
  options: { id: string; label: string }[]
  def: string
}

export interface ToggleParam extends ParamBase {
  kind: 'toggle'
  def: boolean
}

export interface TextParam extends ParamBase {
  kind: 'text'
  def: string
}

export type ParamSpec = RangeParam | ColorParam | ChoiceParam | ToggleParam | TextParam

export type ParamBag = Record<string, ParamValue>

// ----- terse constructors, so a registry row stays one line per setting -----

export const range = (
  key: string,
  label: string,
  min: number,
  max: number,
  def: number,
  opts: { step?: number; fmt?: ParamFormat; hint?: string } = {},
): RangeParam => ({
  kind: 'range',
  key,
  label,
  min,
  max,
  def,
  step: opts.step ?? (max - min > 10 ? 1 : 0.01),
  fmt: opts.fmt,
  hint: opts.hint,
})

export const amount = (def = 0.6, label = 'Amount', key = 'amount'): RangeParam =>
  range(key, label, 0, 1, def, { fmt: 'pct' })

export const color = (key: string, label: string, def: string): ColorParam => ({
  kind: 'color',
  key,
  label,
  def,
})

export const choice = (
  key: string,
  label: string,
  options: { id: string; label: string }[],
  def?: string,
): ChoiceParam => ({ kind: 'choice', key, label, options, def: def ?? options[0].id })

export const toggle = (key: string, label: string, def = false): ToggleParam => ({
  kind: 'toggle',
  key,
  label,
  def,
})

/** Every param at its default, for a fresh layer or node. */
export function defaults(specs: ParamSpec[]): ParamBag {
  const out: ParamBag = {}
  for (const s of specs) out[s.key] = s.def
  return out
}

/**
 * Resolve a bag against its specs: defaults for anything missing, and every
 * number held inside its range. A preset written against an older range, or a
 * value pasted in from a shared recipe, cannot push a filter off the end of the
 * arithmetic it was written for.
 */
export function resolve(specs: ParamSpec[], bag: ParamBag | undefined): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {}
  for (const s of specs) {
    const v = bag?.[s.key]
    if (s.kind === 'range') {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : s.def
      out[s.key] = Math.min(s.max, Math.max(s.min, n))
    } else if (s.kind === 'toggle') {
      out[s.key] = typeof v === 'boolean' ? v : s.def
    } else if (s.kind === 'text') {
      out[s.key] = typeof v === 'string' ? v.slice(0, 400) : s.def
    } else if (s.kind === 'choice') {
      out[s.key] = typeof v === 'string' && s.options.some((o) => o.id === v) ? v : s.def
    } else {
      out[s.key] = typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : s.def
    }
  }
  return out
}

/** Typed readers over a resolved bag, so call sites do not cast. */
export const num = (p: Record<string, ParamValue>, k: string) => p[k] as number
export const str = (p: Record<string, ParamValue>, k: string) => p[k] as string
export const bool = (p: Record<string, ParamValue>, k: string) => p[k] as boolean

export function formatParam(fmt: ParamFormat | undefined, v: number, step: number): string {
  switch (fmt) {
    case 'pct':
      return `${Math.round(v * 100)}%`
    case 'px':
      return `${Math.round(v)}px`
    case 'deg':
      return `${Math.round(v)}°`
    case 'x':
      return `${v.toFixed(step >= 1 ? 0 : 1)}×`
    case 'int':
      return String(Math.round(v))
    default:
      return v.toFixed(step >= 1 ? 0 : 2)
  }
}
