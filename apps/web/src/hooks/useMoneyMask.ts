import { formatCOP } from '@/shared'
import { usePrivacyStore } from '@/store/privacy'

const MASK = '••••••'

/**
 * Formats a COP amount normally, or returns a fixed mask instead when the privacy switch is on.
 * Use for sensitive money figures: account balances, sueldo, ingresos, lo que queda.
 */
export function useMoneyMask() {
  const hidden = usePrivacyStore((s) => s.hideBalances)
  return (amount: number) => (hidden ? MASK : formatCOP(amount))
}
