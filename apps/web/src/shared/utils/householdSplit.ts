import type { ExpenseShare, ExpenseShareInput, SplitMode } from '../types/householdExpense';

export class SplitValidationError extends Error {}

/**
 * Resolves how much each participant owes for a shared expense.
 * Invariant: the returned shares always sum to exactly `amount`
 * (rounding leftovers from 'equal'/'percentage' are handed to the payer).
 */
export function resolveExpenseShares(
  amount: number,
  paidBy: string,
  splitMode: SplitMode,
  shareInputs: ExpenseShareInput[],
): ExpenseShare[] {
  if (amount <= 0) throw new SplitValidationError('El monto debe ser mayor a 0');
  if (shareInputs.length === 0) throw new SplitValidationError('Debe haber al menos un participante');

  const memberIds = shareInputs.map((s) => s.memberId);
  if (new Set(memberIds).size !== memberIds.length) {
    throw new SplitValidationError('Cada persona solo puede aparecer una vez en la división');
  }
  if (!memberIds.includes(paidBy)) {
    throw new SplitValidationError('Quien pagó debe ser uno de los participantes de la división');
  }

  let rawShares: number[];

  if (splitMode === 'equal') {
    const base = Math.floor(amount / shareInputs.length);
    rawShares = shareInputs.map(() => base);
  } else if (splitMode === 'percentage') {
    const totalPct = shareInputs.reduce((s, i) => s + (i.percentage ?? 0), 0);
    if (Math.abs(totalPct - 100) > 0.01) {
      throw new SplitValidationError(`Los porcentajes deben sumar 100% (suman ${totalPct}%)`);
    }
    rawShares = shareInputs.map((i) => Math.floor((amount * (i.percentage ?? 0)) / 100));
  } else {
    rawShares = shareInputs.map((i) => Math.round(i.fixedAmount ?? 0));
    const totalFixed = rawShares.reduce((s, v) => s + v, 0);
    if (totalFixed !== amount) {
      throw new SplitValidationError(
        `Los montos fijos deben sumar el total del gasto (suman ${totalFixed}, se esperaban ${amount})`,
      );
    }
  }

  // Equal/percentage can leave a few pesos unassigned (or, for percentage,
  // slightly over-assigned when the percentages round to just over 100%) due
  // to flooring — hand them out one peso at a time starting with the payer,
  // cycling through everyone as many times as it takes so no amount of slack
  // (in either direction) is ever left untracked.
  let remainder = amount - rawShares.reduce((s, v) => s + v, 0);
  if (remainder !== 0) {
    const step = remainder > 0 ? 1 : -1;
    const payerIdx = shareInputs.findIndex((s) => s.memberId === paidBy);
    const order = [payerIdx, ...shareInputs.map((_, i) => i).filter((i) => i !== payerIdx)];
    let i = 0;
    while (remainder !== 0) {
      rawShares[order[i % order.length]] += step;
      remainder -= step;
      i++;
    }
  }

  return shareInputs.map((input, idx) => ({
    memberId: input.memberId,
    amount: rawShares[idx],
    isPayer: input.memberId === paidBy,
  }));
}

/** The shares that must become debts: everyone but the payer, excluding zero-amount shares. */
export function sharesToDebtors(shares: ExpenseShare[]): ExpenseShare[] {
  return shares.filter((s) => !s.isPayer && s.amount > 0);
}
