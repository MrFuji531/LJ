import { useMemo, useRef, useState } from 'react'
import './Venues.css'

import { useCollection } from '../lib/collection'
import { logEvent, unlogEvent, today } from '../lib/events'
import { makeThumb, normalizePhoto, uploadMedia, removeMedia, mediaUrl, fileExt } from '../lib/media'
import type { Profile } from '../lib/session'
import { Icon } from '../components/Icon'
import { EmptyState, Fab, Field, Sheet, useConfirm, useToast, SectionTitle } from '../components/ui'

/* ==========================================================================
   Nachos & salad sangas.

   Same shape as the MCU rewatch: a checklist of spots (imported in bulk or
   added one at a time), ticked off as you eat your way through. A ticked
   spot goes straight to placement in the ranking — nachos are James's
   ranking, sangas are Lee's — and can carry a photo and a video.
   ========================================================================== */

type VenueRow = {
  id: string
  kind: 'nachos' | 'salad'
  name: string
  suburb: string | null
  address: string | null
  url: string | null
  price: number | null
  notes: string | null
  visited: boolean
  visited_on: string | null
  /** The owner's placement — 1 is best. */
  rank: number | null
  photo_path: string | null
  photo_thumb: string | null
  video_path: string | null
  score_james: number | null
  score_lee: number | null
  notes_james: string | null
  notes_lee: string | null
  added_by: string | null
  created_at?: string
  updated_at?: string
}

const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

const COPY = {
  nachos: { one: 'nachos', title: 'Nachos', icon: '🌮', ranker: 'James' },
  salad: { one: 'salad sanga', title: 'Salad Sangas', icon: '🥪', ranker: 'Lee' },
} as const

type View = 'list' | 'ranked'

