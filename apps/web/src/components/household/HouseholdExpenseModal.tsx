import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { ShoppingBag } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Input, preventNegativeNumberKey } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { createHouseholdExpense, notifyHouseholdMembers } from '@/lib/firestore'
import { formatCOP, HOUSEHOLD_DEBT_CATEGORIES } from '@/shared'
import type { ExpenseShareInput, SplitMode } from '@/shared'

const CAT_OPTIONS = HOUSEHOLD_DEBT_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))
const SPLIT_OPTIONS: { value: SplitMode; label: string }[] = [
  { value: 'equal',      label: 'Partes iguales' },
  { value: 'percentage', label: 'Porcentaje personalizado' },
  { value: 'fixed',      label: 'Monto fijo por persona' },
]

const schema = z.object({
  description: z.string().min(1, 'Describe el gasto'),
  amount:      z.coerce.number().positive('El monto debe ser mayor a 0'),
  paidBy:      z.string().min(1),
  splitMode:   z.enum(['equal', 'percentage', 'fixed']),
  partnerShareInput: z.coerce.number().positive('Debe ser mayor a 0').optional(),
  category:    z.string().min(1),
  date:        z.string().min(1),
  hasDueDate:  z.boolean(),
  dueDate:     z.string().optional(),
  notes:       z.string().optional(),
}).refine((d) => d.splitMode === 'equal' || (d.partnerShareInput !== undefined && d.partnerShareInput > 0), {
  message: 'Indica un valor positivo para el otro integrante', path: ['partnerShareInput'],
}).refine((d) => d.splitMode !== 'percentage' || (d.partnerShareInput !== undefined && d.partnerShareInput <= 100), {
  message: 'El porcentaje no puede superar el 100%', path: ['partnerShareInput'],
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
  // who shares the expense (everyone by default); the payer always takes part
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const { register, handleSubmit, watch, reset, setValue, formState: { errors } } = useForm<FormValues>({
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
  const participants = members.filter((m) => m.uid === paidBy || !excluded.has(m.uid))
  // percentage / fixed amounts only make sense between two people
  const other      = participants.length === 2 ? participants.find((m) => m.uid !== paidBy) : undefined
  const splitOptions = participants.length === 2 ? SPLIT_OPTIONS : SPLIT_OPTIONS.filter((o) => o.value === 'equal')
  const effectiveMode: SplitMode = participants.length === 2 ? splitMode : 'equal'
  const toggleMember = (uid: string) => setExcluded((prev) => { const n = new Set(prev); n.has(uid) ? n.delete(uid) : n.add(uid); return n })

  useEffect(() => { if (participants.length !== 2 && splitMode !== 'equal') setValue('splitMode', 'equal') }, [participants.length, splitMode])

  function resetForm() {
    setExcluded(new Set())
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
    if (participants.length < 2) {
      showToast('Elige al menos a otra persona con quien dividir el gasto', 'error')
      return
    }
    const payer       = participants.find((m) => m.uid === data.paidBy)!
    const counterpart = participants.find((m) => m.uid !== data.paidBy)!
    const otherShare   = data.partnerShareInput ?? 0

    const mode: SplitMode = participants.length === 2 ? data.splitMode : 'equal'
    const shareInputs: ExpenseShareInput[] = mode === 'equal'
      ? participants.map((m) => ({ memberId: m.uid }))
      : mode === 'percentage'
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
        splitMode:    mode,
        shareInputs,
        dueDate:      data.hasDueDate && data.dueDate ? new Date(data.dueDate + 'T12:00:00') : null,
        notes:        data.notes ?? '',
        registeredBy: currentUserUid,
      })
      resetForm()
      onClose()
      onCreated()
      showToast('Gasto compartido registrado', 'success')
      const me = members.find((m) => m.uid === currentUserUid)?.name || 'Alguien'
      notifyHouseholdMembers(participants.map((m) => m.uid), {
        fromUid: currentUserUid, zone: 'hogar', severity: 'info',
        title: `${me} registró un gasto compartido`, body: `${data.description} · ${formatCOP(data.amount)}.`, link: `/hogar?id=${householdId}`,
      }).catch(() => { /* never undo what was saved */ })
    } catch (err: any) {
      showToast(err?.message ?? 'Error al registrar el gasto', 'error')
    } finally {
      setSaving(false)
    }
  }

  const otherPreview = (() => {
    if (!amount || !other) return null
    if (effectiveMode === 'equal') return amount / participants.length
    if (watch('partnerShareInput') === undefined) return null
    const v = watch('partnerShareInput') as number
    return splitMode === 'percentage' ? (amount * v) / 100 : v
  })()

  return (
    <Modal open={open} onClose={() => { onClose(); resetForm() }} title="Nuevo gasto compartido">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label="Descripción" placeholder="ej. Mueble para la sala" {...register('description')} error={errors.description?.message} />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-[#dcf1eb]">Monto total</label>
          <div className="currency-field has-suffix">
            <span className="currency-affix-prefix">$</span>
            <MoneyInput
              placeholder="0"
              {...register('amount')}
              className="w-full rounded-xl border border-brand-500/20 bg-[#0a1f2f] px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              aria-label="Monto total en pesos colombianos"
            />
            <span className="currency-affix-suffix">COP</span>
          </div>
          {errors.amount?.message && <p className="text-xs text-red-400">{errors.amount.message}</p>}
        </div>

        <Select label="¿Quién pagó?" options={members.map((m) => ({ value: m.uid, label: m.name }))} {...register('paidBy')} />
        <Select label="Categoría" options={CAT_OPTIONS} {...register('category')} />
        <Input label="Fecha del gasto" type="date" {...register('date')} />

        {members.length > 2 && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-[#dcf1eb]">¿Entre quiénes se divide?</legend>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const isPayer = m.uid === paidBy
                const on = isPayer || !excluded.has(m.uid)
                return (
                  <button
                    key={m.uid}
                    type="button"
                    disabled={isPayer}
                    aria-pressed={on}
                    onClick={() => toggleMember(m.uid)}
                    className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition ${on ? 'border-brand-400/70 bg-brand-500/15 text-brand-300' : 'border-white/10 text-[#8a929a] hover:border-white/25'} ${isPayer ? 'cursor-default' : ''}`}
                    title={isPayer ? 'Quien pagó siempre participa' : undefined}
                  >{m.name}</button>
                )
              })}
            </div>
          </fieldset>
        )}

        <Select label="¿Cómo se divide?" options={splitOptions} {...register('splitMode')} />

        {effectiveMode !== 'equal' && other && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[#dcf1eb]">
              {splitMode === 'percentage' ? `Porcentaje que le corresponde a ${other.name}` : `Monto que le corresponde a ${other.name}`}
            </label>
            <div className="currency-field">
              <span className="currency-affix-prefix">{splitMode === 'percentage' ? '%' : '$'}</span>
              {splitMode === 'percentage' ? (
                <input
                  type="number"
                  min="0"
                  step="any"
                  max={100}
                  placeholder="50"
                  onKeyDown={preventNegativeNumberKey}
                  {...register('partnerShareInput')}
                  className="w-full rounded-xl border border-brand-500/20 bg-[#0a1f2f] px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  aria-label={`Porcentaje para ${other.name}`}
                />
              ) : (
                <MoneyInput
                  placeholder="400000"
                  {...register('partnerShareInput')}
                  className="w-full rounded-xl border border-brand-500/20 bg-[#0a1f2f] px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  aria-label={`Monto para ${other.name} en pesos colombianos`}
                />
              )}
            </div>
            {errors.partnerShareInput?.message && <p className="text-xs text-red-400">{errors.partnerShareInput.message}</p>}
          </div>
        )}

        {otherPreview !== null && other && (
          <p className="text-xs text-[#9aa4ac] bg-[#0d263a] border border-white/10 rounded-xl p-3">
            {other.name} quedará debiendo <span className="font-semibold font-mono text-amber-300">{formatCOP(Math.round(otherPreview))}</span>
          </p>
        )}
        {participants.length > 2 && !!amount && (
          <p className="text-xs text-[#9aa4ac] bg-[#0d263a] border border-white/10 rounded-xl p-3">
            Cada uno de los otros {participants.length - 1} le debe a {members.find((m) => m.uid === paidBy)?.name} <span className="font-semibold font-mono text-amber-300">{formatCOP(Math.floor(amount / participants.length))}</span>
          </p>
        )}

        <label className="flex items-center gap-2 text-sm text-[#dcf1eb] cursor-pointer select-none">
          <input type="checkbox" {...register('hasDueDate')} className="cursor-pointer" />
          Acordamos una fecha límite de pago
        </label>
        {hasDueDate ? (
          <Input label="Fecha límite" type="date" {...register('dueDate')} error={errors.dueDate?.message} />
        ) : (
          <p className="text-xs text-[#8a929a]">Sin fecha pactada: la deuda queda abierta hasta que se liquide.</p>
        )}

        <Input label="Notas (opcional)" placeholder="ej. Acordado el 29 oct" {...register('notes')} />

        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => { onClose(); resetForm() }}>Cancelar</Button>
          <Button type="submit" notched className="flex-1" disabled={saving}>
            <ShoppingBag size={14} /> {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
