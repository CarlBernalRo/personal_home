import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ChevronLeft, ChevronRight, Plus, Receipt, History, RotateCcw } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { SkeletonList } from '@/components/ui/Skeleton'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { MobileCollapse } from '@/components/ui/MobileCollapse'
import { CurvedScrollContainer } from '@/components/ui/CurvedScrollContainer'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { SalaryPanel } from '@/components/salary/SalaryPanel'
import { FixedOutlook } from '@/components/fixed/FixedOutlook'
import { ExpenseTimeline, type ExpenseRow } from '@/components/expenses/ExpenseTimeline'
import { buildExpenseRows } from '@/components/expenses/rows'
import { AccountFilter, NO_ACCOUNT } from '@/components/ui/AccountFilter'
import { useSalary } from '@/hooks/useSalary'
import { useAuth } from '@/hooks/useAuth'
import { AttachmentPicker } from '@/components/pending/AttachmentPicker'
import { withAttachment } from '@/lib/attachments'
import { useFixedData } from '@/hooks/useFixedData'
import { usePayProjection } from '@/hooks/usePayProjection'
import { usePeriodStore } from '@/store/period'
import { formatCOP, monthBounds, monthKey, shiftMonth, PERSONAL_CATEGORIES } from '@/shared'
import { AppIcon, EmptyMark } from '@/components/ui/AppIcon'

const schema = z.object({
  description: z.string().min(1, 'Descripción requerida'),
  amount:      z.coerce.number().positive('Monto debe ser mayor a 0'),
  category:    z.string().min(1),
  date:        z.string().min(1, 'Fecha requerida'),
})

type FormData = z.infer<typeof schema>

const CATEGORY_OPTIONS = PERSONAL_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))

const toDate = (d: unknown) => (d instanceof Date ? d : new Date(d as string))
const shortDate = (d: Date) => format(d, "d 'de' MMM", { locale: es })

