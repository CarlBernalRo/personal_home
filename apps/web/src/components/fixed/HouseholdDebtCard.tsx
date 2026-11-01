import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatCOP } from '@/shared'
import { CalendarClock } from 'lucide-react'

export interface HouseholdDebtCardRow {
  key: string
  householdId: string
  household: string
  /** Name of the debt. */
  debt: string
  /** Why it is here: its agreed date, or that it has none. */
  detail: string
  amount: number
}

interface Props {
  title: string
  /** Small text next to the title, e.g. "día 1". */
  subtitle?: string
  rows: HouseholdDebtCardRow[]
  /** Extra line under the cards. */
  meta?: ReactNode
  note?: string
}

/**
 * How a household-debt expense is drawn everywhere (the day it falls on, and the current period's
 * summary): the total of the expense, and under it one card per household with its own debts and
 * a button that opens that household.
 */
export function HouseholdDebtCard({ title, subtitle, rows, meta, note }: Props) {
  const total = rows.reduce((sum, r) => sum + r.amount, 0)

  const groups: { householdId: string; household: string; rows: HouseholdDebtCardRow[] }[] = []
  for (const r of rows) {
    const group = groups.find((g) => g.householdId === r.householdId)
    if (group) group.rows.push(r)
    else groups.push({ householdId: r.householdId, household: r.household, rows: [r] })
  }
  groups.sort((a, b) => a.household.localeCompare(b.household))

  return (
    <div className="rounded-lg border border-dashed border-amber-400/40 px-3 py-2.5 text-amber-200 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold truncate">
          <CalendarClock size={13} className="inline -mt-0.5 mr-1" aria-hidden="true" />{title}
          {subtitle && <span className="text-[10px] font-normal text-amber-100/60"> · {subtitle}</span>}
        </span>
        <span className="text-sm font-mono font-bold flex-shrink-0">{formatCOP(total)}</span>
      </div>

      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.householdId} className="rounded-lg border border-amber-400/25 bg-amber-500/[0.06] px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-amber-100 truncate">{g.household}</span>
              <span className="flex items-center gap-2.5 flex-shrink-0">
                <span className="text-xs font-mono font-bold">{formatCOP(g.rows.reduce((sum, r) => sum + r.amount, 0))}</span>
                <Link
                  to={`/hogar?id=${g.householdId}`}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-brand-600 hover:bg-brand-500 text-white border border-brand-400/40 transition"
                >
                  Ir al hogar
                </Link>
              </span>
            </div>
            {g.rows.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-3 text-[11px] text-amber-100/80">
                <span className="truncate">
                  {r.debt}
                  <span className="opacity-70"> · {r.detail}</span>
                </span>
                <span className="font-mono flex-shrink-0">{formatCOP(r.amount)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {meta && <div className="text-[10px] font-mono text-amber-100/70">{meta}</div>}
      {note && <p className="text-[10px] text-amber-100/50">{note}</p>}
    </div>
  )
}
