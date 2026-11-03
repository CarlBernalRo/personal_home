import { useState } from 'react'
import { GitMerge } from 'lucide-react'
import { clsx } from 'clsx'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, preventNegativeNumberKey } from '@/components/ui/Input'
import { CurvedScrollContainer } from '@/components/ui/CurvedScrollContainer'
import { formatCOP, remainingOf, allocateCrossing } from '@/shared'
import type { CrossingAllocation } from '@/shared'
import { toDate, type Rec } from './ledger'

interface Props {
  debt: Rec
  counterPersonId: string
  counterpartDebts: Rec[]
  nameOf: (uid?: string | null) => string
  saving: boolean
  onConfirm: (allocations: CrossingAllocation[], counterPersonId: string, notes: string) => void
  onClose: () => void
}

/**
 * A crossing nets two real debts against each other, so it always needs a specific counter-debt:
 * crossing against the counterpart's "total" would let you net a debt against someone who owes nothing.
 */
export function CrossingModal({ debt, counterPersonId, counterpartDebts, nameOf, saving, onConfirm, onClose }: Props) {
  const who = nameOf(debt.debtor)
  const counterName = nameOf(counterPersonId)
  const remaining = remainingOf(debt)

  // Oldest first: a partial cross settles what has been owed longest
  const sortedCounterDebts = [...counterpartDebts].sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())

  // Everything the counterpart owes is selected by default; unchecking narrows what is eligible
  const [selectedIds, setSelectedIds] = useState(() => new Set<string>(sortedCounterDebts.map((d) => d.id)))
  const selectedDebts = sortedCounterDebts.filter((d) => selectedIds.has(d.id))
  const selectedTotal = selectedDebts.reduce((s, d) => s + remainingOf(d), 0)
  const maxAmount = Math.min(remaining, selectedTotal)

  const [amount, setAmount] = useState(maxAmount)
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      const newTotal = sortedCounterDebts.filter((d) => next.has(d.id)).reduce((s, d) => s + remainingOf(d), 0)
      setAmount(Math.min(remaining, newTotal))
      return next
    })
    setErr('')
  }

  function handleConfirm() {
    if (selectedDebts.length === 0) { setErr(`Selecciona al menos una deuda de ${counterName}`); return }
    if (amount <= 0) { setErr('El monto debe ser mayor a 0'); return }
    if (amount > remaining) { setErr(`Máximo ${formatCOP(remaining)} (saldo de esta deuda)`); return }
    if (amount > selectedTotal) { setErr(`Máximo ${formatCOP(selectedTotal)} (lo seleccionado)`); return }
    setErr('')
    onConfirm(allocateCrossing(amount, selectedDebts), counterPersonId, notes)
  }

  return (
    <Modal open onClose={onClose} title="Cruzar deuda">
      <div className="space-y-4">
        <div className="bg-[#0d263a] border border-white/10 rounded-xl p-3.5 space-y-0.5">
          <p className="font-pixel text-[9px] text-brand-400 uppercase tracking-widest font-bold">Deuda a cruzar</p>
          <p className="text-sm font-bold text-[#f3f5f6]">{debt.concept}</p>
          <p className="text-xs text-[#9aa4ac]">
            {who} debe · <span className="font-semibold text-amber-300 font-mono">{formatCOP(remaining)} pendiente</span>
          </p>
        </div>

        {sortedCounterDebts.length === 0 ? (
          <div className="bg-[#0d263a] rounded-xl p-3.5 border border-white/10">
            <p className="text-sm text-[#9aa4ac]">{counterName} no tiene deudas pendientes: no hay nada contra qué cruzar.</p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[#dcf1eb]">
                Deudas de {counterName} a cruzar {sortedCounterDebts.length > 1 && <span className="text-[#8a929a] font-normal">(elige una o varias)</span>}
              </label>
              <CurvedScrollContainer maxHeight="190px" themeColor="brand" className="border border-white/10 rounded-xl bg-[#06131d] max-sm:!max-h-none" contentClassName="max-sm:!max-h-none">
                <div className="divide-y divide-white/5">
                  {sortedCounterDebts.map((d) => {
                    const checked = selectedIds.has(d.id)
                    return (
                      <label key={d.id} className={clsx('flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors', checked ? 'bg-brand-500/15' : 'hover:bg-white/[0.04]')}>
                        <input type="checkbox" checked={checked} onChange={() => toggle(d.id)} className="cursor-pointer" />
                        <span className="flex-1 min-w-0 text-sm text-[#f0fae8] truncate">{d.concept}</span>
                        <span className="text-sm font-semibold text-amber-300 font-mono tabular-nums flex-shrink-0">{formatCOP(remainingOf(d))}</span>
                      </label>
                    )
                  })}
                </div>
              </CurvedScrollContainer>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-[#dcf1eb]">Monto a cruzar</label>
              <div className="currency-field has-suffix">
                <span className="currency-affix-prefix">$</span>
                <Input
                  money
                  value={amount}
                  onChange={(e) => { setAmount(Math.min(maxAmount, Math.max(0, Number(e.target.value)))); setErr('') }}
                  aria-label="Monto a cruzar en pesos colombianos"
                />
                <span className="currency-affix-suffix">COP</span>
              </div>
              <p className="text-[10px] text-[#8a929a]">
                Máx. {formatCOP(maxAmount)}{selectedDebts.length > 1 && ': si es parcial, se reparte empezando por la más antigua'}
              </p>
            </div>
          </>
        )}

        <Input label="Notas (opcional)" placeholder="ej. Acuerdo del 15 oct" value={notes} onChange={(e) => setNotes(e.target.value)} />

        {err && <p className="text-xs text-red-400">{err}</p>}

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="button" notched className="flex-1" onClick={handleConfirm} disabled={saving || selectedDebts.length === 0}>
            <GitMerge size={14} /> {saving ? 'Cruzando…' : 'Confirmar cruce'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
