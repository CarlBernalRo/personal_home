import clsx from 'clsx'
import { formatCOP } from '@/shared'
import type { PersonReport } from './report'

/** The person's account in accountant form: lines with their sign, a rule, and the balance. */
export function LedgerTable({ p, className }: { p: PersonReport; className?: string }) {
  const pos = p.position
  return (
    <table className={clsx('w-full border-collapse text-xs', className)}>
      <tbody>
        {p.ledger.map((l) => (
          <tr key={l.label}>
            <td className="w-4 py-0.5 pr-1 font-mono font-bold text-[#8a929a]">{l.sign}</td>
            <td className="py-0.5 pr-2 text-[#c7ccd1]">{l.label}</td>
            <td className="py-0.5 text-right font-mono tabular-nums text-[#f0fae8]">{formatCOP(l.amount)}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-white/30">
          <td className="py-1 pr-1 font-mono font-bold text-[#8a929a]">=</td>
          <td className="py-1 pr-2 font-bold text-[#f3f5f6]">
            Saldo
            <span className="ml-1.5 text-[10px] font-normal text-[#8a929a]">{pos < 0 ? 'le faltan por pagar' : pos > 0 ? 'le deben' : 'al día'}</span>
          </td>
          <td className={clsx('py-1 text-right font-mono font-bold tabular-nums', pos < 0 ? 'text-amber-300' : pos > 0 ? 'text-sky-300' : 'text-emerald-300')}>
            {pos < 0 ? '−' : ''}{formatCOP(Math.abs(pos))}
          </td>
        </tr>
      </tbody>
    </table>
  )
}
