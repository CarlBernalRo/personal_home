import { useEffect, useState } from 'react'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { TransferModal } from '@/components/fixed/TransferModal'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Edit2, Trash2, Wallet, DollarSign, PiggyBank, Sparkles, ArrowLeftRight } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'
import { AttachmentButton } from '@/components/pending/AttachmentButton'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SkeletonList } from '@/components/ui/Skeleton'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAuth } from '@/hooks/useAuth'
import {
  addAccount, getAccounts, updateAccount, deleteAccount,
  addSavingsGoal, getSavingsGoals, updateSavingsGoal, deleteSavingsGoal,
  addIncome, getIncomes, deleteIncome,
} from '@/lib/firestore'
import { formatCOP } from '@/shared'
import type { AccountType } from '@/shared'
import { AppIcon, EmptyMark, GOAL_ICON_KEYS } from '@/components/ui/AppIcon'
import { CurvedScrollContainer } from '@/components/ui/CurvedScrollContainer'
import { AccountMovements } from '@/components/finance/AccountMovements'

// ── Account types ────────────────────────────────────────────────────────────
const ACCOUNT_TYPES: { value: AccountType; label: string; icon: string }[] = [
  { value: 'checking',   label: 'Cuenta corriente', icon: 'bank' },
  { value: 'savings',    label: 'Cuenta de ahorros', icon: 'savings' },
  { value: 'cash',       label: 'Efectivo',           icon: 'cash' },
  { value: 'investment', label: 'Inversión',           icon: 'invest' },
]
const COLORS = ['#52b69a', '#34a0a4', '#168aad', '#76c893', '#d9ed92', '#1a759f', '#1e6091']
const ICONS  = [...GOAL_ICON_KEYS]
const GOAL_COLORS = ['#52b69a', '#34a0a4', '#168aad', '#76c893', '#d9ed92', '#1a759f']

// ── Schemas ──────────────────────────────────────────────────────────────────
const accountSchema = z.object({
  name:    z.string().min(1, 'Nombre requerido'),
  type:    z.enum(['checking', 'savings', 'cash', 'investment']),
  color:   z.string(),
})

const incomeSchema = z.object({
  concept: z.string().min(1, 'Concepto requerido'),
  amount:  z.coerce.number().positive('El monto debe ser mayor a 0'),
  date:    z.string().min(1),
})

const goalSchema = z.object({
  name:          z.string().min(1, 'Nombre requerido'),
  targetAmount:  z.coerce.number().positive('La meta debe ser mayor a 0'),
  currentAmount: z.coerce.number().min(0, 'El monto no puede ser negativo'),
  deadline:      z.string().optional(),
})

const addMoneySchema = z.object({ amount: z.coerce.number().positive('El monto a abonar debe ser mayor a 0') })

type AccountForm  = z.infer<typeof accountSchema>
type IncomeForm   = z.infer<typeof incomeSchema>
type GoalForm     = z.infer<typeof goalSchema>
type AddMoneyForm = z.infer<typeof addMoneySchema>

type Tab = 'movimientos' | 'ingresos' | 'ahorros'

