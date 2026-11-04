import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, Wallet, CalendarClock, ShoppingBag } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { usePendingMovements } from '@/hooks/usePendingMovements'

/** Once per session, right after signing in: says how many movements from Telegram are waiting to be confirmed. */
export function PendingMovementsPrompt() {
  const { user } = useAuth()
  const { counts, loading } = usePendingMovements()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!user || loading || counts.total === 0) return
    const key = `pending-prompt-${user.uid}`
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1') } catch { /* private mode: it may repeat */ }
    setOpen(true)
  }, [user, loading, counts.total])

  if (!open) return null

  const rows = [
    { icon: Wallet, label: counts.income === 1 ? 'ingreso' : 'ingresos', n: counts.income, tone: 'text-emerald-300' },
    { icon: CalendarClock, label: counts.fixed === 1 ? 'gasto fijo' : 'gastos fijos', n: counts.fixed, tone: 'text-sky-300' },
    { icon: ShoppingBag, label: counts.occasional === 1 ? 'gasto adicional' : 'gastos adicionales', n: counts.occasional, tone: 'text-amber-300' },
  ].filter((r) => r.n > 0)

  return (
    <Modal open onClose={() => setOpen(false)} title="Pendientes por confirmar">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-sky-300/30 bg-sky-500/10 text-sky-300"><Send size={16} /></span>
          <p className="text-sm text-[#c7ccd1]">
            Registraste movimientos desde Telegram. <b className="text-[#f3f5f6]">Nada se ha registrado todavía</b>: confírmalos aquí para que cuenten en tus cuentas y gastos.
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
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Más tarde</Button>
          <Button type="button" notched className="flex-1" onClick={() => { setOpen(false); navigate('/pendientes') }}>Revisar ahora</Button>
        </div>
      </div>
    </Modal>
  )
}
