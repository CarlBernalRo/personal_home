import { describe, it, expect } from 'vitest';
import { settleExpenseContributions } from './householdExpenseSettlement';

const sum = (edges: { amount: number }[]) => edges.reduce((s, e) => s + e.amount, 0);

describe('settleExpenseContributions', () => {
  it('matches today\'s single-payer behaviour: everyone else owes the one who paid', () => {
    const owed = [{ memberId: 'a', amount: 100000 }, { memberId: 'b', amount: 100000 }];
    const payers = [{ memberId: 'a', amount: 200000 }];
    expect(settleExpenseContributions(owed, payers)).toEqual([{ debtor: 'b', creditor: 'a', amount: 100000 }]);
  });

  it('a payer who is not a participant (fronted the whole thing for others) is owed by everyone', () => {
    // the trip example: the creator pays 400000 for 3 guests, and does not participate herself
    const owed = [{ memberId: 'g1', amount: 133334 }, { memberId: 'g2', amount: 133333 }, { memberId: 'g3', amount: 133333 }];
    const payers = [{ memberId: 'creator', amount: 400000 }];
    const edges = settleExpenseContributions(owed, payers);
    expect(edges.every((e) => e.creditor === 'creator')).toBe(true);
    expect(edges.map((e) => [e.debtor, e.amount])).toEqual([['g1', 133334], ['g2', 133333], ['g3', 133333]]);
    expect(sum(edges)).toBe(400000);
  });

  it('splits one debtor\'s deficit across several creditors in the order they were given', () => {
    const owed = [{ memberId: 'd', amount: 100000 }];
    const payers = [{ memberId: 'c1', amount: 60000 }, { memberId: 'c2', amount: 40000 }];
    expect(settleExpenseContributions(owed, payers)).toEqual([
      { debtor: 'd', creditor: 'c1', amount: 60000 },
      { debtor: 'd', creditor: 'c2', amount: 40000 },
    ]);
  });

  it('several debtors against several creditors nets out with no leftover on either side', () => {
    // a=paid 300, owes 100 (net +200) · b=paid 100, owes 150 (net -50) · c=paid 0, owes 150 (net -150)
    const owed = [{ memberId: 'a', amount: 100000 }, { memberId: 'b', amount: 150000 }, { memberId: 'c', amount: 150000 }];
    const payers = [{ memberId: 'a', amount: 300000 }, { memberId: 'b', amount: 100000 }];
    const edges = settleExpenseContributions(owed, payers);
    expect(edges.every((e) => e.creditor === 'a')).toBe(true);
    expect(sum(edges)).toBe(200000);
    expect(edges.map((e) => [e.debtor, e.amount])).toEqual([['b', 50000], ['c', 150000]]);
  });

  it('someone who paid exactly their own share nets to zero and is neither debtor nor creditor', () => {
    const owed = [{ memberId: 'a', amount: 100000 }, { memberId: 'b', amount: 100000 }];
    const payers = [{ memberId: 'a', amount: 100000 }, { memberId: 'b', amount: 100000 }];
    expect(settleExpenseContributions(owed, payers)).toEqual([]);
  });

  it('ignores a participant who owes nothing and nobody who paid nothing', () => {
    const owed = [{ memberId: 'a', amount: 0 }, { memberId: 'b', amount: 100000 }];
    const payers = [{ memberId: 'c', amount: 100000 }];
    expect(settleExpenseContributions(owed, payers)).toEqual([{ debtor: 'b', creditor: 'c', amount: 100000 }]);
  });

  it('returns nothing for no participants and no payers', () => {
    expect(settleExpenseContributions([], [])).toEqual([]);
  });
});
