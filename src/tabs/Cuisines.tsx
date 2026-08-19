import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './Cuisines.css'

import { COUNTRIES, countryFlag, countryLabel } from '../data/countries'
import { useCollection } from '../lib/collection'
import { logEvent } from '../lib/events'
import type { Profile } from '../lib/session'
import { Icon } from '../components/Icon'
import { EmptyState, Field, Sheet, useConfirm, useToast, SectionTitle } from '../components/ui'
import { makeThumb, normalizePhoto, uploadMedia, removeMedia, mediaUrl, mediaKey } from '../lib/media'

/* -------------------------------------------------------------------------- */

type CuisineRow = {
  country: string
  status: 'ranked' | 'unavailable' | 'pending'
  rank: number | null
  where_to_get: string | null
  notes: string | null
  decided_by: string | null
  /** Original photo in storage + tiny data-URL thumb for instant lists. */
  photo_path: string | null
  photo_thumb: string | null
  updated_at?: string
}

const TAU = Math.PI * 2
const POINTER = -Math.PI / 2 // straight up

/** Where the wheel currently points, as a fractional index into `items`. */
function pointerIndex(angle: number, n: number) {
  if (n === 0) return 0
  const per = TAU / n
  let diff = POINTER - angle
  diff = ((diff % TAU) + TAU) % TAU
  return diff / per
}

/* ========================================================================== */

type View = 'wheel' | 'ranked' | 'elsewhere'

