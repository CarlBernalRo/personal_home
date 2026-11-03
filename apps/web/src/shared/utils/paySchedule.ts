import type { PayRule, PaySchedule, PeriodMode, WeekendAdjust } from '../types/paySchedule';
import type { VariableData } from '../types/variableBudget';
import { dueDateFor, getStatus, isPaused, monthEntries, monthKey, monthRange } from './fixedExpenses';
import type { MonthEntry, OwedLine } from './fixedExpenses';

const DAY_MS = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

export function lastBusinessDay(year: number, month0: number): Date {
  const d = new Date(year, month0 + 1, 0);
  while (isWeekend(d)) d.setDate(d.getDate() - 1);
  return d;
}

function adjustWeekend(d: Date, mode: WeekendAdjust): Date {
  if (mode === 'none' || !isWeekend(d)) return d;
  const out = new Date(d);
  const step = mode === 'before' ? -1 : 1;
  while (isWeekend(out)) out.setDate(out.getDate() + step);
  return out;
}

function ruleDate(rule: PayRule, year: number, month0: number, weekend: WeekendAdjust): Date {
  if (rule.kind === 'last-business-day') return lastBusinessDay(year, month0);
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return adjustWeekend(new Date(year, month0, Math.min(rule.day, lastDay)), weekend);
}

export interface PayDate {
  date: Date;
  amount: number;
  ruleIndex: number;
}

