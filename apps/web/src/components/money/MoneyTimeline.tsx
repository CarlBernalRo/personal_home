import { Fragment } from 'react'
import { format, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { ArrowLeftRight, Banknote, Bell, CalendarCheck, CalendarClock, Check, ChevronRight, Home, Receipt, ShoppingBag } from 'lucide-react'
import {
  FIXED_EXPENSE_CATEGORIES, amountFor, entryKey, householdDebtDays, isAutoDebit, isPaused, monthKey, monthRange, periodAt, salaryLedgers, formatCOP,
  type ExtraIncome, type HouseholdDebtRow, type MonthEntry, type PeriodLedger, type SalaryPeriod, type VariableBudget, type VariableData,
} from '@/shared'
import { STATUS_META, entryAccountId, entryDisplayDate, entryStatusKey, paidOffDue } from '@/components/fixed/status'
import { HouseholdDebtCard } from '@/components/fixed/HouseholdDebtCard'
import { AttachmentButton } from '@/components/pending/AttachmentButton'
import { AccountChip, type AccountLite } from '@/components/ui/AccountChip'
import { AppIcon } from '@/components/ui/AppIcon'
import { Avatar } from '@/components/ui/Avatar'
import { TagChip } from '@/components/ui/TagPicker'
import { useTags } from '@/hooks/useTags'
import { tagsOf, type Tag } from '@/shared'
import { SERIES } from '@/components/dashboard/shared'

/** Every kind of money movement the personal view mixes. */
export type FlowKind = 'income' | 'fixed' | 'occasional' | 'additional' | 'household' | 'transfer' | 'reminder'

export const FLOW_KINDS: { id: FlowKind; label: string; single: string; color: string; icon: typeof Receipt }[] = [
  { id: 'income',     label: 'Ingresos',    single: 'Ingreso',    color: '#a78bfa',         icon: Banknote },
  { id: 'fixed',      label: 'Fijos',       single: 'Fijo',       color: SERIES.fixed,      icon: CalendarCheck },
  { id: 'occasional', label: 'Ocasionales', single: 'Ocasional', color: '#f59e0b',         icon: CalendarClock },
  { id: 'additional', label: 'Adicionales', single: 'Adicional', color: SERIES.additional, icon: ShoppingBag },
  { id: 'household',  label: 'Hogar',       single: 'Abono hogar',       color: '#38bdf8',         icon: Home },
  { id: 'transfer',   label: 'Traslados',   single: 'Traslado',   color: '#84cc16',         icon: ArrowLeftRight },
  { id: 'reminder',   label: 'Recordatorios', single: 'Recordatorio', color: '#cbd5e1',       icon: Bell },
]
export const flowKind = (id: FlowKind) => FLOW_KINDS.find((k) => k.id === id)!

/** A family member who shared a fixed expense with the user: their entries are shown read only, with their face. */
export interface SharedOwner { uid: string; name: string; photo: string | null }
/** A period entry of the timeline: the user's own fixed expense, or one a family member shared (`owner`). */
export type TimelineEntry = MonthEntry<any> & { owner?: SharedOwner }

/** One movement that is not a fixed expense: an income, a spend, a household abono or a transfer. */
export interface FlowItem {
  id: string
  kind: Exclude<FlowKind, 'fixed'>
  date: Date
  concept: string
  /** Second line: the category, the household, "Sueldo"… */
  sub?: string
  /** Positive when money came in, negative when it went out; a transfer is shown as moved (no sign). */
  amount: number
  accountId?: string
  /** For a transfer: the account the money went to. */
  toAccountId?: string
  attachmentId?: string
  notes?: string
  /** Older records that don't count in the balance (shown greyed, as history). */
  history?: boolean
  /** Registered without an account (paid or received in cash): listed, but it moves none of the tracked money. */
  cash?: boolean
  /** A family member's (a shared reminder): drawn with their face and the family border. */
  owner?: SharedOwner
  /** For a reminder: this date is already done. */
  done?: boolean
  /** The user's tags it carries (an occasional spend carries its occasional's). */
  tagIds?: string[]
  onEdit?: () => void
  onDelete?: () => void
}

interface Props {
  /** The pay period shown: from `start` to `end` (exclusive). */
  bounds: { start: Date; end: Date }
  expenses: any[]
  paymentIndex: Map<string, any>
  /** The period's fixed expenses (the user's and the ones shared with them), already filtered. */
  entries: TimelineEntry[]
  /** The other movements, already filtered. */
  items: FlowItem[]
  /** Show the occasional reminders and household-debt cards (off while filtering by account or state). */
  showBudgets: boolean
  onSelect: (entry: TimelineEntry) => void
  /** Opens the detail of any other movement. */
  onOpenItem: (item: FlowItem) => void
  periods?: SalaryPeriod[]
  extras?: ExtraIncome[]
  variable?: VariableData
  /** Content for a first item above the days, e.g. the estimated occasional expenses. */
  top?: React.ReactNode
  /** A filter is on: the empty state offers to clear it and the "today" marker stays out. */
  filtering: boolean
  onClearFilter?: () => void
  accounts?: AccountLite[]
}

const shortMonth = (m: string) => {
  const [y, mm] = m.split('-').map(Number)
  return format(new Date(y, mm - 1, 1), 'MMM', { locale: es })
}

/** Day key of the fixed expenses that have no date: they go last. */
const NO_DAY = Number.MAX_SAFE_INTEGER
const ORDER: FlowItem['kind'][] = ['reminder', 'income', 'occasional', 'additional', 'household', 'transfer']

/**
 * The whole pay period in one vertical timeline, newest first: incomes, fixed expenses (with their payment
 * state and the balance left after each), occasional and additional spends, household abonos and transfers.
 */
export function MoneyTimeline({ bounds, expenses, paymentIndex, entries, items, showBudgets, onSelect, onOpenItem, periods = [], extras = [], variable, top, filtering, onClearFilter, accounts = [] }: Props) {
  const { tags } = useTags()
  const today = new Date()
  const inRange = (d: Date) => d.getTime() >= bounds.start.getTime() && d.getTime() < bounds.end.getTime()
  const key = (d: Date) => startOfDay(d).getTime()
  const monthsInRange = monthRange(monthKey(bounds.start), monthKey(new Date(bounds.end.getTime() - 86_400_000)))

  const fixedDays = new Map<number, TimelineEntry[]>()
  for (const e of entries) {
    const shownOn = entryDisplayDate(e)
    const k = shownOn ? key(shownOn) : NO_DAY
    fixedDays.set(k, [...(fixedDays.get(k) ?? []), e])
  }
  const flowDays = new Map<number, FlowItem[]>()
  for (const x of items) flowDays.set(key(x.date), [...(flowDays.get(key(x.date)) ?? []), x])

  // Chained, so each salary also carries what the previous period left over
  const ledgers: Map<string, PeriodLedger> = salaryLedgers(periods, expenses, paymentIndex, today, extras, variable)
  const balanceAfter = (e: MonthEntry<any>): number | null => {
    if (!e.due) return null
    const p = periodAt(periods, e.due)
    return p ? (ledgers.get(p.id)?.rows.get(entryKey(e))?.remaining ?? null) : null
  }

  // Occasional expenses with a usual pay day: a reminder on that day; household-debt ones: a card per day
  const reminderDays = new Map<number, VariableBudget[]>()
  const linkedDays = new Map<number, { b: VariableBudget; rows: HouseholdDebtRow[] }[]>()
  if (showBudgets) {
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
  }

  const days = [...new Set([...fixedDays.keys(), ...flowDays.keys(), ...reminderDays.keys(), ...linkedDays.keys()])].sort((a, b) => a - b)
  const dated = days.filter((d) => d !== NO_DAY).reverse()
  const daysShown = days.includes(NO_DAY) ? [...dated, NO_DAY] : dated

  if (entries.length === 0 && items.length === 0) {
    return (
      <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-12 px-6">
        <p className="text-sm font-bold text-[#f0fae8]">
          {filtering ? 'No hay movimientos que coincidan con los filtros en este período' : 'No hay movimientos en este período'}
        </p>
        <p className="text-xs text-[#8a929a] mt-1">{filtering ? 'Prueba quitando algún filtro.' : 'Usa "Registrar" para anotar un gasto, un ingreso o programar un pago.'}</p>
        {filtering && onClearFilter && (
          <button type="button" onClick={onClearFilter} className="mt-3 text-xs font-semibold text-brand-300 hover:text-brand-200 transition">Quitar los filtros</button>
        )}
      </div>
    )
  }

  const shown = (i: MonthEntry<any>) => (i.owed.length > 0 ? i.total : (i.payment?.paidAmount ?? amountFor(i.fe, i.hostMonth)))
  const todayKey = key(today)
  const showToday = inRange(today) && !filtering
  const markerBefore = showToday ? (daysShown.find((d) => d !== NO_DAY && d <= todayKey) ?? null) : null
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
        <span className="absolute left-[11px] top-2 bottom-2 w-px bg-white/15" aria-hidden />

        {top && !filtering && (
          <li className="relative pl-9">
            <span className="absolute left-0 top-1 w-6 h-6 rounded-full border-2 border-amber-400 bg-[#0a1f2f]" />
            {top}
          </li>
        )}

        {daysShown.map((day) => {
          const fixed = fixedDays.get(day) ?? []
          const flows = [...(flowDays.get(day) ?? [])].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
          const date = day === NO_DAY ? null : new Date(day)
          // the node takes the most urgent fixed state of the day, else the colour of its biggest movement
          const lead = [...flows].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0]
          const nodeColor = fixed.length > 0 ? STATUS_META[worst(fixed.map(entryStatusKey))].dot : lead ? flowKind(lead.kind).color : '#f59e0b'
          const net = flows.filter((f) => f.kind !== 'transfer' && f.kind !== 'reminder' && !f.history && !f.cash).reduce((s, f) => s + f.amount, 0)
            - fixed.filter((e) => !e.owner && e.owed.length === 0).reduce((s, e) => s + (e.payment?.paidAmount ?? 0), 0)
          const moved = flows.filter((f) => f.kind !== 'reminder').length + fixed.filter((e) => !e.owner && e.owed.length === 0).length
          return (
            <Fragment key={day}>
              {markerBefore === day && marker}
              <li className="relative pl-9">
                <span className="absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center border-2 bg-[#0a1f2f]" style={{ borderColor: nodeColor }}>
                  <span className="text-[10px] font-mono font-bold text-white">{date ? date.getDate() : '·'}</span>
                </span>

                <p className="text-[11px] text-[#8a929a] capitalize mb-1.5">
                  {date ? format(date, "EEEE d 'de' MMMM", { locale: es }) : 'Sin día de pago definido'}
                </p>

                <div className="space-y-1.5">
                  {(linkedDays.get(day) ?? []).map(({ b, rows }) => (
                    <HouseholdDebtCard
                      key={b.id}
                      title={b.concept}
                      rows={rows.map((r, i) => ({ key: `${r.householdId}|${r.debt}|${i}`, householdId: r.householdId, household: r.household, debt: r.debt, detail: r.detail, amount: r.amount }))}
                    />
                  ))}
                  {(reminderDays.get(day) ?? []).map((b) => (
                    <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-dashed border-amber-400/30 text-amber-200/80">
                      <span className="inline-flex items-center gap-1.5 text-sm truncate"><CalendarClock size={13} className="flex-shrink-0" aria-hidden="true" /> {b.concept} <span className="text-[10px] uppercase tracking-wider">· ocasional estimado</span></span>
                      <span className="text-sm font-mono">~{formatCOP(b.amount)}</span>
                    </div>
                  ))}

                  {flows.filter((f) => f.kind === 'reminder').map((f) => <FlowRow key={f.id} item={f} accounts={accounts} onOpen={() => onOpenItem(f)} tags={tags} />)}
                  {flows.filter((f) => f.kind === 'income').map((f) => <FlowRow key={f.id} item={f} accounts={accounts} onOpen={() => onOpenItem(f)} tags={tags} />)}

                  {fixed.map((entry) => {
                    const { fe, payment, arrears } = entry
                    const cat = FIXED_EXPENSE_CATEGORIES.find((c) => c.id === fe.category)
                    const paidOn = payment && entry.owed.length === 0
                      ? format(payment.paymentDate instanceof Date ? payment.paymentDate : new Date(payment.paymentDate ?? 0), 'd MMM', { locale: es })
                      : null
                    const hasArrears = arrears.length > 0
                    const owner = entry.owner
                    // a family member's expense: theirs to manage, so no balance, account or receipt of the user's here
                    const balance = owner ? null : balanceAfter(entry)
                    const sk = entryStatusKey(entry)
                    return (
                      <button
                        key={`${fe.id}|${entry.hostMonth}`}
                        onClick={() => onSelect(entry)}
                        className={clsx(
                          'w-full flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 text-left px-3 py-2.5 rounded-lg border transition-colors',
                          // a family member's expense stands apart in white (its state still shows in the chip); mine keep the state colour
                          owner
                            ? 'interactive-icon family-row'
                            : clsx(hasArrears ? 'bg-red-500/[0.08]' : 'bg-[#0d263a]', STATUS_META[sk].border, STATUS_META[sk].hover),
                        )}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          {owner
                            ? <span title={`Gasto de ${owner.name}`} className="family-ring flex-shrink-0"><Avatar name={owner.name} photoURL={owner.photo} size={20} className="!ring-0" /></span>
                            : <AppIcon name={cat?.icon} size={16} className="text-brand-300 flex-shrink-0" />}
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-[#f0fae8] break-words sm:truncate">
                              {fe.concept}
                              <span className="ml-2 align-middle text-[9px] font-bold uppercase tracking-wider rounded px-1 py-0.5 border" style={{ color: SERIES.fixed, borderColor: SERIES.fixed + '66' }}>{fe.oneTime ? 'programado' : 'fijo'}</span>
                              {owner && <span className="family-tag ml-1.5 align-middle text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5">de {owner.name}</span>}
                            </span>
                            {!owner && <TagRow tags={tagsOf(fe.tagIds, tags)} />}
                            {paidOn && <span className="block text-[10px] font-mono text-brand-400">{payment?.auto ? 'debitado' : 'pagado'} el {paidOn}{paidOffDue(entry) && entry.due ? ` · vencía el ${format(entry.due, 'd MMM', { locale: es })}` : ''}</span>}
                            {!owner && <AccountChip account={accounts.find((a) => a.id === entryAccountId(entry))} planned={!payment} />}
                            {hasArrears && (
                              <span className="block text-[10px] font-mono text-red-300 capitalize">
                                {entry.owed.map((l) => `${shortMonth(l.occMonth)} ${formatCOP(l.amount)}`).join(' + ')}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="flex items-center justify-between gap-3 sm:justify-end sm:flex-shrink-0">
                          <span className="sm:w-28 text-left sm:text-right leading-tight">
                            {hasArrears && <span className="block text-[9px] uppercase tracking-wider text-red-300">Total a pagar</span>}
                            <span className={clsx('text-sm font-mono tabular-nums', hasArrears ? 'font-bold text-red-200' : 'text-rose-300')}>
                              −{formatCOP(shown(entry))}
                            </span>
                            {balance !== null && (
                              <span className={clsx('block max-lg:hidden text-[10px] font-mono', balance < 0 ? 'text-red-300' : 'text-brand-300')}>
                                saldo {formatCOP(balance)}
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-2">
                            {!owner && (payment as any)?.attachmentId ? <AttachmentButton compact attachmentId={(payment as any).attachmentId} /> : <span className="hidden sm:block w-7 flex-shrink-0" aria-hidden="true" />}
                            <span className={clsx('sm:w-[9.5rem] text-center whitespace-nowrap rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wider border', STATUS_META[sk].chip)}>
                              {labelOf(entry)}
                            </span>
                            {owner ? <ChevronRight size={14} className="hidden sm:block w-7 flex-shrink-0 text-[#76c893]" aria-hidden="true" /> : <span className="hidden sm:block w-7 flex-shrink-0" aria-hidden="true" />}
                          </span>
                        </span>
                      </button>
                    )
                  })}

                  {flows.filter((f) => f.kind !== 'income' && f.kind !== 'reminder').map((f) => <FlowRow key={f.id} item={f} accounts={accounts} onOpen={() => onOpenItem(f)} tags={tags} />)}
                </div>

                {moved > 1 && (
                  <p className="max-lg:hidden text-[10px] font-mono text-[#5f6a72] mt-1">
                    neto del día {net >= 0 ? '+' : '−'}{formatCOP(Math.abs(net))}
                  </p>
                )}
              </li>
            </Fragment>
          )
        })}

        {markerAtEnd && marker}
      </ol>
    </div>
  )
}

/** One movement that isn't a fixed expense, coloured by its kind, with its own edit/delete when it has them. */
/** The tags of a row, as small chips under its name. */
function TagRow({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) return null
  return <span className="mt-0.5 mb-0.5 flex flex-wrap gap-1">{tags.map((t) => <TagChip key={t.id} tag={t} />)}</span>
}

function FlowRow({ item, accounts, onOpen, tags }: { item: FlowItem; accounts: AccountLite[]; onOpen: () => void; tags: Tag[] }) {
  const kind = flowKind(item.kind)
  const Icon = kind.icon
  const color = item.history ? '#6b7280' : kind.color
  const acc = accounts.find((a) => a.id === item.accountId)
  const to = item.toAccountId ? accounts.find((a) => a.id === item.toAccountId) : undefined
  const isTransfer = item.kind === 'transfer'
  const isReminder = item.kind === 'reminder'
  const owner = item.owner
  return (
    // a div acting as a button: the receipt button inside can't live in a real <button>
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      aria-label={`Ver el detalle de ${item.concept}`}
      // same hover as a fixed expense's row: the border lights up and the icons glow (`interactive-icon`)
      className={clsx(
        'interactive-icon w-full cursor-pointer flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 text-left px-3 py-2.5 rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400',
        owner ? 'family-row' : 'border bg-[#0d263a] [border-color:var(--row-border)] hover:[border-color:var(--row-border-hover)]',
        isReminder && !owner && 'border-dashed',
        isReminder && item.done && 'opacity-70',
      )}
      style={owner ? undefined : ({ '--row-border': color + '66', '--row-border-hover': color + 'cc' } as React.CSSProperties)}
    >
      <span className="flex items-center gap-2.5 min-w-0">
        {owner
          ? <span title={`De ${owner.name}`} className="family-ring flex-shrink-0"><Avatar name={owner.name} photoURL={owner.photo} size={20} className="!ring-0" /></span>
          : <Icon size={16} className="flex-shrink-0" style={{ color }} aria-hidden="true" />}
        <span className="min-w-0">
          <span className={clsx('block text-sm font-semibold text-[#f0fae8] break-words sm:truncate', isReminder && item.done && 'line-through decoration-white/40')}>
            {item.concept}
            {owner && <span className="family-tag ml-1.5 align-middle text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 no-underline inline-block">de {owner.name}</span>}
          </span>
          {item.sub && <span className="block text-[10px] font-mono text-[#8a929a] sm:truncate">{item.sub}</span>}
          {!item.owner && <TagRow tags={tagsOf(item.tagIds, tags)} />}
          {item.notes && <span className="block break-words text-[11px] italic text-[#9aa4ac]">{item.notes}</span>}
          {isTransfer
            ? <span className="block text-[10px] font-mono text-[#9aa4ac]">{acc?.name ?? 'Cuenta'} → {to?.name ?? 'Cuenta'}</span>
            : acc ? <AccountChip account={acc} /> : item.cash ? <span className="block text-[10px] font-mono text-[#9aa4ac]">Efectivo · sin cuenta, no descuenta de tus cuentas</span> : null}
        </span>
      </span>
      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:flex-nowrap sm:justify-end sm:flex-shrink-0">
        {isReminder ? (
          <span className={clsx('whitespace-nowrap sm:w-28 text-left sm:text-right text-xs font-semibold inline-flex sm:justify-end items-center gap-1', item.done ? 'text-brand-300' : 'text-[#cbd5e1]')}>
            {item.done ? <><Check size={12} aria-hidden="true" /> Hecho</> : 'Pendiente'}
          </span>
        ) : (
          <span className={clsx('whitespace-nowrap sm:w-28 text-left sm:text-right text-base sm:text-sm font-mono tabular-nums font-semibold', isTransfer || item.cash ? 'text-[#c7ccd1]' : item.amount >= 0 ? 'text-emerald-300' : 'text-rose-300')} title={item.cash ? 'En efectivo: no se suma ni se resta de tus cuentas' : undefined}>
            {isTransfer ? '' : item.amount >= 0 ? '+' : '−'}{formatCOP(Math.abs(item.amount))}
          </span>
        )}
        <span className="flex items-center gap-2">
          {item.attachmentId ? <span onClick={(e) => e.stopPropagation()}><AttachmentButton compact attachmentId={item.attachmentId} /></span> : <span className="hidden sm:block w-7 flex-shrink-0" aria-hidden="true" />}
          <span
            className="sm:w-[9.5rem] text-center whitespace-nowrap rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wider border"
            style={{ backgroundColor: color + '26', color, borderColor: color + '66' }}
          >
            {item.history ? 'Anterior · no cuenta' : kind.single}
          </span>
          <ChevronRight size={14} className="hidden sm:block w-7 flex-shrink-0 text-[#5f6a72]" aria-hidden="true" />
        </span>
      </span>
    </div>
  )
}

const labelOf = (e: MonthEntry<any>): string => {
  const k = entryStatusKey(e)
  const pending = k !== 'paid' && k !== 'auto'
  return STATUS_META[k].label + (pending && isAutoDebit(e.fe, e.hostMonth) ? ' · automático' : '')
}

const SEVERITY = ['arrears', 'overdue', 'due-soon', 'pending', 'upcoming', 'auto', 'paid'] as const
function worst(statuses: string[]) {
  return SEVERITY.find((s) => statuses.includes(s)) ?? 'upcoming'
}
