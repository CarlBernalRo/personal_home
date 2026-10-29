import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Check, Clock, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SkeletonList } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import {
  addFixedExpense, getFixedExpenses, deleteFixedExpense,
  addFixedExpensePayment, getFixedExpensePayments, deleteFixedExpensePayment,
} from '@/lib/firestore'
import { formatCOP, FIXED_EXPENSE_CATEGORIES } from '@/shared'

const CATEGORY_OPTIONS = FIXED_EXPENSE_CATEGORIES.map((c) => ({ value: c.id, label: `${c.icon} ${c.label}` }))
const FREQUENCY_OPTIONS = [
  { value: 'fijo', label: 'Fijo (mensual)' },
  { value: 'ocasional', label: 'Ocasional' },
]

const addExpenseSchema = z.object({
  concept:         z.string().min(1, 'Concepto requerido'),
  estimatedAmount: z.coerce.number().positive('Monto mayor a 0'),
  paymentDay:      z.coerce.number().min(1).max(31).nullable().optional(),
  category:        z.string().min(1),
  frequency:       z.enum(['fijo', 'ocasional']),
  notes:           z.string().optional(),
})

const paySchema = z.object({
  paidAmount: z.coerce.number().positive('Monto mayor a 0'),
})

type AddExpenseForm = z.infer<typeof addExpenseSchema>
type PayForm = z.infer<typeof paySchema>

