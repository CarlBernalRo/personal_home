import { Fragment, useState } from 'react'
import { format, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Avatar } from '@/components/ui/Avatar'
import { ChevronDown } from 'lucide-react'
import { formatCOP, remainingOf } from '@/shared'
import { STATUS_META, STATUS_SEVERITY, statusOf, type LedgerRow, type Rec } from './ledger'

interface Props {
  rows: LedgerRow[]
  /** Balance (me - partner) right before the first row; null when nothing was inherited. */
  carryIn: number | null
  /** Total the household owed before the first row (used when it has more than two people). */
  carryOwed?: number
  /** Movements older than the ones shown, and the switch to see (or hide) them. */
  olderCount?: number
  showingOlder?: boolean
  onToggleOlder?: () => void
  /** More than two people: balances are each person's own total instead of "me vs. the other". */
  multi?: boolean
  myName: string
  partnerName: string
  nameOf: (uid: string) => string
  photoOf: (uid: string) => string | null
  /** Who is looking, and what to do when they want to confirm a payment they received. */
  myUid?: string
  onConfirmReceipt?: (payment: LedgerRow) => void
  /** Name of one of my accounts, to say where a payment came from. */
  accountName?: (id: string) => string | null
  colorOf: (uid: string) => string
  /** The month being viewed contains today, so the "Hoy" marker is drawn. */
  showToday: boolean
  onSelectDebt: (debt: Rec) => void
}

const VERB = { deuda: 'registró', abono: 'abonó', cruce: 'cruzó' } as const

