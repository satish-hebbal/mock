/**
 * Any list of params, drawn as controls.
 *
 * One component for the style settings, the layer cards and the Flow node
 * inspector, so all three look alike and a param added to a registry row shows
 * up everywhere it is used without anybody writing a slider for it.
 *
 * Layout is by kind rather than by order: ranges and colours stack as rows,
 * short choices become a segmented row, and on/off settings gather into one
 * line of chips at the end, because a toggle on a row of its own is a whole
 * row spent on one bit.
 */

import { Check } from 'lucide-react'
import { ColorRow, Dropdown, MiniButton, Segments, SliderRow } from '../components/controls'
import { formatParam, resolve, type ParamBag, type ParamSpec, type ParamValue } from './params'

export function ParamControls({
  specs,
  values,
  onChange,
  prefix,
}: {
  specs: ParamSpec[]
  values: ParamBag | undefined
  onChange: (key: string, v: ParamValue, label: string) => void
  /** makes undo labels unique per owner, so two layers' sliders never coalesce */
  prefix: string
}) {
  const v = resolve(specs, values)
  const toggles = specs.filter((s) => s.kind === 'toggle')

  return (
    <div>
      {specs.map((s) => {
        const label = `${prefix}-${s.key}`
        switch (s.kind) {
          case 'range':
            return (
              <SliderRow
                key={s.key}
                label={s.label}
                hint={s.hint}
                value={v[s.key] as number}
                min={s.min}
                max={s.max}
                step={s.step}
                format={(x) => formatParam(s.fmt, x, s.step)}
                onChange={(x) => onChange(s.key, x, label)}
              />
            )
          case 'color':
            return (
              <ColorRow
                key={s.key}
                label={s.label}
                value={v[s.key] as string}
                onChange={(x) => onChange(s.key, x, label)}
              />
            )
          case 'choice':
            return s.options.length <= 3 ? (
              <Segments
                key={s.key}
                compact
                options={s.options}
                value={v[s.key] as string}
                onChange={(x) => onChange(s.key, x, '')}
              />
            ) : (
              <div key={s.key} className="my-0.5 flex items-center gap-2">
                <span className="w-16 shrink-0 truncate t-caption text-(--tx3)">{s.label}</span>
                <Dropdown
                  className="min-w-0 flex-1"
                  value={v[s.key] as string}
                  options={s.options.map((o) => ({ value: o.id, label: o.label }))}
                  onChange={(x) => onChange(s.key, x, '')}
                />
              </div>
            )
          case 'text':
            return (
              <input
                key={s.key}
                value={v[s.key] as string}
                aria-label={s.label}
                placeholder={s.label}
                spellCheck={false}
                onChange={(e) => onChange(s.key, e.target.value, label)}
                className="my-0.5 h-7 w-full rounded-sm bg-(--field) px-2 t-mono text-(--tx) outline-none focus:ring-2 focus:ring-(--focus)"
              />
            )
          default:
            return null
        }
      })}
      {toggles.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {toggles.map((s) => {
            const on = v[s.key] as boolean
            return (
              <MiniButton key={s.key} active={on} title={s.hint ?? s.label} onClick={() => onChange(s.key, !on, '')}>
                {on && <Check size={12} strokeWidth={2.2} />}
                {s.label}
              </MiniButton>
            )
          })}
        </div>
      )}
    </div>
  )
}
