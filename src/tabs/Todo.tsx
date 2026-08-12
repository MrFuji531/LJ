import { useMemo, useState } from 'react'
import './Todo.css'

import { useCollection } from '../lib/collection'
import { profileOf, type Profile } from '../lib/session'
import { Icon } from '../components/Icon'
import { EmptyState, Field, Sheet, useConfirm, useToast } from '../components/ui'

type TodoRow = {
  id: string
  text: string
  category: string | null
  done: boolean
  done_at: string | null
  due_date: string | null
  notes: string | null
  added_by: string | null
  created_at?: string
  updated_at?: string
}

const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

const CATEGORIES = ['Day out', 'Trip', 'Home', 'Food', 'Someday', 'Admin'] as const

export function TodoTab({ me }: { me: Profile }) {
  const { rows, upsert, remove } = useCollection<TodoRow>('lj_todos')
  const toast = useToast()
  const confirm = useConfirm()

  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<TodoRow | null>(null)
  const [filter, setFilter] = useState<string>('open')

  const open = rows.filter((r) => !r.done)
  const done = rows.filter((r) => r.done)

  const list = useMemo(() => {
    let base: TodoRow[]
    if (filter === 'done') base = done
    else if (filter === 'open') base = open
    else base = open.filter((r) => r.category === filter)

    return [...base].sort((a, b) => {
      if (filter === 'done') return (b.done_at ?? '').localeCompare(a.done_at ?? '')
      // Anything with a date floats up, soonest first.
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
  }, [open, done, filter])

  const add = async () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await upsert({
      id: uid(),
      text,
      category: null,
      done: false,
      done_at: null,
      due_date: null,
      notes: null,
      added_by: me.slug,
      created_at: new Date().toISOString(),
    })
  }

  const toggle = async (r: TodoRow) => {
    await upsert({ ...r, done: !r.done, done_at: !r.done ? new Date().toISOString() : null })
    if (!r.done) toast('Nice.', 'good')
  }

  const usedCategories = [...new Set(open.map((r) => r.category).filter(Boolean))] as string[]

  return (
    <>
      <div className="stat-strip">
        <div className="stat-cell">
          <div className="stat-cell-value" style={{ color: 'var(--accent)' }}>{open.length}</div>
          <div className="eyebrow">To do</div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell-value">{done.length}</div>
          <div className="eyebrow">Done</div>
        </div>
      </div>

      <div className="todo-add">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Something we want to do…"
          enterKeyHint="done"
        />
        <button className="btn btn-accent todo-add-btn" onClick={add} disabled={!draft.trim()} aria-label="Add" data-pressable>
          <Icon name="plus" size={18} />
        </button>
      </div>

      <div className="filters scroll-x">
        <button className={`filter ${filter === 'open' ? 'is-on' : ''}`} onClick={() => setFilter('open')} data-pressable>
          All open
        </button>
        {usedCategories.map((c) => (
          <button key={c} className={`filter ${filter === c ? 'is-on' : ''}`} onClick={() => setFilter(c)} data-pressable>
            {c}
          </button>
        ))}
        <button className={`filter ${filter === 'done' ? 'is-on' : ''}`} onClick={() => setFilter('done')} data-pressable>
          Done{done.length ? ` · ${done.length}` : ''}
        </button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon="✦"
          title={filter === 'done' ? 'Nothing done yet' : 'Nothing on the list'}
          hint={filter === 'done' ? 'Tick something off and it lands here.' : 'Type it in the box above — the small stuff counts.'}
        />
      ) : (
        <div className="stack">
          {list.map((r) => {
            const who = profileOf(r.added_by)
            return (
              <div key={r.id} className={`todo card ${r.done ? 'is-done' : ''}`}>
                <button
                  className={`todo-box ${r.done ? 'is-on' : ''}`}
                  onClick={() => toggle(r)}
                  aria-label={r.done ? 'Mark not done' : 'Mark done'}
                  data-pressable
                >
                  {r.done && <Icon name="check" size={13} strokeWidth={2.6} />}
                </button>

                <button className="todo-main" onClick={() => setEditing(r)} data-pressable data-press-scale="subtle">
                  <span className="todo-text">{r.text}</span>
                  <span className="todo-meta">
                    {r.category && <span className="chip todo-cat">{r.category}</span>}
                    {r.due_date && (
                      <span className="todo-due num">
                        <Icon name="calendar" size={11} />
                        {new Date(r.due_date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                    {who && <span className="todo-who" style={{ color: who.accent }}>{who.name}</span>}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <Sheet
          open
          onClose={() => setEditing(null)}
          title="Edit"
          footer={
            <>
              <button
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  const ok = await confirm({ title: 'Delete this?', confirmLabel: 'Delete', danger: true })
                  if (!ok) return
                  await remove(editing.id)
                  setEditing(null)
                }}
                aria-label="Delete"
                data-pressable
              >
                <Icon name="trash" size={15} />
              </button>
              <button
                className="btn btn-accent"
                onClick={async () => {
                  await upsert(editing)
                  setEditing(null)
                  toast('Saved', 'good')
                }}
                data-pressable
              >
                Save
              </button>
            </>
          }
        >
          <Field label="What">
            <input value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
          </Field>

          <Field label="Category">
            <div className="cat-row">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  className={`filter ${editing.category === c ? 'is-on' : ''}`}
                  onClick={() => setEditing({ ...editing, category: editing.category === c ? null : c })}
                  data-pressable
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>

          <Field label="When" hint="Optional — dated items float to the top.">
            <input
              type="date"
              value={editing.due_date ?? ''}
              onChange={(e) => setEditing({ ...editing, due_date: e.target.value || null })}
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={editing.notes ?? ''}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value || null })}
              placeholder="Details, links, who to call…"
            />
          </Field>
        </Sheet>
      )}
    </>
  )
}
