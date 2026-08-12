import { useEffect, useMemo, useState } from 'react'
import './Mcu.css'

import { MCU_FILMS, MCU_BY_SLUG, PHASES, CHARACTER_KINDS, type CharacterKind } from '../data/mcu'
import { useCollection } from '../lib/collection'
import { otherProfile, type Profile } from '../lib/session'
import * as tmdb from '../lib/tmdb'
import { Icon } from '../components/Icon'
import {
  EmptyState, Field, RatingBar, ScorePair, Sheet, useConfirm, useToast, SectionTitle,
} from '../components/ui'

/* -------------------------------------------------------------------------- */

type FilmRow = {
  slug: string
  watched: boolean
  watched_on: string | null
  poster_path: string | null
  score_james: number | null
  score_lee: number | null
  notes_james: string | null
  notes_lee: string | null
  updated_at?: string
}

type CharRow = {
  id: string
  name: string
  kind: CharacterKind
  actor: string | null
  /** Text now, an image whenever you have one — paste a URL or upload later. */
  image_url: string | null
  film_slug: string | null
  score_james: number | null
  score_lee: number | null
  notes_james: string | null
  notes_lee: string | null
  added_by: string | null
  created_at?: string
  updated_at?: string
}

const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)
const sKey = (slug: string): 'score_james' | 'score_lee' =>
  slug === 'james' ? 'score_james' : 'score_lee'

const nKey = (slug: string): 'notes_james' | 'notes_lee' =>
  slug === 'james' ? 'notes_james' : 'notes_lee'

function avg(a: number | null | undefined, b: number | null | undefined) {
  const xs = [a, b].filter((x): x is number => x != null)
  return xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : null
}

/** Two initials from a name — the placeholder until there's a real picture. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/* ========================================================================== */

type View = 'films' | CharacterKind

