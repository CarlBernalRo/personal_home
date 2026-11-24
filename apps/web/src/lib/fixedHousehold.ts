import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { createHouseholdExpense, deleteHouseholdExpense, getAllFixedExpensePayments, getFixedExpenses, getHousehold } from './firestore'
import { HOUSEHOLD_DEBT_CATEGORIES, type FixedHouseholdLink } from '@/shared'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const toDate = (d: any): Date => (d instanceof Date ? d : d?.toDate ? d.toDate() : new Date(d))
/** A fixed expense's category, as a household category when there is one of the same kind. */
const householdCategory = (cat: string | undefined) => (HOUSEHOLD_DEBT_CATEGORIES.some((c) => c.id === cat) ? (cat as string) : 'otro')

let running: Promise<void> | null = null

/**
 * Fixed expenses shared with a household: every payment of theirs (from the month the link starts) is a shared expense in
 * that household, paid by the expense's owner, split as the link says — so the others owe their part, exactly as if it
 * had been registered by hand. Kept in step whatever way the payment came in (the app, Telegram, an automatic debit made
 * by the server): missing ones are created, a corrected amount is redone, and a deleted payment takes its share away
 * (the abonos already made on it stay, as money that really moved). Safe to run any number of times, also at once.
 */
export function syncFixedHouseholdShares(uid: string): Promise<void> {
  if (!running) running = run(uid).finally(() => { running = null })
  return running
}

async function run(uid: string) {
  const expenses = (await getFixedExpenses(uid)) as any[]
  const linked = expenses.filter((e) => (e.household as FixedHouseholdLink | undefined)?.householdId)
  if (linked.length === 0) return
  const payments = (await getAllFixedExpensePayments(uid)) as any[]

  for (const fe of linked) {
    const link = fe.household as FixedHouseholdLink
    try {
      const hh = await getHousehold(link.householdId)
      const members = ((hh?.members as string[] | undefined) ?? [])
      if (!hh || !members.includes(uid)) continue
      const guestIds = (hh.guestIds as string[] | undefined) ?? []
      // only people still in the household take part
      const shares = link.shares.filter((s) => members.includes(s.memberId))
      if (shares.length === 0) continue

      const existing = (await getDocs(query(
        collection(db, 'householdExpenses'),
        where('householdId', '==', link.householdId),
        where('fixedLink.fixedExpenseId', '==', fe.id),
      ))).docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      const byMonth = new Map<string, any>(existing.map((x) => [x.fixedLink?.month as string, x]))

      for (const p of payments.filter((x) => x.fixedExpenseId === fe.id && x.month >= link.from)) {
        const current = byMonth.get(p.month)
        byMonth.delete(p.month)
        if (current && current.amount === p.paidAmount) continue
        // a corrected amount: the share is redone (under a new id, so the cleanup of the old one can't touch it)
        if (current) await deleteHouseholdExpense(current.id, link.householdId, { keepPayments: true })
        await createHouseholdExpense({
            householdId: link.householdId,
            description: `${fe.concept} · ${monthLabel(p.month)}`,
            amount: p.paidAmount,
            category: householdCategory(fe.category),
            date: toDate(p.paymentDate),
            splitMode: link.splitMode,
            dueDate: null,
            notes: 'Gasto fijo compartido: se registra solo con cada pago.',
            registeredBy: uid,
            shareInputs: shares.map((s) => (link.splitMode === 'percentage' ? { memberId: s.memberId, percentage: s.percentage ?? 0 } : { memberId: s.memberId })),
            payers: [{ memberId: uid, amount: p.paidAmount }],
          }, guestIds, {
            id: current ? `fx_${fe.id}_${p.month}_${Date.now().toString(36)}` : `fx_${fe.id}_${p.month}`,
            fixedLink: { fixedExpenseId: fe.id, month: p.month, userId: uid },
          })
      }

      // shares whose payment no longer exists
      for (const stale of byMonth.values()) await deleteHouseholdExpense(stale.id, link.householdId, { keepPayments: true })
    } catch (e) {
      console.error(`No se pudo compartir "${fe.concept}" con su hogar:`, e)
    }
  }
}
