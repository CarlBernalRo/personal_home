import { creditorOf } from '@/shared'
import { toDate, type Rec } from './ledger'

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

export interface PersonReport {
  uid: string
  name: string
  isGuest: boolean
  /** Total of their shares: what the expenses cost them. */
  share: number
  /** What they put in for the expenses (confirmed). */
  put: number
  putPending: number
  /** What they have already paid to others (abonos). */
  paid: number
  /** What others have already paid to them. */
  received: number
  /**
   * Where they stand with their own money once everything is counted: put + paid - received - share.
   * Above zero the others owe them that much; below zero they still have to put that much.
   */
  position: number
  /** What they paid, by receiver; `credit` is the part of it that went beyond the debt with that person (saldo a favor). */
  paidTo: { to: string; name: string; amount: number; credit: number }[]
  /** Saldo a favor: what they paid beyond what they owed, and which of their other debts it covered. */
  credit: { total: number; uses: { to: string; name: string; amount: number }[]; left: number }
  /** The payments this person has to make so that everybody ends even. */
  pays: { to: string; name: string; amount: number }[]
  /** The payments this person will receive. */
  receives: { from: string; name: string; amount: number }[]
  lines: ReportLine[]
  /** The account, line by line: what adds and what subtracts to reach `position`. */
  ledger: { label: string; sign: '+' | '−'; amount: number }[]
  /** The same account as text (PDF, messages). */
  summary: string
}

export interface PlanPayment { from: string; fromName: string; to: string; toName: string; amount: number }

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
  /** The same figure the Hogar screen shows as "por cubrir": every debt registered minus every abono, with nothing compensated. */
  registered: number
  /** Declared contributions still waiting for confirmation: some of the numbers may change. */
  unconfirmed: number
  /** False when some payment has no known receiver, so the books cannot close to zero. */
  balanced: boolean
}

/**
 * The household's accounts as ONE settlement: for each person what the expenses cost them (their share), what they put in
 * from their own pocket, and what they already paid or received — so where they stand — and then the fewest payments
 * that leave everybody even. It works on the money that really moved (confirmed contributions and abonos), so it does
 * not matter which debt an abono was tied to: only who ends up having put in more than their part, and who less.
 */
/** The payments shared with everybody, saved in the household so they stay the same. */
export interface FrozenPlan {
  atMs: number
  payments: { from: string; to: string; amount: number }[]
}

export function buildHouseholdReport(input: {
  name: string
  members: string[]
  guestIds: string[]
  nameOf: (uid?: string | null) => string
  expenses: Rec[]
  /** The household's debt rows (only the abonos in them matter here). */
  debts: Rec[]
  generatedAt?: Date
  /** The plan that was shared with everybody: when set, it is kept instead of being worked out again. */
  frozenPlan?: FrozenPlan | null
}): HouseholdReport {
  const { members, guestIds, nameOf, expenses, debts } = input
  const people: PersonReport[] = members.map((uid) => ({
    uid, name: nameOf(uid), isGuest: guestIds.includes(uid),
    share: 0, put: 0, putPending: 0, paid: 0, received: 0, position: 0, paidTo: [], credit: { total: 0, uses: [], left: 0 }, pays: [], receives: [], lines: [], ledger: [], summary: '',
  }))
  const by = new Map(people.map((p) => [p.uid, p]))

  let total = 0
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
    const involved = new Set<string>([...shares.map((s) => s.memberId as string), ...putBy.keys()])
    for (const uid of involved) {
      const p = by.get(uid)
      if (!p) continue
      const share = (shares.find((s) => s.memberId === uid)?.amount as number) ?? 0
      const put = putBy.get(uid)?.put ?? 0
      const pending = putBy.get(uid)?.pending ?? 0
      p.share += share
      p.put += put
      p.putPending += pending
      p.lines.push({ expenseId: e.id as string, description: e.description as string, date: toDate(e.date), total: e.amount as number, share, put, putPending: pending })
    }
  }

  // money that already changed hands between people
  let unmatched = 0
  for (const d of debts) {
    if (d.tipo !== 'Abono') continue
    const payer = by.get(d.debtor as string)
    const receiver = d.creditor ? by.get(d.creditor as string) : undefined
    if (payer) {
      payer.paid += d.amount as number
      const key = (d.creditor as string) || ''
      let row = payer.paidTo.find((x) => x.to === key)
      if (!row) { row = { to: key, name: key ? nameOf(key) : 'alguien', amount: 0, credit: 0 }; payer.paidTo.push(row) }
      row.amount += d.amount as number
      if (!d.saldaId) { row.credit += d.amount as number; payer.credit.total += d.amount as number }
    }
    if (receiver && receiver.uid !== d.debtor) receiver.received += d.amount as number
    else if (payer) unmatched += d.amount as number
  }

  // where each saldo a favor went: the debts the screen already covered with it (creditApplied)
  for (const d of debts) {
    if (d.tipo !== 'Deuda' || !((d.creditApplied as number) > 0)) continue
    const p = by.get(d.debtor as string)
    if (!p) continue
    const to = (creditorOf(d as any, members) as string | null | undefined) ?? ''
    let u = p.credit.uses.find((x) => x.to === to)
    if (!u) { u = { to, name: to ? nameOf(to) : 'alguien', amount: 0 }; p.credit.uses.push(u) }
    u.amount += d.creditApplied as number
  }
  for (const p of people) {
    p.paidTo.sort((a, b) => b.amount - a.amount)
    p.credit.uses.sort((a, b) => b.amount - a.amount)
    p.credit.left = Math.max(0, p.credit.total - p.credit.uses.reduce((n, u) => n + u.amount, 0))
  }

  for (const p of people) p.position = p.put + p.paid - p.received - p.share

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
        .filter((d) => d.tipo === 'Abono' && d.debtor === fp.from && d.creditor === fp.to && toDate((d.createdAt ?? d.date) as any).getTime() >= frozen.atMs)
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
      .filter((p) => p.share > 0 || p.put > 0 || p.putPending > 0 || p.paid > 0 || p.received > 0)
      // who has to pay the most first, then who is owed the most
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    plan,
    frozenAt: frozen ? new Date(frozen.atMs) : null,
    adjusted,
    toMove: plan.reduce((s, x) => s + x.amount, 0),
    registered: Math.max(0, debts.reduce((s, d) => s + (d.tipo === 'Deuda' ? (d.amount as number) - ((d.crossedAmount as number) || 0) : -(d.amount as number)), 0)),
    unconfirmed,
    balanced: unmatched === 0 && Math.abs(people.reduce((s, p) => s + p.position, 0)) < 1,
  }
}

