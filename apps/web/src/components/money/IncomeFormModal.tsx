import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { AttachmentPicker } from '@/components/pending/AttachmentPicker'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { withAttachment } from '@/lib/attachments'
import type { SalaryState } from '@/hooks/useSalary'

const incomeSchema = z.object({
  concept: z.string().min(1, 'Concepto requerido'),
  amount:  z.coerce.number().positive('El monto debe ser mayor a 0'),
  date:    z.string().min(1),
})
type IncomeForm = z.infer<typeof incomeSchema>

/** A one-off income (the salary is confirmed from its own card): it adds to the chosen account and to its period. */
export function IncomeFormModal({ open, onClose, salary }: { open: boolean; onClose: () => void; salary: SalaryState }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [account, setAccount] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const form = useForm<IncomeForm>({ resolver: zodResolver(incomeSchema), defaultValues: { date: format(new Date(), 'yyyy-MM-dd') } })

  useEffect(() => {
    if (!open) return
    form.reset({ concept: '', amount: undefined as any, date: format(new Date(), 'yyyy-MM-dd') })
    setAccount(salary.depositAccountId || salary.accounts[0]?.id || '')
    setFile(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function onSubmit(data: IncomeForm) {
    if (!user) return
    setSaving(true)
    try {
      const date = new Date(data.date + 'T12:00:00')
      await withAttachment(user.uid, file, (attachmentId) => salary.addExtra(data.concept.trim(), data.amount, date, account, attachmentId))
      onClose()
      showToast('Ingreso agregado', 'success')
    } catch {
      showToast('Error al guardar el ingreso', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nuevo ingreso">
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Input label="Concepto" placeholder="ej. Proyecto freelance, bono, venta…" {...form.register('concept')} error={form.formState.errors.concept?.message} />
        <Input label="Monto (COP)" money placeholder="0" {...form.register('amount')} error={form.formState.errors.amount?.message} />
        <Input label="Fecha" type="date" {...form.register('date')} />
        <AccountSelect label="¿A qué cuenta llegó?" accounts={salary.accounts} value={account} onChange={setAccount} noneLabel="Sin sumar a una cuenta" />
        <AttachmentPicker file={file} onChange={setFile} />
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Guardando…' : 'Guardar ingreso'}</Button>
        </div>
      </form>
    </Modal>
  )
}
