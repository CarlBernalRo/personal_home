import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, Wallet, CalendarClock, ShoppingBag, Home } from 'lucide-react'
import { formatCOP } from '@/shared'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { usePendingMovements } from '@/hooks/usePendingMovements'

/** Once per session, right after signing in: says how many movements from Telegram are waiting to be confirmed. */
export function PendingMovementsPrompt() {
  const { user } = useAuth()
  const { counts, receipts, loading } = usePendingMovements()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!user || loading || counts.total === 0) return
    const key = `pending-prompt-${user.uid}`
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1') } catch { /* private mode: it may repeat */ }
    setOpen(true)
  }, [user, loading, counts.total])

  if (!open) return null

  // movements prepared in Telegram vs payments other household members made to me: not the same thing, and said apart
  const telegram = counts.total - counts.receipt - counts.contribution

  const rows = [
    { icon: Wallet, label: counts.income === 1 ? 'ingreso' : 'ingresos', n: counts.income, tone: 'text-emerald-300' },
    { icon: CalendarClock, label: counts.fixed === 1 ? 'gasto fijo' : 'gastos fijos', n: counts.fixed, tone: 'text-sky-300' },
    { icon: ShoppingBag, label: counts.occasional === 1 ? 'gasto adicional' : 'gastos adicionales', n: counts.occasional, tone: 'text-amber-300' },
    { icon: Home, label: counts.abono === 1 ? 'abono al hogar' : 'abonos al hogar', n: counts.abono, tone: 'text-violet-300' },
    { icon: Wallet, label: counts.receipt === 1 ? 'pago recibido del hogar' : 'pagos recibidos del hogar', n: counts.receipt, tone: 'text-emerald-300' },
    { icon: Home, label: counts.contribution === 1 ? 'aporte a un gasto compartido' : 'aportes a gastos compartidos', n: counts.contribution, tone: 'text-sky-300' },
  ].filter((r) => r.n > 0)

  return (
    <Modal open onClose={() => setOpen(false)} title="Pendientes por confirmar">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-sky-300/30 bg-sky-500/10 text-sky-300">{telegram > 0 ? <Send size={16} /> : <Wallet size={16} />}</span>
          <p className="text-sm text-[#c7ccd1]">
            {telegram > 0 && (<>Registraste movimientos desde Telegram. <b className="text-[#f3f5f6]">Nada se ha registrado todavía</b>: confírmalos aquí para que cuenten en tus cuentas y gastos.</>)}
            {telegram > 0 && receipts.length > 0 && ' '}
            {receipts.length > 0 && (<>{receipts.length === 1 ? 'Alguien del hogar te hizo un pago' : 'Te hicieron pagos en el hogar'}: <b className="text-[#f3f5f6]">confirma que lo recibiste y en qué cuenta entró</b> para que sume a tu saldo.</>)}
          </p>
        </div>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0d263a] px-3.5 py-2.5">
              <span className="flex items-center gap-2.5 text-sm text-[#f3f5f6]"><r.icon size={16} className={r.tone} /> {r.label}</span>
              <span className={`font-mono text-lg font-bold tabular-nums ${r.tone}`}>{r.n}</span>
            </li>
          ))}
        </ul>
        {receipts.length > 0 && (
          <ul className="space-y-2">
            {receipts.map((r) => (
              <li key={r.key} className="rounded-xl border border-emerald-400/25 bg-emerald-500/5 px-3.5 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-[#f3f5f6]">{r.fromName} te pagó</span>
                  <span className="font-mono text-sm font-bold text-emerald-300">+{formatCOP(r.amount)}</span>
                </div>
                <p className="text-[11px] text-[#8a929a]">{r.householdName} · {r.lines.map((l) => `${l.concept} (${formatCOP(l.amount)})`).join(' · ')}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Más tarde</Button>
          <Button type="button" notched className="flex-1" onClick={() => { setOpen(false); navigate('/pendientes') }}>Revisar ahora</Button>
        </div>
      </div>
    </Modal>
  )
}
