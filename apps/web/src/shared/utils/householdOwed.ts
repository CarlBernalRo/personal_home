import type { DebtLine, VariableBudget, VariableData } from '../types/variableBudget';
import { remainingOf } from './householdSettlement';

const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
const timeOf = (d: Date | string | undefined) => (d ? new Date(d).getTime() : NaN);

/**
 * The household records that exist as of `date` (end of that day included): debts and abonos dated
 * up to it, and crossings created up to it. Feeding these to the usual net-balance calculation gives
 * what was owed on that date, so a debt incurred in November weighs on December 1st but not on
 * November 1st.
 */
export function recordsAsOf<D extends { date: Date | string }, C extends { createdAt?: Date | string }>(
  debts: D[],
  crossings: C[],
  date: Date,
): { debts: D[]; crossings: C[] } {
  const limit = endOfDay(date);
  return {
    debts: debts.filter((d) => timeOf(d.date) <= limit),
    // a crossing without a date can't be placed in time, so it is kept
    crossings: crossings.filter((c) => !(timeOf(c.createdAt) > limit)),
  };
}

/**
 * The user's pending debts of one household, one by one. `netOwed` is the household's net balance
 * (it also reflects abonos and crossings that aren't tied to a single debt), so any credit beyond
 * what the debts' own balances reflect is applied to the oldest debts first.
 */
export function debtLines(
  debts: { id: string; debtor: string; tipo: string; cruzado?: boolean; amount: number; crossedAmount?: number; paidAbono?: number; date: Date | string; concept?: string; dueDate?: Date | string | null }[],
  uid: string,
  householdId: string,
  netOwed: number,
): DebtLine[] {
  const pending = debts
    .filter((d) => d.debtor === uid && d.tipo === 'Deuda' && !d.cruzado && remainingOf(d) > 0)
    .sort((a, b) => timeOf(a.date) - timeOf(b.date));
  let credit = Math.max(0, pending.reduce((s, d) => s + remainingOf(d), 0) - Math.max(0, netOwed));
  const out: DebtLine[] = [];
  for (const d of pending) {
    const rem = remainingOf(d);
    const take = Math.min(rem, credit);
    credit -= take;
    if (rem - take > 0) {
      out.push({
        id: d.id,
        concept: d.concept ?? '',
        householdId,
        date: new Date(d.date),
        dueDate: d.dueDate ? new Date(d.dueDate) : null,
        remaining: rem - take,
      });
    }
  }
  return out;
}

/** The amount an occasional expense stands for on `date`: its typed estimate, or what is owed then. */
export function budgetAmountOn(b: VariableBudget, variable: VariableData | undefined, date: Date): number {
  if (b.source !== 'household-debt') return b.amount;
  // the usual-day amount covers only debts without an agreed date; those with one sit on their own date
  const fn = variable?.householdUndatedOwedAt ?? variable?.householdOwedAt;
  return fn ? fn(date, b.householdIds) : (variable?.householdOwed ?? 0);
}

/** Pending household debts with an agreed date that belong to this household-debt budget. */
export function datedLinesOf(b: VariableBudget, variable: VariableData | undefined): DebtLine[] {
  return (variable?.householdLines ?? []).filter((l) => l.dueDate && followsHousehold(b, l.householdId));
}

/** Does this household-debt budget follow the given household? (none chosen = all of them) */
export const followsHousehold = (b: VariableBudget, householdId: string) => !b.householdIds?.length || b.householdIds.includes(householdId);

/** One line of a household-debt expense: what is owed to one household, and why it lands on this day. */
export interface HouseholdDebtRow {
  householdId: string;
  household: string;
  /** Name of the debt (what it was for). */
  debt: string;
  /** Whether the debt has an agreed date or falls on the expense's usual day. */
  detail: 'fecha acordada' | 'sin fecha acordada';
  amount: number;
}

/** The households a household-debt budget follows (none chosen = all of the user's). */
export function followedHouseholds(b: VariableBudget, variable: VariableData | undefined): string[] {
  return b.householdIds?.length ? b.householdIds : Object.keys(variable?.householdNames ?? {});
}

/**
 * What a household-debt budget shows on each day of a month, one row per debt (with its household
 * and name): debts with an agreed date on that date, and the rest on the budget's usual day.
 */
export function householdDebtDays(
  b: VariableBudget,
  variable: VariableData | undefined,
  year: number,
  month0: number,
): Map<number, HouseholdDebtRow[]> {
  const days = new Map<number, HouseholdDebtRow[]>();
  const names = variable?.householdNames ?? {};
  const nameOf = (id: string) => names[id] ?? 'Hogar';
  const push = (day: number, row: HouseholdDebtRow) => days.set(day, [...(days.get(day) ?? []), row]);
  const mine = (variable?.householdLines ?? []).filter((l) => followsHousehold(b, l.householdId));

  for (const l of mine) {
    if (l.dueDate && l.dueDate.getFullYear() === year && l.dueDate.getMonth() === month0) {
      push(l.dueDate.getDate(), { householdId: l.householdId, household: nameOf(l.householdId), debt: l.concept || 'Deuda', detail: 'fecha acordada', amount: l.remaining });
    }
  }

  if (b.paymentDay) {
    const day = Math.min(b.paymentDay, new Date(year, month0 + 1, 0).getDate());
    const limit = endOfDay(new Date(year, month0, day));
    for (const l of mine) {
      // debts without an agreed date are paid on the usual day, once they exist
      if (!l.dueDate && timeOf(l.date) <= limit) {
        push(day, { householdId: l.householdId, household: nameOf(l.householdId), debt: l.concept || 'Deuda', detail: 'sin fecha acordada', amount: l.remaining });
      }
    }
  }

  for (const rows of days.values()) rows.sort((a, c) => a.household.localeCompare(c.household) || a.debt.localeCompare(c.debt));
  return days;
}
