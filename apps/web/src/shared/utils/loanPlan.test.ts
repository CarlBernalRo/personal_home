import { describe, it, expect } from 'vitest';
import { buildLoanPlan, installmentDate } from './loanPlan';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe('loan plan', () => {
  it('without an agreed date it is one open debt', () => {
    const plan = buildLoanPlan({ amount: 500_000, kind: 'none' });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ number: 1, of: 1, amount: 500_000, dueDate: null });
  });

  it('a single payment keeps its date', () => {
    const plan = buildLoanPlan({ amount: 500_000, kind: 'single', firstDate: d(2026, 12, 15) });
    expect(plan).toHaveLength(1);
    expect(plan[0].dueDate?.getTime()).toBe(d(2026, 12, 15).getTime());
  });

  it('installments are equal, dated one frequency apart, and always add up to the loan', () => {
    const plan = buildLoanPlan({ amount: 1_000_000, kind: 'installments', count: 3, firstDate: d(2026, 12, 1), frequency: 'monthly' });
    expect(plan.map((p) => p.amount)).toEqual([333_333, 333_333, 333_334]); // the last absorbs the rounding
    expect(plan.reduce((s, p) => s + p.amount, 0)).toBe(1_000_000);
    expect(plan.map((p) => [p.number, p.of])).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(plan.map((p) => p.dueDate?.getMonth())).toEqual([11, 0, 1]); // Dec, Jan, Feb
  });

  it('a monthly installment on the 31st lands on the last day of shorter months', () => {
    expect(installmentDate(d(2026, 1, 31), 1, 'monthly').getDate()).toBe(28); // 28 Feb 2026
    expect(installmentDate(d(2026, 1, 31), 2, 'monthly').getDate()).toBe(31); // 31 Mar
  });

  it('biweekly and weekly steps', () => {
    expect(installmentDate(d(2026, 11, 1), 1, 'biweekly').getTime()).toBe(d(2026, 11, 15).getTime());
    expect(installmentDate(d(2026, 11, 1), 2, 'weekly').getTime()).toBe(d(2026, 11, 15).getTime());
  });

  it('needs at least two installments and a positive amount', () => {
    expect(buildLoanPlan({ amount: 100, kind: 'installments', count: 1, firstDate: d(2026, 12, 1) })).toHaveLength(2);
    expect(buildLoanPlan({ amount: 0, kind: 'single' })).toEqual([]);
  });
});
