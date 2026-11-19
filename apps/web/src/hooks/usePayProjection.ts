import { useMemo } from 'react'
import type { SalaryState } from '@/hooks/useSalary'
import { cashOnHand, projectToNextPay, salaryLedgers, topAccounts, type PayProjection } from '@/shared'

type PaymentIndex = Map<string, { paidAmount: number; paymentDate?: Date | string }>

/**
 * Money on hand and where it stands when the next salary arrives; null until there is a salary to go on.
 * With accounts, the money on hand is what the accounts hold (the same total the salary card shows): that is the
 * real money, cash payments registered without an account never left them. `computedCash` is the old estimate
 * (income minus what was paid), only used to open the first account of someone who had none.
 */
export function usePayProjection(salary: SalaryState, expenses: any[], paymentIndex: PaymentIndex) {
  const { schedule, salaries, extras, spends, periods, currentPeriod, variable, accounts } = salary

  return useMemo(() => {
    if (!schedule) return null
    const today = new Date()
    const computedCash = cashOnHand(salaries, extras, [...paymentIndex.values()], today, spends)
    if (computedCash === null) return null
    const cash = accounts.length > 0 ? topAccounts(accounts as any[]).reduce((sum: number, a: any) => sum + (a.balance as number), 0) : computedCash
    const ledger = currentPeriod ? salaryLedgers(periods, expenses, paymentIndex, today, extras, variable).get(currentPeriod.id) : undefined
    const projection: PayProjection | null = projectToNextPay(cash, schedule, expenses, paymentIndex, today, ledger?.variableReserved ?? 0)
    return projection ? { cash, computedCash, projection } : null
  }, [schedule, salaries, extras, spends, periods, currentPeriod, variable, expenses, paymentIndex, accounts])
}
