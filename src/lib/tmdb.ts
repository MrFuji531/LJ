/**
 * TMDb lookup. Optional — everything degrades to manual entry without a key.
 * Get one free at themoviedb.org → Settings → API. Paste it into LJ Settings.
 */

const LS_TMDB = 'lj.tmdb.key'
const BASE = 'https://api.themoviedb.org/3'

export const IMG = (path: string | null | undefined, size: 'w185' | 'w342' | 'w780' = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null

export function tmdbKey() {
  return localStorage.getItem(LS_TMDB) || import.meta.env.VITE_TMDB_KEY || ''
}

export function setTmdbKey(k: string) {
  if (k.trim()) localStorage.setItem(LS_TMDB, k.trim())
  else localStorage.removeItem(LS_TMDB)
}

export const hasTmdb = () => Boolean(tmdbKey())

export type TmdbHit = {
  tmdb_id: number
  kind: 'movie' | 'tv'
  title: string
  year: number | null
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  release_date: string | null
}

/** The key may be a v3 key (query param) or a v4 bearer token. Support both. */
function authFor(url: URL) {
  const key = tmdbKey()
  if (key.startsWith('eyJ')) return { headers: { Authorization: `Bearer ${key}` } }
  url.searchParams.set('api_key', key)
  return { headers: {} as Record<string, string> }
}

async function get(path: string, params: Record<string, string> = {}) {
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const { headers } = authFor(url)
  const res = await fetch(url.toString(), { headers })
  if (!res.ok) throw new Error(`TMDb ${res.status}`)
  return res.json()
}

export async function search(query: string, kind: 'movie' | 'tv'): Promise<TmdbHit[]> {
  if (!query.trim() || !hasTmdb()) return []
  const data = await get(`/search/${kind}`, { query, include_adult: 'false' })
  return (data.results ?? []).slice(0, 12).map((r: any): TmdbHit => {
    const date = kind === 'movie' ? r.release_date : r.first_air_date
    return {
      tmdb_id: r.id,
      kind,
      title: kind === 'movie' ? r.title : r.name,
      year: date ? Number(String(date).slice(0, 4)) : null,
      poster_path: r.poster_path ?? null,
      backdrop_path: r.backdrop_path ?? null,
      overview: r.overview ?? '',
      release_date: date || null,
    }
  })
}

export type TmdbDetail = TmdbHit & {
  genres: string[]
  runtime: number | null
  seasons: number | null
  episodes: number | null
  director: string | null
  cast_list: string[]
  language: string | null
  country: string | null
  vote_average: number | null
}

/** Full metadata for one title — this is what makes the analytics worth having. */
export async function detail(id: number, kind: 'movie' | 'tv'): Promise<TmdbDetail> {
  const d = await get(`/${kind}/${id}`, { append_to_response: 'credits' })
  const date = kind === 'movie' ? d.release_date : d.first_air_date
  const crew = d.credits?.crew ?? []
  const director =
    kind === 'movie'
      ? crew.find((c: any) => c.job === 'Director')?.name ?? null
      : (d.created_by ?? []).map((c: any) => c.name).join(', ') || null

  return {
    tmdb_id: d.id,
    kind,
    title: kind === 'movie' ? d.title : d.name,
    year: date ? Number(String(date).slice(0, 4)) : null,
    poster_path: d.poster_path ?? null,
    backdrop_path: d.backdrop_path ?? null,
    overview: d.overview ?? '',
    release_date: date || null,
    genres: (d.genres ?? []).map((g: any) => g.name),
    runtime: kind === 'movie' ? d.runtime ?? null : d.episode_run_time?.[0] ?? null,
    seasons: kind === 'tv' ? d.number_of_seasons ?? null : null,
    episodes: kind === 'tv' ? d.number_of_episodes ?? null : null,
    director,
    cast_list: (d.credits?.cast ?? []).slice(0, 8).map((c: any) => c.name),
    language: d.original_language ?? null,
    country: (d.production_countries ?? [])[0]?.iso_3166_1 ?? (d.origin_country ?? [])[0] ?? null,
    vote_average: d.vote_average ?? null,
  }
}

/** Upcoming releases, used to prefill watchlist dates. */
export async function upcoming(kind: 'movie' | 'tv'): Promise<TmdbHit[]> {
  if (!hasTmdb()) return []
  const path = kind === 'movie' ? '/movie/upcoming' : '/tv/on_the_air'
  const data = await get(path)
  return (data.results ?? []).slice(0, 20).map((r: any): TmdbHit => {
    const date = kind === 'movie' ? r.release_date : r.first_air_date
    return {
      tmdb_id: r.id,
      kind,
      title: kind === 'movie' ? r.title : r.name,
      year: date ? Number(String(date).slice(0, 4)) : null,
      poster_path: r.poster_path ?? null,
      backdrop_path: r.backdrop_path ?? null,
      overview: r.overview ?? '',
      release_date: date || null,
    }
  })
}
