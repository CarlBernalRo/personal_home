import { allocateAbono, inPaymentOrder, isPendingDebt, remainingOf } from './householdSettlement';
import { creditorOf, owedByCreditor } from './householdCreditors';

export interface AbonoInput {
  /** The household's debts and abonos, each debt carrying its `paidAbono` (what the abonos linked to it add up to). */
  debts: any[];
  members: string[];
  /** Who pays. */
  debtor: string;
  /** Who is paid. Left empty it is the only person this debtor owes, when there is exactly one. */
  creditor?: string | null;
  /** The debt this payment is meant for; empty = spread it over the debts owed to the creditor, oldest first. */
  targetDebtId?: string | null;
  amount: number;
  /** What the person wrote (optional). */
  concept?: string;
  category: string;
}

/** One abono row to write. */
export interface AbonoRowPlan {
  concept: string;
  amount: number;
  creditor: string | null;
  category: string;
  /** The debt this row pays down (null: it does not belong to one). */
  saldaId: string | null;
}

export interface AbonoPlan {
  rows: AbonoRowPlan[];
  /** What the payment went to, so the person who receives it can see and confirm it. */
  paidLines: { concept: string; amount: number }[];
  paidTo: string | null;
  /** 'target': one chosen debt · 'allocated': spread over several · 'general': belongs to no debt. */
  kind: 'target' | 'allocated' | 'general';
  /** Debts the payment was spread over ('allocated'). */
  allocations: number;
  /** What is still owed on the chosen debt after this abono ('target'). */
  remainingAfter?: number;
  targetConcept?: string;
}

/**
 * How an abono is recorded in a household. A single payment can end up as several rows (one per debt it settles, plus a
 * general one for what is left over); they all share one `paymentId` when written. The household screen and the
 * confirmation of an abono prepared in Telegram both use this, so they always do the same.
 */
export function planAbono(i: AbonoInput): AbonoPlan {
  const target = i.targetDebtId ? i.debts.find((d) => d.id === i.targetDebtId) : null;

  if (target) {
    const creditor = creditorOf(target, i.members) ?? null;
    return {
      rows: [{ concept: i.concept?.trim() || `Abono: ${target.concept}`, amount: i.amount, creditor, category: target.category || i.category, saldaId: target.id }],
      paidLines: [{ concept: target.concept, amount: i.amount }],
      paidTo: creditor,
      kind: 'target',
      allocations: 1,
      remainingAfter: Math.max(0, remainingOf(target) - i.amount),
      targetConcept: target.concept,
    };
  }

  // only what is owed to the person being paid (a household can have several creditors)
  const lines = owedByCreditor(i.debts, i.debtor, i.members);
  const creditor = i.creditor || (lines.length === 1 ? lines[0].creditor : null) || null;
  const pending = inPaymentOrder(i.debts.filter((d) => d.debtor === i.debtor && isPendingDebt(d) && (!creditor || creditorOf(d, i.members) === creditor)));
  const allocations = allocateAbono(i.amount, pending);

  if (allocations.length === 0) {
    const concept = i.concept || 'Abono al hogar';
    return {
      rows: [{ concept, amount: i.amount, creditor, category: i.category, saldaId: null }],
      paidLines: [{ concept, amount: i.amount }],
      paidTo: creditor,
      kind: 'general',
      allocations: 0,
    };
  }

  const rows: AbonoRowPlan[] = [];
  const paidLines: { concept: string; amount: number }[] = [];
  for (const alloc of allocations) {
    const d = pending.find((x) => x.id === alloc.debtId);
    paidLines.push({ concept: d?.concept ?? i.concept ?? 'Abono', amount: alloc.amount });
    rows.push({ concept: `Abono: ${d?.concept ?? i.concept}`, amount: alloc.amount, creditor, category: d?.category ?? i.category, saldaId: alloc.debtId });
  }
  const spread = allocations.reduce((s, a) => s + a.amount, 0);
  if (i.amount > spread) {
    const concept = i.concept || 'Abono al hogar';
    paidLines.push({ concept, amount: i.amount - spread });
    rows.push({ concept, amount: i.amount - spread, creditor, category: i.category, saldaId: null });
  }
  return { rows, paidLines, paidTo: creditor, kind: 'allocated', allocations: allocations.length };
}
