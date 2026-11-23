import { describe, expect, it } from 'vitest';
import { householdBalances } from './householdBalance';

const day = (n: number) => new Date(2026, 10, n);
let seq = 0;
const debt = (debtor: string, creditor: string | null, amount: number, extra: object = {}) =>
  ({ id: `d${++seq}`, tipo: 'Deuda', debtor, creditor, amount, crossedAmount: 0, date: day(seq), ...extra });
const pay = (debtor: string, creditor: string | null, amount: number, extra: object = {}) =>
  ({ id: `p${++seq}`, tipo: 'Abono', debtor, creditor, amount, saldaId: null, date: day(seq), ...extra });

const pos = (b: ReturnType<typeof householdBalances>, uid: string) => b.people.get(uid)!.position;
const left = (b: ReturnType<typeof householdBalances>, id: string) => (b.rows.find((r: any) => r.id === id) as any).remaining;
const sumOfPositions = (b: ReturnType<typeof householdBalances>) => [...b.people.values()].reduce((s, p) => s + p.position, 0);

describe('householdBalances — where each person stands', () => {
  it('a debt weighs on its debtor and in favor of its creditor', () => {
    const d = debt('ana', 'ben', 100);
    const b = householdBalances([d], ['ana', 'ben']);
    expect(pos(b, 'ana')).toBe(-100);
    expect(pos(b, 'ben')).toBe(100);
    expect(left(b, d.id)).toBe(100);
  });

  it('a payment counts in full whatever it was tied to (a debt, nothing, or the plan)', () => {
    const d = debt('ana', 'ben', 100);
    const tied = householdBalances([d, pay('ana', 'ben', 100, { saldaId: d.id })], ['ana', 'ben']);
    const untied = householdBalances([d, pay('ana', 'ben', 100)], ['ana', 'ben']);
    for (const b of [tied, untied]) {
      expect(pos(b, 'ana')).toBe(0);
      expect(pos(b, 'ben')).toBe(0);
      expect(left(b, d.id)).toBe(0);
      expect(b.remaining).toBe(0);
    }
    expect((tied.rows[0] as any).coverage).toMatchObject({ abonado: 100, netted: 0 });
    expect((untied.rows[0] as any).coverage).toMatchObject({ abonado: 0, netted: 100 });
  });

  it('positions always add up to zero', () => {
    const rows = [debt('a', 'b', 70), debt('b', 'c', 30), debt('c', 'a', 55), pay('a', 'c', 12), pay('b', 'a', 9), debt('a', 'c', 1)];
    expect(sumOfPositions(householdBalances(rows, ['a', 'b', 'c']))).toBe(0);
  });
});

