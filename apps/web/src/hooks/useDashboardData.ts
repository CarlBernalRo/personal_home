import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useSalary } from '@/hooks/useSalary'
import { useFixedData } from '@/hooks/useFixedData'
import { usePayProjection } from '@/hooks/usePayProjection'
import { useMyHouseholds } from '@/hooks/useMyHouseholds'
import { calcNetBalance, getHouseholdCrossings, getHouseholdDebts, getHouseholdIds, getSavingsGoals } from '@/lib/firestore'
import {
  balanceTimeline, categoryTotals, cumulativeByDay, fixedSummary, monthBounds, monthKey, periodEntries, periodHistory, salaryLedgers,
  type BalancePoint, type CategoryTotal, type FixedSummary, type MonthEntry, type PeriodSummary,
} from '@/shared'

export interface HouseholdBalance {
  id: string
  name: string
  /** Positive: the user owes it; negative: the others owe the user. */
  net: number
}

/** Everything the home dashboard shows, worked out once from the same sources Gastos, Fijos and Hogar use. */
export function useDashboardData() {
  const { user, profile } = useAuth()
  const salary = useSalary()
  const fixed = useFixedData()
  const outlook = usePayProjection(salary, fixed.expenses, fixed.paymentIndex)
  const householdList = useMyHouseholds(true)

  // ── Hogar: net balance per household ───────────────────────────────────────
  const ids = getHouseholdIds(profile)
  const idsKey = ids.join(',')
  const [nets, setNets] = useState<Record<string, number>>({})
  const [householdsLoading, setHouseholdsLoading] = useState(true)
  useEffect(() => {
    if (!user || ids.length === 0) {
      setNets({})
      setHouseholdsLoading(false)
      return
    }
    let cancelled = false
    Promise.all(ids.map(async (id) => {
      const [debts, crossings] = await Promise.all([getHouseholdDebts(id).catch(() => []), getHouseholdCrossings(id).catch(() => [])])
      return [id, calcNetBalance(debts as any[], user.uid, crossings as any[])] as const
    })).then((pairs) => {
      if (cancelled) return
      setNets(Object.fromEntries(pairs))
      setHouseholdsLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, idsKey])

  const households = useMemo<HouseholdBalance[]>(
    () => ids.map((id) => ({ id, name: householdList.find((h) => h.id === id)?.name ?? 'Hogar', net: nets[id] ?? 0 })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey, householdList, nets],
  )

  // ── Savings goals ──────────────────────────────────────────────────────────
  const [goals, setGoals] = useState<any[]>([])
  const [goalsLoading, setGoalsLoading] = useState(true)
  useEffect(() => {
    if (!user) return
    getSavingsGoals(user.uid).then((g) => setGoals(g as any[])).catch(() => setGoals([])).finally(() => setGoalsLoading(false))
  }, [user])

  // ── Derived: the current salary period ─────────────────────────────────────
  const derived = useMemo(() => {
    const today = new Date()
    const { periods, currentPeriod, extras, variable, personal } = salary
    const currentMonth = monthKey(today)
    const salaryMonth = currentPeriod ? monthKey(new Date(currentPeriod.end.getTime() - 86_400_000)) : currentMonth
    const bounds = monthBounds(salaryMonth, periods)

    const ledgers = salaryLedgers(periods, fixed.expenses, fixed.paymentIndex, today, extras, variable)
    const ledger = currentPeriod ? ledgers.get(currentPeriod.id) ?? null : null
    const history: PeriodSummary[] = periodHistory(periods, ledgers, today, 6)

    // Spends registered from Gastos that count toward the balance, inside the period
    const additional = personal
      .filter((e) => e.tracked && !e.variableBudgetId)
      .map((e) => ({ id: e.id as string, description: e.description as string, category: e.category as string, amount: e.amount as number, date: (e.date instanceof Date ? e.date : new Date(e.date)) as Date }))
      .filter((e) => e.date >= bounds.start && e.date < bounds.end)
      .sort((a, b) => b.date.getTime() - a.date.getTime())
    const categories: CategoryTotal[] = categoryTotals(additional)
    const spendCurve = cumulativeByDay(additional, bounds.start, bounds.end, today)

    const entries: MonthEntry<any>[] = periodEntries(fixed.expenses, salaryMonth, bounds, fixed.paymentIndex, today)
    const fixedStats: FixedSummary = fixedSummary(entries)

    const balanceCurve: BalancePoint[] = outlook ? balanceTimeline(outlook.cash, outlook.projection, today) : []

    const income = currentPeriod ? currentPeriod.amount + (ledger?.extraTotal ?? 0) : 0
    return { salaryMonth, bounds, ledger, history, additional, categories, spendCurve, entries, fixedStats, balanceCurve, income }
  }, [salary, fixed.expenses, fixed.paymentIndex, outlook])

  const owed = households.filter((h) => h.net > 0).reduce((s, h) => s + h.net, 0)
  const owedToMe = households.filter((h) => h.net < 0).reduce((s, h) => s - h.net, 0)

  return {
    salary,
    fixed,
    /** Money on hand and the projection to the next salary; null until a salary is confirmed. */
    outlook,
    households,
    householdTotals: { owed, owedToMe },
    goals,
    ...derived,
    loading: salary.loading || fixed.loading || householdsLoading || goalsLoading,
  }
}

export type DashboardData = ReturnType<typeof useDashboardData>
