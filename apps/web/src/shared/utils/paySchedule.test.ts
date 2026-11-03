import { describe, it, expect } from 'vitest';
import {
  buildSalaryPeriods, buildCalendarPeriods, periodModeOf, monthBounds, periodEntries, lastBusinessDay, latestPayDate, nextPayDate, payDatesBetween, periodAt, periodLedger, salaryLedgers, cashOnHand,
} from './paySchedule';
import type { PaySchedule } from '../types/paySchedule';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const ymd = (x: Date | undefined) => x && `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;

const lastBiz: PaySchedule = { rules: [{ kind: 'last-business-day', amount: 5_000_000 }], weekendAdjust: 'before' };

describe('lastBusinessDay', () => {
  it('is the last day when it is a weekday', () => {
    expect(ymd(lastBusinessDay(2026, 9))).toBe('2026-10-30'); // 31 Oct 2026 is a Saturday → Friday 30
    expect(ymd(lastBusinessDay(2026, 10))).toBe('2026-11-30'); // Monday
  });

  it('steps back from Sunday to Friday', () => {
    expect(ymd(lastBusinessDay(2026, 4))).toBe('2026-5-29'); // 31 May 2026 is a Sunday
  });
});

describe('pay dates', () => {
  it('finds the last-business-day payment of each month', () => {
    const dates = payDatesBetween(lastBiz, d(2026, 10, 1), d(2026, 12, 31)).map((p) => ymd(p.date));
    expect(dates).toEqual(['2026-10-30', '2026-11-30', '2026-12-31']);
  });

  it('supports two payments a month (quincena)', () => {
    const q: PaySchedule = {
      rules: [{ kind: 'day', day: 15, amount: 1 }, { kind: 'day', day: 30, amount: 2 }],
      weekendAdjust: 'none',
    };
    const dates = payDatesBetween(q, d(2026, 11, 1), d(2026, 11, 30)).map((p) => ymd(p.date));
    expect(dates).toEqual(['2026-11-15', '2026-11-30']);
  });

  it('clamps day 30 to the end of February', () => {
    const s: PaySchedule = { rules: [{ kind: 'day', day: 30, amount: 1 }], weekendAdjust: 'none' };
    expect(ymd(payDatesBetween(s, d(2027, 2, 1), d(2027, 2, 28))[0].date)).toBe('2027-2-28');
  });

  it('moves a weekend day back or forward', () => {
    const base = { rules: [{ kind: 'day' as const, day: 15, amount: 1 }] };
    const range = [d(2026, 8, 1), d(2026, 8, 31)] as const; // 15 Aug 2026 is a Saturday
    expect(ymd(payDatesBetween({ ...base, weekendAdjust: 'before' }, ...range)[0].date)).toBe('2026-8-14');
    expect(ymd(payDatesBetween({ ...base, weekendAdjust: 'after' }, ...range)[0].date)).toBe('2026-8-17');
    expect(ymd(payDatesBetween({ ...base, weekendAdjust: 'none' }, ...range)[0].date)).toBe('2026-8-15');
  });

  it('finds the latest and next pay date', () => {
    expect(ymd(latestPayDate(lastBiz, d(2026, 11, 10))?.date)).toBe('2026-10-30');
    expect(ymd(latestPayDate(lastBiz, d(2026, 10, 30))?.date)).toBe('2026-10-30'); // pay day itself
    expect(ymd(nextPayDate(lastBiz, d(2026, 10, 30))?.date)).toBe('2026-11-30');
  });
});

describe('salary periods and ledger', () => {
  const periods = buildSalaryPeriods([{ id: 's1', date: d(2026, 10, 30), amount: 3_000_000 }], lastBiz);

  it('covers from the pay date up to the next one', () => {
    expect(ymd(periods[0].end)).toBe('2026-11-30');
    expect(periodAt(periods, d(2026, 11, 2))?.id).toBe('s1');
    expect(periodAt(periods, d(2026, 11, 30))).toBeUndefined();
    expect(periodAt(periods, d(2026, 10, 29))).toBeUndefined();
  });

  const entry = (id: string, due: Date, amount: number, paid = false): any => ({
    fe: { id },
    hostMonth: '2026-11',
    due,
    payment: paid ? { paidAmount: amount } : undefined,
    owed: paid ? [] : [{ occMonth: '2026-11', amount }],
  });

  it('subtracts the period expenses in date order', () => {
    const l = periodLedger(periods[0], [
      entry('b', d(2026, 11, 9), 75_000),
      entry('a', d(2026, 11, 2), 150_000),
      entry('outside', d(2026, 12, 2), 999),
    ]);
    expect(l.committed).toBe(225_000);
    expect(l.remaining).toBe(2_775_000);
    expect(l.rows.get('a|2026-11')?.remaining).toBe(2_850_000);
  });

  it('charges a paid item at what was paid', () => {
    const l = periodLedger(periods[0], [entry('a', d(2026, 11, 2), 120_000, true)]);
    expect(l.committed).toBe(120_000);
  });

  it('counts a month owed once even when two entries carry it', () => {
    const dup = (host: string, due: Date): any => ({
      fe: { id: 'c' }, hostMonth: host, due, owed: [{ occMonth: '2026-10', amount: 32_200 }, { occMonth: host, amount: 32_200 }],
    });
    const l = periodLedger(periods[0], [dup('2026-11', d(2026, 11, 2)), dup('2026-12', d(2026, 11, 20))]);
    expect(l.committed).toBe(32_200 * 3);
  });
});

describe('carry-over between periods', () => {
  const fe = { id: 'f', estimatedAmount: 1_000_000, paymentDay: 5, frequency: 'fijo' as const, startMonth: '2026-10' };
  const salaries = [
    { id: 's1', date: d(2026, 10, 30), amount: 3_000_000 },
    { id: 's2', date: d(2026, 11, 30), amount: 3_000_000 },
  ];
  const today = d(2026, 12, 15);
  const periods = buildSalaryPeriods(salaries, lastBiz);
  // Oct and Nov already paid, so only each period's own payment is charged
  const paid = new Map([['f|2026-10', { paidAmount: 1_000_000 }], ['f|2026-11', { paidAmount: 1_000_000 }]]);

  it('adds the leftover of one period on top of the next salary', () => {
    const ledgers = salaryLedgers(periods, [fe], paid, today);
    const first = ledgers.get('s1')!;
    const second = ledgers.get('s2')!;
    expect(first.carryIn).toBe(0);
    expect(first.remaining).toBe(2_000_000); // Nov 5 payment of 1M against 3M
    expect(second.carryIn).toBe(first.remaining);
    expect(second.remaining).toBe(3_000_000 + 2_000_000 - 1_000_000); // Dec 5 payment
  });

  it('carries a shortfall forward as a negative amount', () => {
    const small = [{ id: 's1', date: d(2026, 10, 30), amount: 400_000 }, { id: 's2', date: d(2026, 11, 30), amount: 3_000_000 }];
    const ledgers = salaryLedgers(buildSalaryPeriods(small, lastBiz), [fe], paid, today);
    expect(ledgers.get('s1')!.remaining).toBe(-600_000);
    expect(ledgers.get('s2')!.carryIn).toBe(-600_000);
  });
});

describe('arrears are charged only once across periods', () => {
  it('does not charge a month already counted in an earlier period', () => {
    const fe = { id: 'f', estimatedAmount: 100_000, paymentDay: 5, frequency: 'fijo' as const, startMonth: '2026-10' };
    const periods = buildSalaryPeriods(
      [{ id: 's1', date: d(2026, 11, 1), amount: 1_000_000 }, { id: 's2', date: d(2026, 11, 30), amount: 1_000_000 }],
      lastBiz,
    );
    // Nothing paid: Dec 5 carries Oct + Nov as arrears, but Nov 5 was already charged to s1
    const l = salaryLedgers(periods, [fe], new Map(), d(2026, 12, 15));
    expect(l.get('s1')!.remaining).toBe(900_000);
    expect(l.get('s2')!.remaining).toBe(900_000 + 1_000_000 - 200_000); // Oct + Dec; Nov not repeated
  });
});

describe('extra incomes', () => {
  const fe = { id: 'f', estimatedAmount: 1_000_000, paymentDay: 5, frequency: 'fijo' as const, startMonth: '2026-11' };
  const periods = buildSalaryPeriods([{ id: 's1', date: d(2026, 10, 30), amount: 3_000_000 }], lastBiz);
  const paid = new Map([['f|2026-11', { paidAmount: 1_000_000 }]]);

  it('adds to the period it falls in', () => {
    const extras = [{ id: 'x', date: d(2026, 11, 10), amount: 500_000, concept: 'Deuda pagada' }];
    const l = salaryLedgers(periods, [fe], paid, d(2026, 11, 20), extras).get('s1')!;
    expect(l.extraTotal).toBe(500_000);
    expect(l.remaining).toBe(3_000_000 - 1_000_000 + 500_000);
  });

  it('ignores incomes outside the period', () => {
    const extras = [{ id: 'x', date: d(2026, 12, 10), amount: 500_000, concept: 'later' }];
    expect(salaryLedgers(periods, [fe], paid, d(2026, 11, 20), extras).get('s1')!.extraTotal).toBe(0);
  });

  it('is available on the same day to cover an expense', () => {
    const extras = [{ id: 'x', date: d(2026, 11, 5), amount: 100, concept: 'same day' }];
    const l = salaryLedgers(periods, [fe], paid, d(2026, 11, 20), extras).get('s1')!;
    expect(l.rows.get('f|2026-11')?.remaining).toBe(3_000_000 + 100 - 1_000_000);
  });
});

describe('cashOnHand', () => {
  const salary = [{ date: d(2026, 10, 30), amount: 5_000_000 }];
  const today = d(2026, 11, 10);

  it('is null until a salary is confirmed', () => {
    expect(cashOnHand([], [], [], today)).toBeNull();
    expect(cashOnHand([{ date: d(2026, 12, 1), amount: 1 }], [], [], today)).toBeNull(); // future pay
  });

  it('adds salary and extras, subtracts what was actually paid', () => {
    const extras = [{ id: 'x', date: d(2026, 11, 5), amount: 300_000, concept: 'deuda' }];
    const payments = [{ paidAmount: 450_000, paymentDate: d(2026, 11, 2) }, { paidAmount: 75_000, paymentDate: d(2026, 11, 9) }];
    expect(cashOnHand(salary, extras, payments, today)).toBe(5_000_000 + 300_000 - 525_000);
  });

  it('ignores payments made before the first salary and anything dated in the future', () => {
    const payments = [{ paidAmount: 100, paymentDate: d(2026, 10, 1) }, { paidAmount: 200, paymentDate: d(2026, 11, 20) }];
    const extras = [{ id: 'x', date: d(2026, 11, 25), amount: 999, concept: 'later' }];
    expect(cashOnHand(salary, extras, payments, today)).toBe(5_000_000);
  });

  it('counts things dated today', () => {
    expect(cashOnHand(salary, [], [{ paidAmount: 50, paymentDate: today }], today)).toBe(4_999_950);
  });
});

describe('variable budgets (e.g. gasoline)', () => {
  const periods = buildSalaryPeriods([{ id: 's1', date: d(2026, 10, 30), amount: 3_000_000 }], lastBiz);
  const budgets = [{ id: 'g', concept: 'Gasolina', category: 'transporte', amount: 150_000, active: true }];
  const spend = (id: string, date: Date, amount: number) => ({ id, budgetId: 'g', date, amount, concept: 'Gasolina' });
  const run = (spends: ReturnType<typeof spend>[], today: Date) =>
    salaryLedgers(periods, [], new Map(), today, [], { budgets, spends }).get('s1')!;

  it('reserves the whole estimate while nothing has been spent', () => {
    const l = run([], d(2026, 11, 10));
    expect(l.variableReserved).toBe(150_000);
    expect(l.remaining).toBe(3_000_000 - 150_000);
  });

  it('charges what was spent and reserves only the rest', () => {
    const l = run([spend('a', d(2026, 11, 3), 80_000)], d(2026, 11, 10));
    expect(l.variableSpent).toBe(80_000);
    expect(l.variableReserved).toBe(70_000);
    expect(l.remaining).toBe(3_000_000 - 80_000 - 70_000);
  });

  it('spending above the estimate reserves nothing and shows the excess', () => {
    const l = run([spend('a', d(2026, 11, 3), 200_000)], d(2026, 11, 10));
    expect(l.variableReserved).toBe(0);
    expect(l.remaining).toBe(3_000_000 - 200_000);
  });

  it('releases the reserve once the period is over', () => {
    const closed = run([spend('a', d(2026, 11, 3), 80_000)], d(2026, 12, 5)); // period ended 30 Nov
    expect(closed.variableReserved).toBe(0);
    expect(closed.remaining).toBe(3_000_000 - 80_000);
  });

  it('counts real spends in the account balance but not the reserve', () => {
    const cash = cashOnHand(
      [{ date: d(2026, 10, 30), amount: 3_000_000 }], [], [], d(2026, 11, 10),
      [{ date: d(2026, 11, 3), amount: 80_000 }, { date: d(2026, 10, 1), amount: 5 }],
    );
    expect(cash).toBe(3_000_000 - 80_000);
  });
});

describe('household-debt budget', () => {
  const periods = buildSalaryPeriods([{ id: 's1', date: d(2026, 10, 30), amount: 3_000_000 }], lastBiz);
  const budgets = [{ id: 'h', concept: 'Pago deuda Ale', category: 'otro', amount: 0, active: true, source: 'household-debt' as const }];

  it('reserves what is owed in the households', () => {
    const l = salaryLedgers(periods, [], new Map(), d(2026, 11, 10), [], { budgets, spends: [], householdOwed: 420_000 }).get('s1')!;
    expect(l.variableReserved).toBe(420_000);
    expect(l.remaining).toBe(3_000_000 - 420_000);
  });

  it('an abono paid counts as spent while the remaining debt is what stays reserved', () => {
    const spends = [{ id: 'abono|1', budgetId: 'h', date: d(2026, 11, 3), amount: 100_000, concept: 'Abono' }];
    const l = salaryLedgers(periods, [], new Map(), d(2026, 11, 10), [], { budgets, spends, householdOwed: 320_000 }).get('s1')!;
    expect(l.variableSpent).toBe(100_000);
    expect(l.variableReserved).toBe(320_000);
    expect(l.remaining).toBe(3_000_000 - 100_000 - 320_000);
  });
});

describe('paused occasional budget', () => {
  const periods = buildSalaryPeriods([{ id: 's1', date: d(2026, 11, 30), amount: 3_000_000 }], lastBiz); // period of December
  const card = { id: 'c', concept: 'Tarjeta', category: 'otro', amount: 150_000, active: true, pauses: [{ from: '2026-12' }] };

  it('reserves nothing in a period that falls in a paused month', () => {
    const l = salaryLedgers(periods, [], new Map(), d(2026, 12, 5), [], { budgets: [card], spends: [] }).get('s1')!;
    expect(l.variableReserved).toBe(0);
  });

  it('still reserves before the pause', () => {
    const nov = buildSalaryPeriods([{ id: 's0', date: d(2026, 10, 30), amount: 3_000_000 }], lastBiz);
    const l = salaryLedgers(nov, [], new Map(), d(2026, 11, 5), [], { budgets: [card], spends: [] }).get('s0')!;
    expect(l.variableReserved).toBe(150_000);
  });
});

describe('household debt by month', () => {
  const budgets = [{ id: 'h', concept: 'Pago deuda Ale', category: 'otro', amount: 0, paymentDay: 1, active: true, source: 'household-debt' as const }];
  // no debt on 1 Nov, 300.000 owed on 1 Dec (a debt incurred during November)
  const owedAt = (date: Date) => (date >= d(2026, 12, 1) ? 300_000 : 0);
  const variable = { budgets, spends: [], householdOwed: 0, householdOwedAt: owedAt };

  it('reserves nothing in the November period when nothing is owed on 1 Nov', () => {
    const nov = buildSalaryPeriods([{ id: 's', date: d(2026, 10, 30), amount: 3_000_000 }], lastBiz); // 30 Oct – 29 Nov
    expect(salaryLedgers(nov, [], new Map(), d(2026, 11, 10), [], variable).get('s')!.variableReserved).toBe(0);
  });

  it('reserves the debt in the December period, whose pay day (1 Dec) is inside it', () => {
    const dec = buildSalaryPeriods([{ id: 's', date: d(2026, 11, 30), amount: 3_000_000 }], lastBiz); // 30 Nov – 30 Dec
    expect(salaryLedgers(dec, [], new Map(), d(2026, 12, 5), [], variable).get('s')!.variableReserved).toBe(300_000);
  });
});

describe('household debts with an agreed date', () => {
  const budget = { id: 'h', concept: 'Hogar', category: 'otro', amount: 0, paymentDay: 1, active: true, source: 'household-debt' as const, householdIds: ['A'] };
  const lines = [
    { id: 'd1', concept: 'Mercado', householdId: 'A', date: d(2026, 10, 1), dueDate: d(2026, 11, 15), remaining: 70_000 }, // due in the period
    { id: 'd2', concept: 'Luz', householdId: 'A', date: d(2026, 10, 1), dueDate: d(2026, 12, 20), remaining: 30_000 },    // next period
    { id: 'd3', concept: 'Otro hogar', householdId: 'B', date: d(2026, 10, 1), dueDate: d(2026, 11, 10), remaining: 999 },
  ];
  const run = (undated: number) => {
    const periods = buildSalaryPeriods([{ id: 's', date: d(2026, 10, 30), amount: 3_000_000 }], lastBiz); // 30 Oct – 29 Nov
    return salaryLedgers(periods, [], new Map(), d(2026, 11, 5), [], {
      budgets: [budget], spends: [], householdLines: lines, householdUndatedOwedAt: () => undated,
    }).get('s')!;
  };

  it('reserves the dated debts due in the period plus the undated part, only for its household', () => {
    expect(run(20_000).variableReserved).toBe(70_000 + 20_000);
  });

  it('does not reserve a dated debt that falls due in a later period', () => {
    expect(run(0).variableReserved).toBe(70_000);
  });

  it('reserves an overdue dated debt from an earlier date', () => {
    const overdue = [{ id: 'o', concept: 'Viejo', householdId: 'A', date: d(2026, 8, 1), dueDate: d(2026, 9, 1), remaining: 55_000 }];
    const periods = buildSalaryPeriods([{ id: 's', date: d(2026, 10, 30), amount: 3_000_000 }], lastBiz);
    const l = salaryLedgers(periods, [], new Map(), d(2026, 11, 5), [], {
      budgets: [budget], spends: [], householdLines: overdue, householdUndatedOwedAt: () => 0,
    }).get('s')!;
    expect(l.variableReserved).toBe(55_000);
  });
});

describe('monthBounds', () => {
  const periods = buildSalaryPeriods([{ id: 'a', date: d(2026, 10, 30), amount: 1 }], lastBiz);

  it('uses the salary period that ends in the month (30 Oct-29 Nov is November)', () => {
    const b = monthBounds('2026-11', periods);
    expect(ymd(b.start)).toBe('2026-10-30');
    expect(ymd(b.end)).toBe('2026-11-30'); // exclusive
    expect(b.period?.id).toBe('a');
  });

  it('falls back to the calendar month when no period belongs to it', () => {
    const b = monthBounds('2026-10', periods);
    expect(ymd(b.start)).toBe('2026-10-1');
    expect(ymd(b.end)).toBe('2026-11-1');
    expect(b.period).toBeUndefined();
  });
});

describe('cashOnHand with spends dated ahead', () => {
  it('discounts a spend registered for a coming day right away', () => {
    const salaries = [{ date: d(2026, 10, 30), amount: 5_000_000 }];
    const spends = [{ date: d(2026, 10, 31), amount: 1_000_000 }];
    expect(cashOnHand(salaries, [], [], d(2026, 10, 30), spends)).toBe(4_000_000);
  });
});

describe('periodEntries', () => {
  const fe = (id: string, paymentDay: number, estimatedAmount: number) => ({
    id, concept: id, paymentDay, estimatedAmount, frequency: 'fijo' as const, startMonth: '2026-10',
  });
  const bounds = { start: d(2026, 10, 30), end: d(2026, 11, 30) }; // 30 Oct – 29 Nov

  it('takes what falls inside the pay period across both months and leaves out the rest', () => {
    const list = periodEntries([fe('A', 31, 100), fe('B', 1, 200), fe('C', 30, 300)], '2026-11', bounds, new Map(), d(2026, 11, 5));
    // A (31 Oct) and C (30 Oct) are in; B (1 Nov) brings its unpaid October with it; the 30 Nov ones are out
    expect(list.map((e) => e.fe.id).sort()).toEqual(['A', 'B', 'C']);
    expect(list.reduce((s, e) => s + e.total, 0)).toBe(100 + 300 + 400);
  });

  it('does not count an unpaid occurrence twice when a later entry folds it in as arrears', () => {
    const list = periodEntries([fe('A', 31, 100), fe('A2', 1, 50)], '2026-11', bounds, new Map(), d(2026, 11, 20));
    const lines = list.flatMap((e) => e.owed.map((l) => `${e.fe.id}|${l.occMonth}`));
    expect(new Set(lines).size).toBe(lines.length);
  });
});

describe('monthBounds with the pay schedule', () => {
  // salary on the last business day: Fri 30 Oct, Mon 30 Nov, Thu 31 Dec
  const schedule: PaySchedule = { rules: [{ kind: 'last-business-day', amount: 2_895_169 }], weekendAdjust: 'before' };
  const periods = buildSalaryPeriods([{ id: 's', date: new Date(2026, 9, 30), amount: 2_895_169 }], schedule);

  it('keeps the confirmed period for its own month', () => {
    const b = monthBounds('2026-11', periods, schedule);
    expect([b.start.getDate(), b.start.getMonth()]).toEqual([30, 9]);
    expect(b.end.getTime()).toBe(new Date(2026, 10, 30).getTime()); // exclusive: the 30 Nov belongs to the next period
  });

  it('predicts the next month from the schedule, so a payment due on the 30th shows there', () => {
    const b = monthBounds('2026-12', periods, schedule);
    expect(b.start.getTime()).toBe(new Date(2026, 10, 30).getTime());
    expect(b.end.getTime()).toBe(new Date(2026, 11, 31).getTime());
    expect(b.period).toBeUndefined(); // not confirmed
    // the calendar fallback would have started on 1 Dec and left the 30 Nov out
    expect(monthBounds('2026-12', periods).start.getTime()).toBe(new Date(2026, 11, 1).getTime());
  });
});

describe('periods counted by calendar month', () => {
  const rent = { id: 'rent', concept: 'Arriendo', estimatedAmount: 500_000, paymentDay: 5, frequency: 'fijo' as const, startMonth: '2026-10' };
  const bill = { id: 'bill', concept: 'Cuota', estimatedAmount: 300_000, paymentDay: 30, frequency: 'fijo' as const, startMonth: '2026-10' };
  const paidOn20 = [
    { id: 'a', date: new Date(2026, 9, 20), amount: 2_000_000 },
    { id: 'b', date: new Date(2026, 10, 20), amount: 2_000_000 },
  ];
  const today = new Date(2026, 10, 25); // 25 Nov

  it('is salary mode unless the user chose calendar', () => {
    expect(periodModeOf(null)).toBe('salary');
    expect(periodModeOf({ rules: [], weekendAdjust: 'before' })).toBe('salary');
    expect(periodModeOf({ rules: [], weekendAdjust: 'before', periodMode: 'calendar' })).toBe('calendar');
  });

  it('builds one period per month up to the current one, whatever day the salary arrives', () => {
    const periods = buildCalendarPeriods(paidOn20, today);
    expect(periods.map((p) => [p.id, p.start.getDate(), p.end.getDate(), p.amount])).toEqual([
      ['cal|2026-10', 1, 1, 2_000_000],
      ['cal|2026-11', 1, 1, 2_000_000],
    ]);
    expect(periodAt(periods, new Date(2026, 10, 30))?.id).toBe('cal|2026-11'); // the 30th is still November
  });

  it('adds the salaries paid inside a month (twice a month)', () => {
    const periods = buildCalendarPeriods([
      { id: 'q1', date: new Date(2026, 10, 15), amount: 1_000_000 },
      { id: 'q2', date: new Date(2026, 10, 30), amount: 1_200_000 },
    ], today);
    expect(periods).toHaveLength(1);
    expect(periods[0].amount).toBe(2_200_000);
  });

  it('a month with no salary yet is still a period that lives on the previous leftover', () => {
    const periods = buildCalendarPeriods([{ id: 'a', date: new Date(2026, 9, 20), amount: 2_000_000 }], new Date(2026, 11, 3));
    expect(periods.map((p) => [p.id, p.amount])).toEqual([['cal|2026-10', 2_000_000], ['cal|2026-11', 0], ['cal|2026-12', 0]]);
  });

  it('charges each expense to the month it falls in and carries what is left from month to month', () => {
    const periods = buildCalendarPeriods(paidOn20, today);
    const ledgers = salaryLedgers(periods, [rent, bill], new Map(), today);
    const oct = ledgers.get('cal|2026-10')!;
    const nov = ledgers.get('cal|2026-11')!;
    expect(oct.committed).toBe(800_000); // 5 Oct + 30 Oct
    expect(oct.remaining).toBe(1_200_000);
    expect(nov.carryIn).toBe(1_200_000);
    expect(nov.committed).toBe(800_000); // 5 Nov + 30 Nov: the 30th belongs to November, not to the next period
    expect(nov.remaining).toBe(1_200_000 + 2_000_000 - 800_000);
  });

  it('a month filter is that calendar month, with no pay schedule needed', () => {
    const periods = buildCalendarPeriods(paidOn20, today);
    const b = monthBounds('2026-11', periods);
    expect([b.start.getMonth(), b.start.getDate(), b.end.getMonth(), b.end.getDate()]).toEqual([10, 1, 11, 1]);
    const future = monthBounds('2027-01', periods, null);
    expect([future.start.getMonth(), future.start.getDate()]).toEqual([0, 1]);
    const entries = periodEntries([rent, bill], '2026-11', b, new Map(), today);
    expect(entries.map((e) => e.due?.getDate())).toEqual([5, 30]);
  });
});
