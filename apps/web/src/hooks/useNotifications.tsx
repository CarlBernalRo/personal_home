import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useSalary } from '@/hooks/useSalary'
import { useFixedData } from '@/hooks/useFixedData'
import { useAuthStore } from '@/store/auth'
import {
  deleteNotifications, getHousehold, getHouseholdIds, getMyInvites, getNotifications, joinHousehold, markNotificationsRead, markNotificationsUnread,
  notifyHouseholdMembers, respondToInvite,
} from '@/lib/firestore'
import {
  deriveAlerts, monthBounds, monthKey, periodEntries, salaryLedgers,
  type AppNotification, type HouseholdInvite, type NotificationZone,
} from '@/shared'

interface Local {
  read: string[]
  hidden: string[]
}

const toDate = (v: unknown): Date => {
  if (v instanceof Date) return v
  const ts = v as { toDate?: () => Date } | null
  return ts?.toDate ? ts.toDate() : new Date((v as string) ?? Date.now())
}

interface NotificationsValue {
  notifications: AppNotification[]
  unread: number
  /** Unread count per zone, for the badges of the filter tabs. */
  unreadByZone: Record<NotificationZone, number>
  loading: boolean
  refresh: () => Promise<void>
  markRead: (n: AppNotification) => Promise<void>
  /** Puts a read notification back to unread (the bell lights up again). */
  markUnread: (n: AppNotification) => Promise<void>
  markAllRead: () => Promise<void>
  remove: (n: AppNotification) => Promise<void>
  clearAll: () => Promise<void>
  /** Alerts the user dismissed on this device (they can be brought back). */
  hiddenCount: number
  restoreHidden: () => void
  acceptInvite: (n: AppNotification) => Promise<void>
  declineInvite: (n: AppNotification) => Promise<void>
}

const EMPTY: NotificationsValue = {
  notifications: [], unread: 0, unreadByZone: { sueldo: 0, fijos: 0, gastos: 0, hogar: 0 }, loading: false,
  refresh: async () => {}, markRead: async () => {}, markUnread: async () => {}, markAllRead: async () => {}, remove: async () => {}, clearAll: async () => {}, hiddenCount: 0, restoreHidden: () => {},
  acceptInvite: async () => {}, declineInvite: async () => {},
}

const NotificationsContext = createContext<NotificationsValue>(EMPTY)

