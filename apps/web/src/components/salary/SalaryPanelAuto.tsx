import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useSalary } from '@/hooks/useSalary'
import { getAllFixedExpensePayments, getFixedExpenses } from '@/lib/firestore'
import { indexPayments, withAutoPayments } from '@/shared'
import { SalaryPanel } from './SalaryPanel'

/** SalaryPanel that fetches the fixed expenses and payments it needs (for pages that don't load them). */
export function SalaryPanelAuto() {
  const { user } = useAuth()
  const salary = useSalary()
  const [expenses, setExpenses] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])

  useEffect(() => {
    if (!user) return
    Promise.all([getFixedExpenses(user.uid), getAllFixedExpensePayments(user.uid)])
      .then(([fx, pay]) => { setExpenses(fx as any[]); setPayments(pay as any[]) })
      .catch(() => { /* the panel then shows the salary without expense deductions */ })
  }, [user])

  const paymentIndex = useMemo(() => indexPayments(withAutoPayments(expenses, payments, new Date())), [expenses, payments])

  return <SalaryPanel salary={salary} expenses={expenses} paymentIndex={paymentIndex} />
}
