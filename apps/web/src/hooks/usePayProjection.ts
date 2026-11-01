import { useMemo } from 'react'
import type { SalaryState } from '@/hooks/useSalary'
import { cashOnHand, projectToNextPay, salaryLedgers, type PayProjection } from '@/shared'

type PaymentIndex = Map<string, { paidAmount: number; paymentDate?: Date | string }>

/** Money on hand and where it stands when the next salary arrives; null until there is a salary to go on. */
export function usePayProjection(salary: SalaryState, expenses: any[], paymentIndex: PaymentIndex) {
  const { schedule, salaries, extras, spends, periods, currentPeriod, variable } = salary

  return useMemo(() => {
    if (!schedule) return null
    const today = new Date()
    const cash = cashOnHand(salaries, extras, [...paymentIndex.values()], today, spends)
    if (cash === null) return null
    const ledger = currentPeriod ? salaryLedgers(periods, expenses, paymentIndex, today, extras, variable).get(currentPeriod.id) : undefined
    const projection: PayProjection | null = projectToNextPay(cash, schedule, expenses, paymentIndex, today, ledger?.variableReserved ?? 0)
    return projection ? { cash, projection } : null
  }, [schedule, salaries, extras, spends, periods, currentPeriod, variable, expenses, paymentIndex])
}
