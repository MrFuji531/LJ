import { useEffect, useState } from 'react'

import type { Profile } from '../lib/session'
import * as tmdb from '../lib/tmdb'
import {
  avgOf, episodeOut, finaleSeen, fmtDay, hasAired, notesKey, relDay, scoreKey, seasonLabel,
  seriesEnded, untouched, type PileStatus, type SeasonRow, type ShowScore, type TitleRow,
} from '../lib/titles'
import { Icon } from '../components/Icon'
import { Field, ScorePair, Sheet } from '../components/ui'

/* ==========================================================================
   One show, all its seasons.

   The sheet is the same whichever pile the show is in — what changes is
   which actions each season offers. The "where are you up to?" question
   only shows while nothing has been touched, so a show you're three
   seasons into before the app existed never gets auto-rated.
   ========================================================================== */

export type ShowView = {
  t: TitleRow
  seasons: SeasonRow[]
  status: PileStatus
  score: ShowScore
}

export type CatchUpMode = 'fresh' | 'skip' | 'rate'

export function ShowSheet({
  show,
  me,
  them,
  onClose,
  onCatchUp,
  onSeasonStatus,
  onRate,
  onSeenEpisode,
  onOpenSeason,
  onDrop,
  onRevive,
  onDelete,
}: {
  show: ShowView | null
  me: Profile
  them: Profile
  onClose: () => void
  onCatchUp: (show: ShowView, mode: CatchUpMode, upTo: number) => void
  onSeasonStatus: (show: ShowView, s: SeasonRow, status: SeasonRow['status']) => void
  onRate: (show: ShowView, s: SeasonRow) => void
  onSeenEpisode: (show: ShowView, s: SeasonRow) => void
  onOpenSeason: (show: ShowView, s: SeasonRow) => void
  onDrop: (show: ShowView) => void
  onRevive: (show: ShowView) => void
  onDelete: (t: TitleRow) => void
}) {
  const [upTo, setUpTo] = useState(1)

  const aired = show ? show.seasons.filter((s) => hasAired(s.air_date)) : []
  useEffect(() => {
    if (!show) return
    setUpTo(Math.max(1, aired.length - 1 || 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show?.t.id])

  if (!show) return null
  const { t, seasons, status, score } = show
  const askCatchUp = status !== 'dropped' && untouched(seasons) && aired.length > 1

  return (
    <Sheet
      open
      onClose={onClose}
      title={t.title}
      footer={
        <>
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(t)} aria-label="Delete" data-pressable>
            <Icon name="trash" size={15} />
          </button>
          {status === 'dropped' ? (
            <button className="btn btn-accent" onClick={() => onRevive(show)} data-pressable>
              <Icon name="undo" size={15} /> Give it another go
            </button>
          ) : (
            <button className="btn btn-quiet" onClick={() => onDrop(show)} data-pressable>
              Not finishing this
            </button>
          )}
        </>
      }
    >
      {t.new_season && status === 'towatch' && (
        <div className="new-season-banner">
          <span>📣</span> A new season is out.
        </div>
      )}

      <div className="edit-head">
        <div className="poster edit-poster">
          {tmdb.IMG(t.poster_path, 'w342') ? (
            <img src={tmdb.IMG(t.poster_path, 'w342')!} alt="" />
          ) : (
            <span className="poster-fallback">{t.title[0]}</span>
          )}
        </div>
        <div className="grow edit-facts">
          {t.year && <div><span className="eyebrow">Year</span><span className="num">{t.year}</span></div>}
          {t.director && <div><span className="eyebrow">Creator</span><span>{t.director}</span></div>}
          {seasons.length ? (
            <div>
              <span className="eyebrow">Seasons</span>
              <span className="num">
                {aired.length}
                {aired.length !== seasons.length ? ` of ${seasons.length} out` : ''}
              </span>
            </div>
          ) : t.seasons ? (
            <div><span className="eyebrow">Seasons</span><span className="num">{t.seasons}</span></div>
          ) : null}
          {t.tmdb_status && (
            <div>
              <span className="eyebrow">Status</span>
              <span>{seriesEnded(t) ? t.tmdb_status : t.tmdb_status === 'Returning Series' ? 'Returning' : t.tmdb_status}</span>
            </div>
          )}
        </div>
      </div>

      {t.genres?.length ? (
        <div className="pos-chips">
          {t.genres.map((g) => <span key={g} className="chip">{g}</span>)}
        </div>
      ) : null}

      {t.overview && <p className="edit-blurb selectable">{t.overview}</p>}

      {score.rated > 0 && (
        <div className="show-score">
          <ScorePair
            mine={me.slug === 'james' ? score.james : score.lee}
            theirs={them.slug === 'james' ? score.james : score.lee}
            myName={me.name}
            theirName={them.name}
          />
          <div className="show-score-caption eyebrow">
            {score.final
              ? 'Final — the series has ended'
              : `After ${score.rated} of ${score.aired} season${score.aired === 1 ? '' : 's'}`}
          </div>
        </div>
      )}

      {askCatchUp && (
        <div className="catchup">
          <div className="catchup-title display">Where are you up to?</div>
          <button className="btn btn-outline btn-block" onClick={() => onCatchUp(show, 'fresh', 0)} data-pressable>
            <Icon name="play" size={15} /> First time — start at season 1
          </button>
          <div className="catchup-upto">
            <span>Seen up to</span>
            <select value={upTo} onChange={(e) => setUpTo(Number(e.target.value))}>
              {aired.map((s) => (
                <option key={s.id} value={s.season_number}>{seasonLabel(s)}</option>
              ))}
            </select>
          </div>
          <div className="catchup-row">
            <button className="btn btn-quiet btn-sm" onClick={() => onCatchUp(show, 'skip', upTo)} data-pressable>
              Skip those — don't count them
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => onCatchUp(show, 'rate', upTo)} data-pressable>
              We'll rate those
            </button>
          </div>
        </div>
      )}

      {seasons.length > 0 && (
        <div className="stack">
          <span className="eyebrow">Seasons</span>
          {seasons.map((s) => (
            <SeasonRowView
              key={s.id}
              t={t}
              s={s}
              dropped={status === 'dropped'}
              onStatus={(st) => onSeasonStatus(show, s, st)}
              onRate={() => onRate(show, s)}
              onSeen={() => onSeenEpisode(show, s)}
              onOpen={() => onOpenSeason(show, s)}
            />
          ))}
        </div>
      )}
    </Sheet>
  )
}

