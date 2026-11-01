import type { PaySchedule } from '../types/paySchedule';
import { isAutoDebit, monthEntries, monthKey, monthRange } from './fixedExpenses';
import { nextPayDate, type PayDate } from './paySchedule';

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** One amount still to leave the account before the next salary. */
export interface Outflow {
  /** `${expenseId}|${occurrenceMonth}`, unique per owed occurrence. */
  id: string;
  concept: string;
  /** Day it leaves the account: its due date, or today when it is already overdue. */
  date: Date;
  amount: number;
  /** The bank debits it by itself (no action needed, but the money has to be there). */
  auto: boolean;
  overdue: boolean;
}

export interface PayProjection {
  nextPay: PayDate;
  outflows: Outflow[];
  /** Everything still to pay before the next salary. */
  pendingTotal: number;
  autoTotal: number;
  manualTotal: number;
  /** Held back for occasional expenses (gasoline, card, household debts). */
  reserved: number;
  /** What the account would hold the day the next salary arrives. */
  endBalance: number;
  /** First day the account would run short because of fixed payments; null if it never does. */
  shortfallOn: Date | null;
}

/**
 * Where the account stands when the next salary arrives: the money on hand minus every fixed
 * payment still owed before then (overdue ones count today) and what is reserved for occasional
 * expenses. Null when there is no pay date ahead.
 */
export function projectToNextPay<E extends Parameters<typeof monthEntries>[0][number]>(
  cash: number,
  schedule: PaySchedule,
  expenses: E[],
  payments: Map<string, { paidAmount: number }>,
  today: Date,
  reserved = 0,
): PayProjection | null {
  const nextPay = nextPayDate(schedule, today);
  if (!nextPay) return null;

  const day = startOfDay(today);
  const end = nextPay.date.getTime();
  const months = monthRange(monthKey(today), monthKey(new Date(end - DAY_MS)));

  const seen = new Set<string>();
  const outflows: Outflow[] = [];
  for (const m of months) {
    for (const e of monthEntries(expenses, m, payments, today)) {
      if (!e.due) continue;
      for (const line of e.owed) {
        const id = `${e.fe.id}|${line.occMonth}`;
        if (seen.has(id)) continue;
        const isArrear = e.arrears.some((a) => a.occMonth === line.occMonth);
        const late = isArrear || e.due.getTime() < day.getTime();
        const date = late ? day : e.due;
        if (date.getTime() >= end) continue;
        seen.add(id);
        outflows.push({
          id,
          concept: (e.fe as any).concept ?? '',
          date,
          amount: line.amount,
          auto: !late && isAutoDebit(e.fe, line.occMonth),
          overdue: late,
        });
      }
    }
  }
  outflows.sort((a, b) => a.date.getTime() - b.date.getTime() || b.amount - a.amount);

  const sum = (list: Outflow[]) => list.reduce((t, o) => t + o.amount, 0);
  let running = cash;
  let shortfallOn: Date | null = null;
  for (const o of outflows) {
    running -= o.amount;
    if (running < 0 && !shortfallOn) shortfallOn = o.date;
  }
  const pendingTotal = sum(outflows);

  return {
    nextPay,
    outflows,
    pendingTotal,
    autoTotal: sum(outflows.filter((o) => o.auto)),
    manualTotal: sum(outflows.filter((o) => !o.auto)),
    reserved,
    endBalance: cash - pendingTotal - reserved,
    shortfallOn,
  };
}
