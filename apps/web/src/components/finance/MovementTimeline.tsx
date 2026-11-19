import { Fragment, type ReactNode } from 'react'
import { AttachmentButton } from '@/components/pending/AttachmentButton'
import { format, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowLeftRight, Banknote, CalendarCheck, Coins, GitMerge, Home, Receipt, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { formatCOP } from '@/shared'
import { AccountChip, type AccountLite } from '@/components/ui/AccountChip'
import { SERIES } from '@/components/dashboard/shared'

export type MovementZone = 'fixed' | 'additional' | 'household' | 'income' | 'transfer' | 'payment' | 'crossing'

export interface Movement {
  id: string
  zone: MovementZone
  date: Date
  concept: string
  sub: string
  /** Positive when money came into the account, negative when it left. */
  amount: number
  accountId?: string
  /** Screenshot of the movement (`attachments/{id}`), when it came from Telegram. */
  attachmentId?: string
  /** Something to do right on the row (e.g. confirm a payment received), shown before the kind chip. */
  action?: ReactNode
  /** With `onDelete` given, false hides this row's delete button. */
  canDelete?: boolean
}

export const MOVEMENT_ZONES: { id: MovementZone; label: string; color: string; icon: typeof Receipt }[] = [
  { id: 'fixed',      label: 'Fijos',       color: SERIES.fixed,      icon: CalendarCheck },
  { id: 'additional', label: 'Adicionales', color: SERIES.additional, icon: Receipt },
  { id: 'household',  label: 'Hogar',       color: '#38bdf8',         icon: Home },
  { id: 'income',     label: 'Ingresos',    color: '#a78bfa',         icon: Banknote },
  { id: 'transfer',   label: 'Traslados',   color: '#84cc16',         icon: ArrowLeftRight },
]

/** Kinds used by the household's payment history: not part of the account filters, so kept apart from MOVEMENT_ZONES. */
const EXTRA_ZONES: { id: MovementZone; label: string; color: string; icon: typeof Receipt }[] = [
  { id: 'payment',  label: 'Pago',  color: '#52b69a', icon: Coins },
  { id: 'crossing', label: 'Cruce', color: '#38bdf8', icon: GitMerge },
]
const zoneById = (id: MovementZone) => [...MOVEMENT_ZONES, ...EXTRA_ZONES].find((z) => z.id === id)!

interface Props {
  /** Newest first. */
  items: Movement[]
  accounts: AccountLite[]
  /** When given, each row gets a delete button (e.g. the Ingresos screen, where entries are the user's own to remove). */
  onDelete?: (m: Movement) => void
}

/**
 * The same vertical timeline as the Gastos Fijos history (spine, a node per day, one bordered row per item
 * with its chip on the right), here for movements and newest first. The border and chip take the color of
 * the zone each movement belongs to.
 */
export function MovementTimeline({ items, accounts, onDelete }: Props) {
  const today = startOfDay(new Date())

  const byDay = new Map<number, Movement[]>()
  for (const m of items) {
    const k = startOfDay(m.date).getTime()
    byDay.set(k, [...(byDay.get(k) ?? []), m])
  }
  const days = [...byDay.keys()].sort((a, b) => b - a)

  // The "today" marker goes before the first day that is not in the future
  const markerBefore = days.find((d) => d <= today.getTime()) ?? null
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

        {days.map((day) => {
          const group = byDay.get(day)!
          const date = new Date(day)
          const net = group.reduce((s, m) => s + m.amount, 0)
          // node colour: the zone of the day's biggest movement
          const lead = [...group].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0]
          const nodeColor = zoneById(lead.zone).color
          return (
            <Fragment key={day}>
              {markerBefore === day && marker}
              <li className="relative pl-9">
                <span className="absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center border-2 bg-[#0a1f2f]" style={{ borderColor: nodeColor }}>
                  <span className="text-[10px] font-mono font-bold text-white">{date.getDate()}</span>
                </span>

                <p className="text-[11px] text-[#8a929a] capitalize mb-1.5">{format(date, "EEEE d 'de' MMMM yyyy", { locale: es })}</p>

                <div className="space-y-1.5">
                  {group.map((m) => {
                    const zone = zoneById(m.zone)
                    const Icon = zone.icon
                    const acc = accounts.find((a) => a.id === m.accountId)
                    return (
                      <div
                        key={m.id}
                        className="w-full flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 text-left px-3 py-2.5 rounded-lg border bg-[#0d263a] transition-colors"
                        style={{ borderColor: zone.color + '66' }}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Icon size={16} className="flex-shrink-0" style={{ color: zone.color }} aria-hidden="true" />
                          <span className="min-w-0">
                            {/* on a phone the whole description is shown (it wraps); on a wide screen it is cut to keep rows even */}
                            <span className="block text-sm font-semibold text-[#f0fae8] break-words sm:truncate">{m.concept}</span>
                            <span className="block text-[10px] font-mono text-[#8a929a] sm:truncate">{m.sub}</span>
                            {acc ? <AccountChip account={acc} /> : m.zone === 'household' ? <span className="block text-[10px] font-mono text-[#5f6a72]">Sin cuenta asignada</span> : null}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:flex-nowrap sm:justify-end sm:flex-shrink-0">
                          <span className={clsx('whitespace-nowrap sm:w-28 text-left sm:text-right text-base sm:text-sm font-mono tabular-nums font-semibold', m.amount >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                            {m.amount >= 0 ? '+' : '−'}{formatCOP(Math.abs(m.amount))}
                          </span>
                          {/* fixed-width chip so the amounts and kinds line up from row to row; the attachment sits just left of it */}
                          <span className="flex items-center gap-2">
                            {m.action}
                            {m.attachmentId ? <AttachmentButton compact attachmentId={m.attachmentId} /> : <span className="hidden sm:block w-7 flex-shrink-0" aria-hidden="true" />}
                            <span
                              className="sm:w-[8.5rem] text-center whitespace-nowrap rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wider border"
                              style={{ backgroundColor: zone.color + '26', color: zone.color, borderColor: zone.color + '66' }}
                            >
                              {zone.label}
                            </span>
                            {onDelete && m.canDelete !== false && (
                              <button
                                type="button"
                                onClick={() => onDelete(m)}
                                className="p-1.5 rounded-lg text-[#5f6a72] hover:text-red-400 hover:bg-red-500/10 transition flex-shrink-0"
                                title="Eliminar"
                                aria-label={`Eliminar ${m.concept}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </div>

                {group.length > 1 && (
                  <p className="max-lg:hidden text-[10px] font-mono text-[#5f6a72] mt-1">
                    neto del día {net >= 0 ? '+' : '−'}{formatCOP(Math.abs(net))}
                  </p>
                )}
              </li>
            </Fragment>
          )
        })}

        {markerBefore === null && days.length > 0 && marker}
      </ol>
    </div>
  )
}