/** Vertical timeline of the month, like Gastos Fijos: each day is a node, each movement a row bordered by its state. */
export function HouseholdTimeline({ rows, carryIn, carryOwed = 0, multi = false, olderCount = 0, showingOlder = false, onToggleOlder, myName, partnerName, nameOf, photoOf, accountName, colorOf, myUid, onConfirmReceipt, showToday, onSelectDebt }: Props) {
  const today = startOfDay(new Date())
  // debts whose abonos / crossings are unfolded
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const owesRow = (r: LedgerRow) => multi
    ? (r.totals[r.debtor] > 0 ? `${nameOf(r.debtor)} debe ${formatCOP(r.totals[r.debtor])}` : `${nameOf(r.debtor)} al día`)
    : owes(r.diffAfter)
  const owes = (diff: number) => (diff > 0 ? `${myName} debe ${formatCOP(diff)}` : diff < 0 ? `${partnerName} debe ${formatCOP(-diff)}` : 'cuentas al día')

  const byDay = new Map<number, LedgerRow[]>()
  for (const r of rows) {
    const k = startOfDay(r.date).getTime()
    byDay.set(k, [...(byDay.get(k) ?? []), r])
  }
  const days = [...byDay.keys()].sort((a, b) => a - b)

  // The "today" marker goes before the first day that is still ahead of us
  const markerBefore = showToday ? (days.find((d) => d >= today.getTime()) ?? null) : null
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

        {olderCount > 0 && onToggleOlder && (
          <li className="relative pl-9">
            <span className="absolute left-[7px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white/30 bg-[#0a1f2f]" />
            <button onClick={onToggleOlder} className="text-xs font-semibold text-brand-300 hover:text-white transition">
              {showingOlder ? 'Ocultar lo anterior' : `Ver lo anterior (${olderCount} ${olderCount === 1 ? 'movimiento ya pagado' : 'movimientos ya pagados'})`}
            </button>
          </li>
        )}

        {(multi ? carryOwed > 0 : carryIn !== null && carryIn !== 0) && (
          <li className="relative pl-9">
            <span className="absolute left-0 top-1 w-6 h-6 rounded-full border-2 border-sky-400 bg-[#0a1f2f]" />
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3 px-3 py-2 rounded-lg border border-sky-400/40 bg-sky-500/10 text-sky-200">
              <span className="text-sm font-semibold">↪ Saldo arrastrado de meses anteriores</span>
              <span className="text-sm font-mono font-bold">{multi ? `el hogar debe ${formatCOP(carryOwed)}` : owes(carryIn ?? 0)}</span>
            </div>
          </li>
        )}

        {days.map((day) => {
          const items = byDay.get(day)!
          const date = new Date(day)
          const last = items[items.length - 1]
          const nodeStatus = STATUS_SEVERITY.find((s) => items.some((r) => statusOf(r) === s)) ?? 'abono'
          return (
            <Fragment key={day}>
              {markerBefore === day && marker}
              <li className="relative pl-9">
                <span
                  className="absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center border-2 bg-[#0a1f2f]"
                  style={{ borderColor: STATUS_META[nodeStatus].node }}
                >
                  <span className="text-[10px] font-mono font-bold text-white">{date.getDate()}</span>
                </span>

                <p className="text-[11px] text-[#8a929a] capitalize mb-1.5">{format(date, "EEEE d 'de' MMMM", { locale: es })}</p>

                <div className="space-y-1.5">
                  {items.map((r, i) => {
                    const status = statusOf(r)
                    const who = nameOf(r.debtor)
                    const kids = r.children ?? []
                    const isPayment = r.kind === 'abono'
                    const key = (r.debt?.id as string) ?? r.key ?? String(i)
                    // a payment shows its distribution by default; a debt shows its payments when asked
                    const unfolded = isPayment ? !open.has(key) : open.has(key)
                    const receiptState = isPayment ? (kids.every((k) => k.debt?.receiptStatus === 'confirmed') ? 'confirmed' : kids.some((k) => k.debt?.receiptStatus === 'pending') ? 'pending' : null) : null
                    const iReceive = receiptState === 'pending' && kids[0]?.debt?.creditor === myUid
                    const lastState = kids.length ? kids[kids.length - 1] : r
                    const left = r.debt ? remainingOf(r.debt) : 0
                    const content = (
                      <>
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Avatar name={who} photoURL={photoOf(r.debtor)} size={26} color={colorOf(r.debtor)} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-[#f0fae8] truncate">
                              {r.concept}
                              {r.debt?.loanId && <span className="ml-2 align-middle text-[9px] font-bold uppercase tracking-wider text-amber-300 border border-amber-400/40 rounded px-1 py-0.5">préstamo</span>}
                              {r.debt?.expenseId && <span className="ml-2 align-middle text-[9px] font-bold uppercase tracking-wider text-sky-300 border border-sky-400/40 rounded px-1 py-0.5">gasto compartido</span>}
                            </span>
                            <span className="block text-[10px] font-mono text-[#8a929a]">
                              {r.kind === 'deuda' && r.debt?.loanId && r.debt?.lender
                                ? `${nameOf(r.debt.lender)} prestó`
                                : `${who} ${isPayment ? 'pagó' : VERB[r.kind]}`}{r.kind === 'deuda' && r.debt ? (left > 0 ? ` · quedan ${formatCOP(left)}` : '') : ` · ${owesRow(lastState)}`}
                              {receiptState === 'confirmed' && ' · recibido ✓'}{receiptState === 'pending' && ` · por confirmar${iReceive ? '' : ` por ${nameOf(kids[0]?.debt?.creditor)}`}`}
                              {isPayment && (() => { const acc = kids[0]?.debt?.accountId as string | undefined; const n = acc ? accountName?.(acc) : null; return n ? ` · desde ${n}` : '' })()}
                              {r.kind === 'deuda' && r.debt?.dueDate && ` · se paga el ${format(r.date, 'd MMM', { locale: es })}`}
                            </span>
                          </span>
                        </span>
                        <span className="flex items-center justify-between gap-3 sm:justify-end sm:flex-shrink-0">
                          {/* fixed-width columns so amounts and states line up from row to row */}
                          <span className={clsx('sm:w-28 text-left sm:text-right text-sm font-mono tabular-nums', STATUS_META[status].amount)}>
                            {r.delta > 0 ? '+' : '−'}{formatCOP(Math.abs(r.delta))}
                          </span>
                          {iReceive && onConfirmReceipt && (
                            <button type="button" onClick={() => onConfirmReceipt(r)} className="whitespace-nowrap rounded-md border border-emerald-400/50 bg-emerald-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/25 transition">Confirmar recibido</button>
                          )}
                          <span className={clsx('sm:w-24 text-center whitespace-nowrap rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wider border', STATUS_META[status].chip)}>
                            {STATUS_META[status].label}
                          </span>
                        </span>
                      </>
                    )
                    return (
                      <div key={key} className={clsx('rounded-lg border bg-[#0d263a] transition-colors', STATUS_META[status].border)}>
                        <div className="flex items-stretch">
                          {r.debt ? (
                            <button onClick={() => onSelectDebt(r.debt)} className="flex-1 min-w-0 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 text-left px-3 py-2.5">{content}</button>
                          ) : (
                            <div className="flex-1 min-w-0 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 px-3 py-2.5">{content}</div>
                          )}
                          {kids.length > 0 && (
                            <button
                              onClick={() => toggle(key)}
                              aria-expanded={unfolded}
                              aria-label={unfolded ? 'Ocultar detalle de pagos' : 'Ver detalle de pagos'}
                              title={unfolded ? 'Ocultar detalle' : isPayment ? 'Ver cómo se distribuyó' : `${kids.length} ${kids.length === 1 ? 'movimiento' : 'movimientos'}`}
                              className="flex flex-col items-center justify-center gap-0.5 px-3 border-l border-white/10 text-[#9aa4ac] hover:text-white hover:bg-white/5 transition"
                            >
                              <ChevronDown size={14} className={clsx('transition-transform', unfolded && 'rotate-180')} />
                              <span className="text-[9px] font-mono">{kids.length}</span>
                            </button>
                          )}
                        </div>

                        {unfolded && kids.length > 0 && (
                          <ul className="border-t border-white/10 px-3 py-2 space-y-1.5">
                            {isPayment && <li className="text-[10px] uppercase tracking-wider text-[#8a929a]">Así se distribuyó el pago</li>}
                            {kids.map((k, j) => (
                              <li key={j} className="flex items-baseline justify-between gap-3 text-[11px]">
                                <span className="min-w-0">
                                  {isPayment ? (
                                    <>
                                      <span className="text-[#c7ccd1]">{(k.target?.concept as string) ?? (k.debt?.concept as string)}</span>
                                      {k.target && remainingOf(k.target) <= 0 && <span className="text-emerald-300 font-mono"> · queda pagada</span>}
                                      {k.target && remainingOf(k.target) > 0 && <span className="text-[#8a929a] font-mono"> · quedan {formatCOP(remainingOf(k.target))}</span>}
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-[#c7ccd1]">{k.kind === 'abono' ? 'Abono' : 'Cruce'}</span>
                                      <span className="text-[#8a929a] font-mono"> · {format(k.date, "d MMM yyyy", { locale: es })} · {nameOf(k.kind === 'abono' ? ((k.debt?.registeredBy as string) ?? k.debtor) : k.debtor)}</span>
                                      {k.kind === 'abono' && k.payTotal && k.payTotal > Math.abs(k.delta) && <span className="text-[#8a929a] font-mono"> · parte de un pago de {formatCOP(k.payTotal)}</span>}
                                    </>
                                  )}
                                  {(k.debt?.notas as string) ? <span className="block text-[10px] text-[#8a929a]">{k.debt?.notas as string}</span> : null}
                                </span>
                                <span className="font-mono tabular-nums text-brand-300 flex-shrink-0">−{formatCOP(Math.abs(k.delta))}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>

              </li>
            </Fragment>
          )
        })}

        {markerAtEnd && marker}
      </ol>
    </div>
  )
}
