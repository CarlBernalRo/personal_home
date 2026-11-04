import { Fragment } from 'react'
import { AttachmentButton } from '@/components/pending/AttachmentButton'
import { format, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Home, Pencil, Trash2 } from 'lucide-react'
import { PERSONAL_CATEGORIES, formatCOP } from '@/shared'
import { AppIcon } from '@/components/ui/AppIcon'
import { AccountChip, type AccountLite } from '@/components/ui/AccountChip'

export interface ExpenseRow {
  id: string
  description: string
  amount: number
  category: string
  date: Date
  /** Lowers the money on hand and the period's leftover. Older records are history only. */
  counted: boolean
  /** Paid from a household (an abono): shown for completeness, managed in Hogar. */
  household: boolean
  /** Registered against an occasional expense (gasoline, card…). */
  budget: boolean
  /** Account the money came out of. */
  accountId?: string
  /** Screenshot of the spend, when it came from Telegram. */
  attachmentId?: string
}

interface Props {
  rows: ExpenseRow[]
  /** The period being viewed contains today, so the "Hoy" marker is drawn. */
  showToday: boolean
  /** Without them the rows are read-only (the home shows the history without managing it). */
  onDelete?: (row: ExpenseRow) => void
  onEdit?: (row: ExpenseRow) => void
  /** The user's accounts: names for the account tag on each spend. */
  accounts?: AccountLite[]
}

type Kind = 'additional' | 'budget' | 'household' | 'history'

const KIND: Record<Kind, { label: string; chip: string; border: string; node: string }> = {
  additional: { label: 'Adicional',            chip: 'bg-orange-500/20 text-orange-300 border-orange-500/45', border: 'border-orange-500/45 hover:border-orange-400/80', node: '#f97316' },
  budget:     { label: 'Ocasional',            chip: 'bg-amber-500/20 text-amber-300 border-amber-500/40',   border: 'border-amber-500/40 hover:border-amber-400/80',   node: '#f59e0b' },
  household:  { label: 'Hogar',                chip: 'bg-sky-500/15 text-sky-300 border-sky-500/30',         border: 'border-sky-500/30 hover:border-sky-400/80',       node: '#38bdf8' },
  history:    { label: 'Anterior · no cuenta', chip: 'bg-white/5 text-[#9aa4ac] border-white/10',            border: 'border-white/10 hover:border-white/40',           node: '#6b7280' },
}

const kindOf = (r: ExpenseRow): Kind => (!r.counted ? 'history' : r.household ? 'household' : r.budget ? 'budget' : 'additional')

/** Vertical timeline of the period, like the one in Gastos Fijos: each day is a node with its spends under it. */
export function ExpenseTimeline({ rows, showToday, onDelete, onEdit, accounts = [] }: Props) {
  const today = startOfDay(new Date())

  const byDay = new Map<number, ExpenseRow[]>()
  for (const r of rows) {
    const k = startOfDay(r.date).getTime()
    byDay.set(k, [...(byDay.get(k) ?? []), r])
  }
  const days = [...byDay.keys()].sort((a, b) => a - b)

  const total = rows.filter((r) => r.counted).reduce((s, r) => s + r.amount, 0)
  let running = 0

  // The "today" marker goes before the first day that is still ahead of us
  const markerBefore = showToday ? (days.find((d) => d >= today.getTime()) ?? null) : null
  const markerAtEnd = showToday && days.length > 0 && markerBefore === null

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
          const items = byDay.get(day)!
          const date = new Date(day)
          const kinds = items.map(kindOf)
          // node colour: the day's most relevant kind
          const nodeKind = (['additional', 'budget', 'household', 'history'] as const).find((k) => kinds.includes(k)) ?? 'history'
          return (
            <Fragment key={day}>
              {markerBefore === day && marker}
              <li className="relative pl-9">
                <span
                  className="absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center border-2 bg-[#0a1f2f]"
                  style={{ borderColor: KIND[nodeKind].node }}
                >
                  <span className="text-[10px] font-mono font-bold text-white">{date.getDate()}</span>
                </span>

                <p className="text-[11px] text-[#8a929a] capitalize mb-1.5">{format(date, "EEEE d 'de' MMMM", { locale: es })}</p>

                <div className="space-y-1.5">
                  {items.map((r) => {
                    const kind = kindOf(r)
                    const cat = PERSONAL_CATEGORIES.find((c) => c.id === r.category)
                    if (r.counted) running += r.amount
                    return (
                      <div
                        key={r.id}
                        className={clsx(
                          'w-full flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 px-3 py-2.5 rounded-lg border bg-[#0d263a] transition-colors',
                          KIND[kind].border,
                          !r.counted && 'opacity-60',
                        )}
                      >
                        <span className="flex items-start sm:items-center gap-2.5 min-w-0">
                          <span className="flex-shrink-0 mt-0.5 sm:mt-0">{r.household ? <Home size={16} className="text-sky-300" /> : <AppIcon name={cat?.icon} size={16} className="text-brand-300" />}</span>
                          <span className="min-w-0">
                            {/* on a phone the whole name is shown (it wraps); on a wide screen it is cut to keep the rows even */}
                            <span className="block text-sm font-semibold text-[#f0fae8] break-words sm:truncate">{r.description}</span>
                            <span className="block text-[10px] font-mono text-[#8a929a]">{r.household ? 'Abono en el hogar' : (cat?.label ?? r.category)}</span>
                            <AccountChip account={accounts.find((a) => a.id === r.accountId)} />
                          </span>
                        </span>
                        {/* phone: amount and type on one line, the actions at the end; wide screen: fixed columns so rows line up */}
                        <span className="flex items-center justify-between gap-3 sm:justify-end sm:flex-shrink-0 border-t border-white/[0.06] pt-2 sm:border-0 sm:pt-0">
                          <span className="text-base sm:text-sm font-mono tabular-nums font-semibold sm:w-28 sm:text-right text-rose-300">−{formatCOP(r.amount)}</span>
                          <span className="flex items-center gap-2">
                            {r.attachmentId ? <AttachmentButton compact attachmentId={r.attachmentId} /> : <span className="hidden sm:block w-7 flex-shrink-0" aria-hidden="true" />}
                            <span className={clsx('sm:w-[11.5rem] text-center whitespace-nowrap rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wider border', KIND[kind].chip)}>
                              {KIND[kind].label}
                            </span>
                          </span>
                          {r.household || !onDelete || !onEdit ? (
                            <span className="hidden sm:block w-[3.5rem]" />
                          ) : (
                            <span className="flex items-center">
                              <button
                                onClick={() => onEdit(r)}
                                className="p-1.5 rounded-lg text-[#8a929a] hover:text-white hover:bg-white/10 transition"
                                title="Editar gasto adicional"
                                aria-label={`Editar ${r.description}`}
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                onClick={() => onDelete(r)}
                                className="p-1.5 rounded-lg text-[#8a929a] hover:text-red-400 hover:bg-red-500/15 transition"
                                title="Eliminar gasto adicional"
                                aria-label={`Eliminar ${r.description}`}
                              >
                                <Trash2 size={15} />
                              </button>
                            </span>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>

                <p className="max-lg:hidden text-[10px] font-mono text-[#5f6a72] mt-1">
                  acumulado {formatCOP(running)} de {formatCOP(total)}
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
