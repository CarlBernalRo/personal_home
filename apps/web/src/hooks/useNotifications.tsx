import { useOnReturn } from '@/hooks/useOnReturn'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useSalary } from '@/hooks/useSalary'
import { useFixedData } from '@/hooks/useFixedData'
import { usePendingMovements } from '@/hooks/usePendingMovements'
import { useAuthStore } from '@/store/auth'
import {
  archiveNotifications, saveDerivedNotifications, skipTelegramNotifications, getHousehold, getHouseholdIds, getMyInvites, getNotifications, joinHousehold, markNotificationsRead, markNotificationsUnread,
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
  /** Everything that was ever generated for the person, newest first: active, dismissed and already solved. */
  history: AppNotification[]
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
  notifications: [], history: [], unread: 0, unreadByZone: { sueldo: 0, fijos: 0, gastos: 0, hogar: 0 }, loading: false,
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
  const pending = usePendingMovements()

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
        read: !!d.read, createdAt: toDate(d.createdAt), receipt: d.receipt, archived: !!d.archived, derivedKey: d.derivedKey, telegramStatus: d.telegramStatus,
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
  useOnReturn(refresh)

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
      pendingMovements: pending.counts.total,
    })
  }, [salary, fixed.loading, fixed.expenses, fixed.paymentIndex, pending.counts.total])

  const notifications = useMemo<AppNotification[]>(() => {
    const hidden = new Set(local.hidden)
    const read = new Set(local.read)
    // a notice marked as read from Telegram is read in its saved copy: the live alert follows it
    const copyRead = new Set(stored.filter((c) => c.derivedKey && c.read).map((c) => c.derivedKey as string))
    const fromDerived = derived.filter((n) => !hidden.has(n.key)).map((n) => ({ ...n, read: read.has(n.key) || copyRead.has(n.key) }))
    // saved copies of derived alerts and dismissed ones only live in the history
    const active = stored.filter((n) => !n.archived && !n.derivedKey)
    return [...invites, ...fromDerived, ...active].sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1
      return b.createdAt.getTime() - a.createdAt.getTime()
    })
  }, [invites, derived, stored, local])

  // the history: every stored notification (events from others, saved copies of alerts, dismissed ones), newest first
  // a saved copy of an alert is the same notification as the live one: it shows what was read or dismissed there
  const history = useMemo(() => {
    const read = new Set(local.read)
    const hidden = new Set(local.hidden)
    return stored
      .map((n) => (n.derivedKey ? { ...n, read: n.read || read.has(n.derivedKey), archived: n.archived || hidden.has(n.derivedKey) } : n))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }, [stored, local])
  const copiesOf = useCallback((keys: string[]) => stored.filter((n) => n.derivedKey && keys.includes(n.derivedKey)).map((n) => n.key), [stored])

  // every alert that shows up is kept once, so it is still there after it is solved or dismissed
  const savedKeys = useRef(new Set<string>())
  useEffect(() => {
    if (!uid || loading) return
    const known = new Set(stored.map((n) => n.derivedKey).filter(Boolean) as string[])
    const fresh = derived.filter((n) => !known.has(n.key) && !savedKeys.current.has(n.key))
    if (fresh.length === 0) return
    fresh.forEach((n) => savedKeys.current.add(n.key))
    saveDerivedNotifications(uid, fresh)
      .then(() => refresh())
      .catch(() => fresh.forEach((n) => savedKeys.current.delete(n.key)))
  }, [uid, loading, derived, stored, refresh])

  // A saved copy of an alert whose situation was solved (e.g. the movements were confirmed) must not go to Telegram later
  useEffect(() => {
    if (!uid || loading || salary.loading || fixed.loading || pending.loading) return
    const live = new Set(derived.map((n) => n.key))
    const stale = stored.filter((n) => n.derivedKey && !live.has(n.derivedKey) && !n.telegramStatus).map((n) => n.key)
    if (stale.length === 0) return
    setStored((prev) => prev.map((x) => (stale.includes(x.key) ? { ...x, telegramStatus: 'skipped' } : x)))
    skipTelegramNotifications(stale).catch(() => {})
  }, [uid, loading, salary.loading, fixed.loading, pending.loading, derived, stored])

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
      // read from the history: the live alert it copies is read too
      if (n.derivedKey) saveLocal({ ...local, read: [...new Set([...local.read, n.derivedKey])] })
      await markNotificationsRead([n.key]).catch(() => {})
    } else {
      saveLocal({ ...local, read: [...local.read, n.key] })
      const copies = copiesOf([n.key])
      if (copies.length) {
        setStored((prev) => prev.map((x) => (copies.includes(x.key) ? { ...x, read: true } : x)))
        await markNotificationsRead(copies).catch(() => {})
      }
    }
  }, [local, saveLocal, copiesOf])

  const markUnread = useCallback(async (n: AppNotification) => {
    if (!n.read || n.source === 'invite') return
    if (n.source === 'stored') {
      setStored((prev) => prev.map((x) => (x.key === n.key ? { ...x, read: false } : x)))
      if (n.derivedKey) saveLocal({ ...local, read: local.read.filter((k) => k !== n.derivedKey) })
      await markNotificationsUnread([n.key]).catch(() => {})
    } else {
      saveLocal({ ...local, read: local.read.filter((k) => k !== n.key) })
      const copies = copiesOf([n.key])
      if (copies.length) {
        setStored((prev) => prev.map((x) => (copies.includes(x.key) ? { ...x, read: false } : x)))
        await markNotificationsUnread(copies).catch(() => {})
      }
    }
  }, [local, saveLocal, copiesOf])

  const markAllRead = useCallback(async () => {
    const storedIds = stored.filter((n) => !n.read).map((n) => n.key)
    setStored((prev) => prev.map((x) => ({ ...x, read: true })))
    saveLocal({ ...local, read: [...new Set([...local.read, ...derived.map((n) => n.key)])] })
    await markNotificationsRead(storedIds).catch(() => {})
  }, [stored, derived, local, saveLocal])

  const remove = useCallback(async (n: AppNotification) => {
    if (n.source === 'invite') return
    if (n.source === 'stored') {
      setStored((prev) => prev.map((x) => (x.key === n.key ? { ...x, archived: true, read: true } : x)))
      await archiveNotifications([n.key]).catch(() => {})
    } else {
      saveLocal({ ...local, hidden: [...local.hidden, n.key] })
      const copies = copiesOf([n.key])
      if (copies.length) {
        setStored((prev) => prev.map((x) => (copies.includes(x.key) ? { ...x, archived: true, read: true } : x)))
        await archiveNotifications(copies).catch(() => {})
      }
    }
  }, [local, saveLocal, copiesOf])

  const clearAll = useCallback(async () => {
    const ids = [...stored.filter((n) => !n.archived && !n.derivedKey).map((n) => n.key), ...copiesOf(derived.map((n) => n.key))]
    setStored((prev) => prev.map((x) => (ids.includes(x.key) ? { ...x, archived: true, read: true } : x)))
    saveLocal({ ...local, hidden: [...new Set([...local.hidden, ...derived.map((n) => n.key)])] })
    await archiveNotifications(ids).catch(() => {})
  }, [stored, derived, local, saveLocal, copiesOf])

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
    const guestIds = ((hh?.guestIds as string[] | undefined) ?? [])
    const members = ((hh?.members as string[] | undefined) ?? []).filter((uid) => !guestIds.includes(uid))
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
    () => ({ notifications, history, unread, unreadByZone, loading, refresh, markRead, markUnread, markAllRead, remove, clearAll, hiddenCount, restoreHidden, acceptInvite, declineInvite }),
    [notifications, history, unread, unreadByZone, loading, refresh, markRead, markUnread, markAllRead, remove, clearAll, hiddenCount, restoreHidden, acceptInvite, declineInvite],
  )
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export const useNotifications = () => useContext(NotificationsContext)