/**
 * The notification center's data, loaded once for the whole signed-in app: events other people caused
 * (stored), alerts worked out from the user's own data (derived) and pending household invitations.
 * Derived alerts can't be "read" in Firestore, so what was read or hidden is remembered on this device.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth()
  const setProfile = useAuthStore((s) => s.setProfile)
  const location = useLocation()
  const salary = useSalary()
  const fixed = useFixedData()

  const uid = user?.uid
  const email = user?.email?.toLowerCase()
  const storageKey = uid ? `notif-local-${uid}` : null

  const [stored, setStored] = useState<AppNotification[]>([])
  const [invites, setInvites] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [local, setLocal] = useState<Local>({ read: [], hidden: [] })

  useEffect(() => {
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(storageKey)
      setLocal(raw ? JSON.parse(raw) : { read: [], hidden: [] })
    } catch {
      setLocal({ read: [], hidden: [] })
    }
  }, [storageKey])
  const saveLocal = useCallback((next: Local) => {
    setLocal(next)
    try { if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ read: next.read.slice(-300), hidden: next.hidden.slice(-300) })) } catch { /* private mode */ }
  }, [storageKey])

  const refresh = useCallback(async () => {
    if (!uid) return
    try {
      const [docs, invs] = await Promise.all([
        getNotifications(uid).catch(() => []),
        email ? getMyInvites(email).catch(() => []) : Promise.resolve([]),
      ])
      setStored(docs.map((d: any): AppNotification => ({
        key: d.id, source: 'stored', zone: d.zone, severity: d.severity, title: d.title, body: d.body, link: d.link,
        read: !!d.read, createdAt: toDate(d.createdAt),
      })))
      setInvites(
        (invs as any[])
          .filter((i) => i.status === 'pending')
          .map((i): AppNotification => {
            const invite = { ...i, createdAt: toDate(i.createdAt) } as HouseholdInvite
            return {
              key: `invite|${i.id}`, source: 'invite', zone: 'hogar', severity: 'info',
              title: `${invite.invitedByName || 'Alguien'} te invitó a "${invite.householdName}"`,
              body: 'Acepta para ver y compartir las cuentas de ese hogar.', link: '/hogar', read: false, createdAt: invite.createdAt, invite,
            }
          }),
      )
    } finally {
      setLoading(false)
    }
  }, [uid, email])

  // on sign-in, on every navigation (so what you just did is reflected) and when the tab comes back
  useEffect(() => { refresh() }, [refresh, location.pathname])
  useEffect(() => {
    const onFocus = () => { refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  // ── alerts worked out from the user's own data ─────────────────────────────
  const derived = useMemo<AppNotification[]>(() => {
    if (salary.loading || fixed.loading) return []
    const today = new Date()
    const { currentPeriod, periods, extras, variable } = salary
    const month = currentPeriod ? monthKey(new Date(currentPeriod.end.getTime() - 86_400_000)) : monthKey(today)
    const bounds = monthBounds(month, periods)
    const ledger = currentPeriod ? salaryLedgers(periods, fixed.expenses, fixed.paymentIndex, today, extras, variable).get(currentPeriod.id) ?? null : null
    return deriveAlerts({
      today,
      period: currentPeriod ? { start: currentPeriod.start, end: currentPeriod.end } : null,
      entries: periodEntries(fixed.expenses, month, bounds, fixed.paymentIndex, today),
      pending: salary.pending,
      ledger,
      budgets: salary.budgets,
      spends: salary.spends,
      householdLines: variable.householdLines ?? [],
      householdNames: variable.householdNames ?? {},
    })
  }, [salary, fixed.loading, fixed.expenses, fixed.paymentIndex])

  const notifications = useMemo<AppNotification[]>(() => {
    const hidden = new Set(local.hidden)
    const read = new Set(local.read)
    const fromDerived = derived.filter((n) => !hidden.has(n.key)).map((n) => ({ ...n, read: read.has(n.key) }))
    return [...invites, ...fromDerived, ...stored].sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1
      return b.createdAt.getTime() - a.createdAt.getTime()
    })
  }, [invites, derived, stored, local])

  // how many of the alerts that apply right now were dismissed here
  const hiddenCount = useMemo(() => {
    const hidden = new Set(local.hidden)
    return derived.filter((n) => hidden.has(n.key)).length
  }, [derived, local])
  const restoreHidden = useCallback(() => saveLocal({ read: local.read, hidden: [] }), [local, saveLocal])

  const unreadByZone = useMemo(() => {
    const out: Record<NotificationZone, number> = { sueldo: 0, fijos: 0, gastos: 0, hogar: 0 }
    for (const n of notifications) if (!n.read) out[n.zone] += 1
    return out
  }, [notifications])
  const unread = Object.values(unreadByZone).reduce((a, b) => a + b, 0)

  const markRead = useCallback(async (n: AppNotification) => {
    if (n.read || n.source === 'invite') return
    if (n.source === 'stored') {
      setStored((prev) => prev.map((x) => (x.key === n.key ? { ...x, read: true } : x)))
      await markNotificationsRead([n.key]).catch(() => {})
    } else {
      saveLocal({ ...local, read: [...local.read, n.key] })
    }
  }, [local, saveLocal])

  const markUnread = useCallback(async (n: AppNotification) => {
    if (!n.read || n.source === 'invite') return
    if (n.source === 'stored') {
      setStored((prev) => prev.map((x) => (x.key === n.key ? { ...x, read: false } : x)))
      await markNotificationsUnread([n.key]).catch(() => {})
    } else {
      saveLocal({ ...local, read: local.read.filter((k) => k !== n.key) })
    }
  }, [local, saveLocal])

  const markAllRead = useCallback(async () => {
    const storedIds = stored.filter((n) => !n.read).map((n) => n.key)
    setStored((prev) => prev.map((x) => ({ ...x, read: true })))
    saveLocal({ ...local, read: [...new Set([...local.read, ...derived.map((n) => n.key)])] })
    await markNotificationsRead(storedIds).catch(() => {})
  }, [stored, derived, local, saveLocal])

  const remove = useCallback(async (n: AppNotification) => {
    if (n.source === 'invite') return
    if (n.source === 'stored') {
      setStored((prev) => prev.filter((x) => x.key !== n.key))
      await deleteNotifications([n.key]).catch(() => {})
    } else {
      saveLocal({ ...local, hidden: [...local.hidden, n.key] })
    }
  }, [local, saveLocal])

  const clearAll = useCallback(async () => {
    const ids = stored.map((n) => n.key)
    setStored([])
    saveLocal({ ...local, hidden: [...new Set([...local.hidden, ...derived.map((n) => n.key)])] })
    await deleteNotifications(ids).catch(() => {})
  }, [stored, derived, local, saveLocal])

  // ── invitations ────────────────────────────────────────────────────────────
  const acceptInvite = useCallback(async (n: AppNotification) => {
    const inv = n.invite
    if (!inv || !user) return
    const name = (profile as any)?.apodo || user.displayName?.split(' ')[0] || 'Alguien'
    const { id } = await joinHousehold(user.uid, inv.inviteCode, name, user.photoURL)
    await respondToInvite(inv.id, 'accepted')
    const ids = [...new Set([...getHouseholdIds(profile as any), id])]
    setProfile({ ...profile, householdIds: ids } as any)
    // tell the people already in the household
    const hh = await getHousehold(id).catch(() => null)
    const members = ((hh?.members as string[] | undefined) ?? [])
    await notifyHouseholdMembers(members, {
      fromUid: user.uid, zone: 'hogar', severity: 'success',
      title: `${name} se unió a "${inv.householdName}"`, body: 'Ya puede ver y registrar cuentas en el hogar.', link: `/hogar?id=${id}`,
    }).catch(() => {})
    await refresh()
  }, [user, profile, setProfile, refresh])

  const declineInvite = useCallback(async (n: AppNotification) => {
    if (!n.invite) return
    await respondToInvite(n.invite.id, 'declined')
    await refresh()
  }, [refresh])

  const value = useMemo<NotificationsValue>(
    () => ({ notifications, unread, unreadByZone, loading, refresh, markRead, markUnread, markAllRead, remove, clearAll, hiddenCount, restoreHidden, acceptInvite, declineInvite }),
    [notifications, unread, unreadByZone, loading, refresh, markRead, markUnread, markAllRead, remove, clearAll, hiddenCount, restoreHidden, acceptInvite, declineInvite],
  )
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export const useNotifications = () => useContext(NotificationsContext)