export function CuisinesTab({ me }: { me: Profile }) {
  const { rows, upsert, remove } = useCollection<CuisineRow>('lj_cuisines', 'country')
  const toast = useToast()
  const confirm = useConfirm()

  const [view, setView] = useState<View>('wheel')

  const byCountry = useMemo(() => new Map(rows.map((r) => [r.country, r])), [rows])

  const pool = useMemo(
    () => COUNTRIES.filter((c) => !byCountry.has(c.name)).map((c) => c.name),
    [byCountry],
  )

  const ranked = useMemo(
    () =>
      rows
        .filter((r) => r.status === 'ranked')
        .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)),
    [rows],
  )

  const elsewhere = useMemo(() => rows.filter((r) => r.status === 'unavailable'), [rows])
  const pending = useMemo(() => rows.find((r) => r.status === 'pending') ?? null, [rows])

  /* --- actions --------------------------------------------------------- */

  const onLanded = useCallback(
    async (country: string) => {
      await upsert({
        country,
        status: 'pending',
        rank: null,
        where_to_get: null,
        notes: null,
        decided_by: me.slug,
      })
    },
    [upsert, me.slug],
  )

  const place = async (country: string, slot: number) => {
    // Re-number everything at or after the slot, then write the new entry.
    const next = ranked.filter((r) => r.country !== country)
    next.splice(slot, 0, {
      country,
      status: 'ranked',
      rank: 0,
      where_to_get: null,
      notes: null,
      decided_by: me.slug,
      photo_path: null,
      photo_thumb: null,
    })
    await Promise.all(
      next.map((r, i) =>
        upsert({ ...r, status: 'ranked', rank: i + 1, decided_by: r.decided_by ?? me.slug }),
      ),
    )
    logEvent({
      room: 'cuisines', kind: 'ranked', refId: country,
      label: countryLabel(country), meta: { rank: slot + 1 }, by: me.slug,
    })
    toast(`${countryFlag(country)}  ${countryLabel(country)} — #${slot + 1}`, 'good')
    setView('ranked')
  }

  const markElsewhere = async (country: string, where: string, notes: string) => {
    await upsert({
      country,
      status: 'unavailable',
      rank: null,
      where_to_get: where.trim() || null,
      notes: notes.trim() || null,
      decided_by: me.slug,
    })
    toast(`${countryLabel(country)} parked for later`, 'good')
  }

  const backToPool = async (country: string) => {
    await remove(country)
    toast(`${countryLabel(country)} back in the wheel`)
  }

  const reorder = async (from: number, to: number) => {
    if (to < 0 || to >= ranked.length) return
    const next = [...ranked]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    await Promise.all(next.map((r, i) => upsert({ ...r, rank: i + 1 })))
  }

  /* --- render ---------------------------------------------------------- */

  return (
    <>
      <div className="stat-strip">
        <div className="stat-cell">
          <div className="stat-cell-value" style={{ color: 'var(--gold)' }}>{pool.length}</div>
          <div className="eyebrow">In the wheel</div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell-value">{ranked.length}</div>
          <div className="eyebrow">Ranked</div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell-value" style={{ color: 'var(--text-3)' }}>{elsewhere.length}</div>
          <div className="eyebrow">Elsewhere</div>
        </div>
      </div>

      <div className="seg">
        {(
          [
            ['wheel', 'Spin'],
            ['ranked', `Rankings${ranked.length ? ` · ${ranked.length}` : ''}`],
            ['elsewhere', `Not here${elsewhere.length ? ` · ${elsewhere.length}` : ''}`],
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

      {view === 'wheel' && (
        <Wheel
          pool={pool}
          pending={pending}
          onLanded={onLanded}
          onPlace={place}
          onElsewhere={markElsewhere}
          onBackToPool={backToPool}
          ranked={ranked}
        />
      )}

      {view === 'ranked' && (
        <RankedList
          ranked={ranked}
          onReorder={reorder}
          onRemove={async (c) => {
            const ok = await confirm({
              title: `Drop ${countryLabel(c)}?`,
              body: 'It goes back into the wheel and loses its place.',
              confirmLabel: 'Drop it',
              danger: true,
            })
            if (ok) await backToPool(c)
          }}
          onSavePhoto={async (row, file) => {
            // HEIC from an iPhone becomes JPEG here, so Android can show it.
            const { blob, ext } = await normalizePhoto(file)
            const path = `cuisines/${mediaKey(row.country)}.${ext}`
            const thumb = await makeThumb(blob)
            await uploadMedia(path, blob)
            if (row.photo_path && row.photo_path !== path) void removeMedia(row.photo_path)
            await upsert({ country: row.country, photo_path: path, photo_thumb: thumb })
          }}
          onRemovePhoto={async (row) => {
            if (row.photo_path) void removeMedia(row.photo_path)
            await upsert({ country: row.country, photo_path: null, photo_thumb: null })
          }}
        />
      )}

      {view === 'elsewhere' && (
        <Elsewhere
          rows={elsewhere}
          onEdit={(country, where, notes) => markElsewhere(country, where, notes)}
          onReturn={backToPool}
        />
      )}
    </>
  )
}

/* ==========================================================================
   The wheel.

   The old one drew 193 labels on a disc, which is 1.86° per slice — unreadable
   by construction. This keeps the full 193-slice disc (it looks great, and it
   honestly shows how much is left) but moves the *reading* to a picker strip
   that tracks the pointer. The centre row is the country under the needle;
   its neighbours slide past it as the wheel turns. Every country stays in
   play and every country is legible.
   ========================================================================== */

function Wheel({
  pool,
  pending,
  ranked,
  onLanded,
  onPlace,
  onElsewhere,
  onBackToPool,
}: {
  pool: string[]
  pending: CuisineRow | null
  ranked: CuisineRow[]
  onLanded: (c: string) => void
  onPlace: (c: string, slot: number) => void
  onElsewhere: (c: string, where: string, notes: string) => void
  onBackToPool: (c: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const angleRef = useRef(0)
  const rafRef = useRef(0)
  const [spinning, setSpinning] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [elsewhereFor, setElsewhereFor] = useState<string | null>(null)

  const n = pool.length

  /* --- painting -------------------------------------------------------- */

  const paint = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    const css = cv.clientWidth
    if (cv.width !== css * dpr) {
      cv.width = css * dpr
      cv.height = css * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const size = css
    const cx = size / 2
    const cy = size / 2
    const rOuter = size * 0.47
    const rInner = size * 0.30

    ctx.clearRect(0, 0, size, size)

    if (n === 0) {
      ctx.fillStyle = '#E9B44C'
      ctx.font = '600 22px "Bodoni Moda", serif'
      ctx.textAlign = 'center'
      ctx.fillText('The whole world, eaten', cx, cy)
      return
    }

    const per = TAU / n
    const angle = angleRef.current

    // Slices — hue wheel so the disc reads as a spectrum rather than noise.
    for (let i = 0; i < n; i++) {
      const a0 = angle + i * per
      const a1 = a0 + per
      const hue = (i * 360) / n

      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a0) * rInner, cy + Math.sin(a0) * rInner)
      ctx.arc(cx, cy, rOuter, a0, a1)
      ctx.arc(cx, cy, rInner, a1, a0, true)
      ctx.closePath()
      ctx.fillStyle = `hsl(${hue} 62% ${i % 2 ? 47 : 54}%)`
      ctx.fill()
    }

    // Inner + outer rims
    ctx.strokeStyle = 'rgba(10,7,8,0.9)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(cx, cy, rInner, 0, TAU)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(233,180,76,0.55)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, rOuter + 1, 0, TAU)
    ctx.stroke()

    // Highlight the slice under the needle so the disc and the strip agree.
    const f = pointerIndex(angle, n)
    const idx = Math.floor(f) % n
    const a0 = angle + idx * per
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a0) * rInner, cy + Math.sin(a0) * rInner)
    ctx.arc(cx, cy, rOuter + 5, a0, a0 + per)
    ctx.arc(cx, cy, rInner, a0 + per, a0, true)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fill()
  }, [n])

  /** Move the picker strip without going through React — this runs at 120 Hz. */
  const paintStrip = useCallback(() => {
    const strip = stripRef.current
    if (!strip || n === 0) return
    const f = pointerIndex(angleRef.current, n)
    const idx = Math.floor(f)
    const frac = f - idx

    const rows = strip.querySelectorAll<HTMLElement>('.pick-row')
    rows.forEach((row, k) => {
      const offset = k - 2 // rows run idx-2 … idx+2
      const country = pool[(((idx + offset) % n) + n) % n]
      const dist = Math.abs(offset - frac + 0.0)
      row.textContent = `${countryFlag(country)}  ${countryLabel(country)}`
      row.style.setProperty('--d', String(Math.min(dist, 2.6)))
      row.style.transform = `translate3d(0, ${-frac * 38}px, 0)`
    })
  }, [pool, n])

  useEffect(() => {
    paint()
    paintStrip()
  }, [paint, paintStrip])

  useEffect(() => {
    const onResize = () => {
      paint()
      paintStrip()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [paint, paintStrip])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  /* --- spinning -------------------------------------------------------- */

  const spin = () => {
    if (spinning || n === 0 || pending) return
    setSpinning(true)

    // Pick the winner first, uniformly over the pool, then solve for the
    // rotation that lands on it. Animation can't bias the draw this way.
    const winner = Math.floor(Math.random() * n)
    const per = TAU / n
    const start = angleRef.current
    // Land mid-slice so the needle is unambiguous.
    const targetDiff = winner * per + per / 2
    let end = POINTER - targetDiff
    const turns = 5 + Math.floor(Math.random() * 3)
    while (end < start + turns * TAU) end += TAU

    const duration = 4200 + Math.random() * 900
    const t0 = performance.now()
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 4)

    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / duration)
      angleRef.current = start + (end - start) * easeOut(t)
      paint()
      paintStrip()
      if (t < 1) {
        rafRef.current = requestAnimationFrame(frame)
      } else {
        setSpinning(false)
        onLanded(pool[winner])
      }
    }
    rafRef.current = requestAnimationFrame(frame)
  }

  /* --- render ---------------------------------------------------------- */

  if (n === 0 && !pending) {
    return <EmptyState icon="🌍" title="Every cuisine, eaten" hint="Reset a few from the rankings to go again." />
  }

  return (
    <div className="stack">
      <div className="wheel-wrap">
        <div className="wheel-needle" aria-hidden />
        <canvas ref={canvasRef} className="wheel-canvas" />

        {/* The readable half: a picker that tracks the needle. */}
        <div className="pick" ref={stripRef} aria-live="polite">
          <div className="pick-row" />
          <div className="pick-row" />
          <div className="pick-row is-focus" />
          <div className="pick-row" />
          <div className="pick-row" />
        </div>
        <div className="pick-band" aria-hidden />
      </div>

      {pending ? (
        <div className="landed card rise">
          <div className="eyebrow landed-eyebrow">Next destination</div>
          <div className="landed-flag">{countryFlag(pending.country)}</div>
          <div className="landed-name display">{countryLabel(pending.country)}</div>

          <div className="landed-actions">
            <button className="btn btn-accent btn-block" onClick={() => setPlacing(true)} data-pressable>
              We ate it — rank it
            </button>
            <div className="row">
              <button
                className="btn btn-quiet btn-sm grow"
                onClick={() => setElsewhereFor(pending.country)}
                data-pressable
              >
                <Icon name="map" size={14} /> Not in Melbourne
              </button>
              <button
                className="btn btn-quiet btn-sm grow"
                onClick={() => onBackToPool(pending.country)}
                data-pressable
              >
                <Icon name="undo" size={14} /> Put it back
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button className="btn btn-accent spin-btn" onClick={spin} disabled={spinning} data-pressable>
          {spinning ? 'Spinning…' : 'Spin the world'}
        </button>
      )}

      {/* Where does it go? — tap the gap it belongs in. */}
      <Sheet
        open={placing && !!pending}
        onClose={() => setPlacing(false)}
        title={pending ? `Where does ${countryLabel(pending.country)} sit?` : ''}
      >
        <p className="muted place-hint">Tap the gap it belongs in — best at the top.</p>
        <div className="place-list">
          <PlaceSlot label="Best of the lot" onClick={() => { onPlace(pending!.country, 0); setPlacing(false) }} />
          {ranked.map((r, i) => (
            <div key={r.country}>
              <div className="place-entry">
                <span className="place-rank num">{i + 1}</span>
                <span className="place-flag">{countryFlag(r.country)}</span>
                <span className="grow truncate">{countryLabel(r.country)}</span>
              </div>
              <PlaceSlot
                label={i === ranked.length - 1 ? 'Worst of the lot' : 'Here'}
                onClick={() => { onPlace(pending!.country, i + 1); setPlacing(false) }}
              />
            </div>
          ))}
        </div>
      </Sheet>

      <ElsewhereSheet
        country={elsewhereFor}
        onClose={() => setElsewhereFor(null)}
        onSave={(where, notes) => {
          if (elsewhereFor) onElsewhere(elsewhereFor, where, notes)
          setElsewhereFor(null)
        }}
      />
    </div>
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

/* -------------------------------------------------------------------------- */

function ElsewhereSheet({
  country,
  onClose,
  onSave,
  initialWhere = '',
  initialNotes = '',
}: {
  country: string | null
  onClose: () => void
  onSave: (where: string, notes: string) => void
  initialWhere?: string
  initialNotes?: string
}) {
  const [where, setWhere] = useState(initialWhere)
  const [notes, setNotes] = useState(initialNotes)

  useEffect(() => {
    if (country) {
      setWhere(initialWhere)
      setNotes(initialNotes)
    }
  }, [country, initialWhere, initialNotes])

  return (
    <Sheet
      open={!!country}
      onClose={onClose}
      title={country ? `${countryFlag(country)}  ${countryLabel(country)}` : ''}
      footer={
        <>
          <button className="btn btn-quiet" onClick={onClose} data-pressable>Cancel</button>
          <button className="btn btn-accent" onClick={() => onSave(where, notes)} data-pressable>
            Save it
          </button>
        </>
      }
    >
      <p className="muted place-hint">
        It leaves the wheel but not the list — so it doesn't get lost while we hunt one down.
      </p>
      <Field label="Where could we get it?" hint="A suburb, a restaurant, a lead, or a plan.">
        <input
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          placeholder="e.g. that place in Footscray?"
        />
      </Field>
      <Field label="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Dishes to order, who recommended it, how far it is…"
        />
      </Field>
    </Sheet>
  )
}

/* -------------------------------------------------------------------------- */

function RankedList({
  ranked,
  onReorder,
  onRemove,
  onSavePhoto,
  onRemovePhoto,
}: {
  ranked: CuisineRow[]
  onReorder: (from: number, to: number) => void
  onRemove: (country: string) => void
  onSavePhoto: (row: CuisineRow, file: File) => Promise<void>
  onRemovePhoto: (row: CuisineRow) => Promise<void>
}) {
  const [photoFor, setPhotoFor] = useState<CuisineRow | null>(null)

  if (!ranked.length) {
    return <EmptyState icon="🍽" title="Nothing ranked yet" hint="Spin the wheel, eat the thing, then place it." />
  }
  return (
    <div className="stack">
      <SectionTitle right={<span className="eyebrow">{ranked.length} eaten</span>}>Rankings</SectionTitle>
      {ranked.map((r, i) => (
        <div key={r.country} className="rank-row card">
          <span className={`rank-medal display ${i < 3 ? `is-${i + 1}` : ''}`}>{i + 1}</span>
          <span className="rank-flag">{countryFlag(r.country)}</span>
          <span className="grow truncate rank-name">{countryLabel(r.country)}</span>
          <button
            className={`rank-photo ${r.photo_thumb ? 'has-photo' : ''}`}
            onClick={() => setPhotoFor(r)}
            aria-label={r.photo_thumb ? 'View photo' : 'Add photo'}
            data-pressable
          >
            {r.photo_thumb ? (
              <img src={r.photo_thumb} alt="" />
            ) : (
              <Icon name="camera" size={13} />
            )}
          </button>
          <div className="rank-tools">
            <button className="icon-btn" disabled={i === 0} onClick={() => onReorder(i, i - 1)} aria-label="Up" data-pressable>
              <Icon name="chevron" size={14} className="rot-up" />
            </button>
            <button className="icon-btn" disabled={i === ranked.length - 1} onClick={() => onReorder(i, i + 1)} aria-label="Down" data-pressable>
              <Icon name="chevron" size={14} className="rot-down" />
            </button>
            <button className="icon-btn is-danger" onClick={() => onRemove(r.country)} aria-label="Remove" data-pressable>
              <Icon name="trash" size={14} />
            </button>
          </div>
        </div>
      ))}

      <PhotoSheet
        row={photoFor}
        onClose={() => setPhotoFor(null)}
        onSave={onSavePhoto}
        onRemove={onRemovePhoto}
      />
    </div>
  )
}

/** One photo per eaten country — a keepsake, not a gallery. */
function PhotoSheet({
  row,
  onClose,
  onSave,
  onRemove,
}: {
  row: CuisineRow | null
  onClose: () => void
  onSave: (row: CuisineRow, file: File) => Promise<void>
  onRemove: (row: CuisineRow) => Promise<void>
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [fullUrl, setFullUrl] = useState<string | null>(null)

  useEffect(() => {
    setFullUrl(null)
    if (!row?.photo_path) return
    let alive = true
    void mediaUrl(row.photo_path).then((u) => alive && setFullUrl(u))
    return () => {
      alive = false
    }
  }, [row])

  const pick = async (file: File) => {
    if (!row) return
    setBusy(true)
    try {
      await onSave(row, file)
      toast('Photo saved', 'good')
      onClose()
    } catch (e) {
      toast(`Photo failed — ${e instanceof Error ? e.message : 'unknown error'}`, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={!!row}
      onClose={onClose}
      title={row ? `${countryFlag(row.country)}  ${countryLabel(row.country)}` : ''}
    >
      {row?.photo_thumb && (
        <div className="photo-frame">
          <img src={fullUrl ?? row.photo_thumb} alt={`${countryLabel(row.country)} dinner`} />
        </div>
      )}

      <label className={`btn btn-accent btn-block set-import ${busy ? 'is-busy' : ''}`} data-pressable>
        <Icon name="camera" size={16} />
        {busy ? 'Uploading…' : row?.photo_thumb ? 'Replace the photo' : 'Add a photo'}
        <input
          type="file"
          accept="image/*,.heic,.heif"
          hidden
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void pick(f)
            e.target.value = ''
          }}
        />
      </label>

      {row?.photo_thumb && (
        <button
          className="btn btn-quiet btn-block btn-sm"
          onClick={async () => {
            const ok = await confirm({ title: 'Remove this photo?', confirmLabel: 'Remove', danger: true })
            if (!ok || !row) return
            await onRemove(row)
            onClose()
          }}
          data-pressable
        >
          <Icon name="trash" size={14} /> Remove photo
        </button>
      )}
    </Sheet>
  )
}

function Elsewhere({
  rows,
  onEdit,
  onReturn,
}: {
  rows: CuisineRow[]
  onEdit: (country: string, where: string, notes: string) => void
  onReturn: (country: string) => void
}) {
  const [editing, setEditing] = useState<CuisineRow | null>(null)

  if (!rows.length) {
    return (
      <EmptyState
        icon="🗺"
        title="Nothing parked"
        hint="When a country comes up that Melbourne can't feed us, park it here with a note about where we might find it."
      />
    )
  }

  return (
    <div className="stack">
      <SectionTitle right={<span className="eyebrow">{rows.length} parked</span>}>Not in Melbourne</SectionTitle>
      {rows.map((r) => (
        <div key={r.country} className="card away-row">
          <div className="away-head">
            <span className="away-flag">{countryFlag(r.country)}</span>
            <span className="grow away-name truncate">
              {countryLabel(r.country)}
              {r.where_to_get && <span className="away-lead"> — {r.where_to_get}</span>}
            </span>
            <button className="icon-btn" onClick={() => setEditing(r)} aria-label="Edit" data-pressable>
              <Icon name="pencil" size={14} />
            </button>
            <button className="icon-btn" onClick={() => onReturn(r.country)} aria-label="Back to wheel" data-pressable>
              <Icon name="undo" size={14} />
            </button>
          </div>
          {r.notes && <p className="away-notes selectable">{r.notes}</p>}
        </div>
      ))}

      <ElsewhereSheet
        country={editing?.country ?? null}
        initialWhere={editing?.where_to_get ?? ''}
        initialNotes={editing?.notes ?? ''}
        onClose={() => setEditing(null)}
        onSave={(where, notes) => {
          if (editing) onEdit(editing.country, where, notes)
          setEditing(null)
        }}
      />
    </div>
  )
}
