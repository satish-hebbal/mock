/**
 * Choosing a style.
 *
 * Fifty-some styles is too many for a row of named buttons and too few to
 * need a separate browser, so it is a grid of pictures of *your* photograph,
 * one family at a time. The families are six glyph chips across the top, not
 * six headings down the panel, which keeps the section one screen tall however
 * many styles a family holds. Search and favourites sit in the section's own
 * header, as icons, because most visits use neither.
 */

import { useMemo, useState } from 'react'
import { Search, Star, X } from 'lucide-react'
import { InfoTip, Section } from '../components/controls'
import { Tile, TileGrid } from '../signal/SignalTiles'
import { StyleArt } from './AsciiThumbs'
import { STYLES, STYLE_FAMILIES, getStyle, type StyleFamily } from './styles'
import { useAscii } from './store'
import type { AsciiStyleId } from './types'

type Filter = StyleFamily | 'favs'


/**
 * The grid itself: family chips (or a search field), then the tiles. Shared by
 * Studio's Style section and Flow's Style node, which is why the value comes
 * in and the pick goes out rather than both talking to the store.
 */
export function StyleGrid({
  value,
  onPick,
  searching,
  cols = 4,
}: {
  value: AsciiStyleId
  onPick: (id: AsciiStyleId) => void
  searching: boolean
  cols?: number
}) {
  const favs = useAscii((s) => s.favs)
  const current = getStyle(value)
  const [family, setFamily] = useState<Filter>(current.family)
  const [query, setQuery] = useState('')

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (searching && q) return STYLES.filter((s) => `${s.label} ${s.hint} ${s.family}`.toLowerCase().includes(q))
    if (family === 'favs') return STYLES.filter((s) => favs.includes(s.id))
    return STYLES.filter((s) => s.family === family)
  }, [family, query, favs, searching])

  return (
    <>
      {searching ? (
        <div className="mb-2 flex h-7 items-center gap-1.5 rounded-sm bg-(--field) px-2 focus-within:ring-2 focus-within:ring-(--focus)">
          <Search size={12} strokeWidth={2} className="shrink-0 text-(--tx3)" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Halftone, glass, knit…"
            className="min-w-0 flex-1 bg-transparent t-body-sm text-(--tx) outline-none placeholder:text-(--tx3)"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear" className="text-(--tx3) hover:text-(--tx)">
              <X size={12} strokeWidth={2} />
            </button>
          )}
        </div>
      ) : (
        <div className="mb-2 grid grid-cols-7 gap-0.5 rounded-sm bg-(--field) p-0.5">
          {STYLE_FAMILIES.map((f) => {
            const on = family === f.id
            const has = f.id === current.family
            return (
              <button
                key={f.id}
                onClick={() => setFamily(f.id)}
                title={f.label}
                aria-label={f.label}
                aria-pressed={on}
                className={`relative flex h-7 items-center justify-center rounded-xs transition-colors ${
                  on ? 'bg-(--sel) text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'
                }`}
              >
                <f.icon size={14} strokeWidth={1.8} />
                {/* a dot under the family the current style lives in, so you can
                    find your way back after browsing another */}
                {has && !on && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-(--tx2)" />}
              </button>
            )
          })}
          <button
            onClick={() => setFamily('favs')}
            title="Favourites"
            aria-label="Favourites"
            aria-pressed={family === 'favs'}
            className={`flex h-7 items-center justify-center rounded-xs transition-colors ${
              family === 'favs' ? 'bg-(--sel) text-(--tx)' : 'text-(--tx2) hover:text-(--tx)'
            }`}
          >
            <Star size={14} strokeWidth={1.8} />
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <p className="flex items-center gap-1.5 py-3 t-caption text-(--tx3)">
          {family === 'favs' && !query ? (
            <>
              <Star size={12} strokeWidth={2} /> Star a style to keep it here.
            </>
          ) : (
            'Nothing by that name.'
          )}
        </p>
      ) : (
        <TileGrid cols={cols}>
          {list.map((s, i) => (
            <Tile
              key={s.id}
              index={i}
              cols={cols}
              label={s.label}
              hint={s.hint}
              on={value === s.id}
              onPick={() => onPick(s.id)}
              art={<StyleArt id={s.id} />}
              mark={favs.includes(s.id) ? <Star size={8} strokeWidth={2.4} fill="currentColor" /> : undefined}
            />
          ))}
        </TileGrid>
      )}
    </>
  )
}

export function StylePicker() {
  const style = useAscii((s) => s.doc.style)
  const favs = useAscii((s) => s.favs)
  const current = getStyle(style)
  const [searching, setSearching] = useState(false)
  const isFav = favs.includes(style)
  const headerBtn = 'flex h-6 w-6 items-center justify-center rounded-xs transition-colors'

  return (
    <Section
      title="Style"
      icon={<current.icon size={15} strokeWidth={1.75} />}
      badge={current.label}
      defaultOpen
      actions={
        <>
          <button
            onClick={() => useAscii.getState().toggleFav(style)}
            title={isFav ? 'Remove from favourites' : 'Add this style to favourites'}
            aria-pressed={isFav}
            className={`${headerBtn} ${isFav ? 'text-(--tx)' : 'text-(--tx3) hover:text-(--tx)'}`}
          >
            <Star size={13} strokeWidth={1.9} fill={isFav ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={() => setSearching(!searching)}
            title="Find a style"
            aria-pressed={searching}
            className={`${headerBtn} ${searching ? 'bg-(--sel) text-(--tx)' : 'text-(--tx3) hover:text-(--tx)'}`}
          >
            <Search size={13} strokeWidth={1.9} />
          </button>
          <InfoTip>{current.hint}</InfoTip>
        </>
      }
    >
      <StyleGrid value={style} searching={searching} onPick={(id) => useAscii.getState().setStyle(id)} />
    </Section>
  )
}
