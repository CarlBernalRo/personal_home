import { CheckCircle2, Coins, Scale, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Tip } from './PersonCard'
import { formatCOP } from '@/shared'

interface Props {
  /** me - partner, from the ledger: positive means "me" owes more */
  diff: number
  myName: string
  partnerName: string
  myNet: number
  partnerNet: number
  hasPartner: boolean
  inviteCode: string
  saving: boolean
  onExpense: () => void
  onAbonar: () => void
  onSettleAll: () => void
}

const ME_COLOR = '#52b69a'
const PARTNER_COLOR = '#168aad'

/** Who owes whom comes first, then a divergent bar on a single scale, then the actions. */
export function BalanceCard({ diff, myName, partnerName, myNet, partnerNet, hasPartner, inviteCode, saving, onExpense, onAbonar, onSettleAll }: Props) {
  const max = Math.max(myNet, partnerNet, 1)
  const debtor = diff > 0 ? myName : partnerName

  return (
    <div className="notch bg-[#0a1f2f] border border-white/10 p-4 sm:p-5 space-y-4 shadow-xl">
      <div>
        <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold flex items-center gap-1.5">
          <Scale size={12} /> Saldo vigente
          <Tip text="Saldo real acumulado hasta hoy. No cambia al navegar entre meses: lo que no se saldó en un mes se arrastra al siguiente." />
        </p>
        {!hasPartner ? (
          <div className="mt-2">
            <p className="text-sm text-[#f0fae8]">Ningún co-titular unido aún.</p>
            <p className="text-xs text-brand-300 font-mono mt-1">Código: {inviteCode}</p>
          </div>
        ) : diff === 0 ? (
          <p className="text-xl font-bold text-emerald-300 mt-1">Cuentas al día</p>
        ) : (
          <>
            <p className="text-sm text-[#9aa4ac] mt-1">{debtor} debe</p>
            <p className="text-3xl font-bold font-mono tabular-nums text-amber-300 leading-tight">{formatCOP(Math.abs(diff))}</p>
          </>
        )}
      </div>

      {hasPartner && (myNet > 0 || partnerNet > 0) && (
        <div>
          {/* divergent bar: each side grows from the centre on the same scale */}
          <div className="relative flex h-3 rounded-full bg-[#06131d] border border-white/10 overflow-hidden" role="img" aria-label={`${myName} debe ${formatCOP(myNet)}, ${partnerName} debe ${formatCOP(partnerNet)}`}>
            <div className="w-1/2 flex justify-end">
              <div className="h-full rounded-l-full transition-all duration-700" style={{ width: `${(myNet / max) * 100}%`, backgroundColor: ME_COLOR }} />
            </div>
            <div className="w-1/2">
              <div className="h-full rounded-r-full transition-all duration-700" style={{ width: `${(partnerNet / max) * 100}%`, backgroundColor: PARTNER_COLOR }} />
            </div>
            <span className="absolute left-1/2 top-0 bottom-0 w-px bg-white/40" aria-hidden />
          </div>
          <div className="flex justify-between mt-2 text-[10px] font-semibold text-[#c7ccd1]">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ME_COLOR }} />
              {myName} {myNet === 0 && <span className="text-emerald-300">(al día)</span>}
            </span>
            <span className="flex items-center gap-1.5">
              {partnerName} {partnerNet === 0 && <span className="text-emerald-300">(al día)</span>}
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PARTNER_COLOR }} />
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 pt-1">
        <Button onClick={onExpense} notched className="w-full">
          <ShoppingBag size={15} /> Gasto compartido
        </Button>
        <div className="flex gap-2">
          <Button onClick={onAbonar} variant="secondary" notched size="sm" className="flex-1" title="Abonar a las deudas del hogar">
            <Coins size={14} className="text-brand-400" /> Abonar
          </Button>
          {(myNet > 0 || partnerNet > 0) && (
            <Button
              onClick={onSettleAll}
              disabled={saving}
              variant="secondary"
              notched
              size="sm"
              className="flex-1 !text-emerald-300 !border-emerald-400/40"
              title="Registrar pagos mutuos y saldar todas las cuentas a hoy"
            >
              <CheckCircle2 size={14} /> Saldar todo
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
