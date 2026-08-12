import { useEffect, useRef, useState } from 'react'
import './Header.css'

import { Logo } from './Logo'
import { Icon } from './Icon'
import { useCollection } from '../lib/collection'
import type { Profile } from '../lib/session'
import type { TabId } from './TabBar'
import { TABS } from './TabBar'

export type AppRow = {
  id: number
  hat_activity: string | null
  hat_updated_by: string | null
  /** The position currently "up next" — shared, so you both see the same one. */
  active_position_id: number | null
  updated_at: string | null
}

/** Shared singleton row — the hat banner lives here so both phones see it. */
export function useAppState() {
  const { rows, upsert, status } = useCollection<AppRow>('lj_app', 'id')
  const row = rows.find((r) => Number(r.id) === 1) ?? {
    id: 1,
    hat_activity: '',
    hat_updated_by: null,
    active_position_id: null,
    updated_at: null,
  }
  return { app: row, setApp: upsert, status }
}

function relative(iso: string | null) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString()
}

export function Header({
  tab,
  me,
  localOnly,
  onOpenSettings,
}: {
  tab: TabId
  me: Profile
  localOnly: boolean
  onOpenSettings: () => void
}) {
  const { app, setApp, status } = useAppState()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const active = TABS.find((t) => t.id === tab)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const begin = () => {
    setDraft(app.hat_activity ?? '')
    setEditing(true)
  }

  const commit = () => {
    const next = draft.trim()
    setEditing(false)
    if (next === (app.hat_activity ?? '')) return
    void setApp({
      id: 1,
      hat_activity: next,
      hat_updated_by: me.slug,
    })
  }

  const dotClass =
    localOnly ? 'is-local' : status === 'live' ? 'is-live' : status === 'error' ? 'is-error' : 'is-wait'

  const when = relative(app.updated_at)

  return (
    <header className="hd">
      <div className="hd-inner">
        <div className="hd-top">
          <div className="hd-brand">
            <Logo size={30} />
            <span className="hd-room">{active?.label}</span>
          </div>

          <div className="hd-right">
            <span className={`hd-dot ${dotClass}`} title={localOnly ? 'Local only' : status} />
            <button className="hd-me" onClick={onOpenSettings} aria-label="Settings" data-pressable>
              <span className="hd-me-initial" style={{ color: me.accent }}>
                {me.name[0]}
              </span>
              <Icon name="settings" size={13} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="hat" data-pressable data-press-scale="subtle" onClick={editing ? undefined : begin}>
          <div className="hat-label">
            <span className="eyebrow">Current hat activity</span>
            {when && !editing && <span className="hat-when">{when}</span>}
          </div>

          {editing ? (
            <input
              ref={inputRef}
              className="hat-input"
              value={draft}
              maxLength={160}
              placeholder="What's in the hat?"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <div className={`hat-text display ${app.hat_activity ? '' : 'is-empty'}`}>
              {app.hat_activity || 'Tap to set it'}
              <Icon name="pencil" size={13} className="hat-pencil" />
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
