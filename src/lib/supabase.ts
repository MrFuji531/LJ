import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Connection config resolves in this order:
 *   1. localStorage  — set in-app via Settings, so you can point at a new
 *      project from the phone without a rebuild.
 *   2. build-time env — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * If neither is present the app runs fully local; nothing breaks, it just
 * doesn't sync.
 */
const LS_URL = 'lj.supabase.url'
const LS_KEY = 'lj.supabase.key'

export function getConfig() {
  const url = localStorage.getItem(LS_URL) || import.meta.env.VITE_SUPABASE_URL || ''
  const key = localStorage.getItem(LS_KEY) || import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  return { url: url.trim().replace(/\/$/, ''), key: key.trim() }
}

export function setConfig(url: string, key: string) {
  localStorage.setItem(LS_URL, url.trim().replace(/\/$/, ''))
  localStorage.setItem(LS_KEY, key.trim())
}

export function clearConfig() {
  localStorage.removeItem(LS_URL)
  localStorage.removeItem(LS_KEY)
}

let client: SupabaseClient | null = null
let clientSignature = ''

/** Returns null when unconfigured — every caller must handle local-only mode. */
export function sb(): SupabaseClient | null {
  const { url, key } = getConfig()
  if (!url || !key) return null

  const signature = `${url}::${key}`
  if (client && clientSignature === signature) return client

  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'lj.auth',
    },
    realtime: {
      // Two people. No need to burn quota on a fast tick.
      params: { eventsPerSecond: 5 },
    },
  })
  clientSignature = signature
  return client
}

export function isConfigured() {
  const { url, key } = getConfig()
  return Boolean(url && key)
}
