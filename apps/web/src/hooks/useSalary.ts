import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { addExpense, addIncome, deleteExpense, deleteIncome, getAccounts, getExpenses, getIncomes, updateExpense, updateUserProfile } from '@/lib/firestore'
import { useAuthStore } from '@/store/auth'
import { useHouseholdOwed } from '@/hooks/useHouseholdOwed'
import { useMyHouseholds } from '@/hooks/useMyHouseholds'
import {
  buildSalaryPeriods, isScheduleUsable, latestPayDate, monthKey, periodAt,
  type ExtraIncome, type PayDate, type PaySchedule, type VariableBudget, type VariableSpend,
} from '@/shared'

interface Salary {
  id: string
  date: Date
  amount: number
}

const NO_BUDGETS: VariableBudget[] = []

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** The user's pay schedule (profile), their confirmed salaries (incomes) and what is derived from them. */
export function useSalary() {
  const { user, profile } = useAuth()
  const setProfile = useAuthStore((s) => s.setProfile)
  const schedule = ((profile as any)?.paySchedule ?? null) as PaySchedule | null
  const usable = isScheduleUsable(schedule)

  const [salaries, setSalaries] = useState<Salary[]>([])
  const [extras, setExtras]     = useState<ExtraIncome[]>([])
  const [spends, setSpends]   = useState<VariableSpend[]>([])
  // Every personal expense of the user (Gastos), counted ones and older history alike
  const [personal, setPersonal] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  // The user's bank accounts: salary and extra income are deposited into one of them
  const [accounts, setAccounts] = useState<any[]>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)

  const reloadAccounts = useCallback(async () => {
    if (!user) return
    try { setAccounts((await getAccounts(user.uid)) as any[]) } catch { /* keep what we had */ }
    setAccountsLoaded(true)
  }, [user])

  const load = useCallback(async () => {
    if (!user) return
    reloadAccounts()
    try {
      const incomes = await getIncomes(user.uid)
      // Spends registered against a variable budget live with the normal expenses
      const expenses = await getExpenses(user.uid).catch(() => [])
      setPersonal(expenses as any[])
      // Only spends against a budget or registered from Gastos count; older records stay history
      setSpends(
        (expenses as any[])
          .filter((e) => e.variableBudgetId || e.tracked)
          .map((e) => ({
            id: e.id,
            budgetId: e.variableBudgetId ?? '',
            date: e.date instanceof Date ? e.date : new Date(e.date),
            amount: e.amount,
            concept: e.description ?? '',
          })),
      )
      setSalaries(
        (incomes as any[])
          .filter((i) => i.kind === 'salary')
          .map((i) => ({ id: i.id, date: i.date instanceof Date ? i.date : new Date(i.date), amount: i.amount })),
      )
      // Any other income (older ones included) is money that came in on its date
      setExtras(
        (incomes as any[])
          .filter((i) => i.kind !== 'salary')
          .map((i) => ({
            id: i.id,
            date: i.date instanceof Date ? i.date : new Date(i.date),
            amount: i.amount,
            concept: i.concept ?? 'Ingreso',
          })),
      )
    } catch {
      setSalaries([])
      setExtras([])
      setSpends([])
      setPersonal([])
    } finally {
      setLoading(false)
    }
  }, [user, reloadAccounts])

  useEffect(() => { load() }, [load])

  const today = new Date()

  const periods = useMemo(
    () => (usable ? buildSalaryPeriods(salaries, schedule!) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salaries, usable, schedule],
  )

  const currentPeriod = periodAt(periods, today)

  // The most recent pay day that has arrived and hasn't been confirmed yet
  const latest = usable ? latestPayDate(schedule!, today) : null
  const pending: PayDate | null = latest && !salaries.some((s) => sameDay(s.date, latest.date)) ? latest : null

  // Where income lands unless the user says otherwise: the account chosen in their profile, else the default one
  const defaultAccount = accounts.find((a) => a.isDefault)
  const depositAccountId: string =
    (schedule?.accountId && accounts.some((a) => a.id === schedule.accountId) ? schedule.accountId : undefined) ?? defaultAccount?.id ?? ''
  const validAccount = (id?: string) => (id && accounts.some((a) => a.id === id) ? id : undefined)
  /** Account to offer first when paying: the one the item is set to, else the profile's, else the last one used, else where the salary goes. */
  const pickAccount = (preferred?: string): string => {
    let last = ''
    try { last = localStorage.getItem(`pay-account-${user?.uid}`) ?? '' } catch { /* private mode */ }
    // item's own account, then the one chosen in the profile, then the last one used
    const profilePay = ((profile as any)?.payAccountId ?? '') as string
    return [preferred, profilePay, last, depositAccountId, accounts[0]?.id].find((id) => id && accounts.some((a) => a.id === id)) ?? ''
  }
  const rememberAccount = (id: string) => {
    if (!id) return
    try { localStorage.setItem(`pay-account-${user?.uid}`, id) } catch { /* private mode */ }
  }

  async function confirm(payDate: PayDate, amount: number, accountId: string = depositAccountId) {
    if (!user) return
    const account = validAccount(accountId)
    await addIncome({
      userId:  user.uid,
      concept: 'Sueldo',
      amount,
      month:   monthKey(payDate.date),
      date:    payDate.date,
      kind:    'salary',
      ...(account ? { accountId: account } : {}),
    })
    await load()
  }

  async function addExtra(concept: string, amount: number, date: Date, accountId: string = depositAccountId) {
    if (!user) return
    const account = validAccount(accountId)
    await addIncome({ userId: user.uid, concept, amount, month: monthKey(date), date, kind: 'extra', ...(account ? { accountId: account } : {}) })
    await load()
  }

  async function removeExtra(id: string) {
    await deleteIncome(id)
    await load()
  }

  // ── Variable budgets (approximate recurring expenses), stored in the profile ──
  const budgets = ((profile as any)?.variableBudgets ?? NO_BUDGETS) as VariableBudget[]
  // A household-debt budget gets what is owed and the abonos paid straight from the households
  const linked = budgets.filter((b) => b.active && b.source === 'household-debt')
  const household = useHouseholdOwed(linked.length > 0)
  const householdList = useMyHouseholds(linked.length > 0)
  const householdNames = useMemo(() => Object.fromEntries(householdList.map((h) => [h.id, h.name])), [householdList])
  const allSpends = useMemo(() => {
    if (linked.length === 0) return spends
    // an abono belongs to the budget that follows its household (a specific one wins over "all")
    const abonoSpends = household.abonos.flatMap((a) => {
      const owner = linked.find((b) => b.householdIds?.includes(a.householdId)) ?? linked.find((b) => !b.householdIds?.length)
      return owner ? [{ id: `abono|${a.id}`, budgetId: owner.id, date: a.date, amount: a.amount, concept: 'Abono en el hogar' }] : []
    })
    return [...spends, ...abonoSpends]
  }, [spends, household.abonos, linked])
  const variable = useMemo(
    () => ({
      budgets,
      spends: allSpends,
      householdOwed: household.owed,
      householdOwedAt: household.owedAt,
      householdUndatedOwedAt: household.undatedOwedAt,
      householdLines: household.lines,
      householdNames,
    }),
    [budgets, allSpends, household.owed, household.owedAt, household.undatedOwedAt, household.lines, householdNames],
  )

  async function saveBudgets(next: VariableBudget[]) {
    if (!user) return
    await updateUserProfile(user.uid, { variableBudgets: next })
    setProfile({ ...profile, variableBudgets: next } as any)
  }

  const addBudget = (b: Omit<VariableBudget, 'id' | 'active'>) =>
    saveBudgets([...budgets, { ...b, id: `vb_${Date.now().toString(36)}`, active: true }])

  const updateBudget = (id: string, patch: Partial<VariableBudget>) =>
    saveBudgets(budgets.map((b) => (b.id === id ? { ...b, ...patch } : b)))

  const removeBudget = (id: string) => saveBudgets(budgets.filter((b) => b.id !== id))
  const removeBudgets = (ids: string[]) => saveBudgets(budgets.filter((b) => !ids.includes(b.id)))

  async function registerSpend(budget: VariableBudget, amount: number, date: Date, accountId = '') {
    if (!user) return
    const account = validAccount(accountId)
    await addExpense({
      ...(account ? { accountId: account } : {}),
      userId: user.uid,
      description: budget.concept,
      amount,
      category: budget.category,
      date,
      type: 'variable',
      isRecurring: false,
      variableBudgetId: budget.id,
    })
    await load()
  }

  /** A spend from the Gastos screen: not tied to a budget, but it counts toward the balance. */
  async function addPersonalExpense(data: { description: string; amount: number; category: string; date: Date; accountId?: string }) {
    if (!user) return
    const account = validAccount(data.accountId)
    await addExpense({
      ...(account ? { accountId: account } : {}),
      userId: user.uid,
      description: data.description,
      amount: data.amount,
      category: data.category,
      date: data.date,
      type: 'variable',
      isRecurring: false,
      tracked: true,
    })
    await load()
  }

  /** Edits a registered spend; its account's balance follows the change. */
  async function editPersonalExpense(
    id: string,
    data: { description: string; amount: number; category: string; date: Date; accountId?: string },
    prev: { amount: number; accountId?: string },
  ) {
    const account = validAccount(data.accountId)
    await updateExpense(id, { ...data, accountId: account }, prev)
    await load()
  }

  async function removeSpend(id: string) {
    await deleteExpense(id)
    await load()
  }

  return { accounts, accountsLoaded, reloadAccounts, depositAccountId, pickAccount, rememberAccount, schedule: usable ? schedule : null, salaries, extras, budgets, spends: allSpends, variable, addBudget, updateBudget, removeBudget, removeBudgets, registerSpend, removeSpend, personal, addPersonalExpense, editPersonalExpense, addExtra, removeExtra, periods, currentPeriod, pending, confirm, loading, reload: load }
}

export type SalaryState = ReturnType<typeof useSalary>
