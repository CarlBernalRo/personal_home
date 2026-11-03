import type { AutoDebitRange, DueOverride, FixedExpense, FixedExpensePayment, SettingsRevision } from '../types/fixedExpense';

export type FixedStatus = 'paid' | 'overdue' | 'due-soon' | 'pending' | 'upcoming' | 'na';

type ExpenseLike = Pick<FixedExpense, 'paymentDay' | 'frequency'> & {
  startMonth?: string;
  everyMonths?: number;
  cycleStart?: string | null;
  dueOverrides?: Record<string, DueOverride>;
  estimatedAmount?: number;
  history?: SettingsRevision[];
  autoDebit?: AutoDebitRange[];
  pauses?: AutoDebitRange[];
  createdAt?: Date | string | null;
};

const DUE_SOON_DAYS = 3;

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

/** Months from `from` to `to`, inclusive, ascending. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** Due date inside `month`; days beyond month end (30/31 in February) clamp to the last day. */
export function dueDateFor(paymentDay: number | null | undefined, month: string): Date | null {
  if (!paymentDay) return null;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return new Date(y, m - 1, Math.min(paymentDay, lastDay));
}

export function startMonthOf(fe: ExpenseLike, fallback: string): string {
  if (fe.startMonth) return fe.startMonth;
  if (fe.createdAt) {
    const d = fe.createdAt instanceof Date ? fe.createdAt : new Date(fe.createdAt);
    if (!isNaN(d.getTime())) return monthKey(d);
  }
  return fallback;
}

export function getStatus(
  fe: ExpenseLike,
  month: string,
  payment: Pick<FixedExpensePayment, 'paidAmount'> | undefined,
  today: Date,
): FixedStatus {
  if (payment) return 'paid';
  if (fe.frequency === 'ocasional') return 'na';

  const current = monthKey(today);
  if (month < startMonthOf(fe, current)) return 'na';
  if (isPaused(fe, month)) return 'na';
  if (!isDueMonth(fe, month)) return 'na';

  const due = effectiveDue(fe, month);
  if (!due) {
    if (month < current) return 'overdue';
    return month > current ? 'upcoming' : 'pending';
  }

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((due.getTime() - todayStart.getTime()) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= DUE_SOON_DAYS) return 'due-soon';
  return monthKey(due) > current ? 'upcoming' : 'pending';
}

/** Due date of the occurrence keyed `month`, honouring a user move when there is one. */
export function effectiveDue(fe: ExpenseLike, month: string): Date | null {
  const moved = fe.dueOverrides?.[month];
  return moved ? dueDateFor(moved.day, moved.month) : dueDateFor(settingsFor(fe, month).paymentDay, month);
}

/** Day, estimated amount and cadence that applied in `month`, honouring earlier configuration values. */
export function settingsFor(fe: ExpenseLike, month: string): { paymentDay: number | null; estimatedAmount: number; everyMonths?: number; cycleStart?: string | null } {
  const past = [...(fe.history ?? [])]
    .sort((a, b) => a.before.localeCompare(b.before))
    .find((r) => month < r.before);
  const src = past ?? fe;
  // the cadence is only carried when it isn't the default (monthly)
  const cadence = src.everyMonths && src.everyMonths > 1 ? { everyMonths: src.everyMonths, cycleStart: src.cycleStart ?? null } : {};
  return past
    ? { paymentDay: past.paymentDay, estimatedAmount: past.estimatedAmount, ...cadence }
    : { paymentDay: fe.paymentDay, estimatedAmount: fe.estimatedAmount ?? 0, ...cadence };
}

