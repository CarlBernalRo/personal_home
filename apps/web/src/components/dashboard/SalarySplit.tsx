import { useMemo, useState } from 'react'
import { Wallet, TriangleAlert } from 'lucide-react'
import { clsx } from 'clsx'
import type { DashboardData } from '@/hooks/useDashboardData'
import { useMoneyMask } from '@/hooks/useMoneyMask'
import { DashCard, EmptyNote, SERIES } from './shared'

interface Part {
  key: string
  label: string
  value: number
  color: string
}

/** Share label inside a block only when the block is wide enough to hold it. */
const MIN_PCT_FOR_LABEL = 9

/** Where the period's money went: one tall segmented bar over income plus carry-over. */
export function SalarySplit({ ledger, income }: Pick<DashboardData, 'ledger' | 'income'>) {
  const formatCOP = useMoneyMask()
  const [active, setActive] = useState<string | null>(null)

  const model = useMemo(() => {
    if (!ledger) return null
    const parts: Part[] = [
      { key: 'fixed', label: 'Gastos fijos', value: ledger.committed, color: SERIES.fixed },
      { key: 'additional', label: 'Adicionales', value: ledger.additionalSpent, color: SERIES.additional },
      { key: 'occasional', label: 'Ocasionales', value: ledger.variableSpent, color: SERIES.occasional },
      { key: 'reserved', label: 'Reservado', value: ledger.variableReserved, color: SERIES.reserved },
      { key: 'left', label: 'Te queda', value: Math.max(0, ledger.remaining), color: SERIES.left },
    ]
    const used = parts.reduce((s, p) => s + p.value, 0)
    const available = income + ledger.carryIn
    // When spending exceeds what came in, the bar is the spending itself and the overrun is flagged
    const whole = Math.max(used, available)
    return { parts, whole, overrun: ledger.remaining < 0 ? -ledger.remaining : 0, available }
  }, [ledger, income])

  if (!model || model.whole <= 0) {
    return (
      <DashCard title="¿A dónde se fue el sueldo?" eyebrow="Período actual" info="Cómo se reparte tu sueldo del período: fijos, gastos adicionales, ocasionales, lo reservado y lo que te queda." icon={Wallet} tone={SERIES.left}>
        <EmptyNote icon={Wallet}>Confirma tu sueldo para ver cómo se reparte el período.</EmptyNote>
      </DashCard>
    )
  }

  const { parts, whole, overrun, available } = model
  const shown = parts.filter((p) => p.value > 0)
  const pct = (v: number) => (v / whole) * 100
  const summary = shown.map((p) => `${p.label} ${formatCOP(p.value)} (${Math.round(pct(p.value))}%)`).join(', ')

  return (
    <DashCard title="¿A dónde se fue el sueldo?" eyebrow="Período actual" info="Cómo se reparte tu sueldo del período: fijos, gastos adicionales, ocasionales, lo reservado y lo que te queda." icon={Wallet} tone={SERIES.left}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xs text-[#9aa4ac]">
          Sobre <span className="font-mono font-semibold text-[#f0fae8]">{formatCOP(available)}</span>
          {ledger && ledger.carryIn !== 0 && <span className="text-[#8a929a]"> (ingresos {ledger.carryIn > 0 ? '+' : '−'} arrastre {formatCOP(Math.abs(ledger.carryIn))})</span>}
        </p>
        {overrun > 0 && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-red-300">
            <TriangleAlert size={13} aria-hidden="true" /> Te pasaste por {formatCOP(overrun)}
          </p>
        )}
      </div>

      {/* Tall bar: 28px, 2px gaps, 4px corners */}
      <div role="img" aria-label={`Reparto del período: ${summary}`} className="flex gap-0.5 h-7 w-full" onMouseLeave={() => setActive(null)}>
        {shown.map((p) => {
          const share = pct(p.value)
          return (
            <div
              key={p.key}
              tabIndex={0}
              title={`${p.label}: ${formatCOP(p.value)} · ${Math.round(share)}%`}
              onMouseEnter={() => setActive(p.key)}
              onFocus={() => setActive(p.key)}
              onBlur={() => setActive(null)}
              className={clsx(
                'h-full rounded-[4px] flex items-center px-2 min-w-[3px] transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-white/70',
                active && active !== p.key && 'opacity-45',
              )}
              style={{ width: `${share}%`, backgroundColor: p.color }}
            >
              {share >= MIN_PCT_FOR_LABEL && <span className="text-[11px] font-bold text-white font-mono whitespace-nowrap">{Math.round(share)}%</span>}
            </div>
          )
        })}
      </div>

      {/* Table twin: names, amounts and shares */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-x-4 gap-y-2">
        {parts.map((p) => (
          <li
            key={p.key}
            onMouseEnter={() => p.value > 0 && setActive(p.key)}
            onMouseLeave={() => setActive(null)}
            className={clsx('flex items-center gap-2 min-w-0 transition-opacity', active && active !== p.key && 'opacity-50')}
          >
            <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ backgroundColor: p.color }} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[11px] text-[#9aa4ac] truncate">{p.label}</p>
              <p className="text-xs font-mono font-semibold text-[#f3f5f6] truncate">
                {formatCOP(p.value)} <span className="text-[#8a929a] font-normal">· {Math.round(pct(p.value))}%</span>
              </p>
            </div>
          </li>
        ))}
      </ul>
      {parts[3].value > 0 && (
        <p className="text-[11px] text-[#8a929a]">
          “Reservado” es lo que aún no gastas de tus presupuestos ocasionales; sigue disponible hasta que cierre el período.
        </p>
      )}
    </DashCard>
  )
}
