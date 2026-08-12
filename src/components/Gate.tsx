import { useEffect, useRef, useState } from 'react'
import './Gate.css'
import { Logo } from './Logo'
import { Icon } from './Icon'
import { PROFILES, type useSession } from '../lib/session'

export function Gate({ session }: { session: ReturnType<typeof useSession> }) {
  const { state, error, busy, chooseProfile, signIn, back } = session
  const [code, setCode] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const asking = state.kind === 'needs-passcode'
  const who = asking ? state.who : null
  const profile = PROFILES.find((p) => p.slug === who)

  useEffect(() => {
    if (asking) setTimeout(() => inputRef.current?.focus(), 380)
    else setCode('')
  }, [asking])

  return (
    <div className="gate">
      <div className="gate-glow" aria-hidden />

      <div className="gate-mark">
        <Logo size={78} animate />
      </div>

      {!asking ? (
        <div className="gate-panel rise">
          <p className="gate-kicker eyebrow">Who's holding the phone?</p>
          <div className="gate-people">
            {PROFILES.map((p, i) => (
              <button
                key={p.slug}
                className="person"
                style={{ ['--who' as string]: p.accent, animationDelay: `${i * 70}ms` }}
                onClick={() => chooseProfile(p.slug)}
                data-pressable
              >
                <span className="person-initial display">{p.name[0]}</span>
                <span className="person-name">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="gate-panel rise">
          <button className="gate-back" onClick={back} data-pressable>
            <Icon name="chevron" size={14} className="flip" />
            Not {profile?.name}?
          </button>

          <p className="gate-kicker eyebrow">
            Hi {profile?.name} — passcode
          </p>

          <form
            className="gate-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (who && code) void signIn(who, code)
            }}
          >
            <input
              ref={inputRef}
              className="gate-input"
              type="password"
              inputMode="text"
              autoComplete="current-password"
              placeholder="••••••••"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label="Passcode"
            />
            <button
              className="btn btn-accent gate-go"
              type="submit"
              disabled={!code || busy}
              style={{ ['--accent' as string]: profile?.accent }}
              data-pressable
            >
              {busy ? 'Opening…' : 'Enter'}
            </button>
          </form>

          {error && <p className="gate-error">{error}</p>}
        </div>
      )}

      <p className="gate-foot">Ours. Nobody else's.</p>
    </div>
  )
}
