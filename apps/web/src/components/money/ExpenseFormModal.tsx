import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { ObservationField } from '@/components/ui/ObservationField'
import { AttachmentPicker } from '@/components/pending/AttachmentPicker'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { withAttachment } from '@/lib/attachments'
import { PERSONAL_CATEGORIES } from '@/shared'
import type { SalaryState } from '@/hooks/useSalary'
import { TagPicker } from '@/components/ui/TagPicker'

const schema = z.object({
  description: z.string().min(1, 'Descripción requerida'),
  amount:      z.coerce.number().positive('Monto debe ser mayor a 0'),
  category:    z.string().min(1),
  date:        z.string().min(1, 'Fecha requerida'),
})
type FormData = z.infer<typeof schema>

const CATEGORY_OPTIONS = PERSONAL_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))

/** A spend being corrected: what the form starts from. */
export interface EditableSpend {
  id: string
  description: string
  amount: number
  category: string
  date: Date
  accountId?: string
  notes?: string
  tagIds?: string[]
  /** Registered against an occasional expense: the title says so. */
  occasional?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  /** The spend being corrected (null = a new additional spend). */
  editing: EditableSpend | null
  salary: SalaryState
}

/** New additional spend, or the correction of one already registered (additional or occasional). */
export function ExpenseFormModal({ open, onClose, editing, salary }: Props) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [accountId, setAccountId] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: { date: format(new Date(), 'yyyy-MM-dd'), category: 'otro' },
  })

  useEffect(() => {
    if (!open) return
    setFile(null)
    if (editing) {
      reset({ description: editing.description, amount: editing.amount, category: editing.category || 'otro', date: format(editing.date, 'yyyy-MM-dd') })
      setAccountId(editing.accountId ?? '')
      setNotes(editing.notes ?? '')
      setTagIds(editing.tagIds ?? [])
    } else {
      reset({ date: format(new Date(), 'yyyy-MM-dd'), category: 'otro', description: '', amount: undefined as any })
      setAccountId(salary.pickAccount())
      setNotes('')
      setTagIds([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  async function onSubmit(data: FormData) {
    setSaving(true)
    try {
      const values = {
        description: data.description.trim(),
        amount:      data.amount,
        category:    data.category,
        date:        new Date(data.date + 'T12:00:00'),
        accountId,
        notes,
        tagIds,
      }
      if (editing) {
        await salary.editPersonalExpense(editing.id, values, { amount: editing.amount, accountId: editing.accountId })
      } else {
        await withAttachment(user!.uid, file, (attachmentId) => salary.addPersonalExpense({ ...values, attachmentId }))
      }
      salary.rememberAccount(accountId)
      onClose()
      showToast(editing ? 'Gasto actualizado' : 'Gasto adicional guardado', editing ? 'edit' : 'success')
    } catch {
      showToast('Error al guardar el gasto', 'error')
    } finally {
      setSaving(false)
    }
  }

  const title = editing ? (editing.occasional ? 'Editar gasto ocasional' : 'Editar gasto adicional') : 'Nuevo gasto adicional'

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-xs text-[#9aa4ac]">
          Se descuenta de tu dinero en cuenta y de lo que te queda del período en que cae su fecha.
        </p>
        <Input label="Descripción" placeholder="ej. Almuerzo, un juego, Uber…" {...register('description')} error={errors.description?.message} />
        <Input label="Monto (COP)" money placeholder="0" {...register('amount')} error={errors.amount?.message} />
        <Select label="Categoría" options={CATEGORY_OPTIONS} {...register('category')} />
        <Input label="Fecha" type="date" {...register('date')} error={errors.date?.message} />
        <AccountSelect label="¿De qué cuenta sale el dinero?" accounts={salary.accounts} value={accountId} onChange={setAccountId} outflow={Number(watch('amount')) || 0} />
        <ObservationField value={notes} onChange={setNotes} />
        {!editing?.occasional && <TagPicker value={tagIds} onChange={setTagIds} />}
        {editing?.occasional && <p className="text-[10px] text-[#8a929a]">Las etiquetas de un gasto ocasional vienen del ocasional al que pertenece (se cambian en su configuración).</p>}
        {!editing && <AttachmentPicker file={file} onChange={setFile} />}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={saving} notched>
            {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar gasto adicional'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
