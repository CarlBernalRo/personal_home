import { create } from 'zustand'

const KEY = 'privacy:hide-balances'

const read = (): boolean => {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

interface PrivacyState {
  /** Hides account balances and other money figures tied to how much the person actually has. Remembered per browser. */
  hideBalances: boolean
  toggle: () => void
}

/** Global, persisted switch: one toggle hides sensitive money figures (account balances, sueldo, lo que queda) everywhere they show. */
export const usePrivacyStore = create<PrivacyState>((set, get) => ({
  hideBalances: read(),
  toggle: () => {
    const next = !get().hideBalances
    try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* private mode */ }
    set({ hideBalances: next })
  },
}))
