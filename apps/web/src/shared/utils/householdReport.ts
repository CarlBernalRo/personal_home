import { householdBalances, isLegacyClosed } from './householdBalance'
import { creditorOf } from './householdCreditors'

/** Debts and expenses come from Firestore as loose records (dates may be Date, Timestamp or string). */
export type Rec = any

export const toDate = (d: unknown): Date => {
  if (d instanceof Date) return d
  const ts = d as { toDate?: () => Date } | null
  return ts?.toDate ? ts.toDate() : new Date(d as string)
}

/** One shared expense, as it concerns one person: what it cost them and what they put in. */
export interface ReportLine {
  expenseId: string
  description: string
  date: Date
  /** The whole expense. */
  total: number
  /** What this person owed for it. */
  share: number
  /** What this person put in towards it (confirmed). */
  put: number
  /** Put in, but nobody has confirmed it yet: not counted anywhere. */
  putPending: number
}

export interface LedgerLine { label: string; sign: '+' | '−'; amount: number }

export interface PersonReport {
  uid: string
  name: string
  isGuest: boolean
  /** Total of their shares: what the expenses cost them. */
  share: number
  /** What they put in for the expenses (confirmed). */
  put: number
  putPending: number
  /** Loans: what they lent to others, and what others lent them. */
  lent: number
  borrowed: number
  /** Debts registered outside shared expenses and loans: in their favor, and against them. */
  otherIn: number
  otherOut: number
  /**
   * Shared expenses whose registered debts don't match what was put in and each one's part, signed. `expensePending`:
   * someone's contribution waits for confirmation (or was declined), so its debts don't exist yet — expected.
   * `expenseDrift`: everything is confirmed and still the debts don't match — a record to fix (see `checks`).
   */
  expensePending: number
  expenseDrift: number
  /** What they have already paid to others (abonos). */
  paid: number
  /** What others have already paid to them. */
  received: number
  /**
   * Where they stand once everything is counted — the household engine's figure, the same every screen shows.
   * Above zero the others owe them that much; below zero they still have to pay that much.
   */
  position: number
  /** What they paid, by receiver. `credit` is the part that was not tied to a particular debt. */
  paidTo: { to: string; name: string; amount: number; credit: number }[]
  /** Payments not tied to any debt: they count in full for whoever paid, whatever debt they end up covering. */
  credit: { total: number }
  /** The payments this person has to make so that everybody ends even. */
  pays: { to: string; name: string; amount: number }[]
  /** The payments this person will receive. */
  receives: { from: string; name: string; amount: number }[]
  lines: ReportLine[]
  /** The account, line by line: what adds and what subtracts to reach `position`. */
  ledger: LedgerLine[]
  /** The same account as text (PDF, messages). */
  summary: string
}

export interface PlanPayment { from: string; fromName: string; to: string; toName: string; amount: number }

/** A shared expense whose registered debts say something different from its own figures (and why). */
export interface ExpenseCheck {
  expenseId: string
  description: string
  /** 'pending': a contribution waits for confirmation, so some of its debts don't exist yet (expected) · 'declined' ·
   * 'drift': everything is confirmed and still the debts don't match the expense — this is the one to look at. */
  reason: 'pending' | 'declined' | 'drift'
  /** Per person: what the expense says (put − share) vs. what its registered debts say. */
  people: { uid: string; name: string; expected: number; recorded: number }[]
}

export interface HouseholdReport {
  name: string
  generatedAt: Date
  expenseCount: number
  /** Everything the shared expenses cost together. */
  total: number
  people: PersonReport[]
  /** How everybody ends even with the fewest payments: who pays whom. */
  plan: PlanPayment[]
  /** When the plan was fixed (shared with everybody); null while it is still worked out live. */
  frozenAt: Date | null
  /** How much the fixed plan had to be adjusted because something changed outside it (0 = it holds as shared). */
  adjusted: number
  /** Total money that has to change hands once everyone's debts and credits are set against each other. */
  toMove: number
  /** What is still open debt by debt (the engine's figure): with no adjustment pending it equals `toMove`. */
  registered: number
  /** Declared contributions still waiting for confirmation: some of the numbers may change. */
  unconfirmed: number
  /** Expenses whose registered debts don't match them (see `ExpenseCheck`). */
  checks: ExpenseCheck[]
  /** False when some record has no known counterpart, so the books cannot close to zero. */
  balanced: boolean
}

/** The payments shared with everybody, saved in the household so they stay the same. */
export interface FrozenPlan {
  atMs: number
  payments: { from: string; to: string; amount: number }[]
}

