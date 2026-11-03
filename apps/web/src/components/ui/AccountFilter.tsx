import { clsx } from 'clsx'
import type { AccountLite } from './AccountChip'

/** Value of the filter for the movements that have no account. */
export const NO_ACCOUNT = 'none'

interface Props {
  accounts: AccountLite[]
  /** An account id, NO_ACCOUNT, or null for all. */
  value: string | null
  onChange: (value: string | null) => void
  /** Whether there are movements without an account (only then is that option offered). */
  hasUnassigned?: boolean
  className?: string
}

/** One chip per account to narrow a history to the movements that went through it (click again to clear). */
export function AccountFilter({ accounts, value, onChange, hasUnassigned = false, className }: Props) {
  if (accounts.length === 0) return null
  const options: { id: string; name: string; color?: string }[] = [
    ...accounts,
    ...(hasUnassigned ? [{ id: NO_ACCOUNT, name: 'Sin cuenta', color: '#6b7280' }] : []),
  ]
  return (
    <div className={clsx('flex flex-wrap items-center gap-1.5', className)} role="group" aria-label="Filtrar por cuenta">
      <span className="text-[10px] uppercase tracking-wider text-[#8a929a] mr-1">Cuenta</span>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        className={clsx('rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition', value === null ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-[#0d263a] text-[#9aa4ac] hover:text-white')}
      >
        Todas
      </button>
      {options.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onChange(value === a.id ? null : a.id)}
          aria-pressed={value === a.id}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition',
            value === a.id ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-[#0d263a] text-[#9aa4ac] hover:text-white',
          )}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: a.color ?? '#52b69a' }} aria-hidden="true" />
          {a.name}
        </button>
      ))}
    </div>
  )
}
