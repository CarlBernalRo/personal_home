import { useMemo } from 'react'
import { differenceInCalendarDays, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts'
import { ShoppingBag } from 'lucide-react'
import type { DashboardData } from '@/hooks/useDashboardData'
import { formatCOP, PERSONAL_CATEGORIES } from '@/shared'
import { CHART, compactCOP, DashCard, EmptyNote, SERIES, SURFACE, TooltipBox } from './shared'
import { RankBars, type RankItem } from './RankBars'

const OTHER = PERSONAL_CATEGORIES[PERSONAL_CATEGORIES.length - 1]
const catOf = (id: string) => PERSONAL_CATEGORIES.find((c) => c.id === id) ?? OTHER

interface CurvePoint {
  label: string
  date: Date
  total: number
  day: number
}

function CurveTip({ active, payload }: TooltipProps<number, string>) {
  const p = active ? (payload?.[0]?.payload as CurvePoint | undefined) : undefined
  if (!p) return null
  return (
    <TooltipBox
      title={format(p.date, "EEEE d 'de' MMM", { locale: es })}
      rows={[
        { color: SERIES.additional, name: 'Acumulado', value: formatCOP(p.total), strong: true },
        { name: 'Ese día', value: formatCOP(p.day) },
      ]}
    />
  )
}

/** Mis gastos adicionales: total, split by category, running total by day and the latest movements. */
export function ExpensesZone({ additional, categories, spendCurve, bounds }: Pick<DashboardData, 'additional' | 'categories' | 'spendCurve' | 'bounds'>) {
  const total = useMemo(() => additional.reduce((s, e) => s + e.amount, 0), [additional])

  const rank = useMemo<RankItem[]>(
    () => categories.slice(0, 6).map((c) => {
      const cat = catOf(c.category)
      return { key: c.category, label: cat.label, icon: cat.icon, color: cat.color, value: c.total }
    }),
    [categories],
  )

  const curve = useMemo<CurvePoint[]>(
    () => spendCurve.map((p, i) => ({ label: format(p.date, 'd MMM', { locale: es }), date: p.date, total: p.total, day: p.total - (i > 0 ? spendCurve[i - 1].total : 0) })),
    [spendCurve],
  )

  const elapsed = Math.max(1, differenceInCalendarDays(new Date(), bounds.start) + 1)
  const biggest = additional.reduce<(typeof additional)[number] | null>((m, e) => (!m || e.amount > m.amount ? e : m), null)

  return (
    <DashCard title="Mis gastos adicionales" eyebrow="Zona 2" info="Resumen de lo que has gastado en este período fuera de tus gastos fijos: total, categorías, acumulado diario y últimos movimientos." icon={ShoppingBag} tone={SERIES.additional} to="/gastos" linkLabel="Ver gastos">
      {additional.length === 0 ? (
        <EmptyNote icon={ShoppingBag}>Aún no registras gastos adicionales en este período.</EmptyNote>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Gastado</p>
              <p className="text-lg font-bold font-mono text-[#f0fae8] truncate" title={formatCOP(total)}>{formatCOP(total)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Por día</p>
              <p className="text-lg font-bold font-mono text-[#f0fae8] truncate" title={formatCOP(total / elapsed)}>{formatCOP(Math.round(total / elapsed))}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Movimientos</p>
              <p className="text-lg font-bold font-mono text-[#f0fae8]">{additional.length}</p>
            </div>
          </div>

          <div>
            <p className="font-pixel text-[9px] uppercase text-[#8a929a] mb-2">Por categoría</p>
            <RankBars items={rank} label="Gastos adicionales por categoría" />
          </div>

          {curve.length >= 2 && (
            <div>
              <p className="font-pixel text-[9px] uppercase text-[#8a929a] mb-1">Acumulado del período</p>
              <div
                className="h-[150px] w-full min-w-0"
                role="img"
                aria-label={`Gasto acumulado día a día: ${formatCOP(total)} al día de hoy${biggest ? `; el mayor fue ${biggest.description} por ${formatCOP(biggest.amount)}` : ''}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="label" tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.axis }} minTickGap={32} />
                    <YAxis tick={CHART.tick} tickLine={false} axisLine={false} width={48} tickFormatter={compactCOP} />
                    <Tooltip content={<CurveTip />} cursor={{ stroke: CHART.axis, strokeWidth: 1 }} wrapperStyle={{ zIndex: 30, outline: 'none' }} />
                    <Area
                      type="monotone"
                      dataKey="total"
                      stroke={SERIES.additional}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill={SERIES.additional}
                      fillOpacity={0.1}
                      dot={false}
                      activeDot={{ r: 5, fill: SERIES.additional, stroke: SURFACE, strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </DashCard>
  )
}
