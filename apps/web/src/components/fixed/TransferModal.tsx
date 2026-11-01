import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { transferBetweenAccounts } from '@/lib/firestore'
import { formatCOP } from '@/shared'

interface Props {
  open: boolean
  onClose: () => void
  userId: string
  accounts: { id: string; name: string; balance: number }[]
  onDone: () => void
}

/** Moves money from one of the user's accounts to another: one goes down, the other goes up by the same amount. */
export function TransferModal({ open, onClose, userId, accounts, onDone }: Props) {
  const { showToast } = useToast()
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setFromId(accounts[0]?.id ?? '')
    setToId(accounts[1]?.id ?? '')
    setAmount('')
    setNote('')
    setDate(format(new Date(), 'yyyy-MM-dd'))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const from = accounts.find((a) => a.id === fromId)
  const to = accounts.find((a) => a.id === toId)
  const value = Number(amount)
  const options = accounts.map((a) => ({ value: a.id, label: `${a.name} · ${formatCOP(a.balance)}` }))

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!from || !to) return setError('Elige las dos cuentas')
    if (from.id === to.id) return setError('Elige dos cuentas distintas')
    if (!(value > 0)) return setError('Ingresa un monto mayor a 0')
    const [y, m, d] = date.split('-').map(Number)
    setSaving(true)
    try {
      await transferBetweenAccounts({ userId, fromId: from.id, toId: to.id, amount: value, date: new Date(y, m - 1, d), note: note.trim() })
      onClose()
      onDone()
      showToast(`${formatCOP(value)} movidos a ${to.name}`, 'success')
    } catch {
      showToast('No se pudo mover el saldo', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Mover saldo entre cuentas">
      <form onSubmit={onSubmit} className="space-y-4">
        <Select label="Sale de" value={fromId} onChange={(e) => { setFromId(e.target.value); setError(null) }} options={options} />
        <Select label="Llega a" value={toId} onChange={(e) => { setToId(e.target.value); setError(null) }} options={options} />
        <Input label="Monto (COP)" money placeholder="0" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null) }} />
        {from && value > from.balance && (
          <p className="text-[11px] text-red-300">{from.name} tiene {formatCOP(from.balance)}: quedaría en negativo.</p>
        )}
        {from && to && value > 0 && from.id !== to.id && (
          <p className="text-[11px] text-[#8a929a]">
            {from.name} quedará con {formatCOP(from.balance - value)} y {to.name} con {formatCOP(to.balance + value)}.
          </p>
        )}
        <Input label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Nota (opcional)" placeholder="ej. Para pagar la tarjeta" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Moviendo…' : 'Mover saldo'}</Button>
        </div>
      </form>
    </Modal>
  )
}
