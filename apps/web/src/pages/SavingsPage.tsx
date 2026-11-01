import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, PlusCircle, MinusCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/hooks/useAuth'
import { addSavingsGoal, getSavingsGoals, updateSavingsGoal, deleteSavingsGoal } from '@/lib/firestore'
import { formatCOP } from '@/shared'
import { AppIcon, EmptyMark, GOAL_ICON_KEYS } from '@/components/ui/AppIcon'

const ICONS = [...GOAL_ICON_KEYS]
const COLORS = ['#52b69a', '#34a0a4', '#168aad', '#76c893', '#d9ed92', '#1a759f']

const schema = z.object({
  name:          z.string().min(1, 'Nombre requerido'),
  targetAmount:  z.coerce.number().positive('La meta debe ser mayor a 0'),
  currentAmount: z.coerce.number().min(0, 'El monto inicial no puede ser negativo'),
  icon:          z.string(),
  color:         z.string(),
  deadline:      z.string().optional(),
})

type FormData = z.infer<typeof schema>

const addSchema = z.object({ amount: z.coerce.number().positive('El monto a abonar debe ser mayor a 0') })
type AddForm = z.infer<typeof addSchema>

export default function SavingsPage() {
  const ask = useConfirm()
  const { user }             = useAuth()
  const [goals, setGoals]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen]     = useState(false)
  const [addMoneyGoal, setAddMoneyGoal] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [selectedIcon, setSelectedIcon] = useState(ICONS[0])
  const [selectedColor, setSelectedColor] = useState(COLORS[0])

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { currentAmount: 0, icon: ICONS[0], color: COLORS[0] },
  })

  const addMoneyForm = useForm<AddForm>({ resolver: zodResolver(addSchema) })

  async function load() {
    if (!user) return
    const data = await getSavingsGoals(user.uid)
    setGoals(data as any[])
    setLoading(false)
  }

  useEffect(() => { load() }, [user])

  async function onSubmit(data: FormData) {
    if (!user) return
    setSaving(true)
    await addSavingsGoal({
      userId:        user.uid,
      name:          data.name,
      targetAmount:  data.targetAmount,
      currentAmount: data.currentAmount,
      icon:          selectedIcon,
      color:         selectedColor,
      deadline:      data.deadline ? new Date(data.deadline) : undefined,
    })
    reset()
    setOpen(false)
    setSaving(false)
    load()
  }

  async function handleAddMoney(data: AddForm) {
    if (!addMoneyGoal) return
    setSaving(true)
    const newAmount = addMoneyGoal.currentAmount + data.amount
    await updateSavingsGoal(addMoneyGoal.id, { currentAmount: Math.min(newAmount, addMoneyGoal.targetAmount) })
    addMoneyForm.reset()
    setAddMoneyGoal(null)
    setSaving(false)
    load()
  }

  async function handleDelete(id: string) {
    if (!(await ask('¿Eliminar esta meta de ahorro?', { title: 'Eliminar meta de ahorro' }))) return
    await deleteSavingsGoal(id)
    setGoals((prev) => prev.filter((g) => g.id !== id))
  }

  const totalSaved  = goals.reduce((s, g) => s + g.currentAmount, 0)
  const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Ahorros</h1>
          <p className="text-sm text-gray-500">
            {formatCOP(totalSaved)} de {formatCOP(totalTarget)}
          </p>
        </div>
        <Button onClick={() => setOpen(true)} size="sm"><Plus size={16} /> Nueva meta</Button>
      </div>

      {/* Global progress */}
      {goals.length > 0 && (
        <Card className="py-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>Progreso total</span>
            <span>{totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0}%</span>
          </div>
          <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-500 transition-all"
              style={{ width: `${totalTarget > 0 ? Math.min((totalSaved / totalTarget) * 100, 100) : 0}%` }}
            />
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>
      ) : goals.length === 0 ? (
        <Card className="text-center py-10">
          <EmptyMark name="savings" />
          <p className="text-sm text-gray-500">No tienes metas de ahorro aún.</p>
          <p className="text-xs text-gray-400 mt-1">Crea tu primera meta para empezar.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {goals.map((g: any) => {
            const pct = g.targetAmount > 0 ? Math.min(Math.round((g.currentAmount / g.targetAmount) * 100), 100) : 0
            return (
              <Card key={g.id} className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                    style={{ backgroundColor: g.color + '20' }}>
                    <AppIcon name={g.icon} size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{g.name}</p>
                    <p className="text-xs text-gray-400">
                      {formatCOP(g.currentAmount)} / {formatCOP(g.targetAmount)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold" style={{ color: g.color }}>{pct}%</p>
                  </div>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: g.color }} />
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => setAddMoneyGoal(g)}>
                    <PlusCircle size={14} /> Abonar
                  </Button>
                  <button onClick={() => handleDelete(g.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition">
                    <Trash2 size={15} />
                  </button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal open={open} onClose={() => setOpen(false)} title="Nueva meta de ahorro">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input label="Nombre de la meta" placeholder="ej. Vacaciones, Carro…" {...register('name')} error={errors.name?.message} />
          <Input label="Monto objetivo (COP)" money placeholder="0" {...register('targetAmount')} error={errors.targetAmount?.message} />
          <Input label="Ya tengo ahorrado (COP)" money placeholder="0" {...register('currentAmount')} />
          <Input label="Fecha límite (opcional)" type="date" {...register('deadline')} />
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Ícono</p>
            <div className="flex gap-2 flex-wrap">
              {ICONS.map((ic) => (
                <button key={ic} type="button"
                  onClick={() => setSelectedIcon(ic)}
                  className={`text-xl p-1.5 rounded-xl transition ${selectedIcon === ic ? 'bg-brand-100 ring-2 ring-brand-400' : 'hover:bg-gray-100'}`}>
                  <AppIcon name={ic} size={18} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Color</p>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setSelectedColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${selectedColor === c ? 'ring-2 ring-offset-2' : ''}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={saving}>{saving ? 'Guardando…' : 'Crear meta'}</Button>
          </div>
        </form>
      </Modal>

      {/* Add money modal */}
      <Modal open={!!addMoneyGoal} onClose={() => setAddMoneyGoal(null)} title={`Abonar a "${addMoneyGoal?.name}"`}>
        <form onSubmit={addMoneyForm.handleSubmit(handleAddMoney)} className="space-y-4">
          <p className="text-sm text-gray-500">
            Ahorrado: <strong>{formatCOP(addMoneyGoal?.currentAmount ?? 0)}</strong> de <strong>{formatCOP(addMoneyGoal?.targetAmount ?? 0)}</strong>
          </p>
          <Input label="Monto a abonar (COP)" money placeholder="0" {...addMoneyForm.register('amount')} error={addMoneyForm.formState.errors.amount?.message} />
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setAddMoneyGoal(null)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={saving}>{saving ? 'Guardando…' : 'Abonar'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
