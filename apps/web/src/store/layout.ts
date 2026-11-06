import { create } from 'zustand'

const KEY = 'layout:left-collapsed'

const read = (): boolean => {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

interface LayoutState {
  /** Collapses the left pane on every screen that has one (Fijos, Gastos, Finanzas, Hogar...). Remembered per browser. */
  leftCollapsed: boolean
  toggleLeft: () => void
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  leftCollapsed: read(),
  toggleLeft: () => {
    const next = !get().leftCollapsed
    try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* private mode */ }
    set({ leftCollapsed: next })
  },
}))
