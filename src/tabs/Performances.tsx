import { useState } from 'react'
import { useCollection } from '../lib/collection'
import { logEvent, unlogEvent } from '../lib/events'
import type { Profile } from '../lib/session'
import { Icon } from '../components/Icon'
import { EmptyState, Fab, Field, ScorePair, Sheet, useConfirm, useToast } from '../components/ui'
import './Performances.css'

const CATEGORIES = [
  { id: 'play', label: 'Plays', singular: 'play' },
  { id: 'musical', label: 'Musicals', singular: 'musical' },
  { id: 'concert', label: 'Concerts/Gigs', singular: 'concert or gig' },
] as const

type Kind = typeof CATEGORIES[number]['id']
type Performance = {
  id: string
  kind: Kind
  name: string
  performed_on: string
  score_james: number
  score_lee: number
  added_by: string | null
  created_at?: string
  updated_at?: string
}
type Sort = 'recent' | 'best' | 'worst' | 'az' | 'gap'
const average = (p: Performance) => (p.score_james + p.score_lee) / 2
const prettyDate = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function PerformancesTab({ me }: { me: Profile }) {
  const { rows, upsert, remove, status } = useCollection<Performance>('lj_performances')
  const [kind, setKind] = useState<Kind>('play')
  const [sort, setSort] = useState<Sort>('recent')
  const [editing, setEditing] = useState<Performance | 'new' | null>(null)
  const confirm = useConfirm()
  const toast = useToast()
  const category = CATEGORIES.find((c) => c.id === kind)!
  const entries = rows.filter((r) => r.kind === kind)
  const mean = (score: (r: Performance) => number) => entries.length
    ? (entries.reduce((sum, r) => sum + score(r), 0) / entries.length).toFixed(1) : '—'
  const ordered = [...entries].sort((a, b) => {
    if (sort === 'az') return a.name.localeCompare(b.name)
    const difference = sort === 'best' ? average(b) - average(a)
      : sort === 'worst' ? average(a) - average(b)
      : sort === 'gap' ? Math.abs(b.score_james - b.score_lee) - Math.abs(a.score_james - a.score_lee) : 0
    return difference || b.performed_on.localeCompare(a.performed_on) || a.name.localeCompare(b.name)
  })

  return <>
    <div className="seg" aria-label="Performance categories">
      {CATEGORIES.map((c) => <button key={c.id} className={`seg-btn ${kind === c.id ? 'is-on' : ''}`} aria-pressed={kind === c.id} onClick={() => setKind(c.id)} data-pressable>{c.label}</button>)}
    </div>
    <div className="stat-strip">
      {[[String(entries.length), 'Seen'], [mean((r) => r.score_lee), 'Lee avg'], [mean((r) => r.score_james), 'James avg'], [mean(average), 'Together']].map(([value, label]) =>
        <div className="stat-cell" key={label}><div className="stat-cell-value">{value}</div><div className="eyebrow">{label}</div></div>)}
    </div>
    <p className="muted performance-note">Ratings out of 5 · {category.label}</p>
    {status === 'error' && <p role="status" className="muted">Changes are saved on this device and waiting to sync. Please check your connection.</p>}
    {entries.length > 0 && <div className="filters scroll-x" aria-label="Sort performances">
      {([['recent', 'Recent'], ['best', 'Best'], ['worst', 'Worst'], ['az', 'A–Z'], ['gap', 'Biggest gap']] as [Sort, string][]).map(([id, label]) =>
        <button key={id} className={`filter ${sort === id ? 'is-on' : ''}`} aria-pressed={sort === id} onClick={() => setSort(id)} data-pressable>{label}</button>)}
    </div>}
    <div className="stack">
      {!entries.length ? <EmptyState icon={<Icon name="stage" size={40} />} title={`No ${category.label.toLowerCase()} yet`} hint="Add the name, date and your two ratings to start the collection." action={<button className="btn btn-accent" onClick={() => setEditing('new')} data-pressable>Add a {category.singular}</button>} />
        : ordered.map((p) => <button key={p.id} className="card performance-card" onClick={() => setEditing(p)} data-pressable data-press-scale="subtle">
          <span className="performance-icon"><Icon name="stage" size={25} /></span>
          <div className="performance-body">
            <div className="performance-name">{p.name}</div>
            <div className="performance-date">{prettyDate(p.performed_on)}</div>
            <div className="performance-ratings"><span style={{ color: 'var(--gold)' }}>Lee {p.score_lee.toFixed(1)}</span><span style={{ color: 'var(--rose)' }}>James {p.score_james.toFixed(1)}</span></div>
          </div>
          <div className="performance-average"><span className="display">{average(p).toFixed(1)}</span><span className="eyebrow">Average</span></div>
        </button>)}
    </div>
    <Fab onClick={() => setEditing('new')} label={`Add a ${category.singular}`} />
    {editing && <PerformanceEditor key={editing === 'new' ? `new-${kind}` : editing.id} row={editing === 'new' ? null : editing} category={category} onClose={() => setEditing(null)}
      onSave={async (patch) => {
        const existing = editing === 'new' ? null : editing
        const id = existing?.id ?? crypto.randomUUID()
        await upsert({ ...patch, id, kind, ...(existing ? {} : { added_by: me.slug, created_at: new Date().toISOString() }) })
        logEvent({ room: 'live', kind: 'attended', refId: id, label: patch.name, happenedOn: patch.performed_on, by: me.slug, meta: { category: kind, score_james: patch.score_james, score_lee: patch.score_lee } })
        setEditing(null)
        toast(existing ? 'Saved' : 'Performance added', 'good')
      }}
      onDelete={editing === 'new' ? undefined : async () => {
        if (!await confirm({ title: `Delete ${editing.name}?`, confirmLabel: 'Delete', danger: true })) return
        await remove(editing.id)
        unlogEvent('live', 'attended', editing.id)
        setEditing(null)
      }} />}
  </>
}

