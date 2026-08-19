import { useCallback, useMemo, useState } from 'react'
import './Positions.css'

import rawPositions from '../data/positions.json'
import { useCollection } from '../lib/collection'
import { logEvent } from '../lib/events'
import type { Profile } from '../lib/session'
import { Icon } from '../components/Icon'
import { EmptyState, Sheet, useConfirm, useToast, SectionTitle } from '../components/ui'
import { useAppState } from '../components/Header'

/* -------------------------------------------------------------------------- */

export type Position = {
  id: number
  name: string
  description: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  toy: boolean
  bondage: boolean
  image_file?: string
  toys_used?: string[]
  restraints_used?: string[]
}

const POSITIONS = rawPositions as Position[]
const BY_ID = new Map(POSITIONS.map((p) => [p.id, p]))

type Verdict = 'dislike' | 'like' | 'favorite'

type PositionRow = {
  position_id: number
  status: 'completed' | 'removed'
  rating: Verdict | null
  rated_by: string | null
  notes: string | null
  updated_at?: string
}

type EquipRow = {
  item: string
  blocked: boolean
  updated_at?: string
}

const VERDICTS: { key: Verdict; emoji: string; label: string; color: string }[] = [
  { key: 'dislike', emoji: '👎', label: 'Nah', color: 'var(--text-3)' },
  { key: 'like', emoji: '👍', label: 'Good', color: 'var(--jade)' },
  { key: 'favorite', emoji: '❤️', label: 'Loved', color: 'var(--rose)' },
]

function equipmentOf(p: Position) {
  return [...(p.toys_used ?? []), ...(p.restraints_used ?? [])]
}

/* -------------------------------------------------------------------------- */

type View = 'explore' | 'browse' | 'kit'

