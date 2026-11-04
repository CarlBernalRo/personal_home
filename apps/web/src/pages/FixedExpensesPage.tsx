import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ChevronLeft, ChevronRight, CalendarCheck, CalendarCog, CalendarPlus, CalendarX2, Check, Pencil, RotateCcw, Settings, Trash2, X } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { IconTip } from '@/components/ui/IconTip'
import { IconActionButton } from '@/components/ui/IconActionButton'
import { ProgramExpenseModal } from '@/components/fixed/ProgramExpenseModal'
import { Select } from '@/components/ui/Select'
import { NotesCard, PaymentComment } from '@/components/fixed/NotesCard'
import { AttachmentButton } from '@/components/pending/AttachmentButton'
import { SkeletonList } from '@/components/ui/Skeleton'
import { SegmentedBar } from '@/components/ui/SegmentedBar'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAuth } from '@/hooks/useAuth'
import {
  getFixedExpenses, getAllFixedExpensePayments, updateFixedExpense,
  addFixedExpensePayments, deleteFixedExpensePayment, deleteFixedExpense, materializeAutoPayments, updateFixedExpensePayment,
} from '@/lib/firestore'
import {
  formatCOP, getStatus, indexPayments, paymentKey,
  amountFor, settingsFor, monthBounds, periodEntries, effectiveDue, withAutoPayments, planAutoPayments, monthKey, shiftMonth, type DueOverride, type MonthEntry, type OwedLine,
} from '@/shared'
import { FixedCalendar } from '@/components/fixed/FixedCalendar'
import { FixedTimeline } from '@/components/fixed/FixedTimeline'
import { SalaryPanel } from '@/components/salary/SalaryPanel'
import { MobileCollapse } from '@/components/ui/MobileCollapse'
import { CurvedScrollContainer } from '@/components/ui/CurvedScrollContainer'
import { useSalary } from '@/hooks/useSalary'
import { usePayProjection } from '@/hooks/usePayProjection'
import { useDefaultAccount } from '@/hooks/useDefaultAccount'
import { FIXED_DATA_CHANGED } from '@/hooks/useAutoDebits'
import { FixedOutlook } from '@/components/fixed/FixedOutlook'
import { AutoManualCard } from '@/components/fixed/AutoManualCard'
import { PausedNotesCard } from '@/components/fixed/PausedNotesCard'
import { FixedConfigPanel } from '@/components/fixed/FixedConfigPanel'
import { STATUS_META, PROGRESS_STATES, entryAccountId, entryStatusKey, statusGroup, type StatusKey } from '@/components/fixed/status'
import { AccountFilter } from '@/components/ui/AccountFilter'
import { VariableBudgetsCard } from '@/components/salary/VariableBudgetsCard'
import { useSearchParams } from 'react-router-dom'
import { usePeriodStore } from '@/store/period'
import { clsx } from 'clsx'
import { AppIcon, EmptyMark } from '@/components/ui/AppIcon'

type Tab = 'mes' | 'calendario' | 'config'

const TABS: { id: Tab; label: string }[] = [
  { id: 'mes',        label: 'Mes' },
  { id: 'calendario', label: 'Calendario' },
]

const paySchema = z.object({
  paymentDate: z.string().min(1, 'Fecha requerida'),
})
type PayForm = z.infer<typeof paySchema>

const monthLabelOf = (m: string) => {
  const [y, mm] = m.split('-').map(Number)
  return format(new Date(y, mm - 1, 1), 'MMM yyyy', { locale: es })
}

