import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getPendingMovements } from '@/lib/firestore'
import { useOnReturn } from '@/hooks/useOnReturn'
import type { PendingMovement } from '@/shared'

/** Fired when pending movements were confirmed or discarded, so every screen that shows them refreshes. */
export const PENDING_CHANGED = 'pending-movements-changed'

/** The movements the person prepared in Telegram and still has to confirm, with a count per kind. */
export function usePendingMovements() {
  const { user } = useAuth()
  const [items, setItems] = useState<PendingMovement[]>([])
  const [loading, setLoading] = useState(true)

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
    total: items.length,
  }), [items])

  return { items, counts, loading, refresh: load }
}
