import { useEffect, useMemo, useState } from 'react'
import './Titles.css'

import { useCollection } from '../lib/collection'
import { otherProfile, type Profile } from '../lib/session'
import * as tmdb from '../lib/tmdb'
import { Icon } from '../components/Icon'
import {
  EmptyState, Fab, Field, RatingBar, ScorePair, Sheet, useConfirm, useToast,
} from '../components/ui'

/* -------------------------------------------------------------------------- */

export type TitleRow = {
  id: string
  kind: 'movie' | 'tv'
  tmdb_id: number | null
  title: string
  year: number | null
  genres: string[] | null
  poster_path: string | null
  overview: string | null
  runtime: number | null
  seasons: number | null
  episodes: number | null
  director: string | null
  cast_list: string[] | null
  language: string | null
  country: string | null
  release_date: string | null
  watched_on: string | null
  score_james: number | null
  score_lee: number | null
  notes_james: string | null
  notes_lee: string | null
  added_by: string | null
  created_at?: string
  updated_at?: string
}

const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

export const scoreKey = (slug: string): 'score_james' | 'score_lee' =>
  slug === 'james' ? 'score_james' : 'score_lee'

export const notesKey = (slug: string): 'notes_james' | 'notes_lee' =>
  slug === 'james' ? 'notes_james' : 'notes_lee'