describe('the "Gastos cumple Alexa" case: every expense leaves debts both ways, and everyone paid by the plan', () => {
  // Expense 1, Jhon paid: Carlos and Lenin owe Jhon 30 each. Expense 2, Carlos paid: Jhon and Lenin owe Carlos 50 each.
  const members = ['carlos', 'jhon', 'lenin'];
  const e1a = debt('carlos', 'jhon', 30, { expenseId: 'e1' });
  const e1b = debt('lenin', 'jhon', 30, { expenseId: 'e1' });
  const e2a = debt('jhon', 'carlos', 50, { expenseId: 'e2' });
  const e2b = debt('lenin', 'carlos', 50, { expenseId: 'e2' });
  const debts = [e1a, e1b, e2a, e2b];

  it('nets everyone into one figure: Carlos is owed 70, Jhon 10, Lenin owes 80', () => {
    const b = householdBalances(debts, members);
    expect([pos(b, 'carlos'), pos(b, 'jhon'), pos(b, 'lenin')]).toEqual([70, 10, -80]);
    // what is open, debt by debt, is exactly what Lenin owes — the debts of those who are owed are compensated
    expect(b.remaining).toBe(80);
    expect(left(b, e1a.id)).toBe(0);
    expect(left(b, e2a.id)).toBe(0);
    expect(left(b, e1b.id) + left(b, e2b.id)).toBe(80);
  });

  it('once Lenin pays the plan (70 to Carlos, 10 to Jhon), everyone is even and 100% is covered', () => {
    const b = householdBalances([...debts, pay('lenin', 'carlos', 70), pay('lenin', 'jhon', 10)], members);
    expect([pos(b, 'carlos'), pos(b, 'jhon'), pos(b, 'lenin')]).toEqual([0, 0, 0]);
    expect(b.remaining).toBe(0);
    expect(b.total - b.remaining).toBe(160);
    // Carlos never paid Jhon's 30 directly: it is compensated, not left hanging
    expect((b.rows.find((r: any) => r.id === e1a.id) as any).coverage).toMatchObject({ netted: 30, remaining: 0 });
  });

  it('gives the same result however Lenin pays: tied to his debts, untied, or all to one person who passes it on', () => {
    const tied = householdBalances([...debts, pay('lenin', 'jhon', 30, { saldaId: e1b.id }), pay('lenin', 'carlos', 50, { saldaId: e2b.id }), pay('jhon', 'carlos', 20)], members);
    const viaCarlos = householdBalances([...debts, pay('lenin', 'carlos', 80), pay('carlos', 'jhon', 10)], members);
    for (const b of [tied, viaCarlos]) {
      expect([pos(b, 'carlos'), pos(b, 'jhon'), pos(b, 'lenin')]).toEqual([0, 0, 0]);
      expect(b.remaining).toBe(0);
    }
  });
});

describe('what stays open when someone still owes', () => {
  it('covers the debts paid directly first, then the oldest', () => {
    const old = debt('ana', 'ben', 100);
    const recent = debt('ana', 'ben', 100);
    // Ana paid 50 tied to the recent one and 30 untied: she still owes 120
    const b = householdBalances([old, recent, pay('ana', 'ben', 50, { saldaId: recent.id }), pay('ana', 'ben', 30)], ['ana', 'ben']);
    expect(pos(b, 'ana')).toBe(-120);
    expect(left(b, recent.id)).toBe(50);
    expect(left(b, old.id)).toBe(70);
    expect(b.remaining).toBe(120);
  });

  it('a crossing covers both debts without changing anyone\'s balance', () => {
    const a = debt('ana', 'ben', 100, { crossedAmount: 40 });
    const c = debt('ben', 'ana', 40, { crossedAmount: 40, cruzado: true });
    const b = householdBalances([a, c], ['ana', 'ben']);
    expect(pos(b, 'ana')).toBe(-60);
    expect(left(b, a.id)).toBe(60);
    expect(left(b, c.id)).toBe(0);
  });

  it('someone who received more than they were owed has to give it back', () => {
    const b = householdBalances([debt('ana', 'ben', 100), pay('ana', 'ben', 150)], ['ana', 'ben']);
    expect(pos(b, 'ben')).toBe(-50);
    expect(b.people.get('ben')!.owesBack).toBe(50);
    expect(pos(b, 'ana')).toBe(50);
  });
});

describe('records the engine handles carefully', () => {
  it('ignores what the old period close declared settled (marked cruzado with no crossing behind it)', () => {
    const closedDebt = debt('ana', 'ben', 100, { cruzado: true });
    const closedPay = pay('ana', 'ben', 30, { cruzado: true });
    const b = householdBalances([closedDebt, closedPay, debt('ana', 'ben', 20)], ['ana', 'ben']);
    expect(pos(b, 'ana')).toBe(-20);
    expect(left(b, closedDebt.id)).toBe(0);
  });

  it('works out the counterpart of old two-person records without a creditor', () => {
    const b = householdBalances([debt('ana', null, 100), pay('ana', null, 40)], ['ana', 'ben']);
    expect(pos(b, 'ben')).toBe(60);
    expect(b.unmatched).toEqual([]);
  });

  it('flags a record whose counterpart cannot be told instead of guessing', () => {
    const b = householdBalances([debt('ana', null, 100)], ['ana', 'ben', 'cris']);
    expect(b.unmatched).toHaveLength(1);
  });
});
