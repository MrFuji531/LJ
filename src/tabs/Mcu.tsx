import { useEffect, useMemo, useRef, useState } from 'react'
import './Mcu.css'

import { MCU_FILMS, MCU_BY_SLUG, PHASES, CHARACTER_KINDS, DOOMSDAY, type CharacterKind, type McuEntry } from '../data/mcu'
import { useCollection } from '../lib/collection'
import { logEvent, unlogEvent } from '../lib/events'
import { makeThumb, normalizePhoto, uploadMedia, removeMedia } from '../lib/media'
import type { Profile } from '../lib/session'
import * as tmdb from '../lib/tmdb'
import { Icon } from '../components/Icon'
import { EmptyState, Field, Sheet, useConfirm, useToast, SectionTitle } from '../components/ui'

/* ==========================================================================
   The MCU rewatch.

   The films and series are a straight checklist — tap to tick. The boards
   are Lee's rankings of the heroes, villains and love interests: hand-placed,
   reorderable, and exportable as a picture when the verdict is in.
   ========================================================================== */

type FilmRow = {
  slug: string
  watched: boolean
  watched_on: string | null
  poster_path: string | null
  /** Our joint placement of watched entries — 1 is best. */
  rank: number | null
  /** True for things we only YouTube-summarised and won't rank. */
  rank_excluded: boolean | null
  score_james: number | null
  score_lee: number | null
  notes_james: string | null
  notes_lee: string | null
  updated_at?: string
}

type CharRow = {
  id: string
  name: string
  kind: CharacterKind
  actor: string | null
  image_url: string | null
  /** Uploaded portrait: original in storage + tiny data-URL for lists. */
  image_path: string | null
  image_thumb: string | null
  film_slug: string | null
  /** Lee's placement — 1 is best. */
  rank: number | null
  score_james: number | null
  score_lee: number | null
  notes_james: string | null
  notes_lee: string | null
  added_by: string | null
  created_at?: string
  updated_at?: string
}

const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

/** Two initials from a name — the placeholder until there's a real picture. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

const byRank = (a: CharRow, b: CharRow) => {
  if (a.rank != null && b.rank != null) return a.rank - b.rank
  if (a.rank != null) return -1
  if (b.rank != null) return 1
  return a.name.localeCompare(b.name)
}

/* ========================================================================== */

type View = 'films' | 'ranked' | CharacterKind

