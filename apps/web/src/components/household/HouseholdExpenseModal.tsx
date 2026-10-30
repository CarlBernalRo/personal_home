import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { ShoppingBag } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { createHouseholdExpense } from '@/lib/firestore'
import { formatCOP, HOUSEHOLD_DEBT_CATEGORIES } from '@/shared'
import type { ExpenseShareInput, SplitMode } from '@/shared'

const CAT_OPTIONS = HOUSEHOLD_DEBT_CATEGORIES.map((c) => ({ value: c.id, label: `${c.icon} ${c.label}` }))
const SPLIT_OPTIONS: { value: SplitMode; label: string }[] = [
  { value: 'equal',      label: 'Partes iguales' },
  { value: 'percentage', label: 'Porcentaje personalizado' },
  { value: 'fixed',      label: 'Monto fijo por persona' },
]

const schema = z.object({
  description: z.string().min(1, 'Describe el gasto'),
  amount:      z.coerce.number().positive('Monto mayor a 0'),
  paidBy:      z.string().min(1),
  splitMode:   z.enum(['equal', 'percentage', 'fixed']),
  partnerShareInput: z.coerce.number().optional(),
  category:    z.string().min(1),
  date:        z.string().min(1),
  hasDueDate:  z.boolean(),
  dueDate:     z.string().optional(),
  notes:       z.string().optional(),
}).refine((d) => d.splitMode === 'equal' || d.partnerShareInput !== undefined, {
  message: 'Indica la parte que le corresponde al otro integrante', path: ['partnerShareInput'],
}).refine((d) => !d.hasDueDate || !!d.dueDate, {
  message: 'Indica la fecha acordada', path: ['dueDate'],
})

type FormValues = z.infer<typeof schema>

export interface HouseholdExpenseMember {
  uid: string
  name: string
}

export function HouseholdExpenseModal({ open, onClose, householdId, members, currentUserUid, onCreated }: {
  open: boolean
  onClose: () => void
  householdId: string
  members: HouseholdExpenseMember[]
  currentUserUid: string
  onCreated: () => void
}) {
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date:       format(new Date(), 'yyyy-MM-dd'),
      paidBy:     currentUserUid,
      splitMode:  'equal',
      category:   HOUSEHOLD_DEBT_CATEGORIES[0].id,
      hasDueDate: false,
    },
  })

  const splitMode  = watch('splitMode')
  const paidBy     = watch('paidBy')
  const amount     = watch('amount')
  const hasDueDate = watch('hasDueDate')
  const other      = members.find((m) => m.uid !== paidBy)

  function resetForm() {
    reset({
      date: format(new Date(), 'yyyy-MM-dd'), paidBy: currentUserUid,
      splitMode: 'equal', category: HOUSEHOLD_DEBT_CATEGORIES[0].id, hasDueDate: false,
    })
  }

  async function onSubmit(data: FormValues) {
    if (members.length < 2) {
      showToast('Necesitas que tu pareja se una al hogar antes de dividir un gasto', 'error')
      return
    }
    const payer       = members.find((m) => m.uid === data.paidBy)!
    const counterpart = members.find((m) => m.uid !== data.paidBy)!
    const otherShare   = data.partnerShareInput ?? 0

    const shareInputs: ExpenseShareInput[] = data.splitMode === 'equal'
      ? members.map((m) => ({ memberId: m.uid }))
      : data.splitMode === 'percentage'
        ? [
            { memberId: counterpart.uid, percentage: otherShare },
            { memberId: payer.uid,       percentage: 100 - otherShare },
          ]
        : [
            { memberId: counterpart.uid, fixedAmount: otherShare },
            { memberId: payer.uid,       fixedAmount: data.amount - otherShare },
          ]

    setSaving(true)
    try {
      await createHouseholdExpense({
        householdId,
        description:  data.description,
        amount:       data.amount,
        category:     data.category,
        date:         new Date(data.date + 'T12:00:00'),
        paidBy:       data.paidBy,
        splitMode:    data.splitMode,
        shareInputs,
        dueDate:      data.hasDueDate && data.dueDate ? new Date(data.dueDate + 'T12:00:00') : null,
        notes:        data.notes ?? '',
        registeredBy: currentUserUid,
      })
      resetForm()
      onClose()
      onCreated()
      showToast('Gasto compartido registrado', 'success')
    } catch (err: any) {
      showToast(err?.message ?? 'Error al registrar el gasto', 'error')
    } finally {
      setSaving(false)
    }
  }

  const otherPreview = (() => {
    if (!amount || !other) return null
    if (splitMode === 'equal') return amount / members.length
    if (watch('partnerShareInput') === undefined) return null
    const v = watch('partnerShareInput') as number
    return splitMode === 'percentage' ? (amount * v) / 100 : v
  })()

  return (
    <Modal open={open} onClose={() => { onClose(); resetForm() }} title="Nuevo gasto compartido" dark>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label="Descripción" placeholder="ej. Mueble para la sala" {...register('description')} error={errors.description?.message} />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Monto total</label>
          <div className="currency-field has-suffix">
            <span className="currency-affix-prefix">$</span>
            <input
              type="number"
              placeholder="0"
              {...register('amount')}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              aria-label="Monto total en pesos colombianos"
            />
            <span className="currency-affix-suffix">COP</span>
          </div>
          {errors.amount?.message && <p className="text-xs text-red-500">{errors.amount.message}</p>}
        </div>

        <Select label="¿Quién pagó?" options={members.map((m) => ({ value: m.uid, label: m.name }))} {...register('paidBy')} />
        <Select label="Categoría" options={CAT_OPTIONS} {...register('category')} />
        <Input label="Fecha del gasto" type="date" {...register('date')} />

        <Select label="¿Cómo se divide?" options={SPLIT_OPTIONS} {...register('splitMode')} />

        {splitMode !== 'equal' && other && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              {splitMode === 'percentage' ? `Porcentaje que le corresponde a ${other.name}` : `Monto que le corresponde a ${other.name}`}
            </label>
            <div className="currency-field">
              <span className="currency-affix-prefix">{splitMode === 'percentage' ? '%' : '$'}</span>
              <input
                type="number"
                placeholder={splitMode === 'percentage' ? '50' : '400000'}
                {...register('partnerShareInput')}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                aria-label={splitMode === 'percentage' ? `Porcentaje para ${other.name}` : `Monto para ${other.name} en pesos colombianos`}
              />
            </div>
            {errors.partnerShareInput?.message && <p className="text-xs text-red-500">{errors.partnerShareInput.message}</p>}
          </div>
        )}

        {otherPreview !== null && other && (
          <p className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3">
            {other.name} quedará debiendo <span className="font-semibold text-gray-800">{formatCOP(Math.round(otherPreview))}</span>
          </p>
        )}

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" {...register('hasDueDate')} className="rounded border-gray-300" />
          Acordamos una fecha límite de pago
        </label>
        {hasDueDate ? (
          <Input label="Fecha límite" type="date" {...register('dueDate')} error={errors.dueDate?.message} />
        ) : (
          <p className="text-xs text-gray-400">Sin fecha pactada: la deuda queda abierta hasta que se liquide.</p>
        )}

        <Input label="Notas (opcional)" placeholder="ej. Acordado el 29 oct" {...register('notes')} />

        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => { onClose(); resetForm() }}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={saving}>
            <ShoppingBag size={14} /> {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
