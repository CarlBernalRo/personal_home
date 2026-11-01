import { Fragment } from 'react'
import { format, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import {
  FIXED_EXPENSE_CATEGORIES, amountFor, entryKey, householdDebtDays, isAutoDebit, isPaused, monthKey, monthRange, periodAt, periodEntries, salaryLedgers, formatCOP,
  type ExtraIncome, type HouseholdDebtRow, type MonthEntry, type PeriodLedger, type SalaryPeriod, type VariableBudget, type VariableData,
} from '@/shared'
import { STATUS_META, entryStatusKey, statusGroup, type StatusKey } from './status'
import { HouseholdDebtCard } from './HouseholdDebtCard'
import { AppIcon } from '@/components/ui/AppIcon'
import { CalendarClock, Coins, Plus, Receipt } from 'lucide-react'

interface Props {
  /** Month the period is named after (it also hosts the expenses without a day). */
  month: string
  /** The pay period shown: from `start` to `end` (exclusive). */
  bounds: { start: Date; end: Date }
  expenses: any[]
  paymentIndex: Map<string, any>
  onSelect: (entry: MonthEntry<any>) => void
  /** Confirmed salaries; each one shows its pay day and the balance left after every expense it covers. */
  periods?: SalaryPeriod[]
  /** One-off incomes; shown on their date and added to the balance of the period they fall in. */
  extras?: ExtraIncome[]
  /** Variable budgets and their real spends: spends show on their date and lower the balance. */
  variable?: VariableData
  /** Content for a first item (position 0) above the days, e.g. the estimated expenses. */
  top?: React.ReactNode
  /** Shows only the expenses in this state (the progress bar picks it). */
  statusFilter?: StatusKey | null
  onClearFilter?: () => void
}

const shortMonth = (m: string) => {
  const [y, mm] = m.split('-').map(Number)
  return format(new Date(y, mm - 1, 1), 'MMM', { locale: es })
}

/** Day key of the entries that have no date: they go last. */
const NO_DAY = Number.MAX_SAFE_INTEGER

/** Vertical timeline of one pay period: each due day is a node, with the day's expenses under it. */
export function FixedTimeline({ month, bounds, expenses, paymentIndex, onSelect, periods = [], extras = [], variable, top, statusFilter = null, onClearFilter }: Props) {
  const today = new Date()
  const inRange = (d: Date) => d.getTime() >= bounds.start.getTime() && d.getTime() < bounds.end.getTime()
  const key = (d: Date) => startOfDay(d).getTime()
  const monthsInRange = monthRange(monthKey(bounds.start), monthKey(new Date(bounds.end.getTime() - 86_400_000)))

  const allItems = periodEntries(expenses, month, bounds, paymentIndex, today)
  const items = statusFilter ? allItems.filter((i) => statusGroup(entryStatusKey(i)) === statusFilter) : allItems

  // Group by due day; expenses without a day go last
  const groups = new Map<number, MonthEntry<any>[]>()
  for (const item of items) {
    const k = item.due ? key(item.due) : NO_DAY
    groups.set(k, [...(groups.get(k) ?? []), item])
  }
  // Salary pay days that fall in this period, and the balance left after each expense of a period
  const salaryDays = new Map<number, SalaryPeriod>()
  // Chained, so each salary also carries what the previous period left over
  const ledgers: Map<string, PeriodLedger> = salaryLedgers(periods, expenses, paymentIndex, today, extras, variable)
  for (const p of periods) {
    if (inRange(p.start)) salaryDays.set(key(p.start), p)
  }

  const balanceAfter = (e: MonthEntry<any>): number | null => {
    if (!e.due) return null
    const p = periodAt(periods, e.due)
    return p ? (ledgers.get(p.id)?.rows.get(entryKey(e))?.remaining ?? null) : null
  }

  const extraDays = new Map<number, ExtraIncome[]>()
  for (const x of extras) {
    if (!inRange(x.date)) continue
    extraDays.set(key(x.date), [...(extraDays.get(key(x.date)) ?? []), x])
  }

  const spendDays = new Map<number, VariableData['spends']>()
  for (const x of variable?.spends ?? []) {
    if (!inRange(x.date)) continue
    spendDays.set(key(x.date), [...(spendDays.get(key(x.date)) ?? []), x])
  }

  // Estimated expenses with a usual pay day: a reminder on that day (it doesn't change any balance)
  const reminderDays = new Map<number, VariableData['budgets']>()
  // Household-debt expenses: one card per expense and day, with a row per household and reason
  const linkedDays = new Map<number, { b: VariableBudget; rows: HouseholdDebtRow[] }[]>()
  for (const mk of monthsInRange) {
    const [y, m] = mk.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    for (const b of variable?.budgets ?? []) {
      if (!b.active || isPaused(b, mk)) continue
      if (b.source === 'household-debt') {
        for (const [day, rows] of householdDebtDays(b, variable, y, m - 1)) {
          const date = new Date(y, m - 1, day)
          if (!inRange(date)) continue
          linkedDays.set(key(date), [...(linkedDays.get(key(date)) ?? []), { b, rows }])
        }
      } else if (b.paymentDay) {
        const date = new Date(y, m - 1, Math.min(b.paymentDay, daysInMonth))
        if (inRange(date)) reminderDays.set(key(date), [...(reminderDays.get(key(date)) ?? []), b])
      }
    }
  }

  // Filtering by a state leaves only the days that have an expense in it
  const days = (statusFilter
    ? [...groups.keys()]
    : [...new Set([...groups.keys(), ...salaryDays.keys(), ...extraDays.keys(), ...spendDays.keys(), ...reminderDays.keys(), ...linkedDays.keys()])]
  ).sort((a, b) => a - b)

  if (items.length === 0) {
    return (
      <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-12 px-6">
        <p className="text-sm font-bold text-[#f0fae8]">
          {statusFilter ? `No hay gastos en estado “${STATUS_META[statusFilter].label}” en este período` : 'No hay gastos fijos en este período'}
        </p>
        {statusFilter && onClearFilter && (
          <button type="button" onClick={onClearFilter} className="mt-3 text-xs font-semibold text-brand-300 hover:text-brand-200 transition">Quitar el filtro</button>
        )}
      </div>
    )
  }

  const shown = (i: MonthEntry<any>) => (i.owed.length > 0 ? i.total : (i.payment?.paidAmount ?? amountFor(i.fe, i.hostMonth)))
  const totalDue = items.reduce((s, i) => s + shown(i), 0)
  let running = 0
  // The "today" marker goes before the first day that is still ahead of us.
  const todayKey = key(today)
  const showToday = inRange(today) && !statusFilter
  const markerBefore = showToday ? (days.find((d) => d >= todayKey) ?? null) : null
  const markerAtEnd = showToday && markerBefore === null

  const marker = (
    <li className="relative pl-9 py-1">
      <span className="absolute left-[7px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-brand-400 ring-4 ring-brand-400/20" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-brand-300">
        Hoy · {format(today, "d 'de' MMMM", { locale: es })}
      </span>
    </li>
  )

  return (
    <div className="bg-[#0a1f2f] border border-white/10 notch-sm p-3 sm:p-5">
      <ol className="relative space-y-3">
        {/* spine */}
        <span className="absolute left-[11px] top-2 bottom-2 w-px bg-white/15" aria-hidden />

        {top && !statusFilter && (
          <li className="relative pl-9">
            <span className="absolute left-0 top-1 w-6 h-6 rounded-full border-2 border-amber-400 bg-[#0a1f2f]" />
            {top}
          </li>
        )}

        {days.map((day) => {
          const group = groups.get(day) ?? []
          const salary = salaryDays.get(day)
          const date = day === NO_DAY ? null : new Date(day)
          return (
            <Fragment key={day}>
              {markerBefore === day && marker}
              <li className="relative pl-9">
                <span
                  className="absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center border-2 bg-[#0a1f2f]"
                  style={{ borderColor: STATUS_META[worst(group.map(keyOf))].dot }}
                >
                  <span className="text-[10px] font-mono font-bold text-white">{date ? date.getDate() : '·'}</span>
                </span>

                <p className="text-[11px] text-[#8a929a] capitalize mb-1.5">
                  {date ? format(date, "EEEE d 'de' MMMM", { locale: es }) : 'Sin día de pago definido'}
                </p>

                <div className="space-y-1.5">
                  {salary && (
                    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-brand-400/40 bg-brand-500/10">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-200"><Coins size={14} aria-hidden="true" /> Sueldo confirmado</span>
                      <span className="text-sm font-mono font-bold text-brand-200">+{formatCOP(salary.amount)}</span>
                    </div>
                  )}
                  {salary && (ledgers.get(salary.id)?.carryIn ?? 0) !== 0 && (() => {
                    const carry = ledgers.get(salary.id)!.carryIn
                    return (
                      <div className={clsx(
                        'flex items-center justify-between gap-3 px-3 py-2 rounded-lg border',
                        carry > 0 ? 'border-sky-400/40 bg-sky-500/10 text-sky-200' : 'border-red-400/40 bg-red-500/10 text-red-200',
                      )}>
                        <span className="text-sm font-semibold">{carry > 0 ? '↪ Sobrante del período anterior' : '↪ Faltante del período anterior'}</span>
                        <span className="text-sm font-mono font-bold">{carry > 0 ? '+' : '−'}{formatCOP(Math.abs(carry))}</span>
                      </div>
                    )
                  })()}
                  {(extraDays.get(day) ?? []).map((x) => (
                    <div key={x.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-violet-400/40 bg-violet-500/10">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-200 truncate"><Plus size={13} className="flex-shrink-0" aria-hidden="true" /> {x.concept}</span>
                      <span className="text-sm font-mono font-bold text-violet-200">+{formatCOP(x.amount)}</span>
                    </div>
                  ))}
                  {(linkedDays.get(day) ?? []).map(({ b, rows }) => (
                    <HouseholdDebtCard
                      key={b.id}
                      title={b.concept}
                      rows={rows.map((r, i) => ({ key: `${r.householdId}|${r.debt}|${i}`, householdId: r.householdId, household: r.household, debt: r.debt, detail: r.detail, amount: r.amount }))}
                    />
                  ))}
                  {(reminderDays.get(day) ?? []).map((b) => (
                    <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-dashed border-amber-400/30 text-amber-200/80">
                      <span className="inline-flex items-center gap-1.5 text-sm truncate"><CalendarClock size={13} className="flex-shrink-0" aria-hidden="true" /> {b.concept} <span className="text-[10px] uppercase tracking-wider">· ocasional</span></span>
                      <span className="text-sm font-mono">~{formatCOP(b.amount)}</span>
                    </div>
                  ))}
                  {(spendDays.get(day) ?? []).map((x) => (
                    <div key={x.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-orange-500/45 bg-orange-500/10">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-orange-300 truncate"><Receipt size={13} className="flex-shrink-0" aria-hidden="true" /> {x.concept}</span>
                      <span className="text-sm font-mono font-bold text-orange-300">−{formatCOP(x.amount)}</span>
                    </div>
                  ))}
                  {group.map((entry) => {
                    const { fe, payment, status, arrears } = entry
                    const cat = FIXED_EXPENSE_CATEGORIES.find((c) => c.id === fe.category)
                    running += shown(entry)
                    const paidOn = payment && entry.owed.length === 0
                      ? format(payment.paymentDate instanceof Date ? payment.paymentDate : new Date(payment.paymentDate ?? 0), 'd MMM', { locale: es })
                      : null
                    const hasArrears = arrears.length > 0
                    const balance = balanceAfter(entry)
                    return (
                      <button
                        key={`${fe.id}|${entry.hostMonth}`}
                        onClick={() => onSelect(entry)}
                        className={clsx(
                          'w-full flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 text-left px-3 py-2.5 rounded-lg border transition-colors',
                          hasArrears ? 'bg-red-500/[0.08]' : 'bg-[#0d263a]',
                          // the border always shows the payment status; hovering only intensifies it
                          STATUS_META[keyOf(entry)].border,
                          STATUS_META[keyOf(entry)].hover,
                        )}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <AppIcon name={cat?.icon} size={16} className="text-brand-300 flex-shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-[#f0fae8] truncate">{fe.concept}</span>
                            {paidOn && <span className="block text-[10px] font-mono text-brand-400">{payment?.auto ? 'debitado' : 'pagado'} el {paidOn}</span>}
                            {hasArrears && (
                              <span className="block text-[10px] font-mono text-red-300 capitalize">
                                {entry.owed.map((l) => `${shortMonth(l.occMonth)} ${formatCOP(l.amount)}`).join(' + ')}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="flex items-center justify-between gap-3 sm:justify-end sm:flex-shrink-0">
                          {/* fixed-width columns so amounts and statuses line up from row to row */}
                          <span className="sm:w-28 text-left sm:text-right leading-tight">
                            {hasArrears && <span className="block text-[9px] uppercase tracking-wider text-red-300">Total a pagar</span>}
                            <span className={clsx('text-sm font-mono tabular-nums', hasArrears && 'font-bold text-orange-300')}>
                              {formatCOP(shown(entry))}
                            </span>
                            {balance !== null && (
                              <span className={clsx('block max-lg:hidden text-[10px] font-mono', balance < 0 ? 'text-red-300' : 'text-brand-300')}>
                                saldo {formatCOP(balance)}
                              </span>
                            )}
                          </span>
                          <span className={clsx('sm:w-[11.5rem] text-center whitespace-nowrap rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wider border', STATUS_META[keyOf(entry)].chip)}>
                            {labelOf(entry)}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>

                <p className="max-lg:hidden text-[10px] font-mono text-[#5f6a72] mt-1">
                  acumulado {formatCOP(running)} de {formatCOP(totalDue)}
                </p>
              </li>
            </Fragment>
          )
        })}

        {markerAtEnd && marker}
      </ol>
    </div>
  )
}

/** Entries with unpaid earlier months get their own colour, distinct from a plain overdue one. */
const keyOf = entryStatusKey

/** Status text; an automatic-debit expense that isn't paid yet also says so ("Próximo · automático"). */
const labelOf = (e: MonthEntry<any>): string => {
  const key = keyOf(e)
  const pending = key !== 'paid' && key !== 'auto'
  return STATUS_META[key].label + (pending && isAutoDebit(e.fe, e.hostMonth) ? ' · automático' : '')
}

const SEVERITY = ['arrears', 'overdue', 'due-soon', 'pending', 'upcoming', 'auto', 'paid'] as const

/** Colour of a day's node: its most urgent status. */
function worst(statuses: string[]) {
  return SEVERITY.find((s) => statuses.includes(s)) ?? 'upcoming'
}
