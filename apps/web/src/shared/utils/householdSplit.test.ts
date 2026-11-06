import { describe, it, expect } from 'vitest';
import { resolveExpenseShares, sharesToDebtors, SplitValidationError } from './householdSplit';
import type { ExpenseShareInput } from '../types/householdExpense';

const carlos = 'carlos-uid';
const alexandra = 'alexandra-uid';
const tercero = 'tercero-uid';

describe('resolveExpenseShares — equal split', () => {
  it('splits evenly between 2 participants when divisible', () => {
    const inputs: ExpenseShareInput[] = [{ memberId: carlos }, { memberId: alexandra }];
    const shares = resolveExpenseShares(800000, carlos, 'equal', inputs);
    expect(shares).toEqual([
      { memberId: carlos, amount: 400000, isPayer: true },
      { memberId: alexandra, amount: 400000, isPayer: false },
    ]);
  });

  it('gives the leftover peso(s) to the payer when not evenly divisible (2 participants)', () => {
    const inputs: ExpenseShareInput[] = [{ memberId: carlos }, { memberId: alexandra }];
    const shares = resolveExpenseShares(100001, carlos, 'equal', inputs);
    const payerShare = shares.find((s) => s.isPayer)!;
    const otherShare = shares.find((s) => !s.isPayer)!;
    expect(otherShare.amount).toBe(50000);
    expect(payerShare.amount).toBe(50001);
    expect(shares.reduce((s, v) => s + v.amount, 0)).toBe(100001);
  });

  it('gives the leftover to the payer with 3 participants not divisible by 3', () => {
    const inputs: ExpenseShareInput[] = [
      { memberId: carlos },
      { memberId: alexandra },
      { memberId: tercero },
    ];
    const shares = resolveExpenseShares(100000, carlos, 'equal', inputs);
    // 100000 / 3 = 33333.33 -> base 33333 each, remainder 1 -> payer
    const payerShare = shares.find((s) => s.isPayer)!;
    const others = shares.filter((s) => !s.isPayer);
    expect(others.every((s) => s.amount === 33333)).toBe(true);
    expect(payerShare.amount).toBe(33334);
    expect(shares.reduce((s, v) => s + v.amount, 0)).toBe(100000);
  });
});

describe('resolveExpenseShares — percentage split', () => {
  it('splits by percentage when summing to exactly 100', () => {
    const inputs: ExpenseShareInput[] = [
      { memberId: carlos, percentage: 60 },
      { memberId: alexandra, percentage: 40 },
    ];
    const shares = resolveExpenseShares(500000, carlos, 'percentage', inputs);
    expect(shares.find((s) => s.memberId === carlos)!.amount).toBe(300000);
    expect(shares.find((s) => s.memberId === alexandra)!.amount).toBe(200000);
  });

  it('throws when percentages do not sum to 100', () => {
    const inputs: ExpenseShareInput[] = [
      { memberId: carlos, percentage: 60 },
      { memberId: alexandra, percentage: 30 },
    ];
    expect(() => resolveExpenseShares(500000, carlos, 'percentage', inputs)).toThrow(
      SplitValidationError,
    );
  });

  it('assigns the rounding remainder to the payer on a three-way percentage split', () => {
    // 33.333333 + 33.333333 + 33.333334 = 100; flooring each on 100000 gives
    // 33333 + 33333 + 33333 = 99999, one peso short — it must go to the payer.
    const inputs: ExpenseShareInput[] = [
      { memberId: carlos, percentage: 33.333333 },
      { memberId: alexandra, percentage: 33.333333 },
      { memberId: tercero, percentage: 33.333334 },
    ];
    const amount = 100000;
    const shares = resolveExpenseShares(amount, carlos, 'percentage', inputs);
    expect(shares.reduce((s, v) => s + v.amount, 0)).toBe(amount);
    expect(shares.find((s) => s.memberId === carlos)!.amount).toBe(33334); // payer: 33333 + remainder(1)
    expect(shares.find((s) => s.memberId === alexandra)!.amount).toBe(33333);
    expect(shares.find((s) => s.memberId === tercero)!.amount).toBe(33333);
  });

  it('takes back the over-rounding when percentages round to just over 100%, however large the gap', () => {
    // 50.001 + 50.001 = 100.002, within the 0.01 tolerance; each floored share
    // on a huge amount overshoots by 20000 total — none of it may be left dangling.
    const inputs: ExpenseShareInput[] = [
      { memberId: carlos, percentage: 50.001 },
      { memberId: alexandra, percentage: 50.001 },
    ];
    const amount = 1_000_000_000;
    const shares = resolveExpenseShares(amount, carlos, 'percentage', inputs);
    expect(shares.reduce((s, v) => s + v.amount, 0)).toBe(amount);
  });
});

describe('resolveExpenseShares — fixed split', () => {
  it('uses exact fixed amounts with no rounding adjustment when they sum to the total', () => {
    const inputs: ExpenseShareInput[] = [
      { memberId: carlos, fixedAmount: 300000 },
      { memberId: alexandra, fixedAmount: 200000 },
    ];
    const shares = resolveExpenseShares(500000, carlos, 'fixed', inputs);
    expect(shares.find((s) => s.memberId === carlos)!.amount).toBe(300000);
    expect(shares.find((s) => s.memberId === alexandra)!.amount).toBe(200000);
  });

  it('throws when fixed amounts do not sum to the total', () => {
    const inputs: ExpenseShareInput[] = [
      { memberId: carlos, fixedAmount: 300000 },
      { memberId: alexandra, fixedAmount: 150000 },
    ];
    expect(() => resolveExpenseShares(500000, carlos, 'fixed', inputs)).toThrow(
      SplitValidationError,
    );
  });
});

describe('resolveExpenseShares — validation', () => {
  it('throws when paidBy is not among the participants', () => {
    const inputs: ExpenseShareInput[] = [{ memberId: carlos }, { memberId: alexandra }];
    expect(() => resolveExpenseShares(100000, tercero, 'equal', inputs)).toThrow(
      SplitValidationError,
    );
  });

  it('throws on a duplicate memberId among the participants', () => {
    const inputs: ExpenseShareInput[] = [{ memberId: carlos }, { memberId: carlos }];
    expect(() => resolveExpenseShares(100000, carlos, 'equal', inputs)).toThrow(
      SplitValidationError,
    );
  });

  it('throws when amount <= 0', () => {
    const inputs: ExpenseShareInput[] = [{ memberId: carlos }, { memberId: alexandra }];
    expect(() => resolveExpenseShares(0, carlos, 'equal', inputs)).toThrow(SplitValidationError);
    expect(() => resolveExpenseShares(-100, carlos, 'equal', inputs)).toThrow(
      SplitValidationError,
    );
  });
});

describe('sharesToDebtors', () => {
  it('excludes the payer and any zero-amount shares', () => {
    const shares = [
      { memberId: carlos, amount: 500000, isPayer: true },
      { memberId: alexandra, amount: 300000, isPayer: false },
      { memberId: tercero, amount: 0, isPayer: false },
    ];
    expect(sharesToDebtors(shares)).toEqual([
      { memberId: alexandra, amount: 300000, isPayer: false },
    ]);
  });
});
