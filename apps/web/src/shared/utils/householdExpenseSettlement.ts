import type { ExpenseContribution } from '../types/householdExpense';

export interface ExpenseSettlementEdge {
  debtor: string;
  creditor: string;
  amount: number;
}

/**
 * Turns "who owes what" + "who fronted what" for one shared expense into direct debtor → creditor debts.
 * A participant's net is `paid - owed`: negative means they owe the gap, positive means they're owed it back.
 * Debtors are matched against creditors in the order both lists are given (oldest-declared-payer first),
 * the same greedy, oldest-first allocation `allocateCrossing` uses — it fully resolves with no leftover on
 * either side whenever the two totals match, which the caller is expected to have validated beforehand.
 */
export function settleExpenseContributions(
  owed: { memberId: string; amount: number }[],
  payers: { memberId: string; amount: number }[],
): ExpenseSettlementEdge[] {
  const nets = new Map<string, number>();
  const order: string[] = [];
  const touch = (id: string) => { if (!nets.has(id)) { nets.set(id, 0); order.push(id); } };

  for (const s of owed) { touch(s.memberId); nets.set(s.memberId, nets.get(s.memberId)! - s.amount); }
  for (const p of payers) { touch(p.memberId); nets.set(p.memberId, nets.get(p.memberId)! + p.amount); }

  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];
  for (const id of order) {
    const n = nets.get(id)!;
    if (n < 0) debtors.push({ id, amount: -n });
    else if (n > 0) creditors.push({ id, amount: n });
  }

  const edges: ExpenseSettlementEdge[] = [];
  let ci = 0;
  for (const d of debtors) {
    let remaining = d.amount;
    while (remaining > 0 && ci < creditors.length) {
      const c = creditors[ci];
      const take = Math.min(remaining, c.amount);
      if (take > 0) edges.push({ debtor: d.id, creditor: c.id, amount: take });
      remaining -= take;
      c.amount -= take;
      if (c.amount <= 0) ci++;
    }
  }
  return edges;
}

/**
 * Which of an expense's settlement edges can become real debts right now. An edge needs *both* of its parties
 * confirmed: a creditor nobody has vouched for is owed nothing, and a debtor whose own declared payment is still
 * pending has a net nobody has verified. Someone with no contribution on the expense (a plain participant) counts
 * as confirmed. Edges whose party declined never materialize — the expense is then incomplete (`isExpenseIncomplete`).
 * Returns the edges to write as debts plus the contributions with those edges flagged `created`.
 */
export function materializeReadyEdges(contributions: ExpenseContribution[]): {
  toCreate: ExpenseSettlementEdge[];
  updated: ExpenseContribution[];
} {
  const statusOf = (id: string) => contributions.find((c) => c.memberId === id)?.status ?? 'confirmed';
  const toCreate: ExpenseSettlementEdge[] = [];
  const updated = contributions.map((c) => ({
    ...c,
    edges: c.edges.map((e) => {
      const creditor = e.creditor ?? c.memberId;
      const already = e.created ?? c.status === 'confirmed';
      if (already) return e.created === true ? e : { ...e, created: true };
      if (statusOf(e.debtor) !== 'confirmed' || statusOf(creditor) !== 'confirmed') return e;
      toCreate.push({ debtor: e.debtor, creditor, amount: e.amount });
      return { ...e, created: true };
    }),
  }));
  return { toCreate, updated };
}

/** A declared contribution was rejected: part of the expense's settlement can never be created until it is fixed. */
export const isExpenseIncomplete = (contributions: { status: string }[] | undefined) =>
  (contributions ?? []).some((c) => c.status === 'declined');
