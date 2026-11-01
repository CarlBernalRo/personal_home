import { useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Trash2, Fuel } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { SalaryState } from '@/hooks/useSalary'
import { HouseholdDebtCard } from '@/components/fixed/HouseholdDebtCard'
import { followsHousehold, formatCOP, isPaused, monthKey, type VariableBudget } from '@/shared'

const shortDate = (d: Date) => format(d, "d 'de' MMM", { locale: es })

/** Occasional expenses (no fixed day/amount): progress against the estimate and quick registering of real spends. Configured in Gastos Fijos → Configuración. */
export function VariableBudgetsCard({ salary }: { salary: SalaryState }) {
  const { budgets, spends, currentPeriod, registerSpend, removeSpend } = salary
  const { showToast } = useToast()
  const ask = useConfirm()

  const [spendFor, setSpendFor] = useState<VariableBudget | null>(null)
  const [spend, setSpend] = useState({ amount: '', date: format(new Date(), 'yyyy-MM-dd') })
  const [accountId, setAccountId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Spends are measured over the current salary period (this month if none is confirmed yet)
  const now = new Date()
  const start = currentPeriod?.start ?? new Date(now.getFullYear(), now.getMonth(), 1)
  const end = currentPeriod?.end ?? new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const inRange = spends.filter((s) => s.date >= start && s.date < end)
  // a budget switched off for the month this period belongs to isn't shown or reserved
  const periodMonth = monthKey(new Date(end.getTime() - 86_400_000))
  const owedOf = (b: VariableBudget) => salary.variable.householdOwedAt?.(new Date(), b.householdIds) ?? salary.variable.householdOwed ?? 0
  const active = budgets.filter((b) => b.active && !isPaused(b, periodMonth)
    // the household-debt one only shows while something is owed (or was paid this period)
    && (b.source !== 'household-debt' || owedOf(b) > 0 || inRange.some((s) => s.budgetId === b.id)))

  function openSpend(b: VariableBudget) {
    setSpend({ amount: '', date: format(new Date(), 'yyyy-MM-dd') })
    setAccountId(salary.pickAccount(b.accountId))
    setError(null)
    setSpendFor(b)
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault()
    const amount = Number(spend.amount)
    if (!spendFor) return
    if (!(amount > 0)) return setError('Ingresa un monto mayor a 0')
    const [y, m, d] = spend.date.split('-').map(Number)
    setSaving(true)
    try {
      await registerSpend(spendFor, amount, new Date(y, m - 1, d), accountId)
      salary.rememberAccount(accountId)
      setSpendFor(null)
      showToast('Gasto registrado', 'success')
    } catch {
      showToast('No se pudo registrar el gasto', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (active.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#9aa4ac]">
          <Fuel size={14} className="text-amber-300" />
          Gastos ocasionales · sin fecha ni valor fijo
        </div>
      </div>

      {active.length === 0 ? null : (
        <div className="space-y-2.5">
          {active.map((b) => {
            if (b.source === 'household-debt') {
              const paid = inRange.filter((s) => s.budgetId === b.id).reduce((sum, s) => sum + s.amount, 0)
              const names = salary.variable.householdNames ?? {}
              // every pending debt of the households it follows: dated ones say when they fall due
              const rows = (salary.variable.householdLines ?? [])
                .filter((l) => followsHousehold(b, l.householdId))
                .map((l) => ({
                  key: `${l.householdId}|${l.id}`,
                  householdId: l.householdId,
                  household: names[l.householdId] ?? 'Hogar',
                  debt: l.concept || 'Deuda',
                  detail: l.dueDate ? `vence ${shortDate(l.dueDate)}` : 'sin fecha acordada',
                  amount: l.remaining,
                }))
                .sort((x, y) => x.household.localeCompare(y.household) || x.debt.localeCompare(y.debt))
              return (
                <HouseholdDebtCard
                  key={b.id}
                  title={b.concept}
                  subtitle={b.paymentDay ? `día ${b.paymentDay}` : undefined}
                  rows={rows}
                  meta={`Abonado este período ${formatCOP(paid)}`}
                  note={b.notes}
                />
              )
            }
            const mine = inRange.filter((s) => s.budgetId === b.id)
            const spent = mine.reduce((sum, s) => sum + s.amount, 0)
            const over = spent > b.amount
            const pct = b.amount ? (spent / b.amount) * 100 : 0
            return (
              <div key={b.id} className={clsx('rounded-xl border bg-[#0d263a] p-3 space-y-2', over ? 'border-red-500/40' : 'border-amber-500/30')}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#f0fae8] truncate">{b.concept}{b.paymentDay ? <span className="text-[10px] font-normal text-[#8a929a]"> · día {b.paymentDay}</span> : null}</p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => openSpend(b)}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-brand-600 hover:bg-brand-500 text-white border border-brand-400/40 transition"
                    >
                      Registrar
                    </button>
                  </div>
                </div>

                <ProgressBar value={pct} color={over ? '#ef4444' : '#f59e0b'} size="sm" />
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-[#c7ccd1]">
                    Gastado <span className={clsx('font-bold', over ? 'text-red-300' : 'text-[#f0fae8]')}>{formatCOP(spent)}</span> de {formatCOP(b.amount)}
                  </span>
                  <span className={over ? 'text-red-300' : 'text-amber-200'}>
                    {over ? `Excedido ${formatCOP(spent - b.amount)}` : `Reservado ${formatCOP(b.amount - spent)}`}
                  </span>
                </div>

                {mine.length > 0 && (
                  <div className="border-t border-white/10 pt-2 space-y-1">
                    {mine.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-[#9aa4ac]">{shortDate(s.date)}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-[#f0fae8]">−{formatCOP(s.amount)}</span>
                          <button
                            type="button"
                            onClick={async () => {
                              if (await ask('¿Eliminar este gasto registrado?', { title: 'Eliminar gasto' })) removeSpend(s.id).catch(() => showToast('No se pudo eliminar', 'error'))
                            }}
                            className="p-0.5 text-[#8a929a] hover:text-red-400 transition"
                            aria-label="Eliminar gasto"
                          >
                            <Trash2 size={11} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Register a real spend */}
      <Modal open={!!spendFor} onClose={() => setSpendFor(null)} title={spendFor ? `Registrar: ${spendFor.concept}` : ''}>
        <form onSubmit={onRegister} className="space-y-4">
          <Input label="Monto gastado (COP)" money placeholder="0" value={spend.amount} onChange={(e) => { setSpend({ ...spend, amount: e.target.value }); setError(null) }} />
          <Input label="Fecha" type="date" value={spend.date} onChange={(e) => setSpend({ ...spend, date: e.target.value })} />
          <AccountSelect label="¿De qué cuenta sale el dinero?" accounts={salary.accounts} value={accountId} onChange={setAccountId} outflow={Number(spend.amount) || 0} />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setSpendFor(null)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Guardando…' : 'Registrar gasto'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
