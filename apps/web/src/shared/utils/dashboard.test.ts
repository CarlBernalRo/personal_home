import { describe, it, expect } from 'vitest';
import { balanceTimeline, categoryTotals, cumulativeByDay, fixedSummary, periodHistory } from './dashboard';
import { monthEntries } from './fixedExpenses';
import { projectToNextPay } from './projection';
import { buildSalaryPeriods, salaryLedgers } from './paySchedule';
import type { PaySchedule } from '../types/paySchedule';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const schedule: PaySchedule = { rules: [{ kind: 'last-business-day', amount: 5_000_000 }], weekendAdjust: 'before' };

const fe = (id: string, concept: string, paymentDay: number, estimatedAmount: number) => ({
  id, concept, paymentDay, estimatedAmount, frequency: 'fijo' as const, startMonth: '2026-11',
});

describe('balanceTimeline', () => {
  it('lowers the balance on each payment day up to the day before the next salary', () => {
    const today = d(2026, 11, 10);
    const p = projectToNextPay(2_000_000, schedule, [fe('a', 'Arriendo', 15, 1_000_000)], new Map(), today)!;
    const line = balanceTimeline(2_000_000, p, today);
    expect(line[0]).toMatchObject({ balance: 2_000_000 });
    expect(line.find((x) => x.date.getDate() === 15)!.balance).toBe(1_000_000);
    expect(line[line.length - 1].date).toEqual(d(2026, 11, 29));
  });
});

describe('fixedSummary', () => {
  it('splits the month by state and adds up the amounts', () => {
    const today = d(2026, 11, 10);
    const expenses = [fe('a', 'Pagado', 3, 100), fe('b', 'Vencido', 5, 200), fe('c', 'Luego', 25, 300)];
    const payments = new Map([['a|2026-11', { paidAmount: 100 }]]);
    const s = fixedSummary(monthEntries(expenses, '2026-11', payments, today));
    expect(s).toMatchObject({ count: 3, paid: 1, overdue: 1, coming: 1, paidAmount: 100, overdueAmount: 200, owedAmount: 500 });
  });
});

describe('periodHistory', () => {
  it('summarises each period and marks the running one', () => {
    const salaries = [{ id: 'a', date: d(2026, 9, 30), amount: 5_000_000 }, { id: 'b', date: d(2026, 10, 30), amount: 5_000_000 }];
    const periods = buildSalaryPeriods(salaries, schedule);
    const ledgers = salaryLedgers(periods, [fe('x', 'Luz', 5, 90_000)], new Map(), d(2026, 11, 2));
    const h = periodHistory(periods, ledgers, d(2026, 11, 2));
    expect(h).toHaveLength(2);
    expect(h[1].current).toBe(true);
    expect(h[0].current).toBe(false);
    expect(h[1].income).toBe(5_000_000);
  });
});

describe('categoryTotals / cumulativeByDay', () => {
  it('orders categories and computes shares', () => {
    const t = categoryTotals([{ category: 'a', amount: 30 }, { category: 'b', amount: 70 }, { amount: 0 }]);
    expect(t.map((x) => x.category)).toEqual(['b', 'a', 'otro']);
    expect(t[0].pct).toBe(70);
  });

  it('accumulates spends day by day up to a given day', () => {
    const rows = [{ date: d(2026, 11, 1), amount: 10 }, { date: d(2026, 11, 3), amount: 5 }];
    const c = cumulativeByDay(rows, d(2026, 11, 1), d(2026, 12, 1), d(2026, 11, 3));
    expect(c.map((x) => x.total)).toEqual([10, 10, 15]);
  });
});