export default function FinancesPage() {
  const { user }       = useAuth()
  const { showToast }  = useToast()
  const ask = useConfirm()
  const [activeTab, setActiveTab] = useState<Tab>('movimientos')
  // Account picked on the left to narrow the movements (null = all), and a counter that makes the movements reload
  const [accountFilter, setAccountFilter] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [accounts, setAccounts]   = useState<any[]>([])
  const [moving, setMoving]       = useState(false)
  // Account a new income is deposited into ('' = none)
  const [incAccount, setIncAccount] = useState('')
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
    defaultValues: { type: 'checking', color: COLORS[0] },
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

  function switchTab(tab: Tab) {
    const anyDoc = document as any
    if (typeof anyDoc.startViewTransition === 'function') {
      anyDoc.startViewTransition(() => setActiveTab(tab))
    } else {
      setActiveTab(tab)
    }
  }

  async function loadAccounts() {
    if (!user) return
    const data = await getAccounts(user.uid)
    setAccounts(data as any[])
    setLoadingAcc(false)
    setRefreshKey((k) => k + 1)
  }
  async function loadIncomes() {
    if (!user) return
    const data = await getIncomes(user.uid)
    setIncomes(data as any[])
    setRefreshKey((k) => k + 1)
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
    accForm.reset({ type: 'checking', color: COLORS[0] })
    setOpenAcc(true)
  }
  function openEditAcc(acc: any) {
    setEditAcc(acc)
    setSelectedColor(acc.color)
    accForm.reset({ name: acc.name, type: acc.type, color: acc.color })
    setOpenAcc(true)
  }
  async function onSubmitAcc(data: AccountForm) {
    if (!user) return
    setSavingAcc(true)
    try {
      const payload = { ...data, color: selectedColor }
      if (editAcc) {
        // the balance is never typed: it comes from the incomes, payments and moves of the account
        await updateAccount(editAcc.id, payload)
      } else {
        await addAccount({ ...payload, balance: 0, userId: user.uid, currency: 'COP' })
      }
      accForm.reset()
      setOpenAcc(false)
      loadAccounts()
      showToast(editAcc ? 'Cuenta actualizada' : 'Cuenta agregada', editAcc ? 'edit' : 'success')
    } catch {
      showToast('Error al guardar', 'error')
    } finally {
      setSavingAcc(false)
    }
  }
  async function handleDeleteAcc(id: string) {
    if (!(await ask('¿Eliminar esta cuenta?', { title: 'Eliminar cuenta' }))) return
    await deleteAccount(id)
    setAccounts((prev) => prev.filter((a) => a.id !== id))
    showToast('Cuenta eliminada', 'delete')
  }

  useEffect(() => {
    if (openInc) setIncAccount((accounts.find((a) => a.isDefault) ?? accounts[0])?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openInc])

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
        ...(incAccount ? { accountId: incAccount } : {}),
      })
      incForm.reset({ date: format(new Date(), 'yyyy-MM-dd') })
      setOpenInc(false)
      loadIncomes()
      loadAccounts() // the chosen account's balance went up
      showToast('Ingreso agregado', 'success')
    } catch {
      showToast('Error al guardar', 'error')
    } finally {
      setSavingInc(false)
    }
  }
  async function handleDeleteInc(id: string) {
    if (!(await ask('¿Eliminar este ingreso?', { title: 'Eliminar ingreso' }))) return
    await deleteIncome(id)
    setIncomes((prev) => prev.filter((i) => i.id !== id))
    showToast('Ingreso eliminado', 'delete')
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
    if (!(await ask('¿Eliminar esta meta?', { title: 'Eliminar meta' }))) return
    await deleteSavingsGoal(id)
    setGoals((prev) => prev.filter((g) => g.id !== id))
    showToast('Meta eliminada', 'delete')
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const totalBalance   = accounts.reduce((s: number, a: any) => s + (a.balance as number), 0)
  const now            = new Date()
  const currentMonth   = format(now, 'yyyy-MM')
  const monthIncomes   = incomes.filter((i: any) => i.month === currentMonth)
  const totalMonthInc  = monthIncomes.reduce((s: number, i: any) => s + (i.amount as number), 0)
  const totalSaved     = goals.reduce((s: number, g: any) => s + (g.currentAmount as number), 0)
  const totalTarget    = goals.reduce((s: number, g: any) => s + (g.targetAmount as number), 0)

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'movimientos', label: 'Movimientos', icon: 'list' },
    { key: 'ingresos',    label: 'Ingresos',    icon: 'cash' },
    { key: 'ahorros',     label: 'Ahorros',     icon: 'savings' },
  ]
  const paneProps = {
    contentClassName: 'max-lg:!overflow-visible space-y-5 py-3 !pl-3 !pr-3 lg:py-4 lg:!pl-4 lg:!pr-6',
    borderRadius: 24,
    offset: 7,
    variant: 'plain' as const,
    themeColor: 'brand' as const,
  }

  return (
    <div className="flex flex-col gap-5 fade-in text-[#f3f5f6] lg:flex-row lg:h-full lg:min-h-0">
      {/* Left pane: the accounts and what each one holds. Picking one narrows the movements on the right. */}
      <CurvedScrollContainer
        className="lg:w-[32%] lg:min-w-[340px] lg:max-w-[560px] lg:flex-shrink-0 lg:min-h-0 rounded-3xl border border-white/10 bg-[#0a1f2f]/50"
        corners="both"
        {...paneProps}
      >
        <div>
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 notch-sm bg-white/[0.04] border border-white/[0.08]">
            <Wallet size={11} className="text-brand-400" />
            <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest">Patrimonio</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f0fae8]">Finanzas</h1>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 flex items-center justify-between gap-3 shadow-xl">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-400/40 flex items-center justify-center text-sky-300 flex-shrink-0">
              <AppIcon name="bank" size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#9aa4ac]">Dinero en tus cuentas</p>
              <p className="text-[10px] text-[#5f6a72]">Total de {accounts.length} {accounts.length === 1 ? 'cuenta' : 'cuentas'}</p>
            </div>
          </div>
          <p className={clsx('text-xl sm:text-2xl font-bold font-mono tabular-nums flex-shrink-0', totalBalance < 0 ? 'text-red-400' : 'text-sky-200')}>
            {formatCOP(totalBalance)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={openCreateAcc} size="sm" notched className="flex-1">
            <Plus size={15} /> Nueva cuenta
          </Button>
          {accounts.length > 1 && (
            <Button onClick={() => setMoving(true)} size="sm" variant="secondary" className="flex-1">
              <ArrowLeftRight size={15} /> Mover saldo
            </Button>
          )}
        </div>

        {loadingAcc ? (
          <SkeletonList count={3} />
        ) : accounts.length === 0 ? (
          <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-10 px-6">
            <EmptyMark name="debt" />
            <p className="text-sm font-bold text-[#f0fae8]">Sin cuentas bancarias registradas</p>
            <p className="text-xs text-[#8a929a] mt-1">Agrega tus cuentas para llevar el control de tus saldos.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {accounts.map((acc: any) => {
              const typeInfo = ACCOUNT_TYPES.find((t) => t.value === acc.type)
              const selected = accountFilter === acc.id
              return (
                <div
                  key={acc.id as string}
                  className={clsx('notch-sm p-3.5 bg-[#0a1f2f] border transition-all flex items-center justify-between gap-3', selected ? 'bg-white/[0.06]' : 'hover:border-white/25')}
                  style={{ borderColor: selected ? (acc.color as string) : (acc.color as string) + '35' }}
                >
                  <button
                    type="button"
                    onClick={() => setAccountFilter(selected ? null : (acc.id as string))}
                    aria-pressed={selected}
                    title={selected ? 'Ver los movimientos de todas las cuentas' : `Ver solo los movimientos de ${acc.name}`}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <span
                      className="w-10 h-10 notch-sm flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: (acc.color as string) + '25', border: `1px solid ${(acc.color as string)}40` }}
                    >
                      <AppIcon name={typeInfo?.icon ?? 'debt'} size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold text-sm text-[#f3f5f6] truncate">{acc.name as string}</span>
                      <span className="block text-[11px] text-[#8a929a]">{typeInfo?.label ?? acc.type}{acc.isDefault ? ' · por defecto' : ''}</span>
                      <span className="block text-sm font-bold font-mono mt-0.5" style={{ color: acc.color }}>{formatCOP(acc.balance as number)}</span>
                    </span>
                  </button>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => openEditAcc(acc)} className="p-1.5 rounded-lg text-[#5f6a72] hover:text-brand-400 hover:bg-white/5 transition" title="Editar cuenta" aria-label={`Editar ${acc.name}`}>
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDeleteAcc(acc.id as string)} className="p-1.5 rounded-lg text-[#5f6a72] hover:text-red-400 hover:bg-red-500/10 transition" title="Eliminar cuenta" aria-label={`Eliminar ${acc.name}`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CurvedScrollContainer>

      {/* Right pane: the view tabs stay on top and only the content below scrolls (the same frame as Gastos Fijos) */}
      <div className="min-w-0 flex flex-col gap-5 lg:flex-1 lg:min-h-0">
        <div className="flex justify-center sm:justify-start flex-shrink-0">
          <div className="flex gap-1 p-1 bg-[#0d263a] border border-white/[0.06] rounded-xl text-xs overflow-x-auto scrollbar-none max-w-full">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => switchTab(key)}
                className={clsx(
                  'whitespace-nowrap px-4 py-2 rounded-lg font-medium transition',
                  activeTab === key ? 'bg-[#0a1f2f] text-white font-semibold border border-white/10 hover:border-brand-400/60 hover:bg-brand-500/10' : 'text-[#8a929a] hover:text-white',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <CurvedScrollContainer className="lg:flex-1 lg:min-h-0 rounded-3xl border border-white/10 bg-[#0a1f2f]/50" corners="bottom-right" {...paneProps}>
      {/* ── MOVIMIENTOS tab ────────────────────────────────────────────────── */}
      {activeTab === 'movimientos' && (
        <AccountMovements accounts={accounts} accountFilter={accountFilter} onAccountFilter={setAccountFilter} refreshKey={refreshKey} />
      )}

      {/* ── INGRESOS tab ───────────────────────────────────────────────────── */}
      {activeTab === 'ingresos' && (
        <div className="space-y-4 slide-up">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[#9aa4ac]">
                Ingresos este mes:{' '}
                <span className="font-bold text-brand-400 font-mono text-sm ml-1">
                  {formatCOP(totalMonthInc)}
                </span>
              </p>
            </div>
            <Button onClick={() => setOpenInc(true)} size="sm" notched={true}>
              <Plus size={15} /> Nuevo ingreso
            </Button>
          </div>

          {loadingInc ? (
            <SkeletonList count={3} />
          ) : incomes.length === 0 ? (
            <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-12 p-6">
              <EmptyMark name="cash" />
              <p className="text-sm font-bold text-[#f0fae8]">Sin ingresos registrados este mes</p>
              <p className="text-xs text-[#8a929a] mt-1">Registra tus entradas de dinero (salario, honorarios, etc.).</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {incomes.map((inc: any) => (
                <div
                  key={inc.id as string}
                  className="notch-sm flex items-start sm:items-center justify-between gap-2 p-3.5 bg-[#0a1f2f] border border-white/[0.08] hover:border-brand-500/30 transition-all group"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    <div className="w-10 h-10 notch-sm bg-brand-500/15 border border-brand-500/30 flex items-center justify-center flex-shrink-0 text-brand-300 glow-brand-sm">
                      <AppIcon name="cash" size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-semibold text-[#f0fae8] break-words sm:truncate">{inc.concept as string}</p>
                      <p className="text-[10px] text-[#8a929a] mt-0.5">
                        {format(inc.date instanceof Date ? inc.date : new Date(inc.date), 'dd MMMM yyyy', { locale: es })}
                      </p>
                      {(() => {
                        const acc = inc.accountId ? accounts.find((x: any) => x.id === inc.accountId) : null
                        return (
                          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[10px] text-[#9aa4ac]">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: acc ? (acc.color as string) : '#5f6a72' }} aria-hidden="true" />
                              {acc ? acc.name as string : inc.accountId ? 'Cuenta eliminada' : 'Sin cuenta asignada'}
                            </span>
                          </p>
                        )
                      })()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    {inc.attachmentId && <AttachmentButton compact attachmentId={inc.attachmentId as string} />}
                    <span className="text-xs sm:text-sm font-bold text-emerald-300 font-mono whitespace-nowrap">
                      +{formatCOP(inc.amount as number)}
                    </span>
                    <button
                      onClick={() => handleDeleteInc(inc.id as string)}
                      className="p-1.5 rounded-lg text-[#5f6a72] hover:text-red-400 hover:bg-red-500/10 transition"
                      title="Eliminar ingreso"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── AHORROS tab ────────────────────────────────────────────────────── */}
      {activeTab === 'ahorros' && (
        <div className="space-y-4 slide-up">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[#9aa4ac]">
                Ahorrado:{' '}
                <span className="font-bold text-brand-400 font-mono text-sm ml-1">
                  {formatCOP(totalSaved)}
                </span>{' '}
                <span className="text-[10px] text-[#8a929a]">de {formatCOP(totalTarget)}</span>
              </p>
            </div>
            <Button onClick={() => setOpenGoal(true)} size="sm" notched={true}>
              <Plus size={15} /> Nueva meta
            </Button>
          </div>

          {/* Global progress */}
          {goals.length > 0 && (
            <div className="notch bg-[#0a1f2f] border border-white/10 p-5 sm:p-6 space-y-3.5 shadow-xl">
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-[#c7ccd1] font-semibold">Progreso general de ahorro</span>
                <span className="font-bold text-brand-400 bg-brand-500/10 px-2.5 py-1 rounded-lg border border-brand-500/30">
                  {totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0}%
                </span>
              </div>
              <ProgressBar value={totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0} color="#52b69a" size="md" />
            </div>
          )}

          {loadingGls ? (
            <SkeletonList count={3} />
          ) : goals.length === 0 ? (
            <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-12 p-6 shadow-sm">
              <EmptyMark name="savings" />
              <p className="text-sm font-bold text-[#f0fae8]">Sin metas de ahorro</p>
              <p className="text-xs text-[#8a929a] mt-1">Crea tu primera meta de ahorro personal o compartida.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {goals.map((g: any) => {
                const pct = (g.targetAmount as number) > 0
                  ? Math.min(Math.round(((g.currentAmount as number) / (g.targetAmount as number)) * 100), 100)
                  : 0
                return (
                  <div
                    key={g.id as string}
                    className="notch-sm p-4 sm:p-5 bg-[#0a1f2f] border border-white/10 hover:border-white/30 hover:bg-[#133e5f] transition-all space-y-3.5 group shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-11 h-11 notch-sm flex items-center justify-center text-xl flex-shrink-0"
                          style={{ backgroundColor: (g.color as string) + '25', border: `1px solid ${(g.color as string)}40` }}
                        >
                          <AppIcon name={g.icon as string} size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-[#f3f5f6] group-hover:text-white transition-colors truncate">{g.name as string}</p>
                          <p className="text-xs text-[#8a929a] font-mono mt-0.5">
                            {formatCOP(g.currentAmount as number)} / {formatCOP(g.targetAmount as number)}
                          </p>
                        </div>
                      </div>
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-white/10 text-white border border-white/15" style={{ color: g.color }}>
                        {pct}%
                      </span>
                    </div>

                    <ProgressBar value={pct} color={g.color} size="md" />

                    <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                      <button
                        onClick={() => setAddMoneyGoal(g)}
                        className="rounded-lg px-3 py-1.5 bg-brand-500/15 hover:bg-brand-500/30 border border-brand-500/40 text-brand-300 hover:text-white font-semibold text-xs glow-brand-sm transition interactive-press"
                      >
                        + Abonar saldo
                      </button>
                      <button
                        onClick={() => handleDeleteGoal(g.id as string)}
                        className="p-1.5 rounded-lg text-[#5f6a72] hover:text-red-400 hover:bg-red-500/10 transition"
                        title="Eliminar meta"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

        </CurvedScrollContainer>
      </div>

      {/* ── MODALS ── */}

      <TransferModal open={moving} onClose={() => setMoving(false)} userId={user?.uid ?? ''} accounts={accounts} onDone={loadAccounts} />

      {/* Account Modal */}
      <Modal open={openAcc} onClose={() => setOpenAcc(false)} title={editAcc ? 'Editar Cuenta' : 'Nueva Cuenta'}>
        <form onSubmit={accForm.handleSubmit(onSubmitAcc)} className="space-y-4">
          <Input label="Nombre de la cuenta" placeholder="ej. Bancolombia, Nequi, Billetera…" {...accForm.register('name')} error={accForm.formState.errors.name?.message} />
          <Select label="Tipo" options={ACCOUNT_TYPES.map((t) => ({ value: t.value, label: t.label }))} {...accForm.register('type')} />
          <div className="rounded-xl border border-white/10 bg-[#0d263a] p-3 space-y-1">
            <p className="text-xs font-semibold text-[#c7ccd1]">
              Saldo{editAcc ? `: ${formatCOP(editAcc.balance as number)}` : ' inicial: $ 0'}
            </p>
            <p className="text-[11px] text-[#8a929a]">
              El saldo no se escribe: lo forman los ingresos que registres en esta cuenta, menos los pagos que salgan de ella, y lo que muevas entre cuentas.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#9aa4ac] mb-2">Color temático</p>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedColor(c)}
                  className={clsx(
                    'w-7 h-7 rounded-full transition-transform hover:scale-110',
                    selectedColor === c && 'ring-2 ring-offset-2 ring-offset-[#0a1f2f] ring-white scale-110',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenAcc(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={savingAcc} notched={true}>{savingAcc ? 'Guardando…' : 'Guardar Cuenta'}</Button>
          </div>
        </form>
      </Modal>

      {/* Income Modal */}
      <Modal open={openInc} onClose={() => setOpenInc(false)} title="Nuevo Ingreso">
        <form onSubmit={incForm.handleSubmit(onSubmitInc)} className="space-y-4">
          <Input label="Concepto" placeholder="ej. Sueldo quincena, Proyecto freelance…" {...incForm.register('concept')} error={incForm.formState.errors.concept?.message} />
          <Input label="Monto (COP)" money placeholder="0" {...incForm.register('amount')} error={incForm.formState.errors.amount?.message} />
          <Input label="Fecha" type="date" {...incForm.register('date')} />
          <AccountSelect label="¿A qué cuenta llegó?" accounts={accounts} value={incAccount} onChange={setIncAccount} noneLabel="Sin sumar a una cuenta" />
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenInc(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={savingInc} notched={true}>{savingInc ? 'Guardando…' : 'Guardar Ingreso'}</Button>
          </div>
        </form>
      </Modal>

      {/* Goal Modal */}
      <Modal open={openGoal} onClose={() => setOpenGoal(false)} title="Nueva Meta de Ahorro">
        <form onSubmit={goalForm.handleSubmit(onSubmitGoal)} className="space-y-4">
          <Input label="Nombre de la meta" placeholder="ej. Vacaciones, Entrada casa, Carro…" {...goalForm.register('name')} error={goalForm.formState.errors.name?.message} />
          <Input label="Monto objetivo (COP)" money placeholder="0" {...goalForm.register('targetAmount')} error={goalForm.formState.errors.targetAmount?.message} />
          <Input label="Monto inicial ahorrado (COP)" money placeholder="0" {...goalForm.register('currentAmount')} />
          <Input label="Fecha límite (opcional)" type="date" {...goalForm.register('deadline')} />
          <div>
            <p className="text-xs font-semibold text-[#9aa4ac] mb-2">Ícono representativo</p>
            <div className="flex gap-2 flex-wrap">
              {ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setSelectedIcon(ic)}
                  className={clsx(
                    'text-xl p-2 notch-sm transition border',
                    selectedIcon === ic ? 'bg-brand-500/20 border-brand-500/50 glow-brand-sm scale-110' : 'bg-[#0d263a] border-white/10 hover:border-white/20',
                  )}
                >
                  <AppIcon name={ic} size={18} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#9aa4ac] mb-2">Color</p>
            <div className="flex gap-2">
              {GOAL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedGoalColor(c)}
                  className={clsx(
                    'w-7 h-7 rounded-full transition-transform hover:scale-110',
                    selectedGoalColor === c && 'ring-2 ring-offset-2 ring-offset-[#0a1f2f] ring-white scale-110',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenGoal(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={savingGoal} notched={true}>{savingGoal ? 'Guardando…' : 'Crear Meta'}</Button>
          </div>
        </form>
      </Modal>

      {/* Add Money Modal */}
      <Modal open={!!addMoneyGoal} onClose={() => setAddMoneyGoal(null)} title={`Abonar a "${addMoneyGoal?.name ?? ''}"`}>
        <form onSubmit={addMoneyForm.handleSubmit(handleAddMoney)} className="space-y-4">
          <p className="text-xs text-[#9aa4ac]">
            Ahorrado actual: <strong className="text-brand-400 font-mono">{formatCOP(addMoneyGoal?.currentAmount ?? 0)}</strong> de <strong className="text-[#f3f5f6] font-mono">{formatCOP(addMoneyGoal?.targetAmount ?? 0)}</strong>
          </p>
          <Input label="Monto a abonar (COP)" money placeholder="0" {...addMoneyForm.register('amount')} error={addMoneyForm.formState.errors.amount?.message} />
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setAddMoneyGoal(null)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={savingGoal} notched={true}>{savingGoal ? 'Guardando…' : 'Confirmar Abono'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
