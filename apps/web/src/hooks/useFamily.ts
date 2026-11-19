import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { subscribeFamily, subscribeMyFamily, syncFamilySharing } from '@/lib/family'
import type { Family } from '@/shared'

/**
 * The user's family (live), and the request they sent to join one, if any. A request is remembered on the profile
 * (`familyRequest`), and the family it went to is followed so the screen shows whether it is pending, accepted or not.
 */
export function useFamily() {
  const { user, profile } = useAuth()
  const [family, setFamily] = useState<Family | null>(null)
  const [loading, setLoading] = useState(true)
  const requested = ((profile as any)?.familyRequest ?? null) as { familyId: string; familyName: string; at: string } | null
  const [requestedFamily, setRequestedFamily] = useState<Family | null>(null)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    return subscribeMyFamily(user.uid, (f) => { setFamily(f); setLoading(false) })
  }, [user])

  useEffect(() => {
    if (!requested?.familyId || family) { setRequestedFamily(null); return }
    return subscribeFamily(requested.familyId, setRequestedFamily)
  }, [requested?.familyId, family])

  const uid = user?.uid ?? ''
  const requestState: 'none' | 'pending' | 'rejected' | 'gone' =
    !requested || family ? 'none'
      : !requestedFamily ? 'gone'
        : requestedFamily.requests[uid] ? 'pending'
          : requestedFamily.rejected[uid] ? 'rejected'
            : 'gone'

  return { family, loading, requested, requestedFamily, requestState, isAdmin: !!family && family.admins.includes(uid) }
}

/**
 * Keeps `sharedWith` on the user's fixed expenses and payments matching what they share and who is in the family.
 * Mounted once (in the layout): it runs on sign-in and whenever the family's members or shares change.
 */
export function useFamilySync() {
  const { user } = useAuth()
  const { family, loading } = useFamily()
  const last = useRef<string | null>(null)
  const key = family ? JSON.stringify([family.id, [...family.members].sort(), family.shares[user?.uid ?? ''] ?? null]) : 'none'
  useEffect(() => {
    if (!user || loading || last.current === key) return
    last.current = key
    syncFamilySharing(user.uid, family).catch(() => { last.current = null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, key])
}
