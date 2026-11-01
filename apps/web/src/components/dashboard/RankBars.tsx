import { formatCOP } from '@/shared'
import { AppIcon } from '@/components/ui/AppIcon'

export interface RankItem {
  key: string
  label: string
  icon: string
  color: string
  value: number
}

/** Ranked horizontal bars (largest first): name and amount are written out, color only marks the bar. */
export function RankBars({ items, label }: { items: RankItem[]; label: string }) {
  const total = items.reduce((s, i) => s + i.value, 0)
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {items.map((i) => {
        const pct = total > 0 ? Math.round((i.value / total) * 100) : 0
        return (
          <li key={i.key} className="min-w-0" title={`${i.label}: ${formatCOP(i.value)} · ${pct}%`}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 min-w-0 text-[#c7ccd1]">
                <AppIcon name={i.icon} size={13} className="flex-shrink-0" />
                <span className="truncate">{i.label}</span>
              </span>
              <span className="flex-shrink-0 font-mono font-semibold text-[#f3f5f6]">
                {formatCOP(i.value)} <span className="font-normal text-[#8a929a]">· {pct}%</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-white/[0.06]" aria-hidden="true">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, (i.value / max) * 100)}%`, backgroundColor: i.color }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
