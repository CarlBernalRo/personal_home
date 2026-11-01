import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts'
import { ArrowDownLeft, ArrowUpRight, CircleCheck, Home } from 'lucide-react'
import type { DashboardData } from '@/hooks/useDashboardData'
import { formatCOP } from '@/shared'
import { CHART, compactCOP, DashCard, EmptyNote, Legend, POLE, SURFACE, TooltipBox } from './shared'

interface Row {
  id: string
  name: string
  /** Positive: they owe you; negative: you owe. */
  value: number
}

function HouseTip({ active, payload }: TooltipProps<number, string>) {
  const r = active ? (payload?.[0]?.payload as Row | undefined) : undefined
  if (!r) return null
  return (
    <TooltipBox
      title={r.name}
      rows={[{
        color: r.value >= 0 ? POLE.owedToMe : POLE.owed,
        name: r.value === 0 ? 'Cuentas al día' : r.value > 0 ? 'Te deben' : 'Debes',
        value: formatCOP(Math.abs(r.value)),
        strong: true,
      }]}
    />
  )
}

/** Hogar: what you owe, what you are owed and the balance of each household (diverging around zero). */
export function HouseholdZone({ households, householdTotals }: Pick<DashboardData, 'households' | 'householdTotals'>) {
  const rows = useMemo<Row[]>(
    () => households.map((h) => ({ id: h.id, name: h.name, value: -h.net })).sort((a, b) => a.value - b.value),
    [households],
  )
  const { owed, owedToMe } = householdTotals
  const settled = rows.length > 0 && rows.every((r) => r.value === 0)
  // ~44px per household plus the axis band
  const height = Math.min(rows.length, 6) * 44 + 34

  return (
    <DashCard title="Hogar" eyebrow="Zona 3" info="Lo que debes y lo que te deben en tus hogares, y el saldo de cada uno." icon={Home} tone={POLE.owedToMe} to="/hogar" linkLabel="Ver hogar">
      {rows.length === 0 ? (
        <EmptyNote icon={Home}>
          Aún no estás en ningún hogar.{' '}
          <Link to="/hogar" className="text-brand-400 hover:text-brand-300 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400">Crear o unirme</Link>
        </EmptyNote>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="notch-sm border border-red-500/25 bg-red-500/[0.07] p-3 min-w-0">
              <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#c7ccd1]"><ArrowUpRight size={12} aria-hidden="true" /> Debes</p>
              <p className="mt-1 text-base font-bold font-mono text-[#f0fae8] truncate" title={formatCOP(owed)}>{formatCOP(owed)}</p>
            </div>
            <div className="notch-sm border border-sky-500/25 bg-sky-500/[0.07] p-3 min-w-0">
              <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#c7ccd1]"><ArrowDownLeft size={12} aria-hidden="true" /> Te deben</p>
              <p className="mt-1 text-base font-bold font-mono text-[#f0fae8] truncate" title={formatCOP(owedToMe)}>{formatCOP(owedToMe)}</p>
            </div>
          </div>

          {settled ? (
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <CircleCheck size={15} aria-hidden="true" /> Cuentas al día en {rows.length === 1 ? 'tu hogar' : 'todos tus hogares'}.
            </p>
          ) : (
            <>
              <Legend items={[{ label: 'Debes', color: POLE.owed }, { label: 'Te deben', color: POLE.owedToMe }]} />
              <div
                className="w-full min-w-0"
                style={{ height }}
                role="img"
                aria-label={`Balance por hogar: ${rows.map((r) => `${r.name} ${r.value === 0 ? 'al día' : r.value > 0 ? `te deben ${formatCOP(r.value)}` : `debes ${formatCOP(-r.value)}`}`).join('; ')}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }} barCategoryGap="30%">
                    <CartesianGrid horizontal={false} stroke={CHART.grid} />
                    <XAxis type="number" tick={CHART.tick} tickLine={false} axisLine={false} tickFormatter={(v: number) => compactCOP(Math.abs(v))} />
                    <YAxis type="category" dataKey="name" tick={CHART.tick} tickLine={false} axisLine={false} width={84} />
                    <Tooltip content={<HouseTip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} wrapperStyle={{ zIndex: 30, outline: 'none' }} />
                    <ReferenceLine x={0} stroke={CHART.axis} />
                    <Bar dataKey="value" maxBarSize={20} radius={4} stroke={SURFACE} strokeWidth={0}>
                      {rows.map((r) => <Cell key={r.id} fill={r.value >= 0 ? POLE.owedToMe : POLE.owed} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </>
      )}
    </DashCard>
  )
}
