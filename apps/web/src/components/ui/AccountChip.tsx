import { Landmark } from 'lucide-react'
import { clsx } from 'clsx'

export interface AccountLite {
  id: string
  name: string
  color?: string
}

/** Small tag with the account a movement went through. `planned` is the account an unpaid expense is set to be paid from. */
export function AccountChip({ account, planned = false, className }: { account?: AccountLite | null; planned?: boolean; className?: string }) {
  if (!account) return null
  return (
    <span
      className={clsx('inline-flex items-center gap-1 max-w-full text-[10px] font-mono', planned ? 'text-[#8a929a]' : 'text-[#c7ccd1]', className)}
      title={planned ? `Se paga desde ${account.name}` : `Cuenta: ${account.name}`}
    >
      <Landmark size={10} className="flex-shrink-0" style={{ color: account.color ?? '#52b69a' }} aria-hidden="true" />
      <span className="truncate">{planned ? `Desde ${account.name}` : account.name}</span>
    </span>
  )
}
