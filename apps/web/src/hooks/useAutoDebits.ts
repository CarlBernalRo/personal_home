import { useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getAccounts, getAllFixedExpensePayments, getFixedExpenses, materializeAutoPayments } from '@/lib/firestore'
import { planAutoPayments } from '@/shared'

/** Fired when the stored fixed payments / account balances changed behind the screens' back, so they reload. */
export const FIXED_DATA_CHANGED = 'fixed-data-changed'

const MIN_GAP_MS = 30 * 60 * 1000

/**
 * Automatic debits that already fell due become real payments (lowering their account) as soon as the person is in the
 * app, on any screen, and again when they come back to it later: the home shows that data, so it can't wait for them
 * to open Gastos fijos. The daily server job does the same without anyone opening the app.
 */
export function useAutoDebits() {
  const { user } = useAuth()
  const running = useRef(false)
  const lastRun = useRef(0)

  useEffect(() => {
    if (!user) return
    const uid = user.uid

    async function run() {
      if (running.current || Date.now() - lastRun.current < MIN_GAP_MS) return
      running.current = true
      lastRun.current = Date.now()
      try {
        const [expenses, payments, accounts] = await Promise.all([getFixedExpenses(uid), getAllFixedExpensePayments(uid), getAccounts(uid)])
        const items = planAutoPayments(expenses as any[], payments as any[], accounts as any[], new Date(), uid)
        if (items.length === 0) return
        await materializeAutoPayments(items.map((p) => ({
          fixedExpenseId: p.fixedExpenseId, userId: p.userId, concept: p.concept, paidAmount: p.paidAmount,
          accountId: p.accountId, month: p.month, paymentDate: p.paymentDate, notes: '',
        })))
        window.dispatchEvent(new Event(FIXED_DATA_CHANGED))
      } catch {
        lastRun.current = 0 // try again next time
      } finally {
        running.current = false
      }
    }

    run()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [user])
}
