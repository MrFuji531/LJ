import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './RateReveal.css'

import type { TitleRow } from '../tabs/Titles'
import { scoreKey, pendingKey } from '../tabs/Titles'
import { collection } from '../lib/collection'
import { logEvent } from '../lib/events'
import { otherProfile, type Profile } from '../lib/session'
import * as tmdb from '../lib/tmdb'
import { RatingBar } from './ui'

/* ==========================================================================
   The blind rating ritual.

   Both people lock in a score out of 5 without seeing the other's — either
   from their own phones (realtime carries the second submit across) or by
   handing one phone over. The moment both are in: 3… 2… 1… and the two
   scores flip over together, the average stamps itself on, and the title
   lands in the Watched pile.
   ========================================================================== */

type Stage = 'mine' | 'handoff' | 'theirs' | 'countdown' | 'reveal'

const gapLine = (a: number, b: number) => {
  const gap = Math.abs(a - b)
  if (gap === 0) return 'Perfectly in sync.'
  if (gap <= 0.5) return 'Practically the same brain.'
  if (gap < 1.5) return 'Close enough.'
  if (gap < 2.5) return 'Someone has explaining to do.'
  return 'Debate at dinner.'
}

export function RateReveal({
  row,
  me,
  onDone,
  onClose,
}: {
  row: TitleRow
  me: Profile
  /** Fired after the reveal has played and the scores are final. */
  onDone: (row: TitleRow) => void
  onClose: () => void
}) {
  const them = otherProfile(me.slug)

  const myPending = row[pendingKey(me.slug)]
  const theirPending = row[pendingKey(them.slug)]

  const [stage, setStage] = useState<Stage>(() =>
    myPending != null && theirPending != null ? 'countdown' : myPending != null ? 'handoff' : 'mine',
  )
  const [draft, setDraft] = useState<number | null>(null)
  const [count, setCount] = useState(3)
  // The reveal works from a frozen copy so the finalise write (which clears
  // the pendings) can't blank the numbers mid-animation.
  const [final, setFinal] = useState<{ mine: number; theirs: number } | null>(null)
  const [shownAvg, setShownAvg] = useState(0)
  const [avgOn, setAvgOn] = useState(false)
  const finalised = useRef(false)

  const submit = (who: Profile) => {
    if (draft == null) return
    void onSubmitScore(row, who, draft)
    setDraft(null)
    if (who.slug === me.slug) setStage(theirPending != null ? 'countdown' : 'handoff')
    // Submitting the second score flips both pendings non-null; the effect
    // below catches it on the next row update.
  }

  // Both scores in → run the countdown, whoever's phone this is.
  useEffect(() => {
    if (stage === 'countdown' || stage === 'reveal') return
    if (myPending != null && theirPending != null) setStage('countdown')
  }, [myPending, theirPending, stage])

  useEffect(() => {
    if (stage !== 'countdown') return
    setFinal({ mine: myPending!, theirs: theirPending! })
    setCount(3)
    const t1 = setTimeout(() => setCount(2), 800)
    const t2 = setTimeout(() => setCount(1), 1600)
    const t3 = setTimeout(() => setStage('reveal'), 2400)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  useEffect(() => {
    if (stage !== 'reveal' || !final) return

    if (!finalised.current) {
      finalised.current = true
      void onFinalise(row, final, me, them)
    }

    // Count the average up once the two cards have flipped.
    const avg = (final.mine + final.theirs) / 2
    let raf = 0
    const t = setTimeout(() => {
      setAvgOn(true)
      const t0 = performance.now()
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / 900)
        setShownAvg(avg * (1 - Math.pow(1 - p, 3)))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, 950)

    const done = setTimeout(() => onDone(row), 3600)
    return () => {
      clearTimeout(t)
      clearTimeout(done)
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, final])

  const poster = tmdb.IMG(row.poster_path, 'w342')

  return createPortal(
    <div className="rr-overlay">
      {poster && <div className="rr-backdrop" style={{ backgroundImage: `url(${poster})` }} />}

      {(stage === 'mine' || stage === 'handoff' || stage === 'theirs') && (
        <button className="rr-x" onClick={onClose} aria-label="Close" data-pressable>
          ✕
        </button>
      )}

      <div className="rr-body">
        <div className="rr-title display">{row.title}</div>

        {stage === 'mine' && (
          <div className="rr-panel rise" key="mine">
            <span className="eyebrow rr-hint">{them.name} — no peeking</span>
            <RatingBar
              label={`${me.name}, your score`}
              value={draft}
              onChange={setDraft}
              accent={me.accent}
              max={5}
            />
            <button
              className="btn btn-accent btn-block"
              disabled={draft == null}
              onClick={() => submit(me)}
              data-pressable
            >
              {draft == null ? 'Pick your score' : `Lock in ${draft.toFixed(1)}`}
            </button>
          </div>
        )}

        {stage === 'handoff' && (
          <div className="rr-panel rise" key="handoff">
            <div className="rr-wait">
              <span className="rr-lock">🔒</span>
              <p>
                Yours is locked in. Waiting on <strong style={{ color: them.accent }}>{them.name}</strong>…
              </p>
            </div>
            <button className="btn btn-outline btn-block" onClick={() => setStage('theirs')} data-pressable>
              {them.name} is here — hand the phone over
            </button>
          </div>
        )}

        {stage === 'theirs' && (
          <div className="rr-panel rise" key="theirs">
            <span className="eyebrow rr-hint">{me.name}'s score is hidden</span>
            <RatingBar
              label={`${them.name}, your score`}
              value={draft}
              onChange={setDraft}
              accent={them.accent}
              max={5}
            />
            <button
              className="btn btn-accent btn-block"
              disabled={draft == null}
              onClick={() => submit(them)}
              data-pressable
            >
              {draft == null ? 'Pick your score' : `Lock in ${draft.toFixed(1)}`}
            </button>
          </div>
        )}

        {stage === 'countdown' && (
          <div className="rr-count display" key={count}>
            {count}
          </div>
        )}

        {stage === 'reveal' && final && (
          <div className="rr-reveal" key="reveal">
            <div className="rr-scores">
              <div className="rr-score rr-score-a">
                <span className="rr-score-value display">
                  {(me.slug === 'james' ? final.mine : final.theirs).toFixed(1)}
                </span>
                <span className="eyebrow">James</span>
              </div>
              <div className="rr-score rr-score-b">
                <span className="rr-score-value display">
                  {(me.slug === 'lee' ? final.mine : final.theirs).toFixed(1)}
                </span>
                <span className="eyebrow">Lee</span>
              </div>
            </div>
            <div className={`rr-avg ${avgOn ? 'is-on' : ''}`}>
              <span className="rr-avg-value display">{shownAvg.toFixed(1)}</span>
              <span className="eyebrow">Our score</span>
            </div>
            <div className="rr-verdict">{gapLine(final.mine, final.theirs)}</div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* -------------------------------------------------------------------------- */

async function onSubmitScore(row: TitleRow, who: Profile, score: number) {
  await collection<TitleRow>('lj_titles').upsert({
    id: row.id,
    [pendingKey(who.slug)]: score,
  } as Partial<TitleRow>)
}

async function onFinalise(
  row: TitleRow,
  final: { mine: number; theirs: number },
  me: Profile,
  them: Profile,
) {
  const watchedOn = row.watched_on ?? new Date().toISOString().slice(0, 10)
  await collection<TitleRow>('lj_titles').upsert({
    id: row.id,
    [scoreKey(me.slug)]: final.mine,
    [scoreKey(them.slug)]: final.theirs,
    status: 'watched',
    watched_on: watchedOn,
    new_season: false,
    pending_score_james: null,
    pending_score_lee: null,
  } as Partial<TitleRow>)
  logEvent({
    room: row.kind === 'movie' ? 'movies' : 'shows',
    kind: 'watched',
    refId: row.id,
    label: row.title,
    happenedOn: watchedOn,
    meta: {
      score_james: me.slug === 'james' ? final.mine : final.theirs,
      score_lee: me.slug === 'lee' ? final.mine : final.theirs,
    },
    by: me.slug,
  })
}
