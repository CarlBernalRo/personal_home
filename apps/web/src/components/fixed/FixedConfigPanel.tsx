import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { scheduledDate } from './ProgramExpenseModal'
import { Plus, Pencil, Trash2, ChevronDown, ArrowUpDown, Archive, ArchiveRestore } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { SalaryState } from '@/hooks/useSalary'
import { OcasionalModal } from './OcasionalModal'
import { TagChip, TagPicker } from '@/components/ui/TagPicker'
import { useTags } from '@/hooks/useTags'
import { tagsOf } from '@/shared'
import { ActiveToggleModal } from './ActiveToggleModal'
import { useMyHouseholds } from '@/hooks/useMyHouseholds'
import { addFixedExpense, updateFixedExpense, deleteFixedExpense, archiveFixedExpense, unarchiveFixedExpense, restoreFixedExpenseHistory } from '@/lib/firestore'
import { FIXED_EXPENSE_CATEGORIES, PERSONAL_CATEGORIES, formatCOP, monthKey, cadenceRevisionStart, reviseHistory, revisionStart, startMonthOf, toggleRange, openRange, type AutoDebitRange, type FixedHouseholdLink, type VariableBudget } from '@/shared'
import { syncFixedHouseholdShares } from '@/lib/fixedHousehold'
import { AppIcon, EmptyMark } from '@/components/ui/AppIcon'

const CATEGORY_OPTIONS = FIXED_EXPENSE_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))

const schema = z.object({
  concept:         z.string().min(1, 'Concepto requerido'),
  estimatedAmount: z.coerce.number().positive('El monto estimado debe ser mayor a 0'),
  paymentDay:      z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    z.coerce.number().int().min(1, 'Día entre 1 y 31').max(31, 'Día entre 1 y 31').nullable(),
  ),
  category:        z.string().min(1),
  frequency:       z.enum(['fijo', 'ocasional']),
  isVariable:      z.boolean(),
  autoDebit:       z.boolean(),
  accountId:       z.string().optional(),
  everyMonths:     z.coerce.number().int().min(1).max(12),
  cycleStart:      z.string().optional(),
  startMonth:      z.string().regex(/^\d{4}-\d{2}$/, 'Mes de inicio requerido'),
  notes:           z.string().optional(),
})
type FormData = z.infer<typeof schema>

const FREQUENCY_OPTIONS = [
  { value: '1', label: 'Todos los meses' },
  { value: '2', label: 'Cada 2 meses (bimestral)' },
  { value: '3', label: 'Cada 3 meses (trimestral)' },
  { value: '4', label: 'Cada 4 meses' },
  { value: '6', label: 'Cada 6 meses (semestral)' },
  { value: '12', label: 'Una vez al año' },
]
const everyLabel = (n: number) => (n === 12 ? 'cada año' : `cada ${n} meses`)

const hasOpenAutoDebit = (fe: { autoDebit?: AutoDebitRange[] }) => (fe.autoDebit ?? []).some((r) => !r.until)

type SortKey = 'day' | 'amount' | 'name'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'day', label: 'Día de pago' },
  { value: 'amount', label: 'Monto' },
  { value: 'name', label: 'Nombre' },
]
/** Active ones first, then paused; within each, by the chosen column. */
function sortByStatus<T>(items: T[], key: SortKey, paused: (x: T) => boolean, day: (x: T) => number, amount: (x: T) => number, name: (x: T) => string): T[] {
  return [...items].sort((a, b) => {
    const pa = paused(a) ? 1 : 0, pb = paused(b) ? 1 : 0
    if (pa !== pb) return pa - pb
    if (key === 'amount') return amount(b) - amount(a)
    if (key === 'name') return name(a).localeCompare(name(b))
    return day(a) - day(b)
  })
}

interface Props {
  userId: string
  expenses: any[]
  paymentIndex: Map<string, { paidAmount: number }>
  /** Provides the occasional expenses (stored with the salary data) and their create/edit actions. */
  salary: SalaryState
  onChanged: () => void
  /** Opens the dialog that schedules a one-off payment (or edits the given scheduled one). */
  onProgram: (fe?: any) => void
}

