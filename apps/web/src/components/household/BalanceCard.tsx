import { Coins, HandCoins, Scale, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Tip } from './PersonCard'
import { formatCOP } from '@/shared'

export interface BalancePerson { uid: string; name: string; net: number; color: string }

interface Props {
  /** me - partner, from the ledger (only meaningful with two people): positive means "me" owes more */
  diff: number
  /** Everyone in the household (me included) and what each one owes today. */
  people: BalancePerson[]
  myUid: string
  /** What I owe, split by the person it is owed to. */
  myCreditors: { name: string; owed: number }[]
  inviteCode: string
  saving: boolean
  onExpense: () => void
  /** Registers a loan between two members. */
  onLoan: () => void
  onAbonar: () => void
}

/** What each person owes today (and to whom, for me), how the debts split, then the actions. */
export function BalanceCard({ diff, people, myUid, myCreditors, inviteCode, onExpense, onLoan, onAbonar }: Props) {
  const me = people.find((p) => p.uid === myUid)
  const myNet = me?.net ?? 0
  const hasPartner = people.length > 1
  const debtors = people.filter((p) => p.net > 0)
  const totalOwed = debtors.reduce((s, p) => s + p.net, 0)
  // There is only something to abonar while someone owes: each person registers their own abonos
  const canAbonar = totalOwed > 0
  const iCanAbonar = myNet > 0
  const pair = people.length === 2
  const other = people.find((p) => p.uid !== myUid)
  const crossDebtor = diff > 0 ? me?.name : other?.name

  return (
    <div className="notch bg-[#0a1f2f] border border-white/10 p-4 sm:p-5 space-y-4 shadow-xl">
      <div className="space-y-3">
        <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold flex items-center gap-1.5">
          <Scale size={12} /> Saldo vigente
          <Tip text="Lo que cada persona debe hoy en este hogar, sumando todas sus deudas y restando lo que ya abonó o cruzó. No cambia al navegar entre meses: lo que no se saldó en un mes se arrastra al siguiente." />
        </p>

        {!hasPartner ? (
          <div>
            <p className="text-sm text-[#f0fae8]">Ningún co-titular unido aún.</p>
            <p className="text-xs text-brand-300 font-mono mt-1">Código: {inviteCode}</p>
          </div>
        ) : !canAbonar ? (
          <p className="text-xl font-bold text-emerald-300">Cuentas al día</p>
        ) : (
          <>
            {/* What each one owes today, on its own: nothing is compensated until a crossing is registered */}
            <div className="space-y-2">
              {[...people].sort((x, y) => y.net - x.net).map((p) => (
                <div key={p.uid} className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2 min-w-0 text-sm text-[#c7ccd1]">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} aria-hidden="true" />
                    <span className="truncate">{p.name}</span> debe
                  </span>
                  {p.net > 0
                    ? <span className="text-2xl font-bold font-mono tabular-nums text-amber-300 leading-tight">{formatCOP(p.net)}</span>
                    : <span className="text-sm font-bold text-emerald-300">al día</span>}
                </div>
              ))}
            </div>

            {/* To whom I owe it, when it is more than one person */}
            {myNet > 0 && myCreditors.length > 0 && (
              <ul className="rounded-lg border border-white/10 bg-[#0d263a] px-3 py-2 space-y-1">
                <li className="text-[10px] uppercase tracking-wider text-[#8a929a]">Tú le debes a</li>
                {myCreditors.map((c) => (
                  <li key={c.name} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-[#c7ccd1] truncate">{c.name}</span>
                    <span className="font-mono font-bold text-amber-300">{formatCOP(c.owed)}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* How the money owed splits between the people who owe (their debts together = 100%) */}
            {debtors.length > 1 && (
              <div className="space-y-1.5">
                <div className="flex h-3 gap-px rounded-full overflow-hidden bg-[#06131d] border border-white/10" role="img"
                  aria-label={`Se deben ${formatCOP(totalOwed)} en total: ${debtors.map((p) => `${p.name} ${formatCOP(p.net)}`).join(', ')}`}>
                  {debtors.map((p) => (
                    <div key={p.uid} className="h-full transition-all duration-700" style={{ width: `${(p.net / totalOwed) * 100}%`, backgroundColor: p.color }} />
                  ))}
                </div>
                <p className="text-[10px] text-[#8a929a]">
                  En el hogar se deben {formatCOP(totalOwed)}: {debtors.map((p) => `${Math.round((p.net / totalOwed) * 100)}% ${p.name}`).join(', ')}.
                </p>
              </div>
            )}

            {/* What would be left if the two debts were crossed (it is NOT applied until a crossing is registered) */}
            {pair && myNet > 0 && (other?.net ?? 0) > 0 && (
              <p className="rounded-lg border border-sky-400/25 bg-sky-500/5 px-3 py-2 text-[11px] text-[#c7ccd1] leading-snug">
                <span className="font-semibold text-sky-300">Si se cruzan las deudas</span> (se compensan sin mover dinero): {diff === 0
                  ? <>quedarían <span className="font-bold text-emerald-300">al día</span></>
                  : <>{crossDebtor} quedaría debiendo <span className="font-mono font-bold text-amber-300">{formatCOP(Math.abs(diff))}</span></>}. Hasta que registres un cruce, cada uno debe lo suyo.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <Button onClick={onExpense} notched className="w-full">
          <ShoppingBag size={15} /> Gasto compartido
        </Button>
        {hasPartner && (
          <Button onClick={onLoan} variant="secondary" notched className="w-full" title="Registrar un préstamo entre ustedes: quién prestó, a quién y cómo se paga">
            <HandCoins size={15} className="text-amber-300" /> Registrar préstamo
          </Button>
        )}
        <div className="flex gap-2">
          <Button
            onClick={onAbonar}
            disabled={!iCanAbonar}
            variant="secondary"
            notched
            size="sm"
            className="flex-1"
            title={iCanAbonar ? 'Abonar a tus deudas del hogar' : canAbonar ? 'No tienes deudas pendientes: cada persona registra sus propios abonos' : 'Cuentas al día: nadie debe nada, no hay qué abonar'}
          >
            <Coins size={14} className="text-brand-400" /> Abonar
          </Button>
        </div>
      </div>
    </div>
  )
}
