import { useEffect, useMemo, useRef, useState } from 'react'
import './Titles.css'

import { useCollection } from '../lib/collection'
import { otherProfile, profileOf, type Profile } from '../lib/session'
import * as tmdb from '../lib/tmdb'
import { Icon } from '../components/Icon'
import { RateReveal } from '../components/RateReveal'
import {
  EmptyState, Fab, Field, ScorePair, Sheet, useConfirm, useToast,
} from '../components/ui'

/* ==========================================================================
   Films & TV.

   Two piles (plus "watching" for shows): the list of things we mean to
   watch, and the scored history of things we have. The only road from one
   to the other is the blind-rating ritual in <RateReveal />.
   ========================================================================== */

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
  /** Legacy rows predate this column — null reads as 'watched'. */
  status: 'towatch' | 'watching' | 'watched' | null
  score_james: number | null
  score_lee: number | null
  /** Blind scores waiting for the reveal. */
  pending_score_james: number | null
  pending_score_lee: number | null
  new_season: boolean | null
  seasons_checked_at: string | null
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

export const pendingKey = (slug: string): 'pending_score_james' | 'pending_score_lee' =>
  slug === 'james' ? 'pending_score_james' : 'pending_score_lee'

export const statusOf = (t: TitleRow) => t.status ?? 'watched'