export function McuTab({ me }: { me: Profile }) {
  const films = useCollection<FilmRow>('lj_mcu_films', 'slug')
  const chars = useCollection<CharRow>('lj_mcu_chars')
  const toast = useToast()
  const confirm = useConfirm()
  const them = otherProfile(me.slug)

  const [view, setView] = useState<View>('films')
  const [openFilm, setOpenFilm] = useState<string | null>(null)
  const [openChar, setOpenChar] = useState<CharRow | null>(null)
  const [newCharKind, setNewCharKind] = useState<CharacterKind | null>(null)
  const [fetching, setFetching] = useState(false)

  const filmBySlug = useMemo(
    () => new Map(films.rows.map((r) => [r.slug, r])),
    [films.rows],
  )

  const watchedCount = films.rows.filter((r) => r.watched).length
  const pct = Math.round((watchedCount / MCU_FILMS.length) * 100)

  const nextUp = MCU_FILMS.find((f) => !filmBySlug.get(f.slug)?.watched)

  /** Fill in posters for everything, once, if a TMDb key is present. */
  const fetchPosters = async () => {
    if (!tmdb.hasTmdb()) {
      toast('Add a TMDb key in Settings first', 'bad')
      return
    }
    setFetching(true)
    let got = 0
    for (const f of MCU_FILMS) {
      if (filmBySlug.get(f.slug)?.poster_path) continue
      try {
        const hits = await tmdb.search(f.title, 'movie')
        const hit = hits.find((h) => h.year === f.year) ?? hits[0]
        if (hit?.poster_path) {
          await films.upsert({ slug: f.slug, poster_path: hit.poster_path })
          got++
        }
      } catch {
        /* keep going; a missing poster is cosmetic */
      }
    }
    setFetching(false)
    toast(got ? `${got} posters added` : 'Nothing new to fetch', got ? 'good' : 'default')
  }

  return (
    <>
      <div className="mcu-progress card">
        <div className="spread">
          <div>
            <span className="eyebrow">The rewatch</span>
            <div className="mcu-progress-count display">
              {watchedCount} <span className="mcu-of">of {MCU_FILMS.length}</span>
            </div>
          </div>
          <div className="mcu-progress-pct display">{pct}%</div>
        </div>
        <div className="mcu-bar">
          <div className="mcu-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        {nextUp && (
          <button className="mcu-next" onClick={() => setOpenFilm(nextUp.slug)} data-pressable>
            <span className="eyebrow">Up next</span>
            <span className="mcu-next-title">{nextUp.title}</span>
            <Icon name="chevron" size={14} />
          </button>
        )}
      </div>

      <div className="seg">
        {(
          [
            ['films', 'Films'],
            ['hero', 'Heroes'],
            ['villain', 'Villains'],
            ['love', 'Loves'],
          ] as [View, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={`seg-btn ${view === id ? 'is-on' : ''}`}
            onClick={() => setView(id)}
            data-pressable
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'films' ? (
        <div className="stack">
          {PHASES.map((phase) => (
            <div key={phase} className="stack mcu-phase">
              <div className="mcu-phase-head">
                <span className="eyebrow">Phase {phase}</span>
                <span className="mcu-phase-line" />
              </div>
              {MCU_FILMS.filter((f) => f.phase === phase).map((f) => {
                const row = filmBySlug.get(f.slug)
                const a = avg(row?.score_james, row?.score_lee)
                const poster = tmdb.IMG(row?.poster_path, 'w185')
                return (
                  <button
                    key={f.slug}
                    className={`mcu-film card ${row?.watched ? 'is-watched' : ''}`}
                    onClick={() => setOpenFilm(f.slug)}
                    data-pressable
                    data-press-scale="subtle"
                  >
                    <span className="mcu-order num">{f.order}</span>
                    <div className="poster mcu-poster">
                      {poster ? <img src={poster} alt="" loading="lazy" /> : <span className="poster-fallback">M</span>}
                    </div>
                    <div className="grow mcu-film-body">
                      <div className="mcu-film-title">{f.title}</div>
                      <div className="mcu-film-meta num">{f.year}</div>
                    </div>
                    {row?.watched ? (
                      <span className="mcu-score display">{a?.toFixed(1) ?? '✓'}</span>
                    ) : (
                      <span className="mcu-unwatched" />
                    )}
                  </button>
                )
              })}
            </div>
          ))}

          <button
            className="btn btn-quiet btn-block btn-sm"
            onClick={fetchPosters}
            disabled={fetching}
            data-pressable
          >
            <Icon name="cloud" size={14} />
            {fetching ? 'Fetching posters…' : 'Fetch posters from TMDb'}
          </button>
        </div>
      ) : (
        <CharacterBoard
          kind={view}
          rows={chars.rows.filter((c) => c.kind === view)}
          onOpen={setOpenChar}
          onAdd={() => setNewCharKind(view)}
        />
      )}

      {/* ---- film sheet ---- */}
      {openFilm && (
        <FilmSheet
          slug={openFilm}
          row={filmBySlug.get(openFilm) ?? null}
          chars={chars.rows.filter((c) => c.film_slug === openFilm)}
          me={me}
          them={them}
          onClose={() => setOpenFilm(null)}
          onSave={async (patch) => {
            await films.upsert(patch)
            toast('Saved', 'good')
          }}
          onAddChar={(kind) => setNewCharKind(kind)}
          onOpenChar={setOpenChar}
        />
      )}

      {/* ---- character sheets ---- */}
      {(openChar || newCharKind) && (
        <CharacterSheet
          row={openChar}
          kind={openChar?.kind ?? newCharKind!}
          filmSlug={openFilm}
          me={me}
          them={them}
          onClose={() => {
            setOpenChar(null)
            setNewCharKind(null)
          }}
          onSave={async (patch) => {
            await chars.upsert(
              openChar
                ? { ...patch, id: openChar.id }
                : ({ ...patch, id: uid(), added_by: me.slug, created_at: new Date().toISOString() } as CharRow),
            )
            setOpenChar(null)
            setNewCharKind(null)
            toast('Saved', 'good')
          }}
          onDelete={
            openChar
              ? async () => {
                  const ok = await confirm({
                    title: `Delete ${openChar.name}?`,
                    confirmLabel: 'Delete',
                    danger: true,
                  })
                  if (!ok) return
                  await chars.remove(openChar.id)
                  setOpenChar(null)
                }
              : undefined
          }
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function Avatar({ row, size = 44 }: { row: CharRow; size?: number }) {
  const [broken, setBroken] = useState(false)
  const kind = CHARACTER_KINDS.find((k) => k.key === row.kind)!
  const show = row.image_url && !broken

  return (
    <span
      className="avatar"
      style={{ width: size, height: size, ['--who' as string]: kind.color }}
    >
      {show ? (
        <img src={row.image_url!} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className="avatar-initials display" style={{ fontSize: size * 0.36 }}>
          {initials(row.name)}
        </span>
      )}
    </span>
  )
}

function CharacterBoard({
  kind,
  rows,
  onOpen,
  onAdd,
}: {
  kind: CharacterKind
  rows: CharRow[]
  onOpen: (c: CharRow) => void
  onAdd: () => void
}) {
  const meta = CHARACTER_KINDS.find((k) => k.key === kind)!

  const ranked = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const av = avg(a.score_james, a.score_lee)
        const bv = avg(b.score_james, b.score_lee)
        if (av != null && bv != null) return bv - av
        if (av != null) return -1
        if (bv != null) return 1
        return a.name.localeCompare(b.name)
      }),
    [rows],
  )

  if (!rows.length) {
    return (
      <EmptyState
        icon={kind === 'hero' ? '🛡' : kind === 'villain' ? '😈' : '💘'}
        title={`No ${meta.plural.toLowerCase()} yet`}
        hint={`After each film, add whoever showed up and score them. The board builds itself as you work through the rewatch.`}
        action={
          <button className="btn btn-accent" onClick={onAdd} data-pressable>
            Add a {meta.label.toLowerCase()}
          </button>
        }
      />
    )
  }

  return (
    <div className="stack">
      <SectionTitle right={<span className="eyebrow">{rows.length} rated</span>}>
        {meta.plural}
      </SectionTitle>

      {ranked.map((c, i) => {
        const a = avg(c.score_james, c.score_lee)
        const film = c.film_slug ? MCU_BY_SLUG.get(c.film_slug) : null
        return (
          <button key={c.id} className="mcu-char card" onClick={() => onOpen(c)} data-pressable data-press-scale="subtle">
            <span className={`mcu-char-rank display ${a != null && i < 3 ? `is-${i + 1}` : ''}`}>
              {a != null ? i + 1 : '·'}
            </span>
            <Avatar row={c} />
            <div className="grow mcu-char-body">
              <div className="mcu-char-name">{c.name}</div>
              <div className="mcu-char-meta truncate">
                {c.actor && <span>{c.actor}</span>}
                {c.actor && film && <span className="mcu-dot">·</span>}
                {film && <span>{film.title}</span>}
              </div>
              <div className="mcu-char-scores">
                <span className="num" style={{ color: 'var(--rose)' }}>{c.score_james?.toFixed(1) ?? '—'}</span>
                <span className="mcu-sep">/</span>
                <span className="num" style={{ color: 'var(--gold)' }}>{c.score_lee?.toFixed(1) ?? '—'}</span>
              </div>
            </div>
            <span className="mcu-char-avg display">{a?.toFixed(1) ?? '—'}</span>
          </button>
        )
      })}

      <button className="btn btn-outline btn-block" onClick={onAdd} data-pressable>
        <Icon name="plus" size={16} /> Add a {meta.label.toLowerCase()}
      </button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function FilmSheet({
  slug, row, chars, me, them, onClose, onSave, onAddChar, onOpenChar,
}: {
  slug: string
  row: FilmRow | null
  chars: CharRow[]
  me: Profile
  them: Profile
  onClose: () => void
  onSave: (patch: Partial<FilmRow> & { slug: string }) => void
  onAddChar: (kind: CharacterKind) => void
  onOpenChar: (c: CharRow) => void
}) {
  const film = MCU_BY_SLUG.get(slug)!
  const [watched, setWatched] = useState(false)
  const [when, setWhen] = useState('')
  const [mine, setMine] = useState<number | null>(null)
  const [theirs, setTheirs] = useState<number | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    setWatched(row?.watched ?? false)
    setWhen(row?.watched_on ?? '')
    setMine(row?.[sKey(me.slug)] ?? null)
    setTheirs(row?.[sKey(them.slug)] ?? null)
    setNote(row?.[nKey(me.slug)] ?? '')
  }, [row, me.slug, them.slug])

  const poster = tmdb.IMG(row?.poster_path, 'w342')

  return (
    <Sheet
      open
      onClose={onClose}
      title={film.title}
      footer={
        <button
          className="btn btn-accent"
          onClick={() => {
            onSave({
              slug,
              watched: watched || mine != null || theirs != null,
              watched_on: when || null,
              [sKey(me.slug)]: mine,
              [sKey(them.slug)]: theirs,
              [nKey(me.slug)]: note.trim() || null,
            } as Partial<FilmRow> & { slug: string })
            onClose()
          }}
          data-pressable
        >
          Save
        </button>
      }
    >
      <div className="edit-head">
        <div className="poster edit-poster">
          {poster ? <img src={poster} alt="" /> : <span className="poster-fallback">{film.order}</span>}
        </div>
        <div className="grow edit-facts">
          <div><span className="eyebrow">Year</span><span className="num">{film.year}</span></div>
          <div><span className="eyebrow">Phase</span><span className="num">{film.phase}</span></div>
          <div><span className="eyebrow">Watch order</span><span className="num">#{film.order}</span></div>
        </div>
      </div>

      <button
        className={`btn btn-block ${watched ? 'btn-accent' : 'btn-quiet'}`}
        onClick={() => setWatched((w) => !w)}
        data-pressable
      >
        <Icon name="check" size={16} /> {watched ? 'Watched' : 'Mark as watched'}
      </button>

      <ScorePair mine={mine} theirs={theirs} myName={me.name} theirName={them.name} />
      <RatingBar label={`${me.name} — the film`} value={mine} onChange={setMine} accent={me.accent} />
      <RatingBar label={`${them.name} — the film`} value={theirs} onChange={setTheirs} accent={them.accent} />

      <Field label="Watched on"><input type="date" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <Field label={`${me.name}'s note`}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Holds up? Doesn't?" />
      </Field>

      {row?.[nKey(them.slug)] && (
        <div className="their-note">
          <span className="eyebrow">{them.name} said</span>
          <p className="selectable">{row[nKey(them.slug)]}</p>
        </div>
      )}

      <hr className="divider" />

      <div className="stack">
        <span className="eyebrow">Who turned up</span>
        {chars.length > 0 && (
          <div className="mcu-mini-list">
            {chars.map((c) => (
              <button key={c.id} className="mcu-mini" onClick={() => onOpenChar(c)} data-pressable>
                <Avatar row={c} size={32} />
                <span className="truncate">{c.name}</span>
                <span className="num mcu-mini-score">
                  {avg(c.score_james, c.score_lee)?.toFixed(1) ?? '—'}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mcu-add-row">
          {CHARACTER_KINDS.map((k) => (
            <button
              key={k.key}
              className="btn btn-quiet btn-sm grow"
              style={{ color: k.color }}
              onClick={() => onAddChar(k.key)}
              data-pressable
            >
              + {k.label}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  )
}

/* -------------------------------------------------------------------------- */

function CharacterSheet({
  row, kind, filmSlug, me, them, onClose, onSave, onDelete,
}: {
  row: CharRow | null
  kind: CharacterKind
  filmSlug: string | null
  me: Profile
  them: Profile
  onClose: () => void
  onSave: (patch: Partial<CharRow>) => void
  onDelete?: () => void
}) {
  const meta = CHARACTER_KINDS.find((k) => k.key === kind)!
  const [name, setName] = useState('')
  const [actor, setActor] = useState('')
  const [image, setImage] = useState('')
  const [film, setFilm] = useState<string>('')
  const [mine, setMine] = useState<number | null>(null)
  const [theirs, setTheirs] = useState<number | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    setName(row?.name ?? '')
    setActor(row?.actor ?? '')
    setImage(row?.image_url ?? '')
    setFilm(row?.film_slug ?? filmSlug ?? '')
    setMine(row?.[sKey(me.slug)] ?? null)
    setTheirs(row?.[sKey(them.slug)] ?? null)
    setNote(row?.[nKey(me.slug)] ?? '')
  }, [row, filmSlug, me.slug, them.slug])

  const preview: CharRow = {
    id: 'preview', name: name || '?', kind, actor: null, image_url: image || null,
    film_slug: null, score_james: null, score_lee: null,
    notes_james: null, notes_lee: null, added_by: null,
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={row ? row.name : `Add ${meta.label.toLowerCase()}`}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-danger btn-sm" onClick={onDelete} aria-label="Delete" data-pressable>
              <Icon name="trash" size={15} />
            </button>
          )}
          <button
            className="btn btn-accent"
            disabled={!name.trim()}
            onClick={() =>
              onSave({
                name: name.trim(),
                kind,
                actor: actor.trim() || null,
                image_url: image.trim() || null,
                film_slug: film || null,
                [sKey(me.slug)]: mine,
                [sKey(them.slug)]: theirs,
                [nKey(me.slug)]: note.trim() || null,
              } as Partial<CharRow>)
            }
            data-pressable
          >
            Save
          </button>
        </>
      }
    >
      <div className="mcu-char-head">
        <Avatar row={preview} size={72} />
        <div className="grow stack">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={meta.label} autoFocus={!row} />
          </Field>
          <Field label="Played by">
            <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Actor" />
          </Field>
        </div>
      </div>

      <Field label="Picture" hint="Paste an image link. Leave it blank and you get the initials tile until you have one.">
        <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" inputMode="url" spellCheck={false} />
      </Field>

      <Field label="First appeared in">
        <select className="mcu-select" value={film} onChange={(e) => setFilm(e.target.value)}>
          <option value="">—</option>
          {MCU_FILMS.map((f) => (
            <option key={f.slug} value={f.slug}>{f.order}. {f.title}</option>
          ))}
        </select>
      </Field>

      <ScorePair mine={mine} theirs={theirs} myName={me.name} theirName={them.name} />
      <RatingBar label={`${me.name}'s score`} value={mine} onChange={setMine} accent={me.accent} />
      <RatingBar label={`${them.name}'s score`} value={theirs} onChange={setTheirs} accent={them.accent} />

      <Field label={`${me.name}'s note`}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why they're good, why they're not…" />
      </Field>

      {row?.[nKey(them.slug)] && (
        <div className="their-note">
          <span className="eyebrow">{them.name} said</span>
          <p className="selectable">{row[nKey(them.slug)]}</p>
        </div>
      )}
    </Sheet>
  )
}
