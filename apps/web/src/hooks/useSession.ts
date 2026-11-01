import { useEffect, useRef, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { logout } from '@/lib/auth'
import { useAuth } from './useAuth'

export const SESSION_DURATION = 60 * 60 * 1000 // 1 hour in ms
const WARN_THRESHOLD   = 60 * 1000     // warn when 60s remain
const TICK_INTERVAL    = 1000          // update every second

export function useSession() {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const lastActivityRef = useRef<number>(Date.now())
  const [remaining, setRemaining] = useState(SESSION_DURATION)
  const [isWarning, setIsWarning] = useState(false)

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
  }, [])

  useEffect(() => {
    if (!user) return

    // Track any user interaction
    const events = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'] as const
    events.forEach(e => window.addEventListener(e, resetActivity, { passive: true }))

    const timer = setInterval(async () => {
      const idle = Date.now() - lastActivityRef.current
      const left = Math.max(0, SESSION_DURATION - idle)

      setRemaining(left)
      setIsWarning(left > 0 && left <= WARN_THRESHOLD)

      if (left === 0) {
        clearInterval(timer)
        await logout()
        navigate('/login')
      }
    }, TICK_INTERVAL)

    return () => {
      clearInterval(timer)
      events.forEach(e => window.removeEventListener(e, resetActivity))
    }
  }, [user, navigate, resetActivity])

  const mm = Math.floor(remaining / 60000).toString().padStart(2, '0')
  const ss = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0')

  return { remaining, isWarning, formatted: `${mm}:${ss}` }
}
