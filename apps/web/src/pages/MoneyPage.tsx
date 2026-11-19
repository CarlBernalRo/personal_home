import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import {
  ArrowLeftRight, Banknote, Bell, CalendarDays, Heart, CalendarPlus, ChevronLeft, ChevronRight, List, Plus, RotateCcw, Settings, ShoppingBag, Wallet, X,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SkeletonList } from '@/components/ui/Skeleton'
import { SegmentedBar } from '@/components/ui/SegmentedBar'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { MobileCollapse } from '@/components/ui/MobileCollapse'
import { CurvedScrollContainer } from '@/components/ui/CurvedScrollContainer'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { AppIcon } from '@/components/ui/AppIcon'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAuth } from '@/hooks/useAuth'
import { useSalary } from '@/hooks/useSalary'
import { usePayProjection } from '@/hooks/usePayProjection'
import { useDefaultAccount } from '@/hooks/useDefaultAccount'
import { useHouseholdOwed } from '@/hooks/useHouseholdOwed'
import { useMyHouseholds } from '@/hooks/useMyHouseholds'
import { FIXED_DATA_CHANGED } from '@/hooks/useAutoDebits'
import { useLayoutStore } from '@/store/layout'
import { usePeriodStore } from '@/store/period'
import {
  getAccountTransfers, getAllFixedExpensePayments, getFixedExpenses, materializeAutoPayments, updateFixedExpense,
} from '@/lib/firestore'
import {
  PERSONAL_CATEGORIES, formatCOP, reminderDates, type Reminder, indexPayments, monthBounds, monthKey, periodEntries, planAutoPayments, settingsFor, shiftMonth, withAutoPayments,
  type DueOverride, type MonthEntry,
} from '@/shared'
import { SalaryPanel } from '@/components/salary/SalaryPanel'
import { VariableBudgetsCard } from '@/components/salary/VariableBudgetsCard'
import { FixedOutlook } from '@/components/fixed/FixedOutlook'
import { AutoManualCard } from '@/components/fixed/AutoManualCard'
import { PausedNotesCard } from '@/components/fixed/PausedNotesCard'
import { FixedConfigPanel } from '@/components/fixed/FixedConfigPanel'
import { FixedCalendar } from '@/components/fixed/FixedCalendar'
import { FixedPaymentModal } from '@/components/fixed/FixedPaymentModal'
import { ProgramExpenseModal } from '@/components/fixed/ProgramExpenseModal'
import { TransferModal } from '@/components/fixed/TransferModal'
import { STATUS_META, PROGRESS_STATES, entryAccountId, entryStatusKey, statusGroup, type StatusKey } from '@/components/fixed/status'
import { buildExpenseRows } from '@/components/expenses/rows'
import { ExpenseFormModal, type EditableSpend } from '@/components/money/ExpenseFormModal'
import { IncomeFormModal } from '@/components/money/IncomeFormModal'
import { MovementDetailModal } from '@/components/money/MovementDetailModal'
import { SharedFixedModal } from '@/components/money/SharedFixedModal'
import { ReminderDetailModal, ReminderFormModal } from '@/components/money/ReminderModals'
import { subscribeReminders } from '@/lib/reminders'
import { Avatar } from '@/components/ui/Avatar'
import { useFamily } from '@/hooks/useFamily'
import { FamilyTransferModal } from '@/components/money/FamilyTransferModal'
import { getSharedWithMe, withdrawFamilyTransfer } from '@/lib/family'
import { FLOW_KINDS, MoneyTimeline, flowKind, type FlowItem, type FlowKind, type TimelineEntry } from '@/components/money/MoneyTimeline'

type View = 'list' | 'calendar' | 'config'

const asDate = (d: unknown) => (d instanceof Date ? d : new Date(d as any))
const categoryOf = (id?: string) => PERSONAL_CATEGORIES.find((c) => c.id === id)

/**
 * Mi dinero: everything about the personal money in one place, by pay period. Incomes, fixed expenses (pay them
 * from here), occasional and additional spends, household abonos and transfers in one timeline that can be
 * narrowed by kind, state, account and category; the salary, the period's summary and the fixed expenses' progress
 * on the left; the calendar and the fixed expenses' configuration one click away.
 */
