import { describe, it, expect } from 'vitest';
import { deriveAlerts, relativeDay, type AlertInput } from './alerts';
import { monthEntries } from './fixedExpenses';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const today = d(2026, 11, 10);

const fe = (id: string, paymentDay: number, estimatedAmount: number, extra: object = {}) => ({
  id, concept: id, paymentDay, estimatedAmount, frequency: 'fijo' as const, startMonth: '2026-11', ...extra,
});

const base = (over: Partial<AlertInput> = {}): AlertInput => ({
  today, period: { start: d(2026, 10, 30), end: d(2026, 11, 30) }, entries: [], pending: null, ledger: null,
  budgets: [], spends: [], householdLines: [], householdNames: {}, ...over,
});

describe('relativeDay', () => {
  it('speaks in days', () => {
    expect(relativeDay(today, today)).toBe('hoy');
    expect(relativeDay(d(2026, 11, 11), today)).toBe('mañana');
    expect(relativeDay(d(2026, 11, 14), today)).toBe('en 4 días');
    expect(relativeDay(d(2026, 11, 8), today)).toBe('hace 2 días');
  });
});

describe('deriveAlerts', () => {
  it('reminds about movements prepared in Telegram, with the count in its key', () => {
    expect(deriveAlerts(base({ pendingMovements: 0 }))).toEqual([]);
    const [a] = deriveAlerts(base({ pendingMovements: 3 }));
    expect(a.title).toBe('Tienes 3 movimientos de Telegram por confirmar');
    expect(a.link).toBe('/pendientes');
    expect(a.key).toBe('pendmov|3');
    expect(deriveAlerts(base({ pendingMovements: 1 }))[0].title).toBe('Tienes 1 movimiento de Telegram por confirmar');
  });

  it('has nothing to say when everything is in order', () => {
    expect(deriveAlerts(base())).toEqual([]);
  });

  it('tells each overdue bill by itself and flags the ones coming up', () => {
    const expenses = [fe('Luz', 5, 90_000), fe('Agua', 3, 40_000), fe('Gas', 12, 30_000), fe('Seguro', 25, 10_000)];
    const entries = monthEntries(expenses, '2026-11', new Map(), today);
    const alerts = deriveAlerts(base({ entries }));
    const overdue = alerts.filter((a) => a.zone === 'fijos' && a.severity === 'critical');
    expect(overdue.map((a) => a.title).sort()).toEqual(['Agua lleva 7 días vencido', 'Luz lleva 5 días vencido']);
    expect(overdue.find((a) => a.title.startsWith('Luz'))!.body).toContain('90.000');
    const soon = alerts.filter((a) => a.severity === 'warning');
    expect(soon.map((a) => a.title)).toEqual(['Gas vence en 2 días']);
    expect(soon[0].key).toBe('fx-soon|Gas|2026-11');
    expect(alerts[0].severity).toBe('critical'); // most urgent first
  });

  describe('stages of a bill due on the 10th', () => {
    const keyOn = (day: number) => {
      const t = d(2026, 11, day);
      const entries = monthEntries([fe('Luz', 10, 90_000)], '2026-11', new Map(), t);
      return deriveAlerts(base({ today: t, entries })).filter((a) => a.zone === 'fijos').map((a) => a.key);
    };
    it('one notice when it is coming up and a different one the day it is due', () => {
      expect(keyOn(7)).toEqual(['fx-soon|Luz|2026-11']);
      expect(keyOn(9)).toEqual(['fx-soon|Luz|2026-11']);
      expect(keyOn(10)).toEqual(['fx-today|Luz|2026-11']);
      expect(keyOn(5)).toEqual([]); // more than 3 days ahead
    });
    it('once overdue the key changes every two days (late days 1, 3, 5, 7, 9) and stops changing after that', () => {
      const keys = (days: number[]) => days.map((n) => keyOn(10 + n)[0]);
      expect(keys([1, 2])).toEqual(['fx-overdue|Luz:2026-11|0', 'fx-overdue|Luz:2026-11|0']);
      expect(keys([3, 4])).toEqual(['fx-overdue|Luz:2026-11|1', 'fx-overdue|Luz:2026-11|1']);
      expect(keys([5, 7, 9]).map((k) => k.split('|')[2])).toEqual(['2', '3', '4']);
      // past 10 days late the key stays the last one: nothing new goes out
      expect(keys([10, 15, 30]).map((k) => k.split('|')[2])).toEqual(['4', '4', '4']);
    });
  });

  it('warns about the pay day and about overspending', () => {
    const alerts = deriveAlerts(base({
      pending: { date: today, amount: 2_895_169, ruleIndex: 0 },
      ledger: { rows: new Map(), committed: 0, extraTotal: 0, variableSpent: 0, additionalSpent: 0, variableReserved: 0, carryIn: 0, remaining: -50_000 },
    }));
    expect(alerts.map((a) => a.title)).toEqual(['Tus gastos superan tus ingresos', 'Hoy es día de pago']);
  });

  it('does not say it is pay day when the unconfirmed pay date is already past', () => {
    const alerts = deriveAlerts(base({ pending: { date: d(2026, 11, 8), amount: 2_700_000, ruleIndex: 0 } }));
    expect(alerts[0].title).toBe('Tienes un pago por confirmar');
    expect(alerts[0].body).toContain('aún no está confirmado');
  });

  it('flags an occasional expense that went over its estimate', () => {
    const alerts = deriveAlerts(base({
      budgets: [{ id: 'g', concept: 'Gasolina', category: 'transporte', amount: 80_000, active: true }],
      spends: [{ id: 's', budgetId: 'g', date: d(2026, 11, 2), amount: 95_000, concept: 'Tanqueo' }],
    }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ zone: 'gastos', severity: 'warning' });
  });

  it('flags household debts that are due soon or overdue, and ignores the ones far ahead', () => {
    const lines = [
      { id: '1', concept: 'Mercado', householdId: 'h', date: d(2026, 10, 1), dueDate: d(2026, 11, 8), remaining: 50_000 },
      { id: '2', concept: 'Arena', householdId: 'h', date: d(2026, 10, 1), dueDate: d(2026, 11, 12), remaining: 20_000 },
      { id: '3', concept: 'Lejos', householdId: 'h', date: d(2026, 10, 1), dueDate: d(2026, 12, 20), remaining: 10_000 },
      { id: '4', concept: 'Sin fecha', householdId: 'h', date: d(2026, 10, 1), dueDate: null, remaining: 10_000 },
    ];
    const alerts = deriveAlerts(base({ householdLines: lines, householdNames: { h: 'Casa' } }));
    expect(alerts.map((a) => [a.severity, a.link])).toEqual([['critical', '/hogar?id=h'], ['warning', '/hogar?id=h']]);
    expect(alerts[0].title).toBe('Deuda vencida en Casa');
  });
});
