import { describe, it, expect, vi } from 'vitest';

// calcNetBalance is pure math with no Firestore I/O, but the module it lives in
// imports `./firebase` (which initializes a real Firebase app) at module scope.
// Mock that module so importing firestore.ts in a test environment doesn't try
// to reach out to a live project.
vi.mock('./firebase', () => ({ db: {} }));

import { calcNetBalance } from './firestore';

const carlos = 'carlos-uid';
const alexandra = 'alexandra-uid';

describe('calcNetBalance', () => {
  it('equals the full debt amount for a single pending Deuda, no abono/crossing', () => {
    const debts = [{ tipo: 'Deuda', debtor: carlos, amount: 100000 }];
    expect(calcNetBalance(debts, carlos)).toBe(100000);
  });

  it('subtracts a partial crossedAmount from a Deuda', () => {
    const debts = [{ tipo: 'Deuda', debtor: carlos, amount: 100000, crossedAmount: 40000 }];
    expect(calcNetBalance(debts, carlos)).toBe(60000);
  });

  it('subtracts an Abono for the same debtor from the Deuda total', () => {
    const debts = [
      { tipo: 'Deuda', debtor: carlos, amount: 100000 },
      { tipo: 'Abono', debtor: carlos, amount: 30000 },
    ];
    expect(calcNetBalance(debts, carlos)).toBe(70000);
  });

  it('subtracts an Abono regardless of whether it is saldaId-linked', () => {
    const debts = [
      { tipo: 'Deuda', debtor: carlos, amount: 100000 },
      { tipo: 'Abono', debtor: carlos, amount: 30000, saldaId: 'some-debt-id' },
    ];
    expect(calcNetBalance(debts, carlos)).toBe(70000);
  });

  it('sums multiple Deuda rows for the same debtor', () => {
    const debts = [
      { tipo: 'Deuda', debtor: carlos, amount: 100000 },
      { tipo: 'Deuda', debtor: carlos, amount: 50000 },
    ];
    expect(calcNetBalance(debts, carlos)).toBe(150000);
  });

  it('excludes debts belonging to a different debtor', () => {
    const debts = [
      { tipo: 'Deuda', debtor: carlos, amount: 100000 },
      { tipo: 'Deuda', debtor: alexandra, amount: 999999 },
    ];
    expect(calcNetBalance(debts, carlos)).toBe(100000);
  });

  it('reduces net balance via a legacy "cross against total balance" crossing (debt2Id null/absent)', () => {
    const debts = [{ tipo: 'Deuda', debtor: carlos, amount: 100000 }];
    const crossings = [{ debt2PersonId: carlos, debt2Id: null, amount: 20000 }];
    expect(calcNetBalance(debts, carlos, crossings)).toBe(80000);

    const crossingsNoField = [{ debt2PersonId: carlos, amount: 20000 }];
    expect(calcNetBalance(debts, carlos, crossingsNoField)).toBe(80000);
  });

  it('does not apply a crossing that has a debt2Id (specific-debt crossing, not legacy total-balance mode)', () => {
    const debts = [{ tipo: 'Deuda', debtor: carlos, amount: 100000 }];
    const crossings = [{ debt2PersonId: carlos, debt2Id: 'some-debt', amount: 20000 }];
    expect(calcNetBalance(debts, carlos, crossings)).toBe(100000);
  });

  it('returns a negative number (overpaid) when abonos exceed debts, without clamping to zero', () => {
    const debts = [
      { tipo: 'Deuda', debtor: carlos, amount: 50000 },
      { tipo: 'Abono', debtor: carlos, amount: 80000 },
    ];
    expect(calcNetBalance(debts, carlos)).toBe(-30000);
  });
});
