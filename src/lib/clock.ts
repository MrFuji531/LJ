/**
 * Server-clock offset.
 *
 * Shared countdowns must never be streamed tick-by-tick — the two phones would
 * disagree by whatever the network jitter is that second. Instead we broadcast
 * one absolute end timestamp and each device counts down locally against a
 * clock corrected to the server's. Both phones then agree to within a few ms
 * even if one receives the start message hundreds of ms late.
 */

import { sb } from './supabase'

let offset = 0
let measured = false

/** ms to ADD to Date.now() to get server time. */
export function clockOffset() {
  return offset
}

export function serverNow() {
  return Date.now() + offset
}

export function isClockSynced() {
  return measured
}

/**
 * One round trip, halved — the standard NTP approximation. Good to ~±RTT/2,
 * which for Sydney from Melbourne is single-digit ms.
 */
export async function syncClock(): Promise<number> {
  const client = sb()
  if (!client) return offset

  try {
    const samples: number[] = []
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      const wall = Date.now()
      const { data, error } = await client.rpc('lj_server_time')
      const rtt = performance.now() - t0
      if (error || !data) continue

      const serverMs = new Date(data as string).getTime()
      if (!Number.isFinite(serverMs)) continue
      samples.push(serverMs + rtt / 2 - wall)
    }

    if (samples.length) {
      // Median beats mean here: one slow round trip shouldn't drag the estimate.
      samples.sort((a, b) => a - b)
      offset = samples[Math.floor(samples.length / 2)]
      measured = true
    }
  } catch {
    /* stay on the device clock */
  }
  return offset
}

/** Remaining ms against a server-authoritative deadline. Never negative. */
export function remainingMs(endsAtIso: string | number | null | undefined) {
  if (!endsAtIso) return 0
  const end = typeof endsAtIso === 'number' ? endsAtIso : new Date(endsAtIso).getTime()
  if (!Number.isFinite(end)) return 0
  return Math.max(0, end - serverNow())
}
