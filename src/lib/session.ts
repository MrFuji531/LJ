import { useCallback, useEffect, useState } from 'react'
import { sb, isConfigured } from './supabase'
import { syncClock } from './clock'
import { reloadAll } from './collection'

/* ==========================================================================
   Session.

   The UX is "pick who you are, then one shared passcode" — but underneath it
   is real Supabase auth. Each profile maps to a fixed account whose password
   IS the shared passcode. That way row-level security actually applies (the
   data is unreadable to anyone holding just the URL and the anon key) while
   the login still takes two taps.
   ========================================================================== */

export type ProfileSlug = 'james' | 'lee'

export type Profile = {
  slug: ProfileSlug
  name: string
  email: string
  accent: string
}

export const PROFILES: Profile[] = [
  { slug: 'james', name: 'James', email: 'james@lj.app', accent: 'var(--rose)' },
  { slug: 'lee', name: 'Lee', email: 'lee@lj.app', accent: 'var(--gold)' },
]

export function profileOf(slug: string | null | undefined): Profile | null {
  return PROFILES.find((p) => p.slug === slug) ?? null
}

export function otherProfile(slug: ProfileSlug): Profile {
  return PROFILES.find((p) => p.slug !== slug)!
}

const LS_WHO = 'lj.who'

export function storedProfile(): ProfileSlug | null {
  const v = localStorage.getItem(LS_WHO)
  return v === 'james' || v === 'lee' ? v : null
}

/* -------------------------------------------------------------------------- */

export type AuthState =
  | { kind: 'booting' }
  /** No Supabase configured — the app works, it just doesn't sync. */
  | { kind: 'local'; who: ProfileSlug }
  | { kind: 'needs-profile' }
  | { kind: 'needs-passcode'; who: ProfileSlug }
  | { kind: 'ready'; who: ProfileSlug }

export function useSession() {
  const [state, setState] = useState<AuthState>({ kind: 'booting' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true

    void (async () => {
      const who = storedProfile()
      const client = sb()

      if (!client) {
        // Local-only mode still wants to know whose rating is whose.
        if (!alive) return
        setState(who ? { kind: 'local', who } : { kind: 'needs-profile' })
        return
      }

      const { data } = await client.auth.getSession()
      if (!alive) return

      if (data.session) {
        const email = data.session.user.email ?? ''
        const match = PROFILES.find((p) => p.email === email)
        const resolved = match?.slug ?? who
        if (resolved) {
          localStorage.setItem(LS_WHO, resolved)
          setState({ kind: 'ready', who: resolved })
          void syncClock()
          return
        }
      }
      setState(who ? { kind: 'needs-passcode', who } : { kind: 'needs-profile' })
    })()

    return () => {
      alive = false
    }
  }, [])

  const chooseProfile = useCallback((who: ProfileSlug) => {
    localStorage.setItem(LS_WHO, who)
    setError(null)
    setState(isConfigured() ? { kind: 'needs-passcode', who } : { kind: 'local', who })
  }, [])

  const back = useCallback(() => {
    setError(null)
    setState({ kind: 'needs-profile' })
  }, [])

  const signIn = useCallback(async (who: ProfileSlug, passcode: string) => {
    const client = sb()
    if (!client) {
      setState({ kind: 'local', who })
      return true
    }
    const profile = profileOf(who)!
    setBusy(true)
    setError(null)

    const { error: err } = await client.auth.signInWithPassword({
      email: profile.email,
      password: passcode,
    })
    setBusy(false)

    if (err) {
      setError(
        /invalid/i.test(err.message)
          ? 'That passcode is wrong.'
          : err.message,
      )
      return false
    }

    localStorage.setItem(LS_WHO, who)
    setState({ kind: 'ready', who })
    void syncClock()
    reloadAll()
    return true
  }, [])

  const signOut = useCallback(async () => {
    await sb()?.auth.signOut()
    setState({ kind: 'needs-profile' })
  }, [])

  /** Swap identity without signing out — for when you hand over the phone. */
  const switchProfile = useCallback(
    async (who: ProfileSlug) => {
      localStorage.setItem(LS_WHO, who)
      if (!isConfigured()) {
        setState({ kind: 'local', who })
        return
      }
      await sb()?.auth.signOut()
      setState({ kind: 'needs-passcode', who })
    },
    [],
  )

  return { state, error, busy, chooseProfile, signIn, signOut, switchProfile, back }
}
