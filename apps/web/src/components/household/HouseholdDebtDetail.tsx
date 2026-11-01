import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowLeft, Clock, Coins, GitMerge, ShoppingBag, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { formatCOP, remainingOf, isPendingDebt } from '@/shared'
import { toDate, type Rec } from './ledger'

interface Props {
  debt: Rec
  debts: Rec[]
  crossings: Rec[]
  myName: string
  partnerName: string
  userUid?: string
  /** the other person has pending debts to cross against */
  canCross: boolean
  onBack: () => void
  onCross: () => void
  onAbonar: () => void
  onDelete: () => void
  onDeleteAbono: (abono: Rec) => void
}

const fmt = (d: unknown) => format(toDate(d), 'dd MMM yyyy', { locale: es })
const sectionTitle = 'font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold'

/** Detail of one debt: what is left, its abonos and its crossings. Lives in the right pane. */
export function HouseholdDebtDetail({ debt, debts, crossings, myName, partnerName, userUid, canCross, onBack, onCross, onAbonar, onDelete, onDeleteAbono }: Props) {
  const abonos = debts.filter((a) => a.tipo === 'Abono' && a.saldaId === debt.id)
  const crosses = crossings.filter((c) => c.debt1Id === debt.id || c.debt2Id === debt.id)
  const dueDate = debt.dueDate ? toDate(debt.dueDate) : null
  const overdue = dueDate ? dueDate < new Date() : false
  const pending = isPendingDebt(debt)
  const debtorName = debt.debtor === userUid ? myName : partnerName
  const otherName = debt.debtor === userUid ? partnerName : myName

  return (
    <div className="space-y-4 slide-up">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-brand-300 hover:text-white transition">
        <ArrowLeft size={15} /> Volver al historial
      </button>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="notch bg-[#0a1f2f] border border-white/10 p-5 space-y-4 shadow-xl">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <p className={clsx(sectionTitle, 'mb-1 flex items-center gap-2 flex-wrap')}>
                Deuda seleccionada
                {debt.expenseId && (
                  <span className="bg-sky-500/15 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded-md font-sans text-[9px] normal-case tracking-normal flex items-center gap-1">
                    <ShoppingBag size={9} /> Gasto compartido
                  </span>
                )}
              </p>
              <p className="text-base font-bold text-[#f3f5f6] break-words">{debt.concept}</p>
              <p className="text-xs text-[#9aa4ac] mt-0.5">{debtorName} debe · {fmt(debt.date)}</p>
              {dueDate && (
                <p className={clsx('text-xs mt-0.5 flex items-center gap-1', overdue ? 'text-red-400 font-semibold' : 'text-[#9aa4ac]')}>
                  <Clock size={11} /> {overdue ? 'Venció el' : 'Vence el'} {fmt(dueDate)}
                </p>
              )}
            </div>
            <div className="sm:text-right flex-shrink-0">
              {(debt.crossedAmount as number) > 0 && <p className="text-xs text-white/40 line-through tabular-nums font-mono">{formatCOP(debt.amount)}</p>}
              <p className="text-2xl font-bold text-amber-300 tabular-nums font-mono">{formatCOP(Math.max(0, remainingOf(debt)))}</p>
            </div>
          </div>

          {debt.notas && <p className="text-xs text-[#dcf1eb] bg-[#0d263a] border border-white/10 rounded-xl p-3">{debt.notas}</p>}
          {debt.tipo === 'Deuda' && (debt.cruzado || remainingOf(debt) <= 0) && (
            <p className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2.5 font-semibold">Esta deuda ya está liquidada.</p>
          )}
          {pending && !canCross && (
            <p className="text-[11px] text-[#9aa4ac] bg-[#0d263a] border border-white/10 rounded-xl p-2.5">
              No se puede cruzar: {otherName} no tiene deudas pendientes.
            </p>
          )}

          <div className="flex gap-2">
            {pending && (
              <>
                <Button variant="secondary" notched className="flex-1" onClick={onCross} disabled={!canCross}
                  title={canCross ? undefined : 'La otra persona no tiene deudas pendientes para cruzar'}>
                  <GitMerge size={14} /> Cruzar deuda
                </Button>
                <Button notched className="flex-1" onClick={onAbonar}>
                  <Coins size={14} /> Abonar
                </Button>
              </>
            )}
            <button onClick={onDelete} title="Eliminar" aria-label="Eliminar"
              className="px-3 rounded-xl border border-white/10 text-red-400 hover:border-red-500/50 hover:bg-red-500/10 transition flex items-center justify-center">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="notch bg-[#0a1f2f] border border-white/10 p-5 space-y-3">
            <p className={sectionTitle}>Abonos realizados a esta deuda</p>
            {abonos.length === 0 ? (
              <p className="text-xs text-[#8a929a] py-3 text-center">Sin abonos para esta deuda</p>
            ) : abonos.map((a) => (
              <div key={a.id} className="pb-3 border-b border-white/[0.06] last:border-0 last:pb-0 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-brand-300 font-mono">{formatCOP(a.amount)} abonado</p>
                  <p className="text-[10px] text-[#8a929a] truncate">{fmt(a.date)}{a.notas && ` · ${a.notas}`}</p>
                </div>
                <button onClick={() => onDeleteAbono(a)} title="Eliminar abono" aria-label="Eliminar abono"
                  className="p-1.5 rounded-lg text-[#8a929a] hover:text-red-400 hover:bg-red-500/15 transition">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          <div className="notch bg-[#0a1f2f] border border-white/10 p-5 space-y-3">
            <p className={sectionTitle}>Cruces registrados</p>
            {crosses.length === 0 ? (
              <p className="text-xs text-[#8a929a] py-3 text-center">Sin cruces para esta deuda</p>
            ) : crosses.map((c) => (
              <div key={c.id} className="pb-3 border-b border-white/[0.06] last:border-0 last:pb-0">
                <div className="flex justify-between items-start gap-2">
                  <p className="text-xs font-semibold text-sky-300 font-mono">{formatCOP(c.amount)} cruzado</p>
                  <p className="text-[10px] text-[#8a929a]">{fmt(c.createdAt)}</p>
                </div>
                {c.notes && <p className="text-[10px] text-[#dcf1eb] mt-0.5">{c.notes}</p>}
                <p className="text-[10px] text-[#8a929a] mt-0.5">Por {c.initiatedBy === userUid ? myName : partnerName}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