export function avgOf(t: TitleRow) {
  const vals = [t.score_james, t.score_lee].filter((v): v is number => v != null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

/* ========================================================================== */

type Sort = 'recent' | 'best' | 'worst' | 'az' | 'gap'

export function TitlesTab({ kind, me }: { kind: 'movie' | 'tv'; me: Profile }) {
  const { rows, upsert, remove } = useCollection<TitleRow>('lj_titles')
  const toast = useToast()
  const confirm = useConfirm()

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<TitleRow | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [showStats, setShowStats] = useState(false)

  const them = otherProfile(me.slug)
  const noun = kind === 'movie' ? 'film' : 'show'

  const mine = useMemo(() => rows.filter((r) => r.kind === kind), [rows, kind])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? mine.filter(
          (t) =>
            t.title.toLowerCase().includes(needle) ||
            (t.director ?? '').toLowerCase().includes(needle) ||
            (t.genres ?? []).some((g) => g.toLowerCase().includes(needle)),
        )
      : mine

    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sort === 'az') return a.title.localeCompare(b.title)
      if (sort === 'best') return (avgOf(b) ?? -1) - (avgOf(a) ?? -1)
      if (sort === 'worst') return (avgOf(a) ?? 99) - (avgOf(b) ?? 99)
      if (sort === 'gap') {
        const g = (t: TitleRow) =>
          t.score_james != null && t.score_lee != null ? Math.abs(t.score_james - t.score_lee) : -1
        return g(b) - g(a)
      }
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
    return sorted
  }, [mine, q, sort])

  const stats = useMemo(() => {
    const rated = mine.filter((t) => avgOf(t) != null)
    const genres = new Map<string, { n: number; sum: number }>()
    for (const t of rated) {
      const a = avgOf(t)!
      for (const g of t.genres ?? []) {
        const cur = genres.get(g) ?? { n: 0, sum: 0 }
        genres.set(g, { n: cur.n + 1, sum: cur.sum + a })
      }
    }
    const topGenres = [...genres.entries()]
      .filter(([, v]) => v.n >= 2)
      .map(([g, v]) => ({ genre: g, n: v.n, avg: v.sum / v.n }))
      .sort((a, b) => b.avg - a.avg)

    const js = mine.map((t) => t.score_james).filter((v): v is number => v != null)
    const ls = mine.map((t) => t.score_lee).filter((v): v is number => v != null)
    const both = mine.filter((t) => t.score_james != null && t.score_lee != null)
    const biggestGap = [...both].sort(
      (a, b) => Math.abs(b.score_james! - b.score_lee!) - Math.abs(a.score_james! - a.score_lee!),
    )[0]

    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

    return {
      count: mine.length,
      rated: rated.length,
      jamesAvg: mean(js),
      leeAvg: mean(ls),
      overall: mean(rated.map((t) => avgOf(t)!)),
      topGenres,
      biggestGap,
      agreement: both.length
        ? mean(both.map((t) => Math.abs(t.score_james! - t.score_lee!)))
        : null,
      totalRuntime: mine.reduce((a, t) => a + (t.runtime ?? 0) * (t.episodes ?? 1), 0),
    }
  }, [mine])

  return (
    <>
      {mine.length > 0 && (
        <div className="stat-strip">
          <div className="stat-cell">
            <div className="stat-cell-value" style={{ color: 'var(--accent)' }}>{stats.count}</div>
            <div className="eyebrow">{kind === 'movie' ? 'Films' : 'Shows'}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-cell-value">{stats.overall?.toFixed(1) ?? '—'}</div>
            <div className="eyebrow">Our avg</div>
          </div>
          <button className="stat-cell stat-cell-btn" onClick={() => setShowStats(true)} data-pressable>
            <div className="stat-cell-value" style={{ color: 'var(--text-2)' }}>
              <Icon name="star" size={20} />
            </div>
            <div className="eyebrow">Insights</div>
          </button>
        </div>
      )}

      {mine.length > 0 && (
        <>
          <div className="search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search our ${kind === 'movie' ? 'films' : 'shows'}…`} />
            {q && (
              <button className="search-clear" onClick={() => setQ('')} aria-label="Clear" data-pressable>
                <Icon name="x" size={13} />
              </button>
            )}
          </div>

          <div className="filters scroll-x">
            {(
              [
                ['recent', 'Recent'],
                ['best', 'Best'],
                ['worst', 'Worst'],
                ['gap', 'We disagreed'],
                ['az', 'A–Z'],
              ] as [Sort, string][]
            ).map(([id, label]) => (
              <button key={id} className={`filter ${sort === id ? 'is-on' : ''}`} onClick={() => setSort(id)} data-pressable>
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={kind === 'movie' ? '🎬' : '📺'}
          title={mine.length ? 'Nothing matches' : `No ${kind === 'movie' ? 'films' : 'shows'} yet`}
          hint={mine.length ? 'Try a different search.' : `Add the first one you both watched and rate it.`}
          action={
            !mine.length && (
              <button className="btn btn-accent" onClick={() => setAdding(true)} data-pressable>
                Add a {noun}
              </button>
            )
          }
        />
      ) : (
        <div className="stack">
          {list.map((t) => (
            <TitleCard key={t.id} title={t} me={me} onOpen={() => setEditing(t)} />
          ))}
        </div>
      )}

      <Fab onClick={() => setAdding(true)} label={`Add ${noun}`} />

      <AddSheet
        open={adding}
        kind={kind}
        onClose={() => setAdding(false)}
        onPick={async (row) => {
          const created = { ...row, id: uid(), added_by: me.slug, created_at: new Date().toISOString() }
          await upsert(created as TitleRow)
          setAdding(false)
          setEditing(created as TitleRow)
        }}
      />

      <EditSheet
        title={editing}
        me={me}
        them={them}
        onClose={() => setEditing(null)}
        onSave={async (patch) => {
          await upsert(patch)
          setEditing(null)
          toast('Saved', 'good')
        }}
        onDelete={async (t) => {
          const ok = await confirm({
            title: `Delete ${t.title}?`,
            body: 'Both ratings and the metadata go with it.',
            confirmLabel: 'Delete',
            danger: true,
          })
          if (!ok) return
          await remove(t.id)
          setEditing(null)
          toast('Deleted')
        }}
      />

      <Sheet open={showStats} onClose={() => setShowStats(false)} title="Insights">
        <div className="ins-grid">
          <div className="ins-cell">
            <div className="ins-value display" style={{ color: 'var(--rose)' }}>{stats.jamesAvg?.toFixed(1) ?? '—'}</div>
            <div className="eyebrow">James avg</div>
          </div>
          <div className="ins-cell">
            <div className="ins-value display" style={{ color: 'var(--gold)' }}>{stats.leeAvg?.toFixed(1) ?? '—'}</div>
            <div className="eyebrow">Lee avg</div>
          </div>
          <div className="ins-cell">
            <div className="ins-value display">{stats.agreement?.toFixed(1) ?? '—'}</div>
            <div className="eyebrow">Avg gap</div>
          </div>
          <div className="ins-cell">
            <div className="ins-value display">
              {stats.totalRuntime ? `${Math.round(stats.totalRuntime / 60)}h` : '—'}
            </div>
            <div className="eyebrow">Watched</div>
          </div>
        </div>

        {stats.topGenres.length > 0 && (
          <div className="stack">
            <span className="eyebrow">Genres we rate highest</span>
            {stats.topGenres.slice(0, 8).map((g) => (
              <div key={g.genre} className="ins-bar-row">
                <span className="ins-bar-label truncate">{g.genre}</span>
                <div className="ins-bar">
                  <div className="ins-bar-fill" style={{ width: `${(g.avg / 10) * 100}%` }} />
                </div>
                <span className="num ins-bar-value">{g.avg.toFixed(1)}</span>
                <span className="ins-bar-n eyebrow">×{g.n}</span>
              </div>
            ))}
          </div>
        )}

        {stats.biggestGap && (
          <div className="ins-note">
            <span className="eyebrow">Biggest disagreement</span>
            <p>
              <strong>{stats.biggestGap.title}</strong> — James {stats.biggestGap.score_james?.toFixed(1)}, Lee{' '}
              {stats.biggestGap.score_lee?.toFixed(1)}
            </p>
          </div>
        )}
      </Sheet>
    </>
  )
}

/* -------------------------------------------------------------------------- */

function TitleCard({ title: t, me, onOpen }: { title: TitleRow; me: Profile; onOpen: () => void }) {
  const avg = avgOf(t)
  const poster = tmdb.IMG(t.poster_path, 'w185')
  const unrated = t[scoreKey(me.slug)] == null

  return (
    <button className="title-card card" onClick={onOpen} data-pressable data-press-scale="subtle">
      <div className="poster title-poster">
        {poster ? <img src={poster} alt="" loading="lazy" /> : <span className="poster-fallback">{t.title[0]}</span>}
      </div>

      <div className="title-body">
        <div className="title-name">{t.title}</div>
        <div className="title-meta">
          {t.year && <span className="num">{t.year}</span>}
          {t.runtime ? <span>· {t.runtime}m</span> : null}
          {t.seasons ? <span>· {t.seasons} season{t.seasons === 1 ? '' : 's'}</span> : null}
        </div>
        {t.genres?.length ? (
          <div className="title-genres">
            {t.genres.slice(0, 3).map((g) => (
              <span key={g} className="chip title-genre">{g}</span>
            ))}
          </div>
        ) : null}
        <div className="title-scores">
          <span className="num" style={{ color: 'var(--rose)' }}>{t.score_james?.toFixed(1) ?? '—'}</span>
          <span className="title-scores-sep">/</span>
          <span className="num" style={{ color: 'var(--gold)' }}>{t.score_lee?.toFixed(1) ?? '—'}</span>
          {unrated && <span className="title-nudge">rate it</span>}
        </div>
      </div>

      <div className="title-avg">
        <span className="title-avg-value display">{avg?.toFixed(1) ?? '—'}</span>
      </div>
    </button>
  )
}

/* -------------------------------------------------------------------------- */

function AddSheet({
  open,
  kind,
  onClose,
  onPick,
}: {
  open: boolean
  kind: 'movie' | 'tv'
  onClose: () => void
  onPick: (row: Partial<TitleRow>) => void
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<tmdb.TmdbHit[]>([])
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState(!tmdb.hasTmdb())
  const [mTitle, setMTitle] = useState('')
  const [mYear, setMYear] = useState('')
  const [mGenres, setMGenres] = useState('')
  const toast = useToast()

  useEffect(() => {
    if (!open) {
      setQ('')
      setHits([])
      setManual(!tmdb.hasTmdb())
      setMTitle('')
      setMYear('')
      setMGenres('')
    }
  }, [open])

  useEffect(() => {
    if (!q.trim() || manual) {
      setHits([])
      return
    }
    const id = setTimeout(async () => {
      setBusy(true)
      try {
        setHits(await tmdb.search(q, kind))
      } catch {
        toast('TMDb lookup failed — check the key in Settings', 'bad')
      } finally {
        setBusy(false)
      }
    }, 320)
    return () => clearTimeout(id)
  }, [q, kind, manual, toast])

  const choose = async (hit: tmdb.TmdbHit) => {
    setBusy(true)
    try {
      const d = await tmdb.detail(hit.tmdb_id, kind)
      onPick({
        kind,
        tmdb_id: d.tmdb_id,
        title: d.title,
        year: d.year,
        genres: d.genres,
        poster_path: d.poster_path,
        overview: d.overview,
        runtime: d.runtime,
        seasons: d.seasons,
        episodes: d.episodes,
        director: d.director,
        cast_list: d.cast_list,
        language: d.language,
        country: d.country,
        release_date: d.release_date,
      })
    } catch {
      onPick({ kind, tmdb_id: hit.tmdb_id, title: hit.title, year: hit.year, poster_path: hit.poster_path })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Add a ${kind === 'movie' ? 'film' : 'show'}`}>
      {!manual ? (
        <>
          <div className="search">
            <Icon name="search" size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={kind === 'movie' ? 'Search films…' : 'Search shows…'}
              autoFocus
            />
          </div>

          {busy && <div className="muted center-note">Looking…</div>}

          <div className="hits">
            {hits.map((h) => (
              <button key={h.tmdb_id} className="hit" onClick={() => choose(h)} data-pressable>
                <div className="poster hit-poster">
                  {tmdb.IMG(h.poster_path, 'w185') ? (
                    <img src={tmdb.IMG(h.poster_path, 'w185')!} alt="" loading="lazy" />
                  ) : (
                    <span className="poster-fallback">{h.title[0]}</span>
                  )}
                </div>
                <div className="grow">
                  <div className="hit-title">{h.title}</div>
                  <div className="hit-year num">{h.year ?? '—'}</div>
                  {h.overview && <div className="hit-blurb">{h.overview}</div>}
                </div>
              </button>
            ))}
          </div>

          <button className="btn btn-quiet btn-block" onClick={() => setManual(true)} data-pressable>
            Enter it manually instead
          </button>
        </>
      ) : (
        <>
          {!tmdb.hasTmdb() && (
            <p className="muted place-hint">
              Add a free TMDb key in Settings and posters, genres and cast fill themselves in.
            </p>
          )}
          <Field label="Title">
            <input value={mTitle} onChange={(e) => setMTitle(e.target.value)} autoFocus placeholder="Title" />
          </Field>
          <Field label="Year">
            <input value={mYear} onChange={(e) => setMYear(e.target.value)} inputMode="numeric" placeholder="2026" />
          </Field>
          <Field label="Genres" hint="Comma separated.">
            <input value={mGenres} onChange={(e) => setMGenres(e.target.value)} placeholder="Drama, Thriller" />
          </Field>
          <button
            className="btn btn-accent btn-block"
            disabled={!mTitle.trim()}
            onClick={() =>
              onPick({
                kind,
                title: mTitle.trim(),
                year: mYear ? Number(mYear) : null,
                genres: mGenres.split(',').map((s) => s.trim()).filter(Boolean),
              })
            }
            data-pressable
          >
            Add it
          </button>
          {tmdb.hasTmdb() && (
            <button className="btn btn-quiet btn-block" onClick={() => setManual(false)} data-pressable>
              Search TMDb instead
            </button>
          )}
        </>
      )}
    </Sheet>
  )
}

/* -------------------------------------------------------------------------- */

function EditSheet({
  title: t,
  me,
  them,
  onClose,
  onSave,
  onDelete,
}: {
  title: TitleRow | null
  me: Profile
  them: Profile
  onClose: () => void
  onSave: (patch: Partial<TitleRow> & { id: string }) => void
  onDelete: (t: TitleRow) => void
}) {
  const [mine, setMine] = useState<number | null>(null)
  const [theirs, setTheirs] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [watched, setWatched] = useState('')

  useEffect(() => {
    if (!t) return
    setMine(t[scoreKey(me.slug)] ?? null)
    setTheirs(t[scoreKey(them.slug)] ?? null)
    setNote(t[notesKey(me.slug)] ?? '')
    setWatched(t.watched_on ?? '')
  }, [t, me.slug, them.slug])

  if (!t) return null

  return (
    <Sheet
      open
      onClose={onClose}
      title={t.title}
      footer={
        <>
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(t)} aria-label="Delete" data-pressable>
            <Icon name="trash" size={15} />
          </button>
          <button
            className="btn btn-accent"
            onClick={() =>
              onSave({
                id: t.id,
                [scoreKey(me.slug)]: mine,
                [scoreKey(them.slug)]: theirs,
                [notesKey(me.slug)]: note.trim() || null,
                watched_on: watched || null,
              } as Partial<TitleRow> & { id: string })
            }
            data-pressable
          >
            Save
          </button>
        </>
      }
    >
      <div className="edit-head">
        <div className="poster edit-poster">
          {tmdb.IMG(t.poster_path, 'w342') ? (
            <img src={tmdb.IMG(t.poster_path, 'w342')!} alt="" />
          ) : (
            <span className="poster-fallback">{t.title[0]}</span>
          )}
        </div>
        <div className="grow edit-facts">
          {t.year && <div><span className="eyebrow">Year</span><span className="num">{t.year}</span></div>}
          {t.director && <div><span className="eyebrow">{t.kind === 'movie' ? 'Director' : 'Creator'}</span><span>{t.director}</span></div>}
          {t.runtime ? <div><span className="eyebrow">Runtime</span><span className="num">{t.runtime}m</span></div> : null}
          {t.seasons ? <div><span className="eyebrow">Seasons</span><span className="num">{t.seasons}</span></div> : null}
        </div>
      </div>

      {t.genres?.length ? (
        <div className="pos-chips">
          {t.genres.map((g) => <span key={g} className="chip">{g}</span>)}
        </div>
      ) : null}

      {t.overview && <p className="edit-blurb selectable">{t.overview}</p>}

      <ScorePair mine={mine} theirs={theirs} myName={me.name} theirName={them.name} />

      <RatingBar label={`${me.name} — your score`} value={mine} onChange={setMine} accent={me.accent} />
      <RatingBar label={`${them.name}'s score`} value={theirs} onChange={setTheirs} accent={them.accent} />

      <Field label="Watched on">
        <input type="date" value={watched} onChange={(e) => setWatched(e.target.value)} />
      </Field>

      <Field label={`${me.name}'s note`}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you make of it?" />
      </Field>

      {t[notesKey(them.slug)] && (
        <div className="their-note">
          <span className="eyebrow">{them.name} said</span>
          <p className="selectable">{t[notesKey(them.slug)]}</p>
        </div>
      )}
    </Sheet>
  )
}
