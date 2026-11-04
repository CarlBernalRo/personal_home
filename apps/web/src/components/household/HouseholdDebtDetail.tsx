import { format } from 'date-fns'
import { AttachmentButton } from '@/components/pending/AttachmentButton'
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
  nameOf: (uid?: string | null) => string
  /** Whom this debt is owed to (null when it can't be told). */
  creditorId: string | null
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
const STATUS_CHIP = {
  open: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  partial: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  done: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
} as const
const sectionTitle = 'font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold'

/** Detail of one debt: what is left, its abonos and its crossings. Lives in the right pane. */
export function HouseholdDebtDetail({ debt, debts, crossings, nameOf, creditorId, userUid, canCross, onBack, onCross, onAbonar, onDelete, onDeleteAbono }: Props) {
  const abonos = debts.filter((a) => a.tipo === 'Abono' && a.saldaId === debt.id)
  const crosses = crossings.filter((c) => c.debt1Id === debt.id || c.debt2Id === debt.id)
  const dueDate = debt.dueDate ? toDate(debt.dueDate) : null
  const overdue = dueDate ? dueDate < new Date() : false
  const pending = isPendingDebt(debt)
  const debtorName = nameOf(debt.debtor)
  const creditorName = creditorId ? nameOf(creditorId) : 'la otra persona'
  const byName = (uid?: string) => nameOf(uid)

  // What happened to this debt, in date order, with the balance left after each movement
  const moves = [
    ...abonos.map((a) => ({ id: `ab|${a.id}`, kind: 'abono' as const, date: toDate(a.date), amount: a.amount as number, by: byName(a.registeredBy), note: (a.notas as string) || '', attachmentId: a.attachmentId as string | undefined, onDelete: () => onDeleteAbono(a) })),
    ...crosses.map((c) => ({ id: `cr|${c.id}`, kind: 'cruce' as const, date: toDate(c.createdAt), amount: c.amount as number, by: byName(c.initiatedBy), note: (c.notes as string) || '', onDelete: undefined as (() => void) | undefined })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime())
  let running = debt.amount as number
  const steps = [
    { id: 'registro', label: 'Deuda registrada', color: '#f59e0b', date: toDate(debt.date), by: byName(debt.registeredBy), note: '', attachmentId: undefined as string | undefined, delta: debt.amount as number, balance: running, onDelete: undefined as (() => void) | undefined },
    ...moves.map((m) => {
      running -= m.amount
      return { id: m.id, label: m.kind === 'abono' ? `Abono a ${creditorName}` : `Cruce con una deuda de ${creditorName}`, color: m.kind === 'abono' ? '#52b69a' : '#38bdf8', date: m.date, by: m.by, note: m.note, attachmentId: 'attachmentId' in m ? m.attachmentId : undefined, delta: -m.amount, balance: running, onDelete: m.onDelete }
    }),
  ]
  const remainingNow = remainingOf(debt)
  const status = remainingNow <= 0
    ? { key: 'done' as const, label: debt.cruzado ? 'Cruzada' : 'Saldada' }
    : remainingNow < (debt.amount as number)
      ? { key: 'partial' as const, label: 'Abonada parcialmente' }
      : { key: 'open' as const, label: 'Pendiente' }
  const otherName = creditorName

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
                {debt.loanId && (
                  <span className="bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded-md font-sans text-[9px] normal-case tracking-normal">
                    Préstamo{debt.installments && debt.installments > 1 ? ` · cuota ${debt.installment}/${debt.installments}` : ''}
                  </span>
                )}
                {debt.expenseId && (
                  <span className="bg-sky-500/15 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded-md font-sans text-[9px] normal-case tracking-normal flex items-center gap-1">
                    <ShoppingBag size={9} /> Gasto compartido
                  </span>
                )}
              </p>
              <p className="text-base font-bold text-[#f3f5f6] break-words">{debt.concept}</p>
              <p className="text-xs text-[#9aa4ac] mt-0.5">
                {debt.loanId && debt.lender ? `${nameOf(debt.lender)} le prestó a ${debtorName} · ` : `${debtorName} le debe a ${creditorName} · `}{fmt(debt.date)}
              </p>
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
              No se puede cruzar: {otherName} no tiene deudas pendientes con {debtorName}.
            </p>
          )}

          <div className="flex gap-2">
            {pending && (
              <>
                <Button variant="secondary" notched className="flex-1" onClick={onCross} disabled={!canCross}
                  title={canCross ? undefined : `${otherName} no tiene deudas pendientes con ${debtorName} para cruzar`}>
                  <GitMerge size={14} /> Cruzar deuda
                </Button>
                {debt.debtor === userUid ? (
                  <Button notched className="flex-1" onClick={onAbonar}>
                    <Coins size={14} /> Abonar
                  </Button>
                ) : (
                  <p className="flex-1 self-center text-[11px] text-[#9aa4ac]">Solo {debtorName} puede abonar a esta deuda, desde su propia cuenta.</p>
                )}
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
            <div className="flex items-center justify-between gap-2">
              <p className={sectionTitle}>Movimientos de esta deuda</p>
              <span className={clsx('text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border', STATUS_CHIP[status.key])}>{status.label}</span>
            </div>
            <p className="text-[11px] text-[#9aa4ac]">Cada movimiento que cambió lo que se debe, en orden, con el saldo que dejó. El estado de la deuda sale de estos movimientos.</p>

            <ol className="relative space-y-3 pl-5">
              <span className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-white/15" aria-hidden />
              {steps.map((st) => (
                <li key={st.id} className="relative">
                  <span className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full ring-2 ring-[#0a1f2f]" style={{ backgroundColor: st.color }} aria-hidden />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold" style={{ color: st.color }}>{st.label}</p>
                      <p className="text-[10px] text-[#8a929a]">{fmt(st.date)}{st.by ? ` · ${st.by}` : ''}{st.note ? ` · ${st.note}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {st.attachmentId && <AttachmentButton compact attachmentId={st.attachmentId} />}
                      <div className="text-right">
                        <p className="text-xs font-mono font-bold text-[#f3f5f6]">{st.delta > 0 ? '+' : '−'}{formatCOP(Math.abs(st.delta))}</p>
                        <p className="text-[10px] font-mono text-[#8a929a]">saldo {formatCOP(Math.max(0, st.balance))}</p>
                      </div>
                    </div>
                    {st.onDelete && (
                      <button onClick={st.onDelete} title="Eliminar abono" aria-label="Eliminar abono" className="p-1.5 rounded-lg text-[#8a929a] hover:text-red-400 hover:bg-red-500/15 transition flex-shrink-0">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            <p className="flex justify-between gap-3 border-t border-white/10 pt-2 text-xs font-mono">
              <span className="text-[#9aa4ac]">Saldo actual</span>
              <span className={clsx('font-bold', remainingOf(debt) > 0 ? 'text-amber-300' : 'text-emerald-300')}>{formatCOP(Math.max(0, remainingOf(debt)))}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
