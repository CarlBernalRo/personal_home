import { isPendingDebt, remainingOf } from './householdSettlement';

/**
 * Who is owed. A household can have any number of people, so a debt must say whom it is owed to:
 * - debts born from a shared expense are owed to whoever paid it (`creditor`),
 * - loans are owed to the lender,
 * - an abono is paid to the creditor of the debt it settles (or to the one chosen when it is general).
 * Old records have no creditor: in a household of two it can only be the other person.
 */
interface WithCreditor {
  debtor: string;
  creditor?: string | null;
  lender?: string | null;
}

export function creditorOf(d: WithCreditor, members: string[]): string | null {
  if (d.creditor) return d.creditor;
  if (d.lender) return d.lender;
  const others = members.filter((m) => m !== d.debtor);
  return others.length === 1 ? others[0] : null;
}

type PendingRec = WithCreditor & { tipo: string; cruzado?: boolean; amount: number; crossedAmount?: number; paidAbono?: number };

/** The debts `debtor` still owes to `creditor`. */
export function pendingOwedTo<T extends PendingRec>(debts: T[], debtor: string, creditor: string, members: string[]): T[] {
  return debts.filter((d) => d.debtor === debtor && isPendingDebt(d) && creditorOf(d, members) === creditor);
}

export interface CreditorLine { creditor: string | null; owed: number }

/** What `debtor` owes, one line per person it is owed to (largest first). Pending debts only. */
export function owedByCreditor<T extends PendingRec>(debts: T[], debtor: string, members: string[]): CreditorLine[] {
  const by = new Map<string | null, number>();
  for (const d of debts) {
    if (d.debtor !== debtor || !isPendingDebt(d)) continue;
    const c = creditorOf(d, members);
    by.set(c, (by.get(c) ?? 0) + remainingOf(d));
  }
  return [...by.entries()].map(([creditor, owed]) => ({ creditor, owed })).sort((a, b) => b.owed - a.owed);
}

/** The household's members except one. */
export const othersOf = (members: string[], uid: string | undefined) => members.filter((m) => m !== uid);
