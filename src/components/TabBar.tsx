import { useEffect, useRef } from 'react'
import './TabBar.css'
import { Icon, type IconName } from './Icon'

export const TABS = [
  { id: 'positions', label: 'Positions', short: 'Positions', icon: 'positions' },
  { id: 'cuisines', label: 'Cuisines', short: 'Cuisines', icon: 'cuisines' },
  { id: 'movies', label: 'Movies', short: 'Movies', icon: 'movies' },
  { id: 'shows', label: 'TV Shows', short: 'TV', icon: 'shows' },
  { id: 'watchlist', label: 'Watchlist', short: 'List', icon: 'watchlist' },
  { id: 'mcu', label: 'MCU Rewatch', short: 'MCU', icon: 'mcu' },
  { id: 'nachos', label: 'Nachos', short: 'Nachos', icon: 'nachos' },
  { id: 'salads', label: 'Salad Sangas', short: 'Sangas', icon: 'salads' },
  { id: 'todo', label: 'To-Do', short: 'To-Do', icon: 'todo' },
] as const satisfies ReadonlyArray<{
  id: string
  label: string
  short: string
  icon: IconName
}>

export type TabId = (typeof TABS)[number]['id']

/**
 * All eight rooms are on screen at once — no scrolling, nothing out of reach.
 * Inactive tabs are icon-only; the active one expands into a labelled pill.
 * (The old rail scrolled horizontally, which works with a finger but is
 * near-impossible with a mouse, and put the last tabs off the edge.)
 *
 * The rail still tolerates overflow on very narrow phones, and supports
 * drag-to-pan so a mouse can reach the ends if it ever does overflow.
 */
export function TabBar({ tab, onChange }: { tab: TabId; onChange: (t: TabId) => void }) {
  const railRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  // Only matters in the overflow case; harmless otherwise.
  useEffect(() => {
    const el = activeRef.current
    const box = railRef.current
    if (!el || !box || box.scrollWidth <= box.clientWidth) return
    const target = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2
    box.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }, [tab])

  // Pointer drag-to-pan, so the rail is reachable with a mouse too.
  useEffect(() => {
    const box = railRef.current
    if (!box) return
    let down = false
    let startX = 0
    let startScroll = 0
    let moved = 0

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return // native momentum is better
      down = true
      moved = 0
      startX = e.clientX
      startScroll = box.scrollLeft
    }
    const onMove = (e: PointerEvent) => {
      if (!down) return
      const dx = e.clientX - startX
      moved = Math.max(moved, Math.abs(dx))
      if (moved > 4) box.scrollLeft = startScroll - dx
    }
    const onUp = () => {
      down = false
    }
    // Swallow the click that ends a real drag so we don't change tab by accident.
    const onClick = (e: MouseEvent) => {
      if (moved > 6) {
        e.stopPropagation()
        e.preventDefault()
        moved = 0
      }
    }

    box.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    box.addEventListener('click', onClick, true)
    return () => {
      box.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      box.removeEventListener('click', onClick, true)
    }
  }, [])

  return (
    <nav className="nav" aria-label="Sections">
      <div className="nav-rail scroll-x" ref={railRef}>
        {TABS.map((t) => {
          const active = t.id === tab
          return (
            <button
              key={t.id}
              ref={active ? activeRef : undefined}
              className={`nav-item ${active ? 'is-active' : ''}`}
              data-tab={t.id}
              onClick={() => onChange(t.id)}
              aria-current={active ? 'page' : undefined}
              aria-label={t.label}
              title={t.label}
              data-pressable
              data-press-scale="subtle"
            >
              <span className="nav-icon">
                <Icon name={t.icon} size={20} strokeWidth={active ? 2.1 : 1.7} />
              </span>
              <span className="nav-label">{t.short}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
