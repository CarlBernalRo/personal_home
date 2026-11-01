import { Fragment } from 'react'
import { format, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Avatar } from '@/components/ui/Avatar'
import { formatCOP } from '@/shared'
import { STATUS_META, STATUS_SEVERITY, statusOf, type LedgerRow, type Rec } from './ledger'

interface Props {
  rows: LedgerRow[]
  /** Balance (me - partner) right before the first row; null when nothing was inherited. */
  carryIn: number | null
  myName: string
  partnerName: string
  myPhoto: string | null
  partnerPhoto: string | null
  /** The month being viewed contains today, so the "Hoy" marker is drawn. */
  showToday: boolean
  onSelectDebt: (debt: Rec) => void
}

const VERB = { deuda: 'registró', abono: 'abonó', cruce: 'cruzó' } as const

/** Vertical timeline of the month, like Gastos Fijos: each day is a node, each movement a row bordered by its state. */
export function HouseholdTimeline({ rows, carryIn, myName, partnerName, myPhoto, partnerPhoto, showToday, onSelectDebt }: Props) {
  const today = startOfDay(new Date())

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

        {carryIn !== null && carryIn !== 0 && (
          <li className="relative pl-9">
            <span className="absolute left-0 top-1 w-6 h-6 rounded-full border-2 border-sky-400 bg-[#0a1f2f]" />
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3 px-3 py-2 rounded-lg border border-sky-400/40 bg-sky-500/10 text-sky-200">
              <span className="text-sm font-semibold">↪ Saldo arrastrado de meses anteriores</span>
              <span className="text-sm font-mono font-bold">{owes(carryIn)}</span>
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
                    const who = r.isMe ? myName : partnerName
                    const rowCls = clsx(
                      'w-full flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 text-left px-3 py-2.5 rounded-lg border bg-[#0d263a] transition-colors',
                      STATUS_META[status].border,
                    )
                    const content = (
                      <>
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Avatar
                            name={who}
                            photoURL={r.isMe ? myPhoto : partnerPhoto}
                            size={26}
                            color={r.isMe ? '#52b69a' : '#168aad'}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-[#f0fae8] truncate">{r.concept}</span>
                            <span className="block text-[10px] font-mono text-[#8a929a]">
                              {who} {VERB[r.kind]} · {owes(r.diffAfter)}
                            </span>
                          </span>
                        </span>
                        <span className="flex items-center justify-between gap-3 sm:justify-end sm:flex-shrink-0">
                          {/* fixed-width columns so amounts and states line up from row to row */}
                          <span className={clsx('sm:w-28 text-left sm:text-right text-sm font-mono tabular-nums', r.delta > 0 ? 'text-red-300' : 'text-brand-300')}>
                            {r.delta > 0 ? '+' : '−'}{formatCOP(Math.abs(r.delta))}
                          </span>
                          <span className={clsx('sm:w-24 text-center whitespace-nowrap rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wider border', STATUS_META[status].chip)}>
                            {STATUS_META[status].label}
                          </span>
                        </span>
                      </>
                    )
                    return r.debt ? (
                      <button key={i} onClick={() => onSelectDebt(r.debt)} className={rowCls}>{content}</button>
                    ) : (
                      <div key={i} className={rowCls}>{content}</div>
                    )
                  })}
                </div>

                <p className="max-lg:hidden text-[10px] font-mono text-[#5f6a72] mt-1">saldo al cierre del día: {owes(last.diffAfter)}</p>
              </li>
            </Fragment>
          )
        })}

        {markerAtEnd && marker}
      </ol>
    </div>
  )
}
