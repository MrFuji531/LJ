import { useEffect, useMemo, useRef, useState } from 'react'
import './Titles.css'

import { useCollection } from '../lib/collection'
import { logEvent } from '../lib/events'
import { otherProfile, profileOf, type Profile } from '../lib/session'
import * as tmdb from '../lib/tmdb'
import {
  avgOf, bothPending, currentSeason, episodeOut, finaleSeen, hasAired, latestEpisode, mean,
  notesKey, pendingKey, reconcileSeasons, relDay, scoreKey, seasonLabel, seasonsOf, showScore,
  showStatus, titlePatchFrom, uid, untouched, upcomingFor,
  type PileStatus, type SeasonRow, type TitleRow, type Upcoming,
} from '../lib/titles'
import { Icon } from '../components/Icon'
import { RateReveal, type RateSubject } from '../components/RateReveal'
import {
  EmptyState, Fab, Field, ScorePair, Sheet, useConfirm, useToast,
} from '../components/ui'
import {
  NextSeasonSheet, SeasonSheet, ShowSheet, type CatchUpMode, type ShowView,
} from './ShowSheet'

export type { TitleRow } from '../lib/titles'

/* ==========================================================================
   Films & TV.

   Films: two piles — the list of things we mean to watch, and the scored
   history of things we have. The only road from one to the other is the
   blind-rating ritual in <RateReveal />.

   Shows: the same ritual, but per season. A show is a container for its
   seasons; which pile it sits in follows from them (lib/titles.ts), plus a
   fourth pile, Dropped, for the ones we're not finishing. TMDb is asked
   once a day whether a tracked show has grown a season or an episode.
   ========================================================================== */

const dayOld = (iso: string | null) =>
  !iso || Date.now() - new Date(iso).getTime() > 24 * 60 * 60 * 1000

type ListView = PileStatus
type Sort = 'recent' | 'best' | 'worst' | 'az' | 'gap'
type RateRef = { table: 'lj_titles' | 'lj_seasons'; id: string }

/** Most recent season finished — what "Recent" sorts a show by. */
const lastWatched = (v: ShowView) =>
  v.seasons.length
    ? v.seasons.map((s) => s.watched_on ?? '').sort().at(-1) || v.t.created_at || ''
    : v.t.watched_on ?? v.t.created_at ?? ''

/** Last time anything about the show changed — a season tick counts. */
const lastTouched = (v: ShowView) =>
  [v.t.updated_at ?? '', ...v.seasons.map((s) => s.updated_at ?? '')].sort().at(-1) ?? ''

