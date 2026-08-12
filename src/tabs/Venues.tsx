import { useEffect, useMemo, useState } from 'react'
import './Venues.css'

import { useCollection } from '../lib/collection'
import { otherProfile, type Profile } from '../lib/session'
import { Icon } from '../components/Icon'
import {
  EmptyState, Fab, Field, RatingBar, ScorePair, Sheet, useConfirm, useToast,
} from '../components/ui'

/* Nachos and salad sandwiches are the same game with a different subject, so
   they share one component and differ only in copy. */

type VenueRow = {
  id: string
  kind: 'nachos' | 'salad'
  name: string
  suburb: string | null
  address: string | null
  url: string | null
  price: number | null
  notes: string | null
  visited: boolean
  visited_on: string | null
  score_james: number | null
  score_lee: number | null
  notes_james: string | null
  notes_lee: string | null
  added_by: string | null
  created_at?: string
  updated_at?: string
}

const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)
const sKey = (slug: string): 'score_james' | 'score_lee' =>
  slug === 'james' ? 'score_james' : 'score_lee'

const nKey = (slug: string): 'notes_james' | 'notes_lee' =>
  slug === 'james' ? 'notes_james' : 'notes_lee'

function avgOf(v: VenueRow) {
  const xs = [v.score_james, v.score_lee].filter((x): x is number => x != null)
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

const COPY = {
  nachos: { one: 'nachos', title: 'Nachos', icon: '🌮', place: 'Where the nachos are' },
  salad: { one: 'salad sanga', title: 'Salad Sangas', icon: '🥪', place: 'Where the sanga is' },
} as const

export function VenuesTab({ kind, me }: { kind: 'nachos' | 'salad'; me: Profile }) {
  const { rows, upsert, remove } = useCollection<VenueRow>('lj_venues')
  const toast = useToast()
  const confirm = useConfirm()
  const them = otherProfile(me.slug)
  const copy = COPY[kind]

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<VenueRow | null>(null)
  const [filter, setFilter] = useState<'all' | 'todo' | 'ranked'>('all')

  const mine = useMemo(() => rows.filter((r) => r.kind === kind), [rows, kind])

  const list = useMemo(() => {
    const f = mine.filter((v) => {
      if (filter === 'todo') return !v.visited
      if (filter === 'ranked') return avgOf(v) != null
      return true
    })
    return f.sort((a, b) => {
      const av = avgOf(a)
      const bv = avgOf(b)
      if (av != null && bv != null) return bv - av
      if (av != null) return -1
      if (bv != null) return 1
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
  }, [mine, filter])

  const rated = mine.filter((v) => avgOf(v) != null)
  const best = rated.length ? [...rated].sort((a, b) => avgOf(b)! - avgOf(a)!)[0] : null
  const overall = rated.length ? rated.reduce((a, v) => a + avgOf(v)!, 0) / rated.length : null

  return (
    <>
      {mine.length > 0 && (
        <div className="stat-strip">
          <div className="stat-cell">
            <div className="stat-cell-value" style={{ color: 'var(--accent)' }}>{rated.length}</div>
            <div className="eyebrow">Eaten</div>
          </div>
          <div className="stat-cell">
            <div className="stat-cell-value">{mine.length - rated.length}</div>
            <div className="eyebrow">To try</div>
          </div>
          <div className="stat-cell">
            <div className="stat-cell-value">{overall?.toFixed(1) ?? '—'}</div>
            <div className="eyebrow">Avg</div>
          </div>
        </div>
      )}

      {best && (
        <div className="card champ">
          <span className="eyebrow champ-label">Reigning champion</span>
          <div className="champ-row">
            <span className="champ-icon">{copy.icon}</span>
            <div className="grow">
              <div className="champ-name">{best.name}</div>
              {best.suburb && <div className="champ-sub">{best.suburb}</div>}
            </div>
            <span className="champ-score display">{avgOf(best)!.toFixed(1)}</span>
          </div>
        </div>
      )}

      {mine.length > 0 && (
        <div className="filters scroll-x">
          {(
            [
              ['all', 'All'],
              ['ranked', 'Rated'],
              ['todo', 'To try'],
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
          icon={copy.icon}
          title={mine.length ? 'Nothing here' : `No ${copy.one} yet`}
          hint={mine.length ? 'Try another filter.' : `Add the first spot — you said you've got a list coming.`}
          action={!mine.length && (
            <button className="btn btn-accent" onClick={() => setAdding(true)} data-pressable>Add a spot</button>
          )}
        />
      ) : (
        <div className="stack">
          {list.map((v, i) => {
            const avg = avgOf(v)
            return (
              <button key={v.id} className="venue card" onClick={() => setEditing(v)} data-pressable data-press-scale="subtle">
                <span className={`venue-rank display ${avg != null && i < 3 ? `is-${i + 1}` : ''}`}>
                  {avg != null ? i + 1 : '·'}
                </span>
                <div className="grow venue-body">
                  <div className="venue-name">{v.name}</div>
                  <div className="venue-meta">
                    {v.suburb && <span>{v.suburb}</span>}
                    {v.price != null && <span className="num">${v.price.toFixed(2)}</span>}
                    {!v.visited && <span className="chip venue-todo">To try</span>}
                  </div>
                  {avg != null && (
                    <div className="venue-scores">
                      <span className="num" style={{ color: 'var(--rose)' }}>{v.score_james?.toFixed(1) ?? '—'}</span>
                      <span className="venue-sep">/</span>
                      <span className="num" style={{ color: 'var(--gold)' }}>{v.score_lee?.toFixed(1) ?? '—'}</span>
                    </div>
                  )}
                </div>
                <span className="venue-avg display">{avg?.toFixed(1) ?? '—'}</span>
              </button>
            )
          })}
        </div>
      )}

      <Fab onClick={() => setAdding(true)} label="Add a spot" />

      <VenueSheet
        open={adding || !!editing}
        row={editing}
        me={me}
        them={them}
        copy={copy}
        onClose={() => { setAdding(false); setEditing(null) }}
        onSave={async (patch) => {
          const isNew = !editing
          await upsert(
            isNew
              ? ({ ...patch, id: uid(), kind, added_by: me.slug, created_at: new Date().toISOString() } as VenueRow)
              : ({ ...patch, id: editing!.id } as VenueRow),
          )
          setAdding(false)
          setEditing(null)
          toast(isNew ? 'Added' : 'Saved', 'good')
        }}
        onDelete={editing ? async () => {
          const ok = await confirm({ title: `Delete ${editing.name}?`, confirmLabel: 'Delete', danger: true })
          if (!ok) return
          await remove(editing.id)
          setEditing(null)
        } : undefined}
      />
    </>
  )
}

/* -------------------------------------------------------------------------- */

function VenueSheet({
  open, row, me, them, copy, onClose, onSave, onDelete,
}: {
  open: boolean
  row: VenueRow | null
  me: Profile
  them: Profile
  copy: (typeof COPY)[keyof typeof COPY]
  onClose: () => void
  onSave: (patch: Partial<VenueRow>) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState('')
  const [suburb, setSuburb] = useState('')
  const [price, setPrice] = useState('')
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [mine, setMine] = useState<number | null>(null)
  const [theirs, setTheirs] = useState<number | null>(null)
  const [myNote, setMyNote] = useState('')
  const [visited, setVisited] = useState(false)
  const [when, setWhen] = useState('')

  useEffect(() => {
    if (!open) return
    setName(row?.name ?? '')
    setSuburb(row?.suburb ?? '')
    setPrice(row?.price != null ? String(row.price) : '')
    setUrl(row?.url ?? '')
    setNotes(row?.notes ?? '')
    setMine(row?.[sKey(me.slug)] ?? null)
    setTheirs(row?.[sKey(them.slug)] ?? null)
    setMyNote(row?.[nKey(me.slug)] ?? '')
    setVisited(row?.visited ?? false)
    setWhen(row?.visited_on ?? '')
  }, [open, row, me.slug, them.slug])

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={row ? row.name : `Add ${copy.one}`}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-danger btn-sm" onClick={onDelete} aria-label="Delete" data-pressable>
              <Icon name="trash" size={15} />
            </button>
          )}
          <button
            className="btn btn-accent"
            disabled={!name.trim()}
            onClick={() =>
              onSave({
                name: name.trim(),
                suburb: suburb.trim() || null,
                price: price ? Number(price) : null,
                url: url.trim() || null,
                notes: notes.trim() || null,
                visited: visited || mine != null || theirs != null,
                visited_on: when || null,
                [sKey(me.slug)]: mine,
                [sKey(them.slug)]: theirs,
                [nKey(me.slug)]: myNote.trim() || null,
              } as Partial<VenueRow>)
            }
            data-pressable
          >
            Save
          </button>
        </>
      }
    >
      <Field label="Place"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name of the joint" autoFocus={!row} /></Field>
      <div className="two-up">
        <Field label="Suburb"><input value={suburb} onChange={(e) => setSuburb(e.target.value)} placeholder="Fitzroy" /></Field>
        <Field label="Price"><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="24.00" /></Field>
      </div>
      <Field label="Link" hint="Menu, maps, whatever."><input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="https://" /></Field>

      <hr className="divider" />

      <ScorePair mine={mine} theirs={theirs} myName={me.name} theirName={them.name} />
      <RatingBar label={`${me.name} — your score`} value={mine} onChange={setMine} accent={me.accent} />
      <RatingBar label={`${them.name}'s score`} value={theirs} onChange={setTheirs} accent={them.accent} />

      <Field label="When did we go?"><input type="date" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <Field label={`${me.name}'s verdict`}><textarea value={myNote} onChange={(e) => setMyNote(e.target.value)} placeholder="Cheese ratio, crunch, the works…" /></Field>

      {row?.[nKey(them.slug)] && (
        <div className="their-note">
          <span className="eyebrow">{them.name} said</span>
          <p className="selectable">{row[nKey(them.slug)]}</p>
        </div>
      )}

      <Field label="Shared notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What to order next time…" /></Field>
    </Sheet>
  )
}
