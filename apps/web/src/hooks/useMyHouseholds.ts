import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getHouseholdIds, getHouseholds } from '@/lib/firestore'

export interface MyHousehold {
  id: string
  name: string
}

/** The households the user belongs to (id and name), for pickers and labels. */
export function useMyHouseholds(enabled = true): MyHousehold[] {
  const { user, profile } = useAuth()
  const ids = getHouseholdIds(profile)
  const idsKey = ids.join(',')
  const [households, setHouseholds] = useState<MyHousehold[]>([])

  useEffect(() => {
    if (!enabled || ids.length === 0) {
      setHouseholds([])
      return
    }
    let cancelled = false
    getHouseholds(ids, user?.uid)
      .then((docs) => {
        if (!cancelled) setHouseholds(docs.map((h) => ({ id: h.id as string, name: (h.name as string) || 'Hogar' })))
      })
      .catch(() => { /* names are only labels; the ids still work */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, enabled])

  return households
}