export default function FixedExpensesPage() {
  const { user }              = useAuth()
  const { showToast }         = useToast()
  const [fixedExp, setFixedExp]   = useState<any[]>([])
  const [payments, setPayments]   = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [openAdd, setOpenAdd]     = useState(false)
  const [payItem, setPayItem]     = useState<any>(null)
  const [saving, setSaving]       = useState(false)

  const now          = new Date()
  const currentMonth = format(now, 'yyyy-MM')

  const addForm = useForm<AddExpenseForm>({
    resolver: zodResolver(addExpenseSchema),
    defaultValues: { category: 'servicios', frequency: 'fijo', notes: '' },
  })

  const payForm = useForm<PayForm>({ resolver: zodResolver(paySchema) })

  async function load() {
    if (!user) return
    const [fxExp, fxPay] = await Promise.all([
      getFixedExpenses(user.uid),
      getFixedExpensePayments(user.uid, currentMonth),
    ])
    setFixedExp(fxExp as any[])
    setPayments(fxPay as any[])
    setLoading(false)
  }

  useEffect(() => { load() }, [user])

  async function onAddExpense(data: AddExpenseForm) {
    if (!user) return
    setSaving(true)
    try {
      await addFixedExpense({
        userId:          user.uid,
        concept:         data.concept,
        estimatedAmount: data.estimatedAmount,
        paymentDay:      data.paymentDay ?? null,
        category:        data.category,
        isVariable:      data.frequency === 'ocasional',
        notes:           data.notes ?? '',
        frequency:       data.frequency,
        active:          true,
      })
      addForm.reset()
      setOpenAdd(false)
      load()
      showToast('Gasto fijo agregado', 'success')
    } catch {
      showToast('Error al agregar', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function onPay(data: PayForm) {
    if (!user || !payItem) return
    setSaving(true)
    try {
      await addFixedExpensePayment({
        fixedExpenseId: payItem.id as string,
        userId:         user.uid,
        concept:        payItem.concept as string,
        paidAmount:     data.paidAmount,
        month:          currentMonth,
        paymentDate:    new Date(),
        notes:          '',
      })
      payForm.reset()
      setPayItem(null)
      load()
      showToast('Pago registrado', 'success')
    } catch {
      showToast('Error al registrar pago', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleUnpay(paymentId: string) {
    await deleteFixedExpensePayment(paymentId)
    load()
    showToast('Pago eliminado', 'info')
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Archivar este gasto fijo?')) return
    await deleteFixedExpense(id)
    load()
    showToast('Gasto fijo archivado', 'info')
  }

  const paidMap = new Map<string, any>()
  for (const p of payments) {
    paidMap.set(p.fixedExpenseId as string, p)
  }

  const totalEstimated = fixedExp.reduce((s: number, e: any) => s + (e.estimatedAmount as number), 0)
  const totalPaid      = payments.reduce((s: number, p: any) => s + (p.paidAmount as number), 0)

  const monthLabel = format(now, "MMMM yyyy", { locale: es })

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0f172a]">Gastos Fijos</h1>
          <p className="text-sm text-[#64748b] capitalize">{monthLabel}</p>
        </div>
        <Button onClick={() => setOpenAdd(true)} size="sm">
          <Plus size={16} /> Agregar
        </Button>
      </div>

      {/* Monthly summary */}
      {fixedExp.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider">
              Progreso del mes
            </p>
            <span className="text-xs font-semibold text-gray-600">
              {paidMap.size} / {fixedExp.length} pagados
            </span>
          </div>
          <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div
              className="h-full rounded-full bg-brand-500 transition-all"
              style={{
                width: `${fixedExp.length > 0 ? Math.round((paidMap.size / fixedExp.length) * 100) : 0}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[#64748b]">
              Pagado: <span className="font-bold text-brand-600 tabular-nums">{formatCOP(totalPaid)}</span>
            </span>
            <span className="text-[#64748b]">
              Estimado: <span className="font-bold text-gray-700 tabular-nums">{formatCOP(totalEstimated)}</span>
            </span>
          </div>
        </Card>
      )}

      {loading ? (
        <SkeletonList count={4} />
      ) : fixedExp.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-5xl mb-3">📋</p>
          <p className="text-sm font-semibold text-gray-700">Sin gastos fijos</p>
          <p className="text-xs text-gray-400 mt-1">
            Agrega tus gastos recurrentes como arriendo, servicios, etc.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {fixedExp.map((fe: any) => {
            const cat     = FIXED_EXPENSE_CATEGORIES.find((c) => c.id === fe.category)
            const payment = paidMap.get(fe.id as string)
            const isPaid  = !!payment

            return (
              <Card key={fe.id as string} className="p-4 slide-up">
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                    style={{ backgroundColor: (cat?.color ?? '#6b7280') + '20' }}
                  >
                    {cat?.icon ?? '📦'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-800 truncate">{fe.concept as string}</p>
                      <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${
                        isPaid ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'
                      }`}>
                        {isPaid ? <><Check size={10} /> Pagado</> : <><Clock size={10} /> Pendiente</>}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {cat?.label}
                      {fe.paymentDay ? ` · Día ${fe.paymentDay as number}` : ''}
                    </p>
                    {isPaid && (
                      <p className="text-xs text-green-600 mt-0.5">
                        Pagado: {formatCOP(payment.paidAmount as number)}
                        {' · '}{format(payment.paymentDate instanceof Date ? payment.paymentDate : new Date(payment.paymentDate), 'dd MMM', { locale: es })}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className="text-sm font-bold text-gray-900 tabular-nums">
                      {formatCOP(fe.estimatedAmount as number)}
                    </span>
                    <div className="flex gap-1">
                      {isPaid ? (
                        <button
                          onClick={() => handleUnpay(payment.id as string)}
                          className="text-[10px] px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500 transition"
                        >
                          Deshacer
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            payForm.setValue('paidAmount', fe.estimatedAmount as number)
                            setPayItem(fe)
                          }}
                          className="text-[10px] px-2 py-1 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 transition font-semibold"
                        >
                          Pagar
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(fe.id as string)}
                        className="p-1 text-gray-300 hover:text-red-500 transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add modal */}
      <Modal open={openAdd} onClose={() => setOpenAdd(false)} title="Nuevo gasto fijo">
        <form onSubmit={addForm.handleSubmit(onAddExpense)} className="space-y-4">
          <Input
            label="Concepto"
            placeholder="ej. Arriendo, Netflix, Gym…"
            {...addForm.register('concept')}
            error={addForm.formState.errors.concept?.message}
          />
          <Input
            label="Monto estimado (COP)"
            type="number"
            placeholder="0"
            {...addForm.register('estimatedAmount')}
            error={addForm.formState.errors.estimatedAmount?.message}
          />
          <Input
            label="Día de pago (opcional)"
            type="number"
            placeholder="ej. 5"
            min={1}
            max={31}
            {...addForm.register('paymentDay')}
          />
          <Select label="Categoría" options={CATEGORY_OPTIONS} {...addForm.register('category')} />
          <Select label="Frecuencia" options={FREQUENCY_OPTIONS} {...addForm.register('frequency')} />
          <Input
            label="Notas (opcional)"
            placeholder="ej. Incluye internet"
            {...addForm.register('notes')}
          />
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenAdd(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Pay modal */}
      <Modal
        open={!!payItem}
        onClose={() => setPayItem(null)}
        title={`Pagar: ${payItem?.concept ?? ''}`}
      >
        <form onSubmit={payForm.handleSubmit(onPay)} className="space-y-4">
          <p className="text-sm text-gray-500">
            Estimado: <strong>{formatCOP(payItem?.estimatedAmount ?? 0)}</strong>
          </p>
          <Input
            label="Monto pagado (COP)"
            type="number"
            placeholder="0"
            {...payForm.register('paidAmount')}
            error={payForm.formState.errors.paidAmount?.message}
          />
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setPayItem(null)}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? 'Guardando…' : 'Registrar pago'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
