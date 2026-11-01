import { useMemo } from 'react'
import { CalendarCheck, CircleCheck, Clock, TriangleAlert, Zap, type LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'
import type { DashboardData } from '@/hooks/useDashboardData'
import { FIXED_EXPENSE_CATEGORIES, formatCOP } from '@/shared'
import { STATUS_META, type StatusKey } from '@/components/fixed/status'
import { DashCard, EmptyNote } from './shared'
import { RankBars, type RankItem } from './RankBars'

const STATE_ICON: Partial<Record<StatusKey, LucideIcon>> = { paid: CircleCheck, overdue: TriangleAlert, 'due-soon': Clock, pending: CalendarCheck }

/** Fixed expenses of the period: progress, states and where the money goes. */
export function FixedZone({ fixedStats: s, entries }: Pick<DashboardData, 'fixedStats' | 'entries'>) {
  const byCategory = useMemo<RankItem[]>(() => {
    const sums = new Map<string, number>()
    for (const e of entries) {
      const amount = e.owed.length === 0 ? (e.payment?.paidAmount ?? 0) : e.total
      const cat = (e.fe.category as string) || 'otro'
      sums.set(cat, (sums.get(cat) ?? 0) + amount)
    }
    return [...sums.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, value]) => {
        const c = FIXED_EXPENSE_CATEGORIES.find((x) => x.id === id) ?? FIXED_EXPENSE_CATEGORIES[FIXED_EXPENSE_CATEGORIES.length - 1]
        return { key: id, label: c.label, icon: c.icon, color: c.color, value }
      })
  }, [entries])

  const pctCount = s.count > 0 ? Math.round((s.paid / s.count) * 100) : 0
  const pctAmount = s.totalAmount > 0 ? Math.round((s.paidAmount / s.totalAmount) * 100) : 0

  // Counts by state; they add up to `count`, so the thin bar is a true split of the whole
  const states: { key: StatusKey; count: number }[] = [
    { key: 'paid', count: s.paid },
    { key: 'overdue', count: s.overdue },
    { key: 'due-soon', count: s.dueSoon },
    { key: 'pending', count: s.coming },
  ]

  return (
    <DashCard title="Gastos fijos" eyebrow="Zona 1" info="Estado de tus gastos fijos del mes: cuántos van pagados, cuáles están vencidos y en qué categorías se va el dinero." icon={CalendarCheck} tone="#3987e5" to="/fijos" linkLabel="Ver fijos">
      {s.count === 0 ? (
        <EmptyNote icon={CalendarCheck}>No tienes gastos fijos este período.</EmptyNote>
      ) : (
        <>
          <div>
            <div className="flex items-end justify-between gap-3">
              <p className="text-2xl font-bold font-mono text-[#f0fae8] tracking-tight">
                {s.paid}<span className="text-sm font-normal text-[#8a929a]"> / {s.count} pagados</span>
              </p>
              <p className="text-right text-xs font-mono text-[#c7ccd1] min-w-0 truncate">
                {formatCOP(s.paidAmount)} <span className="text-[#8a929a]">de {formatCOP(s.totalAmount)}</span>
              </p>
            </div>
            {/* Thin segmented bar, 8px, no text: the chips below carry the figures */}
            <div
              className="mt-2 flex gap-0.5 h-2 w-full"
              role="img"
              aria-label={`${pctCount}% de los fijos pagados (${pctAmount}% del monto). ${states.map((x) => `${STATUS_META[x.key].label}: ${x.count}`).join(', ')}`}
            >
              {states.filter((x) => x.count > 0).map((x) => (
                <div key={x.key} className="h-full rounded-full" style={{ width: `${(x.count / s.count) * 100}%`, backgroundColor: STATUS_META[x.key].dot }} />
              ))}
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {states.map((x) => {
                const Icon = STATE_ICON[x.key]
                return (
                  <li key={x.key} className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', STATUS_META[x.key].chip, x.count === 0 && 'opacity-50')}>
                    {Icon && <Icon size={11} aria-hidden="true" />}
                    {STATUS_META[x.key].label} <span className="font-mono">{x.count}</span>
                  </li>
                )
              })}
              {s.auto > 0 && (
                <li className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', STATUS_META.auto.chip)}>
                  <Zap size={11} aria-hidden="true" /> Automáticos <span className="font-mono">{s.auto}</span>
                </li>
              )}
            </ul>
          </div>

          {s.overdue > 0 && (
            <p className="flex items-start gap-2 notch-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <TriangleAlert size={14} className="flex-shrink-0 mt-px" aria-hidden="true" />
              <span>{s.overdue} {s.overdue === 1 ? 'pago vencido' : 'pagos vencidos'} por <span className="font-mono font-bold">{formatCOP(s.overdueAmount)}</span>. Aún debes {formatCOP(s.owedAmount)} en total.</span>
            </p>
          )}

          {byCategory.length > 0 && (
            <div>
              <p className="font-pixel text-[9px] uppercase text-[#8a929a] mb-2">Por categoría</p>
              <RankBars items={byCategory} label="Gastos fijos por categoría" />
            </div>
          )}
        </>
      )}
    </DashCard>
  )
}
