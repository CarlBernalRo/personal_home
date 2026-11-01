import { create } from 'zustand'

interface PeriodState {
  /** Month (yyyy-MM) picked by the user; null follows the current salary period. Shared by Fijos and Gastos. */
  month: string | null
  setMonth: (month: string | null) => void
}

export const usePeriodStore = create<PeriodState>((set) => ({
  month: null,
  setMonth: (month) => set({ month }),
}))