/**
 * The household's accounts as ONE settlement. Where each person stands comes from the household engine
 * (`householdBalances`: every registered debt and every payment, however it was made); this adds the explanation —
 * what each shared expense cost them and what they put in, their loans and other debts — and the fewest payments that
 * leave everybody even (or the plan that was shared, kept as it was and adjusted for whatever happened since).
 */
export function buildHouseholdReport(input: {
  name: string
  members: string[]
  guestIds: string[]
  nameOf: (uid?: string | null) => string
  expenses: Rec[]
  /** The household's rows (debts and abonos), stored or already annotated. */
  debts: Rec[]
  generatedAt?: Date
  /** The plan that was shared with everybody: when set, it is kept instead of being worked out again. */
  frozenPlan?: FrozenPlan | null
}): HouseholdReport {
  const { members, guestIds, nameOf, expenses, debts } = input
  const balances = householdBalances(debts, members)
  const people: PersonReport[] = [...balances.people.keys()].map((uid) => ({
    uid, name: nameOf(uid), isGuest: guestIds.includes(uid),
    share: 0, put: 0, putPending: 0, lent: 0, borrowed: 0, otherIn: 0, otherOut: 0, expensePending: 0, expenseDrift: 0, paid: 0, received: 0,
    position: balances.people.get(uid)!.position, paidTo: [], credit: { total: 0 }, pays: [], receives: [], lines: [], ledger: [], summary: '',
  }))
  const by = new Map(people.map((p) => [p.uid, p]))

  // What each registered debt does to each person, by where it was born
  const expenseIds = new Set(expenses.map((e) => e.id as string))
  const recordedByExpense = new Map<string, Map<string, number>>()
  for (const d of debts) {
    if (d.tipo !== 'Deuda' || isLegacyClosed(d) || !((d.amount as number) > 0)) continue
    const creditor = creditorOf(d, members)
    if (!creditor || creditor === d.debtor) continue
    const debtor = by.get(d.debtor as string)
    const owed = by.get(creditor)
    const amount = d.amount as number
    if (d.expenseId && expenseIds.has(d.expenseId)) {
      const m = recordedByExpense.get(d.expenseId) ?? new Map<string, number>()
      m.set(d.debtor, (m.get(d.debtor) ?? 0) - amount)
      m.set(creditor, (m.get(creditor) ?? 0) + amount)
      recordedByExpense.set(d.expenseId, m)
    } else if (d.loanId) {
      if (debtor) debtor.borrowed += amount
      if (owed) owed.lent += amount
    } else {
      if (debtor) debtor.otherOut += amount
      if (owed) owed.otherIn += amount
    }
  }

  let total = 0
  const checks: ExpenseCheck[] = []
  const sorted = [...expenses].sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())
  for (const e of sorted) {
    total += e.amount as number
    const contributions = (e.contributions as Rec[] | undefined) ?? []
    const shares = (e.shares as Rec[] | undefined) ?? []
    const putBy = new Map<string, { put: number; pending: number }>()
    if (contributions.length > 0) {
      for (const c of contributions) {
        const cur = putBy.get(c.memberId as string) ?? { put: 0, pending: 0 }
        if (c.status === 'confirmed') cur.put += c.amount as number
        else if (c.status === 'pending') cur.pending += c.amount as number
        putBy.set(c.memberId as string, cur)
      }
    } else {
      // older records: what each share says they put in
      for (const s of shares) if ((s.paid as number) > 0) putBy.set(s.memberId as string, { put: s.paid as number, pending: 0 })
    }
    const recorded = recordedByExpense.get(e.id) ?? new Map<string, number>()
    const involved = new Set<string>([...shares.map((s) => s.memberId as string), ...putBy.keys(), ...recorded.keys()])
    const reason: ExpenseCheck['reason'] = contributions.some((c) => c.status === 'pending') ? 'pending' : contributions.some((c) => c.status === 'declined') ? 'declined' : 'drift'
    const diffs: ExpenseCheck['people'] = []
    for (const uid of involved) {
      const share = (shares.find((s) => s.memberId === uid)?.amount as number) ?? 0
      const put = putBy.get(uid)?.put ?? 0
      const pending = putBy.get(uid)?.pending ?? 0
      const rec = recorded.get(uid) ?? 0
      const p = by.get(uid)
      if (p) {
        p.share += share
        p.put += put
        p.putPending += pending
        if (reason === 'drift') p.expenseDrift += rec - (put - share)
        else p.expensePending += rec - (put - share)
        if (share > 0 || put > 0 || pending > 0) p.lines.push({ expenseId: e.id as string, description: e.description as string, date: toDate(e.date), total: e.amount as number, share, put, putPending: pending })
      }
      if (Math.abs(rec - (put - share)) >= 1) diffs.push({ uid, name: nameOf(uid), expected: put - share, recorded: rec })
    }
    if (diffs.length > 0) checks.push({ expenseId: e.id as string, description: e.description as string, reason, people: diffs })
  }

  // money that already changed hands between people
  for (const d of debts) {
    if (d.tipo !== 'Abono' || isLegacyClosed(d) || !((d.amount as number) > 0)) continue
    const receiverId = creditorOf(d, members)
    if (receiverId === d.debtor) continue
    const payer = by.get(d.debtor as string)
    const receiver = receiverId ? by.get(receiverId) : undefined
    if (payer) {
      payer.paid += d.amount as number
      const key = receiverId ?? ''
      let row = payer.paidTo.find((x) => x.to === key)
      if (!row) { row = { to: key, name: key ? nameOf(key) : 'alguien', amount: 0, credit: 0 }; payer.paidTo.push(row) }
      row.amount += d.amount as number
      if (!d.saldaId) { row.credit += d.amount as number; payer.credit.total += d.amount as number }
    }
    if (receiver) receiver.received += d.amount as number
  }
  for (const p of people) p.paidTo.sort((a, b) => b.amount - a.amount)

  // the fewest payments that leave everybody even: the ones who still owe pay the ones who are owed, biggest first
  const debtors = people.filter((p) => p.position < 0).map((p) => ({ p, left: -p.position })).sort((a, b) => b.left - a.left || a.p.name.localeCompare(b.p.name))
  const creditors = people.filter((p) => p.position > 0).map((p) => ({ p, left: p.position })).sort((a, b) => b.left - a.left || a.p.name.localeCompare(b.p.name))
  const plan: PlanPayment[] = []
  const frozen = input.frozenPlan && input.frozenPlan.payments.length > 0 ? input.frozenPlan : null
  let adjusted = 0
  if (frozen) {
    // A plan that was already shared stays as it was: each payment only goes down by what that person has since paid
    // to that same person, so what everybody was told never reshuffles under their feet.
    for (const fp of frozen.payments) {
      const from = by.get(fp.from)
      const to = by.get(fp.to)
      if (!from || !to) continue
      const since = debts
        .filter((d) => d.tipo === 'Abono' && !isLegacyClosed(d) && d.debtor === fp.from && creditorOf(d, members) === fp.to && toDate((d.createdAt ?? d.date) as any).getTime() >= frozen.atMs)
        .reduce((s, d) => s + (d.amount as number), 0)
      const left = fp.amount - since
      if (left <= 0) continue
      plan.push({ from: from.uid, fromName: from.name, to: to.uid, toName: to.name, amount: left })
    }

    // Anything that happened outside the plan since it was fixed — a new or corrected expense, a payment to someone the
    // plan did not say, paying more than a line — leaves someone's real position different from what the plan settles.
    // That difference is settled with as few extra payments as possible, laid on top of the shared ones (netted against
    // a line between the same two people when there is one), so the plan always ends everybody even.
    const settles = new Map<string, number>()
    for (const x of plan) {
      settles.set(x.to, (settles.get(x.to) ?? 0) + x.amount)
      settles.set(x.from, (settles.get(x.from) ?? 0) - x.amount)
    }
    const gap = people.map((p) => ({ p, left: Math.round(p.position - (settles.get(p.uid) ?? 0)) }))
    const short = gap.filter((g) => g.left < -1).map((g) => ({ p: g.p, left: -g.left })).sort((a, b) => b.left - a.left || a.p.name.localeCompare(b.p.name))
    const over = gap.filter((g) => g.left > 1).sort((a, b) => b.left - a.left || a.p.name.localeCompare(b.p.name))
    let a = 0
    let b = 0
    while (a < short.length && b < over.length) {
      const take = Math.min(short[a].left, over[b].left)
      const payer = short[a].p
      const payee = over[b].p
      adjusted += take
      const back = plan.find((x) => x.from === payee.uid && x.to === payer.uid)
      const same = plan.find((x) => x.from === payer.uid && x.to === payee.uid)
      if (back) {
        // the opposite line shrinks; if the change is bigger, it turns around
        back.amount -= take
        if (back.amount < 0) plan.push({ from: payer.uid, fromName: payer.name, to: payee.uid, toName: payee.name, amount: -back.amount })
        if (back.amount <= 0) plan.splice(plan.indexOf(back), 1)
      } else if (same) same.amount += take
      else plan.push({ from: payer.uid, fromName: payer.name, to: payee.uid, toName: payee.name, amount: take })
      short[a].left -= take
      over[b].left -= take
      if (short[a].left <= 0) a++
      if (over[b].left <= 0) b++
    }
    for (const x of plan) {
      by.get(x.from)!.pays.push({ to: x.to, name: x.toName, amount: x.amount })
      by.get(x.to)!.receives.push({ from: x.from, name: x.fromName, amount: x.amount })
    }
  }
  let i = 0
  let k = 0
  while (!frozen && i < debtors.length && k < creditors.length) {
    const take = Math.min(debtors[i].left, creditors[k].left)
    if (take > 0) {
      const from = debtors[i].p
      const to = creditors[k].p
      plan.push({ from: from.uid, fromName: from.name, to: to.uid, toName: to.name, amount: take })
      from.pays.push({ to: to.uid, name: to.name, amount: take })
      to.receives.push({ from: from.uid, name: from.name, amount: take })
    }
    debtors[i].left -= take
    creditors[k].left -= take
    if (debtors[i].left <= 0) i++
    if (creditors[k].left <= 0) k++
  }

  for (const p of people) { p.ledger = ledgerOf(p); p.summary = explain(p) }
  const unconfirmed = expenses.reduce((n, e) => n + (((e.contributions as Rec[] | undefined) ?? []).filter((c) => c.status === 'pending').length), 0)
  return {
    name: input.name, generatedAt: input.generatedAt ?? new Date(), expenseCount: expenses.length, total,
    people: people
      .filter((p) => p.share > 0 || p.put > 0 || p.putPending > 0 || p.paid > 0 || p.received > 0 || p.lent > 0 || p.borrowed > 0 || p.otherIn > 0 || p.otherOut > 0 || p.position !== 0)
      // who has to pay the most first, then who is owed the most
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    plan,
    frozenAt: frozen ? new Date(frozen.atMs) : null,
    adjusted,
    toMove: plan.reduce((s, x) => s + x.amount, 0),
    registered: balances.remaining,
    unconfirmed,
    checks,
    balanced: balances.unmatched.length === 0 && Math.abs(people.reduce((s, p) => s + p.position, 0)) < 1,
  }
}

