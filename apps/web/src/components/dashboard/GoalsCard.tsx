import { PiggyBank } from 'lucide-react'
import { ProgressBar } from '@/components/ui/ProgressBar'
import type { DashboardData } from '@/hooks/useDashboardData'
import { formatCOP } from '@/shared'
import { DashCard, EmptyNote } from './shared'
import { AppIcon } from '@/components/ui/AppIcon'

/** Savings goals: progress of the first few and the grand total saved. */
export function GoalsCard({ goals }: Pick<DashboardData, 'goals'>) {
  const saved = goals.reduce((s, g) => s + (g.currentAmount ?? 0), 0)
  const target = goals.reduce((s, g) => s + (g.targetAmount ?? 0), 0)

  return (
    <DashCard title="Metas de ahorro" eyebrow="Ahorro" info="Avance de tus metas de ahorro: lo ahorrado frente a lo que quieres lograr." icon={PiggyBank} tone="#76c893" to="/finanzas" linkLabel="Ver metas">
      {goals.length === 0 ? (
        <EmptyNote icon={PiggyBank}>No tienes metas de ahorro registradas todavía.</EmptyNote>
      ) : (
        <>
          <p className="text-xs text-[#9aa4ac]">
            Llevas <span className="font-mono font-semibold text-[#f0fae8]">{formatCOP(saved)}</span> de <span className="font-mono">{formatCOP(target)}</span>
          </p>
          <ul className="space-y-3">
            {goals.slice(0, 4).map((g) => {
              const pct = g.targetAmount > 0 ? Math.min(Math.round((g.currentAmount / g.targetAmount) * 100), 100) : 0
              return (
                <li key={g.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="flex items-center gap-2 min-w-0 text-xs font-semibold text-[#f3f5f6]">
                      <AppIcon name={g.icon} size={14} className="text-brand-300 flex-shrink-0" />
                      <span className="truncate">{g.name}</span>
                    </span>
                    <span className="font-mono text-[11px] font-bold text-[#f3f5f6] flex-shrink-0">{pct}%</span>
                  </div>
                  <ProgressBar value={pct} color={g.color ?? '#52b69a'} size="sm" glow={false} />
                  <p className="flex justify-between gap-2 text-[11px] font-mono text-[#9aa4ac]">
                    <span className="text-[#f3f5f6] truncate">{formatCOP(g.currentAmount)}</span>
                    <span className="truncate">Meta {formatCOP(g.targetAmount)}</span>
                  </p>
                </li>
              )
            })}
          </ul>
          {goals.length > 4 && <p className="text-[11px] text-[#8a929a]">y {goals.length - 4} más</p>}
        </>
      )}
    </DashCard>
  )
}
