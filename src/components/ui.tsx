import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import './ui.css'

/* ==========================================================================
   Toasts
   ========================================================================== */

type Toast = { id: number; msg: string; tone: 'default' | 'good' | 'bad' }
const ToastCtx = createContext<(msg: string, tone?: Toast['tone']) => void>(() => {})

export const useToast = () => useContext(ToastCtx)

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const push = useCallback((msg: string, tone: Toast['tone'] = 'default') => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-2), { id, msg, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ==========================================================================
   Bottom sheet — the workhorse for every add/edit form
   ========================================================================== */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
}) {
  // Lock the page behind the sheet so iOS doesn't scroll the body underneath.
  useEffect(() => {
    if (!open) return
    const y = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${y}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, y)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grab" />
        {title && (
          <div className="sheet-head">
            <h3 className="sheet-title display">{title}</h3>
            <button className="sheet-x" onClick={onClose} aria-label="Close" data-pressable>
              ✕
            </button>
          </div>
        )}
        <div className="sheet-body scroll-y">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* ==========================================================================
   Confirm — replaces window.confirm, which blocks the whole WebView on iOS
   ========================================================================== */

type ConfirmReq = {
  title: string
  body?: string
  confirmLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

const ConfirmCtx = createContext<(req: Omit<ConfirmReq, 'resolve'>) => Promise<boolean>>(
  async () => false,
)

export const useConfirm = () => useContext(ConfirmCtx)

export function ConfirmHost({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmReq | null>(null)

  const ask = useCallback(
    (r: Omit<ConfirmReq, 'resolve'>) =>
      new Promise<boolean>((resolve) => setReq({ ...r, resolve })),
    [],
  )

  const settle = (ok: boolean) => {
    req?.resolve(ok)
    setReq(null)
  }

  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {req && (
        <div className="sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && settle(false)}>
          <div className="confirm-card" role="alertdialog" aria-modal="true">
            <h3 className="confirm-title display">{req.title}</h3>
            {req.body && <p className="confirm-body">{req.body}</p>}
            <div className="confirm-actions">
              <button className="btn btn-quiet grow" onClick={() => settle(false)} data-pressable>
                Cancel
              </button>
              <button
                className={`btn grow ${req.danger ? 'btn-danger' : 'btn-accent'}`}
                onClick={() => settle(true)}
                data-pressable
              >
                {req.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  )
}

/* ==========================================================================
   Rating — 0–10 in half steps, tap or drag
   ========================================================================== */

export function RatingBar({
  value,
  onChange,
  label,
  accent,
  readOnly,
}: {
  value: number | null
  onChange?: (v: number) => void
  label?: string
  accent?: string
  readOnly?: boolean
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)

  const apply = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || !onChange) return
      const r = el.getBoundingClientRect()
      const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      onChange(Math.round(pct * 20) / 2)
    },
    [onChange],
  )

  const pct = value == null ? 0 : (value / 10) * 100

  return (
    <div className="rating">
      <div className="rating-head">
        {label && <span className="eyebrow">{label}</span>}
        <span className="rating-value num" style={accent ? { color: accent } : undefined}>
          {value == null ? '—' : value.toFixed(1)}
        </span>
      </div>
      <div
        ref={trackRef}
        className={`rating-track ${readOnly ? 'is-readonly' : ''} ${drag ? 'is-dragging' : ''}`}
        onPointerDown={(e) => {
          if (readOnly) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag(true)
          apply(e.clientX)
        }}
        onPointerMove={(e) => drag && !readOnly && apply(e.clientX)}
        onPointerUp={() => setDrag(false)}
        onPointerCancel={() => setDrag(false)}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={value ?? 0}
        aria-label={label ?? 'Rating'}
      >
        <div
          className="rating-fill"
          style={{ width: `${pct}%`, background: accent ?? 'var(--accent)' }}
        />
        {value != null && (
          <div className="rating-knob" style={{ left: `${pct}%`, background: accent ?? 'var(--accent)' }} />
        )}
        <div className="rating-ticks">
          {Array.from({ length: 11 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** The combined verdict: both scores plus the average, shown as one block. */
export function ScorePair({
  mine,
  theirs,
  myName,
  theirName,
}: {
  mine: number | null
  theirs: number | null
  myName: string
  theirName: string
}) {
  const avg = useMemo(() => {
    const vals = [mine, theirs].filter((v): v is number => v != null)
    if (!vals.length) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }, [mine, theirs])

  return (
    <div className="scorepair">
      <div className="scorepair-avg">
        <div className="scorepair-avg-value display">{avg == null ? '—' : avg.toFixed(1)}</div>
        <div className="eyebrow">Average</div>
      </div>
      <div className="scorepair-split">
        <div className="scorepair-one">
          <span className="num" style={{ color: 'var(--rose)' }}>{mine == null ? '—' : mine.toFixed(1)}</span>
          <span className="eyebrow">{myName}</span>
        </div>
        <div className="scorepair-one">
          <span className="num" style={{ color: 'var(--gold)' }}>{theirs == null ? '—' : theirs.toFixed(1)}</span>
          <span className="eyebrow">{theirName}</span>
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   Odds and ends
   ========================================================================== */

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="empty rise">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title display">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="section-title">
      <h2 className="display">{children}</h2>
      {right}
    </div>
  )
}

/** Floating "+" that sits above the tab bar. */
export function Fab({ onClick, label = 'Add' }: { onClick: () => void; label?: string }) {
  return (
    <button className="fab" onClick={onClick} aria-label={label} data-pressable>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  )
}
