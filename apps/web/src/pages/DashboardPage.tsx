import { useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { TrendingDown, TrendingUp, CalendarCheck, Scale } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { SkeletonCard, SkeletonList } from '@/components/ui/Skeleton'
import { useAuth } from '@/hooks/useAuth'
import { useDisplayName } from '@/hooks/useDisplayName'
import {
  getExpenses, getIncomes, getFixedExpenses, getFixedExpensePayments,
  getHouseholdDebts, calcNetBalance, getSavingsGoals,
} from '@/lib/firestore'
import { formatCOP, PERSONAL_CATEGORIES } from '@/shared'

export default function DashboardPage() {
  const { user, profile } = useAuth()
  const [expenses, setExpenses]   = useState<any[]>([])
  const [incomes, setIncomes]     = useState<any[]>([])
  const [fixedExp, setFixedExp]   = useState<any[]>([])
  const [fixedPay, setFixedPay]   = useState<any[]>([])
  const [debts, setDebts]         = useState<any[]>([])
  const [goals, setGoals]         = useState<any[]>([])
  const [loading, setLoading]     = useState(true)

  const now         = new Date()
  const currentMonth = format(now, 'yyyy-MM')
  const monthStart  = startOfMonth(now)
  const monthEnd    = endOfMonth(now)
  const householdId = (profile?.householdId as string | null) ?? null

  useEffect(() => {
    if (!user) return
    const loads: Promise<any>[] = [
      getExpenses(user.uid),
      getIncomes(user.uid),
      getFixedExpenses(user.uid),
      getFixedExpensePayments(user.uid, currentMonth),
      getSavingsGoals(user.uid),
    ]
    if (householdId) {
      loads.push(getHouseholdDebts(householdId))
    } else {
      loads.push(Promise.resolve([]))
    }
    Promise.all(loads).then(([exp, inc, fxExp, fxPay, gls, dbt]) => {
      setExpenses(exp as any[])
      setIncomes(inc as any[])
      setFixedExp(fxExp as any[])
      setFixedPay(fxPay as any[])
      setGoals(gls as any[])
      setDebts(dbt as any[])
      setLoading(false)
    })
  }, [user, householdId, currentMonth])

  const monthExpenses = expenses.filter((e) => {
    const d = e.date instanceof Date ? e.date : new Date(e.date)
    return d >= monthStart && d <= monthEnd
  })
  const monthIncomes = incomes.filter((i) => i.month === currentMonth)

  const totalExpenses = monthExpenses.reduce((s: number, e: any) => s + e.amount, 0)
  const totalIncomes  = monthIncomes.reduce((s: number, i: any) => s + i.amount, 0)
  const netMonth      = totalIncomes - totalExpenses

  const fixedPaidIds = new Set(fixedPay.map((p: any) => p.fixedExpenseId as string))
  const fixedPaidCount = fixedExp.filter((fe: any) => fixedPaidIds.has(fe.id as string)).length
  const fixedTotal     = fixedExp.length

  const myBalance = user ? calcNetBalance(debts, user.uid) : 0

  const displayNameVal = useDisplayName()
  const firstName = displayNameVal || 'bienvenido'
  const monthLabel = format(now, "MMMM 'de' yyyy", { locale: es })

  const recentExpenses = monthExpenses.slice(0, 5)

  const totalSaved  = goals.reduce((s: number, g: any) => s + g.currentAmount, 0)
  const totalTarget = goals.reduce((s: number, g: any) => s + g.targetAmount, 0)

  if (loading) {
    return (
      <div className="space-y-4 fade-in">
        <div className="space-y-1">
          <SkeletonCard />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <SkeletonList count={3} />
      </div>
    )
  }

  return (
    <div className="space-y-5 fade-in">
      {/* Greeting */}
      <div>
        <h1 className="text-xl font-bold text-[#0f172a]">
          Hola, {firstName} 👋
        </h1>
        <p className="text-sm text-[#64748b] capitalize">{monthLabel}</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="inline-flex p-2 rounded-xl bg-red-50 text-red-500 mb-2">
            <TrendingDown size={18} />
          </div>
          <p className="text-xs text-[#64748b]">Gastos del mes</p>
          <p className="text-base font-bold text-[#0f172a] mt-0.5 truncate">
            {formatCOP(totalExpenses)}
          </p>
        </Card>

        <Card className="p-4">
          <div className="inline-flex p-2 rounded-xl bg-brand-50 text-brand-600 mb-2">
            <TrendingUp size={18} />
          </div>
          <p className="text-xs text-[#64748b]">Ingresos del mes</p>
          <p className="text-base font-bold text-[#0f172a] mt-0.5 truncate">
            {formatCOP(totalIncomes)}
          </p>
        </Card>

        <Card className="p-4">
          <div className="inline-flex p-2 rounded-xl bg-blue-50 text-blue-500 mb-2">
            <CalendarCheck size={18} />
          </div>
          <p className="text-xs text-[#64748b]">Fijos pagados</p>
          <p className="text-base font-bold text-[#0f172a] mt-0.5">
            {fixedPaidCount} / {fixedTotal}
          </p>
        </Card>

        <Card className="p-4">
          <div className="inline-flex p-2 rounded-xl bg-amber-50 text-amber-500 mb-2">
            <Scale size={18} />
          </div>
          <p className="text-xs text-[#64748b]">Balance neto</p>
          <p className={`text-base font-bold mt-0.5 truncate ${netMonth >= 0 ? 'text-brand-600' : 'text-red-500'}`}>
            {formatCOP(netMonth)}
          </p>
        </Card>
      </div>

      {/* Household debt chip */}
      {householdId && (
        <Card className="p-4 flex items-center gap-3">
          <span className="text-2xl">🏠</span>
          <div>
            <p className="text-xs text-[#64748b] font-semibold uppercase tracking-wider">
              Deuda del hogar
            </p>
            {myBalance === 0 ? (
              <p className="text-sm font-semibold text-brand-600">Están al día ✓</p>
            ) : myBalance > 0 ? (
              <p className="text-sm font-semibold text-red-500">
                Debes {formatCOP(myBalance)}
              </p>
            ) : (
              <p className="text-sm font-semibold text-brand-600">
                Te deben {formatCOP(Math.abs(myBalance))}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Savings mini overview */}
      {goals.length > 0 && (
        <Card className="p-4">
          <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">
            Ahorros
          </p>
          <div className="space-y-2.5">
            {goals.slice(0, 3).map((g: any) => {
              const pct = g.targetAmount > 0 ? Math.min(Math.round((g.currentAmount / g.targetAmount) * 100), 100) : 0
              return (
                <div key={g.id}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{g.icon}</span>
                      <span className="text-xs font-medium text-gray-700 truncate max-w-[140px]">{g.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-gray-500">{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: g.color ?? '#16a34a' }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          {totalTarget > 0 && (
            <p className="text-xs text-[#64748b] mt-3">
              {formatCOP(totalSaved)} ahorrados de {formatCOP(totalTarget)}
            </p>
          )}
        </Card>
      )}

      {/* Recent expenses */}
      {recentExpenses.length > 0 && (
        <Card className="p-4">
          <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">
            Últimos gastos
          </p>
          <div className="space-y-2">
            {recentExpenses.map((e: any) => {
              const cat = PERSONAL_CATEGORIES.find((c) => c.id === e.category)
              return (
                <div key={e.id} className="flex items-center gap-3 py-1">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ backgroundColor: (cat?.color ?? '#6b7280') + '20' }}
                  >
                    {cat?.icon ?? '📦'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{e.description}</p>
                    <p className="text-xs text-gray-400">
                      {format(e.date instanceof Date ? e.date : new Date(e.date), 'dd MMM', { locale: es })}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-gray-900 flex-shrink-0 tabular-nums">
                    {formatCOP(e.amount)}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {expenses.length === 0 && incomes.length === 0 && goals.length === 0 && (
        <Card className="text-center py-10">
          <p className="text-5xl mb-3">📊</p>
          <p className="text-sm font-semibold text-gray-700">Sin datos aún</p>
          <p className="text-xs text-gray-400 mt-1">
            Agrega tus gastos e ingresos para ver el resumen.
          </p>
        </Card>
      )}
    </div>
  )
}
