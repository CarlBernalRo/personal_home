import { clsx } from 'clsx'
import type { AccountLite } from './AccountChip'

/** Value of the filter for the movements that have no account. */
export const NO_ACCOUNT = 'none'

interface BaseProps {
  accounts: AccountLite[]
  /** Whether there are movements without an account (only then is that option offered). */
  hasUnassigned?: boolean
  className?: string
}

interface SingleProps extends BaseProps {
  /** An account id, NO_ACCOUNT, or null for all. */
  value: string | null
  onChange: (value: string | null) => void
}

interface MultiProps extends BaseProps {
  /** Several account ids (or NO_ACCOUNT); an empty list means all. */
  value: string[]
  onChange: (value: string[]) => void
}

/**
 * One chip per account to narrow a history to the movements that went through it. With a single value a click
 * picks that account (click again to clear); with a list each click adds or removes the account.
 */
export function AccountFilter(props: SingleProps | MultiProps) {
  const { accounts, hasUnassigned = false, className } = props
  if (accounts.length === 0) return null
  const multi = Array.isArray(props.value)
  const picked = multi ? (props.value as string[]) : props.value ? [props.value as string] : []
  const isOn = (id: string) => picked.includes(id)
  const toggle = (id: string) => {
    if (multi) (props as MultiProps).onChange(isOn(id) ? picked.filter((x) => x !== id) : [...picked, id])
    else (props as SingleProps).onChange(isOn(id) ? null : id)
  }
  const clear = () => (multi ? (props as MultiProps).onChange([]) : (props as SingleProps).onChange(null))
  const options: { id: string; name: string; color?: string }[] = [
    ...accounts,
    ...(hasUnassigned ? [{ id: NO_ACCOUNT, name: 'Sin cuenta', color: '#6b7280' }] : []),
  ]
  return (
    <div className={clsx('flex flex-wrap items-center gap-1.5', className)} role="group" aria-label="Filtrar por cuenta">
      <span className="text-[10px] uppercase tracking-wider text-[#8a929a] mr-1">{multi ? 'Cuentas' : 'Cuenta'}</span>
      <button
        type="button"
        onClick={clear}
        aria-pressed={picked.length === 0}
        className={clsx('rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition', picked.length === 0 ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-[#0d263a] text-[#9aa4ac] hover:text-white')}
      >
        Todas
      </button>
      {options.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => toggle(a.id)}
          aria-pressed={isOn(a.id)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition',
            isOn(a.id) ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-[#0d263a] text-[#9aa4ac] hover:text-white',
          )}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: a.color ?? '#52b69a' }} aria-hidden="true" />
          {a.name}
        </button>
      ))}
      {multi && picked.length > 1 && <span className="text-[10px] text-[#8a929a] ml-1">{picked.length} seleccionadas</span>}
    </div>
  )
}