const cop = (n: number) => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
const date = (d: Date) => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')

/**
 * The account in accountant order. Every line that moved this person's balance is here, so the lines always add up to
 * the saldo exactly: shared expenses (what they put in, their part, and anything still waiting for confirmation),
 * loans, other debts, and the money that already changed hands.
 */
function ledgerOf(p: PersonReport): LedgerLine[] {
  const n = p.lines.filter((l) => l.share > 0).length
  const out: LedgerLine[] = []
  if (p.put > 0 || n > 0) out.push({ label: 'Puso de su bolsillo', sign: '+', amount: p.put })
  if (n > 0) out.push({ label: `Su parte de los gastos (${n} ${n === 1 ? 'gasto' : 'gastos'})`, sign: '−', amount: p.share })
  if (Math.round(p.expensePending) !== 0) {
    out.push({ label: 'Gastos con aportes por confirmar (aún no cuentan)', sign: p.expensePending > 0 ? '+' : '−', amount: Math.abs(p.expensePending) })
  }
  if (Math.round(p.expenseDrift) !== 0) {
    out.push({ label: 'Gastos por revisar (sus deudas no cuadran)', sign: p.expenseDrift > 0 ? '+' : '−', amount: Math.abs(p.expenseDrift) })
  }
  if (p.lent > 0) out.push({ label: 'Prestó a otros', sign: '+', amount: p.lent })
  if (p.borrowed > 0) out.push({ label: 'Le prestaron', sign: '−', amount: p.borrowed })
  if (p.otherIn > 0) out.push({ label: 'Otras deudas a su favor', sign: '+', amount: p.otherIn })
  if (p.otherOut > 0) out.push({ label: 'Otras deudas', sign: '−', amount: p.otherOut })
  out.push({ label: 'Ya pagó a otros', sign: '+', amount: p.paid })
  out.push({ label: 'Ya recibió de otros', sign: '−', amount: p.received })
  return out
}

