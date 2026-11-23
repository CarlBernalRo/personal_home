import { creditorOf, isLegacyClosed, remainingOf, toDate, type Rec } from '@/shared'

export { toDate, type Rec }

export type LedgerKind = 'deuda' | 'abono' | 'cruce'

export interface LedgerRow {
  date: Date
  debtor: string
  delta: number
  concept: string
  kind: LedgerKind
  debt?: Rec
  isMe: boolean
  /** what I owe / what my partner owes after this movement (below zero: what they are owed) */
  myTotal: number
  partnerTotal: number
  /** what every person of the household owes after this movement, by uid — below zero, what they are owed */
  totals: Record<string, number>
  /** how much is still to be paid in the household after this movement (what those who owe, owe) */
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
  /** what I owe after this movement (below zero: what I am owed); between two people, the whole balance */
  diffAfter: number
  /** this row stands for a shared expense, not one debt: `children` holds every debtor→creditor edge it generated */
  isExpenseGroup?: boolean
  /** on an expense group: who declared putting money in, and how much — independent of `children`, which is who ended up owing whom */
  expensePayers?: { uid: string; amount: number; pending: boolean; declined: boolean }[]
  /** a declared payer rejected their contribution: part of the settlement can't exist until the expense is fixed or deleted */
  expenseIncomplete?: boolean
}

/**
 * Event-sourced ledger of every movement since day one, oldest first, with what each person owes after each one — the
 * same balance as the household engine: a debt weighs on its debtor and in favor of its creditor, a payment the other
 * way round, and a crossing (no money moved) changes nobody's balance.
 */
export function buildLedger(debts: Rec[], crossings: Rec[], userUid: string | undefined, partnerUid: string | null, members?: string[]) {
  const people = members ?? [...new Set([userUid, partnerUid].filter((x): x is string => !!x))]
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

  const byPerson: Record<string, number> = {}
  const move = (uid: string | null | undefined, by: number) => { if (uid) byPerson[uid] = (byPerson[uid] ?? 0) + by }
  const rows: LedgerRow[] = events.map((ev) => {
    const d = ev.debt
    if (d && !isLegacyClosed(d) && (d.amount as number) > 0) {
      const other = creditorOf(d, people)
      if (other !== d.debtor) {
        const amount = d.amount as number
        // a debt: its debtor owes more and its creditor is owed more · a payment: the payer owes less, the receiver more
        move(d.debtor as string, ev.kind === 'deuda' ? amount : -amount)
        move(other, ev.kind === 'deuda' ? -amount : amount)
      }
    }
    const totals = { ...byPerson }
    const totalOwed = Object.values(totals).reduce((s, v) => s + Math.max(0, v), 0)
    const myTotal = userUid ? totals[userUid] ?? 0 : 0
    const partnerTotal = partnerUid ? totals[partnerUid] ?? 0 : 0
    return { ...ev, isMe: ev.debtor === userUid, myTotal, partnerTotal, diffAfter: myTotal, totals, totalOwed }
  })
  return { rows, finalDiff: rows.length > 0 ? rows[rows.length - 1].diffAfter : 0 }
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

export type StatusKey = 'overdue' | 'due-soon' | 'pending' | 'settled' | 'netted' | 'crossed' | 'abono'

/** Same states and colours as Gastos fijos: red only once it is overdue, amber when it is about to be, indigo while it just waits. */
export const STATUS_META: Record<StatusKey, { label: string; chip: string; border: string; node: string; amount: string }> = {
  overdue:    { label: 'Vencida',    chip: 'bg-red-500/20 text-red-300 border-red-500/40',           border: 'border-red-500/40 hover:border-red-400/80',         node: '#ef4444', amount: 'text-red-300' },
  'due-soon': { label: 'Por vencer', chip: 'bg-amber-500/20 text-amber-300 border-amber-500/40',     border: 'border-amber-500/40 hover:border-amber-400/80',     node: '#f59e0b', amount: 'text-amber-300' },
  pending:    { label: 'Pendiente',  chip: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/35',  border: 'border-indigo-500/35 hover:border-indigo-400/80',   node: '#818cf8', amount: 'text-indigo-300' },
  settled:    { label: 'Pagada',     chip: 'bg-brand-500/20 text-brand-300 border-brand-500/40',     border: 'border-brand-500/40 hover:border-brand-400/80',     node: '#52b69a', amount: 'text-brand-300' },
  netted:     { label: 'Compensada', chip: 'bg-violet-500/15 text-violet-300 border-violet-500/35',  border: 'border-violet-500/35 hover:border-violet-400/80',   node: '#a78bfa', amount: 'text-violet-300' },
  crossed:    { label: 'Cruzada',    chip: 'bg-sky-500/15 text-sky-300 border-sky-500/30',           border: 'border-sky-500/30 hover:border-sky-400/80',         node: '#38bdf8', amount: 'text-sky-300' },
  abono:      { label: 'Pago',       chip: 'bg-brand-500/20 text-brand-300 border-brand-500/40',     border: 'border-brand-500/40 hover:border-brand-400/80',     node: '#52b69a', amount: 'text-brand-300' },
}

const DUE_SOON_DAYS = 3

/**
 * State of a row. A debt is red only when its date has passed with something still owed; within 3 days of it, amber;
 * otherwise (a later date, or no agreed date) it is just pending. Partly paid debts keep the state of what is left.
 */
export function statusOf(row: Pick<LedgerRow, 'kind' | 'debt' | 'isExpenseGroup' | 'children' | 'expensePayers'>, today: Date = new Date()): StatusKey {
  if (row.isExpenseGroup) {
    const kids = row.children ?? []
    // no debts yet: either they wait for someone's confirmation, or nobody ended up owing anybody
    if (kids.length === 0) return (row.expensePayers ?? []).some((p) => p.pending) ? 'pending' : 'settled'
    const states = kids.map((k) => statusOf(k, today))
    // every share closed, however (paid, compensated or crossed): the expense is settled
    if (states.every((s) => s === 'settled' || s === 'netted' || s === 'crossed')) return 'settled'
    return STATUS_SEVERITY.find((s) => states.includes(s)) ?? 'pending'
  }
  if (row.kind === 'cruce') return 'crossed'
  if (row.kind === 'abono') return 'abono'
  const d = row.debt
  const rem = d ? remainingOf(d) : 0
  if (rem <= 0) {
    if (d?.cruzado && (d?.crossedAmount || 0) >= (d?.amount || 0)) return 'crossed'
    // covered only by what the debtor is owed / paid elsewhere, not by paying this debt: compensated, not paid
    return d?.coverage && d.coverage.netted > 0 && d.coverage.abonado === 0 && d.coverage.crossed === 0 ? 'netted' : 'settled'
  }
  if (!d?.dueDate) return 'pending'
  const due = toDate(d.dueDate)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() - start.getTime()) / 86_400_000)
  if (days < 0) return 'overdue'
  return days <= DUE_SOON_DAYS ? 'due-soon' : 'pending'
}