export function VenuesTab({ kind, me }: { kind: 'nachos' | 'salad'; me: Profile }) {
  const { rows, upsert, remove } = useCollection<VenueRow>('lj_venues')
  const toast = useToast()
  const confirm = useConfirm()
  const copy = COPY[kind]
  const listRef = useRef<HTMLDivElement>(null)

  const [view, setView] = useState<View>('list')
  const [editing, setEditing] = useState<VenueRow | null>(null)
  const [addingNew, setAddingNew] = useState(false)
  const [importing, setImporting] = useState(false)
  const [placing, setPlacing] = useState<VenueRow | null>(null)

  const mine = useMemo(
    () =>
      rows
        .filter((r) => r.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rows, kind],
  )
  const untried = useMemo(() => mine.filter((v) => !v.visited), [mine])
  const ranked = useMemo(
    () =>
      mine
        .filter((v) => v.visited && v.rank != null)
        .sort((a, b) => a.rank! - b.rank!),
    [mine],
  )
  const tray = useMemo(() => mine.filter((v) => v.visited && v.rank == null), [mine])

  /* --- actions ---------------------------------------------------------- */

  const toggle = async (v: VenueRow) => {
    const visited = !v.visited
    await upsert({
      id: v.id,
      visited,
      visited_on: visited ? today() : null,
      ...(visited ? {} : { rank: null }),
    } as Partial<VenueRow> as VenueRow)
    if (visited) {
      logEvent({ room: kind, kind: 'visited', refId: v.id, label: v.name, by: me.slug })
      setPlacing({ ...v, visited: true })
    } else {
      unlogEvent(kind, 'visited', v.id)
    }
  }

  const place = async (v: VenueRow, slot: number) => {
    const order = ranked.filter((r) => r.id !== v.id).map((r) => r.id)
    order.splice(slot, 0, v.id)
    await Promise.all(
      order.map((id, i) => upsert({ id, rank: i + 1 } as Partial<VenueRow> as VenueRow)),
    )
    toast(`${v.name} — #${slot + 1}`, 'good')
    setPlacing(null)
  }

  const reorder = async (from: number, to: number) => {
    if (to < 0 || to >= ranked.length) return
    const order = ranked.map((r) => r.id)
    const [moved] = order.splice(from, 1)
    order.splice(to, 0, moved)
    await Promise.all(
      order.map((id, i) => upsert({ id, rank: i + 1 } as Partial<VenueRow> as VenueRow)),
    )
  }

  const pickForUs = () => {
    if (!untried.length) {
      toast('Nothing left to try — add more spots', 'bad')
      return
    }
    const pick = untried[Math.floor(Math.random() * untried.length)]
    const el = listRef.current?.querySelector(`[data-vid="${pick.id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.classList.remove('is-picked')
    requestAnimationFrame(() => el?.classList.add('is-picked'))
    toast(`${copy.icon}  ${pick.name}${pick.suburb ? ` — ${pick.suburb}` : ''}`, 'good')
  }

  /* --- render ----------------------------------------------------------- */

  return (
    <>
      {mine.length > 0 && (
        <div className="stat-strip">
          <div className="stat-cell">
            <div className="stat-cell-value" style={{ color: 'var(--accent)' }}>
              {mine.length - untried.length}
            </div>
            <div className="eyebrow">Eaten</div>
          </div>
          <div className="stat-cell">
            <div className="stat-cell-value">{untried.length}</div>
            <div className="eyebrow">To try</div>
          </div>
          <div className="stat-cell">
            <div className="stat-cell-value">{ranked.length}</div>
            <div className="eyebrow">Ranked</div>
          </div>
        </div>
      )}

      <div className="seg">
        {(
          [
            ['list', `The list${mine.length ? ` · ${mine.length}` : ''}`],
            ['ranked', `Ranked${ranked.length ? ` · ${ranked.length}` : ''}`],
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

      {view === 'list' && (
        <div className="stack" ref={listRef}>
          {mine.length === 0 ? (
            <EmptyState
              icon={copy.icon}
              title={`No ${copy.one} spots yet`}
              hint="Paste the whole list in at once, or add spots one by one."
              action={
                <button className="btn btn-accent" onClick={() => setImporting(true)} data-pressable>
                  Import the list
                </button>
              }
            />
          ) : (
            <>
              <div className="row">
                <button className="btn btn-quiet btn-sm grow" onClick={pickForUs} data-pressable>
                  <Icon name="shuffle" size={14} /> Pick for us
                </button>
                <button className="btn btn-quiet btn-sm grow" onClick={() => setImporting(true)} data-pressable>
                  <Icon name="plus" size={14} /> Import more
                </button>
              </div>

              {mine.map((v) => (
                <div key={v.id} data-vid={v.id} className={`venue-item card ${v.visited ? 'is-done' : ''}`}>
                  <button
                    className={`mcu-tick ${v.visited ? 'is-on' : ''}`}
                    onClick={() => toggle(v)}
                    aria-label={v.visited ? 'Mark untried' : 'Mark eaten'}
                    data-pressable
                  >
                    {v.visited && <Icon name="check" size={14} strokeWidth={2.6} />}
                  </button>
                  <button className="venue-item-main" onClick={() => setEditing(v)} data-pressable data-press-scale="subtle">
                    <div className="grow venue-body">
                      <div className="venue-name">{v.name}</div>
                      <div className="venue-meta">
                        {v.suburb && <span>{v.suburb}</span>}
                        {v.price != null && <span className="num">${v.price.toFixed(2)}</span>}
                        {v.rank != null && <span className="chip venue-rank-chip">#{v.rank}</span>}
                        {v.photo_thumb && <Icon name="camera" size={12} />}
                        {v.video_path && <Icon name="video" size={12} />}
                      </div>
                    </div>
                    <Icon name="chevron" size={14} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {view === 'ranked' && (
        <div className="stack">
          {tray.length > 0 && (
            <>
              <SectionTitle right={<span className="eyebrow">{tray.length} waiting</span>}>
                To place
              </SectionTitle>
              {tray.map((v) => (
                <div key={v.id} className="mcu-tray card">
                  <div className="grow venue-body">
                    <div className="venue-name">{v.name}</div>
                    {v.suburb && <div className="venue-meta">{v.suburb}</div>}
                  </div>
                  <button className="btn btn-accent btn-sm" onClick={() => setPlacing(v)} data-pressable>
                    Rank it
                  </button>
                </div>
              ))}
            </>
          )}

          {ranked.length === 0 && tray.length === 0 ? (
            <EmptyState
              icon="🏆"
              title="Nothing ranked yet"
              hint={`Tick spots off The list and ${copy.ranker} places them here.`}
            />
          ) : (
            ranked.length > 0 && (
              <>
                <SectionTitle right={<span className="eyebrow">{copy.ranker}'s ranking</span>}>
                  The order
                </SectionTitle>
                {ranked.map((v, i) => (
                  <div key={v.id} className="mcu-char card">
                    <span className={`mcu-char-rank display ${i < 3 ? `is-${i + 1}` : ''}`}>{i + 1}</span>
                    <button className="mcu-char-main" onClick={() => setEditing(v)} data-pressable data-press-scale="subtle">
                      {v.photo_thumb ? (
                        <img className="venue-thumb" src={v.photo_thumb} alt="" />
                      ) : (
                        <span className="venue-thumb is-empty">{copy.icon}</span>
                      )}
                      <div className="grow mcu-char-body">
                        <div className="mcu-char-name">{v.name}</div>
                        <div className="mcu-char-meta truncate">
                          {v.suburb && <span>{v.suburb}</span>}
                          {v.video_path && <Icon name="video" size={11} />}
                        </div>
                      </div>
                    </button>
                    <div className="rank-tools">
                      <button className="icon-btn" disabled={i === 0} onClick={() => reorder(i, i - 1)} aria-label="Up" data-pressable>
                        <Icon name="chevron" size={14} className="rot-up" />
                      </button>
                      <button className="icon-btn" disabled={i === ranked.length - 1} onClick={() => reorder(i, i + 1)} aria-label="Down" data-pressable>
                        <Icon name="chevron" size={14} className="rot-down" />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )
          )}
        </div>
      )}

      <Fab onClick={() => setAddingNew(true)} label="Add a spot" />

      {/* --- placement --- */}
      <Sheet
        open={!!placing}
        onClose={() => setPlacing(null)}
        title={placing ? `Where does ${placing.name} sit?` : ''}
      >
        <p className="muted place-hint">
          {copy.ranker}'s call — tap the gap it belongs in, best at the top.
        </p>
        <div className="place-list">
          <PlaceSlot
            label={ranked.length ? 'Top of the pile' : 'First one in'}
            onClick={() => place(placing!, 0)}
          />
          {ranked
            .filter((r) => r.id !== placing?.id)
            .map((r, i) => (
              <div key={r.id}>
                <div className="place-entry">
                  <span className="place-rank num">{i + 1}</span>
                  <span className="grow truncate">{r.name}</span>
                </div>
                <PlaceSlot
                  label={i === ranked.length - 1 ? 'Bottom of the pile' : 'Here'}
                  onClick={() => place(placing!, i + 1)}
                />
              </div>
            ))}
        </div>
        <button className="btn btn-quiet btn-block btn-sm" onClick={() => setPlacing(null)} data-pressable>
          Later — leave it in the waiting pile
        </button>
      </Sheet>

      <VenueSheet
        open={addingNew || !!editing}
        row={editing}
        copy={copy}
        onClose={() => {
          setAddingNew(false)
          setEditing(null)
        }}
        onSave={async (patch) => {
          const isNew = !editing
          const id = isNew ? uid() : editing!.id
          await upsert(
            isNew
              ? ({ ...patch, id, kind, visited: false, rank: null, added_by: me.slug, created_at: new Date().toISOString() } as VenueRow)
              : ({ ...patch, id } as VenueRow),
          )
          // A corrected date rewrites the same ledger entry.
          if (!isNew && editing!.visited && patch.visited_on) {
            logEvent({
              room: kind, kind: 'visited', refId: id,
              label: patch.name ?? editing!.name, happenedOn: patch.visited_on, by: me.slug,
            })
          }
          setAddingNew(false)
          setEditing(null)
          toast(isNew ? 'Added' : 'Saved', 'good')
        }}
        onDelete={
          editing
            ? async () => {
                const ok = await confirm({ title: `Delete ${editing.name}?`, confirmLabel: 'Delete', danger: true })
                if (!ok) return
                if (editing.photo_path) void removeMedia(editing.photo_path)
                if (editing.video_path) void removeMedia(editing.video_path)
                await remove(editing.id)
                unlogEvent(kind, 'visited', editing.id)
                setEditing(null)
              }
            : undefined
        }
      />

      <ImportSheet
        open={importing}
        copy={copy}
        onClose={() => setImporting(false)}
        onImport={async (entries) => {
          await Promise.all(
            entries.map((e) =>
              upsert({
                id: uid(), kind, name: e.name, suburb: e.suburb,
                address: null, url: null, price: null, notes: null,
                visited: false, visited_on: null, rank: null,
                photo_path: null, photo_thumb: null, video_path: null,
                score_james: null, score_lee: null, notes_james: null, notes_lee: null,
                added_by: me.slug, created_at: new Date().toISOString(),
              } as VenueRow),
            ),
          )
          setImporting(false)
          toast(`${entries.length} spot${entries.length === 1 ? '' : 's'} on the list`, 'good')
        }}
      />
    </>
  )
}

function PlaceSlot({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="place-slot" onClick={onClick} data-pressable>
      <span className="place-slot-line" />
      <span className="place-slot-label">{label}</span>
      <span className="place-slot-line" />
    </button>
  )
}

/* ==========================================================================
   One spot: details, the date, and the keepsakes
   ========================================================================== */

function VenueSheet({
  open, row, copy, onClose, onSave, onDelete,
}: {
  open: boolean
  row: VenueRow | null
  copy: (typeof COPY)[keyof typeof COPY]
  onClose: () => void
  onSave: (patch: Partial<VenueRow>) => void
  onDelete?: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [suburb, setSuburb] = useState('')
  const [price, setPrice] = useState('')
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [when, setWhen] = useState('')
  const [photo, setPhoto] = useState<{ path: string; thumb: string } | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoFull, setPhotoFull] = useState<string | null>(null)
  const [videoBusy, setVideoBusy] = useState(false)
  const [videoPath, setVideoPath] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)

  // Reset per open — keyed on the row identity.
  const openedFor = useRef<string | null>(null)
  const target = row?.id ?? (open ? 'new' : null)
  if (open && openedFor.current !== target) {
    openedFor.current = target
    setName(row?.name ?? '')
    setSuburb(row?.suburb ?? '')
    setPrice(row?.price != null ? String(row.price) : '')
    setUrl(row?.url ?? '')
    setNotes(row?.notes ?? '')
    setWhen(row?.visited_on ?? '')
    setPhoto(row?.photo_path && row.photo_thumb ? { path: row.photo_path, thumb: row.photo_thumb } : null)
    setPhotoFull(null)
    setVideoPath(row?.video_path ?? null)
    setWatching(false)
    setVideoUrl(null)
    if (row?.photo_path) void mediaUrl(row.photo_path).then(setPhotoFull)
  }
  if (!open && openedFor.current) openedFor.current = null

  const mediaId = row?.id
  const pickPhoto = async (file: File) => {
    setPhotoBusy(true)
    try {
      const { blob, ext } = await normalizePhoto(file)
      const path = `venues/${mediaId}-photo.${ext}`
      const thumb = await makeThumb(blob)
      await uploadMedia(path, blob)
      if (photo && photo.path !== path) void removeMedia(photo.path)
      setPhoto({ path, thumb })
      setPhotoFull(null)
    } catch (e) {
      toast(`Photo failed — ${e instanceof Error ? e.message : 'unknown error'}`, 'bad')
    } finally {
      setPhotoBusy(false)
    }
  }

  const pickVideo = async (file: File) => {
    setVideoBusy(true)
    try {
      const path = `venues/${mediaId}.${fileExt(file)}`
      await uploadMedia(path, file)
      setVideoPath(path)
      toast('Video saved', 'good')
    } catch (e) {
      toast(`Video failed — ${e instanceof Error ? e.message : 'unknown error'}`, 'bad')
    } finally {
      setVideoBusy(false)
    }
  }

  const watchVideo = async () => {
    if (!videoPath) return
    const u = await mediaUrl(videoPath)
    if (!u) {
      toast('Needs internet to fetch the video', 'bad')
      return
    }
    setVideoUrl(u)
    setWatching(true)
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={row ? row.name : `Add ${copy.one}`}
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
                  suburb: suburb.trim() || null,
                  price: price ? Number(price) : null,
                  url: url.trim() || null,
                  notes: notes.trim() || null,
                  ...(row?.visited ? { visited_on: when || null } : {}),
                  photo_path: photo?.path ?? null,
                  photo_thumb: photo?.thumb ?? null,
                  video_path: videoPath,
                })
              }
              data-pressable
            >
              Save
            </button>
          </>
        }
      >
        <Field label="Place"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name of the joint" autoFocus={!row} /></Field>
        <div className="two-up">
          <Field label="Suburb"><input value={suburb} onChange={(e) => setSuburb(e.target.value)} placeholder="Fitzroy" /></Field>
          <Field label="Price"><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="24.00" /></Field>
        </div>
        <Field label="Link" hint="Menu, maps, whatever."><input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="https://" /></Field>

        {row?.visited && (
          <Field label="When did we go?" hint="Backdate it if you're logging late.">
            <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
        )}

        <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What to order, verdicts, the works…" /></Field>

        {row && (
          <>
            <hr className="divider" />
            <span className="eyebrow">The evidence</span>

            {photo && (
              <div className="photo-frame">
                <img src={photoFull ?? photo.thumb} alt="" />
              </div>
            )}
            <div className="row">
              <label className="btn btn-quiet btn-sm grow set-import" data-pressable>
                <Icon name="camera" size={14} />
                {photoBusy ? 'Uploading…' : photo ? 'Replace photo' : 'Add a photo'}
                <input type="file" accept="image/*,.heic,.heif" hidden disabled={photoBusy} onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void pickPhoto(f)
                  e.target.value = ''
                }} />
              </label>
              {videoPath ? (
                <button className="btn btn-outline btn-sm grow" onClick={watchVideo} data-pressable>
                  <Icon name="play" size={14} /> Watch video
                </button>
              ) : (
                <label className="btn btn-quiet btn-sm grow set-import" data-pressable>
                  <Icon name="video" size={14} />
                  {videoBusy ? 'Uploading…' : 'Add a video'}
                  <input type="file" accept="video/*" hidden disabled={videoBusy} onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void pickVideo(f)
                    e.target.value = ''
                  }} />
                </label>
              )}
            </div>
            {videoPath && (
              <label className="btn btn-quiet btn-block btn-sm set-import" data-pressable>
                <Icon name="video" size={14} /> {videoBusy ? 'Uploading…' : 'Replace the video'}
                <input type="file" accept="video/*" hidden disabled={videoBusy} onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void pickVideo(f)
                  e.target.value = ''
                }} />
              </label>
            )}
          </>
        )}
      </Sheet>

      <Sheet open={watching} onClose={() => setWatching(false)} title={row?.name}>
        {videoUrl && <video className="venue-video" src={videoUrl} controls autoPlay playsInline />}
      </Sheet>
    </>
  )
}

/* ==========================================================================
   Bulk import — paste the list, one spot per line
   ========================================================================== */

function ImportSheet({
  open, copy, onClose, onImport,
}: {
  open: boolean
  copy: (typeof COPY)[keyof typeof COPY]
  onClose: () => void
  onImport: (entries: { name: string; suburb: string | null }[]) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const entries = useMemo(
    () =>
      text
        .split('\n')
        .map((l) => l.trim().replace(/^[-•*\d.)\s]+/, ''))
        .filter(Boolean)
        .map((l) => {
          const m = l.split(/\s+[—–|]\s+|,\s+/)
          return { name: m[0].trim(), suburb: m[1]?.trim() || null }
        })
        .filter((e) => e.name),
    [text],
  )

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Import ${copy.title.toLowerCase()}`}
      footer={
        <button
          className="btn btn-accent"
          disabled={!entries.length || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onImport(entries)
              setText('')
            } finally {
              setBusy(false)
            }
          }}
          data-pressable
        >
          {busy ? 'Importing…' : `Add ${entries.length || 'the'} spot${entries.length === 1 ? '' : 's'}`}
        </button>
      }
    >
      <Field
        label="One spot per line"
        hint={'Add a suburb with a comma or dash: "El Rincon, Fitzroy". Numbering and bullets are stripped.'}
      >
        <textarea
          className="import-box"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'El Rincon, Fitzroy\nCasa Nacho — Brunswick\nLoco Taqueria'}
          autoFocus
        />
      </Field>
      {entries.length > 0 && (
        <p className="muted place-hint">
          {entries.length} spot{entries.length === 1 ? '' : 's'} ready
          {entries.some((e) => e.suburb) ? ' (suburbs picked up)' : ''}.
        </p>
      )}
    </Sheet>
  )
}
