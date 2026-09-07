import type { TmdbDetail, TmdbEpisode, TmdbSeason } from './tmdb'

/* ==========================================================================
   Films, shows and seasons — the rows and the rules.

   A film is one row and one rating. A show is a container: one lj_seasons
   row per season, each with its own pile status and its own blind rating.
   Which pile the *show* sits in is derived from its seasons (see
   showStatus) rather than stored, so the two can never drift apart. The one
   show-level pile that is stored is 'dropped' — we're not finishing this.
   ========================================================================== */

export type PileStatus = 'towatch' | 'watching' | 'watched' | 'dropped'

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
  status: PileStatus | null
  score_james: number | null
  score_lee: number | null
  /** Blind scores waiting for the reveal. */
  pending_score_james: number | null
  pending_score_lee: number | null
  new_season: boolean | null
  seasons_checked_at: string | null
  /** TV: 'Returning Series', 'Ended', 'Canceled', … straight from TMDb. */
  tmdb_status: string | null
  next_episode: TmdbEpisode | null
  last_episode: TmdbEpisode | null
  notes_james: string | null
  notes_lee: string | null
  added_by: string | null
  created_at?: string
  updated_at?: string
}

export type SeasonStatus = 'towatch' | 'watching' | 'watched' | 'skipped'

export type SeasonRow = {
  id: string
  title_id: string
  season_number: number
  name: string | null
  air_date: string | null
  episode_count: number | null
  status: SeasonStatus
  episodes_seen: number | null
  score_james: number | null
  score_lee: number | null
  pending_score_james: number | null
  pending_score_lee: number | null
  watched_on: string | null
  notes_james: string | null
  notes_lee: string | null
  added_by: string | null
  created_at?: string
  updated_at?: string
}

/** What the rating ritual needs from a row — a film or a season. */
export type Ratable = {
  id: string
  score_james: number | null
  score_lee: number | null
  pending_score_james: number | null
  pending_score_lee: number | null
  watched_on: string | null
  notes_james: string | null
  notes_lee: string | null
}

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

/**
 * A season's id is carved from its show's uuid (last four hex digits = the
 * season number), so both phones sweeping TMDb at the same moment mint the
 * same row rather than two that collide on (title_id, season_number).
 */
export const seasonId = (titleId: string, n: number) =>
  titleId.slice(0, -4) + (n & 0xffff).toString(16).padStart(4, '0')

export const scoreKey = (slug: string): 'score_james' | 'score_lee' =>
  slug === 'james' ? 'score_james' : 'score_lee'

export const notesKey = (slug: string): 'notes_james' | 'notes_lee' =>
  slug === 'james' ? 'notes_james' : 'notes_lee'

export const pendingKey = (slug: string): 'pending_score_james' | 'pending_score_lee' =>
  slug === 'james' ? 'pending_score_james' : 'pending_score_lee'

export const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

export function avgOf(r: { score_james: number | null; score_lee: number | null }) {
  return mean([r.score_james, r.score_lee].filter((v): v is number => v != null))
}

export const bothPending = (r: Ratable) =>
  r.pending_score_james != null && r.pending_score_lee != null

/* ---- dates ---------------------------------------------------------------- */

export const today = () => new Date().toISOString().slice(0, 10)

export const hasAired = (iso: string | null | undefined) => Boolean(iso) && iso! <= today()

