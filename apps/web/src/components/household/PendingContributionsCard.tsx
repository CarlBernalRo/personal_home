import { useState } from 'react'
import { Check, HandCoins, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { confirmExpenseContribution, declineExpenseContribution } from '@/lib/firestore'
import { formatCOP } from '@/shared'

export interface PendingContribution {
  expenseId: string
  memberId: string
  description: string
  amount: number
  registeredByName: string
}

function Row({ item, accounts, onDone }: {
  item: PendingContribution
  accounts: { id: string; name: string; balance: number }[]
  onDone: () => void
}) {
  const { showToast } = useToast()
  const ask = useConfirm()
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState<'confirm' | 'decline' | null>(null)

  async function confirm() {
    setBusy('confirm')
    try {
      await confirmExpenseContribution(item.expenseId, item.memberId, accountId || undefined)
      showToast('Aporte confirmado', 'success')
      onDone()
    } catch (e: any) {
      showToast(e?.message ?? 'No se pudo confirmar', 'error')
    } finally { setBusy(null) }
  }

  async function decline() {
    if (!(await ask(`¿Rechazar que pusiste ${formatCOP(item.amount)} en "${item.description}"? Se le avisará a ${item.registeredByName} para que lo corrija.`, { title: 'Rechazar aporte', confirmLabel: 'Rechazar' }))) return
    setBusy('decline')
    try {
      await declineExpenseContribution(item.expenseId, item.memberId)
      showToast('Aporte rechazado', 'delete')
      onDone()
    } catch (e: any) {
      showToast(e?.message ?? 'No se pudo rechazar', 'error')
    } finally { setBusy(null) }
  }

  return (
    <div className="rounded-xl border border-sky-400/30 bg-sky-500/[0.06] p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#f0fae8] truncate">{item.description}</p>
          <p className="text-xs text-[#9aa4ac]">{item.registeredByName} dice que pusiste este dinero</p>
        </div>
        <p className="flex-shrink-0 font-mono text-sm font-bold text-sky-300">{formatCOP(item.amount)}</p>
      </div>
      <AccountSelect label="¿De qué cuenta salió?" accounts={accounts} value={accountId} onChange={setAccountId} noneLabel="Sin cuenta (solo queda registrado)" />
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" className="flex-1" disabled={!!busy} onClick={decline}>
          {busy === 'decline' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Rechazar
        </Button>
        <Button type="button" size="sm" notched className="flex-1" disabled={!!busy} onClick={confirm}>
          {busy === 'confirm' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Confirmar
        </Button>
      </div>
    </div>
  )
}

/** What someone else declared you put into a shared household expense — nothing is real (no debt, no account, no "Mis gastos") until you say so here. */
export function PendingContributionsCard({ items, accounts, onDone }: {
  items: PendingContribution[]
  accounts: { id: string; name: string; balance: number }[]
  onDone: () => void
}) {
  if (items.length === 0) return null
  return (
    <div className="rounded-2xl border border-sky-400/30 bg-[#0a1f2f] p-4 space-y-3">
      <p className="font-pixel text-[9px] uppercase tracking-widest text-sky-400 flex items-center gap-1.5">
        <HandCoins size={12} /> Aportes por confirmar
      </p>
      {items.map((it) => <Row key={`${it.expenseId}_${it.memberId}`} item={it} accounts={accounts} onDone={onDone} />)}
    </div>
  )
}