export default function MoneyPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const ask = useConfirm()
  const salary = useSalary()
  const household = useHouseholdOwed(true)
  const householdList = useMyHouseholds(true)
  const leftCollapsed = useLayoutStore((s) => s.leftCollapsed)
  const [params, setParams] = useSearchParams()
  const { family } = useFamily()
  // what family members share with me: their fixed expenses join my timeline, with their face, read only
  const [shared, setShared] = useState<{ expenses: any[]; payments: any[] }>({ expenses: [], payments: [] })
  const familyKey = family ? JSON.stringify([family.id, [...family.members].sort(), family.shares]) : ''
  useEffect(() => {
    if (!user || !family || family.members.length < 2) { setShared({ expenses: [], payments: [] }); return }
    getSharedWithMe(user.uid).then(setShared).catch(() => setShared({ expenses: [], payments: [] }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, familyKey])
  const [sharedSel, setSharedSel] = useState<TimelineEntry | null>(null)
  // reminders: mine and the ones family members share with me (live)
  const [reminders, setReminders] = useState<Reminder[]>([])
  useEffect(() => { if (user) return subscribeReminders(user.uid, setReminders) }, [user])
  const [reminderForm, setReminderForm] = useState<{ editing: Reminder | null } | null>(null)
  const [reminderSel, setReminderSel] = useState<{ reminder: Reminder; date: string } | null>(null)

  // ── Fixed expenses and their payments ───────────────────────────────────────
  const [expenses, setExpenses] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [loadingFixed, setLoadingFixed] = useState(true)
  async function loadFixed() {
    if (!user) return
    try {
      const [fx, pay] = await Promise.all([getFixedExpenses(user.uid), getAllFixedExpensePayments(user.uid), salary.reloadAccounts()])
      setExpenses(fx as any[])
      setPayments(pay as any[])
    } catch {
      showToast('Error al cargar los gastos fijos', 'error')
    } finally {
      setLoadingFixed(false)
    }
  }
  useEffect(() => { loadFixed() }, [user]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.addEventListener(FIXED_DATA_CHANGED, loadFixed)
    return () => window.removeEventListener(FIXED_DATA_CHANGED, loadFixed)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const paymentIndex = useMemo(() => indexPayments(withAutoPayments(expenses, payments, new Date())), [expenses, payments])
  const outlook = usePayProjection(salary, expenses, paymentIndex)
  useDefaultAccount(salary, outlook ? outlook.computedCash : null)

  // Automatic debits become real payments that lower their account, once the account exists
  const storing = useRef(new Set<string>())
  useEffect(() => {
    if (!user || loadingFixed || !salary.accountsLoaded || salary.accounts.length === 0) return
    const items = planAutoPayments(expenses, payments, salary.accounts, new Date(), user.uid)
      .filter((p) => !storing.current.has(p.docId))
      .map((p) => {
        const shared = (expenses.find((e) => e.id === p.fixedExpenseId)?.sharedWith ?? []) as string[]
        return { id: p.docId, data: { fixedExpenseId: p.fixedExpenseId, userId: p.userId, concept: p.concept, paidAmount: p.paidAmount, accountId: p.accountId, month: p.month, paymentDate: p.paymentDate, notes: '', ...(shared.length ? { sharedWith: shared } : {}) } }
      })
    if (items.length === 0) return
    items.forEach((i) => storing.current.add(i.id))
    materializeAutoPayments(items.map((i) => i.data)).then(() => loadFixed()).catch(() => items.forEach((i) => storing.current.delete(i.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loadingFixed, expenses, payments, salary.accounts, salary.accountsLoaded])

  // ── Transfers between accounts ──────────────────────────────────────────────
  const [transfers, setTransfers] = useState<any[]>([])
  const loadTransfers = () => { if (user) getAccountTransfers(user.uid).then((t) => setTransfers(t as any[])).catch(() => setTransfers([])) }
  useEffect(loadTransfers, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Period ──────────────────────────────────────────────────────────────────
  const today = new Date()
  const currentMonth = monthKey(today)
  const salaryMonth = salary.currentPeriod ? monthKey(new Date(salary.currentPeriod.end.getTime() - 86_400_000)) : currentMonth
  const pickedMonth = usePeriodStore((s) => s.month)
  const setMonth = usePeriodStore((s) => s.setMonth)
  const month = pickedMonth ?? salaryMonth
  const bounds = useMemo(() => monthBounds(month, salary.periods, salary.boundsSchedule), [month, salary.periods, salary.boundsSchedule])
  const inBounds = (d: Date) => d.getTime() >= bounds.start.getTime() && d.getTime() < bounds.end.getTime()
  const [my, mm] = month.split('-').map(Number)
  const monthLabel = format(new Date(my, mm - 1, 1), 'MMMM yyyy', { locale: es })

  // ── View and filters (the URL can open a view or a filter: the old screens and Finanzas link here) ──
  const view: View = params.get('vista') === 'config' ? 'config' : params.get('vista') === 'calendario' ? 'calendar' : 'list'
  const setView = (v: View) => {
    const next = new URLSearchParams(params)
    if (v === 'list') next.delete('vista'); else next.set('vista', v === 'config' ? 'config' : 'calendario')
    setParams(next, { replace: true })
  }
  const [kinds, setKinds] = useState<FlowKind[]>(() => {
    const t = params.get('tipo') as FlowKind | null
    return t && FLOW_KINDS.some((k) => k.id === t) ? [t] : []
  })
  const [statusFilter, setStatusFilter] = useState<StatusKey | null>(null)
  const [accountFilter, setAccountFilter] = useState<string[]>(() => (params.get('cuenta') ? [params.get('cuenta')!] : []))
  const [categories, setCategories] = useState<string[]>([])
  // whose movements: 'me' and/or family members (empty = everybody)
  const [people, setPeople] = useState<string[]>([])
  const wantPerson = (who: string) => people.length === 0 || people.includes(who)
  const toggleCategory = (c: string) => setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  const clearFilters = () => { setKinds([]); setStatusFilter(null); setAccountFilter([]); setCategories([]); setPeople([]) }
  // the state of the fixed expenses belongs to the period it was picked in
  useEffect(() => { setStatusFilter(null) }, [month])
  // a filter that came in the URL is applied once; the URL is then cleaned so a reload starts fresh
  useEffect(() => {
    if (!params.get('tipo') && !params.get('cuenta')) return
    const next = new URLSearchParams(params)
    next.delete('tipo'); next.delete('cuenta')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Dialogs ─────────────────────────────────────────────────────────────────
  const [payEntry, setPayEntry] = useState<MonthEntry<any> | null>(null)
  const [detail, setDetail] = useState<FlowItem | null>(null)
  const [programming, setProgramming] = useState<{ editing: any | null } | null>(null)
  const [spendForm, setSpendForm] = useState<{ editing: EditableSpend | null } | null>(null)
  const [incomeOpen, setIncomeOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [familyTransferOpen, setFamilyTransferOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  // ── The period's fixed expenses ─────────────────────────────────────────────
  const rows = useMemo(
    () => periodEntries(expenses, month, bounds, paymentIndex, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, paymentIndex, month, bounds],
  )
  const shownAmount = (r: MonthEntry<any>) => (r.owed.length > 0 ? r.total : (r.payment?.paidAmount ?? 0))
  const paidCount = rows.filter((r) => r.owed.length === 0).length
  const fixedPaid = rows.reduce((s, r) => s + (r.owed.length === 0 ? (r.payment?.paidAmount ?? 0) : 0), 0)
  const fixedOwed = rows.reduce((s, r) => s + (r.owed.length > 0 ? r.total : 0), 0)
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
      part.value += shownAmount(r)
      part.count += 1
    }
    return parts.filter((p) => p.count > 0 || p.key === 'paid' || p.key === 'overdue')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])
  const progressTotal = progressParts.reduce((s, p) => s + p.value, 0)

  // ── Everything else that moved in the period ────────────────────────────────
  async function deleteIncome(id: string, concept: string) {
    if (!(await ask(`¿Eliminar el ingreso "${concept}"? La cuenta a la que llegó deja de contarlo.`, { title: 'Eliminar ingreso' }))) return
    try { await salary.removeExtra(id); showToast('Ingreso eliminado', 'delete') } catch { showToast('No se pudo eliminar el ingreso', 'error') }
  }
  async function deleteSpend(id: string, occasional: boolean, transfer?: { toName?: string; pendingId?: string }) {
    const text = transfer
      ? `¿Eliminar la transferencia a ${transfer.toName ?? 'tu familiar'}? La cuenta recupera el dinero, y si aún no la había confirmado, deja de aparecerle.`
      : `¿Eliminar este gasto ${occasional ? 'ocasional' : 'adicional'}? La cuenta recupera el dinero.`
    if (!(await ask(text, { title: transfer ? 'Eliminar transferencia' : 'Eliminar gasto' }))) return
    try {
      await salary.removeSpend(id)
      if (transfer?.pendingId) await withdrawFamilyTransfer(transfer.pendingId)
      showToast(transfer ? 'Transferencia eliminada' : 'Gasto eliminado', 'delete')
    } catch { showToast('No se pudo eliminar el gasto', 'error') }
  }

  type Item = FlowItem & { category?: string }
  const allItems = useMemo<Item[]>(() => {
    const out: Item[] = []
    for (const s of salary.salaries) {
      if (!inBounds(s.date)) continue
      out.push({ id: `in|${s.id}`, kind: 'income', date: s.date, concept: 'Sueldo', sub: 'Sueldo', amount: s.amount, accountId: s.accountId, attachmentId: s.attachmentId, onDelete: () => deleteIncome(s.id, 'Sueldo') })
    }
    for (const x of salary.allExtras) {
      if (!inBounds(x.date)) continue
      out.push({ id: `in|${x.id}`, kind: 'income', date: x.date, concept: x.concept, sub: 'Ingreso adicional', amount: x.amount, accountId: x.accountId, attachmentId: x.attachmentId, cash: !salary.movesMoney(x.date, x.accountId), onDelete: () => deleteIncome(x.id, x.concept) })
    }
    const budgetName = (id: string) => salary.budgets.find((b) => b.id === id)?.concept
    for (const e of salary.personal) {
      if (!e.variableBudgetId) continue
      const date = asDate(e.date)
      if (!inBounds(date)) continue
      const spend: EditableSpend = { id: e.id, description: e.description ?? '', amount: e.amount, category: e.category, date, accountId: e.accountId, notes: e.notes, occasional: true }
      out.push({
        id: `oc|${e.id}`, kind: 'occasional', date, concept: e.description ?? 'Gasto ocasional', category: e.category,
        sub: budgetName(e.variableBudgetId) ? `Ocasional · ${budgetName(e.variableBudgetId)}` : 'Gasto ocasional',
        amount: -e.amount, accountId: e.accountId, attachmentId: e.attachmentId, notes: e.notes || undefined, cash: !salary.movesMoney(date, e.accountId),
        onEdit: () => setSpendForm({ editing: spend }), onDelete: () => deleteSpend(e.id, true),
      })
    }
    const transferOf = new Map(salary.personal.filter((e) => e.familyTransfer).map((e) => [e.id as string, e.familyTransfer as { to: string; toName?: string; pendingId?: string }]))
    for (const r of buildExpenseRows(salary.personal, bounds)) {
      const ft = transferOf.get(r.id)
      const spend: EditableSpend = { id: r.id, description: r.description, amount: r.amount, category: r.category, date: r.date, accountId: r.accountId, notes: r.notes }
      out.push({
        id: `ad|${r.id}`, kind: 'additional', date: r.date, concept: r.description, category: r.category,
        sub: ft ? `Transferencia a ${ft.toName ?? 'un familiar'} · familia` : categoryOf(r.category)?.label ?? 'Gasto adicional', amount: -r.amount, accountId: r.accountId, attachmentId: r.attachmentId, notes: r.notes,
        history: !r.counted, cash: r.counted && !salary.movesMoney(r.date, r.accountId), onEdit: ft ? undefined : () => setSpendForm({ editing: spend }), onDelete: () => deleteSpend(r.id, false, ft),
      })
    }
    for (const a of household.abonos) {
      if (!inBounds(a.date)) continue
      out.push({ id: `hh|${a.id}`, kind: 'household', date: a.date, concept: 'Abono en el hogar', sub: householdList.find((h) => h.id === a.householdId)?.name ?? 'Hogar', amount: -a.amount, accountId: a.accountId, attachmentId: a.attachmentId, cash: !salary.movesMoney(a.date, a.accountId) })
    }
    for (const t of transfers) {
      const date = asDate(t.date)
      if (!inBounds(date)) continue
      out.push({ id: `tr|${t.id}`, kind: 'transfer', date, concept: t.note || 'Traslado entre cuentas', sub: 'Traslado entre cuentas', amount: t.amount, accountId: t.fromId, toAccountId: t.toId })
    }
    // each date of a reminder that falls in the period (a shared one carries its owner's face)
    for (const r of reminders) {
      const owner = user && r.userId !== user.uid ? { uid: r.userId, name: r.ownerName || 'Familiar', photo: r.ownerPhoto } : undefined
      for (const k of reminderDates(r, bounds.start, bounds.end)) {
        const [yy, mo, dd] = k.split('-').map(Number)
        out.push({
          id: `rem|${r.id}|${k}`, kind: 'reminder', date: new Date(yy, mo - 1, dd, 12), concept: r.title, amount: 0, owner,
          sub: r.every ? 'Recordatorio que se repite' : 'Recordatorio', notes: r.notes, done: !!r.done[k],
        })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminders, salary.salaries, salary.allExtras, salary.movesMoney, salary.personal, salary.budgets, household.abonos, householdList, transfers, bounds])

  // ── Filters applied ─────────────────────────────────────────────────────────
  const byAccount = (id?: string, to?: string) => accountFilter.length === 0 || (!!id && accountFilter.includes(id)) || (!!to && accountFilter.includes(to))
  const wantKind = (k: FlowKind) => kinds.length === 0 || kinds.includes(k)
  const others = family && user ? family.members.filter((u) => u !== user.uid) : []
  const sharedEntries = useMemo<TimelineEntry[]>(() => {
    const now = new Date()
    return others.flatMap((u) => {
      const exp = shared.expenses.filter((e) => e.userId === u && e.active !== false)
      if (exp.length === 0) return []
      const idx = indexPayments(withAutoPayments(exp, shared.payments.filter((p) => p.userId === u), now))
      const owner = { uid: u, name: family!.memberNames[u] ?? 'Familiar', photo: family!.memberPhotos[u] ?? null }
      return periodEntries(exp, month, bounds, idx, now).map((e) => ({ ...e, owner }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, familyKey, month, bounds])
  // the same, grouped by person, for the calendar (it lays each month out by itself); the "Personas" filter applies
  const sharedGroups = useMemo(() => {
    const now = new Date()
    return others.filter((u) => wantPerson(u)).flatMap((u) => {
      const exp = shared.expenses.filter((e) => e.userId === u && e.active !== false)
      if (exp.length === 0) return []
      const owner = { uid: u, name: family!.memberNames[u] ?? 'Familiar', photo: family!.memberPhotos[u] ?? null }
      return [{ owner, expenses: exp, paymentIndex: indexPayments(withAutoPayments(exp, shared.payments.filter((p) => p.userId === u), now)) }]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, familyKey, people])
  // the calendar month's reminders (the calendar shows calendar months, not pay periods)
  const calendarReminders = useMemo(() => {
    const [cy, cm] = month.split('-').map(Number)
    const start = new Date(cy, cm - 1, 1)
    const end = new Date(cy, cm, 1)
    return reminders.flatMap((r) => {
      const theirs = !!user && r.userId !== user.uid
      if (!wantPerson(theirs ? r.userId : 'me')) return []
      return reminderDates(r, start, end).map((k) => ({
        key: `rem|${r.id}|${k}`, day: Number(k.slice(8)), title: r.title, done: !!r.done[k],
        owner: theirs ? { name: r.ownerName || 'Familiar', photo: r.ownerPhoto } : undefined,
        onOpen: () => setReminderSel({ reminder: r, date: k }),
      }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminders, month, people, user])
  const entries: TimelineEntry[] = [...rows
    .filter(() => wantPerson('me'))
    .filter(() => wantKind('fixed') && categories.length === 0)
    .filter((r) => !statusFilter || statusGroup(entryStatusKey(r)) === statusFilter)
    .filter((r) => byAccount(entryAccountId(r))),
    // a family member's: only the kind and state filters apply (accounts and categories are mine)
    ...sharedEntries
      .filter((e) => wantPerson(e.owner!.uid) && wantKind('fixed') && categories.length === 0 && accountFilter.length === 0)
      .filter((e) => !statusFilter || statusGroup(entryStatusKey(e)) === statusFilter),
  ]
  const items = allItems
    .filter((i) => wantPerson(i.owner?.uid ?? 'me'))
    .filter(() => !statusFilter)
    .filter((i) => wantKind(i.kind))
    .filter((i) => i.kind === 'reminder' ? accountFilter.length === 0 : byAccount(i.accountId, i.toAccountId))
    .filter((i) => categories.length === 0 || (!!i.category && categories.includes(i.category)))
  const filtering = kinds.length > 0 || !!statusFilter || accountFilter.length > 0 || categories.length > 0 || people.length > 0
  const showBudgets = !statusFilter && accountFilter.length === 0 && categories.length === 0 && wantKind('occasional') && wantPerson('me')

  // ── Period summary ──────────────────────────────────────────────────────────
  const sumOf = (k: FlowKind) => allItems.filter((i) => i.kind === k && !i.history && !i.cash).reduce((s, i) => s + Math.abs(i.amount), 0)
  // registered without an account (cash): listed, but they don't move the money of the period
  const cashOut = allItems.filter((i) => i.cash && i.amount < 0).reduce((s, i) => s - i.amount, 0)
  const cashIn = allItems.filter((i) => i.cash && i.amount > 0).reduce((s, i) => s + i.amount, 0)
  const incomeTotal = sumOf('income')
  const occasionalTotal = sumOf('occasional')
  const additionalTotal = sumOf('additional')
  const householdTotal = sumOf('household')
  const outTotal = fixedPaid + occasionalTotal + additionalTotal + householdTotal
  const net = incomeTotal - outTotal
  const countOf = (k: FlowKind) => (k === 'fixed' ? rows.length : allItems.filter((i) => i.kind === k).length)

  // spends by category (additional and occasional that count)
  const catSummary = PERSONAL_CATEGORIES.map((c) => ({
    ...c,
    total: allItems.filter((i) => (i.kind === 'additional' || i.kind === 'occasional') && !i.history && !i.cash && i.category === c.id).reduce((s, i) => s - i.amount, 0),
  })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total)
  const catBase = catSummary.reduce((s, c) => s + c.total, 0)
  // the categories the period's spends use (and any picked one), for the category filter
  const categoryOptions = PERSONAL_CATEGORIES
    .map((c) => ({ value: c.id, label: c.label, color: c.color, count: allItems.filter((i) => i.category === c.id).length }))
    .filter((c) => c.count > 0 || categories.includes(c.value))

  // ── Calendar: moving a fixed expense's date ────────────────────────────────
  async function handleMove(fe: any, occMonth: string, target: DueOverride | null) {
    const overrides: Record<string, DueOverride> = { ...(fe.dueOverrides ?? {}) }
    const unchanged = target && target.month === occMonth && target.day === settingsFor(fe, occMonth).paymentDay
    if (target && !unchanged) overrides[occMonth] = target
    else delete overrides[occMonth]
    try {
      await updateFixedExpense(fe.id, { dueOverrides: overrides })
      await loadFixed()
      showToast(target && !unchanged ? 'Fecha movida' : 'Fecha restablecida', 'edit')
    } catch (err) {
      showToast('Error al mover la fecha', 'error')
      throw err
    }
  }

  const loading = loadingFixed || salary.loading
  const framed = 'rounded-3xl border border-white/10 bg-[#0a1f2f]/50'
  const scrollProps = {
    contentClassName: 'max-lg:!overflow-visible space-y-5 py-3 !pl-3 !pr-3 lg:py-4 lg:!pl-4 lg:!pr-6',
    borderRadius: 24,
    offset: 7,
    variant: 'plain' as const,
    themeColor: 'brand' as const,
  }

  const summaryRows: { kind: FlowKind; label: string; value: number; sign: '+' | '−'; hint?: string }[] = [
    { kind: 'income', label: 'Ingresos', value: incomeTotal, sign: '+' },
    { kind: 'fixed', label: 'Fijos pagados', value: fixedPaid, sign: '−', hint: fixedOwed > 0 ? `faltan ${formatCOP(fixedOwed)}` : undefined },
    { kind: 'occasional', label: 'Ocasionales', value: occasionalTotal, sign: '−' },
    { kind: 'additional', label: 'Adicionales', value: additionalTotal, sign: '−' },
    { kind: 'household', label: 'Abonos al hogar', value: householdTotal, sign: '−' },
  ]

  const registerOptions = [
    { label: 'Gasto adicional', hint: 'Almuerzo, compras, salidas…', icon: ShoppingBag, color: flowKind('additional').color, onClick: () => setSpendForm({ editing: null }) },
    { label: 'Ingreso', hint: 'Bono, venta, trabajo extra…', icon: Banknote, color: flowKind('income').color, onClick: () => setIncomeOpen(true) },
    { label: 'Programar un pago', hint: 'Un pago único en una fecha', icon: CalendarPlus, color: flowKind('fixed').color, onClick: () => setProgramming({ editing: null }) },
    { label: 'Recordatorio', hint: 'Algo que hacer en una fecha, sin dinero', icon: Bell, color: '#cbd5e1', onClick: () => setReminderForm({ editing: null }) },
    ...(family && family.members.length > 1 ? [{ label: 'Transferir a un familiar', hint: 'Le llega para confirmarla como ingreso', icon: Heart, color: '#fb7185', onClick: () => setFamilyTransferOpen(true) }] : []),
    ...(salary.accounts.length > 1 ? [{ label: 'Traslado entre cuentas', hint: 'Mover dinero de una cuenta a otra', icon: ArrowLeftRight, color: flowKind('transfer').color, onClick: () => setTransferOpen(true) }] : []),
  ]

  const registerItems = (
    <>
      {registerOptions.map((o) => (
        <button
          key={o.label}
          role="menuitem"
          type="button"
          onClick={() => { setMenuOpen(false); o.onClick() }}
          className="w-full flex items-start gap-3 rounded-lg px-2.5 py-2.5 lg:py-2 text-left hover:bg-white/5 transition"
        >
          <o.icon size={18} className="mt-0.5 flex-shrink-0" style={{ color: o.color }} aria-hidden="true" />
          <span>
            <span className="block text-sm font-semibold text-[#f0fae8]">{o.label}</span>
            <span className="block text-[11px] text-[#8a929a]">{o.hint}</span>
          </span>
        </button>
      ))}
      <p className="px-2.5 pt-1.5 pb-1 text-[10px] text-[#5f6a72] border-t border-white/[0.06] mt-1">El sueldo se confirma desde su tarjeta, y un gasto ocasional desde "Gastos ocasionales del período".</p>
    </>
  )

  return (
    <div className="flex flex-col gap-5 fade-in text-[#f3f5f6] lg:flex-row lg:h-full lg:min-h-0">
      {/* Left pane: the salary, what the period added up to, the fixed expenses' progress and where the spends went */}
      <CurvedScrollContainer
        className={clsx('lg:w-[32%] lg:min-w-[340px] lg:max-w-[560px] lg:flex-shrink-0 lg:min-h-0', framed, leftCollapsed && 'lg:hidden')}
        corners="both"
        {...scrollProps}
      >
        <div>
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 notch-sm bg-white/[0.04] border border-white/[0.08]">
            <Wallet size={11} className="text-brand-400" />
            <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest">Personal</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Mi dinero</h1>
          <p className="hidden lg:block text-xs text-[#9aa4ac] mt-1">Ingresos, gastos fijos, ocasionales y adicionales del período, en un solo lugar.</p>
        </div>

        <MobileCollapse title="Sueldo y dinero en cuenta" openWhen={!!salary.pending}>
          <SalaryPanel salary={salary} expenses={expenses} paymentIndex={paymentIndex} />
          {outlook && <FixedOutlook cash={outlook.cash} projection={outlook.projection} />}
        </MobileCollapse>

        {/* On phones the period's summary and the fixed expenses' progress fold behind one header, like the other cards */}
        <MobileCollapse title="Resumen del período">
          {/* The period in numbers: each line filters the timeline to that kind */}
          <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 space-y-2 shadow-xl">
            <div className="flex items-center justify-between">
              <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Resumen del período</p>
              {bounds && <span className="text-[10px] font-mono text-[#8a929a]">{format(bounds.start, 'd MMM', { locale: es })} – {format(new Date(bounds.end.getTime() - 86_400_000), 'd MMM', { locale: es })}</span>}
            </div>
            <ul className="space-y-0.5">
              {summaryRows.map((r) => {
                const k = flowKind(r.kind)
                const on = kinds.length === 1 && kinds[0] === r.kind
                return (
                  <li key={r.kind}>
                    <button
                      type="button"
                      onClick={() => setKinds(on ? [] : [r.kind])}
                      aria-pressed={on}
                      title={on ? 'Ver todos los movimientos' : `Ver solo ${r.label.toLowerCase()}`}
                      className={clsx('w-full flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-xs transition', on ? 'bg-white/10' : 'hover:bg-white/5')}
                    >
                      <span className="flex items-center gap-2 text-[#c7ccd1]">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: k.color }} aria-hidden="true" />
                        {r.label}
                        {r.hint && <span className="text-[10px] text-amber-300/90">· {r.hint}</span>}
                      </span>
                      <span className={clsx('font-mono font-semibold', r.sign === '+' ? 'text-emerald-300' : 'text-[#f0fae8]')}>{r.sign}{formatCOP(r.value)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="flex items-center justify-between border-t border-white/10 pt-2 px-2 text-xs">
              <span className="font-semibold text-[#f0fae8]">Neto del período</span>
              <span className={clsx('font-mono text-base font-bold', net < 0 ? 'text-red-300' : 'text-brand-300')}>{net < 0 ? '−' : '+'}{formatCOP(Math.abs(net))}</span>
            </div>
            <p className="px-2 text-[10px] text-[#5f6a72]">Lo que entró a tus cuentas menos lo que salió de ellas en el período. Los traslados entre tus cuentas no cuentan.</p>
            {(cashOut > 0 || cashIn > 0) && (
              <p className="mx-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-[#c7ccd1]">
                En efectivo (sin cuenta): {cashOut > 0 && <>salieron <span className="font-mono font-semibold">{formatCOP(cashOut)}</span></>}
                {cashOut > 0 && cashIn > 0 && ' · '}
                {cashIn > 0 && <>entraron <span className="font-mono font-semibold">{formatCOP(cashIn)}</span></>}. Se listan, pero no se suman aquí ni descuentan de tus cuentas.
              </p>
            )}
          </div>

          {/* Fixed expenses' progress: each state filters the timeline */}
          {rows.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Fijos del período</p>
                <span className="font-mono text-xs font-bold text-brand-400 bg-brand-500/10 px-2.5 py-1 rounded-lg border border-brand-500/30">
                  {paidCount} / {rows.length} pagados
                </span>
              </div>
              <p className="text-xs text-[#9aa4ac]">
                Pagado <span className="font-mono font-bold text-brand-300">{formatCOP(fixedPaid)}</span>
                {fixedOwed > 0 && <> · falta <span className="font-mono font-bold text-[#f0fae8]">{formatCOP(fixedOwed)}</span></>}
              </p>
              <SegmentedBar label="Estado de los gastos fijos del período" parts={progressParts} total={progressTotal} activeKey={statusFilter} onSelect={(k) => setStatusFilter((cur) => (cur === k ? null : (k as StatusKey)))} />
              <ul className="flex flex-wrap gap-x-2 gap-y-1.5">
                {progressParts.map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => setStatusFilter((cur) => (cur === p.key ? null : p.key))}
                      aria-pressed={statusFilter === p.key}
                      className={clsx('flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition', statusFilter === p.key ? 'border-white/40 bg-white/10' : 'border-transparent hover:bg-white/5', p.count === 0 && statusFilter !== p.key && 'opacity-40')}
                    >
                      <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ backgroundColor: p.color }} aria-hidden="true" />
                      <span className="text-[#c7ccd1]">{p.label}</span>
                      <span className="font-mono text-[#9aa4ac]">{p.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </MobileCollapse>

        {catSummary.length > 0 && (
          <MobileCollapse title="Gastos por categoría">
            <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 space-y-3 shadow-xl">
              <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Gastos por categoría</p>
              <p className="text-[10px] text-[#5f6a72] -mt-2">Adicionales y ocasionales. Toca una para ver solo esos gastos.</p>
              <div className="space-y-2">
                {catSummary.map((c) => {
                  const pct = catBase > 0 ? Math.round((c.total / catBase) * 100) : 0
                  const on = categories.includes(c.id)
                  return (
                    <button key={c.id} type="button" onClick={() => toggleCategory(c.id)} aria-pressed={on} className={clsx('w-full space-y-1.5 rounded-lg px-2 py-1.5 text-left transition', on ? 'bg-white/10' : 'hover:bg-white/5')}>
                      <span className="flex items-center justify-between text-xs">
                        <span className="text-[#f0fae8] font-semibold flex items-center gap-2"><AppIcon name={c.icon} size={15} className="text-brand-300" />{c.label}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-bold font-mono">{formatCOP(c.total)}</span>
                          <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-md bg-white/10 border border-white/15">{pct}%</span>
                        </span>
                      </span>
                      <ProgressBar value={pct} color={c.color} size="sm" />
                    </button>
                  )
                })}
              </div>
            </div>
          </MobileCollapse>
        )}

        <MobileCollapse title="Proyección, débitos y pausados">
          {outlook && <AutoManualCard projection={outlook.projection} />}
          <PausedNotesCard expenses={expenses} onManage={() => setView('config')} />
        </MobileCollapse>
      </CurvedScrollContainer>

      {/* Right pane: view, period and actions on top; filters; then the timeline, the calendar or the configuration */}
      <div className="min-w-0 flex flex-col gap-4 lg:flex-1 lg:min-h-0">
        <div className="flex flex-wrap items-center justify-center gap-3 flex-shrink-0 sm:grid sm:grid-cols-[1fr_auto_1fr]">
          <div className="flex gap-1 p-1 basis-full justify-center sm:basis-auto sm:justify-self-start bg-[#0d263a] border border-white/[0.06] rounded-xl text-xs" role="group" aria-label="Vista">
            {([['list', 'Lista', List], ['calendar', 'Calendario', CalendarDays]] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                aria-pressed={view === id}
                className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg font-medium transition', view === id ? 'bg-[#0a1f2f] text-white font-semibold border border-white/10' : 'text-[#8a929a] hover:text-white')}
              >
                <Icon size={13} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>

          {view !== 'config' ? (
            <div className="flex items-center justify-center gap-1.5">
              <button onClick={() => setMonth(shiftMonth(month, -1))} className="p-2 rounded-lg bg-[#0d263a] border border-white/10 hover:bg-white/10 transition" aria-label="Período anterior">
                <ChevronLeft size={16} />
              </button>
              <span className="min-w-[150px] text-center">
                <span className="block text-sm font-semibold capitalize">{monthLabel}</span>
                {view === 'list' && bounds.period && (
                  <span className="block text-[10px] text-[#8a929a]">
                    {format(bounds.start, 'd MMM', { locale: es })} al {format(new Date(bounds.end.getTime() - 86_400_000), 'd MMM', { locale: es })}
                  </span>
                )}
                {month !== salaryMonth && (
                  <button type="button" onClick={() => setMonth(null)} className="mt-1 inline-flex items-center gap-1 rounded-full border border-brand-400/40 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-200 hover:bg-brand-500/20 transition">
                    <RotateCcw size={10} aria-hidden="true" /> Volver a hoy
                  </button>
                )}
              </span>
              <button onClick={() => setMonth(shiftMonth(month, 1))} className="p-2 rounded-lg bg-[#0d263a] border border-white/10 hover:bg-white/10 transition" aria-label="Período siguiente">
                <ChevronRight size={16} />
              </button>
            </div>
          ) : <span className="hidden sm:block" />}

          <div className="flex items-center gap-2 sm:justify-self-end">
            <div className="relative">
              <Button type="button" size="sm" notched onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-haspopup="menu">
                <Plus size={15} /> Registrar
              </Button>
              {menuOpen && (
                <>
                  {/* wide screens: a menu under the button */}
                  <button type="button" className="hidden lg:block fixed inset-0 z-30 cursor-default" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />
                  <div role="menu" className="hidden lg:block absolute right-0 z-40 mt-2 w-64 rounded-xl border border-white/10 bg-[#0d263a] p-1.5 shadow-2xl">
                    {registerItems}
                  </div>
                  {/* phones: a bottom sheet (in a portal: the page's entrance animation would trap a fixed element) */}
                  {createPortal(
                    <div className="lg:hidden fixed inset-0 z-[70] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Registrar">
                      <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-[2px] fade-in" aria-label="Cerrar" onClick={() => setMenuOpen(false)} />
                      <div role="menu" className="relative rounded-t-3xl border-t border-white/10 bg-[#0d263a] px-3 pt-2 shadow-2xl slide-up" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}>
                        <span className="mx-auto mb-2 block h-1 w-10 rounded-full bg-white/20" aria-hidden="true" />
                        <p className="px-2.5 pb-2 text-sm font-bold text-[#f0fae8]">¿Qué quieres registrar?</p>
                        {registerItems}
                      </div>
                    </div>,
                    document.body,
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setView(view === 'config' ? 'list' : 'config')}
              title="Configurar gastos fijos, programados y ocasionales"
              aria-label="Configurar gastos fijos, programados y ocasionales"
              aria-pressed={view === 'config'}
              className={clsx('p-2 rounded-lg border transition', view === 'config' ? 'bg-brand-500/20 border-brand-400/60 text-brand-200' : 'bg-[#0d263a] border-white/10 text-[#c7ccd1] hover:bg-white/10 hover:text-white')}
            >
              <Settings size={16} />
            </button>
          </div>
        </div>

        <div className={clsx('flex flex-col lg:flex-1 lg:min-h-0', framed)}>
          {view !== 'config' && (
            <div className="flex-shrink-0 border-b border-white/10 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros">
                {family && user && others.length > 0 && (
                  <MultiSelect
                    label="Personas"
                    allLabel="Todos"
                    value={people}
                    onChange={setPeople}
                    options={[
                      { value: 'me', label: 'Yo', icon: <Avatar name="Yo" photoURL={user.photoURL ?? null} size={16} /> },
                      ...others.map((u) => ({ value: u, label: family.memberNames[u] ?? 'Familiar', icon: <Avatar name={family.memberNames[u] ?? '?'} photoURL={family.memberPhotos[u] ?? null} size={16} />, count: sharedEntries.filter((e) => e.owner?.uid === u).length })),
                    ]}
                  />
                )}
                <MultiSelect
                  label="Tipo"
                  allLabel="Todos"
                  value={kinds}
                  onChange={(v) => setKinds(v as FlowKind[])}
                  options={FLOW_KINDS.map(({ id, label, color, icon: Icon }) => ({ value: id, label, icon: <Icon size={13} style={{ color }} aria-hidden="true" />, count: countOf(id) }))}
                />
                {salary.accounts.length > 0 && (
                  <MultiSelect
                    label="Cuentas"
                    allLabel="Todas"
                    value={accountFilter}
                    onChange={setAccountFilter}
                    options={salary.accounts.map((a: any) => ({ value: a.id as string, label: a.name as string, color: (a.color as string) ?? '#52b69a' }))}
                  />
                )}
                {categoryOptions.length > 0 && (
                  <MultiSelect label="Categoría" allLabel="Todas" value={categories} onChange={setCategories} options={categoryOptions} />
                )}
                {statusFilter && (
                  <button type="button" onClick={() => setStatusFilter(null)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/5" style={{ borderColor: STATUS_META[statusFilter].dot }} title="Quitar este filtro">
                    <span className="w-2 h-2 rounded-[3px]" style={{ backgroundColor: STATUS_META[statusFilter].dot }} aria-hidden="true" />
                    Fijos {STATUS_META[statusFilter].label.toLowerCase()} <X size={11} aria-hidden="true" />
                  </button>
                )}
                {filtering && (
                  <button type="button" onClick={clearFilters} className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-brand-300 hover:text-brand-200 transition">
                    <X size={11} aria-hidden="true" /> Quitar filtros
                  </button>
                )}
              </div>
            </div>
          )}

          <CurvedScrollContainer className="lg:flex-1 lg:min-h-0" {...scrollProps} corners={view !== 'config' ? 'bottom-right' : 'both'}>
            {loading ? (
              <SkeletonList count={5} />
            ) : view === 'list' ? (
              <MoneyTimeline
                bounds={bounds}
                expenses={expenses}
                paymentIndex={paymentIndex}
                entries={entries}
                items={items}
                showBudgets={showBudgets}
                onSelect={(e) => (e.owner ? setSharedSel(e) : setPayEntry(e))}
                onOpenItem={(f) => {
                  if (f.kind !== 'reminder') { setDetail(f); return }
                  const [, id, k] = f.id.split('|')
                  const r = reminders.find((x) => x.id === id)
                  if (r) setReminderSel({ reminder: r, date: k })
                }}
                periods={salary.periods}
                extras={salary.extras}
                variable={salary.variable}
                top={month === salaryMonth && showBudgets ? <VariableBudgetsCard salary={salary} /> : undefined}
                filtering={filtering}
                onClearFilter={clearFilters}
                accounts={salary.accounts}
              />
            ) : view === 'calendar' ? (
              <FixedCalendar month={month} expenses={wantPerson('me') ? expenses : []} paymentIndex={paymentIndex} onSelect={setPayEntry} onMove={handleMove} variable={wantPerson('me') ? salary.variable : undefined} shared={sharedGroups} onSelectShared={setSharedSel} reminders={calendarReminders} />
            ) : user ? (
              <FixedConfigPanel userId={user.uid} expenses={expenses} paymentIndex={paymentIndex} salary={salary} onChanged={loadFixed} onProgram={(fe) => setProgramming({ editing: fe ?? null })} />
            ) : null}
          </CurvedScrollContainer>
        </div>
      </div>

      <ReminderFormModal open={!!reminderForm} onClose={() => setReminderForm(null)} editing={reminderForm?.editing ?? null} family={family} />
      <ReminderDetailModal item={reminderSel} onClose={() => setReminderSel(null)} onEdit={(r) => setReminderForm({ editing: r })} family={family} />
      <SharedFixedModal entry={sharedSel} onClose={() => setSharedSel(null)} />
      <MovementDetailModal item={detail} onClose={() => setDetail(null)} accounts={salary.accounts} />
      <FixedPaymentModal
        entry={payEntry}
        onClose={() => setPayEntry(null)}
        expenses={expenses}
        paymentIndex={paymentIndex}
        salary={salary}
        onChanged={loadFixed}
        onEditScheduled={(fe) => setProgramming({ editing: fe })}
      />
      <ProgramExpenseModal
        open={!!programming}
        onClose={() => setProgramming(null)}
        userId={user?.uid ?? ''}
        editing={programming?.editing ?? null}
        accounts={salary.accounts}
        defaultAccount={salary.pickAccount()}
        paid={!!programming?.editing && [...paymentIndex.keys()].some((k) => k.startsWith(`${programming.editing.id}|`))}
        onSaved={loadFixed}
      />
      <ExpenseFormModal open={!!spendForm} onClose={() => setSpendForm(null)} editing={spendForm?.editing ?? null} salary={salary} />
      <IncomeFormModal open={incomeOpen} onClose={() => setIncomeOpen(false)} salary={salary} />
      {family && <FamilyTransferModal open={familyTransferOpen} onClose={() => setFamilyTransferOpen(false)} family={family} salary={salary} />}
      <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} userId={user?.uid ?? ''} accounts={salary.accounts} onDone={() => { loadTransfers(); salary.reloadAccounts() }} />
    </div>
  )
}
