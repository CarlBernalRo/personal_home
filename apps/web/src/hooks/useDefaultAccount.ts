import { useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { ensureDefaultAccount } from '@/lib/firestore'
import type { SalaryState } from '@/hooks/useSalary'

/**
 * Users who set up their payments before accounts existed get a "Cuenta default" holding the money
 * they have today (`cash`, what the app already worked out), so every later payment and deposit
 * has an account to move. Runs once: it does nothing when a default account exists.
 */
export function useDefaultAccount(salary: SalaryState, cash: number | null) {
  const { user } = useAuth()
  const started = useRef(false)

  useEffect(() => {
    if (!user || cash === null || salary.loading || !salary.accountsLoaded || started.current) return
    if (salary.accounts.some((a) => a.isDefault)) return
    started.current = true
    ensureDefaultAccount(user.uid, cash)
      .then((created) => { if (created) salary.reloadAccounts() })
      .catch(() => { started.current = false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, cash, salary.loading, salary.accountsLoaded, salary.accounts])
}
