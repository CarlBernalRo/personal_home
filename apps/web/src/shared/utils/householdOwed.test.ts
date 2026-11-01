import { describe, it, expect } from 'vitest';
import { budgetAmountOn, datedLinesOf, debtLines, householdDebtDays, recordsAsOf } from './householdOwed';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe('recordsAsOf', () => {
  const debts = [
    { id: 'a', date: d(2026, 10, 20) },
    { id: 'b', date: d(2026, 11, 15) },
  ];

  it('leaves out debts dated after the date', () => {
    expect(recordsAsOf(debts, [], d(2026, 11, 1)).debts.map((x) => x.id)).toEqual(['a']);
    expect(recordsAsOf(debts, [], d(2026, 12, 1)).debts.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('includes records dated on that very day', () => {
    expect(recordsAsOf(debts, [], d(2026, 11, 15)).debts).toHaveLength(2);
  });

  it('filters crossings by creation date but keeps undated ones', () => {
    const crossings = [{ createdAt: d(2026, 11, 20) }, {}];
    expect(recordsAsOf([], crossings, d(2026, 11, 1)).crossings).toHaveLength(1);
    expect(recordsAsOf([], crossings, d(2026, 12, 1)).crossings).toHaveLength(2);
  });
});

describe('budgetAmountOn', () => {
  const typed = { id: 'g', concept: 'Gasolina', category: 'transporte', amount: 80_000, active: true };
  const linked = { id: 'h', concept: 'Deuda', category: 'otro', amount: 0, active: true, source: 'household-debt' as const };

  it('uses the typed estimate for a normal budget', () => {
    expect(budgetAmountOn(typed, undefined, d(2026, 12, 1))).toBe(80_000);
  });

  it('asks what was owed on that date for a household-debt budget', () => {
    const variable = { budgets: [], spends: [], householdOwed: 10, householdOwedAt: (x: Date) => (x >= d(2026, 12, 1) ? 300_000 : 0) };
    expect(budgetAmountOn(linked, variable, d(2026, 11, 1))).toBe(0);
    expect(budgetAmountOn(linked, variable, d(2026, 12, 1))).toBe(300_000);
  });
});

describe('debtLines', () => {
  const debt = (id: string, amount: number, date: Date, dueDate: Date | null = null, extra = {}) =>
    ({ id, debtor: 'me', tipo: 'Deuda', amount, date, dueDate, concept: id, ...extra });

  it('lists my pending debts with their agreed date', () => {
    const lines = debtLines([debt('a', 100, d(2026, 10, 1), d(2026, 11, 15)), debt('b', 50, d(2026, 10, 2))], 'me', 'h1', 150);
    expect(lines.map((l) => [l.id, l.remaining, l.dueDate ? 'dated' : 'undated'])).toEqual([['a', 100, 'dated'], ['b', 50, 'undated']]);
  });

  it('ignores other people debts, abonos and crossed or paid ones', () => {
    const lines = debtLines([
      { ...debt('x', 100, d(2026, 10, 1)), debtor: 'ale' },
      { ...debt('y', 100, d(2026, 10, 1)), tipo: 'Abono' },
      debt('z', 100, d(2026, 10, 1), null, { cruzado: true }),
    ], 'me', 'h1', 0);
    expect(lines).toEqual([]);
  });

  it('applies loose credit (abonos not tied to a debt) to the oldest debts first', () => {
    const lines = debtLines([debt('old', 100, d(2026, 9, 1)), debt('new', 100, d(2026, 10, 1))], 'me', 'h1', 120); // 80 of credit
    expect(lines.map((l) => [l.id, l.remaining])).toEqual([['old', 20], ['new', 100]]);
  });
});

describe('household-specific budgets', () => {
  const b = (...ids: string[]) => ({ id: 'h', concept: 'Deuda', category: 'otro', amount: 0, active: true, source: 'household-debt' as const, householdIds: ids.length ? ids : undefined });
  const variable = {
    budgets: [], spends: [], householdOwed: 0,
    householdUndatedOwedAt: (_d: Date, ids?: string[] | null) => (ids?.length === 1 && ids[0] === 'A' ? 100 : ids?.length === 1 && ids[0] === 'B' ? 40 : 140),
    householdLines: [
      { id: '1', concept: 'Mercado', householdId: 'A', date: d(2026, 10, 1), dueDate: d(2026, 11, 15), remaining: 70 },
      { id: '2', concept: 'Luz', householdId: 'B', date: d(2026, 10, 1), dueDate: null, remaining: 40 },
    ],
  };

  it('asks for the amount of its own household', () => {
    expect(budgetAmountOn(b('A'), variable, d(2026, 12, 1))).toBe(100);
    expect(budgetAmountOn(b('B'), variable, d(2026, 12, 1))).toBe(40);
    expect(budgetAmountOn(b(), variable, d(2026, 12, 1))).toBe(140);
  });

  it('can follow several specific households at once', () => {
    expect(datedLinesOf(b('A', 'B'), variable).map((l) => l.id)).toEqual(['1']);
    expect(datedLinesOf(b('B'), variable)).toEqual([]);
  });

  it('only returns the dated debts of its household', () => {
    expect(datedLinesOf(b('A'), variable).map((l) => l.id)).toEqual(['1']);
    expect(datedLinesOf(b('B'), variable)).toEqual([]);
    expect(datedLinesOf(b(), variable).map((l) => l.id)).toEqual(['1']);
  });
});

describe('householdDebtDays', () => {
  const budget = { id: 'h', concept: 'Pago deuda Ale', category: 'otro', amount: 0, paymentDay: 1, active: true, source: 'household-debt' as const };
  const variable = {
    budgets: [budget], spends: [], householdOwed: 0,
    householdNames: { A: 'Casa', B: 'Test 2' },
    householdLines: [
      { id: '1', concept: 'Mueble', householdId: 'B', date: d(2026, 10, 30), dueDate: d(2026, 12, 15), remaining: 300_000 },
      { id: '2', concept: 'Luz', householdId: 'A', date: d(2026, 11, 20), dueDate: null, remaining: 40_000 },
    ],
  };

  it('lists each debt with its household and name', () => {
    const days = householdDebtDays(budget, variable, 2026, 11); // December
    expect(days.get(1)).toEqual([{ householdId: 'A', household: 'Casa', debt: 'Luz', detail: 'sin fecha acordada', amount: 40_000 }]);
    expect(days.get(15)).toEqual([{ householdId: 'B', household: 'Test 2', debt: 'Mueble', detail: 'fecha acordada', amount: 300_000 }]);
  });

  it('does not list a debt on a usual day before it was registered', () => {
    expect(householdDebtDays(budget, variable, 2026, 10).get(1)).toBeUndefined(); // 1 Nov: the Luz debt (20 Nov) doesn't exist yet
  });
});
