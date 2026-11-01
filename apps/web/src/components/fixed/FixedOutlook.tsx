import { differenceInCalendarDays, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarClock, TriangleAlert } from 'lucide-react'
import { clsx } from 'clsx'
import { formatCOP, type PayProjection } from '@/shared'

interface Props {
  cash: number
  projection: PayProjection
}

const longDate = (d: Date) => format(d, "d 'de' MMMM", { locale: es })

/** What the account will hold the day the next salary arrives, and where it would run short. */
export function FixedOutlook({ cash, projection }: Props) {
  const { nextPay, pendingTotal, reserved, endBalance, shortfallOn } = projection
  const days = differenceInCalendarDays(nextPay.date, new Date())
  const short = endBalance < 0

  const rows: { label: string; value: number; tone?: string }[] = [
    { label: 'En tu cuenta ahora', value: cash, tone: 'text-sky-300' },
    { label: 'Pagos fijos pendientes', value: -pendingTotal },
    ...(reserved > 0 ? [{ label: 'Reservado para ocasionales', value: -reserved, tone: 'text-amber-300' }] : []),
  ]

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 space-y-3 shadow-xl">
      <div className="flex items-center gap-2 text-xs font-semibold text-[#9aa4ac]">
        <CalendarClock size={14} className="text-brand-400 flex-shrink-0" />
        <span className="min-w-0">
          <span className="max-sm:block">Hasta tu próximo sueldo<span className="hidden sm:inline"> · {longDate(nextPay.date)}</span></span>
          <span className="max-sm:block max-sm:text-[11px] max-sm:font-normal max-sm:text-[#8a929a]">
            <span className="sm:hidden">{longDate(nextPay.date)} · {days === 1 ? 'mañana' : `en ${days} días`}</span>
            <span className="hidden sm:inline text-[#5f6a72] font-normal"> ({days === 1 ? 'mañana' : `en ${days} días`})</span>
          </span>
        </span>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Llegarías con</p>
        <p className={clsx('text-2xl font-bold font-mono tabular-nums', short ? 'text-red-400' : 'text-brand-300')}>
          {formatCOP(endBalance)}
        </p>
      </div>

      <div className="space-y-1 text-xs font-mono border-t border-white/10 pt-2">
        {rows.map((r) => (
          <p key={r.label} className="flex justify-between gap-3 text-[#c7ccd1]">
            <span>{r.label}</span>
            <span className={clsx('font-bold', r.tone ?? 'text-[#f0fae8]')}>{r.value < 0 ? '−' : ''}{formatCOP(Math.abs(r.value))}</span>
          </p>
        ))}
      </div>

      {short && (
        <p className="flex items-start gap-2 text-xs text-red-300">
          <TriangleAlert size={14} className="flex-shrink-0 mt-0.5" />
          {shortfallOn
            ? `Te quedarías sin fondos el ${longDate(shortfallOn)}: faltan ${formatCOP(-endBalance)} para cubrir todo.`
            : `Los pagos alcanzan, pero no con lo reservado para ocasionales: faltan ${formatCOP(-endBalance)}.`}
        </p>
      )}
    </div>
  )
}
