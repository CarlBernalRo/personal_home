import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CheckCircle2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { confirmPaymentReceipt, getAccounts } from '@/lib/firestore'
import { formatCOP } from '@/shared'
import type { PaymentReceipt } from '@/shared'

interface Props {
  open: boolean
  onClose: () => void
  receipt: PaymentReceipt | null
  /** The notification that announced the payment (marked as answered when confirmed). */
  notificationId?: string
  onConfirmed?: () => void
}

/**
 * Someone paid you: shows how much, when and which debts it went to, and asks in which of your accounts you received it.
 * Confirming registers the amount as an income of yours in that account.
 */
export function ConfirmReceiptModal({ open, onClose, receipt, notificationId, onConfirmed }: Props) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [accounts, setAccounts] = useState<{ id: string; name: string; balance: number; isDefault?: boolean }[]>([])
  const [accountId, setAccountId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    getAccounts(user.uid)
      .then((a) => {
        const list = a as any[]
        setAccounts(list)
        setAccountId((list.find((x) => x.isDefault) ?? list[0])?.id ?? '')
      })
      .catch(() => setAccounts([]))
  }, [open, user])

  if (!receipt) return null

  async function confirm() {
    if (!user || !receipt) return
    setSaving(true)
    try {
      await confirmPaymentReceipt({
        householdId: receipt.householdId, paymentId: receipt.paymentId, userId: user.uid, accountId: accountId || undefined,
        fromName: receipt.fromName, notificationId,
      })
      showToast(`Recibiste ${formatCOP(receipt.amount)}: quedó como ingreso${accountId ? ' en tu cuenta' : ''}`, 'success')
      onConfirmed?.()
      onClose()
    } catch (e: any) {
      showToast(e?.message ?? 'No se pudo confirmar el pago', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Confirmar pago recibido">
      <div className="space-y-4">
        <div className="rounded-xl border border-white/10 bg-[#0d263a] p-3.5 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#f3f5f6]">{receipt.fromName} te pagó</p>
              <p className="text-[11px] text-[#8a929a]">{format(new Date(receipt.date), "d 'de' MMMM yyyy", { locale: es })}</p>
            </div>
            <p className="text-xl font-bold font-mono text-brand-300">{formatCOP(receipt.amount)}</p>
          </div>
          <ul className="border-t border-white/10 pt-2 space-y-1">
            <li className="text-[10px] uppercase tracking-wider text-[#8a929a]">Por estos conceptos</li>
            {receipt.lines.map((l, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-[#c7ccd1] truncate">{l.concept}</span>
                <span className="font-mono text-[#f0fae8] flex-shrink-0">{formatCOP(l.amount)}</span>
              </li>
            ))}
          </ul>
        </div>

        <AccountSelect
          label="¿En qué cuenta lo recibiste?"
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
          noneLabel="No sumarlo a una cuenta"
          outflow={-receipt.amount}
        />
        <p className="text-xs text-[#8a929a]">Al confirmar se registra como ingreso tuyo{accountId ? ' y suma al saldo de esa cuenta' : ''}.</p>

        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Ahora no</Button>
          <Button type="button" notched className="flex-1" disabled={saving} onClick={confirm}>
            <CheckCircle2 size={14} /> {saving ? 'Confirmando…' : 'Confirmar recibido'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