/** Most urgent first: colours a day's node. */
export const STATUS_SEVERITY: StatusKey[] = ['overdue', 'due-soon', 'pending', 'crossed', 'netted', 'settled', 'abono']

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
  // one paymentId can hold abonos of different people and to different creditors: each pair is its own row, so its
  // amount, receipt state and delete only ever speak for that part
  for (const r of rows) if (r.kind === 'abono' && r.debt?.paymentId) keys.set(r, `${r.debt.paymentId}|${r.debtor}|${(r.debt.creditor as string | undefined) ?? ''}`)
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

/**
 * A shared expense split among several people writes one debt per debtor who still owes someone —
 * the timeline otherwise shows that same expense two, three, four times over. This collapses every
 * debt row tied to the same expense into one row for the expense itself (its real total, from the
 * expense record — not just what's left to settle peer-to-peer), with the individual debtor→creditor
 * edges as its children: closed by default, each still its own clickable debt.
 */
export function groupByExpense(rows: LedgerRow[], expenses: Rec[]): LedgerRow[] {
  const expenseById = new Map<string, Rec>()
  for (const e of expenses) if (e.id) expenseById.set(e.id as string, e)
  if (expenseById.size === 0) return rows

  const edgesOf = new Map<string, LedgerRow[]>()
  const out: LedgerRow[] = []
  for (const r of rows) {
    const expenseId = r.kind === 'deuda' && !r.isExpenseGroup ? (r.debt?.expenseId as string | undefined) : undefined
    if (expenseId && expenseById.has(expenseId)) { edgesOf.set(expenseId, [...(edgesOf.get(expenseId) ?? []), r]); continue }
    out.push(r)
  }
  // An expense whose every debt waits for someone's confirmation has no debt rows yet: without this it would be saved
  // and yet appear nowhere. It still gets its row, with no edges, until the debts exist.
  for (const id of expenseById.keys()) if (!edgesOf.has(id)) edgesOf.set(id, [])

  for (const [expenseId, edges] of edgesOf) {
    const exp = expenseById.get(expenseId)!
    // with no edges, the running totals are those of the last movement before it
    const before = [...rows].filter((r) => r.date <= toDate(exp.date)).pop()
    const last: LedgerRow = edges[edges.length - 1] ?? before ?? { isMe: false, myTotal: 0, partnerTotal: 0, diffAfter: 0, totals: {}, totalOwed: 0 } as LedgerRow
    const payers = ((exp.contributions as Rec[] | undefined) ?? [])
      .map((c) => ({ uid: c.memberId as string, amount: c.amount as number, pending: c.status === 'pending', declined: c.status === 'declined' }))
    out.push({
      date: toDate(exp.date), debtor: exp.registeredBy as string, concept: exp.description as string,
      delta: exp.amount as number, kind: 'deuda', isExpenseGroup: true, key: `exp-${expenseId}`,
      children: edges, expensePayers: payers, expenseIncomplete: payers.some((p) => p.declined), isMe: last.isMe, myTotal: last.myTotal, partnerTotal: last.partnerTotal,
      diffAfter: last.diffAfter, totals: last.totals, totalOwed: last.totalOwed,
    })
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime())
}
