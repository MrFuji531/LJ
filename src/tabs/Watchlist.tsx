import { useEffect, useMemo, useState } from 'react'
import './Watchlist.css'

import { useCollection } from '../lib/collection'
import type { Profile } from '../lib/session'
import * as tmdb from '../lib/tmdb'
import { Icon } from '../components/Icon'
import { EmptyState, Fab, Field, Sheet, useConfirm, useToast } from '../components/ui'

type WatchRow = {
  id: string
  kind: 'movie' | 'tv'
  tmdb_id: number | null
  title: string
  year: number | null
  poster_path: string | null
  overview: string | null
  genres: string[] | null
  release_date: string | null
  notes: string | null
  added_by: string | null
  done: boolean
  created_at?: string
  updated_at?: string
}

const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

/** Days until release. Negative means it's already out. */
function daysUntil(date: string | null) {
  if (!date) return null
  const d = new Date(date + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000)
}

function countdownLabel(days: number | null) {
  if (days == null) return null
  if (days > 1) return `${days} days`
  if (days === 1) return 'Tomorrow'
  if (days === 0) return 'Today'
  if (days > -30) return 'Out now'
  return null
}

export function WatchlistTab({ me }: { me: Profile }) {
  const { rows, upsert, remove } = useCollection<WatchRow>('lj_watchlist')
  const toast = useToast()
  const confirm = useConfirm()

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<WatchRow | null>(null)
  const [filter, setFilter] = useState<'all' | 'movie' | 'tv' | 'soon' | 'done'>('all')

  const list = useMemo(() => {
    const base = rows.filter((r) => (filter === 'done' ? r.done : !r.done))
    const filtered = base.filter((r) => {
      if (filter === 'movie' || filter === 'tv') return r.kind === filter
      if (filter === 'soon') {
        const d = daysUntil(r.release_date)
        return d != null && d >= 0
      }
      return true
    })
    return filtered.sort((a, b) => {
      const da = daysUntil(a.release_date)
      const db = daysUntil(b.release_date)
      const fa = da != null && da >= 0
      const fb = db != null && db >= 0
      // Upcoming first, soonest at the top; everything else by recency.
      if (fa && fb) return da! - db!
      if (fa) return -1
      if (fb) return 1
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
  }, [rows, filter])

  const upcoming = rows.filter((r) => !r.done && (daysUntil(r.release_date) ?? -999) >= 0).length

  return (
    <>
      {rows.length > 0 && (
        <div className="filters scroll-x">
          {(
            [
              ['all', 'To watch'],
              ['soon', `Coming${upcoming ? ` · ${upcoming}` : ''}`],
              ['movie', 'Films'],
              ['tv', 'Shows'],
              ['done', 'Watched'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`filter ${filter === id ? 'is-on' : ''}`} onClick={() => setFilter(id)} data-pressable>
              {label}
            </button>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon="🔖"
          title={rows.length ? 'Nothing here' : 'Nothing on the list'}
          hint={rows.length ? 'Try another filter.' : 'Add something you want to watch — new releases get a countdown.'}
          action={
            !rows.length && (
              <button className="btn btn-accent" onClick={() => setAdding(true)} data-pressable>
                Add something
              </button>
            )
          }
        />
      ) : (
        <div className="stack">
          {list.map((r) => {
            const days = daysUntil(r.release_date)
            const label = countdownLabel(days)
            const soon = days != null && days >= 0 && days <= 30
            return (
              <button key={r.id} className="wl-card card" onClick={() => setEditing(r)} data-pressable data-press-scale="subtle">
                <div className="poster wl-poster">
                  {tmdb.IMG(r.poster_path, 'w185') ? (
                    <img src={tmdb.IMG(r.poster_path, 'w185')!} alt="" loading="lazy" />
                  ) : (
                    <span className="poster-fallback">{r.title[0]}</span>
                  )}
                </div>
                <div className="grow wl-body">
                  <div className="wl-title">{r.title}</div>
                  <div className="wl-meta">
                    <span className="chip wl-kind">{r.kind === 'movie' ? 'Film' : 'Show'}</span>
                    {r.year && <span className="num">{r.year}</span>}
                  </div>
                  {r.notes && <div className="wl-note truncate">{r.notes}</div>}
                </div>
                {label && (
                  <div className={`wl-count ${soon ? 'is-soon' : ''} ${days! < 0 ? 'is-out' : ''}`}>
                    <span className="wl-count-value display">{days! > 1 ? days : label.split(' ')[0]}</span>
                    <span className="eyebrow">{days! > 1 ? 'days' : days === 0 ? 'today' : days === 1 ? '' : 'now'}</span>
                  </div>
                )}
                {r.done && <span className="wl-done"><Icon name="check" size={16} /></span>}
              </button>
            )
          })}
        </div>
      )}

      <Fab onClick={() => setAdding(true)} label="Add to watchlist" />

      <AddWatch
        open={adding}
        onClose={() => setAdding(false)}
        onPick={async (row) => {
          await upsert({ ...row, id: uid(), added_by: me.slug, done: false, created_at: new Date().toISOString() } as WatchRow)
          setAdding(false)
          toast('On the list', 'good')
        }}
      />

      {editing && (
        <EditWatch
          row={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await upsert(patch)
            setEditing(null)
            toast('Saved', 'good')
          }}
          onDelete={async (r) => {
            const ok = await confirm({ title: `Remove ${r.title}?`, confirmLabel: 'Remove', danger: true })
            if (!ok) return
            await remove(r.id)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function AddWatch({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (row: Partial<WatchRow>) => void
}) {
  const [kind, setKind] = useState<'movie' | 'tv'>('movie')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<tmdb.TmdbHit[]>([])
  const [manual, setManual] = useState(!tmdb.hasTmdb())
  const [mTitle, setMTitle] = useState('')
  const [mDate, setMDate] = useState('')

  useEffect(() => {
    if (!open) { setQ(''); setHits([]); setMTitle(''); setMDate(''); setManual(!tmdb.hasTmdb()) }
  }, [open])

  useEffect(() => {
    if (!q.trim() || manual) { setHits([]); return }
    const id = setTimeout(async () => {
      try { setHits(await tmdb.search(q, kind)) } catch { /* surfaced elsewhere */ }
    }, 320)
    return () => clearTimeout(id)
  }, [q, kind, manual])

  return (
    <Sheet open={open} onClose={onClose} title="Add to watchlist">
      <div className="seg">
        <button className={`seg-btn ${kind === 'movie' ? 'is-on' : ''}`} onClick={() => setKind('movie')} data-pressable>Film</button>
        <button className={`seg-btn ${kind === 'tv' ? 'is-on' : ''}`} onClick={() => setKind('tv')} data-pressable>Show</button>
      </div>

      {!manual ? (
        <>
          <div className="search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — old or upcoming…" autoFocus />
          </div>
          <div className="hits">
            {hits.map((h) => (
              <button
                key={h.tmdb_id}
                className="hit"
                onClick={() =>
                  onPick({
                    kind, tmdb_id: h.tmdb_id, title: h.title, year: h.year,
                    poster_path: h.poster_path, overview: h.overview, release_date: h.release_date,
                  })
                }
                data-pressable
              >
                <div className="poster hit-poster">
                  {tmdb.IMG(h.poster_path, 'w185') ? <img src={tmdb.IMG(h.poster_path, 'w185')!} alt="" loading="lazy" /> : <span className="poster-fallback">{h.title[0]}</span>}
                </div>
                <div className="grow">
                  <div className="hit-title">{h.title}</div>
                  <div className="hit-year num">{h.release_date ?? h.year ?? '—'}</div>
                </div>
              </button>
            ))}
          </div>
          <button className="btn btn-quiet btn-block" onClick={() => setManual(true)} data-pressable>Enter manually</button>
        </>
      ) : (
        <>
          <Field label="Title"><input value={mTitle} onChange={(e) => setMTitle(e.target.value)} autoFocus placeholder="Title" /></Field>
          <Field label="Release date" hint="Leave blank if it's already out."><input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} /></Field>
          <button
            className="btn btn-accent btn-block"
            disabled={!mTitle.trim()}
            onClick={() => onPick({ kind, title: mTitle.trim(), release_date: mDate || null })}
            data-pressable
          >
            Add it
          </button>
          {tmdb.hasTmdb() && <button className="btn btn-quiet btn-block" onClick={() => setManual(false)} data-pressable>Search instead</button>}
        </>
      )}
    </Sheet>
  )
}

function EditWatch({
  row,
  onClose,
  onSave,
  onDelete,
}: {
  row: WatchRow
  onClose: () => void
  onSave: (patch: Partial<WatchRow> & { id: string }) => void
  onDelete: (r: WatchRow) => void
}) {
  const [notes, setNotes] = useState(row.notes ?? '')
  const [date, setDate] = useState(row.release_date ?? '')
  const [done, setDone] = useState(row.done)

  return (
    <Sheet
      open
      onClose={onClose}
      title={row.title}
      footer={
        <>
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(row)} aria-label="Delete" data-pressable>
            <Icon name="trash" size={15} />
          </button>
          <button className="btn btn-accent" onClick={() => onSave({ id: row.id, notes: notes.trim() || null, release_date: date || null, done })} data-pressable>
            Save
          </button>
        </>
      }
    >
      {row.overview && <p className="edit-blurb selectable">{row.overview}</p>}
      <Field label="Release date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why it's on the list…" /></Field>
      <button className={`btn btn-block ${done ? 'btn-accent' : 'btn-quiet'}`} onClick={() => setDone((d) => !d)} data-pressable>
        <Icon name="check" size={16} /> {done ? 'Watched' : 'Mark as watched'}
      </button>
    </Sheet>
  )
}
