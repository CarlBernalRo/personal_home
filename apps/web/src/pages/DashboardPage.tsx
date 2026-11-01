import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarRange, Sparkles } from 'lucide-react'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { MobileCollapse } from '@/components/ui/MobileCollapse'
import { CurvedScrollContainer } from '@/components/ui/CurvedScrollContainer'
import { SalaryPanel } from '@/components/salary/SalaryPanel'
import { useDashboardData } from '@/hooks/useDashboardData'
import { useDefaultAccount } from '@/hooks/useDefaultAccount'
import { KpiRow } from '@/components/dashboard/KpiRow'
import { SalarySplit } from '@/components/dashboard/SalarySplit'
import { ScheduleTimeline } from '@/components/dashboard/ScheduleTimeline'
import { TrendChart } from '@/components/dashboard/TrendChart'
import { BalanceChart } from '@/components/dashboard/BalanceChart'
import { FixedZone } from '@/components/dashboard/FixedZone'
import { ExpensesZone } from '@/components/dashboard/ExpensesZone'
import { AccountsZone } from '@/components/dashboard/AccountsZone'
import { HouseholdZone } from '@/components/dashboard/HouseholdZone'
import { GoalsCard } from '@/components/dashboard/GoalsCard'

const DAY_MS = 86_400_000

export default function DashboardPage() {
  const data = useDashboardData()
  useDefaultAccount(data.salary, data.outlook ? data.outlook.cash : null)

  if (data.loading) {
    return (
      <div className="space-y-4 fade-in" aria-busy="true" aria-label="Cargando resumen">
        <div className="h-14 bg-[#0d263a] notch-sm skeleton" />
        <div className="h-24 bg-[#0d263a] notch-sm skeleton" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-72 bg-[#0d263a] notch skeleton" />
          <div className="h-72 bg-[#0d263a] notch skeleton" />
        </div>
      </div>
    )
  }

  const { bounds, salaryMonth } = data
  const periodLabel = `${format(bounds.start, 'd MMM', { locale: es })} – ${format(new Date(bounds.end.getTime() - DAY_MS), 'd MMM', { locale: es })}`
  const [y, m] = salaryMonth.split('-').map(Number)
  const monthLabel = format(new Date(y, m - 1, 1), 'MMMM', { locale: es })

  const framed = 'rounded-3xl border border-white/10 bg-[#0a1f2f]/50'
  const scrollProps = {
    contentClassName: 'max-lg:!overflow-visible space-y-5 py-3 !pl-3 !pr-3 lg:py-4 lg:!pl-4 lg:!pr-6',
    corners: 'both' as const,
    borderRadius: 24,
    offset: 7,
    variant: 'plain' as const,
    themeColor: 'brand' as const,
  }

  return (
    <div className="flex flex-col gap-5 fade-in text-[#f0fae8] min-w-0 lg:flex-row lg:h-full lg:min-h-0">
      {/* Left pane: who you are, the salary and the money now; the zones that need little room (Hogar, metas) */}
      <CurvedScrollContainer
        className={`lg:w-[32%] lg:min-w-[340px] lg:max-w-[560px] lg:flex-shrink-0 lg:min-h-0 ${framed}`}
        {...scrollProps}
      >
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 mb-1.5 notch-sm bg-brand-500/10 border border-brand-500/30 text-brand-400 font-pixel text-[8px] uppercase tracking-wider glow-brand-sm">
            <Sparkles size={10} aria-hidden="true" />
            <span>Período de sueldo</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[#f0fae8] capitalize truncate">{monthLabel} <span className="text-brand-400">{y}</span></h1>
          <p className="mt-1.5 inline-flex items-center gap-2 notch-sm px-3 py-1.5 bg-brand-500/10 border border-brand-500/30 text-sm font-mono font-semibold text-brand-200">
            <CalendarRange size={14} className="text-brand-400" aria-hidden="true" />
            {periodLabel}
          </p>
        </div>

        {/* On pay day the prompt to confirm the salary shows here; the detailed breakdown lives in Fijos / Gastos */}
        <SalaryPanel variant="pending" salary={data.salary} expenses={data.fixed.expenses} paymentIndex={data.fixed.paymentIndex} />

        <KpiRow compact outlook={data.outlook} ledger={data.ledger} income={data.income} salary={data.salary} />

        <MobileCollapse title="Hogar y metas">
          <HouseholdZone households={data.households} householdTotals={data.householdTotals} />
          <GoalsCard goals={data.goals} />
        </MobileCollapse>
      </CurvedScrollContainer>

      {/* Right pane: the salary split is the fixed header, the charts and the zones scroll below it */}
      <div className="min-w-0 flex flex-col gap-5 lg:flex-1 lg:min-h-0">
        {/* Where the salary went stays fixed on top; the charts and zones scroll below it */}
        <div className="flex-shrink-0">
          <SalarySplit ledger={data.ledger} income={data.income} />
        </div>

        <CurvedScrollContainer className={`lg:flex-1 lg:min-h-0 ${framed}`} {...scrollProps}>
          <MobileCollapse title="Cronograma de períodos">
            <ScheduleTimeline salary={data.salary} expenses={data.fixed.expenses} paymentIndex={data.fixed.paymentIndex} />
          </MobileCollapse>

          <MobileCollapse title="Tendencias y saldo proyectado">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <TrendChart history={data.history} />
              <BalanceChart balanceCurve={data.balanceCurve} outlook={data.outlook} />
            </div>
          </MobileCollapse>

          <AccountsZone accounts={data.salary.accounts} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <FixedZone fixedStats={data.fixedStats} entries={data.entries} />
            <ExpensesZone additional={data.additional} categories={data.categories} spendCurve={data.spendCurve} bounds={data.bounds} />
          </div>
        </CurvedScrollContainer>
      </div>
    </div>
  )
}
