import { useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts'
import { BarChart3 } from 'lucide-react'
import type { DashboardData } from '@/hooks/useDashboardData'
import { formatCOP, type PeriodSummary } from '@/shared'
import { CHART, compactCOP, DashCard, EmptyNote, Legend, SERIES, SURFACE, TooltipBox } from './shared'

const DAY_MS = 86_400_000
const INCOME = '#f3f5f6'

interface Row extends PeriodSummary {
  label: string
  range: string
}

const fmtDay = (d: Date) => format(d, 'd MMM', { locale: es })

function TrendTip({ active, payload }: TooltipProps<number, string>) {
  const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined
  if (!row) return null
  return (
    <TooltipBox
      title={`${row.range}${row.current ? ' · actual' : ''}`}
      rows={[
        { color: INCOME, name: 'Ingresos', value: formatCOP(row.income), strong: true },
        { color: SERIES.fixed, name: 'Fijos', value: formatCOP(row.fixed) },
        { color: SERIES.additional, name: 'Adicionales', value: formatCOP(row.additional) },
        { color: SERIES.occasional, name: 'Ocasionales', value: formatCOP(row.occasional) },
      ]}
      footer={<span>{row.left >= 0 ? 'Te sobró' : 'Te faltó'} <span className="font-mono font-semibold text-[#f3f5f6]">{formatCOP(Math.abs(row.left))}</span></span>}
    />
  )
}

/** Last periods as stacked spending against the income of each one, on a single money axis. */
export function TrendChart({ history }: Pick<DashboardData, 'history'>) {
  const data = useMemo<Row[]>(
    () => history.map((p) => {
      const last = new Date(p.end.getTime() - DAY_MS)
      return { ...p, label: format(last, 'MMM', { locale: es }), range: `${fmtDay(p.start)} – ${fmtDay(last)}` }
    }),
    [history],
  )
  const hasData = data.some((p) => p.income > 0 || p.fixed > 0 || p.additional > 0 || p.occasional > 0)

  return (
    <DashCard title="Últimos períodos" eyebrow="Tendencia" info="Comparación de tus últimos períodos de sueldo: cuánto gastaste en fijos, adicionales y ocasionales frente a lo que ingresó." icon={BarChart3} tone={SERIES.fixed}>
      {!hasData ? (
        <EmptyNote icon={BarChart3} height={220}>Aún no hay períodos con movimientos para comparar.</EmptyNote>
      ) : (
        <>
          <Legend items={[
            { label: 'Fijos', color: SERIES.fixed },
            { label: 'Adicionales', color: SERIES.additional },
            { label: 'Ocasionales', color: SERIES.occasional },
            { label: 'Ingresos', color: INCOME, kind: 'line' },
          ]} />
          <div
            className="h-[240px] w-full min-w-0"
            role="img"
            aria-label={`Gasto por período frente al ingreso. ${data.map((p) => `${p.label}: ingresos ${formatCOP(p.income)}, gastos ${formatCOP(p.fixed + p.additional + p.occasional)}`).join('; ')}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="label" tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.axis }} />
                <YAxis tick={CHART.tick} tickLine={false} axisLine={false} width={52} tickFormatter={compactCOP} />
                <Tooltip content={<TrendTip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} wrapperStyle={{ zIndex: 30, outline: 'none' }} />
                {/* 2px surface strokes act as the gap between touching stack segments */}
                <Bar dataKey="fixed" name="Fijos" stackId="s" fill={SERIES.fixed} stroke={SURFACE} strokeWidth={2} maxBarSize={24} />
                <Bar dataKey="additional" name="Adicionales" stackId="s" fill={SERIES.additional} stroke={SURFACE} strokeWidth={2} maxBarSize={24} />
                <Bar dataKey="occasional" name="Ocasionales" stackId="s" fill={SERIES.occasional} stroke={SURFACE} strokeWidth={2} maxBarSize={24} radius={[4, 4, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="income"
                  name="Ingresos"
                  stroke={INCOME}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={{ r: 4, fill: INCOME, stroke: SURFACE, strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: INCOME, stroke: SURFACE, strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>Detalle por período</caption>
            <thead><tr><th>Período</th><th>Ingresos</th><th>Fijos</th><th>Adicionales</th><th>Ocasionales</th><th>Resultado</th></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}><td>{p.range}</td><td>{formatCOP(p.income)}</td><td>{formatCOP(p.fixed)}</td><td>{formatCOP(p.additional)}</td><td>{formatCOP(p.occasional)}</td><td>{formatCOP(p.left)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </DashCard>
  )
}
