import { Landmark } from 'lucide-react'
import { formatCOP } from '@/shared'
import { shareLabel } from '@/components/ui/SegmentedBar'
import { DashCard, EmptyNote } from './shared'

interface Props {
  accounts: { id: string; name: string; balance: number; color?: string; type?: string }[]
}

const TYPE_LABEL: Record<string, string> = { checking: 'Cuenta corriente', savings: 'Ahorros', cash: 'Efectivo', investment: 'Inversión' }

/** Where the money is: the total and how it is spread across the accounts (the movements live in Finanzas). */
export function AccountsZone({ accounts }: Props) {
  const total = accounts.reduce((sum, a) => sum + a.balance, 0)
  const positive = accounts.reduce((sum, a) => sum + Math.max(a.balance, 0), 0)
  const sorted = [...accounts].sort((a, b) => b.balance - a.balance)
  const max = Math.max(...sorted.map((a) => a.balance), 1)

  return (
    <DashCard title="Cuentas" eyebrow="Reparto del dinero" info="Cuánto dinero tienes en cada una de tus cuentas y qué parte del total representa." icon={Landmark} tone="#38bdf8" to="/finanzas" linkLabel="Ver cuentas">
      {accounts.length === 0 ? (
        <EmptyNote icon={Landmark}>Aún no tienes cuentas. Se crean en Finanzas.</EmptyNote>
      ) : (
        <div className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <p className="text-2xl font-bold font-mono text-sky-200 tracking-tight">{formatCOP(total)}</p>
            <p className="text-[11px] text-[#8a929a] pb-1">en {accounts.length} {accounts.length === 1 ? 'cuenta' : 'cuentas'}</p>
          </div>
          {sorted[0] && sorted[0].balance > 0 && accounts.length > 1 && positive > 0 && (
            <p className="text-xs text-[#9aa4ac] -mt-2">
              <span className="font-semibold text-[#f0fae8]">{sorted[0].name}</span> concentra el {shareLabel((sorted[0].balance / positive) * 100)} de tu dinero.
            </p>
          )}

          <ul className="space-y-2.5" aria-label="Dinero por cuenta">
            {sorted.map((a) => {
              const share = positive > 0 && a.balance > 0 ? (a.balance / positive) * 100 : 0
              const pctText = share > 0 ? shareLabel(share) : ''
              return (
                <li key={a.id} className="min-w-0" title={`${a.name}: ${formatCOP(a.balance)}${pctText ? ` · ${pctText}` : ''}`}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 min-w-0 text-[#c7ccd1]">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: a.color ?? '#52b69a' }} aria-hidden="true" />
                      <span className="truncate">{a.name}</span>
                      {a.type && <span className="hidden sm:inline text-[10px] text-[#8a929a] truncate">· {TYPE_LABEL[a.type] ?? a.type}</span>}
                    </span>
                    <span className="flex-shrink-0 font-mono font-semibold text-[#f3f5f6]">
                      <span className={a.balance < 0 ? 'text-red-300' : undefined}>{formatCOP(a.balance)}</span>
                      {pctText && <span className="font-normal text-[#8a929a]"> · {pctText}</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-white/[0.06]" aria-hidden="true">
                    {a.balance > 0 && (
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, (a.balance / max) * 100)}%`, backgroundColor: a.color ?? '#52b69a' }} />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </DashCard>
  )
}
