import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Zap, Hand } from 'lucide-react'
import { formatCOP, type PayProjection } from '@/shared'

const shortDate = (d: Date) => format(d, "d 'de' MMM", { locale: es })

/** Of what is still to pay before the next salary: what the bank debits by itself and what is on you. */
export function AutoManualCard({ projection }: { projection: PayProjection }) {
  const auto = projection.outflows.filter((o) => o.auto)
  const manual = projection.outflows.filter((o) => !o.auto)
  if (auto.length === 0 && manual.length === 0) return null

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 space-y-3 shadow-xl">
      <p className="text-xs font-semibold text-[#9aa4ac]">Automático vs manual · hasta el {shortDate(projection.nextPay.date)}</p>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-cyan-200"><Zap size={12} /> Se debita solo</p>
          <p className="mt-1 text-base font-bold font-mono tabular-nums text-cyan-100">{formatCOP(projection.autoTotal)}</p>
          <p className="text-[10px] text-[#8a929a]">{auto.length} {auto.length === 1 ? 'pago' : 'pagos'}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#c7ccd1]"><Hand size={12} /> Lo pagas tú</p>
          <p className="mt-1 text-base font-bold font-mono tabular-nums text-[#f0fae8]">{formatCOP(projection.manualTotal)}</p>
          <p className="text-[10px] text-[#8a929a]">{manual.length} {manual.length === 1 ? 'pago' : 'pagos'}</p>
        </div>
      </div>

      {auto.length > 0 && (
        <div className="space-y-1 border-t border-white/10 pt-2">
          <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Ten el saldo para estos débitos</p>
          {auto.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-cyan-100">{o.concept} <span className="text-[#8a929a]">· {shortDate(o.date)}</span></span>
              <span className="font-mono text-cyan-200 flex-shrink-0">{formatCOP(o.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
