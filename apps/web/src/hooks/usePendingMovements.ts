import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getPendingMovements } from '@/lib/firestore'
import { useOnReturn } from '@/hooks/useOnReturn'
import { usePendingReceipts } from '@/hooks/usePendingReceipts'
import { usePendingContributions } from '@/hooks/usePendingContributions'
import type { PendingMovement } from '@/shared'

/** Fired when pending movements were confirmed or discarded, so every screen that shows them refreshes. */
export const PENDING_CHANGED = 'pending-movements-changed'

/** The movements the person prepared in Telegram and still has to confirm, with a count per kind. */
export function usePendingMovements() {
  const { user } = useAuth()
  const [items, setItems] = useState<PendingMovement[]>([])
  const [loading, setLoading] = useState(true)
  // payments other household members made to me: they are income once I confirm them, so they wait here too
  const { receipts } = usePendingReceipts()
  // shared-expense contributions someone else declared on my behalf, waiting for my yes or no
  const { contributions } = usePendingContributions()

  const load = useCallback(async () => {
    if (!user) return
    try { setItems(await getPendingMovements(user.uid)) } catch { setItems([]) } finally { setLoading(false) }
  }, [user])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const refresh = () => { load() }
    window.addEventListener(PENDING_CHANGED, refresh)
    return () => window.removeEventListener(PENDING_CHANGED, refresh)
  }, [load])
  // what was prepared in Telegram while the app was in the background shows up as soon as the person is back
  useOnReturn(load)

  const counts = useMemo(() => ({
    income: items.filter((p) => p.kind === 'income').length,
    fixed: items.filter((p) => p.kind === 'fixed').length,
    occasional: items.filter((p) => p.kind === 'occasional').length,
    abono: items.filter((p) => p.kind === 'abono').length,
    receipt: receipts.length,
    contribution: contributions.length,
    total: items.length + receipts.length + contributions.length,
  }), [items, receipts, contributions])

  return { items, receipts, contributions, counts, loading, refresh: load }
}
