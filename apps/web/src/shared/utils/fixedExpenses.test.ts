import { describe, it, expect } from 'vitest';
import { isPaused, toggleRange, isAutoDebit, withAutoPayments, amountFor, indexPayments, carriedOver, reviseHistory, revisionStart, monthEntries, dueDateFor, effectiveDue, getStatus, monthRange, occurrencesInMonth, shiftMonth, isDueMonth, cadenceFor, monthlyEquivalent, cadenceRevisionStart, planAutoPayments } from './fixedExpenses';

const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const fe = (over: Record<string, unknown> = {}) => ({
  paymentDay: 15,
  frequency: 'fijo' as const,
  startMonth: '2026-01',
  ...over,
});

describe('month helpers', () => {
  it('shifts across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('builds an inclusive range', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('dueDateFor', () => {
  it('clamps day 30 to the end of February', () => {
    expect(dueDateFor(30, '2026-02')?.getDate()).toBe(28);
  });

  it('returns null without a payment day', () => {
    expect(dueDateFor(null, '2026-02')).toBeNull();
  });
});

describe('getStatus', () => {
  const today = new Date(2026, 9, 10); // 10 Oct 2026

  it('is paid whenever a payment exists', () => {
    expect(getStatus(fe(), '2026-10', { paidAmount: 1 }, today)).toBe('paid');
  });

  it('is overdue for unpaid past months', () => {
    expect(getStatus(fe(), '2026-09', undefined, today)).toBe('overdue');
  });

  it('is not applicable before the start month', () => {
    expect(getStatus(fe({ startMonth: '2026-10' }), '2026-09', undefined, today)).toBe('na');
  });

  it('is upcoming for future months', () => {
    expect(getStatus(fe(), '2026-11', undefined, today)).toBe('upcoming');
  });

  it('flags due-soon within 3 days and pending beyond', () => {
    expect(getStatus(fe({ paymentDay: 12 }), '2026-10', undefined, today)).toBe('due-soon');
    expect(getStatus(fe({ paymentDay: 20 }), '2026-10', undefined, today)).toBe('pending');
  });

  it('flags overdue once the due day has passed this month', () => {
    expect(getStatus(fe({ paymentDay: 9 }), '2026-10', undefined, today)).toBe('overdue');
  });

  it('ignores unpaid ocasional expenses', () => {
    expect(getStatus(fe({ frequency: 'ocasional' }), '2026-09', undefined, today)).toBe('na');
  });
});

describe('moved occurrences', () => {
  const today = new Date(2026, 9, 10);
  const moved = fe({ paymentDay: 5, dueOverrides: { '2026-10': { month: '2026-11', day: 20 } } });

  it('uses the override as the effective due date', () => {
    const d = effectiveDue(moved, '2026-10');
    expect([d?.getMonth(), d?.getDate()]).toEqual([10, 20]);
  });

  it('is no longer overdue once pushed to a future date', () => {
    expect(getStatus(fe({ paymentDay: 5 }), '2026-10', undefined, today)).toBe('overdue');
    expect(getStatus(moved, '2026-10', undefined, today)).toBe('upcoming');
  });

  it('lists the occurrence under the month it was moved to', () => {
    expect(occurrencesInMonth([moved], '2026-10')).toHaveLength(0);
    const nov = occurrencesInMonth([moved], '2026-11');
    expect(nov.map((o) => o.occMonth)).toContain('2026-10');
    // November still has its own regular occurrence on day 5
    expect(nov).toHaveLength(2);
  });
});

describe('carriedOver', () => {
  const today = new Date(2026, 10, 5); // 5 Nov 2026
  const claude = { id: 'c', ...fe({ paymentDay: 30, startMonth: '2026-10' }) };
  const none = new Map();

  it('brings the previous month unpaid occurrence into this month', () => {
    expect(carriedOver([claude], '2026-11', none, today).map((o) => o.occMonth)).toEqual(['2026-10']);
  });

  it('accumulates every unpaid month, oldest first', () => {
    const dec = new Date(2026, 11, 5);
    expect(carriedOver([claude], '2026-12', none, dec).map((o) => o.occMonth)).toEqual(['2026-10', '2026-11']);
  });

  it('weighs on the next month once overdue, even inside the same month', () => {
    const oct = { id: 'x', estimatedAmount: 100, ...fe({ paymentDay: 1, startMonth: '2026-10' }) };
    const late = new Date(2026, 9, 30); // 30 Oct: the 1 Oct payment is long overdue
    expect(carriedOver([oct], '2026-11', none, late).map((o) => o.occMonth)).toEqual(['2026-10']);
  });

  it('does not weigh on the following month until its own due date has passed', () => {
    const lateNov = new Date(2026, 10, 30); // 30 Nov: Claude is due today, not yet overdue
    expect(carriedOver([claude], '2026-12', none, lateNov).map((o) => o.occMonth)).toEqual(['2026-10']);
    const dec1 = new Date(2026, 11, 1); // the 30 Nov payment is now overdue
    expect(carriedOver([claude], '2026-12', none, dec1).map((o) => o.occMonth)).toEqual(['2026-10', '2026-11']);
  });

  it('drops an occurrence once it is paid', () => {
    const paid = new Map([['c|2026-10', { paidAmount: 1 }]]);
    expect(carriedOver([claude], '2026-11', paid, today)).toEqual([]);
  });

  it('does not carry into past months nor before the start month', () => {
    expect(carriedOver([claude], '2026-10', none, today)).toEqual([]);
    expect(carriedOver([{ ...claude, startMonth: '2026-11' }], '2026-11', none, today)).toEqual([]);
  });
});

describe('monthEntries', () => {
  const today = new Date(2026, 10, 5); // 5 Nov 2026
  const claude = { id: 'c', estimatedAmount: 32200, ...fe({ paymentDay: 30, startMonth: '2026-10' }) };

  it('folds last month unpaid amount into the November entry on its own date', () => {
    const [e] = monthEntries([claude], '2026-11', new Map(), today);
    expect(e.due?.getDate()).toBe(30);
    expect(e.owed.map((l) => l.occMonth)).toEqual(['2026-10', '2026-11']);
    expect(e.arrears).toHaveLength(1);
    expect(e.total).toBe(64400);
    expect(e.status).toBe('overdue');
  });

  it('keeps the regular amount and status when nothing is overdue', () => {
    const [e] = monthEntries([claude], '2026-10', new Map(), new Date(2026, 9, 5));
    expect(e.total).toBe(32200);
    expect(e.arrears).toHaveLength(0);
    expect(e.status).toBe('pending');
  });

  it('only owes the arrears when the month itself is already paid', () => {
    const paid = new Map([['c|2026-11', { paidAmount: 32200 }]]);
    const [e] = monthEntries([claude], '2026-11', paid, today);
    expect(e.owed.map((l) => l.occMonth)).toEqual(['2026-10']);
    expect(e.total).toBe(32200);
  });

  it('is fully paid once every owed month is paid', () => {
    const paid = new Map([['c|2026-10', { paidAmount: 1 }], ['c|2026-11', { paidAmount: 1 }]]);
    const [e] = monthEntries([claude], '2026-11', paid, today);
    expect(e.owed).toEqual([]);
    expect(e.status).toBe('paid');
  });
});

describe('editing configuration without rewriting the past', () => {
  const base = { id: 'i', estimatedAmount: 75000, ...fe({ paymentDay: 9, startMonth: '2026-08' }) };
  const today = new Date(2026, 9, 5); // 5 Oct 2026

  it('keeps old day and amount for months before the edit', () => {
    const edited = { ...base, paymentDay: 20, estimatedAmount: 80000, history: reviseHistory(base, '2026-10') };
    expect(effectiveDue(edited, '2026-09')?.getDate()).toBe(9);
    expect(amountFor(edited, '2026-09')).toBe(75000);
    expect(effectiveDue(edited, '2026-10')?.getDate()).toBe(20);
    expect(amountFor(edited, '2026-11')).toBe(80000);
  });

  it('chains several edits', () => {
    const e1 = { ...base, paymentDay: 20, history: reviseHistory(base, '2026-10') };
    const e2 = { ...e1, paymentDay: 25, history: reviseHistory(e1, '2026-12') };
    expect(['2026-09', '2026-10', '2026-11', '2026-12'].map((m) => effectiveDue(e2, m)?.getDate())).toEqual([9, 20, 20, 25]);
  });

  it('an edit scheduled for later is replaced by a new one starting earlier', () => {
    const later = { ...base, paymentDay: 20, history: reviseHistory(base, '2026-11') };
    const earlier = { ...later, paymentDay: 28, history: reviseHistory(later, '2026-10') };
    expect(effectiveDue(earlier, '2026-09')?.getDate()).toBe(9);
    expect(effectiveDue(earlier, '2026-10')?.getDate()).toBe(28);
  });

  it('starts this month unless it is already paid or overdue', () => {
    expect(revisionStart(base, new Map(), today)).toBe('2026-10'); // due 9 Oct, still ahead on the 5th
    expect(revisionStart({ ...base, paymentDay: 1 }, new Map(), today)).toBe('2026-11'); // 1 Oct already overdue
    expect(revisionStart(base, new Map([['i|2026-10', { paidAmount: 1 }]]), today)).toBe('2026-11'); // paid
  });
});

describe('indexPayments', () => {
  const pay = (id: string, date: Date) => ({ id, fixedExpenseId: 'f', month: '2026-10', paymentDate: date, paidAmount: 1 });

  it('keeps the earliest payment when an occurrence has duplicates', () => {
    const index = indexPayments([pay('late', new Date(2026, 9, 30)), pay('orig', new Date(2026, 9, 13))]);
    expect(index.get('f|2026-10')?.id).toBe('orig');
    const reversed = indexPayments([pay('orig', new Date(2026, 9, 13)), pay('late', new Date(2026, 9, 30))]);
    expect(reversed.get('f|2026-10')?.id).toBe('orig');
  });
});

describe('automatic debit', () => {
  const auto = { id: 'a', concept: 'Netflix', estimatedAmount: 30_000, ...fe({ paymentDay: 10, startMonth: '2026-08', autoDebit: [{ from: '2026-10' }] }) };

  it('is automatic only inside its ranges', () => {
    expect(isAutoDebit(auto, '2026-09')).toBe(false);
    expect(isAutoDebit(auto, '2026-10')).toBe(true);
    expect(isAutoDebit({ ...auto, autoDebit: [{ from: '2026-10', until: '2026-12' }] }, '2026-12')).toBe(false);
  });

  it('pays on the due date, not before', () => {
    const before = withAutoPayments([auto], [], new Date(2026, 9, 9));
    expect(before).toHaveLength(0);
    const onDay = withAutoPayments([auto], [], new Date(2026, 9, 10));
    expect(onDay.map((p) => p.month)).toEqual(['2026-10']);
    expect(onDay[0]).toMatchObject({ paidAmount: 30_000, auto: true });
    expect(ymd(onDay[0].paymentDate as Date)).toBe('2026-10-10');
  });

  it('does not rewrite months before the range and keeps one payment per month', () => {
    const real = [{ fixedExpenseId: 'a', month: '2026-10', paidAmount: 31_000, paymentDate: new Date(2026, 9, 11) }];
    const out = withAutoPayments([auto], real, new Date(2026, 10, 20));
    expect(out.map((p) => p.month)).toEqual(['2026-10', '2026-11']); // Oct stays the real one
    expect(out[0]).toBe(real[0]);
  });

  it('leaves manual expenses alone', () => {
    expect(withAutoPayments([{ ...auto, autoDebit: undefined }], [], new Date(2026, 10, 20))).toHaveLength(0);
  });
});

describe('activating and deactivating from a month', () => {
  const card = { id: 'c', estimatedAmount: 150_000, ...fe({ paymentDay: 19, startMonth: '2026-06' }), pauses: [{ from: '2026-12' }] as { from: string; until?: string }[] };
  const today = new Date(2026, 10, 25);

  it('is switched off only from the chosen month on', () => {
    expect(isPaused(card, '2026-11')).toBe(false);
    expect(isPaused(card, '2026-12')).toBe(true);
    expect(isPaused(card, '2027-03')).toBe(true);
  });

  it('keeps the months before the pause as they were', () => {
    expect(getStatus(card, '2026-11', undefined, today)).toBe('overdue'); // 19 Nov unpaid, still counts
    expect(getStatus(card, '2026-12', undefined, today)).toBe('na');
  });

  it('a payment registered in a paused month still shows as paid', () => {
    expect(getStatus(card, '2026-12', { paidAmount: 1 }, today)).toBe('paid');
  });

  it('reactivating from a month closes the pause there', () => {
    const back = toggleRange(card.pauses, false, '2027-02');
    expect(back).toEqual([{ from: '2026-12', until: '2027-02' }]);
    expect(isPaused({ pauses: back }, '2027-01')).toBe(true);
    expect(isPaused({ pauses: back }, '2027-02')).toBe(false);
  });

  it('cancelling a pause that has not started yet removes it', () => {
    expect(toggleRange([{ from: '2026-12' }], false, '2026-12')).toEqual([]);
    expect(toggleRange([{ from: '2026-12' }], false, '2026-11')).toEqual([]);
  });

  it('does not open a second range while one is open', () => {
    expect(toggleRange([{ from: '2026-12' }], true, '2027-01')).toEqual([{ from: '2026-12' }]);
  });

  it('automatic debits are not generated in paused months', () => {
    const auto = { ...card, autoDebit: [{ from: '2026-06' }] };
    const out = withAutoPayments([auto], [], new Date(2026, 11, 25));
    expect(out.map((p) => p.month)).not.toContain('2026-12');
  });
});

describe('expenses paid every few months', () => {
  const water = { id: 'w', estimatedAmount: 120_000, ...fe({ paymentDay: 10, startMonth: '2026-11', everyMonths: 2 }) };
  const today = new Date(2026, 10, 1); // 1 Nov 2026

  it('only has an occurrence in the months counted from its first bill', () => {
    expect(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].map((m) => isDueMonth(water, m))).toEqual([true, false, true, false, true]);
    expect(cadenceFor(water, '2026-12')).toBe(2);
  });

  it('is not part of the months in between (no status, no entry, no occurrence)', () => {
    expect(getStatus(water, '2026-12', undefined, today)).toBe('na');
    expect(monthEntries([water], '2026-12', new Map(), today)).toEqual([]);
    expect(occurrencesInMonth([water], '2026-12')).toEqual([]);
    expect(monthEntries([water], '2026-11', new Map(), today)).toHaveLength(1);
  });

  it('an unpaid bill keeps weighing on the months after it, and the month in between has nothing of its own', () => {
    const dec = monthEntries([water], '2026-12', new Map(), new Date(2026, 11, 20));
    expect(dec).toHaveLength(1); // November's overdue bill, shown as arrears
    expect(dec[0].owed.map((l) => l.occMonth)).toEqual(['2026-11']);
    const jan = monthEntries([water], '2027-01', new Map(), new Date(2027, 0, 5));
    expect(jan[0].owed.map((l) => l.occMonth)).toEqual(['2026-11', '2027-01']); // both bills, 240.000
    expect(jan[0].total).toBe(240_000);
  });

  it('a monthly equivalent spreads the bill over its months', () => {
    expect(monthlyEquivalent(water, '2026-11')).toBe(60_000);
    expect(monthlyEquivalent({ ...water, everyMonths: undefined }, '2026-11')).toBe(120_000);
  });

  it('changing the frequency leaves the months before the change as they were', () => {
    const monthly = { id: 'm', estimatedAmount: 50_000, ...fe({ paymentDay: 5, startMonth: '2026-06' }) };
    const edited = { ...monthly, everyMonths: 2, cycleStart: '2026-11', history: reviseHistory(monthly, '2026-11') };
    // monthly until October, every other month counted from November on
    expect(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'].map((m) => isDueMonth(edited, m))).toEqual([true, true, true, false, true]);
    expect(cadenceFor(edited, '2026-10')).toBe(1);
    expect(cadenceFor(edited, '2026-11')).toBe(2);
  });

  it('an automatic debit is not generated in the months in between', () => {
    const auto = { ...water, autoDebit: [{ from: '2026-11' }] };
    const months = withAutoPayments([auto], [], new Date(2027, 1, 20)).map((p) => p.month);
    expect(months).toEqual(['2026-11', '2027-01']);
  });
});

describe('correcting the frequency of an expense', () => {
  const today = new Date(2026, 10, 1); // 1 Nov 2026
  // created with the first bill in October (the form's default), then corrected to September
  const wrong = { id: 'w', estimatedAmount: 60_000, ...fe({ paymentDay: 15, startMonth: '2026-10', everyMonths: 2, cycleStart: '2026-10' }) };

  it('starts this month even when its bill is unpaid and overdue, so the wrong bill goes away', () => {
    const from = cadenceRevisionStart(wrong, new Map(), new Date(2026, 9, 31)); // 31 Oct: the 15th is past, unpaid
    expect(from).toBe('2026-10');
    const fixed = { ...wrong, cycleStart: '2026-09', startMonth: '2026-11', history: reviseHistory(wrong, from) };
    expect(isDueMonth(fixed, '2026-10')).toBe(false); // October is no longer owed
    expect(isDueMonth(fixed, '2026-11')).toBe(true);
    expect(monthEntries([fixed], '2026-11', new Map(), today)[0].owed.map((l) => l.occMonth)).toEqual(['2026-11']);
  });

  it('a bill already paid this month keeps its cycle: the change starts next month', () => {
    const paid = new Map([['w|2026-10', { paidAmount: 60_000 }]]);
    expect(cadenceRevisionStart(wrong, paid, new Date(2026, 9, 31))).toBe('2026-11');
  });
});

describe('planAutoPayments (what the daily server job stores)', () => {
  const card = { id: 'card', concept: 'Tarjeta', estimatedAmount: 100_000, paymentDay: 10, frequency: 'fijo' as const, startMonth: '2026-09', autoDebit: [{ from: '2026-09' }] };
  const accounts = [{ id: 'main', isDefault: true, createdAt: new Date(2026, 9, 15, 12) }]; // created 15 Oct
  const today = new Date(2026, 10, 12); // 12 Nov

  it('stores only what fell due after the account was created, once per month, with a fixed id', () => {
    const plan = planAutoPayments([card], [], accounts, today, 'u1');
    expect(plan.map((p) => [p.docId, p.paymentDate.getDate(), p.accountId])).toEqual([
      ['auto_card_2026-11', 10, 'main'], // 10 Oct was before the account existed: already in its opening balance
    ]);
    expect(plan[0]).toMatchObject({ userId: 'u1', paidAmount: 100_000, month: '2026-11' });
  });

  it('does nothing for an occurrence that is already stored, so running twice never charges twice', () => {
    const stored = [{ fixedExpenseId: 'card', month: '2026-11' }];
    expect(planAutoPayments([card], stored, accounts, today, 'u1')).toEqual([]);
  });

  it('uses the account set on the expense, else the default one, and skips when there is none', () => {
    const other = { ...card, accountId: 'nequi' };
    const two = [...accounts, { id: 'nequi', createdAt: new Date(2026, 9, 1) }];
    expect(planAutoPayments([other], [], two, today, 'u1').map((p) => p.accountId)).toEqual(['nequi', 'nequi']); // Oct 10 and Nov 10: that account existed
    expect(planAutoPayments([card], [], [], today, 'u1')).toEqual([]);
  });

  it('waits for the due date', () => {
    expect(planAutoPayments([card], [], accounts, new Date(2026, 10, 9), 'u1')).toEqual([]);
    expect(planAutoPayments([card], [], accounts, new Date(2026, 10, 10), 'u1')).toHaveLength(1); // the day it falls due
  });
});

describe('a scheduled (one-off) payment', () => {
  // the university on 20 Nov: a fixed expense that exists for November only
  const uni = { id: 'uni', concept: 'Universidad', estimatedAmount: 2_500_000, paymentDay: 20, frequency: 'fijo' as const, startMonth: '2026-11', pauses: [{ from: '2026-12' }], oneTime: true };
  const today = new Date(2026, 10, 2);

  it('falls due once, on its date, and nowhere else', () => {
    expect(['2026-10', '2026-11', '2026-12', '2027-11'].map((m) => getStatus(uni, m, undefined, today))).toEqual(['na', 'pending', 'na', 'na']);
    const nov = monthEntries([uni], '2026-11', new Map(), today);
    expect(nov).toHaveLength(1);
    expect(nov[0].due?.getDate()).toBe(20);
    expect(nov[0].total).toBe(2_500_000);
    expect(monthEntries([uni], '2026-12', new Map(), today)).toEqual([]);
  });

  it('warns as it nears and stays owed after its date until paid', () => {
    expect(getStatus(uni, '2026-11', undefined, new Date(2026, 10, 18))).toBe('due-soon');
    const late = monthEntries([uni], '2026-12', new Map(), new Date(2026, 11, 5));
    expect(late[0].owed.map((l) => l.occMonth)).toEqual(['2026-11']); // still owed in December
    const paid = new Map([['uni|2026-11', { paidAmount: 2_500_000 }]]);
    expect(monthEntries([uni], '2026-12', paid, new Date(2026, 11, 5))).toEqual([]);
  });
});

describe('planAutoPayments: what it never stores', () => {
  const card = { id: 'card', concept: 'Tarjeta', estimatedAmount: 100_000, paymentDay: 10, frequency: 'fijo' as const, startMonth: '2025-01', autoDebit: [{ from: '2025-01' }] };
  const old = { id: 'main', isDefault: true, createdAt: new Date(2025, 0, 1) };
  const today = new Date(2026, 10, 12); // 12 Nov 2026

  it('only looks at the last two months, not at every month since the debit began', () => {
    const plan = planAutoPayments([card], [], [old], today, 'u1');
    expect(plan.map((p) => p.month)).toEqual(['2026-09', '2026-10', '2026-11']); // nothing before Sept: not walked, not stored
  });

  it('skips what fell due before the balance was last set by hand', () => {
    const matched = { ...old, balanceSetAt: new Date(2026, 9, 20, 9) }; // 20 Oct: the bank balance was typed in
    expect(planAutoPayments([card], [], [matched], today, 'u1').map((p) => p.month)).toEqual(['2026-11']);
  });

  it('a balance set the very day of a debit counts that debit as included', () => {
    const matched = { ...old, balanceSetAt: new Date(2026, 10, 10, 8) }; // 10 Nov, the day it fell due
    expect(planAutoPayments([card], [], [matched], today, 'u1')).toEqual([]);
  });
});
