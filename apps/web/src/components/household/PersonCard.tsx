import { type ReactNode, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronDown, ChevronRight, Clock, Coins, GitMerge, Info } from 'lucide-react'
import { clsx } from 'clsx'
import { Avatar } from '@/components/ui/Avatar'
import { IconTip } from '@/components/ui/IconTip'
import { Modal } from '@/components/ui/Modal'
import { formatCOP, remainingOf, isPendingDebt, inPaymentOrder } from '@/shared'
import { toDate, type Rec } from './ledger'

/** Small info icon with a themed tooltip, used next to micro-labels. */
export function Tip({ text }: { text: string }) {
  return (
    <IconTip text={text}>
      <Info size={11} className="text-[#8a929a] hover:text-brand-300 transition" />
    </IconTip>
  )
}

const labelCls = 'font-pixel text-[9px] text-brand-400 uppercase tracking-widest font-bold flex items-center gap-1.5'

/** Expand / collapse with a CSS grid height animation. */
function ExpandSection({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 220ms ease' }}>
      <div style={{ overflow: 'hidden' }}>{children}</div>
    </div>
  )
}

// ── How a person's balance was calculated ────────────────────────────────────
function BalanceBreakdown({ name, deuda, abono, cruzado, saldo }: { name: string; deuda: number; abono: number; cruzado: number; saldo: number }) {
  return (
    <div className="bg-[#0d263a] border border-white/10 rounded-xl px-3.5 py-3 mb-3 space-y-1.5">
      <p className={clsx(labelCls, 'mb-1.5')}>
        Cómo se calcula
        <Tip text="Suma de todas sus deudas históricas, menos lo que ha abonado y lo que se le ha cruzado: nunca se resetea por mes." />
      </p>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[#9aa4ac]">Deudas totales</span>
        <span className="font-semibold text-[#f3f5f6] tabular-nums font-mono">{formatCOP(deuda)}</span>
      </div>
      {abono > 0 && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#9aa4ac]">− Abonos</span>
          <span className="font-semibold text-brand-300 tabular-nums font-mono">−{formatCOP(abono)}</span>
        </div>
      )}
      {cruzado > 0 && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#9aa4ac]">− Cruzado</span>
          <span className="font-semibold text-sky-300 tabular-nums font-mono">−{formatCOP(cruzado)}</span>
        </div>
      )}
      <div className="flex items-center justify-between text-[11px] pt-1.5 mt-1 border-t border-white/10">
        <span className="font-bold text-[#f3f5f6]">= {name} debe</span>
        <span className="font-bold text-amber-300 tabular-nums font-mono text-xs">{formatCOP(Math.max(0, saldo))}</span>
      </div>
    </div>
  )
}

// ── Read-only compact row for settled debts / abonos ─────────────────────────
function StatusItem({ d, label, chip, onSelect }: { d: Rec; label: string; chip: string; onSelect: () => void }) {
  return (
    <button onClick={onSelect} className="w-full text-left py-2 px-2 border-b border-white/[0.06] last:border-0 group hover:bg-white/[0.04] rounded-lg transition-colors">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <div className="min-w-0">
          <p className="text-xs text-[#f0fae8] truncate">{d.concept}</p>
          <p className="text-[10px] font-mono text-[#8a929a]">{format(toDate(d.date), 'dd MMM yyyy', { locale: es })}</p>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end flex-shrink-0">
          <span className={clsx('text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border', chip)}>{label}</span>
          <span className="text-xs font-semibold text-[#9aa4ac] tabular-nums font-mono">{formatCOP(d.amount)}</span>
        </div>
      </div>
    </button>
  )
}

