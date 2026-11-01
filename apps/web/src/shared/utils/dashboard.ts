import { monthEntries, type MonthEntry } from './fixedExpenses';
import type { PeriodLedger, SalaryPeriod } from './paySchedule';
import type { PayProjection } from './projection';

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ── Salary periods over time ─────────────────────────────────────────────────

export interface PeriodSummary {
  id: string;
  start: Date;
  /** Exclusive, like SalaryPeriod.end. */
  end: Date;
  /** Salary plus extra incomes received in the period (what it brought in, without the carry-over). */
  income: number;
  fixed: number;
  additional: number;
  occasional: number;
  /** What the period left once everything above was taken out (carry-over included). */
  left: number;
  /** It is the period running today. */
  current: boolean;
}

/** The latest `count` periods, oldest first, ready for a trend chart. */
export function periodHistory(
  periods: SalaryPeriod[],
  ledgers: Map<string, PeriodLedger>,
  today: Date,
  count = 6,
): PeriodSummary[] {
  const t = today.getTime();
  return [...periods]
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .flatMap((p) => {
      const l = ledgers.get(p.id);
      if (!l) return [];
      return [{
        id: p.id,
        start: p.start,
        end: p.end,
        income: p.amount + l.extraTotal,
        fixed: l.committed,
        additional: l.additionalSpent,
        occasional: l.variableSpent,
        left: l.remaining,
        current: t >= p.start.getTime() && t < p.end.getTime(),
      }];
    })
    .slice(-count);
}

// ── Where the account is heading ─────────────────────────────────────────────

export interface BalancePoint {
  date: Date;
  /** Money in the account at the end of that day, counting the payments still owed up to then. */
  balance: number;
}

/** Day-by-day balance from today until the day before the next salary (fixed payments only, no reserve). */
export function balanceTimeline(cash: number, projection: PayProjection, today: Date): BalancePoint[] {
  const first = startOfDay(today);
  const last = new Date(projection.nextPay.date.getTime() - DAY_MS);
  const out: BalancePoint[] = [];
  let balance = cash;
  let i = 0;
  const outflows = projection.outflows; // sorted by date
  for (let day = first; day.getTime() <= last.getTime(); day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    while (i < outflows.length && outflows[i].date.getTime() <= day.getTime()) balance -= outflows[i++].amount;
    out.push({ date: day, balance });
  }
  return out;
}

// ── Fixed expenses of a month ────────────────────────────────────────────────

export interface FixedSummary {
  count: number;
  paid: number;
  overdue: number;
  /** Due within the next few days. */
  dueSoon: number;
  /** Still to come (pending or upcoming). */
  coming: number;
  /** Debited by the bank by itself and already settled. */
  auto: number;
  totalAmount: number;
  paidAmount: number;
  /** Still owed: overdue plus coming. */
  owedAmount: number;
  overdueAmount: number;
}

/** Counts and amounts of the month's fixed expenses by state. */
export function fixedSummary(entries: MonthEntry<any>[]): FixedSummary {
  const s: FixedSummary = { count: entries.length, paid: 0, overdue: 0, dueSoon: 0, coming: 0, auto: 0, totalAmount: 0, paidAmount: 0, owedAmount: 0, overdueAmount: 0 };
  for (const e of entries) {
    const settled = e.owed.length === 0;
    const amount = settled ? (e.payment?.paidAmount ?? 0) : e.total;
    s.totalAmount += amount;
    if (settled) {
      s.paid += 1;
      s.paidAmount += amount;
      if (e.payment?.auto) s.auto += 1;
      continue;
    }
    s.owedAmount += amount;
    if (e.arrears.length > 0 || e.status === 'overdue') {
      s.overdue += 1;
      s.overdueAmount += amount;
    } else if (e.status === 'due-soon') {
      s.dueSoon += 1;
    } else {
      s.coming += 1;
    }
  }
  return s;
}

export const monthFixedSummary = (
  expenses: Parameters<typeof monthEntries>[0],
  month: string,
  payments: Parameters<typeof monthEntries>[2],
  today: Date,
) => fixedSummary(monthEntries(expenses, month, payments, today));

// ── Spends by category ───────────────────────────────────────────────────────

export interface CategoryTotal {
  category: string;
  total: number;
  /** Share of the grand total, 0-100. */
  pct: number;
}

/** Totals per category, biggest first; spends without a category fall under "otro". */
export function categoryTotals(rows: { category?: string; amount: number }[]): CategoryTotal[] {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.category || 'otro', (sums.get(r.category || 'otro') ?? 0) + r.amount);
  const grand = [...sums.values()].reduce((a, b) => a + b, 0);
  return [...sums.entries()]
    .map(([category, total]) => ({ category, total, pct: grand > 0 ? Math.round((total / grand) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
}

/** Running total of spends day by day across [start, end), for an accumulated-spend line. */
export function cumulativeByDay(
  rows: { date: Date; amount: number }[],
  start: Date,
  end: Date,
  until: Date,
): { date: Date; total: number }[] {
  const out: { date: Date; total: number }[] = [];
  const stop = Math.min(end.getTime() - DAY_MS, startOfDay(until).getTime());
  let total = 0;
  for (let day = startOfDay(start); day.getTime() <= stop; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    const next = day.getTime() + DAY_MS;
    total += rows.filter((r) => r.date.getTime() >= day.getTime() && r.date.getTime() < next).reduce((s, r) => s + r.amount, 0);
    out.push({ date: day, total });
  }
  return out;
}