export const daysUntil = (iso: string) =>
  Math.round((new Date(iso + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime()) / 86400000)

export function fmtDay(iso: string | null | undefined) {
  if (!iso) return null
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "today", "tomorrow", "in 3 days", "12 Nov" — or "3 days ago". */
export function relDay(iso: string) {
  const d = daysUntil(iso)
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d === -1) return 'yesterday'
  if (d > 1 && d <= 14) return `in ${d} days`
  if (d < -1 && d >= -14) return `${-d} days ago`
  return fmtDay(iso)!
}

/* ---- seasons -------------------------------------------------------------- */

export const seasonsOf = (title: TitleRow, all: SeasonRow[]) =>
  all.filter((s) => s.title_id === title.id).sort((a, b) => a.season_number - b.season_number)

export const seasonLabel = (s: { season_number: number }) => `Season ${s.season_number}`

export const seriesEnded = (t: TitleRow) =>
  t.tmdb_status === 'Ended' || t.tmdb_status === 'Canceled'

/**
 * Which pile a show belongs in. Films and shows with no season rows (added
 * by hand, or the odd legacy row) fall back to their stored status.
 */
export function showStatus(t: TitleRow, seasons: SeasonRow[]): PileStatus {
  if (t.status === 'dropped') return 'dropped'
  if (t.kind !== 'tv' || !seasons.length) return t.status ?? 'watched'
  if (seasons.some((s) => s.status === 'watching')) return 'watching'
  if (seasons.some((s) => s.status === 'towatch' && hasAired(s.air_date))) return 'towatch'
  return 'watched'
}

/** The season we're on: the one being watched, else the next unseen one. */
export function currentSeason(seasons: SeasonRow[]) {
  return (
    seasons.find((s) => s.status === 'watching') ??
    seasons.find((s) => s.status === 'towatch' && hasAired(s.air_date)) ??
    null
  )
}

/** Nothing has been touched yet — the "where are you up to?" question applies. */
export const untouched = (seasons: SeasonRow[]) =>
  seasons.length > 1 && seasons.every((s) => s.status === 'towatch')

export type ShowScore = {
  james: number | null
  lee: number | null
  avg: number | null
  rated: number
  /** Seasons that have aired. */
  aired: number
  final: boolean
}

/** Plain mean across rated seasons, per person and combined. */
export function showScore(t: TitleRow, seasons: SeasonRow[]): ShowScore {
  if (t.kind !== 'tv' || !seasons.length) {
    return {
      james: t.score_james,
      lee: t.score_lee,
      avg: avgOf(t),
      rated: avgOf(t) != null ? 1 : 0,
      aired: 1,
      final: true,
    }
  }
  const rated = seasons.filter((s) => avgOf(s) != null)
  const aired = seasons.filter((s) => hasAired(s.air_date))
  return {
    james: mean(rated.map((s) => s.score_james).filter((v): v is number => v != null)),
    lee: mean(rated.map((s) => s.score_lee).filter((v): v is number => v != null)),
    avg: mean(rated.map((s) => avgOf(s)!)),
    rated: rated.length,
    aired: aired.length,
    final: seriesEnded(t) && rated.length > 0 && rated.length === aired.length,
  }
}

/** Latest aired episode of this season, if TMDb has told us about one. */
export function latestEpisode(t: TitleRow, s: SeasonRow): number | null {
  const last = t.last_episode
  if (!last || last.season !== s.season_number) return null
  if (!hasAired(last.air_date)) return null
  return last.episode
}

/** An episode has aired that we haven't ticked off. */
export function episodeOut(t: TitleRow, s: SeasonRow): number | null {
  if (s.status !== 'watching') return null
  const latest = latestEpisode(t, s)
  if (latest == null) return null
  return latest > (s.episodes_seen ?? 0) ? latest : null
}

/** Season finale has aired and we've seen it — time to rate. */
export function finaleSeen(t: TitleRow, s: SeasonRow) {
  if (s.status !== 'watching' || !s.episode_count) return false
  const seen = s.episodes_seen ?? 0
  if (seen < s.episode_count) return false
  // Still airing (TMDb's next episode is in this season) → not the finale yet.
  return !(t.next_episode && t.next_episode.season === s.season_number)
}

/** "Season 2 · ep 6 airs Thu" / "Season 3 · 12 Nov" — for the coming-up strip. */
export type Upcoming = {
  title: TitleRow
  season: number
  episode: number
  air_date: string
  /** First episode of a season we haven't seen any of. */
  premiere: boolean
}

export function upcomingFor(t: TitleRow, seasons: SeasonRow[]): Upcoming | null {
  const next = t.next_episode
  if (!next?.air_date || hasAired(next.air_date)) return null
  if (t.status === 'dropped') return null
  const s = seasons.find((x) => x.season_number === next.season)
  const premiere = next.episode === 1 || !s || s.status === 'towatch'
  return { title: t, season: next.season, episode: next.episode, air_date: next.air_date, premiere }
}

/* ---- TMDb → rows ----------------------------------------------------------- */

/** The show-level facts a TMDb refresh keeps current. */
export function titlePatchFrom(d: TmdbDetail): Partial<TitleRow> {
  return {
    seasons: d.seasons,
    episodes: d.episodes,
    tmdb_status: d.tmdb_status,
    next_episode: d.next_episode,
    last_episode: d.last_episode,
    seasons_checked_at: new Date().toISOString(),
  }
}

/**
 * Reconcile TMDb's season list with ours. Returns rows to upsert: brand-new
 * seasons (status 'towatch') and existing ones whose facts changed. Never
 * touches status or scores on a season we already have.
 */
export function reconcileSeasons(
  title: TitleRow,
  existing: SeasonRow[],
  list: TmdbSeason[],
  by: string | null,
): { upserts: SeasonRow[]; fresh: SeasonRow[] } {
  const upserts: SeasonRow[] = []
  const fresh: SeasonRow[] = []
  for (const s of list) {
    const have = existing.find((e) => e.season_number === s.season_number)
    if (!have) {
      const row: SeasonRow = {
        id: seasonId(title.id, s.season_number),
        title_id: title.id,
        season_number: s.season_number,
        name: s.name,
        air_date: s.air_date,
        episode_count: s.episode_count,
        status: 'towatch',
        episodes_seen: 0,
        score_james: null,
        score_lee: null,
        pending_score_james: null,
        pending_score_lee: null,
        watched_on: null,
        notes_james: null,
        notes_lee: null,
        added_by: by,
        created_at: new Date().toISOString(),
      }
      upserts.push(row)
      fresh.push(row)
    } else if (
      have.air_date !== s.air_date ||
      have.episode_count !== s.episode_count ||
      have.name !== s.name
    ) {
      upserts.push({ ...have, air_date: s.air_date, episode_count: s.episode_count, name: s.name })
    }
  }
  return { upserts, fresh }
}
