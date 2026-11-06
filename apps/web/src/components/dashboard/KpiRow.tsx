import { Link } from 'react-router-dom'
import { differenceInCalendarDays, format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { ReactNode } from 'react'
import { Landmark, PiggyBank, Flag, Coins, TriangleAlert, type LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'
import type { DashboardData } from '@/hooks/useDashboardData'
import { IconTip } from '@/components/ui/IconTip'
import { SegmentedBar } from '@/components/ui/SegmentedBar'
import { useMoneyMask } from '@/hooks/useMoneyMask'

interface TileProps {
  label: string
  value: string
  hint: string
  icon: LucideIcon
  tone: string
  /** Value text color class; defaults to the primary text. */
  valueClass?: string
  warn?: boolean
  /** Explains the figure; shown from the icon. */
  info: string
  /** On phones the tile takes the whole row (the headline figure); from `lg` up it is one cell. */
  wide?: boolean
  /** Extra content under the hint (for the accounts breakdown). */
  extra?: ReactNode
}

function Tile({ label, value, hint, icon: Icon, tone, valueClass, warn, info, wide, extra }: TileProps) {
  return (
    <div className={clsx('notch-sm bg-[#0a1f2f] border border-white/10 p-3 sm:p-4 min-w-0', wide && 'col-span-2 lg:col-span-1')}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-[#9aa4ac] truncate">{label}</span>
        <IconTip text={info} className="inline-flex flex-shrink-0 cursor-help focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400">
          <div
            className="w-7 h-7 notch-sm flex items-center justify-center"
            style={{ backgroundColor: tone + '26', border: `1px solid ${tone}55`, color: tone }}
          >
            <Icon size={14} aria-hidden="true" />
          </div>
        </IconTip>
      </div>
      <p className={clsx('text-lg sm:text-2xl font-bold font-mono tracking-tight truncate', valueClass ?? 'text-[#f0fae8]')} title={value}>{value}</p>
      <p className="mt-0.5 text-[11px] text-[#8a929a] flex items-center gap-1 min-w-0">
        {warn && <TriangleAlert size={11} className="text-red-300 flex-shrink-0" aria-hidden="true" />}
        <span className="truncate">{hint}</span>
      </p>
      {extra}
    </div>
  )
}

const shortDate = (d: Date) => format(d, "d 'de' MMM", { locale: es })

/** Headline numbers: money now, what the period leaves, where the account lands, what came in. `compact` is a 2x2 grid for a narrow column. */
export function KpiRow({ outlook, ledger, income, salary, compact = false }: Pick<DashboardData, 'outlook' | 'ledger' | 'income' | 'salary'> & { compact?: boolean }) {
  const formatCOP = useMoneyMask()
  const hasSalary = !!salary.currentPeriod
  // With accounts, "money in your accounts" is what they hold, and each one is listed under the total
  const accounts = salary.accounts as { id: string; name: string; balance: number; color?: string }[]
  const accountsTotal = accounts.reduce((sum, a) => sum + a.balance, 0)

  if (!outlook && !ledger) {
    return (
      <div className="notch bg-[#0a1f2f] border border-brand-500/30 p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 notch-sm bg-brand-500/15 border border-brand-500/30 text-brand-400 flex items-center justify-center flex-shrink-0" aria-hidden="true">
            <Coins size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#f0fae8]">Aún no hay un sueldo confirmado</p>
            <p className="text-xs text-[#9aa4ac]">Confírmalo arriba o configura tus fechas de pago para ver tu resumen del período.</p>
          </div>
        </div>
        <Link
          to="/perfil"
          className="self-start sm:self-auto notch-sm px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold interactive-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300 focus-visible:outline-offset-2"
        >
          Configurar sueldo
        </Link>
      </div>
    )
  }

  const left = ledger?.remaining ?? 0
  const pay = outlook?.projection.nextPay
  const days = pay ? differenceInCalendarDays(pay.date, new Date()) : 0
  const end = outlook?.projection.endBalance ?? 0
  const carry = ledger?.carryIn ?? 0

  return (
    <div className={compact ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-2 lg:grid-cols-4 gap-3'} aria-label="Indicadores del período" role="group">
      <Tile
        label={accounts.length > 0 ? 'Dinero en tus cuentas' : 'Dinero en cuenta'}
        value={accounts.length > 0 ? formatCOP(accountsTotal) : outlook ? formatCOP(outlook.cash) : '—'}
        info="Lo que hay en tus cuentas hoy: lo que entró en cada una (sueldos e ingresos), menos lo que pagaste desde ella, más o menos lo que moviste entre cuentas."
        hint={accounts.length > 0 ? `Total de ${accounts.length} ${accounts.length === 1 ? 'cuenta' : 'cuentas'}` : outlook ? 'Lo que tienes hoy' : 'Sin sueldo confirmado'}
        extra={accounts.length > 1 && accounts.some((x) => x.balance > 0) ? (
          // the same tall bar as "¿A dónde se fue el sueldo?": one segment per account, with what it holds written inside
          <SegmentedBar
            showValue
            className="mt-3 !h-7 !p-0 !border-0 !bg-transparent"
            label="Reparto del dinero entre tus cuentas"
            parts={accounts.map((x) => ({ key: x.id, label: x.name, value: Math.max(x.balance, 0), color: x.color ?? '#52b69a' }))}
          />
        ) : undefined}
        icon={Landmark}
        wide
        tone="#38bdf8"
        valueClass="text-sky-200"
      />
      <Tile
        label="Te queda del período"
        value={ledger ? formatCOP(left) : '—'}
        hint={carry !== 0 ? `Incluye ${carry > 0 ? 'arrastre de' : 'déficit de'} ${formatCOP(Math.abs(carry))}` : 'Tras fijos, adicionales y reservas'}
        info="Lo que sobra de este período de sueldo después de los fijos pendientes, los gastos adicionales y lo reservado para ocasionales. Incluye lo que dejó el período anterior."
        icon={PiggyBank}
        tone="#52b69a"
        valueClass={left < 0 ? 'text-red-400' : 'text-brand-300'}
        warn={left < 0}
      />
      <Tile
        label="Llegarías con"
        value={outlook ? formatCOP(end) : '—'}
        hint={pay ? `${shortDate(pay.date)} · ${days <= 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`}` : 'Sin próxima fecha de pago'}
        info="Con cuánto dinero llegas el día del próximo sueldo si pagas todo lo pendiente y respetas lo reservado para ocasionales."
        icon={Flag}
        tone="#f59e0b"
        valueClass={end < 0 ? 'text-red-400' : 'text-[#f0fae8]'}
        warn={end < 0}
      />
      <Tile
        label="Ingresos del período"
        value={hasSalary ? formatCOP(income) : '—'}
        hint={ledger && ledger.extraTotal > 0 ? `Incluye ${formatCOP(ledger.extraTotal)} extra` : 'Sueldo del período'}
        info="Todo lo que entró en este período: tu sueldo más los ingresos adicionales. No cuenta lo que sobró del período anterior."
        icon={Coins}
        wide
        tone="#76c893"
      />
    </div>
  )
}