function PerformanceEditor({ row, category, onClose, onSave, onDelete }: {
  row: Performance | null
  category: typeof CATEGORIES[number]
  onClose: () => void
  onSave: (patch: Pick<Performance, 'name' | 'performed_on' | 'score_lee' | 'score_james'>) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [name, setName] = useState(row?.name ?? '')
  const [date, setDate] = useState(row?.performed_on ?? localToday())
  const [lee, setLee] = useState(row ? String(row.score_lee) : '')
  const [james, setJames] = useState(row ? String(row.score_james) : '')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const score = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 5 && Number.isInteger(Number(value) * 2)
  const valid = name.trim() && date && score(lee) && score(james)
  return <Sheet open onClose={onClose} title={row ? 'Edit performance' : `Add a ${category.singular}`} footer={<>
    {onDelete && <button className="btn btn-danger btn-sm" disabled={busy} onClick={onDelete} aria-label="Delete performance" data-pressable><Icon name="trash" size={16} /></button>}
    <button className="btn btn-accent" disabled={!valid || busy} onClick={async () => {
      if (!valid || busy) return
      setBusy(true)
      try { await onSave({ name: name.trim(), performed_on: date, score_lee: Number(lee), score_james: Number(james) }) }
      catch { toast('Could not save. Please try again.', 'bad') }
      finally { setBusy(false) }
    }} data-pressable>{busy ? 'Saving…' : 'Save'}</button>
  </>}>
    <Field label={category.id === 'concert' ? 'Artist / event name' : 'Performance name'}><input value={name} onChange={(e) => setName(e.target.value)} placeholder={category.id === 'concert' ? 'Artist, band or gig' : 'Name of the show'} autoFocus={!row} maxLength={200} /></Field>
    <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
    <div className="two-up">
      <Field label="Lee’s rating / 5"><input type="number" inputMode="decimal" min="0" max="5" step="0.5" value={lee} onChange={(e) => setLee(e.target.value)} placeholder="0–5" required /></Field>
      <Field label="James’ rating / 5"><input type="number" inputMode="decimal" min="0" max="5" step="0.5" value={james} onChange={(e) => setJames(e.target.value)} placeholder="0–5" required /></Field>
    </div>
    <p className="muted performance-note">Half points welcome, just like movies.</p>
    {score(lee) && score(james) && <ScorePair mine={Number(james)} theirs={Number(lee)} myName="James" theirName="Lee" />}
  </Sheet>
}
