import { useAuth } from './useAuth'

/** Priority: apodo → firstName → Google first name → email username */
export function useDisplayName(): string {
  const { user, profile } = useAuth()
  const p = profile as any
  if (p?.apodo?.trim())     return p.apodo.trim()
  if (p?.firstName?.trim()) return p.firstName.trim()
  return user?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? ''
}
