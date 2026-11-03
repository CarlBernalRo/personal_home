import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { useToast } from '@/components/ui/Toast'
import { addFixedExpense, updateFixedExpense } from '@/lib/firestore'
import { FIXED_EXPENSE_CATEGORIES, monthKey, shiftMonth, startMonthOf } from '@/shared'

const CATEGORY_OPTIONS = FIXED_EXPENSE_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))

interface Props {
  open: boolean
  onClose: () => void
  userId: string
  /** The scheduled expense being edited (null = a new one). */
  editing: any | null
  accounts: { id: string; name: string; balance: number }[]
  /** Account offered first. */
  defaultAccount: string
  /** Already paid: its date can't move (the payment belongs to that month). */
  paid: boolean
  onSaved: () => void
}

/** Date a scheduled expense falls on: the day of its first (and only) month. */
export function scheduledDate(fe: any): Date {
  const month = startMonthOf(fe, monthKey(new Date()))
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return new Date(y, m - 1, Math.min(fe.paymentDay ?? 1, lastDay))
}

/**
 * Schedule a one-off payment (the university on the 20th, an annual fee…): it is not a fixed expense that
 * repeats nor an occasional one. It is stored as a fixed expense that exists for a single month, so it shows
 * in the timelines and the calendar, counts in what is left of the period, warns when it is about to fall due
 * and is paid the same way as any other.
 */
export function ProgramExpenseModal({ open, onClose, userId, editing, accounts, defaultAccount, paid, onSaved }: Props) {
  const { showToast } = useToast()
  const [form, setForm] = useState({ concept: '', date: '', amount: '', category: 'otro', accountId: '', isVariable: false, notes: '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setForm(editing
      ? {
          concept: editing.concept, date: format(scheduledDate(editing), 'yyyy-MM-dd'), amount: String(editing.estimatedAmount ?? ''),
          category: editing.category ?? 'otro', accountId: editing.accountId ?? '', isVariable: !!editing.isVariable, notes: editing.notes ?? '',
        }
      : { concept: '', date: '', amount: '', category: 'otro', accountId: defaultAccount, isVariable: false, notes: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!form.concept.trim()) return setError('Escribe qué vas a pagar')
    if (!form.date) return setError('Elige la fecha en que lo vas a pagar')
    if (!(amount > 0)) return setError('Ingresa un monto mayor a 0')
    const [y, m, d] = form.date.split('-').map(Number)
    const month = `${y}-${String(m).padStart(2, '0')}`
    setSaving(true)
    try {
      const data = {
        concept: form.concept.trim(),
        estimatedAmount: amount,
        paymentDay: d,
        category: form.category,
        isVariable: form.isVariable,
        notes: form.notes.trim(),
        accountId: form.accountId,
        frequency: 'fijo' as const,
        everyMonths: 1,
        oneTime: true,
        // it exists for that single month: from the month after it is switched off
        startMonth: month,
        pauses: [{ from: shiftMonth(month, 1) }],
      }
      if (editing) await updateFixedExpense(editing.id, data as any)
      else await addFixedExpense({ ...data, userId, active: true } as any)
      onClose()
      onSaved()
      showToast(editing ? 'Gasto programado actualizado' : 'Gasto programado', editing ? 'edit' : 'success')
    } catch {
      showToast('No se pudo guardar el gasto programado', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar gasto programado' : 'Programar un gasto'}>
      <form onSubmit={onSave} className="space-y-4">
        <p className="text-xs text-[#9aa4ac]">
          Para un pago que harás una sola vez, como la universidad o una cuota anual. Aparece en tus gastos de ese período, cuenta en lo que te queda y te avisa cuando se acerque la fecha.
        </p>
        <Input label="¿Qué vas a pagar?" placeholder="ej. Matrícula universidad" value={form.concept} onChange={(e) => { setForm({ ...form, concept: e.target.value }); setError(null) }} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Fecha de pago" type="date" value={form.date} disabled={paid} onChange={(e) => { setForm({ ...form, date: e.target.value }); setError(null) }} />
          <Input label="Monto (COP)" money placeholder="ej. 2.500.000" value={form.amount} onChange={(e) => { setForm({ ...form, amount: e.target.value }); setError(null) }} />
        </div>
        {paid && <p className="text-[11px] text-amber-200 -mt-2">Ya está pagado: la fecha no se puede cambiar.</p>}
        <Select label="Categoría" options={CATEGORY_OPTIONS} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <AccountSelect label="Cuenta de la que se paga" accounts={accounts} value={form.accountId} onChange={(id) => setForm({ ...form, accountId: id })} noneLabel="Elegirla al pagar" outflow={Number(form.amount) || 0} />
        <label className="flex items-center gap-3 text-xs text-[#c7ccd1] cursor-pointer select-none">
          <input type="checkbox" className="cursor-pointer" checked={form.isVariable} onChange={(e) => setForm({ ...form, isVariable: e.target.checked })} />
          <span>
            El monto puede cambiar
            <span className="block text-[10px] text-[#8a929a]">Al pagarlo escribes lo que realmente pagaste.</span>
          </span>
        </label>
        <Input label="Notas" placeholder="Opcional" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Programar gasto'}</Button>
        </div>
      </form>
    </Modal>
  )
}
