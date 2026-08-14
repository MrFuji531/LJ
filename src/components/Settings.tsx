import { useState } from 'react'
import './Settings.css'

import { Sheet, Field, useToast, useConfirm } from './ui'
import { Icon } from './Icon'
import { Logo } from './Logo'
import { PROFILES, type Profile, type useSession } from '../lib/session'
import { getConfig, setConfig, isConfigured } from '../lib/supabase'
import { tmdbKey, setTmdbKey, hasTmdb } from '../lib/tmdb'
import { pendingWrites, reloadAll, flushOutbox, collection } from '../lib/collection'
import { isClockSynced, clockOffset, syncClock } from '../lib/clock'

const TABLES = [
  'lj_app', 'lj_positions', 'lj_equipment', 'lj_cuisines',
  'lj_titles', 'lj_venues', 'lj_todos',
  'lj_mcu_films', 'lj_mcu_chars',
]

/** Primary key per table — needed so import can replace rows correctly. */
const PK: Record<string, string> = {
  lj_app: 'id',
  lj_positions: 'position_id',
  lj_equipment: 'item',
  lj_cuisines: 'country',
  lj_mcu_films: 'slug',
}

export function Settings({
  open,
  onClose,
  session,
  me,
}: {
  open: boolean
  onClose: () => void
  session: ReturnType<typeof useSession>
  me: Profile
}) {
  const toast = useToast()
  const confirm = useConfirm()

  const cfg = getConfig()
  const [url, setUrl] = useState(cfg.url)
  const [key, setKey] = useState(cfg.key)
  const [tk, setTk] = useState(tmdbKey())
  const [showAdvanced, setShowAdvanced] = useState(false)

  const pending = pendingWrites()

  const exportAll = () => {
    const dump: Record<string, unknown> = { exported_at: new Date().toISOString(), version: 1 }
    for (const t of TABLES) {
      try {
        dump[t] = JSON.parse(localStorage.getItem(`lj.cache.${t}`) || '[]')
      } catch {
        dump[t] = []
      }
    }
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `LJ-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('Backup downloaded', 'good')
  }

  const importAll = async (file: File) => {
    const ok = await confirm({
      title: 'Import and overwrite?',
      body: 'Everything currently in the app is replaced by the contents of this file, on both phones.',
      confirmLabel: 'Import',
      danger: true,
    })
    if (!ok) return
    try {
      const parsed = JSON.parse(await file.text())
      for (const t of TABLES) {
        if (!Array.isArray(parsed[t])) continue
        await collection(t, PK[t] ?? 'id').replaceAll(parsed[t])
      }
      toast('Imported', 'good')
    } catch {
      toast("Couldn't read that file", 'bad')
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      {/* ---- who ---- */}
      <div className="set-block">
        <span className="eyebrow">Who's holding the phone</span>
        <div className="set-people">
          {PROFILES.map((p) => (
            <button
              key={p.slug}
              className={`set-person ${p.slug === me.slug ? 'is-me' : ''}`}
              style={{ ['--who' as string]: p.accent }}
              onClick={() => {
                if (p.slug === me.slug) return
                void session.switchProfile(p.slug)
                onClose()
              }}
              data-pressable
            >
              <span className="set-person-initial display">{p.name[0]}</span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---- sync ---- */}
      <div className="set-block">
        <span className="eyebrow">Sync</span>
        <div className="set-status">
          <span className={`hd-dot ${isConfigured() ? 'is-live' : 'is-local'}`} />
          <span className="grow">
            {isConfigured() ? 'Connected' : 'Local only — this phone'}
            {pending > 0 && ` · ${pending} waiting`}
          </span>
          <button
            className="btn btn-quiet btn-sm"
            onClick={async () => {
              await flushOutbox()
              reloadAll()
              await syncClock()
              toast('Refreshed', 'good')
            }}
            data-pressable
          >
            <Icon name="cloud" size={14} /> Refresh
          </button>
        </div>
        {isClockSynced() && (
          <p className="set-hint num">Clock offset {clockOffset() >= 0 ? '+' : ''}{Math.round(clockOffset())}ms</p>
        )}
      </div>

      {/* ---- tmdb ---- */}
      <div className="set-block">
        <span className="eyebrow">Film & TV metadata</span>
        <Field
          label="TMDb API key"
          hint={hasTmdb() ? 'Posters, genres and cast fill in automatically.' : 'Free at themoviedb.org → Settings → API. Without it, entry is manual.'}
        >
          <input value={tk} onChange={(e) => setTk(e.target.value)} placeholder="Paste key" autoComplete="off" spellCheck={false} />
        </Field>
        <button
          className="btn btn-quiet btn-block btn-sm"
          onClick={() => {
            setTmdbKey(tk)
            toast(tk.trim() ? 'Key saved' : 'Key cleared', 'good')
          }}
          data-pressable
        >
          Save key
        </button>
      </div>

      {/* ---- backup ---- */}
      <div className="set-block">
        <span className="eyebrow">Backup</span>
        <div className="row">
          <button className="btn btn-quiet btn-sm grow" onClick={exportAll} data-pressable>Export</button>
          <label className="btn btn-quiet btn-sm grow set-import" data-pressable>
            Import
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importAll(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      </div>

      {/* ---- advanced ---- */}
      <button className="set-toggle" onClick={() => setShowAdvanced((v) => !v)} data-pressable>
        <Icon name="chevron" size={13} className={showAdvanced ? 'rot-down' : ''} />
        Database connection
      </button>

      {showAdvanced && (
        <div className="set-block">
          <Field label="Supabase URL"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxx.supabase.co" autoComplete="off" spellCheck={false} /></Field>
          <Field label="Anon key"><input value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJ…" autoComplete="off" spellCheck={false} /></Field>
          <button
            className="btn btn-accent btn-block btn-sm"
            onClick={() => {
              setConfig(url, key)
              toast('Saved — reloading')
              setTimeout(() => location.reload(), 500)
            }}
            data-pressable
          >
            Save and reload
          </button>
        </div>
      )}

      <button
        className="btn btn-danger btn-block"
        onClick={async () => {
          const ok = await confirm({ title: 'Sign out?', body: 'You’ll need the passcode again.', confirmLabel: 'Sign out', danger: true })
          if (ok) await session.signOut()
        }}
        data-pressable
      >
        Sign out
      </button>

      <div className="set-foot">
        <Logo size={22} />
        <span>Ours. Nobody else's.</span>
      </div>
    </Sheet>
  )
}