function SeasonRowView({
  t,
  s,
  dropped,
  onStatus,
  onRate,
  onSeen,
  onOpen,
}: {
  t: TitleRow
  s: SeasonRow
  dropped: boolean
  onStatus: (st: SeasonRow['status']) => void
  onRate: () => void
  onSeen: () => void
  onOpen: () => void
}) {
  const aired = hasAired(s.air_date)
  const avg = avgOf(s)
  const epOut = episodeOut(t, s)
  const finale = finaleSeen(t, s)
  const customName = s.name && !/^season\s+\d+$/i.test(s.name) ? s.name : null
  const airing = t.next_episode?.season === s.season_number && t.next_episode.air_date

  const meta: string[] = []
  if (s.air_date) meta.push(aired ? String(s.air_date.slice(0, 4)) : `Airs ${relDay(s.air_date)}`)
  else meta.push('Not scheduled')
  if (s.episode_count) meta.push(`${s.episode_count} ep${s.episode_count === 1 ? '' : 's'}`)
  if (s.status === 'watching' && s.episodes_seen) meta.push(`seen ${s.episodes_seen}`)

  const rated = s.status === 'watched' && avg != null

  return (
    <div className={`season-row ${rated ? 'is-rated' : ''}`}>
      {(() => {
        const body = (
          <>
            <div className="season-name">
              {seasonLabel(s)}
              {customName && <span className="season-custom"> · {customName}</span>}
            </div>
            <div className="season-meta">{meta.join(' · ')}</div>
            {s.status === 'watching' && epOut != null && (
              <div className="season-ep">
                Episode {epOut} out{t.last_episode?.air_date ? ` · ${relDay(t.last_episode.air_date)}` : ''}
              </div>
            )}
            {s.status === 'watching' && epOut == null && airing && (
              <div className="season-ep muted">Next episode {relDay(t.next_episode!.air_date!)}</div>
            )}
          </>
        )
        return rated ? (
          <button className="season-main" onClick={onOpen} data-pressable data-press-scale="subtle">
            {body}
          </button>
        ) : (
          <div className="season-main">{body}</div>
        )
      })()}

      <div className="season-side">
        {rated ? (
          <>
            <div className="season-scores">
              <span className="num" style={{ color: 'var(--rose)' }}>{s.score_james?.toFixed(1) ?? '—'}</span>
              <span className="title-scores-sep">/</span>
              <span className="num" style={{ color: 'var(--gold)' }}>{s.score_lee?.toFixed(1) ?? '—'}</span>
            </div>
            <div className="season-avg display">{avg!.toFixed(1)}</div>
          </>
        ) : s.status === 'watched' ? (
          <>
            <span className="chip">Seen</span>
            <button className="btn btn-accent btn-sm" onClick={onRate} data-pressable>Rate it</button>
          </>
        ) : s.status === 'skipped' ? (
          <>
            <span className="chip chip-wait">Seen before</span>
            <button className="btn btn-quiet btn-sm" onClick={onRate} data-pressable>Rate anyway</button>
          </>
        ) : s.status === 'watching' ? (
          <>
            {epOut != null ? (
              <button className="btn btn-outline btn-sm" onClick={onSeen} data-pressable>
                <Icon name="check" size={14} /> Seen ep {epOut}
              </button>
            ) : (
              <span className="chip chip-new">Watching</span>
            )}
            <button className={`btn btn-sm ${finale ? 'btn-accent' : 'btn-outline'}`} onClick={onRate} data-pressable>
              {finale ? 'Finale seen — rate it' : 'Finished'}
            </button>
            <button className="btn btn-quiet btn-sm" onClick={() => onStatus('towatch')} data-pressable>
              Back to list
            </button>
          </>
        ) : aired ? (
          <>
            {!dropped && (
              <button className="btn btn-outline btn-sm" onClick={() => onStatus('watching')} data-pressable>
                <Icon name="play" size={14} /> Start
              </button>
            )}
            <button className="btn btn-quiet btn-sm" onClick={onRate} data-pressable>Rate it</button>
            <button className="btn btn-quiet btn-sm" onClick={() => onStatus('skipped')} data-pressable>Skip</button>
          </>
        ) : (
          <span className="chip chip-wait">{s.air_date ? fmtDay(s.air_date) : 'Coming'}</span>
        )}
      </div>
    </div>
  )
}

