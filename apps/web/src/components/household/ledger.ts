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
  /** what every person of the household owes after this movement, by uid */
  totals: Record<string, number>
  /** how much the household owes in total after this movement (people ahead don't offset people behind) */
  totalOwed: number
  /** the debt this abono / crossing belongs to, when it is tied to one */
  linkId?: string | null
  /** on a debt row: its abonos and crossings; on a payment row: the abonos it was split into, oldest first */
  children?: LedgerRow[]
  /** stable id of a payment row */
  key?: string
  /** on an abono inside a debt: the debt it pays, and the total of the payment it came from */
  target?: Rec
  payTotal?: number
  /** myTotal - partnerTotal: positive means "me" owes more */
  diffAfter: number
}

/**
 * Event-sourced ledger of every movement since day one, oldest first. Each person's running
 * total is tracked separately so the balance never depends on the mutable crossedAmount snapshot.
 */
export function buildLedger(debts: Rec[], crossings: Rec[], userUid: string | undefined, partnerUid: string | null) {
  type Ev = Omit<LedgerRow, 'isMe' | 'myTotal' | 'partnerTotal' | 'diffAfter' | 'totals' | 'totalOwed' | 'children'>
  const events: Ev[] = []
  for (const d of debts) {
    events.push({
      date: toDate(d.date),
      debtor: d.debtor as string,
      concept: d.concept as string,
      delta: d.tipo === 'Deuda' ? (d.amount as number) : -(d.amount as number),
      kind: d.tipo === 'Deuda' ? 'deuda' : 'abono',
      debt: d,
      linkId: d.tipo === 'Abono' ? ((d.saldaId as string) || null) : null,
    })
  }
  for (const c of crossings) {
    const debt1 = debts.find((d) => d.id === c.debt1Id)
    if (!debt1) continue
    const dt = toDate(c.createdAt)
    // 1. the crossed debt's debtor is reduced
    events.push({ date: dt, debtor: debt1.debtor as string, concept: `Cruce: ${debt1.concept}`, delta: -(c.amount as number), kind: 'cruce', linkId: debt1.id as string })
    // 2. the bilateral counterpart is reduced by the same compensated amount
    const counterpartUid = c.debt2Id ? debts.find((d) => d.id === c.debt2Id)?.debtor : c.debt2PersonId
    if (counterpartUid) {
      events.push({ date: dt, debtor: counterpartUid as string, concept: `Compensación bilateral: ${debt1.concept}`, delta: -(c.amount as number), kind: 'cruce', linkId: (c.debt2Id as string) || null })
    }
  }
  // Same-day movements keep the order they happened in: debts before the crossings and abonos that settle them,
  // and among debts, the order they were registered (installments of one loan by their number)
  const rank: Record<LedgerKind, number> = { deuda: 0, cruce: 1, abono: 2 }
  const made = (e: Ev) => (e.debt?.createdAt ? toDate(e.debt.createdAt).getTime() : 0)
  events.sort((a, b) =>
    a.date.getTime() - b.date.getTime()
    || rank[a.kind] - rank[b.kind]
    || made(a) - made(b)
    || ((a.debt?.installment as number) || 0) - ((b.debt?.installment as number) || 0))

  let runningMe = 0
  let runningPartner = 0
  const byPerson: Record<string, number> = {}
  const rows: LedgerRow[] = events.map((ev) => {
    const isMe = ev.debtor === userUid
    if (isMe) runningMe += ev.delta
    else runningPartner += ev.delta // in a household of several, "partner" stands for everyone else together
    byPerson[ev.debtor] = (byPerson[ev.debtor] ?? 0) + ev.delta
    const totals = { ...byPerson }
    const totalOwed = Object.values(totals).reduce((s, v) => s + Math.max(0, v), 0)
    return { ...ev, isMe, myTotal: runningMe, partnerTotal: runningPartner, diffAfter: runningMe - runningPartner, totals, totalOwed }
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
    carryOwed: before.length > 0 ? before[before.length - 1].totalOwed : 0,
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

export type StatusKey = 'overdue' | 'due-soon' | 'pending' | 'settled' | 'crossed' | 'abono'

/** Same states and colours as Gastos fijos: red only once it is overdue, amber when it is about to be, indigo while it just waits. */
export const STATUS_META: Record<StatusKey, { label: string; chip: string; border: string; node: string; amount: string }> = {
  overdue:    { label: 'Vencida',    chip: 'bg-red-500/20 text-red-300 border-red-500/40',           border: 'border-red-500/40 hover:border-red-400/80',         node: '#ef4444', amount: 'text-red-300' },
  'due-soon': { label: 'Por vencer', chip: 'bg-amber-500/20 text-amber-300 border-amber-500/40',     border: 'border-amber-500/40 hover:border-amber-400/80',     node: '#f59e0b', amount: 'text-amber-300' },
  pending:    { label: 'Pendiente',  chip: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/35',  border: 'border-indigo-500/35 hover:border-indigo-400/80',   node: '#818cf8', amount: 'text-indigo-300' },
  settled:    { label: 'Pagada',     chip: 'bg-brand-500/20 text-brand-300 border-brand-500/40',     border: 'border-brand-500/40 hover:border-brand-400/80',     node: '#52b69a', amount: 'text-brand-300' },
  crossed:    { label: 'Cruzada',    chip: 'bg-sky-500/15 text-sky-300 border-sky-500/30',           border: 'border-sky-500/30 hover:border-sky-400/80',         node: '#38bdf8', amount: 'text-sky-300' },
  abono:      { label: 'Pago',       chip: 'bg-brand-500/20 text-brand-300 border-brand-500/40',     border: 'border-brand-500/40 hover:border-brand-400/80',     node: '#52b69a', amount: 'text-brand-300' },
}

const DUE_SOON_DAYS = 3

/**
 * State of a row. A debt is red only when its date has passed with something still owed; within 3 days of it, amber;
 * otherwise (a later date, or no agreed date) it is just pending. Partly paid debts keep the state of what is left.
 */
export function statusOf(row: Pick<LedgerRow, 'kind' | 'debt'>, today: Date = new Date()): StatusKey {
  if (row.kind === 'cruce') return 'crossed'
  if (row.kind === 'abono') return 'abono'
  const d = row.debt
  const rem = d ? remainingOf(d) : 0
  if (rem <= 0) return d?.cruzado && (d?.crossedAmount || 0) >= (d?.amount || 0) ? 'crossed' : 'settled'
  if (!d?.dueDate) return 'pending'
  const due = toDate(d.dueDate)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() - start.getTime()) / 86_400_000)
  if (days < 0) return 'overdue'
  return days <= DUE_SOON_DAYS ? 'due-soon' : 'pending'
}

/** Most urgent first: colours a day's node. */
export const STATUS_SEVERITY: StatusKey[] = ['overdue', 'due-soon', 'pending', 'crossed', 'settled', 'abono']

/**
 * Abonos that belong to the same payment: they share a `paymentId`; older ones (before it existed) are the abonos of one
 * person, same day, written within a few seconds of each other.
 */
function paymentKeys(rows: LedgerRow[]): Map<LedgerRow, string> {
  const keys = new Map<LedgerRow, string>()
  const legacy = rows
    .filter((r) => r.kind === 'abono' && !r.debt?.paymentId)
    .sort((x, y) => (x.debt?.createdAt ? toDate(x.debt.createdAt).getTime() : 0) - (y.debt?.createdAt ? toDate(y.debt.createdAt).getTime() : 0))
  let n = 0
  let prev: LedgerRow | null = null
  for (const r of legacy) {
    const t = r.debt?.createdAt ? toDate(r.debt.createdAt).getTime() : 0
    const pt = prev?.debt?.createdAt ? toDate(prev.debt.createdAt).getTime() : 0
    const same = prev && prev.debtor === r.debtor && prev.date.toDateString() === r.date.toDateString() && Math.abs(t - pt) <= 5000
    if (!same) n++
    keys.set(r, `legacy-${n}`)
    prev = r
  }
  for (const r of rows) if (r.kind === 'abono' && r.debt?.paymentId) keys.set(r, r.debt.paymentId as string)
  return keys
}

/**
 * The timeline's rows: one per debt (its abonos and crossings inside as detail) and one per PAYMENT (what the person paid
 * in total, when, and how it was distributed among the debts). Crossings tied to no debt stay as rows of their own.
 */
export function nestByDebt(rows: LedgerRow[]): LedgerRow[] {
  const parents = new Map<string, LedgerRow>()
  // a debt sits on the day it has to be paid (installments in their payment order), not on the day it was registered
  for (const r of rows) if (r.kind === 'deuda' && r.debt?.id) parents.set(r.debt.id as string, { ...r, date: r.debt.dueDate ? toDate(r.debt.dueDate) : r.date, children: [] })

  const keys = paymentKeys(rows)
  const payments = new Map<string, LedgerRow>()
  const paymentTotal = new Map<string, number>()
  for (const [r, k] of keys) paymentTotal.set(k, (paymentTotal.get(k) ?? 0) + Math.abs(r.delta))

  const top: LedgerRow[] = []
  for (const r of rows) {
    if (r.kind === 'deuda' && r.debt?.id) { top.push(parents.get(r.debt.id as string)!); continue }
    const parent = r.linkId ? parents.get(r.linkId) : undefined
    const key = keys.get(r)
    const piece: LedgerRow = { ...r, target: parent?.debt, payTotal: key ? paymentTotal.get(key) : undefined }
    if (parent) parent.children!.push(piece)
    if (r.kind !== 'abono') { if (!parent) top.push(r); continue }
    // an abono belongs to a payment row, which carries the total and the distribution
    const existing = key ? payments.get(key) : undefined
    if (existing) { existing.children!.push(piece); existing.delta = -(paymentTotal.get(key!) ?? 0); existing.totals = r.totals; existing.totalOwed = r.totalOwed; existing.diffAfter = r.diffAfter; continue }
    const pay: LedgerRow = { ...r, key: key ? `pay-${key}` : undefined, delta: -(paymentTotal.get(key ?? '') ?? Math.abs(r.delta)), children: [piece], debt: undefined, concept: '' }
    if (key) payments.set(key, pay)
    top.push(pay)
  }
  for (const pay of payments.values()) {
    const kids = pay.children ?? []
    pay.concept = kids.length === 1 ? (kids[0].debt?.concept as string) : `Pago repartido en ${kids.length} deudas`
  }
  for (const r of top) if (r.kind === 'abono' && !r.concept) r.concept = (r.children?.[0]?.debt?.concept as string) ?? 'Abono'
  const rank: Record<LedgerKind, number> = { deuda: 0, cruce: 1, abono: 2 }
  const at = (r: LedgerRow) => (r.debt?.createdAt ? toDate(r.debt.createdAt).getTime() : 0)
  return top.sort((a, b) =>
    a.date.getTime() - b.date.getTime()
    || rank[a.kind] - rank[b.kind]
    || ((a.debt?.installment as number) || 0) - ((b.debt?.installment as number) || 0)
    || at(a) - at(b))
}