export function TitlesTab({ kind, me }: { kind: 'movie' | 'tv'; me: Profile }) {
  const { rows, status: titleStatus, upsert, remove } = useCollection<TitleRow>('lj_titles')
  const {
    rows: seasonRows,
    status: seasonStatus,
    upsert: upsertSeason,
    remove: removeSeason,
  } = useCollection<SeasonRow>('lj_seasons')
  const toast = useToast()
  const confirm = useConfirm()

  const [view, setView] = useState<ListView>('towatch')
  const [adding, setAdding] = useState(false)
  const [detail, setDetail] = useState<TitleRow | null>(null)
  const [watchedOpen, setWatchedOpen] = useState<TitleRow | null>(null)
  const [showOpen, setShowOpen] = useState<string | null>(null)
  const [seasonOpen, setSeasonOpen] = useState<string | null>(null)
  const [nextPrompt, setNextPrompt] = useState<{ titleId: string; seasonId: string } | null>(null)
  const [rate, setRate] = useState<RateRef | null>(null)
  const [justRated, setJustRated] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [showStats, setShowStats] = useState(false)

  const them = otherProfile(me.slug)
  const noun = kind === 'movie' ? 'film' : 'show'

  const mine = useMemo(() => rows.filter((r) => r.kind === kind), [rows, kind])

  const shows = useMemo<ShowView[]>(
    () =>
      mine.map((t) => {
        const seasons = kind === 'tv' ? seasonsOf(t, seasonRows) : []
        return { t, seasons, status: showStatus(t, seasons), score: showScore(t, seasons) }
      }),
    [mine, seasonRows, kind],
  )

  const towatch = useMemo(
    () =>
      shows
        .filter((v) => v.status === 'towatch')
        .sort((a, b) => (b.t.created_at ?? '').localeCompare(a.t.created_at ?? '')),
    [shows],
  )
  const watching = useMemo(
    () =>
      shows
        .filter((v) => v.status === 'watching')
        .sort((a, b) => lastTouched(b).localeCompare(lastTouched(a))),
    [shows],
  )
  const watched = useMemo(() => shows.filter((v) => v.status === 'watched'), [shows])
  const dropped = useMemo(
    () =>
      shows
        .filter((v) => v.status === 'dropped')
        .sort((a, b) => lastTouched(b).localeCompare(lastTouched(a))),
    [shows],
  )

  const upcoming = useMemo<Upcoming[]>(
    () =>
      kind === 'tv'
        ? shows
            .map((v) => upcomingFor(v.t, v.seasons))
            .filter((u): u is Upcoming => u != null)
            .sort((a, b) => a.air_date.localeCompare(b.air_date))
            .slice(0, 6)
        : [],
    [shows, kind],
  )

  /* --- the live rating subject ------------------------------------------ */

  // The overlay reads the LIVE row, so the other phone's submit lands mid-flow.
  const rateSubject = useMemo<RateSubject | null>(() => {
    if (!rate) return null
    if (rate.table === 'lj_titles') {
      const t = mine.find((r) => r.id === rate.id)
      if (!t) return null
      return {
        table: 'lj_titles',
        row: t,
        title: t.title,
        poster_path: t.poster_path,
        room: kind === 'movie' ? 'movies' : 'shows',
        eventKind: 'watched',
        eventLabel: t.title,
        finalPatch: { status: 'watched', new_season: false },
      }
    }
    const s = seasonRows.find((r) => r.id === rate.id)
    const t = s && mine.find((r) => r.id === s.title_id)
    if (!s || !t) return null
    return {
      table: 'lj_seasons',
      row: s,
      title: t.title,
      subtitle: seasonLabel(s),
      poster_path: t.poster_path,
      room: 'shows',
      eventKind: 'season',
      eventLabel: `${t.title} — ${seasonLabel(s)}`,
      finalPatch: { status: 'watched' },
    }
  }, [rate, mine, seasonRows, kind])

  // If the pair completed on the other phone, the countdown starts here too.
  useEffect(() => {
    if (rate) return
    const hot = mine.find(bothPending)
    if (hot) {
      setRate({ table: 'lj_titles', id: hot.id })
      return
    }
    if (kind === 'tv') {
      const s = seasonRows.find((r) => bothPending(r) && mine.some((t) => t.id === r.title_id))
      if (s) setRate({ table: 'lj_seasons', id: s.id })
    }
  }, [mine, seasonRows, rate, kind])

  useEffect(() => {
    if (!justRated) return
    const t = setTimeout(() => setJustRated(null), 3200)
    return () => clearTimeout(t)
  }, [justRated])

  /* --- the daily TMDb sweep --------------------------------------------- */

  /* For every tracked show, ask TMDb (at most once a day per show, ten per
     visit, the ones we're watching first) whether it has grown a season or
     aired an episode. Shows that predate seasons get their season rows
     backfilled on the first pass. */
  const swept = useRef(false)
  useEffect(() => {
    if (kind !== 'tv' || swept.current || !tmdb.hasTmdb() || !navigator.onLine) return
    // Only once both tables have come back from the server — sweeping against
    // the cache alone would re-create seasons the other phone already added.
    if (titleStatus !== 'live' || seasonStatus !== 'live' || !mine.length) return
    swept.current = true
    const rank: Record<PileStatus, number> = { watching: 0, towatch: 1, watched: 2, dropped: 3 }
    const stale = shows
      .filter((v) => v.t.tmdb_id && v.status !== 'dropped')
      .filter((v) =>
        v.seasons.length === 0
          ? avgOf(v.t) == null // never backfill a legacy show that carries its own score
          : dayOld(v.t.seasons_checked_at),
      )
      .sort((a, b) => rank[a.status] - rank[b.status])
      .slice(0, 10)
    void (async () => {
      for (const v of stale) {
        try {
          const d = await tmdb.detail(v.t.tmdb_id!, 'tv')
          const { upserts, fresh } = reconcileSeasons(v.t, v.seasons, d.season_list, me.slug)
          const backfill = v.seasons.length === 0 && fresh.length > 0
          if (backfill && v.t.status === 'watching') {
            const first = fresh.find((s) => hasAired(s.air_date))
            if (first) first.status = 'watching'
          }
          const freshAired = fresh.filter((s) => hasAired(s.air_date))
          const announce = !backfill && freshAired.length > 0 && v.status === 'watched'
          for (const s of upserts) await upsertSeason(s)
          await upsert({
            id: v.t.id,
            ...titlePatchFrom(d),
            ...(announce ? { new_season: true } : {}),
          })
          if (announce) {
            toast(`${seasonLabel(freshAired[0])} of ${v.t.title} is out — back on the list`, 'good')
          }
        } catch {
          /* offline or rate-limited — try again another day */
        }
      }
    })()
  }, [kind, mine, shows, titleStatus, seasonStatus, upsert, upsertSeason, toast, me.slug])

  /* --- watched pile: search, sort, stats ------------------------------- */

  const watchedList = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? watched.filter(
          ({ t }) =>
            t.title.toLowerCase().includes(needle) ||
            (t.director ?? '').toLowerCase().includes(needle) ||
            (t.genres ?? []).some((g) => g.toLowerCase().includes(needle)),
        )
      : watched

    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sort === 'az') return a.t.title.localeCompare(b.t.title)
      if (sort === 'best') return (b.score.avg ?? -1) - (a.score.avg ?? -1)
      if (sort === 'worst') return (a.score.avg ?? 99) - (b.score.avg ?? 99)
      if (sort === 'gap') {
        const g = (v: ShowView) =>
          v.score.james != null && v.score.lee != null ? Math.abs(v.score.james - v.score.lee) : -1
        return g(b) - g(a)
      }
      return lastWatched(b).localeCompare(lastWatched(a))
    })
    return sorted
  }, [watched, q, sort])

  const stats = useMemo(() => {
    const rated = watched.filter((v) => v.score.avg != null)
    const genres = new Map<string, { n: number; sum: number }>()
    for (const v of rated) {
      const a = v.score.avg!
      for (const g of v.t.genres ?? []) {
        const cur = genres.get(g) ?? { n: 0, sum: 0 }
        genres.set(g, { n: cur.n + 1, sum: cur.sum + a })
      }
    }
    const topGenres = [...genres.entries()]
      .filter(([, v]) => v.n >= 2)
      .map(([g, v]) => ({ genre: g, n: v.n, avg: v.sum / v.n }))
      .sort((a, b) => b.avg - a.avg)

    const js = rated.map((v) => v.score.james).filter((v): v is number => v != null)
    const ls = rated.map((v) => v.score.lee).filter((v): v is number => v != null)
    const both = rated.filter((v) => v.score.james != null && v.score.lee != null)
    const biggestGap = [...both].sort(
      (a, b) =>
        Math.abs(b.score.james! - b.score.lee!) - Math.abs(a.score.james! - a.score.lee!),
    )[0]

    // Time in front of the telly: films by runtime; shows by the episodes of
    // the seasons we actually finished.
    const totalRuntime = watched.reduce((acc, v) => {
      const per = v.t.runtime ?? 0
      if (!v.seasons.length) return acc + per * (v.t.episodes ?? 1)
      const eps = v.seasons
        .filter((s) => s.status === 'watched')
        .reduce((n, s) => n + (s.episode_count ?? 0), 0)
      return acc + per * eps
    }, 0)

    return {
      rated: rated.length,
      jamesAvg: mean(js),
      leeAvg: mean(ls),
      overall: mean(rated.map((v) => v.score.avg!)),
      topGenres,
      biggestGap,
      agreement: both.length
        ? mean(both.map((v) => Math.abs(v.score.james! - v.score.lee!)))
        : null,
      totalRuntime,
    }
  }, [watched])

  /* --- shared actions --------------------------------------------------- */

  const closeAll = () => {
    setDetail(null)
    setWatchedOpen(null)
    setShowOpen(null)
    setSeasonOpen(null)
    setNextPrompt(null)
  }

  const startRating = (t: TitleRow) => {
    closeAll()
    setRate({ table: 'lj_titles', id: t.id })
  }

  const rateSeason = (_show: ShowView, s: SeasonRow) => {
    closeAll()
    setRate({ table: 'lj_seasons', id: s.id })
  }

  const moveTo = async (t: TitleRow, status: 'towatch' | 'watching') => {
    await upsert({ id: t.id, status, new_season: false })
    setDetail(null)
    toast(status === 'watching' ? `Watching ${t.title}` : 'Back on the list', 'good')
  }

  const clearNew = (t: TitleRow) => {
    if (t.new_season) void upsert({ id: t.id, new_season: false })
  }

  const setSeasonStatus = async (show: ShowView, s: SeasonRow, status: SeasonRow['status']) => {
    await upsertSeason({ id: s.id, status })
    clearNew(show.t)
    if (status === 'watching') toast(`Watching ${show.t.title} — ${seasonLabel(s).toLowerCase()}`, 'good')
    else if (status === 'skipped') toast(`${seasonLabel(s)} skipped`)
    else if (status === 'towatch') toast('Back on the list')
  }

  /** The card's "Start" button: straight in, or the where-are-you-up-to ask. */
  const startShow = (show: ShowView) => {
    const aired = show.seasons.filter((s) => hasAired(s.air_date))
    if (untouched(show.seasons) && aired.length > 1) {
      setShowOpen(show.t.id)
      return
    }
    const cur = currentSeason(show.seasons)
    if (cur) void setSeasonStatus(show, cur, 'watching')
    else setShowOpen(show.t.id)
  }

  const catchUp = async (show: ShowView, mode: CatchUpMode, upTo: number) => {
    const aired = show.seasons.filter((s) => hasAired(s.air_date))
    if (mode === 'fresh') {
      const first = aired[0]
      if (first) await setSeasonStatus(show, first, 'watching')
      setShowOpen(null)
      return
    }
    const seen = show.seasons.filter((s) => s.season_number <= upTo)
    for (const s of seen) {
      await upsertSeason({ id: s.id, status: mode === 'skip' ? 'skipped' : 'watched' })
    }
    clearNew(show.t)
    if (mode === 'skip') {
      toast(`Seasons up to ${upTo} won't count`)
      setShowOpen(null)
    } else {
      toast('Rate them from the seasons list whenever you like', 'good')
    }
  }

  const seenEpisode = async (show: ShowView, s: SeasonRow) => {
    const latest = latestEpisode(show.t, s)
    if (latest == null) return
    await upsertSeason({ id: s.id, episodes_seen: latest })
    toast(`Episode ${latest} ticked off`, 'good')
  }

  const dropShow = async (show: ShowView) => {
    for (const s of show.seasons) {
      if (s.status === 'watching') await upsertSeason({ id: s.id, status: 'towatch' })
    }
    await upsert({ id: show.t.id, status: 'dropped', new_season: false })
    closeAll()
    toast(`${show.t.title} — not finishing it`)
  }

  const reviveShow = async (show: ShowView) => {
    await upsert({ id: show.t.id, status: 'towatch' })
    closeAll()
    setView('towatch')
    toast(`${show.t.title} — back on the list`, 'good')
  }

  const del = async (t: TitleRow) => {
    const ok = await confirm({
      title: `Delete ${t.title}?`,
      body: 'Scores and metadata go with it.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    // The server cascades; the local cache needs telling.
    for (const s of seasonsOf(t, seasonRows)) await removeSeason(s.id)
    await remove(t.id)
    closeAll()
    toast('Deleted')
  }

  /** A season's reveal has played. Next season already out? Ask. */
  const afterRating = (subject: RateSubject) => {
    setRate(null)
    setJustRated(subject.row.id)
    if (subject.table === 'lj_titles') {
      setView('watched')
      return
    }
    const s = subject.row as SeasonRow
    const seasons = seasonRows.filter((r) => r.title_id === s.title_id)
    const next = seasons
      .filter((n) => n.season_number > s.season_number && n.status === 'towatch' && hasAired(n.air_date))
      .sort((a, b) => a.season_number - b.season_number)[0]
    if (next) setNextPrompt({ titleId: s.title_id, seasonId: next.id })
    else setView('watched')
  }

  /* --- sheets read live rows ------------------------------------------- */

  const openShow = showOpen ? shows.find((v) => v.t.id === showOpen) ?? null : null
  const openSeason = seasonOpen ? seasonRows.find((s) => s.id === seasonOpen) ?? null : null
  const openSeasonShow = openSeason ? shows.find((v) => v.t.id === openSeason.title_id) ?? null : null
  const promptShow = nextPrompt ? shows.find((v) => v.t.id === nextPrompt.titleId) ?? null : null
  const promptSeason = nextPrompt ? seasonRows.find((s) => s.id === nextPrompt.seasonId) ?? null : null

  /** Which sheet a tapped card opens: the show sheet, or the film ones. */
  const open = (v: ShowView) => {
    if (kind === 'tv' && v.seasons.length) setShowOpen(v.t.id)
    else if (v.status === 'watched') setWatchedOpen(v.t)
    else setDetail(v.t)
  }

  /* --- render ----------------------------------------------------------- */

  const count = (n: number) => (n ? ` · ${n}` : '')
  const views: [ListView, string][] =
    kind === 'tv'
      ? [
          ['towatch', `To watch${count(towatch.length)}`],
          ['watching', `Watching${count(watching.length)}`],
          ['watched', `Watched${count(watched.length)}`],
          ['dropped', `Dropped${count(dropped.length)}`],
        ]
      : [
          ['towatch', `To watch${count(towatch.length)}`],
          ['watched', `Watched${count(watched.length)}`],
        ]

  const activeList =
    view === 'towatch' ? towatch : view === 'watching' ? watching : view === 'dropped' ? dropped : watchedList

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

      {view === 'towatch' && upcoming.length > 0 && (
        <div className="card coming">
          <span className="eyebrow">Coming up</span>
          {upcoming.map((u) => (
            <button
              key={`${u.title.id}:${u.season}:${u.episode}`}
              className="coming-row"
              onClick={() => open(shows.find((v) => v.t.id === u.title.id)!)}
              data-pressable
              data-press-scale="subtle"
            >
              <span className="coming-title truncate">{u.title.title}</span>
              <span className="coming-what">
                {u.premiere ? `Season ${u.season}` : `S${u.season} ep ${u.episode}`}
              </span>
              <span className="coming-when num">{relDay(u.air_date)}</span>
            </button>
          ))}
        </div>
      )}

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
                : view === 'dropped'
                  ? 'Nothing dropped'
                  : q
                    ? 'Nothing matches'
                    : `No ${kind === 'movie' ? 'films' : 'shows'} watched yet`
          }
          hint={
            view === 'towatch'
              ? `Add the ${kind === 'movie' ? 'films' : 'shows'} you two mean to get through.`
              : view === 'watching'
                ? 'When you start a season, move it here.'
                : view === 'dropped'
                  ? "Shows you're not finishing linger here instead of clogging the list."
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
            ? watchedList.map((v) => (
                <TitleCard
                  key={v.t.id}
                  show={v}
                  stamped={justRated === v.t.id || v.seasons.some((s) => s.id === justRated)}
                  onOpen={() => open(v)}
                />
              ))
            : activeList.map((v) => (
                <QueueCard
                  key={v.t.id}
                  show={v}
                  me={me}
                  view={view}
                  onOpen={() => open(v)}
                  onStart={() => startShow(v)}
                  onRate={() => {
                    if (kind === 'tv' && v.seasons.length) {
                      const cur = currentSeason(v.seasons)
                      if (cur) rateSeason(v, cur)
                      else setShowOpen(v.t.id)
                    } else startRating(v.t)
                  }}
                  onSeen={() => {
                    const cur = currentSeason(v.seasons)
                    if (cur) void seenEpisode(v, cur)
                  }}
                  onRevive={() => reviveShow(v)}
                />
              ))}
        </div>
      )}

      <Fab onClick={() => setAdding(true)} label={`Add ${noun}`} />

      <AddSheet
        open={adding}
        kind={kind}
        onClose={() => setAdding(false)}
        onPick={async (row, seasonList) => {
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
          let aired = 0
          if (kind === 'tv' && seasonList?.length) {
            const { upserts } = reconcileSeasons(created, [], seasonList, me.slug)
            for (const s of upserts) await upsertSeason(s)
            aired = upserts.filter((s) => hasAired(s.air_date)).length
          }
          setAdding(false)
          setView('towatch')
          toast(`${created.title} — on the list`, 'good')
          // More than one season out already? Ask where they're up to.
          if (aired > 1) setShowOpen(created.id)
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
          // Editing the date re-logs the same event, so the ledger follows.
          const t = watchedOpen
          if (t && patch.watched_on) {
            logEvent({
              room: kind === 'movie' ? 'movies' : 'shows',
              kind: 'watched',
              refId: t.id,
              label: t.title,
              happenedOn: patch.watched_on,
              meta: { score_james: t.score_james, score_lee: t.score_lee },
              by: me.slug,
            })
          }
          setWatchedOpen(null)
          toast('Saved', 'good')
        }}
        onRerate={startRating}
        onDelete={del}
      />

      <ShowSheet
        show={openShow}
        me={me}
        them={them}
        onClose={() => setShowOpen(null)}
        onCatchUp={catchUp}
        onSeasonStatus={setSeasonStatus}
        onRate={rateSeason}
        onSeenEpisode={seenEpisode}
        onOpenSeason={(_show, s) => setSeasonOpen(s.id)}
        onDrop={dropShow}
        onRevive={reviveShow}
        onDelete={del}
      />

      <SeasonSheet
        show={openSeasonShow}
        season={openSeason}
        me={me}
        them={them}
        onClose={() => setSeasonOpen(null)}
        onSave={async (patch) => {
          await upsertSeason(patch)
          const s = openSeason
          const t = openSeasonShow?.t
          if (s && t && patch.watched_on) {
            logEvent({
              room: 'shows',
              kind: 'season',
              refId: s.id,
              label: `${t.title} — ${seasonLabel(s)}`,
              happenedOn: patch.watched_on,
              meta: { score_james: s.score_james, score_lee: s.score_lee },
              by: me.slug,
            })
          }
          setSeasonOpen(null)
          toast('Saved', 'good')
        }}
        onRerate={rateSeason}
      />

      <NextSeasonSheet
        show={promptShow}
        next={promptSeason}
        onClose={() => {
          // Dismissed without choosing: the next season is still on the list.
          setNextPrompt(null)
          setView('towatch')
        }}
        onStart={() => {
          if (promptShow && promptSeason) void setSeasonStatus(promptShow, promptSeason, 'watching')
          setNextPrompt(null)
          setView('watching')
        }}
        onList={() => {
          setNextPrompt(null)
          setView('towatch')
          toast('On the list for later')
        }}
        onDrop={() => {
          if (promptShow) void dropShow(promptShow)
          setView('dropped')
        }}
      />

      {rateSubject && (
        <RateReveal
          subject={rateSubject}
          me={me}
          onClose={() => setRate(null)}
          onDone={afterRating}
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
              <strong>{stats.biggestGap.t.title}</strong> — James {stats.biggestGap.score.james?.toFixed(1)}, Lee{' '}
              {stats.biggestGap.score.lee?.toFixed(1)}
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
  show: v,
  stamped,
  onOpen,
}: {
  show: ShowView
  stamped: boolean
  onOpen: () => void
}) {
  const { t, seasons, score } = v
  const poster = tmdb.IMG(t.poster_path, 'w185')
  const ratedSeasons = seasons.filter((s) => s.status === 'watched' && avgOf(s) != null)
  const toRate = seasons.filter((s) => s.status === 'watched' && avgOf(s) == null).length

  return (
    <button className="title-card card" onClick={onOpen} data-pressable data-press-scale="subtle">
      <div className="poster title-poster">
        {poster ? <img src={poster} alt="" loading="lazy" /> : <span className="poster-fallback">{t.title[0]}</span>}
      </div>

      <div className="title-body">
        <div className="title-name">{t.title}</div>
        <div className="title-meta">
          {t.year && <span className="num">{t.year}</span>}
          {t.runtime && !seasons.length ? <span>· {t.runtime}m</span> : null}
          {seasons.length ? (
            <span>· {score.aired} season{score.aired === 1 ? '' : 's'}</span>
          ) : t.seasons ? (
            <span>· {t.seasons} season{t.seasons === 1 ? '' : 's'}</span>
          ) : null}
        </div>
        {ratedSeasons.length > 0 && (
          <div className="season-pills">
            {ratedSeasons.map((s) => (
              <span key={s.id} className="season-pill num">
                S{s.season_number} <strong>{avgOf(s)!.toFixed(1)}</strong>
              </span>
            ))}
            {toRate > 0 && <span className="chip chip-new">{toRate} to rate</span>}
          </div>
        )}
        {seasons.length > 0 && ratedSeasons.length === 0 && (
          <div className="queue-chips">
            {toRate > 0 ? (
              <span className="chip chip-new">{toRate} to rate</span>
            ) : (
              <span className="chip chip-wait">Seen before</span>
            )}
          </div>
        )}
        <div className={`title-scores ${stamped ? 'is-stamped' : ''}`}>
          <span className="num" style={{ color: 'var(--rose)' }}>{score.james?.toFixed(1) ?? '—'}</span>
          <span className="title-scores-sep">/</span>
          <span className="num" style={{ color: 'var(--gold)' }}>{score.lee?.toFixed(1) ?? '—'}</span>
          <span className="title-scores-outof eyebrow">of 5</span>
        </div>
      </div>

      <div className={`title-avg ${stamped ? 'is-stamped' : ''}`}>
        <span className="title-avg-value display">{score.avg?.toFixed(1) ?? '—'}</span>
        {seasons.length > 0 && score.rated > 0 && (
          <span className="title-avg-sub eyebrow">
            {score.final ? 'final' : `${score.rated} of ${score.aired}`}
          </span>
        )}
      </div>
    </button>
  )
}