export function PositionsTab({ me }: { me: Profile }) {
  const { rows: progress, upsert, remove } = useCollection<PositionRow>('lj_positions', 'position_id')
  const { rows: equip, upsert: upsertEquip, remove: removeEquip } = useCollection<EquipRow>(
    'lj_equipment',
    'item',
  )

  const toast = useToast()
  const confirm = useConfirm()

  // The one that's "up next" is shared, not per-device — if Lee spins one up,
  // it's waiting on your phone too.
  const { app, setApp } = useAppState()
  const currentId = app.active_position_id ?? null
  const setCurrentId = useCallback(
    (id: number | null) => void setApp({ id: 1, active_position_id: id }),
    [setApp],
  )

  const [view, setView] = useState<View>('explore')
  const [pendingVerdict, setPendingVerdict] = useState<Verdict | null>(null)
  const [undoStack, setUndoStack] = useState<{ id: number; had: PositionRow | null }[]>([])

  const byId = useMemo(() => new Map(progress.map((r) => [Number(r.position_id), r])), [progress])
  const blocked = useMemo(
    () => new Set(equip.filter((e) => e.blocked).map((e) => e.item)),
    [equip],
  )

  const stats = useMemo(() => {
    let completed = 0, liked = 0, disliked = 0, favorited = 0, removed = 0
    for (const r of progress) {
      if (r.status === 'removed') removed++
      else if (r.status === 'completed') {
        completed++
        if (r.rating === 'like') liked++
        else if (r.rating === 'dislike') disliked++
        else if (r.rating === 'favorite') favorited++
      }
    }
    return {
      completed, liked, disliked, favorited, removed,
      total: POSITIONS.length,
      left: POSITIONS.length - completed - removed,
      pct: Math.round((completed / POSITIONS.length) * 100),
    }
  }, [progress])

  /** Untouched, and not gated behind kit we've said we don't have. */
  const available = useMemo(
    () =>
      POSITIONS.filter((p) => {
        if (byId.has(p.id)) return false
        return !equipmentOf(p).some((item) => blocked.has(item))
      }),
    [byId, blocked],
  )

  // If the one that was up next has since been completed or removed (possibly
  // on the other phone), it stops being up next.
  const current = useMemo(() => {
    if (currentId == null) return null
    const p = BY_ID.get(currentId)
    if (!p || byId.has(p.id)) return null
    return p
  }, [currentId, byId])

  const suggest = useCallback(() => {
    if (!available.length) {
      toast('Nothing left in the pool — free up some kit or reset.', 'bad')
      return
    }
    const pick = available[Math.floor(Math.random() * available.length)]
    setCurrentId(pick.id)
    setPendingVerdict(null)
  }, [available, toast])

  const pushUndo = (id: number) => {
    setUndoStack((s) => [...s.slice(-19), { id, had: byId.get(id) ?? null }])
  }

  const complete = async () => {
    if (!current || !pendingVerdict) return
    pushUndo(current.id)
    await upsert({
      position_id: current.id,
      status: 'completed',
      rating: pendingVerdict,
      rated_by: me.slug,
    })
    logEvent({
      room: 'positions', kind: 'completed', refId: String(current.id),
      label: current.name, meta: { rating: pendingVerdict }, by: me.slug,
    })
    const v = VERDICTS.find((x) => x.key === pendingVerdict)!
    toast(`${v.emoji}  ${current.name}`, pendingVerdict === 'dislike' ? 'default' : 'good')
    setCurrentId(null)
    setPendingVerdict(null)
  }

  const dropIt = async () => {
    if (!current) return
    const ok = await confirm({
      title: 'Remove for good?',
      body: `"${current.name}" leaves the pool and won't be suggested again.`,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    pushUndo(current.id)
    await upsert({ position_id: current.id, status: 'removed', rating: null, rated_by: me.slug })
    toast('Removed')
    setCurrentId(null)
  }

  const noKit = async () => {
    if (!current) return
    const items = equipmentOf(current)
    if (!items.length) {
      toast('This one needs nothing but you two.')
      return
    }
    await Promise.all(items.map((item) => upsertEquip({ item, blocked: true })))
    toast(`Parked — ${items.join(', ')}`)
    setCurrentId(null)
    setTimeout(suggest, 260)
  }

  const undo = async () => {
    const last = undoStack[undoStack.length - 1]
    if (!last) {
      toast('Nothing to undo')
      return
    }
    setUndoStack((s) => s.slice(0, -1))
    if (last.had) await upsert(last.had)
    else await remove(last.id)
    setCurrentId(last.id)
    setPendingVerdict(null)
    toast('Undone')
  }

  return (
    <>
      <ProgressPanel stats={stats} />

      <div className="seg">
        {(
          [
            ['explore', 'Explore'],
            ['browse', 'The Book'],
            ['kit', `Kit${blocked.size ? ` · ${blocked.size}` : ''}`],
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

      {view === 'explore' && (
        <div className="stack">
          {!current ? (
            <>
              <div className="card pos-invite">
                <div className="pos-invite-glyph">✦</div>
                <div className="pos-invite-title display">{stats.left} left to try</div>
                <div className="pos-invite-sub">
                  {available.length} available right now
                  {blocked.size > 0 && ` · ${POSITIONS.length - stats.completed - stats.removed - available.length} waiting on kit`}
                </div>
              </div>
              <button className="btn btn-accent btn-block pos-cta" onClick={suggest} data-pressable>
                <Icon name="shuffle" size={17} />
                Suggest one
              </button>
            </>
          ) : (
            <PositionCard
              position={current}
              verdict={pendingVerdict}
              onVerdict={setPendingVerdict}
              onSave={complete}
              onSkip={() => {
                setCurrentId(null)
                setPendingVerdict(null)
              }}
              onNext={suggest}
              onRemove={dropIt}
              onNoKit={noKit}
            />
          )}

          {undoStack.length > 0 && (
            <button className="btn btn-quiet btn-sm pos-undo" onClick={undo} data-pressable>
              <Icon name="undo" size={14} />
              Undo last
            </button>
          )}
        </div>
      )}

      {view === 'browse' && <Browse progress={byId} blocked={blocked} onPick={(id) => { setCurrentId(id); setView('explore') }} />}

      {view === 'kit' && (
        <KitList
          equip={equip.filter((e) => e.blocked)}
          onUnblock={async (item) => {
            await removeEquip(item)
            toast(`"${item}" — back in play`, 'good')
          }}
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function ProgressPanel({ stats }: { stats: { pct: number; completed: number; favorited: number; liked: number; left: number } }) {
  return (
    <div className="card prog">
      <div className="prog-bar">
        <div className="prog-fill" style={{ width: `${stats.pct}%` }} />
        <span className="prog-pct num">{stats.pct}%</span>
      </div>
      <div className="prog-grid">
        {[
          ['Done', stats.completed, 'var(--text)'],
          ['Loved', stats.favorited, 'var(--rose)'],
          ['Liked', stats.liked, 'var(--jade)'],
          ['Left', stats.left, 'var(--text-2)'],
        ].map(([label, value, color]) => (
          <div key={label as string} className="prog-cell">
            <div className="prog-value display" style={{ color: color as string }}>{value as number}</div>
            <div className="eyebrow">{label as string}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PositionCard({
  position,
  verdict,
  onVerdict,
  onSave,
  onSkip,
  onNext,
  onRemove,
  onNoKit,
}: {
  position: Position
  verdict: Verdict | null
  onVerdict: (v: Verdict) => void
  onSave: () => void
  onSkip: () => void
  onNext: () => void
  onRemove: () => void
  onNoKit: () => void
}) {
  const [broken, setBroken] = useState(false)
  const kit = equipmentOf(position)

  return (
    <div className="card pos-card rise">
      {position.image_file && !broken && (
        <div className="pos-shot">
          <img
            src={`positions/${position.image_file}`}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
          />
        </div>
      )}

      <div className="pos-body">
        <div className="pos-chips">
          <span className={`chip diff-${position.difficulty}`}>{position.difficulty}</span>
          {position.toy && <span className="chip chip-toy">Toy</span>}
          {position.bondage && <span className="chip chip-bondage">Bondage</span>}
        </div>

        <h2 className="pos-name display">{position.name}</h2>
        <p className="pos-desc selectable">{position.description}</p>

        {kit.length > 0 && (
          <div className="pos-kit">
            <div className="eyebrow">You'll need</div>
            <ul>
              {kit.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="pos-verdicts">
          {VERDICTS.map((v) => (
            <button
              key={v.key}
              className={`verdict ${verdict === v.key ? 'is-on' : ''}`}
              style={{ ['--v' as string]: v.color }}
              onClick={() => onVerdict(v.key)}
              data-pressable
            >
              <span className="verdict-emoji">{v.emoji}</span>
              <span className="verdict-label">{v.label}</span>
            </button>
          ))}
        </div>

        <button
          className="btn btn-accent btn-block"
          disabled={!verdict}
          onClick={onSave}
          data-pressable
        >
          {verdict ? 'Mark it done' : 'Pick a verdict'}
        </button>

        <div className="pos-minor">
          <button className="btn btn-quiet btn-sm" onClick={onNoKit} data-pressable>
            No kit
          </button>
          <button className="btn btn-quiet btn-sm" onClick={onNext} data-pressable>
            <Icon name="shuffle" size={13} /> Another
          </button>
          <button className="btn btn-quiet btn-sm" onClick={onSkip} data-pressable>
            Later
          </button>
          <button className="btn btn-danger btn-sm" onClick={onRemove} data-pressable>
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Browse({
  progress,
  blocked,
  onPick,
}: {
  progress: Map<number, PositionRow>
  blocked: Set<string>
  onPick: (id: number) => void
}) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'todo' | 'loved' | 'liked' | 'nah' | 'removed'>('all')
  const [open, setOpen] = useState<Position | null>(null)

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return POSITIONS.filter((p) => {
      const row = progress.get(p.id)
      if (filter === 'todo' && row) return false
      if (filter === 'loved' && row?.rating !== 'favorite') return false
      if (filter === 'liked' && row?.rating !== 'like') return false
      if (filter === 'nah' && row?.rating !== 'dislike') return false
      if (filter === 'removed' && row?.status !== 'removed') return false
      if (!needle) return true
      return (
        p.name.toLowerCase().includes(needle) ||
        p.description.toLowerCase().includes(needle) ||
        equipmentOf(p).some((k) => k.toLowerCase().includes(needle))
      )
    })
  }, [q, filter, progress])

  return (
    <div className="stack">
      <div className="search">
        <Icon name="search" size={16} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search 207 positions…"
          enterKeyHint="search"
        />
        {q && (
          <button className="search-clear" onClick={() => setQ('')} aria-label="Clear" data-pressable>
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      <div className="filters scroll-x">
        {(
          [
            ['all', 'All'],
            ['todo', 'Not tried'],
            ['loved', '❤️ Loved'],
            ['liked', '👍 Liked'],
            ['nah', '👎 Nah'],
            ['removed', 'Removed'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`filter ${filter === id ? 'is-on' : ''}`}
            onClick={() => setFilter(id)}
            data-pressable
          >
            {label}
          </button>
        ))}
      </div>

      <div className="eyebrow browse-count">{list.length} shown</div>

      <div className="browse-grid">
        {list.map((p) => {
          const row = progress.get(p.id)
          const gated = equipmentOf(p).some((k) => blocked.has(k))
          return (
            <button key={p.id} className="tile" onClick={() => setOpen(p)} data-pressable data-press-scale="subtle">
              <div className="tile-shot">
                {p.image_file ? <img src={`positions/${p.image_file}`} alt="" loading="lazy" /> : <span className="tile-glyph">✦</span>}
                {row?.rating && <span className="tile-badge">{VERDICTS.find((v) => v.key === row.rating)?.emoji}</span>}
                {row?.status === 'removed' && <span className="tile-badge is-dim">✕</span>}
                {gated && !row && <span className="tile-badge is-dim">🔒</span>}
              </div>
              <span className="tile-name">{p.name}</span>
            </button>
          )
        })}
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name}>
        {open && (
          <>
            {open.image_file && (
              <div className="pos-shot pos-shot-sheet">
                <img src={`positions/${open.image_file}`} alt="" />
              </div>
            )}
            <div className="pos-chips">
              <span className={`chip diff-${open.difficulty}`}>{open.difficulty}</span>
              {open.toy && <span className="chip chip-toy">Toy</span>}
              {open.bondage && <span className="chip chip-bondage">Bondage</span>}
            </div>
            <p className="pos-desc selectable">{open.description}</p>
            {equipmentOf(open).length > 0 && (
              <div className="pos-kit">
                <div className="eyebrow">You'll need</div>
                <ul>
                  {equipmentOf(open).map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              </div>
            )}
            <button
              className="btn btn-accent btn-block"
              onClick={() => {
                onPick(open.id)
                setOpen(null)
              }}
              data-pressable
            >
              Put this one up
            </button>
          </>
        )}
      </Sheet>
    </div>
  )
}

function KitList({ equip, onUnblock }: { equip: EquipRow[]; onUnblock: (item: string) => void }) {
  if (!equip.length) {
    return (
      <EmptyState
        icon="✓"
        title="Nothing on the shopping list"
        hint="When a position needs kit you don't have, tap “No kit” and it lands here."
      />
    )
  }
  return (
    <div className="stack">
      <SectionTitle>Waiting on kit</SectionTitle>
      {equip.map((e) => {
        const count = POSITIONS.filter((p) => equipmentOf(p).includes(e.item)).length
        return (
          <div key={e.item} className="card kit-row">
            <div className="grow">
              <div className="kit-name">{e.item}</div>
              <div className="kit-count eyebrow">unlocks {count} position{count === 1 ? '' : 's'}</div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => onUnblock(e.item)} data-pressable>
              Got it
            </button>
          </div>
        )
      })}
    </div>
  )
}
