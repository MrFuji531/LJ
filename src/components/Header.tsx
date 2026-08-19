import { useEffect, useState } from 'react'
import './Header.css'

import { Logo } from './Logo'
import { Icon } from './Icon'
import { Field, Sheet, SectionTitle, useConfirm, useToast } from './ui'
import { useCollection } from '../lib/collection'
import { logEvent, unlogEvent, today } from '../lib/events'
import { makeThumb, normalizePhoto, uploadMedia, removeMedia, mediaUrl } from '../lib/media'
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

/** One pulled-off hat activity: what, when, and the photographic evidence. */
type HatLogRow = {
  id: string
  activity: string
  done_on: string | null
  photo_path: string | null
  photo_thumb: string | null
  added_by: string | null
  created_at?: string
  updated_at?: string
}

const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

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

const prettyDate = (iso: string | null) =>
  iso
    ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—'

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
  const [hatOpen, setHatOpen] = useState(false)

  const active = TABS.find((t) => t.id === tab)

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

        <div className="hat" data-pressable data-press-scale="subtle" onClick={() => setHatOpen(true)}>
          <div className="hat-label">
            <span className="eyebrow">Current hat activity</span>
            {when && <span className="hat-when">{when}</span>}
          </div>
          <div className={`hat-text display ${app.hat_activity ? '' : 'is-empty'}`}>
            {app.hat_activity || 'Tap to set it'}
            <Icon name="pencil" size={13} className="hat-pencil" />
          </div>
        </div>
      </div>

      <HatSheet open={hatOpen} onClose={() => setHatOpen(false)} app={app} setApp={setApp} me={me} />
    </header>
  )
}

/* ==========================================================================
   The hat, in full: edit what's in it, pull things off, keep the record.
   ========================================================================== */

function HatSheet({
  open,
  onClose,
  app,
  setApp,
  me,
}: {
  open: boolean
  onClose: () => void
  app: AppRow
  setApp: (row: Partial<AppRow>) => Promise<AppRow>
  me: Profile
}) {
  const { rows, upsert, remove } = useCollection<HatLogRow>('lj_hat_log')
  const toast = useToast()
  const confirm = useConfirm()
  const [draft, setDraft] = useState('')
  const [entry, setEntry] = useState<HatLogRow | null>(null)
  const [entryOpen, setEntryOpen] = useState(false)

  useEffect(() => {
    if (open) setDraft(app.hat_activity ?? '')
  }, [open, app.hat_activity])

  const history = [...rows].sort((a, b) =>
    (b.done_on ?? '').localeCompare(a.done_on ?? '') || (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  )

  const saveCurrent = () => {
    const next = draft.trim()
    if (next === (app.hat_activity ?? '')) return
    void setApp({ id: 1, hat_activity: next, hat_updated_by: me.slug })
    toast(next ? 'Hat updated' : 'Hat emptied', 'good')
  }

  const startLog = (prefill: string) => {
    setEntry({
      id: uid(),
      activity: prefill,
      done_on: today(),
      photo_path: null,
      photo_thumb: null,
      added_by: me.slug,
    })
    setEntryOpen(true)
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title="The hat">
        <Field label="What's in it right now">
          <input
            value={draft}
            maxLength={160}
            placeholder="What's in the hat?"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveCurrent}
            onKeyDown={(e) => e.key === 'Enter' && saveCurrent()}
          />
        </Field>

        {app.hat_activity && (
          <button className="btn btn-accent btn-block" onClick={() => startLog(app.hat_activity!)} data-pressable>
            We did it — put it in the record
          </button>
        )}

        <hr className="divider" />

        <SectionTitle right={history.length ? <span className="eyebrow">{history.length} done</span> : undefined}>
          The record
        </SectionTitle>

        {history.length === 0 ? (
          <p className="muted place-hint">
            Every hat activity you pull off lands here, with the date and a photo if you take one.
          </p>
        ) : (
          history.map((h) => (
            <button
              key={h.id}
              className="hat-log card"
              onClick={() => {
                setEntry(h)
                setEntryOpen(true)
              }}
              data-pressable
              data-press-scale="subtle"
            >
              {h.photo_thumb ? (
                <img className="hat-log-thumb" src={h.photo_thumb} alt="" />
              ) : (
                <span className="hat-log-thumb is-empty">🎩</span>
              )}
              <div className="grow hat-log-body">
                <div className="hat-log-activity">{h.activity}</div>
                <div className="hat-log-date num">{prettyDate(h.done_on)}</div>
              </div>
              <Icon name="chevron" size={14} />
            </button>
          ))
        )}

        <button className="btn btn-quiet btn-block btn-sm" onClick={() => startLog('')} data-pressable>
          <Icon name="plus" size={14} /> Log a past one
        </button>
      </Sheet>

      <HatEntrySheet
        open={entryOpen}
        entry={entry}
        exists={!!entry && rows.some((r) => r.id === entry.id)}
        onClose={() => setEntryOpen(false)}
        onSave={async (e) => {
          const wasCurrent = e.activity.trim() === (app.hat_activity ?? '').trim()
          await upsert(e)
          logEvent({
            room: 'hat', kind: 'done', refId: e.id, label: e.activity,
            happenedOn: e.done_on, by: me.slug,
          })
          // Pulling the current activity off empties the hat for the next one.
          if (wasCurrent && app.hat_activity) {
            void setApp({ id: 1, hat_activity: '', hat_updated_by: me.slug })
          }
          setEntryOpen(false)
          toast('In the record', 'good')
        }}
        onDelete={async (e) => {
          const ok = await confirm({ title: 'Remove this entry?', confirmLabel: 'Remove', danger: true })
          if (!ok) return
          if (e.photo_path) void removeMedia(e.photo_path)
          await remove(e.id)
          unlogEvent('hat', 'done', e.id)
          setEntryOpen(false)
        }}
      />
    </>
  )
}

