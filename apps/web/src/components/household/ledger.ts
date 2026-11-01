import { remainingOf } from '@/shared'

/** Debts and crossings come from Firestore as loose records (dates may be Date, Timestamp or string). */
export type Rec = any

export const toDate = (d: unknown): Date => {
  if (d instanceof Date) return d
  const ts = d as { toDate?: () => Date } | null
  return ts?.toDate ? ts.toDate() : new Date(d as string)
}

export type LedgerKind = 'deuda' | 'abono' | 'cruce'

export interface LedgerRow {
  date: Date
  debtor: string
  delta: number
  concept: string
  kind: LedgerKind
  debt?: Rec
  isMe: boolean
  /** each person's own running total after this movement */
  myTotal: number
  partnerTotal: number
  /** myTotal - partnerTotal: positive means "me" owes more */
  diffAfter: number
}

/**
 * Event-sourced ledger of every movement since day one, oldest first. Each person's running
 * total is tracked separately so the balance never depends on the mutable crossedAmount snapshot.
 */
export function buildLedger(debts: Rec[], crossings: Rec[], userUid: string | undefined, partnerUid: string | null) {
  type Ev = Omit<LedgerRow, 'isMe' | 'myTotal' | 'partnerTotal' | 'diffAfter'>
  const events: Ev[] = []
  for (const d of debts) {
    events.push({
      date: toDate(d.date),
      debtor: d.debtor as string,
      concept: d.concept as string,
      delta: d.tipo === 'Deuda' ? (d.amount as number) : -(d.amount as number),
      kind: d.tipo === 'Deuda' ? 'deuda' : 'abono',
      debt: d,
    })
  }
  for (const c of crossings) {
    const debt1 = debts.find((d) => d.id === c.debt1Id)
    if (!debt1) continue
    const dt = toDate(c.createdAt)
    // 1. the crossed debt's debtor is reduced
    events.push({ date: dt, debtor: debt1.debtor as string, concept: `Cruce: ${debt1.concept}`, delta: -(c.amount as number), kind: 'cruce' })
    // 2. the bilateral counterpart is reduced by the same compensated amount
    const counterpartUid = c.debt2Id ? debts.find((d) => d.id === c.debt2Id)?.debtor : c.debt2PersonId
    if (counterpartUid) {
      events.push({ date: dt, debtor: counterpartUid as string, concept: `Compensación bilateral: ${debt1.concept}`, delta: -(c.amount as number), kind: 'cruce' })
    }
  }
  events.sort((a, b) => a.date.getTime() - b.date.getTime())

  let runningMe = 0
  let runningPartner = 0
  const rows: LedgerRow[] = events.map((ev) => {
    const isMe = ev.debtor === userUid
    if (isMe) runningMe += ev.delta
    else if (partnerUid && ev.debtor === partnerUid) runningPartner += ev.delta
    return { ...ev, isMe, myTotal: runningMe, partnerTotal: runningPartner, diffAfter: runningMe - runningPartner }
  })
  return { rows, finalDiff: runningMe - runningPartner }
}

/** The movements of one month, and the balance (me - partner) carried in from the months before it. */
export function splitByMonth(rows: LedgerRow[], monthStart: Date) {
  const next = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)
  const before = rows.filter((r) => r.date < monthStart)
  return {
    monthRows: rows.filter((r) => r.date >= monthStart && r.date < next),
    carryIn: before.length > 0 ? before[before.length - 1].diffAfter : null,
  }
}

/** Step-by-step breakdown of a person's all-time balance: deudas - abonos - cruzado. */
export function balanceBreakdown(debts: Rec[], crossings: Rec[], uid: string | undefined) {
  if (!uid) return { deuda: 0, abono: 0, cruzado: 0, saldo: 0 }
  const own = debts.filter((d) => d.debtor === uid)
  const sum = (list: Rec[], f: (d: Rec) => number) => list.reduce((s, d) => s + f(d), 0)
  const deudas = own.filter((d) => d.tipo === 'Deuda')
  const deuda = sum(deudas, (d) => d.amount as number)
  const abono = sum(own.filter((d) => d.tipo === 'Abono'), (d) => d.amount as number)
  const crossedOwn = sum(deudas, (d) => (d.crossedAmount as number) || 0)
  const crossedInFavor = crossings.filter((c) => c.debt2PersonId === uid && !c.debt2Id).reduce((s, c) => s + (c.amount as number), 0)
  const cruzado = crossedOwn + crossedInFavor
  return { deuda, abono, cruzado, saldo: deuda - abono - cruzado }
}

export type StatusKey = 'pending' | 'partial' | 'settled' | 'crossed' | 'abono'

/** Same colour language as the Fijos / Gastos timelines: the border shows the state, hover intensifies it. */
export const STATUS_META: Record<StatusKey, { label: string; chip: string; border: string; node: string }> = {
  pending: { label: 'Pendiente', chip: 'bg-red-500/15 text-red-300 border-red-500/30',           border: 'border-red-500/40 hover:border-red-400/80',         node: '#ef4444' },
  partial: { label: 'Parcial',   chip: 'bg-amber-500/20 text-amber-300 border-amber-500/40',     border: 'border-amber-500/40 hover:border-amber-400/80',     node: '#f59e0b' },
  settled: { label: 'Saldado',   chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', border: 'border-emerald-500/30 hover:border-emerald-400/80', node: '#34d399' },
  crossed: { label: 'Cruzado',   chip: 'bg-sky-500/15 text-sky-300 border-sky-500/30',           border: 'border-sky-500/30 hover:border-sky-400/80',         node: '#38bdf8' },
  abono:   { label: 'Abono',     chip: 'bg-brand-500/20 text-brand-300 border-brand-500/40',     border: 'border-brand-500/40 hover:border-brand-400/80',     node: '#52b69a' },
}

export function statusOf(row: Pick<LedgerRow, 'kind' | 'debt'>): StatusKey {
  if (row.kind === 'cruce') return 'crossed'
  if (row.kind === 'abono') return 'abono'
  const d = row.debt
  const rem = d ? remainingOf(d) : 0
  if (rem <= 0) return d?.cruzado && (d?.crossedAmount || 0) >= (d?.amount || 0) ? 'crossed' : 'settled'
  if (rem < (d?.amount || 0)) return 'partial'
  return 'pending'
}

/** Most urgent first: colours a day's node. */
export const STATUS_SEVERITY: StatusKey[] = ['pending', 'partial', 'crossed', 'settled', 'abono']