/** The account as text, in accountant order: each line with its sign, then the balance. */
function explain(p: PersonReport): string {
  const rows = p.ledger.map((l) => `${l.sign} ${l.label}: ${cop(l.amount)}`)
  rows.push(p.position < 0 ? `= Saldo: −${cop(-p.position)} (le faltan ${cop(-p.position)} por pagar)`
    : p.position > 0 ? `= Saldo: ${cop(p.position)} (le deben ${cop(p.position)})`
    : '= Saldo: $0 (al día)')
  if (p.credit.total > 0) rows.push(`Incluye ${cop(p.credit.total)} pagados sin atarlos a una deuda: cuentan completos a su favor.`)
  return rows.join(String.fromCharCode(10))
}

/** One message for the whole group (WhatsApp-ready): how everybody settles, plain. */
export function groupMessage(r: HouseholdReport): string {
  const lines: string[] = [`📊 *Cuentas de ${r.name}*`, `Total gastado: *${cop(r.total)}* en ${r.expenseCount} ${r.expenseCount === 1 ? 'gasto' : 'gastos'}`, '']
  const puts = r.people.filter((p) => p.put > 0)
  if (puts.length > 0) {
    lines.push('*Quién puso la plata*')
    for (const p of puts) lines.push(`• ${p.name}: puso ${cop(p.put)} (su parte era ${cop(p.share)})`)
    lines.push('')
  }
  if (r.plan.length > 0) {
    lines.push('*Cómo se paga entre todos*')
    for (const p of r.people.filter((x) => x.pays.length > 0)) {
      if (p.pays.length === 1) lines.push(`• ${p.name} paga *${cop(p.pays[0].amount)}* a ${p.pays[0].name}`)
      else {
        lines.push(`• ${p.name} paga *${cop(p.pays.reduce((s, l) => s + l.amount, 0))}* en total:`)
        for (const l of p.pays) lines.push(`     ↳ ${cop(l.amount)} a ${l.name}`)
      }
    }
    lines.push('', `Total a mover: *${cop(r.toMove)}* en ${r.plan.length} ${r.plan.length === 1 ? 'pago' : 'pagos'}`)
  } else {
    lines.push('✅ Todas las cuentas están al día.')
  }
  if (r.unconfirmed > 0) lines.push('', `⚠️ Hay ${r.unconfirmed} aporte${r.unconfirmed === 1 ? '' : 's'} por confirmar: algunas cuentas pueden cambiar.`)
  return lines.join('\n')
}

