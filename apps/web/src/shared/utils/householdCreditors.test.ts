import { describe, it, expect } from 'vitest';
import { creditorOf, owedByCreditor, pendingOwedTo } from './householdCreditors';

const members = ['a', 'b', 'c', 'd', 'e'];
const debt = (o: Partial<any>) => ({ tipo: 'Deuda', amount: 100, debtor: 'a', ...o });

describe('household creditors', () => {
  it('a debt is owed to who paid it, a loan to the lender', () => {
    expect(creditorOf(debt({ creditor: 'b' }), members)).toBe('b');
    expect(creditorOf(debt({ lender: 'c' }), members)).toBe('c');
  });

  it('an old debt without creditor is only resolvable in a household of two', () => {
    expect(creditorOf(debt({}), ['a', 'b'])).toBe('b');
    expect(creditorOf(debt({}), members)).toBeNull();
  });

  it('groups what one person owes by whom it is owed to', () => {
    const list = [
      debt({ creditor: 'b', amount: 300 }),
      debt({ creditor: 'c', amount: 500 }),
      debt({ creditor: 'b', amount: 100, paidAbono: 40 }),
      debt({ creditor: 'd', amount: 90, paidAbono: 90 }), // fully paid: not pending
      debt({ creditor: 'a', debtor: 'b', amount: 999 }), // somebody else's debt
    ];
    expect(owedByCreditor(list, 'a', members)).toEqual([
      { creditor: 'c', owed: 500 },
      { creditor: 'b', owed: 360 },
    ]);
  });

  it('only the debts to that creditor can be paid or crossed', () => {
    const list = [debt({ creditor: 'b', id: 1 }), debt({ creditor: 'c', id: 2 })];
    expect(pendingOwedTo(list, 'a', 'c', members).map((d: any) => d.id)).toEqual([2]);
  });
});