/** One rated season: scores are read-only; re-rating is a ritual. */
export function SeasonSheet({
  show,
  season: s,
  me,
  them,
  onClose,
  onSave,
  onRerate,
}: {
  show: ShowView | null
  season: SeasonRow | null
  me: Profile
  them: Profile
  onClose: () => void
  onSave: (patch: Partial<SeasonRow> & { id: string }) => void
  onRerate: (show: ShowView, s: SeasonRow) => void
}) {
  const [note, setNote] = useState('')
  const [watchedDate, setWatchedDate] = useState('')

  useEffect(() => {
    if (!s) return
    setNote(s[notesKey(me.slug)] ?? '')
    setWatchedDate(s.watched_on ?? '')
  }, [s, me.slug])

  if (!show || !s) return null

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${show.t.title} — ${seasonLabel(s)}`}
      footer={
        <button
          className="btn btn-accent"
          onClick={() =>
            onSave({
              id: s.id,
              [notesKey(me.slug)]: note.trim() || null,
              watched_on: watchedDate || null,
            } as Partial<SeasonRow> & { id: string })
          }
          data-pressable
        >
          Save
        </button>
      }
    >
      <ScorePair
        mine={s[scoreKey(me.slug)]}
        theirs={s[scoreKey(them.slug)]}
        myName={me.name}
        theirName={them.name}
      />

      <button className="btn btn-outline btn-block btn-sm" onClick={() => onRerate(show, s)} data-pressable>
        <Icon name="shuffle" size={14} /> Rate it again
      </button>

      <Field label="Watched on">
        <input type="date" value={watchedDate} onChange={(e) => setWatchedDate(e.target.value)} />
      </Field>

      <Field label={`${me.name}'s note`}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you make of it?" />
      </Field>

      {s[notesKey(them.slug)] && (
        <div className="their-note">
          <span className="eyebrow">{them.name} said</span>
          <p className="selectable">{s[notesKey(them.slug)]}</p>
        </div>
      )}
    </Sheet>
  )
}

/** Just rated a season and the next one is already out. */
export function NextSeasonSheet({
  show,
  next,
  onClose,
  onStart,
  onList,
  onDrop,
}: {
  show: ShowView | null
  next: SeasonRow | null
  onClose: () => void
  onStart: () => void
  onList: () => void
  onDrop: () => void
}) {
  if (!show || !next) return null
  return (
    <Sheet open onClose={onClose} title={`${seasonLabel(next)} is out`}>
      <p className="edit-blurb">
        {show.t.title} has more. Straight into it, or leave it on the list for later?
      </p>
      <button className="btn btn-accent btn-block" onClick={onStart} data-pressable>
        <Icon name="play" size={15} /> Straight into {seasonLabel(next).toLowerCase()}
      </button>
      <button className="btn btn-outline btn-block" onClick={onList} data-pressable>
        Back to the list
      </button>
      <button className="btn btn-quiet btn-block" onClick={onDrop} data-pressable>
        Not finishing this
      </button>
    </Sheet>
  )
}
