import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Edit2, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SkeletonList } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import {
  addAccount, getAccounts, updateAccount, deleteAccount,
  addSavingsGoal, getSavingsGoals, updateSavingsGoal, deleteSavingsGoal,
  addIncome, getIncomes, deleteIncome,
} from '@/lib/firestore'
import { formatCOP } from '@/shared'
import type { AccountType } from '@/shared'

// ── Account types ────────────────────────────────────────────────────────────
const ACCOUNT_TYPES: { value: AccountType; label: string; icon: string }[] = [
  { value: 'checking',   label: 'Cuenta corriente', icon: '🏦' },
  { value: 'savings',    label: 'Cuenta de ahorros', icon: '💰' },
  { value: 'cash',       label: 'Efectivo',           icon: '💵' },
  { value: 'investment', label: 'Inversión',           icon: '📈' },
]
const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#ef4444']
const ICONS  = ['🏠', '✈️', '🚗', '📱', '💍', '🎓', '🐾', '🛍️', '🎯', '💰']
const GOAL_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4']

// ── Schemas ──────────────────────────────────────────────────────────────────
const accountSchema = z.object({
  name:    z.string().min(1, 'Nombre requerido'),
  type:    z.enum(['checking', 'savings', 'cash', 'investment']),
  balance: z.coerce.number(),
  color:   z.string(),
})

const incomeSchema = z.object({
  concept: z.string().min(1, 'Concepto requerido'),
  amount:  z.coerce.number().positive('Monto mayor a 0'),
  date:    z.string().min(1),
})

const goalSchema = z.object({
  name:          z.string().min(1, 'Nombre requerido'),
  targetAmount:  z.coerce.number().positive('Meta mayor a 0'),
  currentAmount: z.coerce.number().min(0),
  deadline:      z.string().optional(),
})

const addMoneySchema = z.object({ amount: z.coerce.number().positive() })

type AccountForm  = z.infer<typeof accountSchema>
type IncomeForm   = z.infer<typeof incomeSchema>
type GoalForm     = z.infer<typeof goalSchema>
type AddMoneyForm = z.infer<typeof addMoneySchema>

type Tab = 'cuentas' | 'ingresos' | 'ahorros'