function QueueCard({
  show: v,
  me,
  view,
  onOpen,
  onStart,
  onRate,
  onSeen,
  onRevive,
}: {
  show: ShowView
  me: Profile
  view: ListView
  onOpen: () => void
  onStart: () => void
  onRate: () => void
  onSeen: () => void
  onRevive: () => void
}) {
  const { t, seasons } = v
  const poster = tmdb.IMG(t.poster_path, 'w185')
  const who = profileOf(t.added_by)
  const them = otherProfile(me.slug)

  const cur = seasons.length ? currentSeason(seasons) : null
  // Pendings live on the season being rated, or on the film itself.
  const pendingOn = cur ?? t
  const myPending = pendingOn[pendingKey(me.slug)] != null
  const theirPending = pendingOn[pendingKey(them.slug)] != null

  const aired = seasons.filter((s) => hasAired(s.air_date)).length
  const ask = view === 'towatch' && untouched(seasons) && aired > 1
  const epOut = cur ? episodeOut(t, cur) : null
  const finale = cur ? finaleSeen(t, cur) : false
  const toRate = seasons.filter((s) => s.status === 'watched' && avgOf(s) == null).length
  const done = seasons.filter((s) => s.status === 'watched' || s.status === 'skipped').length

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
            {seasons.length ? (
              <span>· {aired} season{aired === 1 ? '' : 's'}</span>
            ) : t.seasons ? (
              <span>· {t.seasons} season{t.seasons === 1 ? '' : 's'}</span>
            ) : null}
            {who && <span style={{ color: who.accent }}>· {who.name}</span>}
          </div>
          <div className="queue-chips">
            {view === 'dropped' && (
              <span className="chip chip-wait">Dropped{done ? ` after ${done} season${done === 1 ? '' : 's'}` : ''}</span>
            )}
            {t.new_season && view === 'towatch' && cur && (
              <span className="chip chip-new">{seasonLabel(cur)} out now</span>
            )}
            {t.new_season && view === 'towatch' && !cur && <span className="chip chip-new">New season</span>}
            {ask && !t.new_season && <span className="chip">Where are you up to?</span>}
            {view === 'watching' && cur && <span className="chip">{seasonLabel(cur)}</span>}
            {view === 'watching' && epOut != null && <span className="chip chip-new">Ep {epOut} out</span>}
            {view === 'watching' && finale && <span className="chip chip-new">Finale seen</span>}
            {toRate > 0 && <span className="chip chip-turn">{toRate} to rate</span>}
            {theirPending && !myPending && (
              <span className="chip chip-turn">{them.name} locked in — your turn</span>
            )}
            {myPending && !theirPending && <span className="chip chip-wait">Waiting on {them.name}</span>}
          </div>
        </div>
      </button>
      <div className="queue-side">
        {view === 'dropped' ? (
          <button className="btn btn-outline btn-sm queue-rate" onClick={onRevive} data-pressable>
            Another go
          </button>
        ) : view === 'watching' ? (
          <>
            {epOut != null && (
              <button className="btn btn-quiet btn-sm queue-rate" onClick={onSeen} data-pressable>
                <Icon name="check" size={14} /> Seen ep {epOut}
              </button>
            )}
            <button className={`btn btn-sm queue-rate ${finale ? 'btn-accent' : 'btn-outline'}`} onClick={onRate} data-pressable>
              {cur ? `Finished S${cur.season_number}` : 'Finished'}
            </button>
          </>
        ) : seasons.length ? (
          <button className="btn btn-outline btn-sm queue-rate" onClick={onStart} data-pressable>
            <Icon name="play" size={14} /> {cur && !ask ? `Start S${cur.season_number}` : 'Start'}
          </button>
        ) : (
          <button className="btn btn-outline btn-sm queue-rate" onClick={onRate} data-pressable>
            Watched it
          </button>
        )}
      </div>
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
  onPick: (row: Partial<TitleRow>, seasonList?: tmdb.TmdbSeason[]) => void
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
      onPick(
        {
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
          tmdb_status: d.tmdb_status,
          next_episode: d.next_episode,
          last_episode: d.last_episode,
        },
        d.season_list,
      )
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

/** Detail for a queued film (or a show with no season rows) — the launchpad into the rating ritual. */
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
  const st = t.status ?? 'watched'

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

/** Detail for a watched film — scores are read-only; re-rating is a ritual. */
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