function HatEntrySheet({
  open,
  entry,
  exists,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean
  entry: HatLogRow | null
  exists: boolean
  onClose: () => void
  onSave: (e: HatLogRow) => Promise<void>
  onDelete: (e: HatLogRow) => Promise<void>
}) {
  const toast = useToast()
  const [activity, setActivity] = useState('')
  const [doneOn, setDoneOn] = useState('')
  const [photo, setPhoto] = useState<{ path: string; thumb: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [fullUrl, setFullUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !entry) return
    setActivity(entry.activity)
    setDoneOn(entry.done_on ?? today())
    setPhoto(entry.photo_path && entry.photo_thumb ? { path: entry.photo_path, thumb: entry.photo_thumb } : null)
    setFullUrl(null)
    if (entry.photo_path) {
      let alive = true
      void mediaUrl(entry.photo_path).then((u) => alive && setFullUrl(u))
      return () => {
        alive = false
      }
    }
  }, [open, entry])

  if (!entry) return null

  const pick = async (file: File) => {
    setBusy(true)
    try {
      const { blob, ext } = await normalizePhoto(file)
      const path = `hat/${entry.id}.${ext}`
      const thumb = await makeThumb(blob)
      await uploadMedia(path, blob)
      if (photo && photo.path !== path) void removeMedia(photo.path)
      setPhoto({ path, thumb })
      setFullUrl(null)
    } catch (e) {
      toast(`Photo failed — ${e instanceof Error ? e.message : 'unknown error'}`, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={exists ? 'The record' : 'Into the record'}
      footer={
        <>
          {exists && (
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(entry)} aria-label="Remove" data-pressable>
              <Icon name="trash" size={15} />
            </button>
          )}
          <button
            className="btn btn-accent"
            disabled={!activity.trim() || busy}
            onClick={() =>
              onSave({
                ...entry,
                activity: activity.trim(),
                done_on: doneOn || today(),
                photo_path: photo?.path ?? null,
                photo_thumb: photo?.thumb ?? null,
              })
            }
            data-pressable
          >
            Save
          </button>
        </>
      }
    >
      <Field label="What we did">
        <input value={activity} onChange={(e) => setActivity(e.target.value)} placeholder="The activity" autoFocus={!exists && !activity} />
      </Field>

      <Field label="When we did it" hint="Backdate it if you're logging it late.">
        <input type="date" value={doneOn} onChange={(e) => setDoneOn(e.target.value)} />
      </Field>

      {photo && (
        <div className="photo-frame">
          <img src={fullUrl ?? photo.thumb} alt="" />
        </div>
      )}

      <label className="btn btn-quiet btn-block btn-sm set-import" data-pressable>
        <Icon name="camera" size={14} />
        {busy ? 'Uploading…' : photo ? 'Replace the photo' : 'Add a photo'}
        <input
          type="file"
          accept="image/*,.heic,.heif"
          hidden
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void pick(f)
            e.target.value = ''
          }}
        />
      </label>
    </Sheet>
  )
}
