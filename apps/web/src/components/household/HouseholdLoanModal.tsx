import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { createHouseholdLoan, notifyHouseholdMembers } from '@/lib/firestore'
import { buildLoanPlan, formatCOP, type LoanFrequency, type LoanPlanKind } from '@/shared'

interface Member {
  uid: string
  name: string
  photoURL?: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  householdId: string
  members: Member[]
  /** Guests have no account and can't be notified — labeled here and skipped from the "a loan was registered" notice. */
  guestIds: string[]
  currentUserUid: string
  onCreated: () => void
}

const PLANS: { id: LoanPlanKind; label: string; hint: string }[] = [
  { id: 'none',         label: 'Sin fecha',    hint: 'Se paga cuando se pueda' },
  { id: 'single',       label: 'Un solo pago', hint: 'En una fecha acordada' },
  { id: 'installments', label: 'En cuotas',    hint: 'Varios pagos iguales' },
]

const FREQUENCIES: { value: LoanFrequency; label: string }[] = [
  { value: 'monthly',  label: 'Cada mes' },
  { value: 'biweekly', label: 'Cada 15 días' },
  { value: 'weekly',   label: 'Cada semana' },
]

const today = () => format(new Date(), 'yyyy-MM-dd')
const toDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

/**
 * Register a loan between two members: who lent, who received it, how much, and how it is paid back (no agreed
 * date, one payment, or equal installments). It becomes a debt of the borrower, one per installment, so abonos,
 * crossings, balances and due-date alerts all work on it like on any other debt.
 */
