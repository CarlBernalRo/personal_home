import { Select } from './Select'
import { useMoneyMask } from '@/hooks/useMoneyMask'

interface Props {
  label: string
  accounts: { id: string; name: string; balance: number }[]
  value: string
  onChange: (id: string) => void
  /** What the option that moves no account's balance says. */
  noneLabel?: string
  /** Money leaving the account (or arriving when negative), to warn when it would go below zero. */
  outflow?: number
}

/** Picks which of the user's accounts a movement goes through; renders nothing when they have none. */
export function AccountSelect({ label, accounts, value, onChange, noneLabel = 'Sin descontar de una cuenta', outflow = 0 }: Props) {
  const cop = useMoneyMask()
  if (accounts.length === 0) return null
  const acc = accounts.find((a) => a.id === value)
  return (
    <div className="space-y-1">
      <Select
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[
          ...accounts.map((a) => ({ value: a.id, label: `${a.name} · ${cop(a.balance)}` })),
          { value: '', label: noneLabel },
        ]}
      />
      {acc && outflow > 0 && (
        acc.balance < outflow
          ? <p className="text-[11px] text-red-300">Esta cuenta tiene {cop(acc.balance)} y el pago es de {cop(outflow)}: quedaría en negativo.</p>
          : <p className="text-[11px] text-[#8a929a]">Le quedarán {cop(acc.balance - outflow)}.</p>
      )}
    </div>
  )
}