export function McuTab({ me }: { me: Profile }) {
  const films = useCollection<FilmRow>('lj_mcu_films', 'slug')
  const chars = useCollection<CharRow>('lj_mcu_chars')
  const toast = useToast()
  const confirm = useConfirm()

  const [view, setView] = useState<View>('films')
  const [openChar, setOpenChar] = useState<CharRow | null>(null)
  const [newCharKind, setNewCharKind] = useState<CharacterKind | null>(null)
  const [fetching, setFetching] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const filmBySlug = useMemo(
    () => new Map(films.rows.map((r) => [r.slug, r])),
    [films.rows],
  )

  const watchedCount = MCU_FILMS.filter((f) => filmBySlug.get(f.slug)?.watched).length
  const pct = Math.round((watchedCount / MCU_FILMS.length) * 100)
  const nextUp = MCU_FILMS.find((f) => !filmBySlug.get(f.slug)?.watched)

  const toggle = async (slug: string) => {
    const row = filmBySlug.get(slug)
    const watched = !(row?.watched ?? false)
    const entry =
      MCU_BY_SLUG.get(slug) ??
      (slug === DOOMSDAY.slug ? { title: DOOMSDAY.title, kind: DOOMSDAY.kind } : undefined)
    await films.upsert({
      slug,
      watched,
      watched_on: watched ? new Date().toISOString().slice(0, 10) : null,
      // Untick pulls it back out of the rankings too.
      ...(watched ? {} : { rank: null, rank_excluded: false }),
    })
    if (watched) {
      logEvent({
        room: 'mcu', kind: 'watched', refId: slug,
        label: entry?.title ?? slug, meta: { kind: entry?.kind }, by: me.slug,
      })
    } else {
      unlogEvent('mcu', 'watched', slug)
    }
  }

  const scrollToNext = () => {
    if (!nextUp) return
    listRef.current
      ?.querySelector(`[data-slug="${nextUp.slug}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  /** Fill in posters for everything, once, if a TMDb key is present. */
  const fetchPosters = async () => {
    if (!tmdb.hasTmdb()) {
      toast('Add a TMDb key in Settings first', 'bad')
      return
    }
    setFetching(true)
    let got = 0
    for (const f of MCU_FILMS) {
      if (filmBySlug.get(f.slug)?.poster_path) continue
      try {
        // "Loki — Season 2" searches as "Loki"; the show poster is the poster.
        const q = f.title.replace(/\s+—\s+Season\s+\d+$/u, '')
        const hits = await tmdb.search(q, f.kind === 'show' ? 'tv' : 'movie')
        const hit = hits.find((h) => h.year === f.year) ?? hits[0]
        if (hit?.poster_path) {
          await films.upsert({ slug: f.slug, poster_path: hit.poster_path })
          got++
        }
      } catch {
        /* keep going; a missing poster is cosmetic */
      }
    }
    setFetching(false)
    toast(got ? `${got} posters added` : 'Nothing new to fetch', got ? 'good' : 'default')
  }

  /* --- character boards -------------------------------------------------- */

  const rankedOf = (kind: CharacterKind) =>
    chars.rows.filter((c) => c.kind === kind).sort(byRank)

  const placeChar = async (char: Partial<CharRow> & { kind: CharacterKind }, slot: number) => {
    const existing = char.id ? chars.rows.find((c) => c.id === char.id) : null
    const list = rankedOf(char.kind).filter((c) => c.id !== char.id)
    const row: CharRow = {
      id: char.id ?? existing?.id ?? uid(),
      name: char.name ?? existing?.name ?? '?',
      kind: char.kind,
      actor: char.actor ?? existing?.actor ?? null,
      image_url: char.image_url ?? existing?.image_url ?? null,
      image_path: char.image_path ?? existing?.image_path ?? null,
      image_thumb: char.image_thumb ?? existing?.image_thumb ?? null,
      film_slug: existing?.film_slug ?? null,
      rank: 0,
      score_james: existing?.score_james ?? null,
      score_lee: existing?.score_lee ?? null,
      notes_james: existing?.notes_james ?? null,
      notes_lee: existing?.notes_lee ?? null,
      added_by: existing?.added_by ?? me.slug,
      created_at: existing?.created_at ?? new Date().toISOString(),
    }
    list.splice(slot, 0, row)
    await Promise.all(list.map((c, i) => chars.upsert({ ...c, rank: i + 1 })))
  }

  const reorderChar = async (kind: CharacterKind, from: number, to: number) => {
    const list = rankedOf(kind)
    if (to < 0 || to >= list.length) return
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    await Promise.all(next.map((c, i) => chars.upsert({ ...c, rank: i + 1 })))
  }

  return (
    <>
      <div className="mcu-progress card">
        <div className="spread">
          <div>
            <span className="eyebrow">The rewatch</span>
            <div className="mcu-progress-count display">
              {watchedCount} <span className="mcu-of">of {MCU_FILMS.length}</span>
            </div>
          </div>
          <div className="mcu-progress-pct display">{pct}%</div>
        </div>
        <div className="mcu-bar">
          <div className="mcu-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        {nextUp && (
          <button className="mcu-next" onClick={scrollToNext} data-pressable>
            <span className="eyebrow">Up next</span>
            <span className="mcu-next-title">{nextUp.title}</span>
            <Icon name="chevron" size={14} />
          </button>
        )}
      </div>

      <div className="seg seg-scroll">
        {(
          [
            ['films', 'The list'],
            ['ranked', 'Ranked'],
            ['hero', 'Heroes'],
            ['villain', 'Villains'],
            ['love', 'Loves'],
          ] as [View, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={`seg-btn ${view === id ? 'is-on' : ''}`}
            onClick={() => setView(id)}
            data-pressable
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'ranked' && (
        <FilmRankBoard
          filmBySlug={filmBySlug}
          onPlace={async (slug, slot) => {
            const ranked = MCU_FILMS
              .map((f) => ({ f, r: filmBySlug.get(f.slug) }))
              .filter((x) => x.r?.watched && x.r.rank != null && x.f.slug !== slug)
              .sort((a, b) => a.r!.rank! - b.r!.rank!)
              .map((x) => x.f.slug)
            ranked.splice(slot, 0, slug)
            await Promise.all(
              ranked.map((s, i) => films.upsert({ slug: s, rank: i + 1, rank_excluded: false })),
            )
            toast(`${MCU_BY_SLUG.get(slug)?.title} — #${slot + 1}`, 'good')
          }}
          onReorder={async (ordered, from, to) => {
            if (to < 0 || to >= ordered.length) return
            const next = [...ordered]
            const [moved] = next.splice(from, 1)
            next.splice(to, 0, moved)
            await Promise.all(next.map((s, i) => films.upsert({ slug: s, rank: i + 1 })))
          }}
          onExclude={(slug) => films.upsert({ slug, rank: null, rank_excluded: true })}
          onRestore={(slug) => films.upsert({ slug, rank_excluded: false })}
          onDrop={(slug) => films.upsert({ slug, rank: null, rank_excluded: false })}
        />
      )}

      {view === 'films' ? (
        <div className="stack" ref={listRef}>
          {PHASES.map((phase) => (
            <div key={phase} className="stack mcu-phase">
              <div className="mcu-phase-head">
                <span className="eyebrow">Phase {phase}</span>
                <span className="mcu-phase-line" />
              </div>
              {MCU_FILMS.filter((f) => f.phase === phase).map((f) => {
                const row = filmBySlug.get(f.slug)
                const poster = tmdb.IMG(row?.poster_path, 'w185')
                const watched = row?.watched ?? false
                return (
                  <button
                    key={f.slug}
                    data-slug={f.slug}
                    className={`mcu-film card ${watched ? 'is-watched' : ''}`}
                    onClick={() => toggle(f.slug)}
                    data-pressable
                    data-press-scale="subtle"
                  >
                    <span className="mcu-order num">{f.order}</span>
                    <div className="poster mcu-poster">
                      {poster ? <img src={poster} alt="" loading="lazy" /> : <span className="poster-fallback">M</span>}
                    </div>
                    <div className="grow mcu-film-body">
                      <div className="mcu-film-title">{f.title}</div>
                      <div className="mcu-film-meta">
                        <span className="num">{f.year}</span>
                        {f.kind === 'show' && <span className="chip mcu-chip-show">Series</span>}
                      </div>
                    </div>
                    <span className={`mcu-tick ${watched ? 'is-on' : ''}`}>
                      {watched && <Icon name="check" size={14} strokeWidth={2.6} />}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}

          <button
            className="btn btn-quiet btn-block btn-sm"
            onClick={fetchPosters}
            disabled={fetching}
            data-pressable
          >
            <Icon name="cloud" size={14} />
            {fetching ? 'Fetching posters…' : 'Fetch posters from TMDb'}
          </button>

          <FinaleCard
            watched={filmBySlug.get(DOOMSDAY.slug)?.watched ?? false}
            onToggle={() => toggle(DOOMSDAY.slug)}
          />
        </div>
      ) : view !== 'ranked' ? (
        <RankBoard
          kind={view}
          rows={rankedOf(view)}
          allChars={chars.rows}
          onOpen={setOpenChar}
          onAdd={() => setNewCharKind(view)}
          onReorder={(from, to) => reorderChar(view, from, to)}
        />
      ) : null}

      {(openChar || newCharKind) && (
        <CharacterSheet
          row={openChar}
          kind={openChar?.kind ?? newCharKind!}
          ranked={rankedOf(openChar?.kind ?? newCharKind!)}
          onClose={() => {
            setOpenChar(null)
            setNewCharKind(null)
          }}
          onPlace={async (draft, slot) => {
            await placeChar(draft, slot)
            setOpenChar(null)
            setNewCharKind(null)
            toast(`${draft.name} — #${slot + 1}`, 'good')
          }}
          onSaveDetails={async (patch) => {
            if (!openChar) return
            await chars.upsert({ ...patch, id: openChar.id })
            setOpenChar(null)
            toast('Saved', 'good')
          }}
          onDelete={
            openChar
              ? async () => {
                  const ok = await confirm({
                    title: `Delete ${openChar.name}?`,
                    confirmLabel: 'Delete',
                    danger: true,
                  })
                  if (!ok) return
                  await chars.remove(openChar.id)
                  setOpenChar(null)
                }
              : undefined
          }
        />
      )}
    </>
  )
}

/* ==========================================================================
   Boards
   ========================================================================== */

function Avatar({ row, size = 44 }: { row: CharRow; size?: number }) {
  const [broken, setBroken] = useState(false)
  const kind = CHARACTER_KINDS.find((k) => k.key === row.kind)!
  // Uploaded thumb first (instant, offline), then any legacy pasted link.
  const src = row.image_thumb || row.image_url
  const show = src && !broken

  return (
    <span
      className="avatar"
      style={{ width: size, height: size, ['--who' as string]: kind.color }}
    >
      {show ? (
        <img src={src!} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className="avatar-initials display" style={{ fontSize: size * 0.36 }}>
          {initials(row.name)}
        </span>
      )}
    </span>
  )
}

function RankBoard({
  kind,
  rows,
  allChars,
  onOpen,
  onAdd,
  onReorder,
}: {
  kind: CharacterKind
  rows: CharRow[]
  allChars: CharRow[]
  onOpen: (c: CharRow) => void
  onAdd: () => void
  onReorder: (from: number, to: number) => void
}) {
  const meta = CHARACTER_KINDS.find((k) => k.key === kind)!
  const toast = useToast()
  const [exporting, setExporting] = useState(false)

  if (!rows.length) {
    return (
      <EmptyState
        icon={kind === 'hero' ? '🛡' : kind === 'villain' ? '😈' : '💘'}
        title={`No ${meta.plural.toLowerCase()} yet`}
        hint="Lee's list, but either of you can type it in. Add one and place it."
        action={
          <button className="btn btn-accent" onClick={onAdd} data-pressable>
            Add a {meta.label.toLowerCase()}
          </button>
        }
      />
    )
  }

  return (
    <div className="stack">
      <SectionTitle right={<span className="eyebrow">Lee's ranking</span>}>
        {meta.plural}
      </SectionTitle>

      {rows.map((c, i) => {
        const film = c.film_slug ? MCU_BY_SLUG.get(c.film_slug) : null
        return (
          <div key={c.id} className="mcu-char card">
            <span className={`mcu-char-rank display ${i < 3 ? `is-${i + 1}` : ''}`}>{i + 1}</span>
            <button className="mcu-char-main" onClick={() => onOpen(c)} data-pressable data-press-scale="subtle">
              <Avatar row={c} />
              <div className="grow mcu-char-body">
                <div className="mcu-char-name">{c.name}</div>
                <div className="mcu-char-meta truncate">
                  {c.actor && <span>{c.actor}</span>}
                  {c.actor && film && <span className="mcu-dot">·</span>}
                  {film && <span>{film.title}</span>}
                </div>
              </div>
            </button>
            <div className="rank-tools">
              <button className="icon-btn" disabled={i === 0} onClick={() => onReorder(i, i - 1)} aria-label="Up" data-pressable>
                <Icon name="chevron" size={14} className="rot-up" />
              </button>
              <button className="icon-btn" disabled={i === rows.length - 1} onClick={() => onReorder(i, i + 1)} aria-label="Down" data-pressable>
                <Icon name="chevron" size={14} className="rot-down" />
              </button>
            </div>
          </div>
        )
      })}

      <button className="btn btn-outline btn-block" onClick={onAdd} data-pressable>
        <Icon name="plus" size={16} /> Add a {meta.label.toLowerCase()}
      </button>

      <button
        className="btn btn-quiet btn-block btn-sm"
        disabled={exporting}
        onClick={async () => {
          setExporting(true)
          try {
            await exportRankings(allChars)
          } catch {
            toast("Couldn't build the image", 'bad')
          } finally {
            setExporting(false)
          }
        }}
        data-pressable
      >
        <Icon name="star" size={14} />
        {exporting ? 'Building…' : "Export Lee's rankings as an image"}
      </button>
    </div>
  )
}

/** The endcap: where all of it has been heading. */
function FinaleCard({ watched, onToggle }: { watched: boolean; onToggle: () => void }) {
  return (
    <button
      className={`mcu-finale card ${watched ? 'is-watched' : ''}`}
      onClick={onToggle}
      data-pressable
      data-press-scale="subtle"
    >
      <span className="eyebrow mcu-finale-eyebrow">The final stage</span>
      <span className="mcu-finale-title display">{DOOMSDAY.title}</span>
      <span className="mcu-finale-sub">{DOOMSDAY.release} — it all ends here</span>
      <span className={`mcu-tick mcu-finale-tick ${watched ? 'is-on' : ''}`}>
        {watched && <Icon name="check" size={14} strokeWidth={2.6} />}
      </span>
    </button>
  )
}

/* ==========================================================================
   The film & show rankings — ours, built as we tick things off
   ========================================================================== */

function FilmRankBoard({
  filmBySlug,
  onPlace,
  onReorder,
  onExclude,
  onRestore,
  onDrop,
}: {
  filmBySlug: Map<string, FilmRow>
  onPlace: (slug: string, slot: number) => Promise<void>
  onReorder: (ordered: string[], from: number, to: number) => void
  onExclude: (slug: string) => void
  onRestore: (slug: string) => void
  onDrop: (slug: string) => void
}) {
  const confirm = useConfirm()
  const [placing, setPlacing] = useState<McuEntry | null>(null)
  const [showExcluded, setShowExcluded] = useState(false)

  const watched = MCU_FILMS.filter((f) => filmBySlug.get(f.slug)?.watched)
  const ranked = watched
    .filter((f) => filmBySlug.get(f.slug)!.rank != null)
    .sort((a, b) => filmBySlug.get(a.slug)!.rank! - filmBySlug.get(b.slug)!.rank!)
  const tray = watched.filter((f) => {
    const r = filmBySlug.get(f.slug)!
    return r.rank == null && !r.rank_excluded
  })
  const excluded = watched.filter((f) => filmBySlug.get(f.slug)!.rank_excluded)
  const orderedSlugs = ranked.map((f) => f.slug)

  if (!watched.length) {
    return (
      <EmptyState
        icon="🏆"
        title="Nothing to rank yet"
        hint="Tick things off in The list and they queue up here for the two of you to place."
      />
    )
  }

  return (
    <div className="stack">
      {tray.length > 0 && (
        <>
          <SectionTitle right={<span className="eyebrow">{tray.length} waiting</span>}>
            To place
          </SectionTitle>
          {tray.map((f) => (
            <div key={f.slug} className="mcu-tray card">
              <div className="grow mcu-film-body">
                <div className="mcu-film-title">{f.title}</div>
                <div className="mcu-film-meta">
                  <span className="num">{f.year}</span>
                  {f.kind === 'show' && <span className="chip mcu-chip-show">Series</span>}
                </div>
              </div>
              <button className="btn btn-accent btn-sm" onClick={() => setPlacing(f)} data-pressable>
                Rank it
              </button>
              <button className="btn btn-quiet btn-sm" onClick={() => onExclude(f.slug)} data-pressable>
                Skip
              </button>
            </div>
          ))}
        </>
      )}

      {ranked.length > 0 && (
        <>
          <SectionTitle right={<span className="eyebrow">{ranked.length} placed</span>}>
            Our ranking
          </SectionTitle>
          {ranked.map((f, i) => (
            <div key={f.slug} className="mcu-char card">
              <span className={`mcu-char-rank display ${i < 3 ? `is-${i + 1}` : ''}`}>{i + 1}</span>
              <div className="grow mcu-char-body">
                <div className="mcu-char-name">{f.title}</div>
                <div className="mcu-char-meta">
                  <span className="num">{f.year}</span>
                  {f.kind === 'show' && <span className="chip mcu-chip-show">Series</span>}
                </div>
              </div>
              <div className="rank-tools">
                <button className="icon-btn" disabled={i === 0} onClick={() => onReorder(orderedSlugs, i, i - 1)} aria-label="Up" data-pressable>
                  <Icon name="chevron" size={14} className="rot-up" />
                </button>
                <button className="icon-btn" disabled={i === ranked.length - 1} onClick={() => onReorder(orderedSlugs, i, i + 1)} aria-label="Down" data-pressable>
                  <Icon name="chevron" size={14} className="rot-down" />
                </button>
                <button
                  className="icon-btn is-danger"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Unrank ${f.title}?`,
                      body: 'It goes back to the waiting pile.',
                      confirmLabel: 'Unrank',
                    })
                    if (ok) onDrop(f.slug)
                  }}
                  aria-label="Remove from ranking"
                  data-pressable
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {excluded.length > 0 && (
        <>
          <button className="mcu-excluded-toggle" onClick={() => setShowExcluded((v) => !v)} data-pressable>
            <Icon name="chevron" size={13} className={showExcluded ? 'rot-down' : ''} />
            Not ranking · {excluded.length}
          </button>
          {showExcluded &&
            excluded.map((f) => (
              <div key={f.slug} className="mcu-tray card is-dim">
                <div className="grow mcu-film-body">
                  <div className="mcu-film-title">{f.title}</div>
                  <div className="mcu-film-meta num">{f.year}</div>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => onRestore(f.slug)} data-pressable>
                  <Icon name="undo" size={13} /> Rank it after all
                </button>
              </div>
            ))}
        </>
      )}

      <Sheet
        open={!!placing}
        onClose={() => setPlacing(null)}
        title={placing ? `Where does ${placing.title} sit?` : ''}
      >
        <p className="muted place-hint">Tap the gap it belongs in — best at the top.</p>
        <div className="place-list">
          <PlaceSlot
            label={ranked.length ? 'Top of the pile' : 'First one in'}
            onClick={async () => {
              await onPlace(placing!.slug, 0)
              setPlacing(null)
            }}
          />
          {ranked.map((f, i) => (
            <div key={f.slug}>
              <div className="place-entry">
                <span className="place-rank num">{i + 1}</span>
                <span className="grow truncate">{f.title}</span>
              </div>
              <PlaceSlot
                label={i === ranked.length - 1 ? 'Bottom of the pile' : 'Here'}
                onClick={async () => {
                  await onPlace(placing!.slug, i + 1)
                  setPlacing(null)
                }}
              />
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  )
}

/* ==========================================================================
   Add / edit a character
   ========================================================================== */

function CharacterSheet({
  row,
  kind,
  ranked,
  onClose,
  onPlace,
  onSaveDetails,
  onDelete,
}: {
  row: CharRow | null
  kind: CharacterKind
  ranked: CharRow[]
  onClose: () => void
  onPlace: (draft: Partial<CharRow> & { kind: CharacterKind; name: string }, slot: number) => void
  onSaveDetails: (patch: Partial<CharRow>) => void
  onDelete?: () => void
}) {
  const toast = useToast()
  const meta = CHARACTER_KINDS.find((k) => k.key === kind)!
  const [name, setName] = useState('')
  const [actor, setActor] = useState('')
  const [placing, setPlacing] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  // The sheet owns the id so a photo can upload before the row exists.
  const [charId, setCharId] = useState<string>(() => uid())
  const [photo, setPhoto] = useState<{ path: string; thumb: string } | null>(null)

  useEffect(() => {
    setName(row?.name ?? '')
    setActor(row?.actor ?? '')
    setCharId(row?.id ?? uid())
    setPhoto(row?.image_path && row.image_thumb ? { path: row.image_path, thumb: row.image_thumb } : null)
    setPlacing(!row) // adding goes straight to placement once named
  }, [row])

  const pickPhoto = async (file: File) => {
    setPhotoBusy(true)
    try {
      const { blob, ext } = await normalizePhoto(file)
      const path = `mcu/${charId}.${ext}`
      const thumb = await makeThumb(blob, 256)
      await uploadMedia(path, blob)
      if (photo && photo.path !== path) void removeMedia(photo.path)
      setPhoto({ path, thumb })
    } catch (e) {
      toast(`Photo failed — ${e instanceof Error ? e.message : 'unknown error'}`, 'bad')
    } finally {
      setPhotoBusy(false)
    }
  }

  const preview: CharRow = {
    id: 'preview', name: name || '?', kind, actor: null,
    image_url: row?.image_url ?? null,
    image_path: photo?.path ?? null, image_thumb: photo?.thumb ?? null,
    film_slug: null, rank: null, score_james: null, score_lee: null,
    notes_james: null, notes_lee: null, added_by: null,
  }

  const draft = {
    id: charId,
    kind,
    name: name.trim(),
    actor: actor.trim() || null,
    image_path: photo?.path ?? null,
    image_thumb: photo?.thumb ?? null,
  }

  const others = ranked.filter((c) => c.id !== row?.id)

  return (
    <Sheet
      open
      onClose={onClose}
      title={row ? row.name : `Add ${meta.label.toLowerCase()}`}
      footer={
        !placing ? (
          <>
            {onDelete && (
              <button className="btn btn-danger btn-sm" onClick={onDelete} aria-label="Delete" data-pressable>
                <Icon name="trash" size={15} />
              </button>
            )}
            <button className="btn btn-quiet" onClick={() => setPlacing(true)} data-pressable>
              Re-place
            </button>
            <button
              className="btn btn-accent"
              disabled={!name.trim()}
              onClick={() =>
                onSaveDetails({
                  name: name.trim(),
                  actor: actor.trim() || null,
                  image_path: photo?.path ?? null,
                  image_thumb: photo?.thumb ?? null,
                })
              }
              data-pressable
            >
              Save
            </button>
          </>
        ) : undefined
      }
    >
      <div className="mcu-char-head">
        <Avatar row={preview} size={72} />
        <div className="grow stack">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={meta.label} autoFocus={!row} />
          </Field>
          <Field label="Played by">
            <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Actor" />
          </Field>
        </div>
      </div>

      <label className="btn btn-quiet btn-block btn-sm set-import" data-pressable>
        <Icon name="camera" size={14} />
        {photoBusy ? 'Working…' : photo || row?.image_url ? 'Replace the photo' : 'Add a photo'}
        <input
          type="file"
          accept="image/*,.heic,.heif"
          hidden
          disabled={photoBusy}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void pickPhoto(f)
            e.target.value = ''
          }}
        />
      </label>

      {placing && (
        <>
          <p className="muted place-hint">
            {name.trim() ? `Where does Lee put ${name.trim()}?` : 'Name them first, then tap the gap they belong in.'}
          </p>
          {name.trim() && (
            <div className="place-list">
              <PlaceSlot label={others.length ? 'Top of the board' : 'First on the board'} onClick={() => onPlace(draft, 0)} />
              {others.map((c, i) => (
                <div key={c.id}>
                  <div className="place-entry">
                    <span className="place-rank num">{i + 1}</span>
                    <span className="grow truncate">{c.name}</span>
                  </div>
                  <PlaceSlot
                    label={i === others.length - 1 ? 'Bottom of the board' : 'Here'}
                    onClick={() => onPlace(draft, i + 1)}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}

function PlaceSlot({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="place-slot" onClick={onClick} data-pressable>
      <span className="place-slot-line" />
      <span className="place-slot-label">{label}</span>
      <span className="place-slot-line" />
    </button>
  )
}

/* ==========================================================================
   Export: the three boards, as one shareable picture
   ========================================================================== */

async function exportRankings(all: CharRow[]) {
  await document.fonts.ready

  const ink = '#0A0708'
  const text = '#F4EBE6'
  const dim = '#7C6A66'
  const colors: Record<CharacterKind, string> = {
    hero: '#E9B44C',
    villain: '#A87CFF',
    love: '#E8446B',
  }

  const sections = CHARACTER_KINDS.map((k) => ({
    meta: k,
    list: all.filter((c) => c.kind === k.key).sort(byRank),
  })).filter((s) => s.list.length)

  const W = 1000
  const pad = 64
  const rowH = 52
  const headH = 96
  let H = 210
  for (const s of sections) H += headH + s.list.length * rowH + 26

  const canvas = document.createElement('canvas')
  const scale = 2
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  ctx.fillStyle = ink
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = text
  ctx.font = '700 52px "Bodoni Moda", serif'
  ctx.fillText("Lee's MCU Rankings", pad, 108)
  ctx.fillStyle = dim
  ctx.font = '500 17px "Space Grotesk", sans-serif'
  ctx.fillText(
    new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
    pad,
    142,
  )

  let y = 210
  for (const s of sections) {
    ctx.fillStyle = colors[s.meta.key]
    ctx.font = '700 30px "Bodoni Moda", serif'
    ctx.fillText(s.meta.plural.toUpperCase(), pad, y + 30)
    ctx.strokeStyle = colors[s.meta.key] + '55'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(pad, y + 48)
    ctx.lineTo(W - pad, y + 48)
    ctx.stroke()
    y += headH

    s.list.forEach((c, i) => {
      const rowY = y + i * rowH
      ctx.fillStyle = i < 3 ? colors[s.meta.key] : dim
      ctx.font = '700 26px "Bodoni Moda", serif'
      ctx.textAlign = 'right'
      ctx.fillText(String(i + 1), pad + 34, rowY + 8)
      ctx.textAlign = 'left'
      ctx.fillStyle = text
      ctx.font = '600 23px "Space Grotesk", sans-serif'
      ctx.fillText(c.name, pad + 58, rowY + 8)
      if (c.actor) {
        const w = ctx.measureText(c.name).width
        ctx.fillStyle = dim
        ctx.font = '400 17px "Space Grotesk", sans-serif'
        ctx.fillText(`— ${c.actor}`, pad + 58 + w + 14, rowY + 8)
      }
    })
    y += s.list.length * rowH + 26
  }

  ctx.fillStyle = dim
  ctx.font = 'italic 400 16px "Bodoni Moda", serif'
  ctx.fillText('LJ — ours, nobody else’s.', pad, H - 40)

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('canvas')

  const file = new File([blob], 'lees-mcu-rankings.png', { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Lee's MCU Rankings" })
      return
    } catch {
      /* cancelled share falls through to download */
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'lees-mcu-rankings.png'
  a.click()
  URL.revokeObjectURL(a.href)
}
