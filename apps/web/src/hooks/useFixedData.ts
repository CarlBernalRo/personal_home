import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getAllFixedExpensePayments, getFixedExpenses } from '@/lib/firestore'
import { FIXED_DATA_CHANGED } from '@/hooks/useAutoDebits'
import { indexPayments, withAutoPayments } from '@/shared'

/** The user's fixed expenses and their payments (automatic debits included), for screens that only read them. */
export function useFixedData() {
  const { user } = useAuth()
  const [expenses, setExpenses] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const [fx, pay] = await Promise.all([getFixedExpenses(user.uid), getAllFixedExpensePayments(user.uid)])
      setExpenses(fx as any[])
      setPayments(pay as any[])
    } catch {
      setExpenses([])
      setPayments([])
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { load() }, [load])
  // automatic debits saved elsewhere in the app
  useEffect(() => {
    window.addEventListener(FIXED_DATA_CHANGED, load)
    return () => window.removeEventListener(FIXED_DATA_CHANGED, load)
  }, [load])

  const paymentIndex = useMemo(() => indexPayments(withAutoPayments(expenses, payments, new Date())), [expenses, payments])

  return { expenses, payments, paymentIndex, loading, reload: load }
}
