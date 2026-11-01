import { Select } from './Select'
import { formatCOP } from '@/shared'

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
  if (accounts.length === 0) return null
  const acc = accounts.find((a) => a.id === value)
  return (
    <div className="space-y-1">
      <Select
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[
          ...accounts.map((a) => ({ value: a.id, label: `${a.name} · ${formatCOP(a.balance)}` })),
          { value: '', label: noneLabel },
        ]}
      />
      {acc && outflow > 0 && (
        acc.balance < outflow
          ? <p className="text-[11px] text-red-300">Esta cuenta tiene {formatCOP(acc.balance)} y el pago es de {formatCOP(outflow)}: quedaría en negativo.</p>
          : <p className="text-[11px] text-[#8a929a]">Le quedarán {formatCOP(acc.balance - outflow)}.</p>
      )}
    </div>
  )
}