// ── Open debt with its progress and the Cruzar / Abonar actions ──────────────
function DebtItem({ d, canCross, canAbonar, creditor, onCross, onAbonar, onSelect }: {
  d: Rec; canCross: boolean; creditor: string | null; canAbonar: boolean; onCross: () => void; onAbonar: () => void; onSelect: () => void
}) {
  const crossed = (d.crossedAmount as number) || 0
  const paidAbono = (d.paidAbono as number) || 0
  const remaining = remainingOf(d)
  const dueDate = d.dueDate ? toDate(d.dueDate) : null
  const overdue = dueDate ? dueDate < new Date() : false
  const progress = d.amount > 0 ? Math.min(100, Math.round(((crossed + paidAbono) / d.amount) * 100)) : 0

  return (
    <div className="py-3 border-b border-white/[0.06] last:border-0">
      <button onClick={onSelect} className="w-full text-left group">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3 mb-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#f0fae8] truncate group-hover:text-brand-300 transition">
              {d.concept}
              {d.loanId && <span className="ml-2 align-middle text-[9px] font-bold uppercase tracking-wider text-amber-300 border border-amber-400/40 rounded px-1 py-0.5">préstamo</span>}
              {d.expenseId && <span className="ml-2 align-middle text-[9px] font-bold uppercase tracking-wider text-sky-300 border border-sky-400/40 rounded px-1 py-0.5">gasto compartido</span>}
            </p>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#8a929a] mt-0.5 flex-wrap">
              <span>{format(toDate(d.date), 'dd MMM yyyy', { locale: es })}</span>
              {creditor && <span className="text-[#c7ccd1]">· a {creditor}</span>}
              {crossed > 0 && <span className="text-sky-300">· {formatCOP(crossed)} cruzado</span>}
              {paidAbono > 0 && <span className="text-brand-300">· {formatCOP(paidAbono)} abonado</span>}
            </div>
            {dueDate && (
              <p className={clsx('text-[10px] mt-0.5 flex items-center gap-1', overdue ? 'text-red-400 font-semibold' : 'text-[#8a929a]')}>
                <Clock size={10} /> {overdue ? 'Venció el' : 'Vence el'} {format(dueDate, 'dd MMM yyyy', { locale: es })}
              </p>
            )}
          </div>
          <div className="sm:text-right flex-shrink-0">
            {(crossed > 0 || paidAbono > 0) && <p className="text-[10px] text-white/40 line-through tabular-nums font-mono">{formatCOP(d.amount)}</p>}
            <p className="text-sm font-bold text-amber-300 tabular-nums font-mono">{formatCOP(remaining)}</p>
          </div>
        </div>
        {(crossed > 0 || paidAbono > 0) && (
          <div className="mb-2 flex items-center gap-2">
            <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-brand-400 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[10px] font-mono text-[#8a929a]">{progress}% cubierto</span>
          </div>
        )}
      </button>
      <div className="flex gap-1.5">
        <button
          onClick={onCross}
          disabled={!canCross}
          title={canCross ? undefined : 'No hay deudas pendientes de la otra persona para cruzar'}
          className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-[11px] font-semibold text-[#dcf1eb] hover:border-brand-400/50 hover:text-white hover:bg-brand-500/10 transition flex items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <GitMerge size={11} /> Cruzar
        </button>
        {canAbonar && (
          <button
            onClick={onAbonar}
            className="flex-1 py-1.5 rounded-lg bg-brand-500 text-[#051018] hover:bg-brand-400 text-[11px] font-semibold transition flex items-center justify-center gap-1 interactive-press"
          >
            <Coins size={12} /> Abonar
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * One shared expense can leave this person owing several different creditors (e.g. Alexa owes both Carlos and
 * Lenin from the same "Hospedaje") — each its own `householdDebts` row. Shown flat, the same expense repeats
 * once per creditor; this folds same-`expenseId` rows into one group, first-occurrence position kept.
 */
function withExpenseGroups(list: Rec[]): ({ kind: 'single'; d: Rec } | { kind: 'group'; concept: string; edges: Rec[] })[] {
  const countByExpense = new Map<string, number>()
  for (const d of list) if (d.expenseId) countByExpense.set(d.expenseId, (countByExpense.get(d.expenseId) ?? 0) + 1)
  const emitted = new Set<string>()
  const out: ({ kind: 'single'; d: Rec } | { kind: 'group'; concept: string; edges: Rec[] })[] = []
  for (const d of list) {
    const eid = d.expenseId as string | undefined
    if (eid && (countByExpense.get(eid) ?? 0) > 1) {
      if (emitted.has(eid)) continue
      emitted.add(eid)
      out.push({ kind: 'group', concept: d.concept as string, edges: list.filter((x) => x.expenseId === eid) })
    } else {
      out.push({ kind: 'single', d })
    }
  }
  return out
}

// ── One edge inside an expense group: the concept is already on the group header, so the
//    creditor's avatar carries the row's identity instead of repeating it ──────────────────
function ExpenseEdgeItem({ d, canCross, canAbonar, creditorUid, creditorName, colorOf, photoOf, onCross, onAbonar, onSelect }: {
  d: Rec; canCross: boolean; canAbonar: boolean; creditorUid: string | null; creditorName: string | null
  colorOf?: (uid: string) => string; photoOf?: (uid: string) => string | null
  onCross: () => void; onAbonar: () => void; onSelect: () => void
}) {
  const crossed = (d.crossedAmount as number) || 0
  const paidAbono = (d.paidAbono as number) || 0
  const remaining = remainingOf(d)
  const dueDate = d.dueDate ? toDate(d.dueDate) : null
  const overdue = dueDate ? dueDate < new Date() : false
  const progress = d.amount > 0 ? Math.min(100, Math.round(((crossed + paidAbono) / d.amount) * 100)) : 0

  return (
    <div className="py-3 border-b border-white/[0.06] last:border-0">
      <button onClick={onSelect} className="w-full text-left group">
        <div className="flex items-center gap-2.5 mb-2">
          {creditorUid && <Avatar name={creditorName ?? '?'} photoURL={photoOf?.(creditorUid) ?? null} size={26} color={colorOf?.(creditorUid) ?? '#6b7685'} className="!ring-white/15 flex-shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#f0fae8] truncate group-hover:text-brand-300 transition">{creditorName ?? 'Alguien'}</p>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#8a929a] mt-0.5 flex-wrap">
              <span>{format(toDate(d.date), 'dd MMM yyyy', { locale: es })}</span>
              {crossed > 0 && <span className="text-sky-300">· {formatCOP(crossed)} cruzado</span>}
              {paidAbono > 0 && <span className="text-brand-300">· {formatCOP(paidAbono)} abonado</span>}
            </div>
            {dueDate && (
              <p className={clsx('text-[10px] mt-0.5 flex items-center gap-1', overdue ? 'text-red-400 font-semibold' : 'text-[#8a929a]')}>
                <Clock size={10} /> {overdue ? 'Venció el' : 'Vence el'} {format(dueDate, 'dd MMM yyyy', { locale: es })}
              </p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            {(crossed > 0 || paidAbono > 0) && <p className="text-[10px] text-white/40 line-through tabular-nums font-mono">{formatCOP(d.amount)}</p>}
            <p className="text-sm font-bold text-amber-300 tabular-nums font-mono">{formatCOP(remaining)}</p>
          </div>
        </div>
        {(crossed > 0 || paidAbono > 0) && (
          <div className="mb-2 flex items-center gap-2">
            <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-brand-400 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[10px] font-mono text-[#8a929a]">{progress}% cubierto</span>
          </div>
        )}
      </button>
      <div className="flex gap-1.5">
        <button
          onClick={onCross}
          disabled={!canCross}
          title={canCross ? undefined : 'No hay deudas pendientes de la otra persona para cruzar'}
          className="flex-1 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-[11px] font-semibold text-[#dcf1eb] hover:border-brand-400/50 hover:text-white hover:bg-brand-500/10 transition flex items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <GitMerge size={11} /> Cruzar
        </button>
        {canAbonar && (
          <button
            onClick={onAbonar}
            className="flex-1 py-1.5 rounded-lg bg-brand-500 text-[#051018] hover:bg-brand-400 text-[11px] font-semibold transition flex items-center justify-center gap-1 interactive-press"
          >
            <Coins size={12} /> Abonar
          </button>
        )}
      </div>
    </div>
  )
}

// ── One shared expense, several creditors: closed by default, each edge keeps its own actions ──
function ExpenseGroupItem({ concept, edges, canCross, canAbonar, creditorName, creditorUid, colorOf, photoOf, onCross, onAbonar, onSelect }: {
  concept: string; edges: Rec[]; canCross: boolean | ((d: Rec) => boolean); creditorName?: (d: Rec) => string | null
  creditorUid?: (d: Rec) => string | null; colorOf?: (uid: string) => string; photoOf?: (uid: string) => string | null
  canAbonar: boolean; onCross: (d: Rec) => void; onAbonar: (d: Rec) => void; onSelect: (d: Rec) => void
}) {
  const [open, setOpen] = useState(false)
  const total = edges.reduce((s, d) => s + remainingOf(d), 0)
  // close the group window before anything it offers opens another one (abonar/cruzar/ver detalle), so they never stack
  const act = (fn: (d: Rec) => void) => (d: Rec) => { setOpen(false); fn(d) }
  return (
    <div className="py-3 border-b border-white/[0.06] last:border-0">
      <button type="button" onClick={() => setOpen(true)} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#f0fae8] flex items-center gap-2 flex-wrap">
            {concept}
            <span className="text-[9px] font-bold uppercase tracking-wider text-sky-300 border border-sky-400/40 rounded px-1 py-0.5">gasto compartido</span>
          </p>
          <p className="text-[10px] text-[#8a929a] mt-0.5">{edges.length} personas</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-bold text-amber-300 tabular-nums font-mono">{formatCOP(total)}</span>
          <ChevronRight size={14} className="text-[#8a929a]" />
        </div>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={concept}>
        <div className="-mt-1">
          {edges.map((d) => (
            <ExpenseEdgeItem
              key={d.id} d={d} canCross={typeof canCross === 'function' ? canCross(d) : canCross} canAbonar={canAbonar}
              creditorUid={creditorUid?.(d) ?? null} creditorName={creditorName?.(d) ?? null} colorOf={colorOf} photoOf={photoOf}
              onCross={() => act(onCross)(d)} onAbonar={() => act(onAbonar)(d)} onSelect={() => act(onSelect)(d)}
            />
          ))}
        </div>
      </Modal>
    </div>
  )
}

// ── A person's debts grouped by state: Pendiente / Cruzado / Pagado / Abonos ─
function PersonDebtGroups({ personDebts, canCross, canAbonar, creditorName, creditorUid, colorOf, photoOf, onCross, onAbonar, onSelect, owedToMe, nameOf }: {
  personDebts: Rec[]; canCross: boolean | ((d: Rec) => boolean); creditorName?: (d: Rec) => string | null; canAbonar: boolean; onCross: (d: Rec) => void; onAbonar: (d: Rec) => void; onSelect: (d: Rec) => void
  /** Whom a debt is owed to, by uid — so a grouped expense's edges can show that person's avatar. */
  creditorUid?: (d: Rec) => string | null
  colorOf?: (uid: string) => string
  photoOf?: (uid: string) => string | null
  /** Pending debts where this person is the one owed, not the one owing — invisible otherwise once they're "al día" themselves. */
  owedToMe?: Rec[]
  nameOf?: (uid: string) => string
}) {
  // Pending ones in the order they will be paid (the earliest due first, so a loan's installments read 1, 2, 3);
  // what is already settled, crossed or abonado, newest first
  const newestFirst = (a: Rec, b: Rec) => toDate(b.date).getTime() - toDate(a.date).getTime()
  const pendientes = withExpenseGroups(inPaymentOrder(personDebts.filter((d) => isPendingDebt(d))))
  const cruzados = personDebts.filter((d) => d.tipo === 'Deuda' && d.cruzado).sort(newestFirst)
  const saldados = personDebts.filter((d) => d.tipo === 'Deuda' && !d.cruzado && remainingOf(d) <= 0).sort(newestFirst)
  const abonos = personDebts.filter((d) => d.tipo === 'Abono').sort(newestFirst)
  const owed = owedToMe ?? []

  if (pendientes.length + cruzados.length + saldados.length + abonos.length + owed.length === 0) {
    return <p className="text-xs text-[#8a929a] py-3">Sin registros.</p>
  }

  const Group = ({ title, tip, children }: { title: string; tip: string; children: ReactNode }) => (
    <div className="pt-2">
      <p className={clsx(labelCls, 'pb-0.5')}>{title}<Tip text={tip} /></p>
      {children}
    </div>
  )

  return (
    <div>
      {owed.length > 0 && (
        <Group title="Le deben" tip="Lo que otros integrantes del hogar todavía no le han pagado a esta persona.">
          {owed.map((d) => (
            <button key={d.id} type="button" onClick={() => onSelect(d)} className="w-full text-left py-2 px-2 border-b border-white/[0.06] last:border-0 group hover:bg-white/[0.04] rounded-lg transition-colors">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-[#f0fae8] truncate">{nameOf ? nameOf(d.debtor) : 'Alguien'} <span className="text-[#8a929a]">· {d.concept}</span></p>
                  <p className="text-[10px] font-mono text-[#8a929a]">{format(toDate(d.date), 'dd MMM yyyy', { locale: es })}</p>
                </div>
                <span className="font-mono font-semibold text-emerald-300 text-xs flex-shrink-0">{formatCOP(remainingOf(d))}</span>
              </div>
            </button>
          ))}
        </Group>
      )}
      {pendientes.length > 0 && (
        <Group title="Pendiente" tip="Gastos sin cubrir todavía: ni abonados ni cruzados.">
          {pendientes.map((item) => item.kind === 'group' ? (
            <ExpenseGroupItem key={item.edges[0].expenseId} concept={item.concept} edges={item.edges} canCross={canCross} creditorName={creditorName} creditorUid={creditorUid} colorOf={colorOf} photoOf={photoOf} canAbonar={canAbonar} onCross={onCross} onAbonar={onAbonar} onSelect={onSelect} />
          ) : (
            <DebtItem key={item.d.id} d={item.d} canCross={typeof canCross === 'function' ? canCross(item.d) : canCross} creditor={creditorName?.(item.d) ?? null} canAbonar={canAbonar} onCross={() => onCross(item.d)} onAbonar={() => onAbonar(item.d)} onSelect={() => onSelect(item.d)} />
          ))}
        </Group>
      )}
      {cruzados.length > 0 && (
        <Group title="Cruzado" tip="Se compensó contra un gasto de la otra persona, sin mover dinero entre ambos.">
          {cruzados.map((d) => <StatusItem key={d.id} d={d} label="Cruzado" chip="bg-sky-500/15 text-sky-300 border-sky-500/30" onSelect={() => onSelect(d)} />)}
        </Group>
      )}
      {saldados.length > 0 && (
        <Group title="Pagado" tip="Se pagó directamente, en efectivo o transferencia: ya no cuenta como pendiente.">
          {saldados.map((d) => <StatusItem key={d.id} d={d} label="Pagado" chip="bg-emerald-500/15 text-emerald-300 border-emerald-500/30" onSelect={() => onSelect(d)} />)}
        </Group>
      )}
      {abonos.length > 0 && (
        <Group title="Movimientos de abono" tip="El historial de pagos directos registrados, en orden.">
          {abonos.map((d) => <StatusItem key={d.id} d={d} label="Abono" chip="bg-brand-500/20 text-brand-300 border-brand-500/40" onSelect={() => onSelect(d)} />)}
        </Group>
      )}
    </div>
  )
}

interface PersonCardProps {
  name: string
  role: string
  photoURL: string | null
  color: string
  /** No account, can't log in — flagged next to the name and with a dashed avatar ring, same language as the expense wizard's participant picker. */
  isGuest?: boolean
  net: number
  breakdown: { deuda: number; abono: number; cruzado: number; saldo: number }
  debts: Rec[]
  /** One value for the whole card, or decided per debt (each debt may be owed to a different person). */
  canCross: boolean | ((d: Rec) => boolean)
  /** Whom a debt is owed to, shown next to it when the household has several people. */
  creditorName?: (d: Rec) => string | null
  /** Whom a debt is owed to, by uid — a grouped expense's edges show that person's avatar with it. */
  creditorUid?: (d: Rec) => string | null
  colorOf?: (uid: string) => string
  photoOf?: (uid: string) => string | null
  /** Only the person themselves registers abonos to their own debts. */
  canAbonar: boolean
  expanded: boolean
  onToggle: () => void
  onAbonarAll: () => void
  onCross: (d: Rec) => void
  onAbonar: (d: Rec) => void
  onSelect: (d: Rec) => void
  /** Pending debts where this person is owed, not owing — otherwise invisible once they're "al día" themselves. */
  owedToMe?: Rec[]
  /** Names the debtor of each `owedToMe` row. */
  nameOf?: (uid: string) => string
  /** Drops this card's own border/background so several can sit as rows inside one shared container (the household roster). */
  bare?: boolean
}

/** One member of the household: balance chip on top, breakdown and debts when expanded. */
export function PersonCard({ name, role, photoURL, color, isGuest, net, breakdown, debts, canCross, creditorName, creditorUid, colorOf, photoOf, canAbonar, expanded, onToggle, onAbonarAll, onCross, onAbonar, onSelect, owedToMe, nameOf, bare }: PersonCardProps) {
  return (
    <div className={bare ? '' : 'rounded-2xl border border-white/10 bg-[#0a1f2f] shadow-xl overflow-hidden'}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        className="w-full flex items-center gap-3 p-4 hover:bg-white/[0.04] transition-colors text-left cursor-pointer"
      >
        <Avatar name={name} photoURL={photoURL} size={36} color={color} className={isGuest ? '!ring-0 border-2 border-dashed border-white/35' : '!ring-white/20'} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#f3f5f6] truncate flex items-center gap-1.5">
            <span className="truncate">{name}</span>
            {isGuest && <span className="flex-shrink-0 text-[9px] font-bold tracking-wide text-[#8a929a] border border-dashed border-white/25 rounded-full px-1.5 py-0.5">INVITADO</span>}
          </p>
          <p className="font-pixel text-[8px] text-[#8a929a] uppercase tracking-widest">{role}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {net > 0 ? (
            <span className="text-sm font-bold font-mono text-amber-300">{formatCOP(net)}</span>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-1 rounded-md">Al día</span>
          )}
          <ChevronDown size={14} className={clsx('text-[#8a929a] transition-transform duration-200', expanded && 'rotate-180')} />
        </div>
      </div>

      <ExpandSection open={expanded}>
        <div className="px-4 pb-3 border-t border-white/10 pt-3">
          {net > 0 && canAbonar && (
            <button
              onClick={onAbonarAll}
              className="w-full mb-3 py-1.5 rounded-lg border border-brand-500/30 bg-brand-500/10 hover:bg-brand-500/20 text-brand-300 text-[11px] font-semibold transition flex items-center justify-center gap-1.5"
              title={`Registrar abono de ${name}`}
            >
              <Coins size={12} /> Abonar al saldo de {name}
            </button>
          )}
          <BalanceBreakdown name={name} {...breakdown} />
          <PersonDebtGroups personDebts={debts} canCross={canCross} creditorName={creditorName} creditorUid={creditorUid} colorOf={colorOf} photoOf={photoOf} canAbonar={canAbonar} onCross={onCross} onAbonar={onAbonar} onSelect={onSelect} owedToMe={owedToMe} nameOf={nameOf} />
        </div>
      </ExpandSection>
    </div>
  )
}