const monthsBetween = (from: string, to: string) => {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

/** Cadence in force in `month`: 1 for monthly, 2 for every other month, and so on. */
export const cadenceFor = (fe: ExpenseLike, month: string): number => settingsFor(fe, month).everyMonths ?? 1;

/**
 * Does the expense have an occurrence in `month`? A monthly one always does; one that is paid every N
 * months only in the months counted from its first bill (`cycleStart`, or the month it starts in).
 */
export function isDueMonth(fe: ExpenseLike, month: string): boolean {
  const { everyMonths, cycleStart } = settingsFor(fe, month);
  if (!everyMonths || everyMonths <= 1) return true;
  const anchor = cycleStart || startMonthOf(fe, month);
  return (((monthsBetween(anchor, month) % everyMonths) + everyMonths) % everyMonths) === 0;
}

/** The expense's monthly equivalent: what it costs per month on average (a bill of 120.000 every 2 months is 60.000). */
export const monthlyEquivalent = (fe: ExpenseLike, month: string): number => amountFor(fe, month) / cadenceFor(fe, month);

export const amountFor = (fe: ExpenseLike, month: string) => settingsFor(fe, month).estimatedAmount;

/**
 * First month an edit of day/amount may take effect: the current month, unless that month's
 * payment is already settled or overdue (then it is history too), in which case the next one.
 */
export function revisionStart(
  fe: ExpenseLike & { id: string },
  payments: Map<string, { paidAmount: number }>,
  today: Date,
): string {
  const current = monthKey(today);
  const status = getStatus(fe, current, payments.get(paymentKey(fe.id, current)), today);
  return status === 'paid' || status === 'overdue' ? shiftMonth(current, 1) : current;
}

/**
 * First month a change of frequency (or of the month its bills are counted from) takes effect. Unlike a
 * change of day or amount, it applies from the current month even when that month's bill is overdue and
 * unpaid: correcting a wrongly set cycle must also take away the bill it wrongly created. Only a bill
 * already paid keeps the old cycle, and then the change starts next month.
 */
export function cadenceRevisionStart(
  fe: ExpenseLike & { id: string },
  payments: Map<string, { paidAmount: number }>,
  today: Date,
): string {
  const current = monthKey(today);
  return payments.has(paymentKey(fe.id, current)) ? shiftMonth(current, 1) : current;
}

/** History after changing the config from `effectiveFrom`; earlier months keep what applied to them. */
export function reviseHistory(fe: ExpenseLike, effectiveFrom: string): SettingsRevision[] {
  const kept = (fe.history ?? []).filter((r) => r.before < effectiveFrom);
  return [...kept, { before: effectiveFrom, ...settingsFor(fe, effectiveFrom) }];
}

/**
 * Occurrences whose effective due date falls in `month`. A moved occurrence belongs to the
 * month it was moved to, so `occMonth` (the payment key) can differ from `month`.
 */
export function occurrencesInMonth<E extends ExpenseLike>(
  expenses: E[],
  month: string,
  span = 12,
): { fe: E; occMonth: string; due: Date }[] {
  const out: { fe: E; occMonth: string; due: Date }[] = [];
  for (const fe of expenses) {
    for (const occMonth of monthRange(shiftMonth(month, -span), shiftMonth(month, span))) {
      if (!isDueMonth(fe, occMonth)) continue;
      const due = effectiveDue(fe, occMonth);
      if (due && monthKey(due) === month) out.push({ fe, occMonth, due });
    }
  }
  return out;
}

/**
 * Unpaid occurrences from earlier months that are still owed when looking at `month`.
 * What counts is whether the occurrence is already overdue (its due date has passed unpaid):
 * an October payment due on the 1st that is still pending on the 30th weighs on November, while
 * November's own payment doesn't weigh on December until its due date has passed.
 * Overdue occurrences pile up until paid. Past months keep showing their own unpaid items as
 * overdue in their own month.
 * `occMonth` is the original month, which is also the payment key.
 */
export function carriedOver<E extends ExpenseLike & { id: string }>(
  expenses: E[],
  month: string,
  payments: Map<string, Pick<FixedExpensePayment, 'paidAmount'>>,
  today: Date,
  span = 24,
): { fe: E; occMonth: string }[] {
  if (month < monthKey(today)) return [];
  const out: { fe: E; occMonth: string }[] = [];
  for (const fe of expenses) {
    for (const occMonth of monthRange(shiftMonth(month, -span), shiftMonth(month, -1))) {
      const due = effectiveDue(fe, occMonth);
      if ((due ? monthKey(due) : occMonth) >= month) continue; // belongs to `month` or later
      if (getStatus(fe, occMonth, payments.get(paymentKey(fe.id, occMonth)), today) === 'overdue') {
        out.push({ fe, occMonth });
      }
    }
  }
  return out.sort((a, b) => a.occMonth.localeCompare(b.occMonth));
}

export interface OwedLine {
  /** Original month of the occurrence; also its payment key. */
  occMonth: string;
  amount: number;
}

/** One expense as shown on its date in a month, with any unpaid earlier months folded in. */
export interface MonthEntry<E> {
  fe: E;
  /** Occurrence that sits on this date (used for moving it and as the payment key when owed). */
  hostMonth: string;
  /** Date it appears on; null when the expense has no day. */
  due: Date | null;
  /** Payment of the host occurrence, if it was paid. */
  payment?: { paidAmount: number; paymentDate?: Date | string; auto?: boolean };
  /** Everything still unpaid: the host (if unpaid) plus earlier overdue months, oldest first. */
  owed: OwedLine[];
  /** Part of `owed` that comes from earlier months. */
  arrears: OwedLine[];
  /** Total still to pay (sum of `owed`). */
  total: number;
  status: FixedStatus;
}

/**
 * What to show for `month`: one entry per expense occurrence due that month. Unpaid earlier
 * months (see carriedOver) are folded into the same expense's entry so the date shows one
 * combined amount to pay. Without an occurrence to host them, they get their own entry.
 */
export function monthEntries<E extends ExpenseLike & { id: string; estimatedAmount: number }>(
  expenses: E[],
  month: string,
  payments: Map<string, { paidAmount: number }>,
  today: Date,
): MonthEntry<E>[] {
  const line = (fe: E, occMonth: string): OwedLine => ({ occMonth, amount: amountFor(fe, occMonth) });
  const pay = (fe: E, occMonth: string) => payments.get(paymentKey(fe.id, occMonth));

  const arrearsByExpense = new Map<string, { fe: E; lines: OwedLine[] }>();
  for (const { fe, occMonth } of carriedOver(expenses, month, payments, today)) {
    const entry = arrearsByExpense.get(fe.id) ?? { fe, lines: [] };
    entry.lines.push(line(fe, occMonth));
    arrearsByExpense.set(fe.id, entry);
  }

  const hosts: { fe: E; hostMonth: string; due: Date | null }[] = [
    ...occurrencesInMonth(expenses, month).map(({ fe, occMonth, due }) => ({ fe, hostMonth: occMonth, due: due as Date | null })),
    ...expenses.filter((fe) => !effectiveDue(fe, month)).map((fe) => ({ fe, hostMonth: month, due: null as Date | null })),
  ];

  const entries: MonthEntry<E>[] = [];
  for (const h of hosts) {
    const payment = pay(h.fe, h.hostMonth);
    const status = getStatus(h.fe, h.hostMonth, payment, today);
    if (status === 'na') continue;

    // only the first host of an expense takes its arrears
    const taken = arrearsByExpense.get(h.fe.id);
    arrearsByExpense.delete(h.fe.id);
    const arrears = taken?.lines ?? [];
    const owed = [...arrears, ...(payment ? [] : [line(h.fe, h.hostMonth)])];
    const hasOwed = owed.length > 0;
    entries.push({
      fe: h.fe,
      hostMonth: h.hostMonth,
      due: h.due,
      payment,
      owed: hasOwed ? owed : [],
      arrears,
      total: owed.reduce((sum, l) => sum + l.amount, 0),
      status: arrears.length > 0 ? 'overdue' : status,
    });
  }

  // Arrears of expenses with nothing due this month: show them on today (or the 1st).
  for (const { fe, lines } of arrearsByExpense.values()) {
    const isCurrent = month === monthKey(today);
    const [y, m] = month.split('-').map(Number);
    entries.push({
      fe,
      hostMonth: lines[0].occMonth,
      due: isCurrent ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : new Date(y, m - 1, 1),
      owed: lines,
      arrears: lines.slice(1),
      total: lines.reduce((sum, l) => sum + l.amount, 0),
      status: 'overdue',
    });
  }

  return entries;
}

/**
 * Payments indexed by `${fixedExpenseId}|${month}`. If an occurrence somehow has several payment
 * records, the earliest one is kept: it is the original, and later copies must not shift the
 * date money left the account.
 */
export function indexPayments<P extends Pick<FixedExpensePayment, 'fixedExpenseId' | 'month'> & { paymentDate?: Date | string }>(
  payments: P[],
): Map<string, P> {
  const time = (p: P) => (p.paymentDate ? new Date(p.paymentDate).getTime() : NaN);
  const map = new Map<string, P>();
  for (const p of payments) {
    const key = `${p.fixedExpenseId}|${p.month}`;
    const existing = map.get(key);
    // keep the earlier one; without comparable dates the later record wins, as before
    if (existing && time(existing) <= time(p)) continue;
    map.set(key, p);
  }
  return map;
}

export function paymentKey(fixedExpenseId: string, month: string): string {
  return `${fixedExpenseId}|${month}`;
}

// ── Automatic debit ──────────────────────────────────────────────────────────

/** Is the occurrence of `occMonth` debited automatically by the bank? */
export function isAutoDebit(fe: ExpenseLike, occMonth: string): boolean {
  return (fe.autoDebit ?? []).some((r) => occMonth >= r.from && (!r.until || occMonth < r.until));
}

/** Payment generated for an automatic debit (it is not stored; `auto` tells it apart). */
export interface AutoPayment {
  id: string;
  fixedExpenseId: string;
  userId?: string;
  concept?: string;
  paidAmount: number;
  month: string;
  paymentDate: Date;
  auto: true;
}

/**
 * Adds, to the real payments, the ones the bank made by itself: every automatic-debit occurrence
 * whose due date has arrived (today included) and that has no payment registered yet.
 */
export function withAutoPayments<P extends { fixedExpenseId: string; month: string }>(
  expenses: (ExpenseLike & { id: string; concept?: string; userId?: string })[],
  payments: P[],
  today: Date,
): (P | AutoPayment)[] {
  const have = new Set(payments.map((p) => `${p.fixedExpenseId}|${p.month}`));
  const out: (P | AutoPayment)[] = [...payments];
  const current = monthKey(today);
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  for (const fe of expenses) {
    if (!fe.autoDebit?.length || fe.frequency === 'ocasional') continue;
    const first = [startMonthOf(fe, current), ...fe.autoDebit.map((r) => r.from)].sort().pop()!;
    // one month ahead: a payment moved to an earlier date can already be due
    for (const occMonth of monthRange(first, shiftMonth(current, 1))) {
      if (!isAutoDebit(fe, occMonth) || isPaused(fe, occMonth) || !isDueMonth(fe, occMonth) || have.has(`${fe.id}|${occMonth}`)) continue;
      const due = effectiveDue(fe, occMonth);
      if (!due || due > todayEnd) continue;
      out.push({
        id: `auto|${fe.id}|${occMonth}`,
        fixedExpenseId: fe.id,
        userId: fe.userId,
        concept: fe.concept,
        paidAmount: amountFor(fe, occMonth),
        month: occMonth,
        paymentDate: due,
        auto: true,
      });
    }
  }
  return out;
}

/** An automatic debit that is due and must be stored as a real payment, with the account it comes out of. */
export interface PlannedAutoPayment {
  /** Fixed id of this occurrence (per expense and month): storing it twice is impossible. */
  docId: string;
  fixedExpenseId: string;
  userId: string;
  concept: string;
  paidAmount: number;
  month: string;
  paymentDate: Date;
  accountId: string;
}

/**
 * The automatic debits of one user that have to be stored as real payments right now: every one the bank
 * made by itself (see withAutoPayments) that has an account to come out of — the one set on the expense, else
 * the default one — and that fell due after that account was created (the ones before are already inside its
 * opening balance). Used by the app and by the daily server job, so both decide the same.
 */
export function planAutoPayments(
  expenses: (ExpenseLike & { id: string; concept?: string; userId?: string })[],
  payments: { fixedExpenseId: string; month: string }[],
  accounts: { id: string; isDefault?: boolean; createdAt?: Date | null }[],
  today: Date,
  userId: string,
): PlannedAutoPayment[] {
  const out: PlannedAutoPayment[] = [];
  for (const p of withAutoPayments(expenses, payments, today)) {
    if (!('auto' in p) || p.auto !== true || !String(p.id).startsWith('auto|')) continue; // only the generated ones
    const fe = expenses.find((e) => e.id === p.fixedExpenseId) as (typeof expenses)[number] & { accountId?: string } | undefined;
    const account = accounts.find((a) => a.id === fe?.accountId) ?? accounts.find((a) => a.isDefault);
    const created = account?.createdAt;
    if (!account || !(created instanceof Date) || isNaN(created.getTime())) continue;
    const endOfCreationDay = new Date(created.getFullYear(), created.getMonth(), created.getDate(), 23, 59, 59, 999);
    if (p.paymentDate.getTime() <= endOfCreationDay.getTime()) continue;
    out.push({
      docId: `auto_${p.fixedExpenseId}_${p.month}`,
      fixedExpenseId: p.fixedExpenseId,
      userId,
      concept: p.concept ?? '',
      paidAmount: p.paidAmount,
      month: p.month,
      paymentDate: p.paymentDate,
      accountId: account.id,
    });
  }
  return out;
}

// ── Activating / deactivating from a month on ────────────────────────────────

type MonthRanges = { from: string; until?: string }[];

/** Is the expense switched off in `month`? (A payment already registered still shows as paid.) */
export function isPaused(item: { pauses?: MonthRanges }, month: string): boolean {
  return (item.pauses ?? []).some((r) => month >= r.from && (!r.until || month < r.until));
}

/** The open-ended range, if the item is (or will be) switched off with no end. */
export const openRange = (ranges: MonthRanges | undefined) => (ranges ?? []).find((r) => !r.until);

/**
 * Opens a range at `from` (enable=true) or closes the open ones there (enable=false), dropping
 * any that would end up empty. Months before `from` are never touched.
 */
export function toggleRange(ranges: MonthRanges, enable: boolean, from: string): MonthRanges {
  if (enable) return openRange(ranges) ? ranges : [...ranges, { from }];
  return ranges
    .map((r) => (r.until ? r : { ...r, until: from }))
    .filter((r) => !r.until || r.until > r.from);
}
