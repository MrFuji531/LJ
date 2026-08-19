/**
 * TMDb lookup. The key resolves from, in order:
 *   1. a key pasted into Settings (validated before saving),
 *   2. a build-time VITE_TMDB_KEY,
 *   3. the shared key in lj_config — synced from the database on sign-in,
 *      so neither phone ever needs any setup.
 */

import { sb } from './supabase'

const LS_TMDB = 'lj.tmdb.key'
const LS_SHARED = 'lj.tmdb.shared'
const BASE = 'https://api.themoviedb.org/3'

export const IMG = (path: string | null | undefined, size: 'w185' | 'w342' | 'w780' = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null

export function tmdbKey() {
  return (
    localStorage.getItem(LS_TMDB) ||
    import.meta.env.VITE_TMDB_KEY ||
    localStorage.getItem(LS_SHARED) ||
    ''
  )
}

/** Pull the shared key out of the database once a session exists. */
export async function syncSharedKey() {
  const client = sb()
  if (!client) return
  try {
    const { data } = await client.from('lj_config').select('value').eq('key', 'tmdb').maybeSingle()
    if (data?.value) localStorage.setItem(LS_SHARED, data.value)
  } catch {
    /* offline — the next sign-in tries again */
  }
}

/** Push a (validated) key into the database so the other phone gets it too. */
export async function shareKey(key: string) {
  localStorage.setItem(LS_SHARED, key)
  await sb()?.from('lj_config').upsert({ key: 'tmdb', value: key })
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
function rawGet(path: string, params: Record<string, string>, key: string) {
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const headers: Record<string, string> = {}
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`
  else url.searchParams.set('api_key', key)
  return fetch(url.toString(), { headers })
}

async function get(path: string, params: Record<string, string> = {}) {
  const primary = tmdbKey()
  const res = await rawGet(path, params, primary)
  if (res.ok) return res.json()

  // Self-heal: a mistyped key saved in Settings must not shadow a working
  // built-in or shared one. Try the fallbacks; drop the bad key on success.
  if (res.status === 401 || res.status === 403) {
    const fallbacks = [
      import.meta.env.VITE_TMDB_KEY as string | undefined,
      localStorage.getItem(LS_SHARED),
    ].filter((k): k is string => Boolean(k) && k !== primary)
    for (const k of fallbacks) {
      const retry = await rawGet(path, params, k)
      if (retry.ok) {
        if (localStorage.getItem(LS_TMDB)) localStorage.removeItem(LS_TMDB)
        return retry.json()
      }
    }
  }
  throw new Error(`TMDb ${res.status}`)
}

/** Does this key actually work? Used by Settings before saving one. */
export async function checkKey(key: string): Promise<boolean> {
  try {
    const res = await rawGet('/configuration', {}, key.trim())
    return res.ok
  } catch {
    return false
  }
}

export const hasBuiltInKey = () => Boolean(import.meta.env.VITE_TMDB_KEY)

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
