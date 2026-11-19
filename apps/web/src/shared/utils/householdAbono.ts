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
    const remaining = Math.max(0, remainingOf(target));
    const applied = Math.min(i.amount, remaining);
    const rows: AbonoRowPlan[] = [{ concept: i.concept?.trim() || `Abono: ${target.concept}`, amount: applied, creditor, category: target.category || i.category, saldaId: target.id }];
    const paidLines: { concept: string; amount: number }[] = [{ concept: target.concept, amount: applied }];
    const leftover = i.amount - applied;
    if (leftover > 0) {
      const concept = i.concept || 'Abono al hogar';
      paidLines.push({ concept, amount: leftover });
      rows.push({ concept, amount: leftover, creditor, category: i.category, saldaId: null });
    }
    return {
      rows,
      paidLines,
      paidTo: creditor,
      kind: 'target',
      allocations: 1,
      remainingAfter: remaining - applied,
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

/**
 * A person who paid more than they owed has a balance in their favor in the household: the abonos tied to no debt.
 * This puts it to work on the debts that person still has open, whoever they are owed to, as if it had been abonado
 * to them: each such debt gets `creditApplied` (and `paidAbono` grows by the same amount), so what is "still owed"
 * already counts it. The debts owed to the person the credit was paid to come first, then the rest, each in payment
 * order. It only changes the copy shown on screen; the stored records stay as they are.
 */
export function applyCreditToDebts<T extends { id: string; tipo: string; debtor: string; creditor?: string | null; lender?: string | null; amount: number; crossedAmount?: number; paidAbono?: number; cruzado?: boolean; saldaId?: string | null; dueDate?: unknown; date?: unknown; createdAt?: unknown }>(debts: T[], members: string[]): (T & { creditApplied?: number })[] {
  // credit per debtor, remembering whom it was paid to (those debts get it first)
  const credit = new Map<string, Map<string, number>>();
  for (const a of debts) {
    if (a.tipo !== 'Abono' || a.saldaId) continue;
    const byCreditor = credit.get(a.debtor) ?? new Map<string, number>();
    byCreditor.set(a.creditor ?? '', (byCreditor.get(a.creditor ?? '') ?? 0) + a.amount);
    credit.set(a.debtor, byCreditor);
  }
  if (credit.size === 0) return debts;
  const applied = new Map<string, number>();
  for (const [debtor, byCreditor] of credit) {
    const open = () => inPaymentOrder(debts.filter((d) => d.tipo === 'Deuda' && d.debtor === debtor && isPendingDebt(d) && remainingOf(d) - (applied.get(d.id) ?? 0) > 0));
    for (const [creditorKey, total] of byCreditor) {
      let left = total;
      const sameCreditor = (d: T) => (creditorOf(d, members) ?? '') === creditorKey;
      const ordered = [...open().filter(sameCreditor), ...open().filter((d) => !sameCreditor(d))];
      for (const d of ordered) {
        if (left <= 0) break;
        const use = Math.min(left, remainingOf(d) - (applied.get(d.id) ?? 0));
        if (use > 0) { applied.set(d.id, (applied.get(d.id) ?? 0) + use); left -= use; }
      }
    }
  }
  return debts.map((d) => {
    const use = applied.get(d.id);
    return use ? { ...d, paidAbono: (d.paidAbono || 0) + use, creditApplied: use } : d;
  });
}

/**
 * The household's stored rows as the screen (and the Telegram bot) read them: each debt carries what its abonos paid
 * (`paidAbono`, from the abonos tied to it through `saldaId`) and then the balances in favor are put to work on top
 * (`applyCreditToDebts`). One function so every reader says the same.
 */
export function householdDebtsWithCredit<T extends { id: string; tipo: string; debtor: string; creditor?: string | null; lender?: string | null; amount: number; crossedAmount?: number; paidAbono?: number; cruzado?: boolean; saldaId?: string | null; dueDate?: unknown; date?: unknown; createdAt?: unknown }>(raw: T[], members: string[]): (T & { creditApplied?: number })[] {
  const paid = new Map<string, number>();
  for (const x of raw) if (x.tipo === 'Abono' && x.saldaId) paid.set(x.saldaId, (paid.get(x.saldaId) || 0) + x.amount);
  const withPaid = raw.map((d) => (d.tipo === 'Deuda' ? { ...d, paidAbono: paid.get(d.id) || 0, creditApplied: 0 } : d));
  return applyCreditToDebts(withPaid, members);
}
