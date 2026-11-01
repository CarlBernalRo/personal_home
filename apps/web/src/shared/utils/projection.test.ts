import { describe, it, expect } from 'vitest';
import { projectToNextPay } from './projection';
import type { PaySchedule } from '../types/paySchedule';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const schedule: PaySchedule = { rules: [{ kind: 'last-business-day', amount: 5_000_000 }], weekendAdjust: 'before' };

const fe = (id: string, concept: string, paymentDay: number, estimatedAmount: number, extra: object = {}) => ({
  id, concept, paymentDay, estimatedAmount, frequency: 'fijo' as const, startMonth: '2026-11', ...extra,
});

describe('projectToNextPay', () => {
  const today = d(2026, 11, 10);

  it('adds up what is still owed before the next salary and splits auto from manual', () => {
    const expenses = [
      fe('a', 'Arriendo', 15, 1_000_000),
      fe('b', 'Netflix', 20, 40_000, { autoDebit: [{ from: '2026-11' }] }),
      fe('c', 'Luz', 5, 90_000), // unpaid and past due: counts today
      fe('d', 'Internet', 3, 80_000), // paid
      fe('e', 'Seguro', 30, 200_000), // due on the pay day itself: belongs to the next period
    ];
    const payments = new Map([['d|2026-11', { paidAmount: 80_000 }]]);
    const p = projectToNextPay(2_000_000, schedule, expenses, payments, today, 300_000)!;
    expect(p.nextPay.date).toEqual(d(2026, 11, 30));
    expect(p.outflows.map((o) => o.concept)).toEqual(['Luz', 'Arriendo', 'Netflix']);
    expect(p.outflows[0]).toMatchObject({ overdue: true, auto: false });
    expect(p.autoTotal).toBe(40_000);
    expect(p.manualTotal).toBe(1_090_000);
    expect(p.endBalance).toBe(2_000_000 - 1_130_000 - 300_000);
    expect(p.shortfallOn).toBeNull();
  });

  it('reports the first day the account runs short', () => {
    const expenses = [fe('a', 'Arriendo', 15, 1_000_000), fe('b', 'Colegio', 25, 900_000)];
    const p = projectToNextPay(1_500_000, schedule, expenses, new Map(), today)!;
    expect(p.shortfallOn).toEqual(d(2026, 11, 25));
    expect(p.endBalance).toBe(-400_000);
  });

  it('does not count paused expenses', () => {
    const expenses = [fe('a', 'Arriendo', 15, 1_000_000, { pauses: [{ from: '2026-11' }] })];
    const p = projectToNextPay(500_000, schedule, expenses, new Map(), today)!;
    expect(p.outflows).toHaveLength(0);
  });
});
