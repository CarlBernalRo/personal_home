import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Avatar } from '@/components/ui/Avatar'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { ObservationField } from '@/components/ui/ObservationField'
import { AttachmentPicker } from '@/components/pending/AttachmentPicker'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { useDisplayName } from '@/hooks/useDisplayName'
import { withAttachment } from '@/lib/attachments'
import { sendFamilyTransfer } from '@/lib/family'
import type { Family } from '@/shared'
import type { SalaryState } from '@/hooks/useSalary'

interface Props {
  open: boolean
  onClose: () => void
  family: Family
  salary: SalaryState
}

/**
 * Money sent to a family member, registered once: it leaves the chosen account, and the other person gets it as a
 * pending income (with the same receipt) that they only have to confirm.
 */
export function FamilyTransferModal({ open, onClose, family, salary }: Props) {
  const { user } = useAuth()
  const myName = useDisplayName() || 'Un familiar'
  const { showToast } = useToast()
  const others = family.members.filter((u) => u !== user?.uid)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [accountId, setAccountId] = useState('')
  const [concept, setConcept] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTo(others.length === 1 ? others[0] : '')
    setAmount(''); setConcept(''); setNotes(''); setFile(null); setError(null)
    setDate(format(new Date(), 'yyyy-MM-dd'))
    setAccountId(salary.pickAccount())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    const value = Number(amount)
    if (!to) return setError('Elige a quién le transferiste')
    if (!(value > 0)) return setError('Escribe un monto mayor a 0')
    setSaving(true)
    try {
      // the receipt is shared with the recipient right away, so they see the same proof
      await withAttachment(user.uid, file, (attachmentId) => sendFamilyTransfer({
        family, from: user.uid, fromName: myName, to, amount: value, date: new Date(date + 'T12:00:00'),
        accountId: accountId || undefined, concept, notes, attachmentId,
      }), [to])
      salary.rememberAccount(accountId)
      await salary.reload()
      await salary.reloadAccounts()
      onClose()
      showToast(`Transferencia registrada: a ${family.memberNames[to] ?? 'tu familiar'} le llegó para confirmarla`, 'success')
    } catch {
      showToast('No se pudo registrar la transferencia', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Transferir a un familiar">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-[#9aa4ac]">Se descuenta de tu cuenta y a la otra persona le llega como un ingreso por confirmar, con el mismo comprobante. Solo uno lo registra.</p>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-[#9aa4ac]">¿A quién?</p>
          <div className="flex flex-wrap gap-2">
            {others.map((u) => (
              <button key={u} type="button" onClick={() => { setTo(u); setError(null) }} aria-pressed={to === u}
                className={clsx('inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition', to === u ? 'border-brand-400 bg-brand-500/15 text-white' : 'border-white/10 bg-[#0d263a] text-[#c7ccd1] hover:text-white')}>
                <Avatar name={family.memberNames[u] ?? '?'} photoURL={family.memberPhotos[u]} size={24} />
                {family.memberNames[u] ?? 'Integrante'}
                {family.relations[u] && <span className="text-[10px] font-normal text-[#8a929a]">{family.relations[u]}</span>}
              </button>
            ))}
          </div>
        </div>
        <Input label="Monto (COP)" money placeholder="0" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null) }} />
        <Input label="Concepto (opcional)" placeholder={to ? `Transferencia a ${family.memberNames[to] ?? ''}` : 'ej. Para el mercado'} value={concept} onChange={(e) => setConcept(e.target.value)} />
        <Input label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <AccountSelect label="¿De qué cuenta salió?" accounts={salary.accounts} value={accountId} onChange={setAccountId} outflow={Number(amount) || 0} />
        <ObservationField value={notes} onChange={setNotes} />
        <AttachmentPicker file={file} onChange={setFile} />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Registrando…' : 'Registrar transferencia'}</Button>
        </div>
      </form>
    </Modal>
  )
}