// ── Main component ────────────────────────────────────────────────────────────
export default function FinancesPage() {
  const { user }       = useAuth()
  const { showToast }  = useToast()
  const [activeTab, setActiveTab] = useState<Tab>('cuentas')

  const [accounts, setAccounts]   = useState<any[]>([])
  const [incomes, setIncomes]     = useState<any[]>([])
  const [goals, setGoals]         = useState<any[]>([])
  const [loadingAcc, setLoadingAcc] = useState(true)
  const [loadingInc, setLoadingInc] = useState(true)
  const [loadingGls, setLoadingGls] = useState(true)

  // Account modal
  const [openAcc, setOpenAcc]   = useState(false)
  const [editAcc, setEditAcc]   = useState<any>(null)
  const [savingAcc, setSavingAcc] = useState(false)
  const [selectedColor, setSelectedColor] = useState(COLORS[0])

  // Income modal
  const [openInc, setOpenInc]   = useState(false)
  const [savingInc, setSavingInc] = useState(false)

  // Goal modals
  const [openGoal, setOpenGoal]   = useState(false)
  const [savingGoal, setSavingGoal] = useState(false)
  const [selectedIcon, setSelectedIcon]   = useState(ICONS[0])
  const [selectedGoalColor, setSelectedGoalColor] = useState(GOAL_COLORS[0])
  const [addMoneyGoal, setAddMoneyGoal] = useState<any>(null)

  const accForm  = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: { type: 'checking', balance: 0, color: COLORS[0] },
  })
  const incForm  = useForm<IncomeForm>({
    resolver: zodResolver(incomeSchema),
    defaultValues: { date: format(new Date(), 'yyyy-MM-dd') },
  })
  const goalForm = useForm<GoalForm>({
    resolver: zodResolver(goalSchema),
    defaultValues: { currentAmount: 0 },
  })
  const addMoneyForm = useForm<AddMoneyForm>({ resolver: zodResolver(addMoneySchema) })

  async function loadAccounts() {
    if (!user) return
    const data = await getAccounts(user.uid)
    setAccounts(data as any[])
    setLoadingAcc(false)
  }
  async function loadIncomes() {
    if (!user) return
    const data = await getIncomes(user.uid)
    setIncomes(data as any[])
    setLoadingInc(false)
  }
  async function loadGoals() {
    if (!user) return
    const data = await getSavingsGoals(user.uid)
    setGoals(data as any[])
    setLoadingGls(false)
  }

  useEffect(() => {
    loadAccounts()
    loadIncomes()
    loadGoals()
  }, [user])

  // ── Accounts ────────────────────────────────────────────────────────────────
  function openCreateAcc() {
    setEditAcc(null)
    setSelectedColor(COLORS[0])
    accForm.reset({ type: 'checking', balance: 0, color: COLORS[0] })
    setOpenAcc(true)
  }
  function openEditAcc(acc: any) {
    setEditAcc(acc)
    setSelectedColor(acc.color)
    accForm.reset({ name: acc.name, type: acc.type, balance: acc.balance, color: acc.color })
    setOpenAcc(true)
  }
  async function onSubmitAcc(data: AccountForm) {
    if (!user) return
    setSavingAcc(true)
    try {
      const payload = { ...data, color: selectedColor }
      if (editAcc) {
        await updateAccount(editAcc.id, payload)
      } else {
        await addAccount({ ...payload, userId: user.uid, currency: 'COP' })
      }
      accForm.reset()
      setOpenAcc(false)
      loadAccounts()
      showToast(editAcc ? 'Cuenta actualizada' : 'Cuenta agregada', 'success')
    } catch {
      showToast('Error al guardar', 'error')
    } finally {
      setSavingAcc(false)
    }
  }
  async function handleDeleteAcc(id: string) {
    if (!confirm('¿Eliminar esta cuenta?')) return
    await deleteAccount(id)
    setAccounts((prev) => prev.filter((a) => a.id !== id))
    showToast('Cuenta eliminada', 'info')
  }

  // ── Incomes ────────────────────────────────────────────────────────────────
  async function onSubmitInc(data: IncomeForm) {
    if (!user) return
    setSavingInc(true)
    try {
      const date = new Date(data.date + 'T12:00:00')
      await addIncome({
        userId:  user.uid,
        concept: data.concept,
        amount:  data.amount,
        month:   format(date, 'yyyy-MM'),
        date,
      })
      incForm.reset({ date: format(new Date(), 'yyyy-MM-dd') })
      setOpenInc(false)
      loadIncomes()
      showToast('Ingreso agregado', 'success')
    } catch {
      showToast('Error al guardar', 'error')
    } finally {
      setSavingInc(false)
    }
  }
  async function handleDeleteInc(id: string) {
    if (!confirm('¿Eliminar este ingreso?')) return
    await deleteIncome(id)
    setIncomes((prev) => prev.filter((i) => i.id !== id))
    showToast('Ingreso eliminado', 'info')
  }

  // ── Savings goals ──────────────────────────────────────────────────────────
  async function onSubmitGoal(data: GoalForm) {
    if (!user) return
    setSavingGoal(true)
    try {
      await addSavingsGoal({
        userId:        user.uid,
        name:          data.name,
        targetAmount:  data.targetAmount,
        currentAmount: data.currentAmount,
        icon:          selectedIcon,
        color:         selectedGoalColor,
        deadline:      data.deadline ? new Date(data.deadline) : undefined,
      })
      goalForm.reset({ currentAmount: 0 })
      setOpenGoal(false)
      loadGoals()
      showToast('Meta creada', 'success')
    } catch {
      showToast('Error al guardar', 'error')
    } finally {
      setSavingGoal(false)
    }
  }
  async function handleAddMoney(data: AddMoneyForm) {
    if (!addMoneyGoal) return
    setSavingGoal(true)
    const newAmount = (addMoneyGoal.currentAmount as number) + data.amount
    await updateSavingsGoal(addMoneyGoal.id as string, {
      currentAmount: Math.min(newAmount, addMoneyGoal.targetAmount as number),
    })
    addMoneyForm.reset()
    setAddMoneyGoal(null)
    loadGoals()
    showToast('Abono registrado', 'success')
    setSavingGoal(false)
  }
  async function handleDeleteGoal(id: string) {
    if (!confirm('¿Eliminar esta meta?')) return
    await deleteSavingsGoal(id)
    setGoals((prev) => prev.filter((g) => g.id !== id))
    showToast('Meta eliminada', 'info')
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const totalBalance   = accounts.reduce((s: number, a: any) => s + (a.balance as number), 0)
  const now            = new Date()
  const currentMonth   = format(now, 'yyyy-MM')
  const monthIncomes   = incomes.filter((i: any) => i.month === currentMonth)
  const totalMonthInc  = monthIncomes.reduce((s: number, i: any) => s + (i.amount as number), 0)
  const totalSaved     = goals.reduce((s: number, g: any) => s + (g.currentAmount as number), 0)
  const totalTarget    = goals.reduce((s: number, g: any) => s + (g.targetAmount as number), 0)

  const TABS: { key: Tab; label: string }[] = [
    { key: 'cuentas',  label: '💳 Cuentas' },
    { key: 'ingresos', label: '💵 Ingresos' },
    { key: 'ahorros',  label: '🐷 Ahorros' },
  ]

  return (
    <div className="space-y-4 fade-in">
      <h1 className="text-xl font-bold text-[#0f172a]">Finanzas</h1>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={clsx(
              'flex-1 py-2 text-xs font-semibold rounded-lg transition-all',
              activeTab === key
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-400 hover:text-gray-600',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── CUENTAS tab ────────────────────────────────────────────────────── */}
      {activeTab === 'cuentas' && (
        <div className="space-y-3 slide-up">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#64748b]">
                Saldo total:{' '}
                <span className="font-bold text-brand-600 tabular-nums">
                  {formatCOP(totalBalance)}
                </span>
              </p>
            </div>
            <Button onClick={openCreateAcc} size="sm"><Plus size={16} /> Nueva</Button>
          </div>

          {loadingAcc ? (
            <SkeletonList count={3} />
          ) : accounts.length === 0 ? (
            <Card className="text-center py-10">
              <p className="text-4xl mb-2">💳</p>
              <p className="text-sm font-semibold text-gray-700">Sin cuentas registradas</p>
              <p className="text-xs text-gray-400 mt-1">Agrega tus cuentas para llevar el control.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {accounts.map((acc: any) => {
                const typeInfo = ACCOUNT_TYPES.find((t) => t.value === acc.type)
                return (
                  <Card key={acc.id as string} className="p-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                        style={{ backgroundColor: (acc.color as string) + '20' }}
                      >
                        {typeInfo?.icon ?? '💳'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900">{acc.name as string}</p>
                        <p className="text-xs text-gray-400">{typeInfo?.label ?? acc.type}</p>
                      </div>
                      <p className="text-base font-bold tabular-nums" style={{ color: acc.color }}>
                        {formatCOP(acc.balance as number)}
                      </p>
                      <div className="flex gap-1 ml-1">
                        <button onClick={() => openEditAcc(acc)} className="p-1.5 text-gray-300 hover:text-brand-600 transition">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDeleteAcc(acc.id as string)} className="p-1.5 text-gray-300 hover:text-red-500 transition">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── INGRESOS tab ───────────────────────────────────────────────────── */}
      {activeTab === 'ingresos' && (
        <div className="space-y-3 slide-up">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#64748b]">
                Este mes:{' '}
                <span className="font-bold text-brand-600 tabular-nums">
                  {formatCOP(totalMonthInc)}
                </span>
              </p>
            </div>
            <Button onClick={() => setOpenInc(true)} size="sm"><Plus size={16} /> Agregar</Button>
          </div>

          {loadingInc ? (
            <SkeletonList count={3} />
          ) : incomes.length === 0 ? (
            <Card className="text-center py-10">
              <p className="text-4xl mb-2">💵</p>
              <p className="text-sm font-semibold text-gray-700">Sin ingresos registrados</p>
              <p className="text-xs text-gray-400 mt-1">Registra tus entradas de dinero.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {incomes.map((inc: any) => (
                <Card key={inc.id as string} className="flex items-center gap-3 p-3.5">
                  <div className="w-10 h-10 rounded-2xl bg-brand-50 flex items-center justify-center text-xl flex-shrink-0">
                    💵
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{inc.concept as string}</p>
                    <p className="text-xs text-gray-400">
                      {format(
                        inc.date instanceof Date ? inc.date : new Date(inc.date),
                        'dd MMM yyyy',
                        { locale: es },
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm font-bold text-brand-600 tabular-nums">
                      +{formatCOP(inc.amount as number)}
                    </span>
                    <button onClick={() => handleDeleteInc(inc.id as string)} className="p-1 text-gray-300 hover:text-red-500 transition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── AHORROS tab ────────────────────────────────────────────────────── */}
      {activeTab === 'ahorros' && (
        <div className="space-y-3 slide-up">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#64748b]">
                {formatCOP(totalSaved)} de {formatCOP(totalTarget)}
              </p>
            </div>
            <Button onClick={() => setOpenGoal(true)} size="sm"><Plus size={16} /> Nueva meta</Button>
          </div>

          {/* Global progress */}
          {goals.length > 0 && (
            <Card className="py-3 px-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                <span>Progreso total</span>
                <span>
                  {totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0}%
                </span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all"
                  style={{
                    width: `${totalTarget > 0 ? Math.min((totalSaved / totalTarget) * 100, 100) : 0}%`,
                  }}
                />
              </div>
            </Card>
          )}

          {loadingGls ? (
            <SkeletonList count={3} />
          ) : goals.length === 0 ? (
            <Card className="text-center py-10">
              <p className="text-4xl mb-2">🐷</p>
              <p className="text-sm font-semibold text-gray-700">Sin metas de ahorro</p>
              <p className="text-xs text-gray-400 mt-1">Crea tu primera meta para empezar.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {goals.map((g: any) => {
                const pct = (g.targetAmount as number) > 0
                  ? Math.min(Math.round(((g.currentAmount as number) / (g.targetAmount as number)) * 100), 100)
                  : 0
                return (
                  <Card key={g.id as string} className="p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                        style={{ backgroundColor: (g.color as string) + '20' }}
                      >
                        {g.icon as string}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{g.name as string}</p>
                        <p className="text-xs text-gray-400">
                          {formatCOP(g.currentAmount as number)} / {formatCOP(g.targetAmount as number)}
                        </p>
                      </div>
                      <p className="text-sm font-bold flex-shrink-0 tabular-nums" style={{ color: g.color }}>
                        {pct}%
                      </p>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: g.color }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" className="flex-1 text-brand-600" onClick={() => setAddMoneyGoal(g)}>
                        + Abonar
                      </Button>
                      <button onClick={() => handleDeleteGoal(g.id as string)} className="p-1.5 text-gray-300 hover:text-red-500 transition">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Account modal */}
      <Modal open={openAcc} onClose={() => setOpenAcc(false)} title={editAcc ? 'Editar cuenta' : 'Nueva cuenta'}>
        <form onSubmit={accForm.handleSubmit(onSubmitAcc)} className="space-y-4">
          <Input label="Nombre" placeholder="ej. Bancolombia ahorros" {...accForm.register('name')} error={accForm.formState.errors.name?.message} />
          <Select label="Tipo" options={ACCOUNT_TYPES.map((t) => ({ value: t.value, label: `${t.icon} ${t.label}` }))} {...accForm.register('type')} />
          <Input label="Saldo actual (COP)" type="number" placeholder="0" {...accForm.register('balance')} />
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Color</p>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c} type="button"
                  onClick={() => setSelectedColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${selectedColor === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenAcc(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={savingAcc}>{savingAcc ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>

      {/* Income modal */}
      <Modal open={openInc} onClose={() => setOpenInc(false)} title="Nuevo ingreso">
        <form onSubmit={incForm.handleSubmit(onSubmitInc)} className="space-y-4">
          <Input label="Concepto" placeholder="ej. Salario, Freelance…" {...incForm.register('concept')} error={incForm.formState.errors.concept?.message} />
          <Input label="Monto (COP)" type="number" placeholder="0" {...incForm.register('amount')} error={incForm.formState.errors.amount?.message} />
          <Input label="Fecha" type="date" {...incForm.register('date')} />
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenInc(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={savingInc}>{savingInc ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>

      {/* Goal modal */}
      <Modal open={openGoal} onClose={() => setOpenGoal(false)} title="Nueva meta de ahorro">
        <form onSubmit={goalForm.handleSubmit(onSubmitGoal)} className="space-y-4">
          <Input label="Nombre" placeholder="ej. Vacaciones, Carro…" {...goalForm.register('name')} error={goalForm.formState.errors.name?.message} />
          <Input label="Monto objetivo (COP)" type="number" placeholder="0" {...goalForm.register('targetAmount')} error={goalForm.formState.errors.targetAmount?.message} />
          <Input label="Ya ahorrado (COP)" type="number" placeholder="0" {...goalForm.register('currentAmount')} />
          <Input label="Fecha límite (opcional)" type="date" {...goalForm.register('deadline')} />
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Ícono</p>
            <div className="flex gap-2 flex-wrap">
              {ICONS.map((ic) => (
                <button key={ic} type="button"
                  onClick={() => setSelectedIcon(ic)}
                  className={`text-xl p-1.5 rounded-xl transition ${selectedIcon === ic ? 'bg-brand-100 ring-2 ring-brand-400' : 'hover:bg-gray-100'}`}>
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Color</p>
            <div className="flex gap-2">
              {GOAL_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setSelectedGoalColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${selectedGoalColor === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenGoal(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={savingGoal}>{savingGoal ? 'Guardando…' : 'Crear meta'}</Button>
          </div>
        </form>
      </Modal>

      {/* Add money to goal modal */}
      <Modal open={!!addMoneyGoal} onClose={() => setAddMoneyGoal(null)} title={`Abonar a "${addMoneyGoal?.name ?? ''}"`}>
        <form onSubmit={addMoneyForm.handleSubmit(handleAddMoney)} className="space-y-4">
          <p className="text-sm text-gray-500">
            Ahorrado: <strong>{formatCOP(addMoneyGoal?.currentAmount ?? 0)}</strong> de <strong>{formatCOP(addMoneyGoal?.targetAmount ?? 0)}</strong>
          </p>
          <Input label="Monto a abonar (COP)" type="number" placeholder="0" {...addMoneyForm.register('amount')} error={addMoneyForm.formState.errors.amount?.message} />
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setAddMoneyGoal(null)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={savingGoal}>{savingGoal ? 'Guardando…' : 'Abonar'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