export default function FixedExpensesPage() {
  const { user }      = useAuth()
  const { showToast } = useToast()
  const ask           = useConfirm()
  const salary        = useSalary()

  const [params]                = useSearchParams()
  const [tab, setTab]           = useState<Tab>(params.get('tab') === 'config' ? 'config' : 'mes')
  const [expenses, setExpenses] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [selected, setSelected] = useState<{ fe: any; month: string; owed: OwedLine[] } | null>(null)
  // Owed months of the selected expense, and which of them the user is marking as paid
  const [lines, setLines]       = useState<OwedLine[]>([])
  const [checked, setChecked]   = useState<string[]>([])
  const [lineError, setLineError] = useState<string | null>(null)
  // Fixing a payment that was registered wrong (null = not editing)
  const [editPay, setEditPay] = useState<{ amount: string; date: string; accountId: string; comment: string } | null>(null)
  const [savingPay, setSavingPay] = useState(false)
  // State picked in the progress bar: the history shows only those payments (null = all)
  const [statusFilter, setStatusFilter] = useState<StatusKey | null>(null)
  // Account picked as a filter: the history shows only the payments that went through it (null = all)
  const [accountFilter, setAccountFilter] = useState<string | null>(null)
  // The dialog that schedules a one-off payment (editing = the scheduled one being changed)
  const [programming, setProgramming] = useState<{ editing: any | null } | null>(null)
  // Bank accounts the user can pay from, and the one picked for this payment ('' = none)
  const accounts = salary.accounts
  const [accountId, setAccountId] = useState('')
  // Comment left on the payment being registered (the expense's annotations are configured elsewhere)
  const [comment, setComment] = useState('')

  const today        = new Date()
  const currentMonth = monthKey(today)
  // A salary period belongs to the month of its last day (30 Oct–29 Nov is November), so that is
  // the month to open on once the salary is known
  const salaryMonth  = salary.currentPeriod ? monthKey(new Date(salary.currentPeriod.end.getTime() - 86_400_000)) : currentMonth
  // The month filter is shared with Gastos; until the user picks one it follows the salary period
  const pickedMonth  = usePeriodStore((s) => s.month)
  const setMonth     = usePeriodStore((s) => s.setMonth)
  const month        = pickedMonth ?? salaryMonth
  const payForm      = useForm<PayForm>({ resolver: zodResolver(paySchema) as any })

  async function load() {
    if (!user) return
    try {
      const [fxExp, fxPay] = await Promise.all([
        getFixedExpenses(user.uid),
        getAllFixedExpensePayments(user.uid),
        salary.reloadAccounts(),
      ])
      setExpenses(fxExp as any[])
      setPayments(fxPay as any[])
    } catch {
      showToast('Error al cargar los gastos fijos', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [user])
  // automatic debits saved by the app-wide task while this page is open
  useEffect(() => {
    window.addEventListener(FIXED_DATA_CHANGED, load)
    return () => window.removeEventListener(FIXED_DATA_CHANGED, load)
  }, [user])

  // Real payments plus the ones automatic debits made by themselves on their due date
  const paymentIndex = useMemo(() => indexPayments(withAutoPayments(expenses, payments, new Date())), [expenses, payments])
  const outlook      = usePayProjection(salary, expenses, paymentIndex)
  useDefaultAccount(salary, outlook ? outlook.cash : null)

  // Automatic debits become real payments that lower their account, once the account exists (older ones
  // were already counted in the account's opening balance, so only those due after it was created count)
  const storing = useRef(new Set<string>())
  useEffect(() => {
    if (!user || loading || !salary.accountsLoaded || accounts.length === 0) return
    const items = planAutoPayments(expenses, payments, accounts, new Date(), user.uid)
      .filter((p) => !storing.current.has(p.docId))
      .map((p) => ({ id: p.docId, data: { fixedExpenseId: p.fixedExpenseId, userId: p.userId, concept: p.concept, paidAmount: p.paidAmount, accountId: p.accountId, month: p.month, paymentDate: p.paymentDate, notes: '' } }))
    if (items.length === 0) return
    items.forEach((i) => storing.current.add(i.id))
    materializeAutoPayments(items.map((i) => i.data)).then(() => load()).catch(() => items.forEach((i) => storing.current.delete(i.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, expenses, payments, accounts, salary.accountsLoaded])

  // One entry per expense on its date; unpaid earlier months are folded into its amount
  // What the month covers: its salary period when there is one (30 Oct–29 Nov), else the calendar month
  const bounds = useMemo(() => monthBounds(month, salary.periods, salary.boundsSchedule), [month, salary.periods, salary.boundsSchedule])
  const rows = useMemo(
    () => periodEntries(expenses, month, bounds, paymentIndex, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, paymentIndex, month, bounds],
  )

  const shownAmount    = (r: MonthEntry<any>) => (r.owed.length > 0 ? r.total : (r.payment?.paidAmount ?? amountFor(r.fe, r.hostMonth)))
  const paidCount      = rows.filter((r) => r.owed.length === 0).length
  const totalPaid      = rows.reduce((s, r) => s + (r.owed.length === 0 ? (r.payment?.paidAmount ?? 0) : 0), 0)
  const totalEstimated = rows.reduce((s, r) => s + shownAmount(r), 0)
  const pctPaid        = rows.length ? Math.round((paidCount / rows.length) * 100) : 0
  // The period's payments by state, each with how many there are and how much they add up to
  // Same states and colors as the payment history below (STATUS_META): picking one filters it
  const progressParts = useMemo(() => {
    const parts = PROGRESS_STATES.map((key) => ({
      key,
      label: key === 'paid' ? 'Pagados' : key === 'auto' ? 'Pagados automáticos' : key === 'overdue' ? 'Vencidos' : key === 'due-soon' ? 'Por vencer' : key === 'pending' ? 'Pendientes' : 'Próximos',
      color: STATUS_META[key].dot,
      value: 0,
      count: 0,
    }))
    for (const r of rows) {
      const part = parts.find((p) => p.key === statusGroup(entryStatusKey(r)))
      if (!part) continue
      part.value += r.owed.length === 0 ? (r.payment?.paidAmount ?? 0) : r.total
      part.count += 1
    }
    // a state with nothing in it stays out, except the two that always matter
    return parts.filter((p) => p.count > 0 || p.key === 'paid' || p.key === 'overdue')
  }, [rows])
  const progressTotal = progressParts.reduce((sum, p) => sum + p.value, 0)

  const togglePicked = (key: StatusKey) => setStatusFilter((cur) => (cur === key ? null : key))
  // a filter belongs to the period it was picked in
  useEffect(() => { setStatusFilter(null); setAccountFilter(null) }, [month])

  function openSelection(entry: MonthEntry<any>) {
    const { fe, hostMonth, owed } = entry
    if (owed.length > 0) {
      const due = effectiveDue(fe, hostMonth)
      const defaultDate = hostMonth <= currentMonth || !due ? today : due
      payForm.reset({ paymentDate: format(defaultDate, 'yyyy-MM-dd') })
      setLines(owed.map((l) => ({ ...l })))
      setChecked(owed.map((l) => l.occMonth))
      setLineError(null)
      setComment('')
      // The expense's own account, else the one used last time, else where the salary goes
      setAccountId(salary.pickAccount(fe.accountId))
    }
    setSelected({ fe, month: hostMonth, owed })
  }

  // For a scheduled (one-off) expense: change the schedule itself, or remove it
  const scheduledIcons = selected?.fe.oneTime ? (
    <>
      <span className="w-px h-6 bg-white/15" aria-hidden="true" />
      <IconActionButton icon={CalendarCog} tone="edit" label="Editar el gasto programado: concepto, fecha, monto o cuenta" onClick={() => { const fe = selected.fe; setSelected(null); setProgramming({ editing: fe }) }} />
      <IconActionButton icon={CalendarX2} tone="danger" label="Eliminar el gasto programado (si ya lo pagaste, el pago se conserva)" onClick={() => deleteScheduled(selected.fe)} />
    </>
  ) : null

  // closing or switching payment leaves the correction form
  useEffect(() => { setEditPay(null) }, [selected])

  const selectedPayment = selected ? paymentIndex.get(paymentKey(selected.fe.id, selected.month)) : undefined

  async function onPay(data: PayForm) {
    if (!user || !selected) return
    const toPay = lines.filter((l) => checked.includes(l.occMonth))
    if (toPay.length === 0) {
      setLineError('Selecciona al menos un pago')
      return
    }
    if (toPay.some((l) => !(l.amount > 0))) {
      setLineError('Escribe cuánto pagaste (mayor a 0)')
      return
    }
    setSaving(true)
    try {
      const [y, m, d] = data.paymentDate.split('-').map(Number)
      // One payment per owed month, so each month keeps its own history
      await addFixedExpensePayments(toPay.map((l) => ({
        fixedExpenseId: selected.fe.id,
        userId:         user.uid,
        concept:        selected.fe.concept,
        paidAmount:     l.amount,
        ...(accountId ? { accountId } : {}),
        month:          l.occMonth,
        paymentDate:    new Date(y, m - 1, d),
        notes:          comment.trim(),
      })))
      salary.rememberAccount(accountId)
      setSelected(null)
      await load()
      showToast(toPay.length > 1 ? `${toPay.length} pagos registrados` : 'Pago registrado', 'success')
    } catch {
      showToast('Error al registrar pago', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Moves one occurrence (keyed by its original month) to another day/month; null restores it.
  async function handleMove(fe: any, occMonth: string, target: DueOverride | null) {
    const overrides: Record<string, DueOverride> = { ...(fe.dueOverrides ?? {}) }
    // Back on its regular date: drop the override instead of storing one identical to the base
    const unchanged = target && target.month === occMonth && target.day === settingsFor(fe, occMonth).paymentDay
    if (target && !unchanged) overrides[occMonth] = target
    else delete overrides[occMonth]
    try {
      await updateFixedExpense(fe.id, { dueOverrides: overrides })
      await load()
      showToast(target && !unchanged ? 'Fecha movida' : 'Fecha restablecida', 'edit')
    } catch (err) {
      showToast('Error al mover la fecha', 'error')
      throw err
    }
  }

  // A scheduled payment can be removed from its own dialog; what was already paid stays registered
  async function deleteScheduled(fe: any) {
    const wasPaid = [...paymentIndex.keys()].some((k) => k.startsWith(`${fe.id}|`))
    const ok = await ask(
      `¿Eliminar el gasto programado "${fe.concept}"?${wasPaid ? ' El pago que ya registraste se conserva.' : ''}`,
      { title: 'Eliminar gasto programado', confirmLabel: 'Eliminar' },
    )
    if (!ok) return
    try {
      await deleteFixedExpense(fe.id)
      setSelected(null)
      await load()
      showToast('Gasto programado eliminado', 'delete')
    } catch {
      showToast('No se pudo eliminar el gasto programado', 'error')
    }
  }

  // The payment is real (stored) unless it is an automatic debit that has not been stored yet
  const canEditPayment = !!selectedPayment && !String((selectedPayment as any).id ?? '').startsWith('auto|')

  function startEditPayment() {
    if (!selectedPayment) return
    const when = selectedPayment.paymentDate instanceof Date ? selectedPayment.paymentDate : new Date(selectedPayment.paymentDate)
    setEditPay({ amount: String(selectedPayment.paidAmount), date: format(when, 'yyyy-MM-dd'), accountId: ((selectedPayment as any).accountId as string | undefined) ?? '', comment: (selectedPayment as any).notes ?? '' })
  }

  async function saveEditPayment() {
    if (!selectedPayment || !editPay) return
    const amount = Number(editPay.amount)
    if (!(amount > 0)) { showToast('Escribe un monto mayor a 0', 'error'); return }
    if (!editPay.date) { showToast('Elige la fecha de pago', 'error'); return }
    const [y, m, d] = editPay.date.split('-').map(Number)
    setSavingPay(true)
    try {
      await updateFixedExpensePayment(
        (selectedPayment as any).id,
        { paidAmount: amount, paymentDate: new Date(y, m - 1, d), accountId: editPay.accountId || undefined, notes: editPay.comment.trim() },
        { paidAmount: selectedPayment.paidAmount, accountId: (selectedPayment as any).accountId },
      )
      setEditPay(null)
      setSelected(null)
      await load()
      showToast('Pago corregido', 'edit')
    } catch {
      showToast('No se pudo corregir el pago', 'error')
    } finally {
      setSavingPay(false)
    }
  }

  async function handleUnpay() {
    if (!selectedPayment || (selectedPayment as any).auto) return
    try {
      const accId = (selectedPayment as any).accountId as string | undefined
      // The money goes back to the account it came out of, if that account still exists
      await deleteFixedExpensePayment(
        selectedPayment.id,
        accId && accounts.some((a) => a.id === accId) ? { accountId: accId, amount: selectedPayment.paidAmount } : undefined,
      )
      setSelected(null)
      await load()
      showToast('Pago eliminado', 'delete')
    } catch {
      showToast('Error al eliminar el pago', 'error')
    }
  }

  const [my, mm] = month.split('-').map(Number)
  const monthLabel = format(new Date(my, mm - 1, 1), 'MMMM yyyy', { locale: es })

  return (
    <div className="flex flex-col gap-5 fade-in text-[#f3f5f6] lg:flex-row lg:h-full lg:min-h-0">
      {/* Wide screens: the left pane (title + salary cards) never moves with the page, and the right
          pane keeps its header (view tabs, month selector, configuration) fixed while only the
          content below it scrolls. On small screens everything stacks and scrolls normally. */}
      <div className="contents">
        <CurvedScrollContainer
          className="lg:w-[32%] lg:min-w-[340px] lg:max-w-[560px] lg:flex-shrink-0 lg:min-h-0 rounded-3xl border border-white/10 bg-[#0a1f2f]/50"
          contentClassName="max-lg:!overflow-visible space-y-5 py-3 !pl-3 !pr-3 lg:py-4 lg:!pl-4 lg:!pr-6"
          corners="both"
          borderRadius={24}
          offset={7}
          variant="plain"
          themeColor="brand"
        >
        <div>
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 notch-sm bg-white/[0.04] border border-white/[0.08]">
            <CalendarCheck size={11} className="text-brand-400" />
            <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest">Recurrente</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Gastos Fijos</h1>
        </div>
          <MobileCollapse title="Sueldo y dinero en cuenta" openWhen={!!salary.pending}>
            <SalaryPanel salary={salary} expenses={expenses} paymentIndex={paymentIndex} />
            {outlook && <FixedOutlook cash={outlook.cash} projection={outlook.projection} />}
          </MobileCollapse>
          <MobileCollapse title="Proyección, débitos y pausados">
            {outlook && <AutoManualCard projection={outlook.projection} />}
            <PausedNotesCard expenses={expenses} onManage={() => setTab('config')} />
          </MobileCollapse>
        </CurvedScrollContainer>

        <div className="min-w-0 flex flex-col gap-5 lg:flex-1 lg:min-h-0">
          {/* Filters: view tabs, month selector and the configuration icon */}
          <div className="flex flex-wrap items-center justify-center gap-3 flex-shrink-0 sm:grid sm:grid-cols-[1fr_auto_1fr]">
            <div className="flex gap-1 p-1 basis-full justify-center sm:basis-auto sm:justify-self-start bg-[#0d263a] border border-white/[0.06] rounded-xl text-xs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    'whitespace-nowrap px-4 py-2 rounded-lg font-medium transition',
                    tab === t.id ? 'bg-[#0a1f2f] text-white font-semibold border border-white/10 hover:border-brand-400/60 hover:bg-brand-500/10' : 'text-[#8a929a] hover:text-white',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab !== 'config' ? (
              <div className="flex items-center justify-center gap-1.5">
                <>
                  <button onClick={() => setMonth(shiftMonth(month, -1))} className="p-2 rounded-lg bg-[#0d263a] border border-white/10 hover:bg-white/10 transition" aria-label="Mes anterior">
                    <ChevronLeft size={16} />
                  </button>
                  <span className="min-w-[140px] text-center">
                    <span className="block text-sm font-semibold capitalize">{monthLabel}</span>
                    {/* the Mes tab speaks in pay periods; the calendar is a calendar month */}
                    {tab === 'mes' && bounds.period && (
                      <span className="block text-[10px] text-[#8a929a]">
                        {format(bounds.start, "d MMM", { locale: es })} al {format(new Date(bounds.end.getTime() - 86_400_000), "d MMM", { locale: es })}
                      </span>
                    )}
                    {month !== salaryMonth && (
                      <button
                      type="button"
                      onClick={() => setMonth(null)}
                      className="mt-1 inline-flex items-center gap-1 rounded-full border border-brand-400/40 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-200 hover:bg-brand-500/20 transition"
                >
                      <RotateCcw size={10} aria-hidden="true" /> Volver a hoy
                </button>
                    )}
                  </span>
                  <button onClick={() => setMonth(shiftMonth(month, 1))} className="p-2 rounded-lg bg-[#0d263a] border border-white/10 hover:bg-white/10 transition" aria-label="Mes siguiente">
                    <ChevronRight size={16} />
                  </button>
                </>
              </div>
            ) : <span className="hidden sm:block" />}
              <div className="flex items-center gap-2 sm:justify-self-end">
              <IconTip text="Programar un gasto: un pago de una sola vez en una fecha (matrícula, cuota anual…)" className="inline-flex">
                <button
                  type="button"
                  onClick={() => setProgramming({ editing: null })}
                  aria-label="Programar un gasto"
                  className="p-2 rounded-lg border bg-[#0d263a] border-white/10 text-[#c7ccd1] hover:bg-white/10 hover:text-white transition"
                >
                  <CalendarPlus size={16} />
                </button>
              </IconTip>
              <button
                onClick={() => setTab(tab === 'config' ? 'mes' : 'config')}
                title="Configuración de gastos"
                aria-label="Configuración de gastos"
                aria-pressed={tab === 'config'}
                className={clsx(
                  'p-2 rounded-lg border transition sm:justify-self-end',
                  tab === 'config' ? 'bg-brand-500/20 border-brand-400/60 text-brand-200' : 'bg-[#0d263a] border-white/10 text-[#c7ccd1] hover:bg-white/10 hover:text-white',
                )}
              >
                <Settings size={16} />
              </button>
              </div>
          </div>

          {/* One card: the month progress stays fixed on top; only the content below scrolls */}
          <div className="flex flex-col rounded-3xl border border-white/10 bg-[#0a1f2f]/50 lg:flex-1 lg:min-h-0">
          {!loading && tab === 'mes' && rows.length > 0 && (
            <div className="flex-shrink-0 border-b border-white/10">
              <div className="p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Progreso del período</p>
                      <span className="font-mono text-xs font-bold text-brand-400 bg-brand-500/10 px-2.5 py-1 rounded-lg border border-brand-500/30">
                        {paidCount} / {rows.length} pagados ({pctPaid}%)
                      </span>
                    </div>
                    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                      <p className="text-xs text-[#9aa4ac]">
                        Pagado <span className="font-mono text-base font-bold text-brand-300">{formatCOP(totalPaid)}</span>
                        <span className="font-mono text-[#8a929a]"> de {formatCOP(totalEstimated)}</span>
                      </p>
                      <p className="text-xs text-[#9aa4ac]">
                        Falta pagar <span className={clsx('font-mono text-base font-bold', totalEstimated - totalPaid > 0 ? 'text-[#f0fae8]' : 'text-brand-300')}>{formatCOP(Math.max(0, totalEstimated - totalPaid))}</span>
                      </p>
                    </div>
                    <SegmentedBar
                      label="Estado de los pagos del período"
                      parts={progressParts}
                      total={progressTotal}
                      activeKey={statusFilter}
                      onSelect={(key) => togglePicked(key as StatusKey)}
                    />
                    <ul className="flex flex-wrap gap-x-2 gap-y-1.5">
                      {progressParts.map((p) => (
                        <li key={p.key}>
                          <button
                            type="button"
                            onClick={() => togglePicked(p.key)}
                            aria-pressed={statusFilter === p.key}
                            title={statusFilter === p.key ? 'Quitar el filtro' : `Ver solo ${p.label.toLowerCase()}`}
                            className={clsx(
                              'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition',
                              statusFilter === p.key ? 'border-white/40 bg-white/10' : 'border-transparent hover:bg-white/5',
                              p.count === 0 && statusFilter !== p.key && 'opacity-40',
                            )}
                          >
                            <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ backgroundColor: p.color }} aria-hidden="true" />
                            <span className="text-[#c7ccd1]">{p.label}</span>
                            <span className="font-mono text-[#9aa4ac]">{p.count} · {formatCOP(p.value)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {accounts.length > 0 && (
                      <AccountFilter accounts={accounts} value={accountFilter} onChange={setAccountFilter} hasUnassigned={rows.some((r) => !entryAccountId(r))} />
                    )}
                    {statusFilter && (
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-white/15 bg-white/5 px-3 py-2">
                        <p className="text-xs text-[#c7ccd1]">
                          Mostrando solo <span className="font-semibold" style={{ color: STATUS_META[statusFilter].dot }}>{STATUS_META[statusFilter].label.toLowerCase()}</span> en el historial
                        </p>
                        <button type="button" onClick={() => setStatusFilter(null)} className="flex items-center gap-1 text-[11px] font-semibold text-brand-300 hover:text-brand-200 transition flex-shrink-0">
                          <X size={12} aria-hidden="true" /> Quitar filtro
                        </button>
                      </div>
                    )}
                  </div>
            </div>
          )}

      <CurvedScrollContainer
        className="lg:flex-1 lg:min-h-0"
        contentClassName="max-lg:!overflow-visible space-y-5 py-3 !pl-3 !pr-3 lg:py-4 lg:!pl-4 lg:!pr-6"
        corners={!loading && tab === 'mes' && rows.length > 0 ? 'bottom-right' : 'both'}
        borderRadius={24}
        offset={7}
        variant="plain"
        themeColor="brand"
      >
      {loading ? (
        <SkeletonList count={4} />
      ) : (
        <>
          {tab === 'mes' && (
            <div className="space-y-4">
              {rows.length === 0 ? (
                <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-12 px-6">
                  <EmptyMark name="list" />
                  <p className="text-sm font-bold text-[#f0fae8]">
                    {expenses.length === 0 ? 'Sin gastos fijos configurados' : 'No hay gastos fijos en este período'}
                  </p>
                  <p className="text-xs text-[#8a929a] mt-1">
                    {expenses.length === 0 ? 'Ve a Configuración para crearlos o importar tu lista.' : 'Revisa el mes de inicio de cada gasto en Configuración.'}
                  </p>
                  {expenses.length === 0 && (
                    <Button size="sm" className="mt-4" onClick={() => setTab('config')}>Ir a Configuración</Button>
                  )}
                </div>
              ) : (
                <FixedTimeline month={month} bounds={bounds} expenses={expenses} paymentIndex={paymentIndex} onSelect={openSelection} periods={salary.periods} extras={salary.extras} variable={salary.variable} statusFilter={statusFilter} accounts={accounts} accountFilter={accountFilter} onClearFilter={() => { setStatusFilter(null); setAccountFilter(null) }} top={month === salaryMonth ? <VariableBudgetsCard salary={salary} /> : undefined} />
              )}
            </div>
          )}

          {tab === 'calendario' && (
            <FixedCalendar month={month} expenses={expenses} paymentIndex={paymentIndex} onSelect={openSelection} onMove={handleMove} variable={salary.variable} />
          )}

          {tab === 'config' && user && (
            <>
              <FixedConfigPanel userId={user.uid} expenses={expenses} paymentIndex={paymentIndex} salary={salary} onChanged={load} onProgram={(fe) => setProgramming({ editing: fe ?? null })} />
            </>
          )}
        </>
      )}
      </CurvedScrollContainer>
          </div>

        </div>
      </div>

      <ProgramExpenseModal
        open={!!programming}
        onClose={() => setProgramming(null)}
        userId={user?.uid ?? ''}
        editing={programming?.editing ?? null}
        accounts={accounts}
        defaultAccount={salary.pickAccount()}
        paid={!!programming?.editing && [...paymentIndex.keys()].some((k) => k.startsWith(`${programming.editing.id}|`))}
        onSaved={load}
      />

      {/* Pay / detail modal */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.fe.concept} · ${monthLabelOf(selected.month)}` : ''}
      >
        {selected && selected.owed.length === 0 && selectedPayment ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-brand-300 text-sm font-semibold">
                <Check size={16} /> {(selectedPayment as any).auto ? 'Pagado automáticamente' : 'Pagado'}
              </div>
              <div className="flex items-center gap-2">
                {canEditPayment && !editPay && <IconActionButton icon={Pencil} tone="edit" label="Editar este pago: corregir monto, fecha o cuenta" onClick={startEditPayment} />}
                {!(selectedPayment as any).auto && !editPay && <IconActionButton icon={Trash2} tone="danger" label="Eliminar este pago: vuelve a quedar pendiente y la cuenta recupera el dinero" onClick={handleUnpay} />}
                {scheduledIcons}
              </div>
            </div>
            {(selectedPayment as any).auto && (
              <p className="text-xs text-cyan-200">
                Este gasto se debita automáticamente de tu cuenta: se marcó como pagado el día de pago.
              </p>
            )}
            {editPay ? (
              <div className="space-y-3 rounded-xl border border-brand-400/30 bg-brand-500/5 p-3">
                <p className="text-xs font-semibold text-brand-200">Corregir este pago</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input label="Monto pagado (COP)" money value={editPay.amount} onChange={(e) => setEditPay({ ...editPay, amount: e.target.value })} />
                  <Input label="Fecha de pago" type="date" value={editPay.date} onChange={(e) => setEditPay({ ...editPay, date: e.target.value })} />
                </div>
                <AccountSelect label="Cuenta de la que salió" accounts={accounts} value={editPay.accountId} onChange={(id) => setEditPay({ ...editPay, accountId: id })} noneLabel="Sin cuenta" />
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#9aa4ac] block">Comentario del pago</label>
                  <textarea
                    value={editPay.comment}
                    onChange={(e) => setEditPay({ ...editPay, comment: e.target.value })}
                    rows={2}
                    maxLength={500}
                    placeholder="Opcional"
                    className="w-full bg-[#0d263a] border border-white/10 rounded-xl px-3 py-2 text-sm text-[#f3f5f6] placeholder-[#5f6a72] outline-none focus:border-brand-400 transition resize-y"
                  />
                </div>
                <p className="text-[10px] text-[#8a929a]">El saldo de las cuentas se ajusta solo: si cambias el monto o la cuenta, la anterior recupera lo que corresponde y la nueva lo paga.</p>
                <div className="flex items-center justify-end gap-2">
                  <IconActionButton icon={X} tone="warning" label="Cancelar: no cambiar el pago" onClick={() => setEditPay(null)} disabled={savingPay} />
                  <IconActionButton icon={Check} tone="success" label={savingPay ? 'Guardando…' : 'Guardar la corrección del pago'} onClick={saveEditPayment} disabled={savingPay} />
                </div>
              </div>
            ) : (
              <p className="text-sm font-mono">
                {formatCOP(selectedPayment.paidAmount)} el{' '}
                {format(selectedPayment.paymentDate instanceof Date ? selectedPayment.paymentDate : new Date(selectedPayment.paymentDate), "d 'de' MMMM yyyy", { locale: es })}
              </p>
            )}
            <p className="text-xs text-[#9aa4ac]">
              Estimado: <span className="font-mono">{formatCOP(amountFor(selected.fe, selected.month))}</span>
            </p>
            {(selectedPayment as any).accountId && (
              <p className="text-xs text-[#9aa4ac]">
                Pagado desde: <span className="font-semibold text-[#f3f5f6]">{accounts.find((a) => a.id === (selectedPayment as any).accountId)?.name ?? 'una cuenta que ya no existe'}</span>
              </p>
            )}
            <NotesCard notes={(expenses.find((e) => e.id === selected.fe.id) ?? selected.fe).notes} />
            {!editPay && <PaymentComment comment={(selectedPayment as any).notes} />}
            {!editPay && (selectedPayment as any).attachmentId && <AttachmentButton attachmentId={(selectedPayment as any).attachmentId} />}
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setSelected(null)}>Cerrar</Button>
            </div>
          </div>
        ) : selected ? (
          <form onSubmit={payForm.handleSubmit(onPay)} className="space-y-4">
            {selected.fe.oneTime && <div className="flex items-center justify-end gap-2">{scheduledIcons}</div>}
            <div className="space-y-2">
              <p className="text-xs text-[#9aa4ac]">
                {lines.length > 1 ? 'Marca los pagos que vas a registrar como pagados:' : 'Se registrará este pago:'}
              </p>
              {lines.map((l) => {
                const isChecked = checked.includes(l.occMonth)
                return (
                  <label
                    key={l.occMonth}
                    className={clsx(
                      'flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border cursor-pointer select-none transition',
                      isChecked ? 'bg-brand-500/10 border-brand-500/40' : 'bg-[#0d263a] border-white/10',
                    )}
                  >
                    <span className="flex items-center gap-2.5 text-sm text-[#f3f5f6] capitalize">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setLineError(null)
                          setChecked((prev) => prev.includes(l.occMonth) ? prev.filter((m) => m !== l.occMonth) : [...prev, l.occMonth])
                        }}
                      />
                      {monthLabelOf(l.occMonth)}
                    </span>
                    {/* only an expense configured with a variable amount lets you type what was really paid */}
                    {selected.fe.isVariable ? (
                      <MoneyInput
                        aria-label={`Valor pagado de ${monthLabelOf(l.occMonth)}`}
                        placeholder="0"
                        value={l.amount || ''}
                        onChange={(e) => {
                          setLineError(null)
                          const amount = Number(e.target.value) || 0
                          setLines((prev) => prev.map((x) => (x.occMonth === l.occMonth ? { ...x, amount } : x)))
                        }}
                        className="w-32 rounded-lg border border-brand-500/30 bg-[#0a1f2f] px-2.5 py-1.5 text-right text-sm font-mono tabular-nums text-white outline-none focus:border-brand-500"
                      />
                    ) : (
                      <span className="font-mono text-sm tabular-nums">{formatCOP(l.amount)}</span>
                    )}
                  </label>
                )
              })}
              <p className="text-xs text-[#c7ccd1] font-mono flex justify-between border-t border-white/10 pt-2">
                <span>Total a pagar</span>
                <strong className="text-[#f3f5f6]">
                  {formatCOP(lines.filter((l) => checked.includes(l.occMonth)).reduce((sum, l) => sum + l.amount, 0))}
                </strong>
              </p>
              {selected.fe.isVariable && (
                <p className="text-[11px] text-amber-200/90">Monto variable: escribe lo que realmente pagaste en cada mes (el estimado de este mes es {formatCOP(amountFor(selected.fe, selected.month))}).</p>
              )}
              {lineError && <p className="text-xs text-red-400">{lineError}</p>}
            </div>
            {accounts.length > 0 ? (
              <div className="space-y-1">
                <Select
                  label="¿De qué cuenta sale el dinero?"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  options={[
                    ...accounts.map((a) => ({ value: a.id as string, label: `${a.name} · ${formatCOP(a.balance as number)}` })),
                    { value: '', label: 'Sin descontar de una cuenta' },
                  ]}
                />
                {(() => {
                  const acc = accounts.find((a) => a.id === accountId)
                  const total = lines.filter((l) => checked.includes(l.occMonth)).reduce((sum, l) => sum + l.amount, 0)
                  if (!acc) return null
                  return acc.balance < total
                    ? <p className="text-[11px] text-red-300">Esta cuenta tiene {formatCOP(acc.balance)} y el pago es de {formatCOP(total)}: quedaría en negativo.</p>
                    : <p className="text-[11px] text-[#8a929a]">Le quedarán {formatCOP(acc.balance - total)}.</p>
                })()}
              </div>
            ) : (
              <p className="text-[11px] text-[#8a929a]">Agrega tus cuentas en Finanzas para elegir de cuál sale cada pago.</p>
            )}
            <Input
              label="Fecha de pago"
              type="date"
              {...payForm.register('paymentDate')}
              error={payForm.formState.errors.paymentDate?.message}
            />
            <NotesCard notes={(expenses.find((e) => e.id === selected.fe.id) ?? selected.fe).notes} />
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#9aa4ac] block">Comentario del pago <span className="font-normal text-[#5f6a72]">(opcional)</span></label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="ej. pagué con retraso, referencia del recibo…"
                className="w-full bg-[#0d263a] border border-white/10 rounded-xl px-3 py-2 text-sm text-[#f3f5f6] placeholder-[#5f6a72] outline-none focus:border-brand-400 transition resize-y"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setSelected(null)}>Cancelar</Button>
              <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Confirmando…' : checked.length > 1 ? 'Pagar seleccionados' : 'Confirmar pago'}</Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  )
}
