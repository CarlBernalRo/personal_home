import { SESSION_DURATION } from '@/hooks/useSession'

export type SessionState = 'ok' | 'low' | 'danger' | 'critical'

/** Colour and wording for how much session is left: calm green, amber, orange, then a red alarm. */
export const SESSION_STATES: Record<SessionState, { color: string; label: string }> = {
  ok:       { color: '#52b69a', label: 'Sesión activa' },
  low:      { color: '#f59e0b', label: 'La sesión se acorta' },
  danger:   { color: '#f97316', label: 'La sesión está por cerrarse' },
  critical: { color: '#ef4444', label: 'Se cerrará en segundos' },
}

export function sessionStateOf(remaining: number): SessionState {
  if (remaining <= 60_000) return 'critical'
  if (remaining <= 5 * 60_000) return 'danger'
  if (remaining <= 20 * 60_000) return 'low'
  return 'ok'
}

/**
 * Animated session clock: a ring that empties as the session runs out, a sweeping hand, and a glow
 * that changes colour and speed with the state (green → amber → orange → red alarm).
 */
export function SessionClock({ remaining, size = 32 }: { remaining: number; size?: number }) {
  const state = sessionStateOf(remaining)
  const { color } = SESSION_STATES[state]
  const R = 13
  const C = 2 * Math.PI * R
  const fraction = Math.min(1, Math.max(0, remaining / SESSION_DURATION))

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className="session-clock"
      data-state={state}
      style={{ ['--session-color' as string]: color }}
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="15" fill="#0d263a" />
      <circle cx="16" cy="16" r={R} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="2.5" />
      <circle
        cx="16" cy="16" r={R} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - fraction)} transform="rotate(-90 16 16)"
        style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.6s ease' }}
      />
      {/* tick marks at 12, 3, 6 and 9 */}
      {[0, 90, 180, 270].map((a) => (
        <line key={a} x1="16" y1="5.2" x2="16" y2="6.8" stroke="rgba(255,255,255,0.35)" strokeWidth="1" transform={`rotate(${a} 16 16)`} />
      ))}
      <g className="session-hand">
        <line x1="16" y1="16" x2="16" y2="8.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" style={{ transition: 'stroke 0.6s ease' }} />
      </g>
      <circle cx="16" cy="16" r="1.8" fill={color} style={{ transition: 'fill 0.6s ease' }} />
    </svg>
  )
}
