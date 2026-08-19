import { collection } from './collection'

/* ==========================================================================
   The Year-in-Review ledger.

   Every meaningful moment — a position done, a cuisine ranked, a title
   watched, a venue visited, an MCU tick, a todo crossed off, a hat pulled —
   lands in one dated table. The id is deterministic (room:kind:ref), so
   logging the same thing again (say, after correcting the date) overwrites
   its own entry instead of duplicating it.
   ========================================================================== */

export type EventRow = {
  id: string
  room: string
  kind: string
  ref_id: string | null
  label: string | null
  happened_on: string | null
  meta: Record<string, unknown> | null
  added_by: string | null
  created_at?: string
  updated_at?: string
}

const events = () => collection<EventRow>('lj_events')

export const today = () => new Date().toISOString().slice(0, 10)

export function logEvent(e: {
  room: string
  kind: string
  refId: string
  label: string
  happenedOn?: string | null
  meta?: Record<string, unknown>
  by?: string | null
}) {
  void events().upsert({
    id: `${e.room}:${e.kind}:${e.refId}`,
    room: e.room,
    kind: e.kind,
    ref_id: e.refId,
    label: e.label,
    happened_on: e.happenedOn || today(),
    meta: e.meta ?? {},
    added_by: e.by ?? null,
  })
}

/** For un-ticking: the moment didn't happen after all. */
export function unlogEvent(room: string, kind: string, refId: string) {
  void events().remove(`${room}:${kind}:${refId}`)
}