export function HouseholdLoanModal({ open, onClose, householdId, members, guestIds, currentUserUid, onCreated }: Props) {
  const { showToast } = useToast()
  const [lender, setLender] = useState('')
  const [borrower, setBorrower] = useState('')
  const [concept, setConcept] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [plan, setPlan] = useState<LoanPlanKind>('none')
  const [firstDate, setFirstDate] = useState('')
  const [count, setCount] = useState('3')
  const [frequency, setFrequency] = useState<LoanFrequency>('monthly')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const me = members.find((m) => m.uid === currentUserUid) ?? members[0]
    const other = members.find((m) => m.uid !== me?.uid)
    setLender(me?.uid ?? '')
    setBorrower(other?.uid ?? '')
    setConcept(''); setAmount(''); setDate(today()); setPlan('none'); setFirstDate(''); setCount('3'); setFrequency('monthly'); setNotes(''); setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.name ?? 'Integrante'
  const memberOptions = members.map((m) => ({
    value: m.uid,
    label: m.uid === currentUserUid ? `${m.name} (yo)` : guestIds.includes(m.uid) ? `${m.name} (invitado)` : m.name,
  }))

  const value = Number(amount)
  const installments = useMemo(() => buildLoanPlan({
    amount: value,
    kind: plan,
    firstDate: firstDate ? toDate(firstDate) : null,
    count: Number(count),
    frequency,
  }), [value, plan, firstDate, count, frequency])

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!lender || !borrower) return setError('Elige quién prestó y a quién')
    if (lender === borrower) return setError('Quien presta y quien recibe deben ser personas distintas')
    if (!concept.trim()) return setError('Escribe para qué fue el préstamo')
    if (!(value > 0)) return setError('Ingresa un monto mayor a 0')
    if (plan !== 'none' && !firstDate) return setError(plan === 'single' ? 'Elige la fecha de pago' : 'Elige la fecha de la primera cuota')
    if (plan === 'installments' && !(Number(count) >= 2 && Number(count) <= 60)) return setError('Las cuotas deben ser entre 2 y 60')
    setSaving(true)
    try {
      await createHouseholdLoan({
        householdId, lender, borrower, concept: concept.trim(), date: toDate(date), registeredBy: currentUserUid, notes: notes.trim(),
        installments: installments.map((p) => ({ number: p.number, of: p.of, amount: p.amount, dueDate: p.dueDate })),
      })
      onClose()
      onCreated()
      showToast('Préstamo registrado', 'success')
      notifyHouseholdMembers(members.filter((m) => !guestIds.includes(m.uid)).map((m) => m.uid), {
        fromUid: currentUserUid, zone: 'hogar', severity: 'info',
        title: `${nameOf(currentUserUid)} registró un préstamo`,
        body: `${nameOf(lender)} le prestó ${formatCOP(value)} a ${nameOf(borrower)}${installments.length > 1 ? ` en ${installments.length} cuotas` : ''}.`,
        link: `/hogar?id=${householdId}`,
      }).catch(() => { /* never undo what was saved */ })
    } catch (err: any) {
      showToast(err?.message ?? 'No se pudo registrar el préstamo', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Registrar préstamo">
      <form onSubmit={onSave} className="space-y-4">
        <p className="text-xs text-[#9aa4ac]">
          Para dinero que uno le prestó al otro. Queda como una deuda de quien lo recibió: se puede abonar, cruzar con otras deudas y avisa cuando se acerque la fecha acordada.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="¿Quién prestó?" options={memberOptions} value={lender} onChange={(e) => { setLender(e.target.value); setError(null) }} />
          <Select label="¿A quién?" options={memberOptions} value={borrower} onChange={(e) => { setBorrower(e.target.value); setError(null) }} />
        </div>
        {lender && borrower && lender !== borrower && (
          <p className="text-xs text-[#c7ccd1] -mt-2">
            {nameOf(lender)} le prestó a {nameOf(borrower)}: {nameOf(borrower)} queda debiendo.
          </p>
        )}

        <Input label="¿Para qué fue?" placeholder="ej. Préstamo para la matrícula" value={concept} onChange={(e) => { setConcept(e.target.value); setError(null) }} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Monto prestado (COP)" money placeholder="ej. 1.000.000" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null) }} />
          <Input label="Fecha del préstamo" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {/* How it is paid back */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[#9aa4ac]">¿Cómo se va a pagar?</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Forma de pago">
            {PLANS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={plan === p.id}
                onClick={() => { setPlan(p.id); setError(null) }}
                className={clsx('text-left rounded-xl border px-2.5 py-2 transition', plan === p.id ? 'border-brand-400/70 bg-brand-500/10' : 'border-white/10 bg-[#0d263a]/50 hover:border-white/25')}
              >
                <span className="block text-xs font-semibold text-[#f0fae8]">{p.label}</span>
                <span className="block text-[10px] text-[#8a929a] leading-snug mt-0.5">{p.hint}</span>
              </button>
            ))}
          </div>

          {plan !== 'none' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label={plan === 'single' ? 'Fecha de pago' : 'Fecha de la primera cuota'} type="date" value={firstDate} onChange={(e) => { setFirstDate(e.target.value); setError(null) }} />
              {plan === 'installments' && (
                <Input label="Número de cuotas" type="number" min={2} max={60} placeholder="ej. 6" value={count} onChange={(e) => { setCount(e.target.value); setError(null) }} />
              )}
            </div>
          )}
          {plan === 'installments' && (
            <Select label="Cada cuánto" options={FREQUENCIES} value={frequency} onChange={(e) => setFrequency(e.target.value as LoanFrequency)} />
          )}
        </div>

        {/* The schedule that will be created */}
        {installments.length > 1 && (
          <div className="rounded-xl border border-white/10 bg-[#0d263a] p-3 space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Plan de pagos</p>
            <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {installments.map((p) => (
                <li key={p.number} className="flex items-center justify-between gap-3 text-xs font-mono">
                  <span className="text-[#9aa4ac]">Cuota {p.number}/{p.of}{p.dueDate ? ` · ${format(p.dueDate, "d 'de' MMM yyyy", { locale: es })}` : ''}</span>
                  <span className="font-bold text-[#f0fae8]">{formatCOP(p.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between gap-3 border-t border-white/10 pt-1.5 text-xs font-mono">
              <span className="text-[#9aa4ac]">Total</span>
              <span className="font-bold text-amber-300">{formatCOP(installments.reduce((s, p) => s + p.amount, 0))}</span>
            </p>
          </div>
        )}

        <Input label="Notas" placeholder="Opcional" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Guardando…' : 'Registrar préstamo'}</Button>
        </div>
      </form>
    </Modal>
  )
}
