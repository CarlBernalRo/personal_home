import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getHousehold, getHouseholdDebts, getHouseholdExpenses, getHouseholdIds } from '@/lib/firestore'
import type { DebtLine } from '@/shared'
import { householdStanding, type HouseholdStanding } from '@/components/household/standing'

export interface HouseholdAbono {
  id: string
  householdId: string
  date: Date
  amount: number
  accountId?: string
  attachmentId?: string
}

interface HouseholdRecords {
  householdId: string
  household: Record<string, any>
  expenses: any[]
  debts: any[]
}

/**
 * What the user owes across their households, worked out like the household screen's report: what each one
 * put and paid against their share, so being owed in a household is not shown as a debt, and the shared plan
 * once its accounts were crossed. Per household, so an expense can follow all of them or only some, plus the
 * abonos they paid, which are real money out. Only loads when `enabled`, so users without a
 * household-linked expense cost no reads.
 */
export function useHouseholdOwed(enabled: boolean) {
  const { user, profile } = useAuth()
  const ids = getHouseholdIds(profile)
  const idsKey = ids.join(',')
  const [records, setRecords] = useState<HouseholdRecords[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!enabled || !user || ids.length === 0) {
      setRecords([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all(ids.map(async (id): Promise<HouseholdRecords | null> => {
      const [household, expenses, debts] = await Promise.all([
        getHousehold(id).catch(() => null),
        getHouseholdExpenses(id).catch(() => []),
        getHouseholdDebts(id).catch(() => []),
      ])
      // an inactive household has nothing pending and is kept out of the dashboard and Fijos
      if (!household || (household as any).archivedAt) return null
      return { householdId: id, household: household as Record<string, any>, expenses: expenses as any[], debts: debts as any[] }
    })).then((perHousehold) => {
      if (cancelled) return
      setRecords(perHousehold.filter((r): r is HouseholdRecords => !!r))
      setLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, user, idsKey])

  // `householdIds` empty/undefined means all the households
  const pick = useCallback(
    (householdIds?: string[] | null) => (householdIds?.length ? records.filter((r) => householdIds.includes(r.householdId)) : records),
    [records],
  )

  // the same day is asked for many times (every day of a calendar), so each day is worked out once
  const cache = useMemo(() => new Map<string, HouseholdStanding>(), [records, user])
  const standingAt = useCallback((r: HouseholdRecords, date: Date | null) => {
    const key = `${r.householdId}|${date ? date.toDateString() : 'now'}`
    let s = cache.get(key)
    if (!s) {
      s = householdStanding(r.household, r.expenses, r.debts, user?.uid ?? '', date ?? undefined)
      cache.set(key, s)
    }
    return s
  }, [cache, user])

  /** What was (or will be) owed on a date: only the records that exist by then count. */
  const owedAt = useCallback(
    (date: Date, householdIds?: string[] | null) => user
      ? pick(householdIds).reduce((sum, r) => sum + standingAt(r, date).owes, 0)
      : 0,
    [pick, standingAt, user],
  )

  /** The part of that debt without an agreed date (those with one are painted on their own date). */
  const undatedOwedAt = useCallback(
    (date: Date, householdIds?: string[] | null) => user
      ? pick(householdIds).reduce((sum, r) => sum + standingAt(r, date).lines
          .filter((l) => !l.dueDate)
          .reduce((s, l) => s + l.remaining, 0), 0)
      : 0,
    [pick, standingAt, user],
  )

  /** Where the user stands today in each household. */
  const standings = useMemo<HouseholdStanding[]>(
    () => (user ? records.map((r) => standingAt(r, null)) : []),
    [records, standingAt, user],
  )

  /** Every pending payment, one by one. */
  const lines = useMemo<DebtLine[]>(() => standings.flatMap((s) => s.lines), [standings])

  const abonos = useMemo<HouseholdAbono[]>(
    () => records.flatMap((r) => r.debts
      .filter((d) => d.debtor === user?.uid && d.tipo === 'Abono')
      .map((d) => ({
        id: d.id as string,
        householdId: r.householdId,
        date: d.date instanceof Date ? d.date : new Date(d.date),
        amount: d.amount as number,
        accountId: (d.accountId as string | null) || undefined,
        attachmentId: d.attachmentId as string | undefined,
      }))),
    [records, user],
  )

  const owed = useMemo(() => standings.reduce((s, x) => s + x.owes, 0), [standings])

  /** Who owes the user what, in every household. */
  const receivables = useMemo(() => standings.flatMap((s) => s.receivables), [standings])

  return { owed, owedAt, undatedOwedAt, lines, receivables, abonos, standings, loading }
}
