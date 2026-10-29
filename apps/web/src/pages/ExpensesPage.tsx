import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2 } from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SkeletonList } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { addExpense, getExpenses, deleteExpense } from '@/lib/firestore'
import { formatCOP, PERSONAL_CATEGORIES } from '@/shared'
import type { ExpenseType } from '@/shared'
import { clsx } from 'clsx'

const schema = z.object({
  description: z.string().min(1, 'Descripción requerida'),
  amount:      z.coerce.number().positive('Monto debe ser mayor a 0'),
  category:    z.string().min(1),
  date:        z.string().min(1),
  type:        z.enum(['fixed', 'variable']),
})

type FormData = z.infer<typeof schema>

const CATEGORY_OPTIONS = PERSONAL_CATEGORIES.map((c) => ({ value: c.id, label: `${c.icon} ${c.label}` }))
const TYPE_OPTIONS     = [{ value: 'variable', label: 'Variable' }, { value: 'fixed', label: 'Fijo' }]

function groupByDate(expenses: any[]): { label: string; items: any[] }[] {
  const today: any[]     = []
  const yesterday: any[] = []
  const older: any[]     = []

  for (const e of expenses) {
    const d = e.date instanceof Date ? e.date : new Date(e.date)
    if (isToday(d))     today.push(e)
    else if (isYesterday(d)) yesterday.push(e)
    else older.push(e)
  }

  const groups: { label: string; items: any[] }[] = []
  if (today.length)     groups.push({ label: 'Hoy',     items: today })
  if (yesterday.length) groups.push({ label: 'Ayer',    items: yesterday })
  if (older.length)     groups.push({ label: 'Anterior', items: older })
  return groups
}

export default function ExpensesPage() {
  const { user }                = useAuth()
  const { showToast }           = useToast()
  const [expenses, setExpenses] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [open, setOpen]         = useState(false)
  const [saving, setSaving]     = useState(false)
  const [activeCategory, setActiveCategory] = useState<string>('all')

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date:     format(new Date(), 'yyyy-MM-dd'),
      type:     'variable',
      category: 'otro',
    },
  })

  async function load() {
    if (!user) return
    const data = await getExpenses(user.uid)
    setExpenses(data as any[])
    setLoading(false)
  }

  useEffect(() => { load() }, [user])

  async function onSubmit(data: FormData) {
    if (!user) return
    setSaving(true)
    try {
      await addExpense({
        userId:      user.uid,
        description: data.description,
        amount:      data.amount,
        category:    data.category,
        date:        new Date(data.date + 'T12:00:00'),
        type:        data.type as ExpenseType,
        isRecurring: false,
      })
      reset()
      setOpen(false)
      load()
      showToast('Gasto guardado', 'success')
    } catch {
      showToast('Error al guardar el gasto', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este gasto?')) return
    await deleteExpense(id)
    setExpenses((prev) => prev.filter((e) => e.id !== id))
    showToast('Gasto eliminado', 'info')
  }

  const filtered = activeCategory === 'all'
    ? expenses
    : expenses.filter((e) => e.category === activeCategory)

  const total   = filtered.reduce((s: number, e: any) => s + e.amount, 0)
  const groups  = groupByDate(filtered)

  // Category summary
  const catSummary = PERSONAL_CATEGORIES.map((cat) => ({
    ...cat,
    total: expenses.filter((e) => e.category === cat.id).reduce((s: number, e: any) => s + e.amount, 0),
  })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total)

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0f172a]">Mis Gastos</h1>
          <p className="text-sm text-[#64748b]">{formatCOP(total)} en total</p>
        </div>
        <Button onClick={() => setOpen(true)} size="sm">
          <Plus size={16} /> Agregar
        </Button>
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
        <button
          onClick={() => setActiveCategory('all')}
          className={clsx(
            'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all flex-shrink-0',
            activeCategory === 'all'
              ? 'bg-brand-600 text-white shadow-sm'
              : 'bg-white text-gray-500 border border-gray-200',
          )}
        >
          Todos
        </button>
        {PERSONAL_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={clsx(
              'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 flex items-center gap-1',
              activeCategory === cat.id
                ? 'text-white shadow-sm'
                : 'bg-white text-gray-500 border border-gray-200',
            )}
            style={activeCategory === cat.id ? { backgroundColor: cat.color } : undefined}
          >
            {cat.icon} {cat.label}
          </button>
        ))}
      </div>

      {/* Category bar summary */}
      {catSummary.length > 0 && activeCategory === 'all' && (
        <Card className="p-4">
          <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">
            Por categoría
          </p>
          <div className="space-y-2">
            {catSummary.slice(0, 4).map((c) => {
              const pct = total > 0 ? Math.round((c.total / total) * 100) : 0
              return (
                <div key={c.id}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs text-gray-600">{c.icon} {c.label}</span>
                    <span className="text-xs font-semibold text-gray-700 tabular-nums">{formatCOP(c.total)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: c.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {loading ? (
        <SkeletonList count={4} />
      ) : filtered.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-5xl mb-3">💸</p>
          <p className="text-sm font-semibold text-gray-700">Sin gastos registrados</p>
          <p className="text-xs text-gray-400 mt-1">Toca "Agregar" para añadir uno.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(({ label, items }) => (
            <div key={label}>
              <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-2 px-1">
                {label}
              </p>
              <div className="space-y-2">
                {items.map((e: any) => {
                  const cat = PERSONAL_CATEGORIES.find((c) => c.id === e.category)
                  return (
                    <Card key={e.id} className="flex items-center gap-3 p-3.5 slide-up">
                      <div
                        className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                        style={{ backgroundColor: (cat?.color ?? '#6b7280') + '20' }}
                      >
                        {cat?.icon ?? '📦'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{e.description}</p>
                        <p className="text-xs text-gray-400">
                          {format(e.date instanceof Date ? e.date : new Date(e.date), 'dd MMM', { locale: es })}
                          {' · '}{cat?.label ?? e.category}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-bold text-gray-900 tabular-nums">
                          {formatCOP(e.amount)}
                        </span>
                        <button
                          onClick={() => handleDelete(e.id)}
                          className="p-1 text-gray-300 hover:text-red-500 transition"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo gasto">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label="Descripción"
            placeholder="ej. Almuerzo, Netflix…"
            {...register('description')}
            error={errors.description?.message}
          />
          <Input
            label="Monto (COP)"
            type="number"
            placeholder="0"
            {...register('amount')}
            error={errors.amount?.message}
          />
          <Select label="Categoría" options={CATEGORY_OPTIONS} {...register('category')} />
          <Select label="Tipo" options={TYPE_OPTIONS} {...register('type')} />
          <Input label="Fecha" type="date" {...register('date')} error={errors.date?.message} />
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
