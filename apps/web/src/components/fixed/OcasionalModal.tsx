import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { SalaryState } from '@/hooks/useSalary'
import { useMyHouseholds } from '@/hooks/useMyHouseholds'
import { PERSONAL_CATEGORIES, type VariableBudget } from '@/shared'

const CATEGORY_OPTIONS = PERSONAL_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))

interface Props {
  open: boolean
  /** null creates a new one. */
  editing: VariableBudget | null
  onClose: () => void
  salary: SalaryState
}

/**
 * Create/edit an occasional expense: something paid regularly but without an exact day or amount
 * (gasoline, groceries…). It gets an approximate value per salary period and, optionally, a usual day.
 */
export function OcasionalModal({ open, editing, onClose, salary }: Props) {
  const { addBudget, updateBudget, removeBudget } = salary
  const myHouseholds = useMyHouseholds()
  const { showToast } = useToast()
  const ask = useConfirm()

  const [form, setForm] = useState({ concept: '', category: 'transporte', amount: '', day: '', notes: '', accountId: '', linked: false, scope: 'all' as 'all' | 'specific', householdIds: [] as string[] })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(editing
      ? { concept: editing.concept, category: editing.category, amount: editing.amount ? String(editing.amount) : '', day: editing.paymentDay ? String(editing.paymentDay) : '', notes: editing.notes ?? '', accountId: editing.accountId ?? '', linked: editing.source === 'household-debt', scope: editing.householdIds?.length ? 'specific' : 'all', householdIds: editing.householdIds ?? [] }
      : { concept: '', category: 'transporte', amount: '', day: '', notes: '', accountId: '', linked: false, scope: 'all', householdIds: [] })
    setError(null)
  }, [open, editing])

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    const amount = Number(form.amount)
    const day = form.day.trim() === '' ? null : Number(form.day)
    if (!form.concept.trim()) return setError('Escribe el nombre del gasto')
    if (form.linked && form.scope === 'specific' && form.householdIds.length === 0) return setError('Elige al menos un hogar')
    if (!form.linked && !(amount > 0)) return setError('Ingresa un monto aproximado mayor a 0')
    if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) return setError('El día de pago debe estar entre 1 y 31')
    setSaving(true)
    try {
      const patch: Omit<VariableBudget, 'id' | 'active'> = {
        concept: form.concept.trim(), category: form.category, amount: form.linked ? 0 : amount, paymentDay: day, notes: form.notes.trim(), accountId: form.accountId,
        // null (not undefined) so Firestore accepts it and an edit can clear the choice
        householdIds: form.linked && form.scope === 'specific' ? form.householdIds : null,
        ...(form.linked ? { source: 'household-debt' as const } : {}),
      }
      // an edit that unchecks the link must clear it (Firestore can't store `undefined`)
      if (editing) await updateBudget(editing.id, form.linked ? patch : { ...patch, source: null as any })
      else await addBudget(patch)
      onClose()
      showToast(editing ? 'Gasto ocasional actualizado' : 'Gasto ocasional agregado', editing ? 'edit' : 'success')
    } catch {
      showToast('No se pudo guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!editing || !(await ask(`¿Eliminar "${editing.concept}"? Los gastos ya registrados se conservan.`, { title: 'Eliminar gasto ocasional' }))) return
    try {
      await removeBudget(editing.id)
      onClose()
    } catch {
      showToast('No se pudo eliminar', 'error')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar gasto ocasional' : 'Nuevo gasto ocasional'}>
      <form onSubmit={onSave} className="space-y-4">
        {/* Qué es */}
        <Input label="Concepto" placeholder="ej. Gasolina" value={form.concept} onChange={(e) => { setForm({ ...form, concept: e.target.value }); setError(null) }} />
        <Select label="Categoría" options={CATEGORY_OPTIONS} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />

        {/* Cuánto */}
        <div className="space-y-4 pt-1 border-t border-white/10">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#6f7a83] -mb-1 pt-3">Cuánto</p>
          <label className="flex items-center gap-3 text-xs text-[#c7ccd1] cursor-pointer select-none">
            <input type="checkbox" className="cursor-pointer" checked={form.linked} onChange={(e) => { setForm({ ...form, linked: e.target.checked }); setError(null) }} />
            <span>
              Es lo que debo en mis hogares
              <span className="block text-[10px] text-[#8a929a]">El valor se calcula con lo que debes en los hogares que elijas, y tus abonos ahí cuentan como pagos. Las deudas con fecha acordada se pintan en esa fecha.</span>
            </span>
          </label>
          {form.linked ? (
            <div className="rounded-xl border border-white/10 bg-[#0d263a] p-3 space-y-2">
              <p className="text-xs font-semibold text-[#c7ccd1]">¿De qué hogares?</p>
              {([['all', 'Todos los hogares asociados'], ['specific', 'Hogares específicos']] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-3 text-xs text-[#c7ccd1] cursor-pointer select-none">
                  {/* either/or: choosing one unticks the other, and the chosen one can't be unticked */}
                  <input type="checkbox" className="cursor-pointer" checked={form.scope === value} onChange={() => { setForm({ ...form, scope: value }); setError(null) }} />
                  {label}
                </label>
              ))}
              {form.scope === 'specific' && (
                <div className="pl-6 space-y-1.5">
                  {myHouseholds.length === 0 && <p className="text-[11px] text-[#8a929a]">No encontré hogares asociados a tu cuenta.</p>}
                  {myHouseholds.map((h) => (
                    <label key={h.id} className="flex items-center gap-3 text-xs text-[#c7ccd1] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="cursor-pointer"
                        checked={form.householdIds.includes(h.id)}
                        onChange={() => {
                          setError(null)
                          setForm({ ...form, householdIds: form.householdIds.includes(h.id) ? form.householdIds.filter((x) => x !== h.id) : [...form.householdIds, h.id] })
                        }}
                      />
                      {h.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Input label="Valor aproximado por período de sueldo (COP)" money placeholder="0" value={form.amount} onChange={(e) => { setForm({ ...form, amount: e.target.value }); setError(null) }} />
          )}
        </div>

        {/* Cuándo */}
        <div className="space-y-4 pt-1 border-t border-white/10">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#6f7a83] -mb-1 pt-3">Cuándo</p>
          <Input label="Día de pago del mes (1-31, opcional)" type="number" placeholder="ej. 15" value={form.day} onChange={(e) => { setForm({ ...form, day: e.target.value }); setError(null) }} />
        </div>

        {/* Cómo se paga */}
        <div className="space-y-4 pt-1 border-t border-white/10">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#6f7a83] -mb-1 pt-3">Cómo se paga</p>
          <AccountSelect label="Cuenta de la que se paga" accounts={salary.accounts} value={form.accountId} onChange={(id) => setForm({ ...form, accountId: id })} noneLabel="Elegirla al registrar cada gasto" />
        </div>

        {/* Notas */}
        <div className="space-y-2 pt-1 border-t border-white/10">
          <div className="pt-3">
            <Input label="Notas" placeholder="Opcional" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <p className="text-[11px] text-[#8a929a]">
            El valor se renueva con cada sueldo confirmado y lo que no gastes queda reservado en "Te queda". Si tiene un día habitual de pago, se muestra como recordatorio en la línea de tiempo; el monto real lo registras tú cuando ocurre.
          </p>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2 pt-2">
          {editing && <Button type="button" variant="danger" notched onClick={onDelete}>Eliminar</Button>}
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      </form>
    </Modal>
  )
}