export function FixedConfigPanel({ userId, expenses, paymentIndex, salary, onChanged, onProgram }: Props) {
  const { showToast } = useToast()
  const ask = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]     = useState<any | null>(null)
  const [saving, setSaving]       = useState(false)
  const myHouseholds = useMyHouseholds()
  const [ocasional, setOcasional] = useState<{ editing: VariableBudget | null } | null>(null)
  const [toggle, setToggle] = useState<{ kind: 'fixed' | 'ocasional'; item: any; action: 'deactivate' | 'activate' } | null>(null)
  // Each category is a disclosure: closed by default, so the config doesn't dump everything on screen at once
  const [openFixed, setOpenFixed] = useState(false)
  const [openProgramados, setOpenProgramados] = useState(false)
  const [openOcasional, setOpenOcasional] = useState(false)
  const [openArchived, setOpenArchived] = useState(false)
  const [fixedSort, setFixedSort] = useState<SortKey>('day')
  const [programadosSort, setProgramadosSort] = useState<SortKey>('day')
  const [ocasionalSort, setOcasionalSort] = useState<SortKey>('day')

  const currentMonth = monthKey(new Date())
  // tags are picked apart from the form fields
  const [tagIds, setTagIds] = useState<string[]>([])
  const { tags: allTags } = useTags()

  // ── Shared with a household: every payment becomes a shared expense there (see syncFixedHouseholdShares) ──
  const [link, setLink] = useState<FixedHouseholdLink | null>(null)
  const sharable = myHouseholds.filter((h) => !h.archived && h.members.length > 1)
  const linkHousehold = link ? sharable.find((h) => h.id === link.householdId) ?? null : null
  function pickHousehold(id: string) {
    const hh = sharable.find((h) => h.id === id)
    if (!hh) { setLink(null); return }
    setLink({ householdId: id, from: link?.from ?? currentMonth, splitMode: link?.splitMode ?? 'equal', shares: hh.members.map((m) => ({ memberId: m, percentage: Math.round(100 / hh.members.length) })) })
  }
  const toggleShare = (m: string) => link && setLink({ ...link, shares: link.shares.some((s) => s.memberId === m) ? link.shares.filter((s) => s.memberId !== m) : [...link.shares, { memberId: m, percentage: 0 }] })
  const setPercentage = (m: string, v: number) => link && setLink({ ...link, shares: link.shares.map((s) => (s.memberId === m ? { ...s, percentage: Math.max(0, Math.min(100, v)) } : s)) })
  const linkError = !link ? null
    : !link.shares.some((s) => s.memberId !== userId) ? 'Elige al menos a otra persona del hogar.'
      : link.splitMode === 'percentage' && link.shares.reduce((n, s) => n + (s.percentage ?? 0), 0) !== 100 ? `Los porcentajes deben sumar 100 (van ${link.shares.reduce((n, s) => n + (s.percentage ?? 0), 0)}).`
        : null

  const form = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: { category: 'servicios', frequency: 'fijo', isVariable: false, autoDebit: false, accountId: '', everyMonths: 1, cycleStart: '', startMonth: currentMonth, notes: '' },
  })

  const everyMonths = Number(form.watch('everyMonths') ?? 1)

  function openCreate() {
    setEditing(null)
    setTagIds([])
    setLink(null)
    form.reset({ concept: '', estimatedAmount: undefined as any, paymentDay: null, category: 'servicios', frequency: 'fijo', isVariable: false, autoDebit: false, accountId: '', everyMonths: 1, cycleStart: '', startMonth: currentMonth, notes: '' })
    setModalOpen(true)
  }

  function openEdit(fe: any) {
    // a scheduled payment has its own, simpler dialog
    if (fe.oneTime) { onProgram(fe); return }
    setEditing(fe)
    setTagIds(fe.tagIds ?? [])
    setLink(fe.household ?? null)
    form.reset({
      concept: fe.concept,
      estimatedAmount: fe.estimatedAmount,
      paymentDay: fe.paymentDay ?? null,
      category: fe.category,
      frequency: fe.frequency ?? 'fijo',
      isVariable: !!fe.isVariable,
      autoDebit: hasOpenAutoDebit(fe),
      accountId: fe.accountId ?? '',
      everyMonths: fe.everyMonths ?? 1,
      cycleStart: fe.cycleStart || startMonthOf(fe, currentMonth),
      startMonth: startMonthOf(fe, currentMonth),
      notes: fe.notes ?? '',
    })
    setModalOpen(true)
  }

  async function onSubmit(data: FormData) {
    if (linkError) return
    setSaving(true)
    try {
      const { autoDebit, cycleStart, ...rest } = data
      // Paid every N months: bills fall every N months counted from one month (the first bill when creating)
      const cadence = { everyMonths: data.everyMonths, cycleStart: null as string | null }
      const household = link ? { ...link, shares: link.shares.map((s) => (link.splitMode === 'percentage' ? s : { memberId: s.memberId })) } : null
      const payload = { ...rest, ...cadence, notes: data.notes ?? '', tagIds, household }
      if (editing) {
        // A new day, amount or frequency only applies from the current month on (or the next one if this
        // month is already paid/overdue); closed months keep the values they had.
        const oldAnchor = editing.cycleStart || startMonthOf(editing, currentMonth)
        const cadenceChanged = data.everyMonths !== (editing.everyMonths ?? 1) || (data.everyMonths > 1 && (cycleStart || oldAnchor) !== oldAnchor)
        payload.cycleStart = data.everyMonths > 1 ? (cadenceChanged ? (cycleStart || oldAnchor) : (editing.cycleStart ?? null)) : null
        const scheduleChanged = data.paymentDay !== (editing.paymentDay ?? null) || data.estimatedAmount !== editing.estimatedAmount || cadenceChanged
        // A frequency/cycle correction starts this month even if this month's bill is unpaid; day/amount changes don't
        const from = !scheduleChanged ? null : cadenceChanged ? cadenceRevisionStart(editing, paymentIndex, new Date()) : revisionStart(editing, paymentIndex, new Date())
        // Switching automatic debit on/off also starts from the current month (or the next one if
        // this month is already settled), so past months stay as they were.
        const autoChanged = autoDebit !== hasOpenAutoDebit(editing)
        const autoFrom = autoChanged ? revisionStart(editing, paymentIndex, new Date()) : null
        await updateFixedExpense(editing.id, {
          ...payload,
          ...(from ? { history: reviseHistory(editing, from) } : {}),
          ...(autoFrom ? { autoDebit: toggleRange(editing.autoDebit ?? [], autoDebit, autoFrom) } : {}),
        })
        showToast(
          [from && `El nuevo día, monto o frecuencia aplica desde ${from}`, autoFrom && `El débito automático ${autoDebit ? 'aplica' : 'termina'} desde ${autoFrom}`]
            .filter(Boolean).join('. ') || 'Gasto fijo actualizado',
          'edit',
        )
      } else {
        await addFixedExpense({ ...payload, userId, active: true, ...(autoDebit ? { autoDebit: [{ from: data.startMonth }] } : {}) })
        showToast('Gasto fijo agregado', 'success')
      }
      setModalOpen(false)
      onChanged()
      // shared (or no longer shared, or split differently from now on): the household catches up with its payments
      if (household || editing?.household) syncFixedHouseholdShares(userId).catch(() => {})
    } catch {
      showToast('Error al guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Several at once: keys are `fixed|id` or `oc|id`
  const [selected, setSelected] = useState<string[]>([])
  const toggleRow = (key: string) => setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  const ARCHIVE_NOTE = 'Deja de generar pendientes, avisos y débitos automáticos. Lo que ya pagaste sigue en tu historial y en tus cuentas, y puedes reactivarlo desde Archivados.'

  async function handleArchiveSelected(fixedList: any[], ocasionalList: any[]) {
    const fx = fixedList.filter((f) => selected.includes(`fixed|${f.id}`))
    const oc = ocasionalList.filter((b) => selected.includes(`oc|${b.id}`))
    const names = [...fx, ...oc].map((x) => x.concept as string)
    if (names.length === 0) return
    const shown = names.slice(0, 5).map((n) => `• ${n}`).join('\n') + (names.length > 5 ? `\n… y ${names.length - 5} más` : '')
    const ok = await ask(
      `¿Archivar ${names.length} ${names.length === 1 ? 'gasto' : 'gastos'}?\n\n${shown}\n\n${ARCHIVE_NOTE}`,
      { title: `Archivar ${names.length} ${names.length === 1 ? 'gasto' : 'gastos'}`, confirmLabel: 'Archivar' },
    )
    if (!ok) return
    try {
      await Promise.all(fx.map((f) => archiveFixedExpense(f.id)))
      if (oc.length > 0) await salary.archiveBudgets(oc.map((b) => b.id))
      setSelected([])
      onChanged()
      showToast(`${names.length} ${names.length === 1 ? 'gasto archivado' : 'gastos archivados'}`, 'success')
    } catch {
      showToast('No se pudieron archivar todos los gastos', 'error')
      onChanged()
    }
  }

  // The account an expense is configured to be paid from (automatic debits take the money from it)
  const accountChip = (item: { accountId?: string }) => {
    const acc = item.accountId ? salary.accounts.find((a: any) => a.id === item.accountId) : null
    return acc ? (
      <span className="inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: (acc.color as string) ?? '#52b69a' }} aria-hidden="true" />
        {acc.name as string}
      </span>
    ) : item.accountId ? (
      <span className="text-red-300">Cuenta eliminada</span>
    ) : (
      <span className="text-[#5f6a72]">Se elige al pagar</span>
    )
  }

  async function handleArchive(fe: any) {
    if (!(await ask(`¿Archivar "${fe.concept}"? ${ARCHIVE_NOTE}`, { title: 'Archivar gasto', confirmLabel: 'Archivar' }))) return
    try {
      await archiveFixedExpense(fe.id)
      onChanged()
      showToast(`"${fe.concept}" archivado`, 'success')
    } catch {
      showToast('No se pudo archivar el gasto', 'error')
    }
  }

  async function handleArchiveBudget(b: VariableBudget) {
    if (!(await ask(`¿Archivar "${b.concept}"? Deja de estimarse en tus períodos. Los gastos ya registrados se conservan y puedes reactivarlo desde Archivados.`, { title: 'Archivar gasto ocasional', confirmLabel: 'Archivar' }))) return
    salary.archiveBudgets([b.id]).then(() => showToast(`"${b.concept}" archivado`, 'success')).catch(() => showToast('No se pudo archivar', 'error'))
  }

  // ── Archived: reactivate, delete for good (only with no payments), or recover payments of deleted expenses ──
  const paidIds = new Set([...paymentIndex.values()].map((p: any) => p.fixedExpenseId as string))
  async function handleUnarchive(fe: any) {
    try {
      await unarchiveFixedExpense(fe.id)
      onChanged()
      showToast(`"${fe.concept}" está activo otra vez`, 'success')
    } catch { showToast('No se pudo reactivar', 'error') }
  }
  async function handleDeleteForGood(fe: any) {
    if (paidIds.has(fe.id)) return
    if (!(await ask(`¿Eliminar "${fe.concept}" definitivamente? No tiene pagos registrados, así que no se pierde historial.`, { title: 'Eliminar definitivamente', confirmLabel: 'Eliminar' }))) return
    try {
      await deleteFixedExpense(fe.id)
      onChanged()
      showToast(`"${fe.concept}" eliminado`, 'delete')
    } catch { showToast('No se pudo eliminar', 'error') }
  }
  // payments whose expense was deleted before archiving existed: they show nowhere until their expense comes back
  const knownIds = new Set(expenses.map((e) => e.id as string))
  const orphans = [...[...paymentIndex.values()].reduce((m: Map<string, any[]>, p: any) => {
    const id = p.fixedExpenseId as string
    if (!id || knownIds.has(id) || p.auto) return m
    m.set(id, [...(m.get(id) ?? []), p])
    return m
  }, new Map<string, any[]>()).entries()].map(([id, payments]) => ({ id, payments, concept: (payments.find((p: any) => p.concept)?.concept as string) || 'Gasto sin nombre', total: payments.reduce((s: number, p: any) => s + (p.paidAmount || 0), 0) }))
  async function handleRestore(o: { id: string; payments: any[]; concept: string }) {
    try {
      await restoreFixedExpenseHistory(userId, o.id, o.payments)
      onChanged()
      showToast(`Historial de "${o.concept}" recuperado (queda archivado)`, 'success')
    } catch { showToast('No se pudo recuperar el historial', 'error') }
  }

  const errors = form.formState.errors

  // Switch (not delete): off from a month on, history before it stays
  const switchOff = (item: any) => !!openRange(item.pauses)
  function askToggle(kind: 'fixed' | 'ocasional', item: any) {
    setToggle({ kind, item, action: switchOff(item) ? 'activate' : 'deactivate' })
  }
  async function confirmToggle(month: string) {
    if (!toggle) return
    const { kind, item, action } = toggle
    const pauses = toggleRange(item.pauses ?? [], action === 'deactivate', month)
    try {
      if (kind === 'fixed') {
        await updateFixedExpense(item.id, { pauses })
        onChanged()
      } else {
        await salary.updateBudget(item.id, { pauses })
      }
      showToast(action === 'deactivate' ? `Desactivado desde ${month}` : `Activado desde ${month}`, 'edit')
      setToggle(null)
    } catch {
      showToast('No se pudo guardar el cambio', 'error')
    }
  }

  /** Status switch; shows when a deactivation is (or will be) in effect. */
  const statusSwitch = (kind: 'fixed' | 'ocasional', item: any) => {
    const open = openRange(item.pauses)
    const on = !open
    return (
      <div className="flex flex-col items-center gap-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`${on ? 'Desactivar' : 'Activar'} ${item.concept}`}
          onClick={() => askToggle(kind, item)}
          className={clsx('relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border transition', on ? 'bg-brand-500/40 border-brand-400/60' : 'bg-white/5 border-white/20')}
        >
          <span className={clsx('inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform', on ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
        </button>
        {open && !item.oneTime && (
          <p className="text-[9px] text-amber-300 whitespace-nowrap">
            {open.from <= currentMonth ? `Inactivo desde ${open.from}` : `Se desactiva ${open.from}`}
          </p>
        )}
      </div>
    )
  }
  // What the fixed expenses cost per month on average: one paid every N months counts as 1/N of its bill
  const fixedOnly = expenses.filter((e) => e.frequency !== 'ocasional' && !e.oneTime && !e.archivedAt)
  // A scheduled one-off payment (Programar gasto) is neither fijo nor ocasional: it lives in the same
  // collection (it reuses the due-date/payment engine) but gets its own category here.
  const programados = expenses.filter((e) => e.oneTime && !e.archivedAt)
  const archivedFixed = expenses.filter((e) => e.archivedAt)
  const archivedBudgets = salary.budgets.filter((b) => b.archivedAt)
  const archivedCount = archivedFixed.length + archivedBudgets.length + orphans.length
  const total = fixedOnly.reduce((s, e) => s + e.estimatedAmount / (e.everyMonths ?? 1), 0)
  const hasSpread = fixedOnly.some((e) => (e.everyMonths ?? 1) > 1)
  const ocasionales = salary.budgets.filter((b) => b.active)
  // what a household-debt expense stands for right now, limited to the households it follows
  const owedNowOf = (b: VariableBudget) => salary.variable.householdOwedAt?.(new Date(), b.householdIds) ?? salary.variable.householdOwed ?? 0
  const scopeLabel = (b: VariableBudget) => b.householdIds?.length
    ? b.householdIds.map((id) => myHouseholds.find((h) => h.id === id)?.name ?? 'Hogar').join(', ')
    : 'todos mis hogares'
  const ocasionalTotal = ocasionales.reduce((s, b) => s + (b.source === 'household-debt' ? owedNowOf(b) : b.amount), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[#9aa4ac]">
          {fixedOnly.length} fijos{programados.length > 0 ? ` · ${programados.length} programado${programados.length === 1 ? '' : 's'}` : ''} · {hasSpread ? 'equivalente mensual' : 'estimado mensual'}{' '}
          <span className="font-mono font-bold text-[#f0fae8]">{formatCOP(Math.round(total))}</span>
          {hasSpread && <span className="text-[#8a929a]"> (los que se pagan cada varios meses se prorratean)</span>}
          {ocasionales.length > 0 && (
            <>
              {' '}· {ocasionales.length} ocasionales · aprox. por período{' '}
              <span className="font-mono font-bold text-[#f0fae8]">{formatCOP(ocasionalTotal)}</span>
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button size="sm" notched onClick={openCreate}>
            <Plus size={15} /> Nuevo gasto fijo
          </Button>
          <Button size="sm" notched onClick={() => setOcasional({ editing: null })}>
            <Plus size={15} /> Nuevo gasto ocasional
          </Button>
        </div>
      </div>

      {fixedOnly.length + programados.length === 0 && ocasionales.length === 0 ? (
        <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-10 px-6">
          <EmptyMark name="list" />
          <p className="text-sm font-bold text-[#f0fae8]">Sin gastos configurados</p>
          <p className="text-xs text-[#8a929a] mt-1">Crea un gasto fijo u ocasional para empezar.</p>
        </div>
      ) : (
        <div className="space-y-6">
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 notch-sm border border-red-500/30 bg-red-500/10 px-4 py-2.5" role="region" aria-label="Acciones sobre la selección">
            <p className="text-xs font-semibold text-red-200">
              {selected.length} {selected.length === 1 ? 'seleccionado' : 'seleccionados'}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setSelected([])}>Cancelar</Button>
              <Button size="sm" variant="secondary" notched onClick={() => handleArchiveSelected(expenses, ocasionales)}>
                <Archive size={14} /> Archivar seleccionados
              </Button>
            </div>
          </div>
        )}

        {/* ── Fijos ──────────────────────────────────────────────────────── */}
        <div className="space-y-2.5">
          <div className="flex items-stretch rounded-xl border border-white/10 bg-[#0d263a] overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenFixed((v) => !v)}
              aria-expanded={openFixed}
              className="group flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3 text-left transition hover:bg-white/5"
            >
              <span className="font-pixel text-[10px] uppercase tracking-widest text-brand-400">Gastos fijos</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-[#c7ccd1]">{fixedOnly.length}</span>
              <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-[#6f7a83] group-hover:text-brand-300">
                {openFixed ? 'Ocultar' : 'Ver configuración'}
                <ChevronDown size={15} className={clsx('transition-transform', openFixed && 'rotate-180')} aria-hidden="true" />
              </span>
            </button>
            {openFixed && fixedOnly.length > 1 && (
              <label className="relative flex flex-shrink-0 items-center gap-1.5 border-l border-white/10 px-3 text-[10px] font-semibold text-[#9aa4ac] cursor-pointer transition hover:bg-white/5 hover:text-brand-300">
                <ArrowUpDown size={12} aria-hidden="true" />
                {SORT_OPTIONS.find((o) => o.value === fixedSort)?.label}
                <select
                  value={fixedSort}
                  onChange={(e) => setFixedSort(e.target.value as SortKey)}
                  aria-label="Ordenar gastos fijos"
                  className="absolute inset-0 w-full cursor-pointer opacity-0"
                >
                  {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            )}
          </div>

          {openFixed && (fixedOnly.length === 0 ? (
            <p className="text-xs text-[#8a929a] notch-sm bg-[#0a1f2f] border border-white/10 px-4 py-3">Sin gastos fijos configurados.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 px-1 text-[10px] font-semibold text-[#8a929a] cursor-pointer select-none">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todos los fijos"
                  checked={selected.filter((k) => fixedOnly.some((f) => k === `fixed|${f.id}`)).length > 0 && selected.filter((k) => fixedOnly.some((f) => k === `fixed|${f.id}`)).length === fixedOnly.length}
                  ref={(el) => { if (el) el.indeterminate = selected.some((k) => fixedOnly.some((f) => k === `fixed|${f.id}`)) && selected.filter((k) => fixedOnly.some((f) => k === `fixed|${f.id}`)).length < fixedOnly.length }}
                  onChange={(e) => setSelected((prev) => {
                    const rest = prev.filter((k) => !fixedOnly.some((f) => k === `fixed|${f.id}`))
                    return e.target.checked ? [...rest, ...fixedOnly.map((f) => `fixed|${f.id}`)] : rest
                  })}
                  className="cursor-pointer"
                />
                Seleccionar todos
              </label>
              <div className="space-y-2">
                {sortByStatus(fixedOnly, fixedSort, (fe) => switchOff(fe), (fe) => fe.paymentDay ?? 99, (fe) => fe.estimatedAmount, (fe) => fe.concept)
                  .map((fe) => {
                    const cat = FIXED_EXPENSE_CATEGORIES.find((c) => c.id === fe.category)
                    return (
                      <div key={fe.id} className={clsx('flex items-start gap-3 notch-sm border border-white/10 bg-[#0a1f2f] p-3 transition hover:border-white/20', switchOff(fe) && 'opacity-60')}>
                        <input type="checkbox" aria-label={`Seleccionar ${fe.concept}`} checked={selected.includes(`fixed|${fe.id}`)} onChange={() => toggleRow(`fixed|${fe.id}`)} className="mt-1 flex-shrink-0 cursor-pointer" />
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center notch-sm border border-brand-500/25 bg-brand-500/10 text-brand-300" aria-hidden="true">
                          <AppIcon name={cat?.icon} size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-sm text-[#f0fae8] break-words">{fe.concept}</p>
                            <p className="flex-shrink-0 font-mono text-sm font-bold tabular-nums text-[#f0fae8]">{formatCOP(fe.estimatedAmount)}</p>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[#9aa4ac]">
                            <span className="inline-flex items-center gap-1">{cat?.label}</span>
                            <span aria-hidden="true">·</span>
                            <span>Día {fe.paymentDay ?? '—'}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {fe.isVariable ? 'Fijo · monto variable' : 'Fijo'}
                              {(fe.everyMonths ?? 1) > 1 ? ` · ${everyLabel(fe.everyMonths)}` : ''}{hasOpenAutoDebit(fe) ? ' · automático' : ''}
                            </span>
                            <span aria-hidden="true">·</span>
                            {accountChip(fe)}
                            <span aria-hidden="true">·</span>
                            <span>Desde {startMonthOf(fe, currentMonth)}</span>
                            {fe.household && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-sky-300">Compartido con {myHouseholds.find((h) => h.id === fe.household.householdId)?.name ?? 'un hogar'}</span>
                              </>
                            )}
                          </div>
                          {fe.notes && <p className="mt-1 text-[10px] text-[#8a929a] break-words">{fe.notes}</p>}
                          {tagsOf(fe.tagIds, allTags).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{tagsOf(fe.tagIds, allTags).map((t) => <TagChip key={t.id} tag={t} />)}</div>}
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                          {statusSwitch('fixed', fe)}
                          <div className="flex gap-1">
                            <button onClick={() => openEdit(fe)} title="Editar" className="p-1.5 rounded-lg text-[#8a929a] hover:text-white hover:bg-white/10 transition">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleArchive(fe)} title="Archivar" aria-label={`Archivar ${fe.concept}`} className="p-1.5 rounded-lg text-[#8a929a] hover:text-amber-300 hover:bg-amber-500/10 transition">
                              <Archive size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </>
          ))}
        </div>

        {/* ── Programados ────────────────────────────────────────────────── */}
        <div className="space-y-2.5">
          <div className="flex items-stretch rounded-xl border border-white/10 bg-[#0d263a] overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenProgramados((v) => !v)}
              aria-expanded={openProgramados}
              className="group flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3 text-left transition hover:bg-white/5"
            >
              <span className="font-pixel text-[10px] uppercase tracking-widest text-brand-400">Gastos programados</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-[#c7ccd1]">{programados.length}</span>
              <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-[#6f7a83] group-hover:text-brand-300">
                {openProgramados ? 'Ocultar' : 'Ver configuración'}
                <ChevronDown size={15} className={clsx('transition-transform', openProgramados && 'rotate-180')} aria-hidden="true" />
              </span>
            </button>
            {openProgramados && programados.length > 1 && (
              <label className="relative flex flex-shrink-0 items-center gap-1.5 border-l border-white/10 px-3 text-[10px] font-semibold text-[#9aa4ac] cursor-pointer transition hover:bg-white/5 hover:text-brand-300">
                <ArrowUpDown size={12} aria-hidden="true" />
                {SORT_OPTIONS.find((o) => o.value === programadosSort)?.label}
                <select
                  value={programadosSort}
                  onChange={(e) => setProgramadosSort(e.target.value as SortKey)}
                  aria-label="Ordenar gastos programados"
                  className="absolute inset-0 w-full cursor-pointer opacity-0"
                >
                  {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            )}
          </div>

          {openProgramados && (programados.length === 0 ? (
            <p className="text-xs text-[#8a929a] notch-sm bg-[#0a1f2f] border border-white/10 px-4 py-3">Sin gastos programados. Usa "Registrar → Programar un pago" para un pago único, como una matrícula o una cuota anual.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 px-1 text-[10px] font-semibold text-[#8a929a] cursor-pointer select-none">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todos los programados"
                  checked={selected.filter((k) => programados.some((f) => k === `fixed|${f.id}`)).length > 0 && selected.filter((k) => programados.some((f) => k === `fixed|${f.id}`)).length === programados.length}
                  ref={(el) => { if (el) el.indeterminate = selected.some((k) => programados.some((f) => k === `fixed|${f.id}`)) && selected.filter((k) => programados.some((f) => k === `fixed|${f.id}`)).length < programados.length }}
                  onChange={(e) => setSelected((prev) => {
                    const rest = prev.filter((k) => !programados.some((f) => k === `fixed|${f.id}`))
                    return e.target.checked ? [...rest, ...programados.map((f) => `fixed|${f.id}`)] : rest
                  })}
                  className="cursor-pointer"
                />
                Seleccionar todos
              </label>
              <div className="space-y-2">
                {sortByStatus(programados, programadosSort, () => false, (fe) => scheduledDate(fe).getTime(), (fe) => fe.estimatedAmount, (fe) => fe.concept)
                  .map((fe) => {
                    const cat = FIXED_EXPENSE_CATEGORIES.find((c) => c.id === fe.category)
                    return (
                      <div key={fe.id} className="flex items-start gap-3 notch-sm border border-white/10 bg-[#0a1f2f] p-3 transition hover:border-white/20">
                        <input type="checkbox" aria-label={`Seleccionar ${fe.concept}`} checked={selected.includes(`fixed|${fe.id}`)} onChange={() => toggleRow(`fixed|${fe.id}`)} className="mt-1 flex-shrink-0 cursor-pointer" />
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center notch-sm border border-violet-400/25 bg-violet-400/10 text-violet-300" aria-hidden="true">
                          <AppIcon name={cat?.icon} size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-sm text-[#f0fae8] break-words">{fe.concept}</p>
                            <p className="flex-shrink-0 font-mono text-sm font-bold tabular-nums text-[#f0fae8]">{formatCOP(fe.estimatedAmount)}</p>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[#9aa4ac]">
                            <span>{cat?.label}</span>
                            <span aria-hidden="true">·</span>
                            <span className="text-violet-200">Programado · {format(scheduledDate(fe), "d 'de' MMM yyyy", { locale: es })}</span>
                            {fe.isVariable && (<><span aria-hidden="true">·</span><span>Monto variable</span></>)}
                            <span aria-hidden="true">·</span>
                            {accountChip(fe)}
                          </div>
                          {fe.notes && <p className="mt-1 text-[10px] text-[#8a929a] break-words">{fe.notes}</p>}
                          {tagsOf(fe.tagIds, allTags).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{tagsOf(fe.tagIds, allTags).map((t) => <TagChip key={t.id} tag={t} />)}</div>}
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                          <div className="flex gap-1">
                            <button onClick={() => openEdit(fe)} title="Editar" className="p-1.5 rounded-lg text-[#8a929a] hover:text-white hover:bg-white/10 transition">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleArchive(fe)} title="Archivar" aria-label={`Archivar ${fe.concept}`} className="p-1.5 rounded-lg text-[#8a929a] hover:text-amber-300 hover:bg-amber-500/10 transition">
                              <Archive size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </>
          ))}
        </div>

        {/* ── Ocasionales ────────────────────────────────────────────────── */}
        <div className="space-y-2.5">
          <div className="flex items-stretch rounded-xl border border-white/10 bg-[#0d263a] overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenOcasional((v) => !v)}
              aria-expanded={openOcasional}
              className="group flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3 text-left transition hover:bg-white/5"
            >
              <span className="font-pixel text-[10px] uppercase tracking-widest text-brand-400">Gastos ocasionales</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-[#c7ccd1]">{ocasionales.length}</span>
              <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-[#6f7a83] group-hover:text-brand-300">
                {openOcasional ? 'Ocultar' : 'Ver configuración'}
                <ChevronDown size={15} className={clsx('transition-transform', openOcasional && 'rotate-180')} aria-hidden="true" />
              </span>
            </button>
            {openOcasional && ocasionales.length > 1 && (
              <label className="relative flex flex-shrink-0 items-center gap-1.5 border-l border-white/10 px-3 text-[10px] font-semibold text-[#9aa4ac] cursor-pointer transition hover:bg-white/5 hover:text-brand-300">
                <ArrowUpDown size={12} aria-hidden="true" />
                {SORT_OPTIONS.find((o) => o.value === ocasionalSort)?.label}
                <select
                  value={ocasionalSort}
                  onChange={(e) => setOcasionalSort(e.target.value as SortKey)}
                  aria-label="Ordenar gastos ocasionales"
                  className="absolute inset-0 w-full cursor-pointer opacity-0"
                >
                  {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            )}
          </div>

          {openOcasional && (ocasionales.length === 0 ? (
            <p className="text-xs text-[#8a929a] notch-sm bg-[#0a1f2f] border border-white/10 px-4 py-3">Sin gastos ocasionales configurados.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 px-1 text-[10px] font-semibold text-[#8a929a] cursor-pointer select-none">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todos los ocasionales"
                  checked={selected.filter((k) => k.startsWith('oc|')).length > 0 && selected.filter((k) => k.startsWith('oc|')).length === ocasionales.length}
                  ref={(el) => { if (el) el.indeterminate = selected.some((k) => k.startsWith('oc|')) && selected.filter((k) => k.startsWith('oc|')).length < ocasionales.length }}
                  onChange={(e) => setSelected((prev) => {
                    const rest = prev.filter((k) => !k.startsWith('oc|'))
                    return e.target.checked ? [...rest, ...ocasionales.map((b) => `oc|${b.id}`)] : rest
                  })}
                  className="cursor-pointer"
                />
                Seleccionar todos
              </label>
              <div className="space-y-2">
                {sortByStatus(ocasionales, ocasionalSort, (b) => switchOff(b), (b) => b.paymentDay ?? 99, (b) => (b.source === 'household-debt' ? owedNowOf(b) : b.amount), (b) => b.concept)
                  .map((b) => {
                    const cat = PERSONAL_CATEGORIES.find((c) => c.id === b.category)
                    return (
                      <div key={b.id} className={clsx('flex items-start gap-3 notch-sm border border-white/10 bg-[#0a1f2f] p-3 transition hover:border-white/20', switchOff(b) && 'opacity-60')}>
                        <input type="checkbox" aria-label={`Seleccionar ${b.concept}`} checked={selected.includes(`oc|${b.id}`)} onChange={() => toggleRow(`oc|${b.id}`)} className="mt-1 flex-shrink-0 cursor-pointer" />
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center notch-sm border border-amber-400/25 bg-amber-400/10 text-amber-300" aria-hidden="true">
                          <AppIcon name={cat?.icon} size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-sm text-[#f0fae8] break-words">{b.concept}</p>
                            <p className="flex-shrink-0 font-mono text-sm font-bold tabular-nums text-[#f0fae8]">
                              {b.source === 'household-debt' ? formatCOP(owedNowOf(b)) : `~${formatCOP(b.amount)}`}
                            </p>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[#9aa4ac]">
                            <span>{cat?.label}</span>
                            <span aria-hidden="true">·</span>
                            <span>Día {b.paymentDay ?? '—'}</span>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-200">{b.source === 'household-debt' ? `Ocasional · deuda de ${scopeLabel(b)}` : 'Ocasional · aprox. por período'}</span>
                            <span aria-hidden="true">·</span>
                            {accountChip(b)}
                          </div>
                          {b.notes && <p className="mt-1 text-[10px] text-[#8a929a] break-words">{b.notes}</p>}
                          {tagsOf(b.tagIds, allTags).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{tagsOf(b.tagIds, allTags).map((t) => <TagChip key={t.id} tag={t} />)}</div>}
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                          {statusSwitch('ocasional', b)}
                          <div className="flex gap-1">
                            <button onClick={() => setOcasional({ editing: b })} title="Editar" className="p-1.5 rounded-lg text-[#8a929a] hover:text-white hover:bg-white/10 transition">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleArchiveBudget(b)} title="Archivar" aria-label={`Archivar ${b.concept}`} className="p-1.5 rounded-lg text-[#8a929a] hover:text-amber-300 hover:bg-amber-500/10 transition">
                              <Archive size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </>
          ))}
        </div>
        </div>
      )}

      {/* ── Archivados ─────────────────────────────────────────────────── */}
      {archivedCount > 0 && (
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => setOpenArchived((v) => !v)}
            aria-expanded={openArchived}
            className="group flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-[#0d263a] px-4 py-3 text-left transition hover:bg-white/5"
          >
            <Archive size={13} className="text-[#8a929a]" aria-hidden="true" />
            <span className="font-pixel text-[10px] uppercase tracking-widest text-[#9aa4ac]">Archivados</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-[#c7ccd1]">{archivedCount}</span>
            {orphans.length > 0 && <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">historial por recuperar</span>}
            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-[#6f7a83] group-hover:text-brand-300">
              {openArchived ? 'Ocultar' : 'Ver'}
              <ChevronDown size={15} className={clsx('transition-transform', openArchived && 'rotate-180')} aria-hidden="true" />
            </span>
          </button>

          {openArchived && (
            <div className="space-y-2">
              <p className="px-1 text-[11px] leading-snug text-[#8a929a]">No generan pendientes ni avisos. Lo que pagaste en ellos sigue en tu historial, tus reportes y tus cuentas.</p>

              {orphans.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-3 notch-sm border border-amber-400/30 bg-amber-500/[0.06] p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#f0fae8] break-words">{o.concept}</p>
                    <p className="text-[10px] text-amber-200/90">Gasto eliminado · {o.payments.length} {o.payments.length === 1 ? 'pago' : 'pagos'} por {formatCOP(o.total)} que no se están mostrando</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => handleRestore(o)}>
                    <ArchiveRestore size={14} /> Recuperar historial
                  </Button>
                </div>
              ))}

              {archivedFixed.map((fe) => {
                const cat = FIXED_EXPENSE_CATEGORIES.find((c) => c.id === fe.category)
                const hasPayments = paidIds.has(fe.id)
                return (
                  <div key={fe.id} className="flex flex-wrap items-center gap-3 notch-sm border border-white/10 bg-[#0a1f2f] p-3 opacity-90">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center notch-sm border border-white/10 bg-white/5 text-[#9aa4ac]" aria-hidden="true">
                      <AppIcon name={cat?.icon} size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#f0fae8] break-words">{fe.concept}</p>
                      <p className="text-[10px] text-[#9aa4ac]">{fe.oneTime ? 'Programado' : 'Fijo'} · {formatCOP(fe.estimatedAmount)} · {hasPayments ? 'con pagos en tu historial' : 'sin pagos'}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => handleUnarchive(fe)}><ArchiveRestore size={14} /> Reactivar</Button>
                      {!hasPayments && (
                        <button onClick={() => handleDeleteForGood(fe)} title="Eliminar definitivamente" aria-label={`Eliminar ${fe.concept} definitivamente`} className="p-1.5 rounded-lg text-[#8a929a] hover:text-red-400 hover:bg-red-500/10 transition">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}

              {archivedBudgets.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-3 notch-sm border border-white/10 bg-[#0a1f2f] p-3 opacity-90">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center notch-sm border border-white/10 bg-white/5 text-[#9aa4ac]" aria-hidden="true">
                    <AppIcon name={PERSONAL_CATEGORIES.find((c) => c.id === b.category)?.icon} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#f0fae8] break-words">{b.concept}</p>
                    <p className="text-[10px] text-[#9aa4ac]">Ocasional · ~{formatCOP(b.amount)} por período</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => salary.unarchiveBudget(b.id).then(() => showToast(`"${b.concept}" está activo otra vez`, 'success')).catch(() => showToast('No se pudo reactivar', 'error'))}>
                    <ArchiveRestore size={14} /> Reactivar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ActiveToggleModal
        open={!!toggle}
        name={toggle?.item.concept ?? ''}
        action={toggle?.action ?? 'deactivate'}
        defaultMonth={toggle ? (toggle.kind === 'fixed' ? revisionStart(toggle.item, paymentIndex, new Date()) : monthKey(new Date())) : currentMonth}
        onClose={() => setToggle(null)}
        onConfirm={confirmToggle}
      />

      <OcasionalModal open={!!ocasional} editing={ocasional?.editing ?? null} onClose={() => setOcasional(null)} salary={salary} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Qué es */}
          <Input label="Concepto" placeholder="ej. Arriendo, Internet, Plan móvil…" {...form.register('concept')} error={errors.concept?.message} />
          <Select label="Categoría" options={CATEGORY_OPTIONS} {...form.register('category')} />

          {/* Cuánto */}
          <div className="space-y-4 pt-1 border-t border-white/10">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6f7a83] -mb-1 pt-3">Cuánto</p>
            <Input label="Monto estimado (COP)" money placeholder="0" {...form.register('estimatedAmount')} error={errors.estimatedAmount?.message} />
            <label className="flex items-center gap-3 text-xs text-[#c7ccd1] cursor-pointer select-none">
              <input type="checkbox" className="cursor-pointer" {...form.register('isVariable')} />
              El monto cambia cada mes (ej. servicios públicos)
            </label>
          </div>

          {/* Cuándo */}
          <div className="space-y-4 pt-1 border-t border-white/10">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6f7a83] -mb-1 pt-3">Cuándo</p>
            <Input label="Día de pago del mes (1-31, opcional)" type="number" placeholder="ej. 5" {...form.register('paymentDay')} error={errors.paymentDay?.message as string | undefined} />
            <Select
              label="Frecuencia de pago"
              options={FREQUENCY_OPTIONS}
              {...form.register('everyMonths')}
            />
            <div className="space-y-1">
              <Input
                label={everyMonths > 1 && !editing ? 'Mes de la primera factura' : 'Se debe pagar desde (mes)'}
                type="month"
                {...form.register('startMonth')}
                error={errors.startMonth?.message}
              />
              <p className="text-[10px] text-[#8a929a]">
                {everyMonths > 1 && !editing
                  ? 'Pon el mes de la primera factura que todavía falta pagar. Si ya pagaste la de este mes, elige el mes de la siguiente.'
                  : 'Los meses desde este y hasta hoy que no estén pagados cuentan como pendientes: si ya pagaste, empieza en el mes que sigue.'}
              </p>
            </div>
            {editing && everyMonths > 1 && (
              <div className="space-y-1">
                <Input label="Mes de una de sus facturas" type="month" {...form.register('cycleStart')} />
                <p className="text-[10px] text-[#8a929a]">Las demás caen cada {everyMonths} meses a partir de ese mes. El cambio de frecuencia aplica desde el mes actual; los meses anteriores conservan la que tenían.</p>
              </div>
            )}
          </div>

          {/* Cómo se paga */}
          <div className="space-y-4 pt-1 border-t border-white/10">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6f7a83] -mb-1 pt-3">Cómo se paga</p>
            <label className="flex items-center gap-3 text-xs text-[#c7ccd1] cursor-pointer select-none">
              <input type="checkbox" className="cursor-pointer" {...form.register('autoDebit')} />
              <span>
                Se debita automáticamente de mi cuenta
                <span className="block text-[10px] text-[#8a929a]">Llegado el día de pago se marca como pagado solo.</span>
              </span>
            </label>
            {salary.accounts.length > 0 && (
              <div className="space-y-1">
                <Select
                  label="Cuenta de la que se paga"
                  options={[
                    { value: '', label: 'Elegirla al pagar' },
                    ...salary.accounts.map((a: any) => ({ value: a.id as string, label: a.name as string })),
                  ]}
                  {...form.register('accountId')}
                />
                <p className="text-[10px] text-[#8a929a]">Se ofrece al registrar el pago, y de ahí sale el dinero cuando es un débito automático (si no eliges una, de la Cuenta default).</p>
              </div>
            )}
          </div>

          {/* Notas */}
          <div className="pt-1 border-t border-white/10">
            <div className="pt-3">
              <Input label="Notas" placeholder="Opcional (ej. número de cuenta)" {...form.register('notes')} />
            </div>
            <div className="pt-3">
              <TagPicker value={tagIds} onChange={setTagIds} />
            </div>
          </div>

          {/* Compartir con un hogar */}
          {sharable.length > 0 && (
            <div className="pt-1 border-t border-white/10">
              <div className="pt-3 space-y-2.5">
                <Select
                  label="Compartir con un hogar"
                  value={link?.householdId ?? ''}
                  onChange={(e) => pickHousehold(e.target.value)}
                  options={[{ value: '', label: 'No compartir' }, ...sharable.map((h) => ({ value: h.id, label: h.name }))]}
                />
                {link && linkHousehold && (
                  <div className="space-y-2.5 rounded-xl border border-white/10 bg-[#0d263a] p-3">
                    <p className="text-[11px] leading-snug text-[#9aa4ac]">Cada vez que pagues este gasto se registra solo en «{linkHousehold.name}», pagado por ti, y los demás quedan debiendo su parte.</p>
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8a929a]">¿Entre quiénes se divide?</p>
                      {linkHousehold.members.map((m) => {
                        const on = link.shares.some((s) => s.memberId === m)
                        const share = link.shares.find((s) => s.memberId === m)
                        return (
                          <div key={m} className="flex items-center gap-2">
                            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-[#dcf1eb] cursor-pointer">
                              <input type="checkbox" checked={on} onChange={() => toggleShare(m)} />
                              <span className="truncate">{m === userId ? 'Tú' : (linkHousehold.memberNames[m] ?? 'Integrante')}</span>
                            </label>
                            {on && link.splitMode === 'percentage' && (
                              <span className="flex items-center gap-1">
                                <input
                                  type="number" min={0} max={100} inputMode="numeric"
                                  value={share?.percentage ?? 0}
                                  onChange={(e) => setPercentage(m, Number(e.target.value) || 0)}
                                  aria-label={`Porcentaje de ${m === userId ? 'ti' : (linkHousehold.memberNames[m] ?? 'integrante')}`}
                                  className="w-16 rounded-lg border border-white/10 bg-[#0a1f2f] px-2 py-1 text-right text-xs text-white outline-none focus:border-brand-500"
                                />
                                <span className="text-xs text-[#8a929a]">%</span>
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex gap-1 rounded-lg bg-[#0a1f2f] p-1 text-xs" role="group" aria-label="Cómo se divide">
                      {(['equal', 'percentage'] as const).map((mode) => (
                        <button key={mode} type="button" onClick={() => setLink({ ...link, splitMode: mode })} aria-pressed={link.splitMode === mode}
                          className={clsx('flex-1 rounded-md px-2 py-1.5 font-semibold transition', link.splitMode === mode ? 'bg-brand-500/20 text-brand-300' : 'text-[#8a929a] hover:text-white')}>
                          {mode === 'equal' ? 'Partes iguales' : 'Porcentaje'}
                        </button>
                      ))}
                    </div>
                    <Input label="Desde el pago de" type="month" value={link.from} onChange={(e) => setLink({ ...link, from: e.target.value || currentMonth })} />
                    {linkError && <p className="text-[11px] text-red-300">{linkError}</p>}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
