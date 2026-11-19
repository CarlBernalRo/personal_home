import { Select } from './Select'
import { useMoneyMask } from '@/hooks/useMoneyMask'

interface Props {
  label: string
  accounts: { id: string; name: string; balance: number; parentId?: string }[]
  value: string
  onChange: (id: string) => void
  /** What the option that moves no account's balance says. */
  noneLabel?: string
  /** Money leaving the account (or arriving when negative), to warn when it would go below zero. */
  outflow?: number
  /** Don't show how much the accounts hold (e.g. when the payment is registered for someone else): balances are private to their owner. */
  hideBalance?: boolean
}

/** Picks which of the user's accounts a movement goes through; renders nothing when they have none. */
export function AccountSelect({ label, accounts, value, onChange, noneLabel = 'Sin descontar de una cuenta', outflow = 0, hideBalance = false }: Props) {
  const cop = useMoneyMask()
  if (accounts.length === 0) return null
  // a cuenta hija is listed right under its parent
  const ordered = accounts.flatMap((a) => (a.parentId && accounts.some((p) => p.id === a.parentId) ? [] : [a, ...accounts.filter((k) => k.parentId === a.id)]))
  const acc = accounts.find((a) => a.id === value)
  const parent = acc?.parentId ? accounts.find((a) => a.id === acc.parentId) : undefined
  return (
    <div className="space-y-1">
      <Select
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[
          ...ordered.map((a) => {
            const pocket = !!a.parentId && accounts.some((p) => p.id === a.parentId)
            return { value: a.id, label: hideBalance ? (pocket ? `↳ ${a.name}` : a.name) : pocket ? `↳ ${a.name} · ${a.balance < 0 ? `te deben ${cop(-a.balance)}` : cop(a.balance)}` : `${a.name} · ${cop(a.balance)}` }
          }),
          { value: '', label: noneLabel },
        ]}
      />
      {acc && parent && outflow > 0 && !hideBalance ? (
        <p className="text-[11px] text-[#8a929a]">Sale del dinero de {parent.name} (le quedarán {cop(parent.balance - outflow)}) y queda anotado aparte en {acc.name}.</p>
      ) : acc && outflow > 0 && !hideBalance && (
        acc.balance < outflow
          ? <p className="text-[11px] text-red-300">Esta cuenta tiene {cop(acc.balance)} y el pago es de {cop(outflow)}: quedaría en negativo.</p>
          : <p className="text-[11px] text-[#8a929a]">Le quedarán {cop(acc.balance - outflow)}.</p>
      )}
    </div>
  )
}
