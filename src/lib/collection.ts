import { useSyncExternalStore, useCallback, useMemo } from 'react'
import { sb, isConfigured } from './supabase'

/* ==========================================================================
   Local-first collection store.

   Contract:
   - Reads paint instantly from a localStorage cache, then reconcile with the
     server. The UI never waits on the network.
   - Writes apply locally first, then push. If the push fails (offline, server
     asleep) the mutation lands in an outbox and is retried on reconnect.
   - One realtime channel per table, shared by every component that mounts it,
     so eight tabs don't open eight sockets.
   - Conflicts resolve last-write-wins on `updated_at`. Correct enough for two
     people who are rarely editing the same row in the same second.
   ========================================================================== */

type Row = Record<string, any>

const OUTBOX_KEY = 'lj.outbox.v1'

type OutboxEntry =
  | { op: 'upsert'; table: string; row: Row; at: number }
  | { op: 'delete'; table: string; pk: string; id: any; at: number }

function readOutbox(): OutboxEntry[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]')
  } catch {
    return []
  }
}

function writeOutbox(entries: OutboxEntry[]) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries.slice(-500)))
}

function queue(entry: OutboxEntry) {
  const box = readOutbox()
  // Collapse repeated writes to the same row — only the newest matters.
  const key = entry.op === 'upsert' ? `u:${entry.table}:${JSON.stringify(entry.row)}` : null
  const filtered = key
    ? box.filter((e) => !(e.op === 'upsert' && e.table === entry.table && sameId(e.row, (entry as any).row)))
    : box
  filtered.push(entry)
  writeOutbox(filtered)
}

function sameId(a: Row, b: Row) {
  for (const k of ['id', 'position_id', 'country', 'item', 'slug']) {
    if (a[k] !== undefined && b[k] !== undefined) return a[k] === b[k]
  }
  return false
}

/* -------------------------------------------------------------------------- */

export type SyncState = 'local' | 'loading' | 'live' | 'offline' | 'error'

class Collection<T extends Row> {
  table: string
  pk: string
  rows = new Map<string, T>()
  status: SyncState = 'local'
  private listeners = new Set<() => void>()
  private channel: any = null
  private loaded = false
  private snapshotCache: T[] = []
  private dirty = true

  constructor(table: string, pk: string) {
    this.table = table
    this.pk = pk
    this.hydrate()
  }

  private cacheKey() {
    return `lj.cache.${this.table}`
  }

  private hydrate() {
    try {
      const raw = localStorage.getItem(this.cacheKey())
      if (raw) {
        const arr: T[] = JSON.parse(raw)
        for (const r of arr) this.rows.set(String(r[this.pk]), r)
      }
    } catch {
      /* corrupt cache is not worth crashing over */
    }
  }

  private persist() {
    try {
      localStorage.setItem(this.cacheKey(), JSON.stringify([...this.rows.values()]))
    } catch {
      /* quota — the server is still the source of truth */
    }
  }

  private emit() {
    this.dirty = true
    this.persist()
    for (const fn of this.listeners) fn()
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    if (!this.loaded) {
      this.loaded = true
      void this.load()
      this.watch()
    }
    return () => {
      this.listeners.delete(fn)
      if (this.listeners.size === 0) {
        this.channel?.unsubscribe()
        this.channel = null
        this.loaded = false
      }
    }
  }

  snapshot = (): T[] => {
    if (this.dirty) {
      this.snapshotCache = [...this.rows.values()]
      this.dirty = false
    }
    return this.snapshotCache
  }

  getStatus = () => this.status

  async load() {
    const client = sb()
    if (!client) {
      this.status = 'local'
      this.emit()
      return
    }
    this.status = 'loading'
    this.emit()

    const { data, error } = await client.from(this.table).select('*')
    if (error) {
      this.status = navigator.onLine ? 'error' : 'offline'
      this.emit()
      return
    }

    // Server is authoritative for existence: a row deleted on her phone must
    // disappear here too, so we replace rather than merge.
    this.rows = new Map((data as T[]).map((r) => [String(r[this.pk]), r]))
    this.status = 'live'
    this.emit()
    void flushOutbox()
  }