/** The message for ONE person: their part, what they put in, where they stand — and exactly who to pay (or who pays them). */
export function personMessage(r: HouseholdReport, p: PersonReport): string {
  const lines: string[] = [`Hola ${p.name} 👋`, `Así van tus cuentas en *${r.name}*:`, '']
  for (const l of p.lines.filter((x) => x.share > 0 || x.put > 0)) {
    const parts = [l.share > 0 ? `te tocó ${cop(l.share)}` : '', l.put > 0 ? `pusiste ${cop(l.put)}` : ''].filter(Boolean)
    lines.push(`• ${l.description} (${date(l.date)}): ${parts.join(' · ')}`)
  }
  lines.push('', `Tu parte total: ${cop(p.share)}`)
  if (p.put > 0) lines.push(`Pusiste: ${cop(p.put)}`)
  if (p.lent > 0) lines.push(`Prestaste: ${cop(p.lent)}`)
  if (p.borrowed > 0) lines.push(`Te prestaron: ${cop(p.borrowed)}`)
  if (p.paid > 0) lines.push(`Ya pagaste: ${cop(p.paid)}`)
  if (p.received > 0) lines.push(`Ya recibiste: ${cop(p.received)}`)
  const out = p.pays.reduce((s, l) => s + l.amount, 0)
  const inn = p.receives.reduce((s, l) => s + l.amount, 0)
  if (out > 0) {
    lines.push('', `👉 *Te toca pagar ${cop(out)}*${p.pays.length === 1 ? ` a ${p.pays[0].name}` : ':'}`)
    if (p.pays.length > 1) for (const l of p.pays) lines.push(`   • ${cop(l.amount)} a ${l.name}`)
  }
  if (inn > 0) {
    lines.push('', `💰 *Te deben ${cop(inn)}*${p.receives.length === 1 ? `: te paga ${p.receives[0].name}` : ':'}`)
    if (p.receives.length > 1) for (const l of p.receives) lines.push(`   • ${l.name} te paga ${cop(l.amount)}`)
  }
  if (out === 0 && inn === 0) lines.push('', '✅ Estás al día')
  return lines.join('\n')
}
