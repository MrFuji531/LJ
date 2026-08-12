import { useId } from 'react'
import './Logo.css'

type Props = {
  /** Rendered height in px. Everything scales from this. */
  size?: number
  /** Play the entrance (brackets close in from the edges). */
  animate?: boolean
  className?: string
}

/**
 * The LJ monogram.
 *
 * The trick the letterforms are doing: an `L` with a top serif is already a
 * `[`, and a `J` with a top serif is already a `]`. So each glyph is drawn as
 * thick stem + thin serif + thin inward foot — which reads simultaneously as
 * the initials and as a bracket pair cradling the space between them.
 *
 * High-contrast (fat stems, hairline serifs) to echo the Bodoni display face.
 */
export function Logo({ size = 34, animate = false, className }: Props) {
  const uid = useId().replace(/:/g, '')
  const gradId = `lj-grad-${uid}`
  const glowId = `lj-glow-${uid}`

  return (
    <svg
      className={['lj-logo', animate ? 'is-animated' : '', className].filter(Boolean).join(' ')}
      viewBox="0 0 120 76"
      height={size}
      width={(size * 120) / 76}
      role="img"
      aria-label="LJ"
      fill="none"
    >
      <defs>
        {/* userSpaceOnUse is required: the stems and serifs are perfectly
            straight, so their object bounding boxes are zero-width or
            zero-height and an objectBoundingBox gradient would refuse to
            paint them at all. */}
        <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1="22" y1="10" x2="98" y2="66">
          <stop offset="0%" stopColor="var(--rose-lit)" />
          <stop offset="55%" stopColor="var(--rose)" />
          <stop offset="100%" stopColor="var(--gold)" />
        </linearGradient>
        <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Soft bloom sitting under the strokes */}
      <g filter={`url(#${glowId})`} opacity="0.42">
        <path d="M35 15 V 57" stroke={`url(#${gradId})`} strokeWidth="9" strokeLinecap="round" />
        <path d="M85 15 V 47" stroke={`url(#${gradId})`} strokeWidth="9" strokeLinecap="round" />
      </g>

      {/* ---- L : stem, top serif, foot reaching right ---- */}
      <g className="lj-left" stroke={`url(#${gradId})`} strokeLinecap="round">
        <path className="lj-stem" d="M35 15 V 57" strokeWidth="9" />
        <path className="lj-serif" d="M29 15 H 48" strokeWidth="3.6" />
        <path className="lj-foot" d="M35 57 H 55" strokeWidth="3.6" />
      </g>

      {/* ---- J : stem, top serif, hook curling left ---- */}
      <g className="lj-right" stroke={`url(#${gradId})`} strokeLinecap="round" strokeLinejoin="round">
        <path className="lj-stem" d="M85 15 V 46" strokeWidth="9" />
        <path className="lj-serif" d="M72 15 H 91" strokeWidth="3.6" />
        <path className="lj-foot" d="M85 46 Q 85 57 74 57 H 65" strokeWidth="3.6" fill="none" />
      </g>

      {/* The held breath between them */}
      <circle className="lj-dot" cx="60" cy="57" r="2.1" fill="var(--gold)" />
    </svg>
  )
}