  private watch() {
    const client = sb()
    if (!client) return
    this.channel = client
      .channel(`lj:${this.table}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: this.table },
        (payload: any) => {
          if (payload.eventType === 'DELETE') {
            const id = String(payload.old?.[this.pk])
            this.rows.delete(id)
          } else {
            const row = payload.new as T
            this.rows.set(String(row[this.pk]), row)
          }
          this.emit()
        },
      )
      .subscribe((s: string) => {
        if (s === 'SUBSCRIBED') {
          this.status = 'live'
          this.emit()
        }
      })
  }

  /** Optimistic upsert. Resolves once the server has it (or it's queued). */
  async upsert(partial: Partial<T>): Promise<T> {
    const id = partial[this.pk as keyof T]
    const key = String(id)
    const existing = this.rows.get(key)
    const row = {
      ...(existing || {}),
      ...partial,
      updated_at: new Date().toISOString(),
    } as unknown as T

    this.rows.set(key, row)
    this.emit()

    const client = sb()
    if (!client) return row

    const { error } = await client.from(this.table).upsert(row as any, { onConflict: this.pk })
    if (error) {
      queue({ op: 'upsert', table: this.table, row, at: Date.now() })
      this.status = navigator.onLine ? 'error' : 'offline'
      this.emit()
    }
    return row
  }

  async remove(id: any) {
    this.rows.delete(String(id))
    this.emit()

    const client = sb()
    if (!client) return

    const { error } = await client.from(this.table).delete().eq(this.pk, id)
    if (error) {
      queue({ op: 'delete', table: this.table, pk: this.pk, id, at: Date.now() })
    }
  }

  /** Replace every row in the table. Used by reset + import. */
  async replaceAll(rows: T[]) {
    this.rows = new Map(rows.map((r) => [String(r[this.pk]), r]))
    this.emit()

    const client = sb()
    if (!client) return
    await client.from(this.table).delete().neq(this.pk, '__never__')
    if (rows.length) await client.from(this.table).upsert(rows as any)
  }

  async clear() {
    await this.replaceAll([])
  }
}

/* -------------------------------------------------------------------------- */

const registry = new Map<string, Collection<any>>()

export function collection<T extends Row>(table: string, pk = 'id'): Collection<T> {
  let c = registry.get(table)
  if (!c) {
    c = new Collection<T>(table, pk)
    registry.set(table, c)
  }
  return c as Collection<T>
}

export async function flushOutbox() {
  const client = sb()
  if (!client || !navigator.onLine) return

  const box = readOutbox()
  if (!box.length) return

  const survivors: OutboxEntry[] = []
  for (const entry of box) {
    try {
      if (entry.op === 'upsert') {
        const { error } = await client.from(entry.table).upsert(entry.row as any)
        if (error) survivors.push(entry)
      } else {
        const { error } = await client.from(entry.table).delete().eq(entry.pk, entry.id)
        if (error) survivors.push(entry)
      }
    } catch {
      survivors.push(entry)
    }
  }
  writeOutbox(survivors)
}

export function reloadAll() {
  for (const c of registry.values()) void c.load()
}

export function pendingWrites() {
  return readOutbox().length
}

/* -------------------------------------------------------------------------- */

export function useCollection<T extends Row>(table: string, pk = 'id') {
  const store = useMemo(() => collection<T>(table, pk), [table, pk])

  const rows = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  const status = useSyncExternalStore(store.subscribe, store.getStatus, store.getStatus)

  const upsert = useCallback((row: Partial<T>) => store.upsert(row), [store])
  const remove = useCallback((id: any) => store.remove(id), [store])
  const replaceAll = useCallback((next: T[]) => store.replaceAll(next), [store])
  const clear = useCallback(() => store.clear(), [store])

  return { rows, status, upsert, remove, replaceAll, clear, reload: () => store.load() }
}

/* Reconnect handling ------------------------------------------------------- */

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void flushOutbox()
    reloadAll()
  })
  document.addEventListener('visibilitychange', () => {
    // Coming back from the lock screen is the most common way a phone finds
    // out it missed changes while the socket was suspended.
    if (document.visibilityState === 'visible' && isConfigured()) {
      void flushOutbox()
      reloadAll()
    }
  })
}