export function avgOf(t: TitleRow) {
  const vals = [t.score_james, t.score_lee].filter((v): v is number => v != null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

const dayOld = (iso: string | null) =>
  !iso || Date.now() - new Date(iso).getTime() > 24 * 60 * 60 * 1000

/* ========================================================================== */

type ListView = 'towatch' | 'watching' | 'watched'
type Sort = 'recent' | 'best' | 'worst' | 'az' | 'gap'

export function TitlesTab({ kind, me }: { kind: 'movie' | 'tv'; me: Profile }) {
  const { rows, upsert, remove } = useCollection<TitleRow>('lj_titles')
  const toast = useToast()
  const confirm = useConfirm()

  const [view, setView] = useState<ListView>('towatch')
  const [adding, setAdding] = useState(false)
  const [detail, setDetail] = useState<TitleRow | null>(null)
  const [watchedOpen, setWatchedOpen] = useState<TitleRow | null>(null)
  const [rateId, setRateId] = useState<string | null>(null)
  const [justRated, setJustRated] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [showStats, setShowStats] = useState(false)

  const them = otherProfile(me.slug)
  const noun = kind === 'movie' ? 'film' : 'show'

  const mine = useMemo(() => rows.filter((r) => r.kind === kind), [rows, kind])

  const towatch = useMemo(
    () =>
      mine
        .filter((r) => statusOf(r) === 'towatch')
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
    [mine],
  )
  const watching = useMemo(
    () =>
      mine
        .filter((r) => statusOf(r) === 'watching')
        .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')),
    [mine],
  )
  const watched = useMemo(() => mine.filter((r) => statusOf(r) === 'watched'), [mine])

  // The overlay reads the LIVE row, so the other phone's submit lands mid-flow.
  const rateRow = rateId ? mine.find((r) => r.id === rateId) ?? null : null

  // If the pair completed on the other phone, the countdown starts here too.
  useEffect(() => {
    if (rateId) return
    const hot = mine.find(
      (r) => r.pending_score_james != null && r.pending_score_lee != null,
    )
    if (hot) setRateId(hot.id)
  }, [mine, rateId])

  useEffect(() => {
    if (!justRated) return
    const t = setTimeout(() => setJustRated(null), 3200)
    return () => clearTimeout(t)
  }, [justRated])

  /* New-season sweep: for finished shows, ask TMDb (at most once a day per
     show, a few per visit) whether more seasons exist now. */
  const swept = useRef(false)
  useEffect(() => {
    if (kind !== 'tv' || swept.current || !tmdb.hasTmdb() || !navigator.onLine) return
    if (!mine.length) return
    swept.current = true
    const stale = mine
      .filter(
        (r) =>
          statusOf(r) === 'watched' &&
          r.tmdb_id &&
          r.seasons != null &&
          dayOld(r.seasons_checked_at),
      )
      .slice(0, 5)
    void (async () => {
      for (const r of stale) {
        try {
          const d = await tmdb.detail(r.tmdb_id!, 'tv')
          if ((d.seasons ?? 0) > (r.seasons ?? 0)) {
            await upsert({
              id: r.id,
              seasons: d.seasons,
              episodes: d.episodes,
              new_season: true,
              status: 'towatch',
              seasons_checked_at: new Date().toISOString(),
            })
            toast(`New season of ${r.title} — back on the list`, 'good')
          } else {
            await upsert({ id: r.id, seasons_checked_at: new Date().toISOString() })
          }
        } catch {
          /* offline or rate-limited — try again another day */
        }
      }
    })()
  }, [kind, mine, upsert, toast])

  /* --- watched pile: search, sort, stats ------------------------------- */

  const watchedList = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? watched.filter(
          (t) =>
            t.title.toLowerCase().includes(needle) ||
            (t.director ?? '').toLowerCase().includes(needle) ||
            (t.genres ?? []).some((g) => g.toLowerCase().includes(needle)),
        )
      : watched

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
      return (b.watched_on ?? b.created_at ?? '').localeCompare(a.watched_on ?? a.created_at ?? '')
    })
    return sorted
  }, [watched, q, sort])

  const stats = useMemo(() => {
    const rated = watched.filter((t) => avgOf(t) != null)
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

    const js = watched.map((t) => t.score_james).filter((v): v is number => v != null)
    const ls = watched.map((t) => t.score_lee).filter((v): v is number => v != null)
    const both = watched.filter((t) => t.score_james != null && t.score_lee != null)
    const biggestGap = [...both].sort(
      (a, b) => Math.abs(b.score_james! - b.score_lee!) - Math.abs(a.score_james! - a.score_lee!),
    )[0]

    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

    return {
      rated: rated.length,
      jamesAvg: mean(js),
      leeAvg: mean(ls),
      overall: mean(rated.map((t) => avgOf(t)!)),
      topGenres,
      biggestGap,
      agreement: both.length
        ? mean(both.map((t) => Math.abs(t.score_james! - t.score_lee!)))
        : null,
      totalRuntime: watched.reduce((a, t) => a + (t.runtime ?? 0) * (t.episodes ?? 1), 0),
    }
  }, [watched])

  /* --- shared actions --------------------------------------------------- */

  const startRating = (t: TitleRow) => {
    setDetail(null)
    setWatchedOpen(null)
    setRateId(t.id)
  }

  const moveTo = async (t: TitleRow, status: 'towatch' | 'watching') => {
    await upsert({ id: t.id, status, new_season: false })
    setDetail(null)
    toast(status === 'watching' ? `Watching ${t.title}` : 'Back on the list', 'good')
  }

  const del = async (t: TitleRow) => {
    const ok = await confirm({
      title: `Delete ${t.title}?`,
      body: 'Scores and metadata go with it.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    await remove(t.id)
    setDetail(null)
    setWatchedOpen(null)
    toast('Deleted')
  }

  /* --- render ----------------------------------------------------------- */

  const views: [ListView, string][] =
    kind === 'tv'
      ? [
          ['towatch', `To watch${towatch.length ? ` · ${towatch.length}` : ''}`],
          ['watching', `Watching${watching.length ? ` · ${watching.length}` : ''}`],
          ['watched', `Watched${watched.length ? ` · ${watched.length}` : ''}`],
        ]
      : [
          ['towatch', `To watch${towatch.length ? ` · ${towatch.length}` : ''}`],
          ['watched', `Watched${watched.length ? ` · ${watched.length}` : ''}`],
        ]

  const activeList = view === 'towatch' ? towatch : view === 'watching' ? watching : watchedList

  return (
    <>
      <div className="seg">
        {views.map(([id, label]) => (
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

      {view === 'watched' && watched.length > 0 && (
        <>
          <div className="stat-strip">
            <div className="stat-cell">
              <div className="stat-cell-value" style={{ color: 'var(--accent)' }}>{watched.length}</div>
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

      {activeList.length === 0 ? (
        <EmptyState
          icon={kind === 'movie' ? '🎬' : '📺'}
          title={
            view === 'towatch'
              ? 'Nothing on the list'
              : view === 'watching'
                ? 'Not watching anything'
                : q
                  ? 'Nothing matches'
                  : `No ${kind === 'movie' ? 'films' : 'shows'} watched yet`
          }
          hint={
            view === 'towatch'
              ? `Add the ${kind === 'movie' ? 'films' : 'shows'} you two mean to get through.`
              : view === 'watching'
                ? 'When you start a season, move it here.'
                : q
                  ? 'Try a different search.'
                  : 'Rate your first one together and it lands here.'
          }
          action={
            view === 'towatch' && (
              <button className="btn btn-accent" onClick={() => setAdding(true)} data-pressable>
                Add a {noun}
              </button>
            )
          }
        />
      ) : (
        <div className="stack">
          {view === 'watched'
            ? watchedList.map((t) => (
                <TitleCard
                  key={t.id}
                  title={t}
                  stamped={justRated === t.id}
                  onOpen={() => setWatchedOpen(t)}
                />
              ))
            : activeList.map((t) => (
                <QueueCard
                  key={t.id}
                  title={t}
                  me={me}
                  view={view}
                  onOpen={() => setDetail(t)}
                  onRate={() => startRating(t)}
                />
              ))}
        </div>
      )}

      <Fab onClick={() => setAdding(true)} label={`Add ${noun}`} />

      <AddSheet
        open={adding}
        kind={kind}
        onClose={() => setAdding(false)}
        onPick={async (row) => {
          const created: TitleRow = {
            ...(row as TitleRow),
            id: uid(),
            status: 'towatch',
            new_season: false,
            seasons_checked_at: new Date().toISOString(),
            added_by: me.slug,
            created_at: new Date().toISOString(),
          }
          await upsert(created)
          setAdding(false)
          setView('towatch')
          toast(`${created.title} — on the list`, 'good')
        }}
      />

      <QueueSheet
        title={detail}
        kind={kind}
        onClose={() => setDetail(null)}
        onRate={startRating}
        onMove={moveTo}
        onDelete={del}
      />

      <WatchedSheet
        title={watchedOpen}
        me={me}
        them={them}
        onClose={() => setWatchedOpen(null)}
        onSave={async (patch) => {
          await upsert(patch)
          setWatchedOpen(null)
          toast('Saved', 'good')
        }}
        onRerate={startRating}
        onDelete={del}
      />

      {rateRow && (
        <RateReveal
          row={rateRow}
          me={me}
          onClose={() => setRateId(null)}
          onDone={(t) => {
            setRateId(null)
            setJustRated(t.id)
            setView('watched')
          }}
        />
      )}

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
                  <div className="ins-bar-fill" style={{ width: `${(g.avg / 5) * 100}%` }} />
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

/* ==========================================================================
   Cards
   ========================================================================== */

function TitleCard({
  title: t,
  stamped,
  onOpen,
}: {
  title: TitleRow
  stamped: boolean
  onOpen: () => void
}) {
  const avg = avgOf(t)
  const poster = tmdb.IMG(t.poster_path, 'w185')

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
        <div className={`title-scores ${stamped ? 'is-stamped' : ''}`}>
          <span className="num" style={{ color: 'var(--rose)' }}>{t.score_james?.toFixed(1) ?? '—'}</span>
          <span className="title-scores-sep">/</span>
          <span className="num" style={{ color: 'var(--gold)' }}>{t.score_lee?.toFixed(1) ?? '—'}</span>
          <span className="title-scores-outof eyebrow">of 5</span>
        </div>
      </div>

      <div className={`title-avg ${stamped ? 'is-stamped' : ''}`}>
        <span className="title-avg-value display">{avg?.toFixed(1) ?? '—'}</span>
      </div>
    </button>
  )
}

function QueueCard({
  title: t,
  me,
  view,
  onOpen,
  onRate,
}: {
  title: TitleRow
  me: Profile
  view: 'towatch' | 'watching'
  onOpen: () => void
  onRate: () => void
}) {
  const poster = tmdb.IMG(t.poster_path, 'w185')
  const myPending = t[pendingKey(me.slug)] != null
  const theirPending = t[pendingKey(otherProfile(me.slug).slug)] != null
  const who = profileOf(t.added_by)

  return (
    <div className="queue-card card">
      <button className="queue-main" onClick={onOpen} data-pressable data-press-scale="subtle">
        <div className="poster title-poster">
          {poster ? <img src={poster} alt="" loading="lazy" /> : <span className="poster-fallback">{t.title[0]}</span>}
        </div>
        <div className="title-body">
          <div className="title-name">{t.title}</div>
          <div className="title-meta">
            {t.year && <span className="num">{t.year}</span>}
            {t.seasons ? <span>· {t.seasons} season{t.seasons === 1 ? '' : 's'}</span> : null}
            {who && <span style={{ color: who.accent }}>· {who.name}</span>}
          </div>
          <div className="queue-chips">
            {t.new_season && <span className="chip chip-new">New season</span>}
            {theirPending && !myPending && (
              <span className="chip chip-turn">{otherProfile(me.slug).name} locked in — your turn</span>
            )}
            {myPending && !theirPending && <span className="chip chip-wait">Waiting on {otherProfile(me.slug).name}</span>}
          </div>
        </div>
      </button>
      <button className="btn btn-outline btn-sm queue-rate" onClick={onRate} data-pressable>
        {view === 'watching' ? 'Finished' : 'Watched it'}
      </button>
    </div>
  )
}

/* ==========================================================================
   Sheets
   ========================================================================== */

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

/** Detail for a queued title — the launchpad into the rating ritual. */
function QueueSheet({
  title: t,
  kind,
  onClose,
  onRate,
  onMove,
  onDelete,
}: {
  title: TitleRow | null
  kind: 'movie' | 'tv'
  onClose: () => void
  onRate: (t: TitleRow) => void
  onMove: (t: TitleRow, status: 'towatch' | 'watching') => void
  onDelete: (t: TitleRow) => void
}) {
  if (!t) return null
  const st = statusOf(t)

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
          <button className="btn btn-accent" onClick={() => onRate(t)} data-pressable>
            We watched it — rate it
          </button>
        </>
      }
    >
      {t.new_season && (
        <div className="new-season-banner">
          <span>📣</span> A new season is out.
        </div>
      )}

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

      {kind === 'tv' && st === 'towatch' && (
        <button className="btn btn-outline btn-block" onClick={() => onMove(t, 'watching')} data-pressable>
          <Icon name="play" size={15} /> We're watching it
        </button>
      )}
      {kind === 'tv' && st === 'watching' && (
        <button className="btn btn-quiet btn-block" onClick={() => onMove(t, 'towatch')} data-pressable>
          <Icon name="undo" size={15} /> Back to the list
        </button>
      )}
    </Sheet>
  )
}

/** Detail for a watched title — scores are read-only; re-rating is a ritual. */
function WatchedSheet({
  title: t,
  me,
  them,
  onClose,
  onSave,
  onRerate,
  onDelete,
}: {
  title: TitleRow | null
  me: Profile
  them: Profile
  onClose: () => void
  onSave: (patch: Partial<TitleRow> & { id: string }) => void
  onRerate: (t: TitleRow) => void
  onDelete: (t: TitleRow) => void
}) {
  const [note, setNote] = useState('')
  const [watchedDate, setWatchedDate] = useState('')

  useEffect(() => {
    if (!t) return
    setNote(t[notesKey(me.slug)] ?? '')
    setWatchedDate(t.watched_on ?? '')
  }, [t, me.slug])

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
                [notesKey(me.slug)]: note.trim() || null,
                watched_on: watchedDate || null,
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

      <ScorePair
        mine={t[scoreKey(me.slug)]}
        theirs={t[scoreKey(them.slug)]}
        myName={me.name}
        theirName={them.name}
      />

      <button className="btn btn-outline btn-block btn-sm" onClick={() => onRerate(t)} data-pressable>
        <Icon name="shuffle" size={14} /> Rate it again
      </button>

      <Field label="Watched on">
        <input type="date" value={watchedDate} onChange={(e) => setWatchedDate(e.target.value)} />
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