/** Scheduled pay dates within [from, to], both inclusive, ascending. */
export function payDatesBetween(schedule: PaySchedule, from: Date, to: Date): PayDate[] {
  const lo = startOfDay(from).getTime();
  const hi = startOfDay(to).getTime();
  const out: PayDate[] = [];
  // weekend shifts can move a date into the neighbouring month, so look one month beyond each side
  for (let cursor = new Date(from.getFullYear(), from.getMonth() - 1, 1);
    cursor <= new Date(to.getFullYear(), to.getMonth() + 1, 1);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
    schedule.rules.forEach((rule, ruleIndex) => {
      const date = ruleDate(rule, cursor.getFullYear(), cursor.getMonth(), schedule.weekendAdjust);
      const t = date.getTime();
      if (t >= lo && t <= hi) out.push({ date, amount: rule.amount, ruleIndex });
    });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Most recent scheduled pay date on or before `today`. */
export function latestPayDate(schedule: PaySchedule, today: Date): PayDate | null {
  const found = payDatesBetween(schedule, new Date(today.getTime() - 70 * DAY_MS), today);
  return found[found.length - 1] ?? null;
}

/** First scheduled pay date strictly after `after`. */
export function nextPayDate(schedule: PaySchedule, after: Date): PayDate | null {
  const from = new Date(startOfDay(after).getTime() + DAY_MS);
  return payDatesBetween(schedule, from, new Date(from.getTime() + 70 * DAY_MS))[0] ?? null;
}

export function isScheduleUsable(schedule: PaySchedule | null | undefined): schedule is PaySchedule {
  return !!schedule && schedule.rules.length > 0;
}

// ── Salary periods ───────────────────────────────────────────────────────────

/** A confirmed salary and the span it has to cover: from its pay date up to the next one. */
export interface SalaryPeriod {
  id: string;
  start: Date;
  /** Exclusive: the next pay date. */
  end: Date;
  amount: number;
}

export function buildSalaryPeriods(
  salaries: { id: string; date: Date; amount: number }[],
  schedule: PaySchedule,
): SalaryPeriod[] {
  const sorted = [...salaries].sort((a, b) => a.date.getTime() - b.date.getTime());
  return sorted.map((s, i) => {
    const start = startOfDay(s.date);
    const scheduled = nextPayDate(schedule, start)?.date;
    const nextConfirmed = sorted[i + 1] ? startOfDay(sorted[i + 1].date) : undefined;
    const end = [scheduled, nextConfirmed].filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? new Date(start.getTime() + 31 * DAY_MS);
    return { id: s.id, start, end, amount: s.amount };
  });
}

/** How the user counts their periods (from pay day to pay day unless they chose calendar months). */
export const periodModeOf = (schedule: PaySchedule | null | undefined): PeriodMode => schedule?.periodMode ?? 'salary';

/**
 * Calendar-month periods: one per month from the first confirmed salary to the current one (or the last
 * salary's month), each holding the salaries confirmed inside it, whatever day they were paid. A month
 * with no salary yet is still a period (it lives on what the previous one left over).
 */
export function buildCalendarPeriods(salaries: { id: string; date: Date; amount: number }[], today: Date = new Date()): SalaryPeriod[] {
  if (salaries.length === 0) return [];
  const sorted = [...salaries].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = sorted[0].date;
  const last = sorted[sorted.length - 1].date;
  const lastMonth = new Date(Math.max(new Date(today.getFullYear(), today.getMonth(), 1).getTime(), new Date(last.getFullYear(), last.getMonth(), 1).getTime()));
  const out: SalaryPeriod[] = [];
  for (let start = new Date(first.getFullYear(), first.getMonth(), 1); start.getTime() <= lastMonth.getTime(); start = new Date(start.getFullYear(), start.getMonth() + 1, 1)) {
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const amount = sorted.filter((s) => s.date.getTime() >= start.getTime() && s.date.getTime() < end.getTime()).reduce((sum, s) => sum + s.amount, 0);
    out.push({ id: `cal|${monthKey(start)}`, start, end, amount });
  }
  return out;
}

/**
 * Span a month filter covers: the salary period that belongs to the month (the one whose last day
 * falls in it, so 30 Oct–29 Nov is November) when there is one, else the calendar month.
 * `end` is exclusive.
 *
 * With the pay `schedule`, a month whose salary isn't confirmed yet still gets the span the schedule
 * predicts (the period after the last confirmed one starts on the pay day that closes it). Without that,
 * a payment due on the first day of the next period (the 30th, with salary paid on the 30th) would fall
 * in neither the confirmed period nor the calendar month, and show nowhere.
 */
export function monthBounds(month: string, periods: SalaryPeriod[], schedule?: PaySchedule | null): { start: Date; end: Date; period?: SalaryPeriod } {
  const period = periods.find((p) => monthKey(new Date(p.end.getTime() - DAY_MS)) === month);
  if (period) return { start: period.start, end: period.end, period };
  const last = [...periods].sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  if (schedule && last) {
    const pays = payDatesBetween(schedule, last.end, new Date(last.end.getFullYear() + 2, last.end.getMonth(), 1));
    for (let i = 0; i + 1 < pays.length; i++) {
      if (monthKey(new Date(pays[i + 1].date.getTime() - DAY_MS)) === month) return { start: pays[i].date, end: pays[i + 1].date };
    }
  }
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

/**
 * The fixed expenses that fall in a span of time (a salary period), across every month it touches, one
 * entry per expense occurrence on its date. An unpaid occurrence appears once: the first (earliest)
 * entry keeps it, and later entries that would fold it in as arrears drop it. Expenses without a day
 * belong to `month`, the month the period is named after.
 */
export function periodEntries<E extends Parameters<typeof monthEntries>[0][number]>(
  expenses: E[],
  month: string,
  bounds: { start: Date; end: Date },
  payments: Map<string, { paidAmount: number }>,
  today: Date,
): MonthEntry<E>[] {
  const within = (d: Date) => d.getTime() >= bounds.start.getTime() && d.getTime() < bounds.end.getTime();
  const months = monthRange(monthKey(bounds.start), monthKey(new Date(bounds.end.getTime() - DAY_MS)));
  const raw = months
    .flatMap((m) => monthEntries(expenses, m, payments, today).filter((e) => (e.due ? within(e.due) : m === month)))
    .sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity));

  const seen = new Set<string>();
  const out: MonthEntry<E>[] = [];
  for (const e of raw) {
    const lines = e.owed.filter((l) => {
      const key = `${e.fe.id}|${l.occMonth}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (lines.length === e.owed.length) {
      out.push(e);
      continue;
    }
    // part of what it owed was already listed by an earlier entry
    if (lines.length === 0 && !e.payment) continue;
    const arrears = e.arrears.filter((a) => lines.some((l) => l.occMonth === a.occMonth));
    out.push({
      ...e,
      owed: lines,
      arrears,
      total: lines.reduce((sum, l) => sum + l.amount, 0),
      status: arrears.length > 0 ? 'overdue' : getStatus(e.fe, e.hostMonth, e.payment, today),
    });
  }
  return out;
}

export function periodAt(periods: SalaryPeriod[], date: Date): SalaryPeriod | undefined {
  const t = startOfDay(date).getTime();
  return periods.find((p) => t >= p.start.getTime() && t < p.end.getTime());
}

/** A one-off income (e.g. someone paid back a debt) that adds to the salary period it falls in. */
export interface ExtraIncome {
  id: string;
  date: Date;
  amount: number;
  concept: string;
}

export const entryKey = (e: Pick<MonthEntry<{ id: string }>, 'fe' | 'hostMonth'>) => `${e.fe.id}|${e.hostMonth}`;

export interface PeriodLedger {
  /** Amount charged to the salary by each entry (keyed by entryKey) and what is left right after it. */
  rows: Map<string, { amount: number; remaining: number }>;
  committed: number;
  /** Extra incomes received during the period. */
  extraTotal: number;
  /** Real spends registered against variable budgets (occasional expenses) in the period. */
  variableSpent: number;
  /** Spends registered from Mis gastos adicionales (tied to no budget) in the period. */
  additionalSpent: number;
  /** Still-unspent part of the variable budgets, held back while the period is open. */
  variableReserved: number;
  /** What the previous period left over (negative if it ran short); counted on top of the salary. */
  carryIn: number;
  remaining: number;
}

/**
 * Runs the period's expenses against its salary (plus what the previous period carried over) in
 * date order. Each owed month is charged once (`seen` tracks it, across periods when shared) even
 * if it shows up folded into several entries, and paid items are charged at what was paid.
 */
export function periodLedger(period: SalaryPeriod, entries: MonthEntry<{ id: string }>[], carryIn = 0, seen = new Set<string>(), extras: ExtraIncome[] = [],
  variable: VariableData = { budgets: [], spends: [] }, periodOpen = false): PeriodLedger {
  const within = (t: number) => t >= period.start.getTime() && t < period.end.getTime();
  const inPeriod = entries.filter((e) => e.due && within(e.due.getTime()));
  const incomes = extras.filter((x) => within(startOfDay(x.date).getTime()));

  // Date order; on the same day an income lands before the expenses so it can cover them
  const spends = variable.spends.filter((x) => within(startOfDay(x.date).getTime()));

  const events = [
    ...incomes.map((x) => ({ t: startOfDay(x.date).getTime(), order: 0, income: x, spend: undefined as number | undefined, additional: false, entry: undefined as MonthEntry<{ id: string }> | undefined })),
    ...spends.map((x) => ({ t: startOfDay(x.date).getTime(), order: 1, income: undefined as ExtraIncome | undefined, spend: x.amount, additional: !x.budgetId, entry: undefined as MonthEntry<{ id: string }> | undefined })),
    ...inPeriod.map((e) => ({ t: e.due!.getTime(), order: 1, income: undefined as ExtraIncome | undefined, spend: undefined as number | undefined, additional: false, entry: e as MonthEntry<{ id: string }> | undefined })),
  ].sort((a, b) => a.t - b.t || a.order - b.order);

  const rows: PeriodLedger['rows'] = new Map();
  let remaining = period.amount + carryIn;
  let committed = 0;
  let extraTotal = 0;
  let variableSpent = 0;
  let additionalSpent = 0;

  for (const ev of events) {
    if (ev.income) {
      extraTotal += ev.income.amount;
      remaining += ev.income.amount;
      continue;
    }
    if (ev.spend !== undefined) {
      if (ev.additional) additionalSpent += ev.spend;
      else variableSpent += ev.spend;
      remaining -= ev.spend;
      continue;
    }
    const e = ev.entry!;
    const charge = (key: string, amount: number) => {
      if (seen.has(key)) return 0;
      seen.add(key);
      return amount;
    };
    const lines: OwedLine[] = e.owed;
    let amount = lines.reduce((sum, l) => sum + charge(`${e.fe.id}|${l.occMonth}`, l.amount), 0);
    if (e.payment && !lines.some((l) => l.occMonth === e.hostMonth)) {
      amount += charge(`${e.fe.id}|${e.hostMonth}`, e.payment.paidAmount);
    }
    committed += amount;
    remaining -= amount;
    rows.set(entryKey(e), { amount, remaining });
  }
  // While the period is open, what is left of each budget is already spoken for
  let variableReserved = 0;
  if (periodOpen) {
    // a period belongs to the month of its last day (30 Oct–29 Nov counts as November)
    const periodMonth = monthKey(new Date(period.end.getTime() - DAY_MS));
    for (const b of variable.budgets.filter((x) => x.active && !isPaused(x, periodMonth))) {
      if (b.source === 'household-debt') {
        // what is owed on the day it gets paid (its usual day inside this period), else right now
        const payDay = b.paymentDay
          ? monthRange(monthKey(period.start), periodMonth)
              .map((m) => dueDateFor(b.paymentDay, m))
              .find((d) => d && d.getTime() >= period.start.getTime() && d.getTime() < period.end.getTime())
          : undefined;
        if (variable.householdLines) {
          // debts with an agreed date weigh on the period they fall due in (or earlier, if overdue)
          const mine = variable.householdLines.filter((l) => !b.householdIds?.length || b.householdIds.includes(l.householdId));
          const dated = mine.filter((l) => l.dueDate && l.dueDate.getTime() < period.end.getTime())
            .reduce((sum, l) => sum + l.remaining, 0);
          const undated = payDay && variable.householdUndatedOwedAt
            ? variable.householdUndatedOwedAt(payDay, b.householdIds)
            : mine.filter((l) => !l.dueDate).reduce((sum, l) => sum + l.remaining, 0);
          variableReserved += Math.max(0, dated) + Math.max(0, undated);
          continue;
        }
        const owed = payDay && variable.householdOwedAt ? variable.householdOwedAt(payDay, b.householdIds) : (variable.householdOwed ?? 0);
        variableReserved += Math.max(0, owed);
        continue;
      }
      const spent = spends.filter((x) => x.budgetId === b.id).reduce((sum, x) => sum + x.amount, 0);
      variableReserved += Math.max(0, b.amount - spent);
    }
  }
  remaining -= variableReserved;

  return { rows, committed, extraTotal, variableSpent, additionalSpent, variableReserved, carryIn, remaining };
}

/** Ledger of one salary period, considering every month the period touches. */
export function ledgerForPeriod<E extends Parameters<typeof monthEntries>[0][number]>(
  period: SalaryPeriod,
  expenses: E[],
  payments: Map<string, { paidAmount: number }>,
  today: Date,
  carryIn = 0,
  seen = new Set<string>(),
  extras: ExtraIncome[] = [],
  variable: VariableData = { budgets: [], spends: [] },
): PeriodLedger {
  const last = new Date(period.end.getTime() - DAY_MS);
  const entries = monthRange(monthKey(period.start), monthKey(last))
    .flatMap((m) => monthEntries(expenses, m, payments, today));
  return periodLedger(
    period, entries as MonthEntry<{ id: string }>[], carryIn, seen, extras, variable,
    today.getTime() < period.end.getTime(), // reserve only while the period is still running
  );
}

/** Ledgers of every period in order, each one starting with the previous period's leftover. */
export function salaryLedgers<E extends Parameters<typeof monthEntries>[0][number]>(
  periods: SalaryPeriod[],
  expenses: E[],
  payments: Map<string, { paidAmount: number }>,
  today: Date,
  extras: ExtraIncome[] = [],
  variable: VariableData = { budgets: [], spends: [] },
): Map<string, PeriodLedger> {
  const out = new Map<string, PeriodLedger>();
  let carry = 0;
  // a month charged to one period is never charged again to a later one
  const seen = new Set<string>();
  for (const p of [...periods].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const ledger = ledgerForPeriod(p, expenses, payments, today, carry, seen, extras, variable);
    out.set(p.id, ledger);
    carry = ledger.remaining;
  }
  return out;
}

/**
 * Money in the account right now: salaries and extra incomes received so far, minus the fixed
 * payments actually made and every spend registered (a spend dated for a coming day counts already). Counting starts at the first confirmed salary (the balance before it
 * isn't known), and null means there is no confirmed salary yet.
 */
export function cashOnHand(
  salaries: { date: Date; amount: number }[],
  extras: ExtraIncome[],
  payments: { paidAmount: number; paymentDate?: Date | string }[],
  today: Date,
  spends: { date: Date; amount: number }[] = [],
): number | null {
  const end = startOfDay(today).getTime() + DAY_MS; // exclusive: includes all of today
  const received = salaries.filter((s) => startOfDay(s.date).getTime() < end);
  if (received.length === 0) return null;
  const start = Math.min(...received.map((s) => startOfDay(s.date).getTime()));

  const within = (d: Date | string | undefined) => {
    if (!d) return false;
    const t = startOfDay(d instanceof Date ? d : new Date(d)).getTime();
    return t >= start && t < end;
  };
  const income = received.reduce((sum, s) => sum + s.amount, 0)
    + extras.filter((x) => within(x.date)).reduce((sum, x) => sum + x.amount, 0);
  // A spend already registered for a later day is set aside right away, like a planned expense
  const spent = payments.filter((p) => within(p.paymentDate)).reduce((sum, p) => sum + p.paidAmount, 0)
    + spends.filter((x) => startOfDay(x.date).getTime() >= start).reduce((sum, x) => sum + x.amount, 0);
  return income - spent;
}
