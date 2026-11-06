import { describe, it, expect } from 'vitest';
import { remainingOf, isPendingDebt, allocateCrossing, allocateAbono, inPaymentOrder } from './householdSettlement';

describe('remainingOf', () => {
  it('equals the full amount when no crossedAmount/paidAbono fields exist', () => {
    expect(remainingOf({ amount: 100000 })).toBe(100000);
  });

  it('subtracts crossedAmount only', () => {
    expect(remainingOf({ amount: 100000, crossedAmount: 40000 })).toBe(60000);
  });

  it('subtracts paidAbono only', () => {
    expect(remainingOf({ amount: 100000, paidAbono: 25000 })).toBe(75000);
  });

  it('subtracts both crossedAmount and paidAbono', () => {
    expect(remainingOf({ amount: 100000, crossedAmount: 40000, paidAbono: 25000 })).toBe(35000);
  });

  it('handles partial abono correctly (user scenario: owes 483000, pays 200000, remaining 283000)', () => {
    const debt = { amount: 483000, paidAbono: 200000 };
    expect(remainingOf(debt)).toBe(283000);
    expect(isPendingDebt({ tipo: 'Deuda', ...debt })).toBe(true);
  });
});

describe('isPendingDebt', () => {
  it('is true for a Deuda with no crossing/abono', () => {
    expect(isPendingDebt({ tipo: 'Deuda', amount: 100000 })).toBe(true);
  });

  it('is false when cruzado is true, even if remainingOf would be > 0', () => {
    expect(isPendingDebt({ tipo: 'Deuda', amount: 100000, cruzado: true })).toBe(false);
  });

  it('is false for a Deuda fully paid via paidAbono, cruzado false', () => {
    expect(isPendingDebt({ tipo: 'Deuda', amount: 100000, paidAbono: 100000, cruzado: false })).toBe(
      false,
    );
  });

  it('is true for a Deuda partially paid via paidAbono (remaining still > 0)', () => {
    expect(isPendingDebt({ tipo: 'Deuda', amount: 100000, paidAbono: 60000, cruzado: false })).toBe(
      true,
    );
  });

  it('is false for an Abono row regardless of amounts', () => {
    expect(isPendingDebt({ tipo: 'Abono', amount: 100000 })).toBe(false);
    expect(isPendingDebt({ tipo: 'Abono', amount: 0, cruzado: false })).toBe(false);
  });
});

describe('allocateCrossing and allocateAbono', () => {
  it('allocates once, for a partial amount, when amount < first debt remaining', () => {
    const debts = [{ id: 'd1', amount: 200000 }];
    expect(allocateCrossing(50000, debts)).toEqual([{ debtId: 'd1', amount: 50000 }]);
  });

  it('allocates the full remaining when amount == first debt remaining', () => {
    const debts = [{ id: 'd1', amount: 200000 }];
    expect(allocateCrossing(200000, debts)).toEqual([{ debtId: 'd1', amount: 200000 }]);
  });

  it('spans two debts: first fully allocated, remainder spills to the second', () => {
    const debts = [
      { id: 'older', amount: 150000 },
      { id: 'newer', amount: 100000 },
    ];
    expect(allocateCrossing(200000, debts)).toEqual([
      { debtId: 'older', amount: 150000 },
      { debtId: 'newer', amount: 50000 },
    ]);
  });

  it('does not over-allocate when amount exceeds the sum of all debts remaining', () => {
    const debts = [
      { id: 'd1', amount: 300000 },
      { id: 'd2', amount: 300000 },
    ];
    const result = allocateCrossing(1000000, debts);
    const total = result.reduce((s, a) => s + a.amount, 0);
    expect(total).toBe(600000);
    expect(result).toEqual([
      { debtId: 'd1', amount: 300000 },
      { debtId: 'd2', amount: 300000 },
    ]);
  });

  it('returns an empty array for an empty debts list', () => {
    expect(allocateCrossing(100000, [])).toEqual([]);
  });

  it('returns an empty array for a zero crossing amount', () => {
    const debts = [{ id: 'd1', amount: 200000 }];
    expect(allocateCrossing(0, debts)).toEqual([]);
  });

  it('skips an already-settled debt sitting between two unsettled debts', () => {
    const debts = [
      { id: 'd1', amount: 100000 }, // unsettled, remaining 100000
      { id: 'd2', amount: 50000, paidAbono: 50000 }, // fully settled, remaining 0
      { id: 'd3', amount: 80000 }, // unsettled, remaining 80000
    ];
    const result = allocateCrossing(150000, debts);
    expect(result).toEqual([
      { debtId: 'd1', amount: 100000 },
      { debtId: 'd3', amount: 50000 },
    ]);
    // d2 never appears in the output
    expect(result.find((a) => a.debtId === 'd2')).toBeUndefined();
  });

  it('allocateAbono allocates 200000 to a 483000 debt leaving 283000', () => {
    const debts = [{ id: 'mercadito', amount: 483000 }];
    const allocation = allocateAbono(200000, debts);
    expect(allocation).toEqual([{ debtId: 'mercadito', amount: 200000 }]);
  });

  it('never grows the remaining amount when an earlier debt is already over-crossed', () => {
    const debts = [
      { id: 'over', amount: 100000, crossedAmount: 150000 }, // remainingOf = -50000
      { id: 'next', amount: 80000 },
    ];
    const result = allocateCrossing(80000, debts);
    expect(result).toEqual([{ debtId: 'next', amount: 80000 }]);
    const total = result.reduce((s, a) => s + a.amount, 0);
    expect(total).toBeLessThanOrEqual(80000);
  });
});

describe('inPaymentOrder (what an abono pays first)', () => {
  const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
  const loan = (n: number, due: Date | null) => ({ id: `c${n}`, amount: 333_333, tipo: 'Deuda', date: d(2026, 11, 1), dueDate: due, crossedAmount: 0 });

  it('pays the installments of a loan in their order, even if they arrive newest first', () => {
    const cuotas = [loan(3, d(2027, 2, 1)), loan(1, d(2026, 12, 1)), loan(2, d(2027, 1, 1))];
    const allocation = allocateAbono(500_000, inPaymentOrder(cuotas) as any);
    expect(allocation).toEqual([{ debtId: 'c1', amount: 333_333 }, { debtId: 'c2', amount: 166_667 }]);
  });

  it('puts the debts with an agreed date before the ones without, then the oldest first', () => {
    const open1 = { id: 'o1', date: d(2026, 10, 1), dueDate: null };
    const open2 = { id: 'o2', date: d(2026, 9, 1), dueDate: null };
    const dated = { id: 'dated', date: d(2026, 11, 20), dueDate: d(2026, 12, 5) };
    expect(inPaymentOrder([open1, dated, open2]).map((x) => x.id)).toEqual(['dated', 'o2', 'o1']);
  });
});
