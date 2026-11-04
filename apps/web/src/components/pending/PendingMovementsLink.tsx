import { NavLink } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import { clsx } from 'clsx'
import { usePendingMovements } from '@/hooks/usePendingMovements'

/** Header shortcut (phones) to the movements waiting for confirmation, with how many there are. */
export function PendingMovementsLink() {
  const { counts } = usePendingMovements()
  const n = counts.total
  const label = n > 0 ? `Pendientes por confirmar: ${n}` : 'Pendientes por confirmar'
  return (
    <NavLink
      to="/pendientes"
      aria-label={label}
      title={label}
      className={({ isActive }) => clsx(
        'relative rounded-lg p-1.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400',
        isActive ? 'bg-brand-500/15 text-brand-300' : n > 0 ? 'text-sky-300 hover:brightness-125' : 'text-[#9aa4ac] hover:bg-white/5 hover:text-[#f3f5f6]',
      )}
    >
      <Inbox size={19} />
      {n > 0 && (
        <span className="absolute -right-1 -top-1 h-4 min-w-[16px] rounded-full bg-sky-500 px-1 text-center font-mono text-[9px] font-bold leading-4 text-[#04141f] ring-2 ring-[#0a1f2f]" aria-hidden="true">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </NavLink>
  )
}
