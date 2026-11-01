import { useMemo } from 'react'
import { format, isSameDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts'
import { LineChart as LineIcon, TriangleAlert } from 'lucide-react'
import type { DashboardData } from '@/hooks/useDashboardData'
import { formatCOP, type Outflow } from '@/shared'
import { CHART, compactCOP, DashCard, EmptyNote, SERIES, SURFACE, TooltipBox } from './shared'

const RED = '#e66767'
const dayLabel = (d: Date) => format(d, 'd MMM', { locale: es })

interface Point {
  label: string
  date: Date
  balance: number
  outflows: Outflow[]
}

function BalanceTip({ active, payload }: TooltipProps<number, string>) {
  const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined
  if (!p) return null
  return (
    <TooltipBox
      title={format(p.date, "EEEE d 'de' MMM", { locale: es })}
      rows={[
        { color: SERIES.fixed, name: 'Saldo proyectado', value: formatCOP(p.balance), strong: true },
        ...p.outflows.map((o) => ({ name: `${o.concept}${o.auto ? ' (automático)' : ''}`, value: `−${formatCOP(o.amount)}` })),
      ]}
    />
  )
}

/** Balance day by day until the next salary, with the biggest payments marked. */
export function BalanceChart({ balanceCurve, outlook }: Pick<DashboardData, 'balanceCurve' | 'outlook'>) {
  const model = useMemo(() => {
    if (!outlook || balanceCurve.length < 2) return null
    const outflows = outlook.projection.outflows
    const data: Point[] = balanceCurve.map((b) => ({
      label: dayLabel(b.date),
      date: b.date,
      balance: b.balance,
      outflows: outflows.filter((o) => isSameDay(o.date, b.date)),
    }))
    // The three biggest days (sum of that day's payments) get a marker
    const marked = [...data]
      .map((p) => ({ p, sum: p.outflows.reduce((s, o) => s + o.amount, 0) }))
      .filter((x) => x.sum > 0)
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 3)
      .map((x) => x.p)
    const min = Math.min(...data.map((d) => d.balance))
    const short = outlook.projection.shortfallOn
    const breakPoint = short ? data.find((d) => isSameDay(d.date, short)) ?? null : null
    return { data, marked, below: min < 0, breakPoint, short }
  }, [balanceCurve, outlook])

  return (
    <DashCard title="Saldo hasta tu próximo sueldo" eyebrow="Proyección" info="Cómo irá bajando tu dinero día a día hasta el próximo sueldo, restando los pagos fijos pendientes. No incluye lo reservado para ocasionales." icon={LineIcon} tone={SERIES.fixed}>
      {!model ? (
        <EmptyNote icon={LineIcon} height={220}>
          {outlook ? 'El próximo sueldo es muy pronto: no hay días que proyectar.' : 'Confirma tu sueldo para ver cómo evoluciona tu saldo.'}
        </EmptyNote>
      ) : (
        <>
          <p className="text-[11px] text-[#8a929a]">Solo pagos fijos pendientes (sin reservas). Los puntos marcan los días con mayores pagos.</p>
          {model.short && (
            <p className="flex items-start gap-1.5 text-xs font-semibold text-red-300">
              <TriangleAlert size={14} className="flex-shrink-0 mt-px" aria-hidden="true" />
              Te quedarías sin fondos el {format(model.short, "d 'de' MMMM", { locale: es })}.
            </p>
          )}
          <div
            className="h-[220px] w-full min-w-0"
            role="img"
            aria-label={`Saldo proyectado día a día: empieza en ${formatCOP(model.data[0].balance)} y termina en ${formatCOP(model.data[model.data.length - 1].balance)}${model.short ? `; se queda sin fondos el ${dayLabel(model.short)}` : ''}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={model.data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="label" tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.axis }} minTickGap={28} />
                <YAxis tick={CHART.tick} tickLine={false} axisLine={false} width={52} tickFormatter={compactCOP} domain={[(min: number) => Math.min(0, min), 'auto']} />
                <Tooltip content={<BalanceTip />} cursor={{ stroke: CHART.axis, strokeWidth: 1 }} wrapperStyle={{ zIndex: 30, outline: 'none' }} />
                {model.below && <ReferenceLine y={0} stroke={RED} strokeWidth={1} />}
                {model.breakPoint && <ReferenceLine x={model.breakPoint.label} stroke={RED} strokeWidth={1} />}
                <Area
                  type="stepAfter"
                  dataKey="balance"
                  baseValue={0}
                  stroke={SERIES.fixed}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill={SERIES.fixed}
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={{ r: 5, fill: SERIES.fixed, stroke: SURFACE, strokeWidth: 2 }}
                />
                {model.marked.map((p) => (
                  <ReferenceDot key={p.label} x={p.label} y={p.balance} r={4} fill="#f3f5f6" stroke={SURFACE} strokeWidth={2} ifOverflow="visible" />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </DashCard>
  )
}
