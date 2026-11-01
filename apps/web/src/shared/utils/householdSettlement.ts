export interface CrossingAllocation { debtId: string; amount: number }

interface SettleableDebt {
  amount: number;
  crossedAmount?: number;
  paidAbono?: number;
}

/**
 * What's actually left to settle on a debt — after crossings AND any abono
 * linked to it via saldaId. The single source of truth for "is this still owed".
 */
export function remainingOf(d: SettleableDebt): number {
  return d.amount - (d.crossedAmount || 0) - (d.paidAbono || 0);
}

/**
 * Whether a 'Deuda' row should still count as outstanding — not yet fully
 * crossed, and not fully covered by a linked (saldaId) abono either. Used to
 * decide what shows in "Pendiente" and what's eligible to be crossed/saldar'd.
 */
export function isPendingDebt(d: { tipo: string; cruzado?: boolean } & SettleableDebt): boolean {
  return d.tipo === 'Deuda' && !d.cruzado && remainingOf(d) > 0;
}

/**
 * Fills each debt's remaining balance in order until the amount runs out —
 * oldest-first by convention of the `debts` order passed in, so a partial
 * cross always settles what's owed longest first.
 */
export function allocateCrossing(
  amount: number,
  debts: (SettleableDebt & { id: string })[],
): CrossingAllocation[] {
  let left = amount;
  const out: CrossingAllocation[] = [];
  for (const d of debts) {
    if (left <= 0) break;
    const take = Math.min(remainingOf(d), left);
    if (take > 0) out.push({ debtId: d.id, amount: take });
    left -= take;
  }
  return out;
}

/**
 * Convenience alias for allocateCrossing — allocates an abono (payment)
 * across pending debts oldest-first.
 */
export const allocateAbono = allocateCrossing;
