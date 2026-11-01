import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { clsx } from 'clsx'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { SalaryState } from '@/hooks/useSalary'
import { OcasionalModal } from './OcasionalModal'
import { ActiveToggleModal } from './ActiveToggleModal'
import { useMyHouseholds } from '@/hooks/useMyHouseholds'
import { addFixedExpense, updateFixedExpense, deleteFixedExpense } from '@/lib/firestore'
import { FIXED_EXPENSE_CATEGORIES, PERSONAL_CATEGORIES, formatCOP, monthKey, cadenceRevisionStart, reviseHistory, revisionStart, startMonthOf, toggleRange, openRange, type AutoDebitRange, type VariableBudget } from '@/shared'
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

interface Props {
  userId: string
  expenses: any[]
  paymentIndex: Map<string, { paidAmount: number }>
  /** Provides the occasional expenses (stored with the salary data) and their create/edit actions. */
  salary: SalaryState
  onChanged: () => void
}

export function FixedConfigPanel({ userId, expenses, paymentIndex, salary, onChanged }: Props) {
  const { showToast } = useToast()
  const ask = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]     = useState<any | null>(null)
  const [saving, setSaving]       = useState(false)
  const myHouseholds = useMyHouseholds()
  const [ocasional, setOcasional] = useState<{ editing: VariableBudget | null } | null>(null)
  const [toggle, setToggle] = useState<{ kind: 'fixed' | 'ocasional'; item: any; action: 'deactivate' | 'activate' } | null>(null)

  const currentMonth = monthKey(new Date())

  const form = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: { category: 'servicios', frequency: 'fijo', isVariable: false, autoDebit: false, accountId: '', everyMonths: 1, cycleStart: '', startMonth: currentMonth, notes: '' },
  })

  const everyMonths = Number(form.watch('everyMonths') ?? 1)

  function openCreate() {
    setEditing(null)
    form.reset({ concept: '', estimatedAmount: undefined as any, paymentDay: null, category: 'servicios', frequency: 'fijo', isVariable: false, autoDebit: false, accountId: '', everyMonths: 1, cycleStart: '', startMonth: currentMonth, notes: '' })
    setModalOpen(true)
  }

  function openEdit(fe: any) {
    setEditing(fe)
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
    setSaving(true)
    try {
      const { autoDebit, cycleStart, ...rest } = data
      // Paid every N months: bills fall every N months counted from one month (the first bill when creating)
      const cadence = { everyMonths: data.everyMonths, cycleStart: null as string | null }
      const payload = { ...rest, ...cadence, notes: data.notes ?? '' }
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
    } catch {
      showToast('Error al guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Several at once: keys are `fixed|id` or `oc|id`
  const [selected, setSelected] = useState<string[]>([])
  const toggleRow = (key: string) => setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  async function handleDeleteSelected(fixedList: any[], ocasionalList: any[]) {
    const fx = fixedList.filter((f) => selected.includes(`fixed|${f.id}`))
    const oc = ocasionalList.filter((b) => selected.includes(`oc|${b.id}`))
    const names = [...fx, ...oc].map((x) => x.concept as string)
    if (names.length === 0) return
    const shown = names.slice(0, 5).map((n) => `• ${n}`).join('\n') + (names.length > 5 ? `\n… y ${names.length - 5} más` : '')
    const ok = await ask(
      `¿Eliminar ${names.length} ${names.length === 1 ? 'gasto' : 'gastos'}?\n\n${shown}\n\nSe borran con su configuración. Los pagos que ya registraste se conservan y siguen contando en tu dinero en cuenta.`,
      { title: `Eliminar ${names.length} ${names.length === 1 ? 'gasto' : 'gastos'}`, confirmLabel: 'Eliminar' },
    )
    if (!ok) return
    try {
      await Promise.all(fx.map((f) => deleteFixedExpense(f.id)))
      if (oc.length > 0) await salary.removeBudgets(oc.map((b) => b.id))
      setSelected([])
      onChanged()
      showToast(`${names.length} ${names.length === 1 ? 'gasto eliminado' : 'gastos eliminados'}`, 'delete')
    } catch {
      showToast('No se pudieron eliminar todos los gastos', 'error')
      onChanged()
    }
  }

  // The account an expense is configured to be paid from (automatic debits take the money from it)
  const accountCell = (item: { accountId?: string }) => {
    const acc = item.accountId ? salary.accounts.find((a: any) => a.id === item.accountId) : null
    return (
      <td className="hidden sm:table-cell px-2 py-2 text-xs">
        {acc ? (
          <span className="inline-flex items-center gap-1.5 text-[#c7ccd1]">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: (acc.color as string) ?? '#52b69a' }} aria-hidden="true" />
            {acc.name as string}
          </span>
        ) : item.accountId ? (
          <span className="text-red-300">Cuenta eliminada</span>
        ) : (
          <span className="text-[#5f6a72]">Se elige al pagar</span>
        )}
      </td>
    )
  }

  async function handleDelete(fe: any) {
    const ok = await ask(
      `¿Eliminar "${fe.concept}"? Se borra el gasto y su configuración. Los pagos que ya registraste se conservan y siguen contando en tu dinero en cuenta.`,
      { title: 'Eliminar gasto fijo', confirmLabel: 'Eliminar' },
    )
    if (!ok) return
    try {
      await deleteFixedExpense(fe.id)
      onChanged()
      showToast('Gasto fijo eliminado', 'delete')
    } catch {
      showToast('No se pudo eliminar el gasto fijo', 'error')
    }
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

  /** Status switch cell; shows when a deactivation is (or will be) in effect. */
  const activeCell = (kind: 'fixed' | 'ocasional', item: any) => {
    const open = openRange(item.pauses)
    const on = !open
    return (
      <td className="px-2 py-2 text-center">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`${on ? 'Desactivar' : 'Activar'} ${item.concept}`}
          onClick={() => askToggle(kind, item)}
          className={clsx('relative inline-flex h-5 w-9 items-center rounded-full border transition', on ? 'bg-brand-500/40 border-brand-400/60' : 'bg-white/5 border-white/20')}
        >
          <span className={clsx('inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform', on ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
        </button>
        {open && (
          <p className="text-[9px] text-amber-300 mt-0.5 whitespace-nowrap">
            {open.from <= currentMonth ? `Inactivo desde ${open.from}` : `Se desactiva ${open.from}`}
          </p>
        )}
      </td>
    )
  }
  // What the fixed expenses cost per month on average: one paid every N months counts as 1/N of its bill
  const fixedOnly = expenses.filter((e) => e.frequency !== 'ocasional')
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
          {expenses.length} fijos · {hasSpread ? 'equivalente mensual' : 'estimado mensual'}{' '}
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

      {expenses.length === 0 && ocasionales.length === 0 ? (
        <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-10 px-6">
          <EmptyMark name="list" />
          <p className="text-sm font-bold text-[#f0fae8]">Sin gastos configurados</p>
          <p className="text-xs text-[#8a929a] mt-1">Crea un gasto fijo u ocasional para empezar.</p>
        </div>
      ) : (
        <>
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 notch-sm border border-red-500/30 bg-red-500/10 px-4 py-2.5" role="region" aria-label="Acciones sobre la selección">
            <p className="text-xs font-semibold text-red-200">
              {selected.length} {selected.length === 1 ? 'seleccionado' : 'seleccionados'}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setSelected([])}>Cancelar</Button>
              <Button size="sm" variant="danger" notched onClick={() => handleDeleteSelected(expenses, ocasionales)}>
                <Trash2 size={14} /> Eliminar seleccionados
              </Button>
            </div>
          </div>
        )}
        <div className="bg-[#0a1f2f] border border-white/10 notch-sm overflow-x-auto">
          <table className="w-full text-xs sm:min-w-[900px]">
            <thead>
              <tr className="bg-[#0d263a] text-[10px] uppercase tracking-wider text-[#8a929a]">
                <th className="w-10 pl-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todos"
                    checked={selected.length > 0 && selected.length === expenses.length + ocasionales.length}
                    ref={(el) => { if (el) el.indeterminate = selected.length > 0 && selected.length < expenses.length + ocasionales.length }}
                    onChange={(e) => setSelected(e.target.checked ? [...expenses.map((f) => `fixed|${f.id}`), ...ocasionales.map((b) => `oc|${b.id}`)] : [])}
                    className="cursor-pointer"
                  />
                </th>
                <th className="text-left px-3 py-2">Concepto</th>
                <th className="hidden sm:table-cell text-left px-2 py-2">Categoría</th>
                <th className="text-right px-2 py-2">Estimado</th>
                <th className="text-center px-2 py-2">Día</th>
                <th className="hidden sm:table-cell text-center px-2 py-2">Tipo</th>
                <th className="hidden sm:table-cell text-left px-2 py-2">Cuenta</th>
                <th className="text-center px-2 py-2">Activo</th>
                <th className="hidden sm:table-cell text-center px-2 py-2">Desde</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {[...expenses]
                .sort((a, b) => (a.paymentDay ?? 99) - (b.paymentDay ?? 99))
                .map((fe) => {
                  const cat = FIXED_EXPENSE_CATEGORIES.find((c) => c.id === fe.category)
                  return (
                    <tr key={fe.id} className={clsx('border-t border-white/[0.06] hover:bg-white/[0.03]', switchOff(fe) && 'opacity-60')}>
                      <td className="w-10 pl-3 py-2">
                        <input type="checkbox" aria-label={`Seleccionar ${fe.concept}`} checked={selected.includes(`fixed|${fe.id}`)} onChange={() => toggleRow(`fixed|${fe.id}`)} className="cursor-pointer" />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-[#f0fae8]">{fe.concept}</p>
                        {fe.notes && <p className="text-[10px] text-[#8a929a] truncate max-w-[220px]">{fe.notes}</p>}
                      </td>
                      <td className="hidden sm:table-cell px-2 py-2 text-[#c7ccd1]"><span className="inline-flex items-center gap-1.5"><AppIcon name={cat?.icon} size={13} className="text-brand-300" /> {cat?.label}</span></td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{formatCOP(fe.estimatedAmount)}</td>
                      <td className="px-2 py-2 text-center font-mono">{fe.paymentDay ?? '—'}</td>
                      <td className="hidden sm:table-cell px-2 py-2 text-center text-[10px] text-[#9aa4ac]">
                        {fe.frequency === 'ocasional' ? 'Ocasional' : fe.isVariable ? 'Fijo · monto variable' : 'Fijo'}{(fe.everyMonths ?? 1) > 1 ? ` · ${everyLabel(fe.everyMonths)}` : ''}{hasOpenAutoDebit(fe) ? ' · automático' : ''}
                      </td>
                      {accountCell(fe)}
                      {activeCell('fixed', fe)}
                      <td className="hidden sm:table-cell px-2 py-2 text-center font-mono text-[#9aa4ac]">{startMonthOf(fe, currentMonth)}</td>
                      <td className="px-2 py-2">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => openEdit(fe)} title="Editar" className="p-1.5 rounded-lg text-[#8a929a] hover:text-white hover:bg-white/10 transition">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => handleDelete(fe)} title="Eliminar" aria-label={`Eliminar ${fe.concept}`} className="p-1.5 rounded-lg text-[#8a929a] hover:text-red-400 hover:bg-red-500/10 transition">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              {/* Occasional expenses: regular, but with no exact day or amount */}
              {[...ocasionales]
                .sort((a, b) => (a.paymentDay ?? 99) - (b.paymentDay ?? 99))
                .map((b) => {
                  const cat = PERSONAL_CATEGORIES.find((c) => c.id === b.category)
                  return (
                    <tr key={b.id} className={clsx('border-t border-white/[0.06] hover:bg-white/[0.03]', switchOff(b) && 'opacity-60')}>
                      <td className="w-10 pl-3 py-2">
                        <input type="checkbox" aria-label={`Seleccionar ${b.concept}`} checked={selected.includes(`oc|${b.id}`)} onChange={() => toggleRow(`oc|${b.id}`)} className="cursor-pointer" />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-[#f0fae8]">{b.concept}</p>
                        {b.notes && <p className="text-[10px] text-[#8a929a] truncate max-w-[220px]">{b.notes}</p>}
                      </td>
                      <td className="hidden sm:table-cell px-2 py-2 text-[#c7ccd1]"><span className="inline-flex items-center gap-1.5"><AppIcon name={cat?.icon} size={13} className="text-brand-300" /> {cat?.label}</span></td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">
                        {b.source === 'household-debt' ? formatCOP(owedNowOf(b)) : `~${formatCOP(b.amount)}`}
                      </td>
                      <td className="px-2 py-2 text-center font-mono">{b.paymentDay ?? '—'}</td>
                      <td className="hidden sm:table-cell px-2 py-2 text-center text-[10px] text-amber-200">
                        {b.source === 'household-debt' ? `Ocasional · deuda de ${scopeLabel(b)}` : 'Ocasional · aprox. por período'}
                      </td>
                      {accountCell(b)}
                      {activeCell('ocasional', b)}
                      <td className="hidden sm:table-cell px-2 py-2 text-center font-mono text-[#9aa4ac]">—</td>
                      <td className="px-2 py-2">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setOcasional({ editing: b })} title="Editar" className="p-1.5 rounded-lg text-[#8a929a] hover:text-white hover:bg-white/10 transition">
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={async () => {
                              if (await ask(`¿Eliminar "${b.concept}"? Los gastos ya registrados se conservan.`, { title: 'Eliminar gasto ocasional' })) {
                                salary.removeBudget(b.id).catch(() => showToast('No se pudo eliminar', 'error'))
                              }
                            }}
                            title="Eliminar"
                            className="p-1.5 rounded-lg text-[#8a929a] hover:text-red-400 hover:bg-red-500/10 transition"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
        </>
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
          <Input label="Concepto" placeholder="ej. Arriendo, Internet, Plan móvil…" {...form.register('concept')} error={errors.concept?.message} />
          <Input label="Monto estimado (COP)" money placeholder="0" {...form.register('estimatedAmount')} error={errors.estimatedAmount?.message} />
          <Input label="Día de pago del mes (1-31, opcional)" type="number" placeholder="ej. 5" {...form.register('paymentDay')} error={errors.paymentDay?.message as string | undefined} />
          <Select label="Categoría" options={CATEGORY_OPTIONS} {...form.register('category')} />
          <Select
            label="Frecuencia de pago"
            options={FREQUENCY_OPTIONS}
            {...form.register('everyMonths')}
          />
          <Input
            label={everyMonths > 1 && !editing ? 'Mes de la primera factura' : 'Se debe pagar desde (mes)'}
            type="month"
            {...form.register('startMonth')}
            error={errors.startMonth?.message}
          />
          <p className="text-[10px] text-[#8a929a] -mt-2">
            {everyMonths > 1 && !editing
              ? 'Pon el mes de la primera factura que todavía falta pagar. Si ya pagaste la de este mes, elige el mes de la siguiente.'
              : 'Los meses desde este y hasta hoy que no estén pagados cuentan como pendientes: si ya pagaste, empieza en el mes que sigue.'}
          </p>
          {editing && everyMonths > 1 && (
            <div className="space-y-1">
              <Input label="Mes de una de sus facturas" type="month" {...form.register('cycleStart')} />
              <p className="text-[10px] text-[#8a929a]">Las demás caen cada {everyMonths} meses a partir de ese mes. El cambio de frecuencia aplica desde el mes actual; los meses anteriores conservan la que tenían.</p>
            </div>
          )}
          <label className="flex items-center gap-3 text-xs text-[#c7ccd1] cursor-pointer select-none">
            <input type="checkbox" className="cursor-pointer" {...form.register('autoDebit')} />
            <span>
              Se debita automáticamente de mi cuenta
              <span className="block text-[10px] text-[#8a929a]">Llegado el día de pago se marca como pagado solo.</span>
            </span>
          </label>
          <label className="flex items-center gap-3 text-xs text-[#c7ccd1] cursor-pointer select-none">
            <input type="checkbox" className="cursor-pointer" {...form.register('isVariable')} />
            El monto cambia cada mes (ej. servicios públicos)
          </label>
          {salary.accounts.length > 0 && (
            <Select
              label="Cuenta de la que se paga"
              options={[
                { value: '', label: 'Elegirla al pagar' },
                ...salary.accounts.map((a: any) => ({ value: a.id as string, label: a.name as string })),
              ]}
              {...form.register('accountId')}
            />
          )}
          <p className="text-[10px] text-[#8a929a] -mt-2">Se ofrece al registrar el pago, y de ahí sale el dinero cuando es un débito automático (si no eliges una, de la Cuenta default).</p>
          <Input label="Notas" placeholder="Opcional (ej. número de cuenta)" {...form.register('notes')} />

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
