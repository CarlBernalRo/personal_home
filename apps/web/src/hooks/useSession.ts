import { useEffect, useRef, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { logout } from '@/lib/auth'
import { useAuth } from './useAuth'

export const SESSION_DURATION = 60 * 60 * 1000 // 1 hour in ms
const WARN_THRESHOLD   = 60 * 1000     // warn when 60s remain
const TICK_INTERVAL    = 1000          // update every second
const SAVE_EVERY       = 5000          // the last activity is saved at most this often

const keyOf = (uid: string) => `last-activity-${uid}`
const readSaved = (uid: string) => {
  try { const v = Number(localStorage.getItem(keyOf(uid))); return v > 0 ? v : 0 } catch { return 0 }
}

/**
 * Signs the person out after an hour without activity. The time is measured against the clock, not by counting ticks: a
 * background tab (or a phone with the screen off) freezes its timers, so the interval alone never fires while the person is
 * away. Coming back, the first thing that happens is a check against the last real activity, before that very return can
 * count as activity. The last activity is also kept in localStorage, so it survives a reload or a tab the browser discarded,
 * and other tabs of the app count too.
 */
export function useSession() {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const uid = user?.uid
  const lastActivityRef = useRef<number>(Date.now())
  const lastSavedRef = useRef(0)
  const endedRef = useRef(false)
  const [remaining, setRemaining] = useState(SESSION_DURATION)
  const [isWarning, setIsWarning] = useState(false)

  const save = useCallback((at: number, force = false) => {
    if (!uid) return
    if (!force && at - lastSavedRef.current < SAVE_EVERY) return
    lastSavedRef.current = at
    try { localStorage.setItem(keyOf(uid), String(at)) } catch { /* private mode */ }
  }, [uid])

  useEffect(() => {
    if (!uid) return
    endedRef.current = false
    // starts from what was saved (a reload or another tab), never from "now" when the saved time says it is already over
    lastActivityRef.current = readSaved(uid) || Date.now()
    save(lastActivityRef.current, true)

    const end = async () => {
      if (endedRef.current) return
      endedRef.current = true
      try { localStorage.removeItem(keyOf(uid)) } catch { /* private mode */ }
      await logout()
      navigate('/login')
    }

    /** Time left, counting activity from other tabs; ends the session when there is none. */
    const check = () => {
      lastActivityRef.current = Math.max(lastActivityRef.current, readSaved(uid))
      const left = Math.max(0, SESSION_DURATION - (Date.now() - lastActivityRef.current))
      setRemaining(left)
      setIsWarning(left > 0 && left <= WARN_THRESHOLD)
      if (left === 0) end()
      return left
    }

    const onActivity = () => {
      // an hour has gone by since the last real activity: this touch is not a reason to stay
      if (check() === 0) return
      const now = Date.now()
      lastActivityRef.current = now
      save(now)
    }

    // coming back to the page (tab visible again, phone unlocked, page restored): look at the clock first
    const onReturn = () => { if (document.visibilityState === 'visible') check() }

    const events = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'] as const
    // capture phase: the check runs before anything else reacts to the first touch of the return
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true, capture: true }))
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    window.addEventListener('pageshow', onReturn)

    check()
    const timer = setInterval(check, TICK_INTERVAL)

    return () => {
      clearInterval(timer)
      events.forEach(e => window.removeEventListener(e, onActivity, { capture: true }))
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
      window.removeEventListener('pageshow', onReturn)
    }
  }, [uid, navigate, save])

  const mm = Math.floor(remaining / 60000).toString().padStart(2, '0')
  const ss = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0')

  return { remaining, isWarning, formatted: `${mm}:${ss}` }
}
