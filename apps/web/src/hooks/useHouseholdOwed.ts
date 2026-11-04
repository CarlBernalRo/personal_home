import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { calcNetBalance, getHouseholdCrossings, getHouseholdDebts, getHouseholdIds } from '@/lib/firestore'
import { debtLines, recordsAsOf, type DebtLine } from '@/shared'

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
  debts: any[]
  crossings: any[]
}

/**
 * What the user owes across their households (the same net balance the household screen shows:
 * debts minus abonos and crossings), per household so an expense can follow all of them or only
 * some, plus the abonos they paid, which are real money out. Only loads when `enabled`, so users
 * without a household-linked expense cost no reads.
 */
export function useHouseholdOwed(enabled: boolean) {
  const { user, profile } = useAuth()
  const ids = getHouseholdIds(profile)
  const idsKey = ids.join(',')
  const [records, setRecords] = useState<HouseholdRecords[]>([])

  useEffect(() => {
    if (!enabled || !user || ids.length === 0) {
      setRecords([])
      return
    }
    let cancelled = false
    Promise.all(ids.map(async (id) => {
      const [debts, crossings] = await Promise.all([
        getHouseholdDebts(id).catch(() => []),
        getHouseholdCrossings(id).catch(() => []),
      ])
      return { householdId: id, debts: debts as any[], crossings: crossings as any[] }
    })).then((perHousehold) => {
      if (!cancelled) setRecords(perHousehold)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, user, idsKey])

  // `householdIds` empty/undefined means all the households
  const pick = useCallback(
    (householdIds?: string[] | null) => (householdIds?.length ? records.filter((r) => householdIds.includes(r.householdId)) : records),
    [records],
  )

  const netAt = useCallback((r: HouseholdRecords, date: Date) => {
    const asOf = recordsAsOf(r.debts, r.crossings, date)
    return { asOf, net: Math.max(0, calcNetBalance(asOf.debts, user?.uid ?? '', asOf.crossings)) }
  }, [user])

  /** What was (or will be) owed on a date: only the records that exist by then count. */
  const owedAt = useCallback(
    (date: Date, householdIds?: string[] | null) => user
      ? pick(householdIds).reduce((sum, r) => sum + netAt(r, date).net, 0)
      : 0,
    [pick, netAt, user],
  )

  /** The part of that debt without an agreed date (those with one are painted on their own date). */
  const undatedOwedAt = useCallback(
    (date: Date, householdIds?: string[] | null) => user
      ? pick(householdIds).reduce((sum, r) => {
          const { asOf, net } = netAt(r, date)
          return sum + debtLines(asOf.debts, user.uid, r.householdId, net)
            .filter((l) => !l.dueDate)
            .reduce((s, l) => s + l.remaining, 0)
        }, 0)
      : 0,
    [pick, netAt, user],
  )

  /** Every pending debt, one by one. */
  const lines = useMemo<DebtLine[]>(
    () => (user
      ? records.flatMap((r) => debtLines(r.debts, user.uid, r.householdId, Math.max(0, calcNetBalance(r.debts, user.uid, r.crossings))))
      : []),
    [records, user],
  )

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

  return { owed: owedAt(new Date()), owedAt, undatedOwedAt, lines, abonos }
}