const cop = (n: number) => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
const date = (d: Date) => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')

/** How the saldo a favor crossed: what they paid beyond the debt, and which of their other debts it covered. */
function creditNote(p: PersonReport): string {
  if (p.credit.total <= 0) return ''
  const first = p.paidTo.filter((x) => x.credit > 0).map((x) => `${cop(x.credit)} de más a ${x.name}`).join(' y ')
  const used = p.credit.uses.length > 0 ? ` Ese saldo cubrió lo que debía a ${p.credit.uses.map((u) => `${u.name} (${cop(u.amount)})`).join(', ')}.` : ''
  const left = p.credit.left > 0 ? ` Le quedan ${cop(p.credit.left)} a favor sin aplicar.` : ''
  return `Pagó ${first}: eso es saldo a favor.${used}${left} `
}

function ledgerOf(p: PersonReport): PersonReport['ledger'] {
  const n = p.lines.filter((l) => l.share > 0).length
  return [
    { label: 'Puso de su bolsillo', sign: '+', amount: p.put },
    { label: 'Ya pagó a otros', sign: '+', amount: p.paid },
    { label: 'Ya recibió de otros', sign: '−', amount: p.received },
    { label: `Su parte de los gastos (${n} ${n === 1 ? 'gasto' : 'gastos'})`, sign: '−', amount: p.share },
  ]
}

/** The account as text, in accountant order: each line with its sign, then the balance. */
function explain(p: PersonReport): string {
  const rows = p.ledger.map((l) => `${l.sign} ${l.label}: ${cop(l.amount)}`)
  rows.push(p.position < 0 ? `= Saldo: −${cop(-p.position)} (le faltan ${cop(-p.position)} por pagar)`
    : p.position > 0 ? `= Saldo: ${cop(p.position)} (le deben ${cop(p.position)})`
    : '= Saldo: $0 (al día)')
  const note = creditNote(p).trim()
  if (note) rows.push(note)
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
        lines.push(`• ${p.name} paga *${cop(-p.position)}* en total:`)
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
  if (p.paid > 0) lines.push(`Ya pagaste: ${cop(p.paid)}`)
  if (p.received > 0) lines.push(`Ya recibiste: ${cop(p.received)}`)
  if (p.position < 0) {
    lines.push('', `👉 *Te toca pagar ${cop(-p.position)}*${p.pays.length === 1 ? ` a ${p.pays[0].name}` : ':'}`)
    if (p.pays.length > 1) for (const l of p.pays) lines.push(`   • ${cop(l.amount)} a ${l.name}`)
  } else if (p.position > 0) {
    lines.push('', `💰 *Te deben ${cop(p.position)}*${p.receives.length === 1 ? `: te paga ${p.receives[0].name}` : ':'}`)
    if (p.receives.length > 1) for (const l of p.receives) lines.push(`   • ${l.name} te paga ${cop(l.amount)}`)
  } else {
    lines.push('', '✅ Estás al día')
  }
  return lines.join('\n')
}