export default function ExpensesPage() {
  const { showToast } = useToast()
  const ask = useConfirm()
  const salary        = useSalary()
  const fixed         = useFixedData()
  const outlook       = usePayProjection(salary, fixed.expenses, fixed.paymentIndex)

  const [open, setOpen]     = useState(false)
  const [accountId, setAccountId] = useState('')
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  // The spend being edited (null = a new one)
  const [editing, setEditing] = useState<ExpenseRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [category, setCategory] = useState<string>('all')

  // The month filter is shared with Gastos Fijos; until picked it follows the salary period
  const currentMonth = monthKey(new Date())
  const salaryMonth  = salary.currentPeriod ? monthKey(new Date(salary.currentPeriod.end.getTime() - 86_400_000)) : currentMonth
  const pickedMonth  = usePeriodStore((s) => s.month)
  const setMonth     = usePeriodStore((s) => s.setMonth)
  const month        = pickedMonth ?? salaryMonth
  const monthLabel   = format(new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1), 'MMMM yyyy', { locale: es })

  // What the month covers: its salary period when there is one, else the calendar month
  const bounds = useMemo(() => monthBounds(month, salary.periods, salary.boundsSchedule), [month, salary.periods, salary.boundsSchedule])

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: { date: format(new Date(), 'yyyy-MM-dd'), category: 'otro' },
  })

  const rows = useMemo<ExpenseRow[]>(() => buildExpenseRows(salary.personal, bounds), [salary.personal, bounds])

  // Narrowed by category and by the account the spend came out of (null = all)
  const [accountFilter, setAccountFilter] = useState<string | null>(null)
  const shown = rows
    .filter((r) => category === 'all' || r.category === category)
    .filter((r) => !accountFilter || (accountFilter === NO_ACCOUNT ? !r.accountId : r.accountId === accountFilter))
  const countedTotal = rows.filter((r) => r.counted).reduce((s, r) => s + r.amount, 0)
  const historyTotal = rows.filter((r) => !r.counted).reduce((s, r) => s + r.amount, 0)
  const shownTotal   = shown.filter((r) => r.counted).reduce((s, r) => s + r.amount, 0)

  const catSummary = PERSONAL_CATEGORIES.map((cat) => ({
    ...cat,
    total: rows.filter((r) => r.counted && r.category === cat.id).reduce((s, r) => s + r.amount, 0),
  })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total)
  const catBase = catSummary.reduce((s, c) => s + c.total, 0)

  const loading = salary.loading || fixed.loading

  useEffect(() => { if (open && !editing) setAccountId(salary.pickAccount()) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function openCreate() {
    setEditing(null)
    setFile(null)
    reset({ date: format(new Date(), 'yyyy-MM-dd'), category: 'otro', description: '', amount: undefined as any })
    setOpen(true)
  }

  function openEdit(r: ExpenseRow) {
    setEditing(r)
    reset({ description: r.description, amount: r.amount, category: r.category || 'otro', date: format(r.date, 'yyyy-MM-dd') })
    setAccountId(r.accountId ?? '')
    setOpen(true)
  }

  async function onSubmit(data: FormData) {
    setSaving(true)
    try {
      const values = {
        description: data.description.trim(),
        amount:      data.amount,
        category:    data.category,
        date:        new Date(data.date + 'T12:00:00'),
        accountId,
      }
      if (editing) {
        await salary.editPersonalExpense(editing.id, values, { amount: editing.amount, accountId: editing.accountId })
      } else {
        await withAttachment(user!.uid, file, (attachmentId) => salary.addPersonalExpense({ ...values, attachmentId }))
      }
      salary.rememberAccount(accountId)
      reset({ date: format(new Date(), 'yyyy-MM-dd'), category: 'otro', description: '', amount: undefined as any })
      setOpen(false)
      setEditing(null)
      showToast(editing ? 'Gasto adicional actualizado' : 'Gasto adicional guardado', editing ? 'edit' : 'success')
    } catch {
      showToast('Error al guardar el gasto adicional', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!(await ask('¿Eliminar este gasto adicional?', { title: 'Eliminar gasto adicional' }))) return
    try {
      await salary.removeSpend(id)
      showToast('Gasto adicional eliminado', 'delete')
    } catch {
      showToast('No se pudo eliminar el gasto adicional', 'error')
    }
  }

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
    <div className="flex flex-col gap-5 fade-in text-[#f3f5f6] lg:flex-row lg:h-full lg:min-h-0">
      {/* Left pane: the same salary cards as Gastos Fijos, plus where the money went */}
      <CurvedScrollContainer
        className={clsx('lg:w-[32%] lg:min-w-[340px] lg:max-w-[560px] lg:flex-shrink-0 lg:min-h-0', framed)}
        {...scrollProps}
      >
        <div>
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 notch-sm bg-white/[0.04] border border-white/[0.08]">
            <Receipt size={11} className="text-brand-400" />
            <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest">Personal</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Mis gastos adicionales</h1>
          <p className="hidden lg:block text-xs text-[#9aa4ac] mt-1">Lo que gastas además de tus gastos fijos: almuerzos, compras, salidas…</p>
        </div>

        <MobileCollapse title="Sueldo y dinero en cuenta" openWhen={!!salary.pending}>
          <SalaryPanel salary={salary} expenses={fixed.expenses} paymentIndex={fixed.paymentIndex} />
          {outlook && <FixedOutlook cash={outlook.cash} projection={outlook.projection} />}
        </MobileCollapse>

        {catSummary.length > 0 && (
          <MobileCollapse title="Distribución por categoría">
          <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 space-y-3 shadow-xl">
            <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Distribución por categoría</p>
            <div className="space-y-3">
              {catSummary.map((c) => {
                const pct = catBase > 0 ? Math.round((c.total / catBase) * 100) : 0
                return (
                  <div key={c.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#f0fae8] font-semibold flex items-center gap-2"><AppIcon name={c.icon} size={15} className="text-brand-300" />{c.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-bold font-mono">{formatCOP(c.total)}</span>
                        <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-md bg-white/10 border border-white/15">{pct}%</span>
                      </span>
                    </div>
                    <ProgressBar value={pct} color={c.color} size="sm" />
                  </div>
                )
              })}
            </div>
          </div>
          </MobileCollapse>
        )}
      </CurvedScrollContainer>

      {/* Right pane: month filter (shared with Fijos) and the list of spends */}
      <div className="min-w-0 flex flex-col gap-5 lg:flex-1 lg:min-h-0">
        <div className="flex flex-wrap items-center justify-center gap-3 flex-shrink-0 sm:grid sm:grid-cols-[1fr_auto_1fr]">
          <span className="hidden sm:block" aria-hidden="true" />
          <div className="flex items-center justify-center gap-1.5">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="p-2 rounded-lg bg-[#0d263a] border border-white/10 hover:bg-white/10 transition" aria-label="Mes anterior">
              <ChevronLeft size={16} />
            </button>
            <div className="min-w-[160px] text-center">
              <p className="text-sm font-semibold capitalize">{monthLabel}</p>
              {bounds.period && (
                <p className="text-[10px] text-[#8a929a]">{shortDate(bounds.start)} al {shortDate(new Date(bounds.end.getTime() - 86_400_000))}</p>
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
            </div>
            <button onClick={() => setMonth(shiftMonth(month, 1))} className="p-2 rounded-lg bg-[#0d263a] border border-white/10 hover:bg-white/10 transition" aria-label="Mes siguiente">
              <ChevronRight size={16} />
            </button>
          </div>
          <Button onClick={openCreate} size="sm" notched className="w-full sm:w-auto sm:justify-self-end">
            <Plus size={15} /> Nuevo gasto adicional
          </Button>
        </div>

        {/* One card: the summary and category filter stay on top, only the list scrolls */}
        <div className={clsx('flex flex-col lg:flex-1 lg:min-h-0', framed)}>
          <div className="flex-shrink-0 border-b border-white/10 p-5 space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">
                  {category === 'all' ? 'Gastos adicionales del período' : 'Gastos adicionales de la categoría'}
                </p>
                <p className="text-2xl font-bold font-mono tabular-nums text-brand-300">{formatCOP(category === 'all' ? countedTotal : shownTotal)}</p>
              </div>
              <span className="text-xs font-mono text-[#8a929a]">{shown.length} {shown.length === 1 ? 'registro' : 'registros'}</span>
            </div>
            {historyTotal > 0 && (
              <p className="flex items-center gap-1.5 text-[11px] text-[#8a929a]">
                <History size={12} /> {formatCOP(historyTotal)} de registros anteriores no se cuentan en tus cuentas.
              </p>
            )}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => setCategory('all')}
                className={clsx(
                  'rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0',
                  category === 'all'
                    ? 'bg-brand-600 text-white border border-brand-500 shadow-sm'
                    : 'bg-[#0d263a] text-[#c7ccd1] border border-white/10 hover:bg-[#133e5f] hover:text-white',
                )}
              >
                Todos ({rows.length})
              </button>
              {/* with this many categories, only the ones the period actually uses (and the picked one) */}
              {PERSONAL_CATEGORIES.filter((cat) => category === cat.id || rows.some((r) => r.category === cat.id)).map((cat) => {
                const selected = category === cat.id
                return (
                  <button
                    key={cat.id}
                    onClick={() => setCategory(cat.id)}
                    className={clsx(
                      'rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 flex items-center gap-1.5',
                      selected ? 'text-white border shadow-sm' : 'bg-[#0d263a] text-[#c7ccd1] border border-white/10 hover:bg-[#133e5f] hover:text-white',
                    )}
                    style={selected ? { backgroundColor: cat.color, borderColor: cat.color } : undefined}
                  >
                    <AppIcon name={cat.icon} size={13} />
                    <span>{cat.label}</span>
                  </button>
                )
              })}
            </div>
            <AccountFilter accounts={salary.accounts} value={accountFilter} onChange={setAccountFilter} hasUnassigned={rows.some((r) => !r.accountId)} className="mt-2" />
          </div>

          <CurvedScrollContainer
            className="lg:flex-1 lg:min-h-0"
            {...scrollProps}
            corners="bottom-right"
          >
            {loading ? (
              <SkeletonList count={4} />
            ) : shown.length === 0 ? (
              <div className="text-center py-12 px-6">
                <EmptyMark name="receipt" />
                <p className="text-sm font-bold text-[#f0fae8]">Sin gastos adicionales en este período</p>
                <p className="text-xs text-[#8a929a] mt-1">Presiona "Nuevo gasto adicional" para registrar uno.</p>
              </div>
            ) : (
              <ExpenseTimeline
                rows={shown}
                accounts={salary.accounts}
                showToday={new Date() >= bounds.start && new Date() < bounds.end}
                onDelete={(r) => handleDelete(r.id)}
                onEdit={openEdit}
              />
            )}
          </CurvedScrollContainer>
        </div>
      </div>

      {/* New spend */}
      <Modal open={open} onClose={() => { setOpen(false); setEditing(null) }} title={editing ? 'Editar gasto adicional' : 'Nuevo gasto adicional'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <p className="text-xs text-[#9aa4ac]">
            Se descuenta de tu dinero en cuenta y de lo que te queda del período en que cae su fecha.
          </p>
          <Input
            label="Descripción"
            placeholder="ej. Almuerzo, un juego, Uber…"
            {...register('description')}
            error={errors.description?.message}
          />
          <Input
            label="Monto (COP)" money
                        placeholder="0"
            {...register('amount')}
            error={errors.amount?.message}
          />
          <Select label="Categoría" options={CATEGORY_OPTIONS} {...register('category')} />
          <Input label="Fecha" type="date" {...register('date')} error={errors.date?.message} />
          <AccountSelect label="¿De qué cuenta sale el dinero?" accounts={salary.accounts} value={accountId} onChange={setAccountId} outflow={Number(watch('amount')) || 0} />
          {!editing && <AttachmentPicker file={file} onChange={setFile} />}

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={saving} notched>
              {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar gasto adicional'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
