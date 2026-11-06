import { useNavigate } from 'react-router-dom'
import { CalendarClock, Home, ShoppingBag, Wallet } from 'lucide-react'
import { clsx } from 'clsx'
import type { PendingMovement } from '@/shared'
import { formatCOP } from '@/shared'
import { relativeTime } from '@/components/notifications/meta'

const KIND = {
  income: { label: 'Ingreso', icon: Wallet, border: 'border-l-emerald-400', iconBox: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300', chip: 'text-emerald-300', sign: '+' },
  fixed: { label: 'Gasto fijo', icon: CalendarClock, border: 'border-l-sky-400', iconBox: 'border-sky-400/30 bg-sky-400/10 text-sky-300', chip: 'text-sky-300', sign: '-' },
  occasional: { label: 'Gasto adicional', icon: ShoppingBag, border: 'border-l-amber-400', iconBox: 'border-amber-400/30 bg-amber-400/10 text-amber-300', chip: 'text-amber-300', sign: '-' },
  abono: { label: 'Abono al hogar', icon: Home, border: 'border-l-violet-400', iconBox: 'border-violet-400/30 bg-violet-400/10 text-violet-300', chip: 'text-violet-300', sign: '-' },
} as const

/** One movement waiting for confirmation, read-only: used in the bell-style preview (the full card with Confirmar / Descartar lives in /pendientes). */
export function PendingMovementCard({ pm, onNavigate }: { pm: PendingMovement; onNavigate?: () => void }) {
  const navigate = useNavigate()
  const k = KIND[pm.kind]
  const Icon = k.icon
  const createdAt = pm.createdAt instanceof Date ? pm.createdAt : new Date(pm.createdAt)

  return (
    <button
      type="button"
      onClick={() => { navigate('/pendientes'); onNavigate?.() }}
      aria-label={`${k.label}: ${pm.concept || k.label}, ${formatCOP(pm.amount)}`}
      className={clsx(
        'w-full flex items-start gap-3 rounded-2xl border border-white/10 border-l-4 bg-[#0d263a] p-3 text-left transition hover:bg-[#0d263a]/70',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 focus-visible:outline-offset-2',
        k.border,
      )}
    >
      <span className={clsx('flex h-9 w-9 flex-shrink-0 items-center justify-center notch-sm border', k.iconBox)} aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="text-sm font-bold leading-snug text-[#f3f5f6] line-clamp-2">{pm.concept || k.label}</span>
          <span className={clsx('flex-shrink-0 font-mono text-sm font-bold tabular-nums', pm.kind === 'income' ? 'text-emerald-300' : 'text-rose-300')}>
            {k.sign}{formatCOP(pm.amount)}
          </span>
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10px] text-[#8a929a]">
          <span className={clsx('font-semibold uppercase tracking-wider', k.chip)}>{k.label}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={createdAt.toISOString()} className="font-mono">{relativeTime(createdAt)}</time>
        </span>
      </span>
    </button>
  )
}
