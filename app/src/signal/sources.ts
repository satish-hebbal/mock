/**
 * The two generator families, behind one counter.
 *
 * Fields and figures have genuinely different signatures and cannot share an
 * implementation, but everything *about* them is the same shape: an id, a
 * label, a group, a hint, and a declaration of which controls they read. The
 * panel, the store and the export dialog all want that description and none of
 * them want to care which family it came from, so this is the one place that
 * knows both lists exist.
 */

import { FIELDS, FIELD_GROUPS, resolveParams, type ParamSpec, type Params, type SourceParam } from './fields'
import { FIGURES, FIGURE_GROUPS } from './figures'
import type { SourceKind } from './types'

export type { SourceParam, ParamSpec, Params }

export interface SourceInfo {
  kind: SourceKind
  id: string
  label: string
  group: string
  hint: string
  uses: SourceParam[]
  /** the generator's own controls, which the panel draws under the shared ones */
  params?: ParamSpec[]
}

const FIELD_INFO: SourceInfo[] = FIELDS.map((f) => ({ kind: 'field' as const, ...f }))
const FIGURE_INFO: SourceInfo[] = FIGURES.map((f) => ({ kind: 'figure' as const, ...f }))

export const SOURCES: SourceInfo[] = [...FIELD_INFO, ...FIGURE_INFO]

/** The generators of one family, which is what a panel page lists. */
export function sourcesOf(kind: SourceKind): SourceInfo[] {
  return kind === 'figure' ? FIGURE_INFO : FIELD_INFO
}

export function groupsOf(kind: SourceKind): readonly string[] {
  return kind === 'figure' ? FIGURE_GROUPS : FIELD_GROUPS
}

export function findSource(kind: SourceKind, id: string): SourceInfo | undefined {
  return sourcesOf(kind).find((s) => s.id === id)
}

/**
 * Does the generator on this document read a given control?
 *
 * The panel calls this instead of consulting a list of effect names, which is
 * the whole reason `uses` exists: an effect and the controls shown for it
 * cannot drift apart if the effect is the thing being asked.
 */
export function sourceUses(kind: SourceKind, id: string, param: SourceParam): boolean {
  return findSource(kind, id)?.uses.includes(param) ?? false
}

/** The first generator of a family, used when switching families. */
export function firstOf(kind: SourceKind): string {
  return sourcesOf(kind)[0].id
}

/**
 * The complete control values for whatever the document currently points at.
 *
 * The panel needs this as much as the renderer does: a slider has to be drawn
 * at the generator's default before anybody has moved it, and the document
 * deliberately does not store defaults.
 */
export function paramsFor(kind: SourceKind, id: string, stored: Params): Params {
  return resolveParams(findSource(kind, id)?.params, stored)
}
