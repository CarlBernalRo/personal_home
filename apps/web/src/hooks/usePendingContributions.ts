import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getHouseholdIds, getHouseholds, subscribePendingContributionExpenses, ensurePendingContributorsBackfilled } from '@/lib/firestore'

/** What someone else declared I put into a shared household expense: nothing is real until I confirm or reject it. */
export interface PendingContributionItem {
  expenseId: string
  memberId: string
  description: string
  amount: number
  registeredByName: string
  householdId: string
}

/**
 * The contributions of shared expenses that wait for MY confirmation, live across all my households — the same ones the
 * Hogar screen lists, but also counted with everything else that is pending to confirm.
 */
export function usePendingContributions() {
  const { user, profile } = useAuth()
  const ids = getHouseholdIds(profile as any)
  const idsKey = JSON.stringify(ids)
  const [expenses, setExpenses] = useState<Record<string, Record<string, unknown>[]>>({})
  const [households, setHouseholds] = useState<Record<string, any>>({})

  useEffect(() => {
    if (!user || ids.length === 0) { setExpenses({}); return }
    ids.forEach(ensurePendingContributorsBackfilled)
    const stops = ids.map((id) => subscribePendingContributionExpenses(id, user.uid, (rows) => setExpenses((prev) => ({ ...prev, [id]: rows })), () => setExpenses((prev) => ({ ...prev, [id]: [] }))))
    return () => stops.forEach((stop) => stop())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, idsKey])

  useEffect(() => {
    if (ids.length === 0) return
    let live = true
    getHouseholds(ids).then((hhs) => { if (live) setHouseholds(Object.fromEntries((hhs as any[]).map((h) => [h.id, h]))) }).catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const contributions = useMemo<PendingContributionItem[]>(() => {
    if (!user) return []
    return Object.entries(expenses).flatMap(([householdId, rows]) => rows.flatMap((e: any) => {
      const c = ((e.contributions as any[] | undefined) ?? []).find((x) => x.memberId === user.uid && x.status === 'pending')
      if (!c) return []
      const names = (households[householdId]?.memberNames ?? {}) as Record<string, string>
      return [{ expenseId: e.id as string, memberId: user.uid, description: e.description as string, amount: c.amount as number, registeredByName: names[e.registeredBy as string] || 'Alguien', householdId }]
    }))
  }, [expenses, households, user])

  return { contributions }
}
