import { create } from 'zustand'
import type { User as FirebaseUser } from 'firebase/auth'

interface AuthState {
  user: FirebaseUser | null
  profile: Record<string, unknown> | null
  loading: boolean
  authError: string | null
  setUser: (user: FirebaseUser | null) => void
  setProfile: (profile: Record<string, unknown> | null) => void
  setLoading: (loading: boolean) => void
  setAuthError: (error: string | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user:         null,
  profile:      null,
  loading:      true,
  authError:    null,
  setUser:      (user)      => set({ user }),
  setProfile:   (profile)   => set({ profile }),
  setLoading:   (loading)   => set({ loading }),
  setAuthError: (authError) => set({ authError }),
}))
