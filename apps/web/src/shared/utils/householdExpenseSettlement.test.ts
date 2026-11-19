import { describe, it, expect } from 'vitest';
import { settleExpenseContributions, materializeReadyEdges, isExpenseIncomplete } from './householdExpenseSettlement';
import type { ExpenseContribution } from '../types/householdExpense';

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

describe('materializeReadyEdges', () => {
  const c = (memberId: string, status: ExpenseContribution['status'], edges: ExpenseContribution['edges']): ExpenseContribution =>
    ({ memberId, amount: 0, status, edges });

  it('creates an edge once its pending creditor confirms', () => {
    const { toCreate, updated } = materializeReadyEdges([
      c('a', 'confirmed', []),
      c('b', 'confirmed', [{ debtor: 'a', amount: 50, created: false }]),
    ]);
    expect(toCreate).toEqual([{ debtor: 'a', creditor: 'b', amount: 50 }]);
    expect(updated[1].edges[0].created).toBe(true);
  });

  it('holds an edge while its debtor still has a pending payment', () => {
    const { toCreate } = materializeReadyEdges([
      c('a', 'confirmed', [{ debtor: 'b', amount: 50, created: false }]),
      c('b', 'pending', []),
    ]);
    expect(toCreate).toEqual([]);
  });

  it('holds an edge when both parties are pending until the second confirms', () => {
    const edge = { debtor: 'b', amount: 50, created: false };
    expect(materializeReadyEdges([c('a', 'pending', [edge]), c('b', 'pending', [])]).toCreate).toEqual([]);
    expect(materializeReadyEdges([c('a', 'confirmed', [edge]), c('b', 'pending', [])]).toCreate).toEqual([]);
    expect(materializeReadyEdges([c('a', 'confirmed', [edge]), c('b', 'confirmed', [])]).toCreate).toEqual([{ debtor: 'b', creditor: 'a', amount: 50 }]);
  });

  it('uses the explicit creditor when the edge hangs on the debtor', () => {
    const { toCreate } = materializeReadyEdges([
      c('a', 'confirmed', []),
      c('b', 'confirmed', [{ debtor: 'b', creditor: 'a', amount: 30, created: false }]),
    ]);
    expect(toCreate).toEqual([{ debtor: 'b', creditor: 'a', amount: 30 }]);
  });

  it('never re-creates an edge, and never creates one whose party declined', () => {
    expect(materializeReadyEdges([c('a', 'confirmed', [{ debtor: 'b', amount: 5, created: true }]), c('b', 'confirmed', [])]).toCreate).toEqual([]);
    expect(materializeReadyEdges([c('a', 'confirmed', [{ debtor: 'b', amount: 5, created: false }]), c('b', 'declined', [])]).toCreate).toEqual([]);
    expect(materializeReadyEdges([c('a', 'declined', [{ debtor: 'b', amount: 5, created: false }]), c('b', 'confirmed', [])]).toCreate).toEqual([]);
  });

  it('legacy edges (no created flag) count as created iff the owner was confirmed', () => {
    expect(materializeReadyEdges([c('a', 'confirmed', [{ debtor: 'b', amount: 5 }]), c('b', 'confirmed', [])]).toCreate).toEqual([]);
    expect(materializeReadyEdges([c('a', 'pending', [{ debtor: 'b', amount: 5 }]), c('b', 'confirmed', [])]).toCreate).toEqual([]);
  });

  it('flags an expense with a declined contribution as incomplete', () => {
    expect(isExpenseIncomplete([{ status: 'confirmed' }, { status: 'declined' }])).toBe(true);
    expect(isExpenseIncomplete([{ status: 'pending' }])).toBe(false);
    expect(isExpenseIncomplete(undefined)).toBe(false);
  });
});
