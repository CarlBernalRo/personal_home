export type ExpenseFrequency = 'fijo' | 'ocasional';

export interface FixedExpense {
  id: string;
  userId: string;
  concept: string;
  estimatedAmount: number;
  paymentDay: number | null;
  category: string;
  /** The amount changes from month to month (e.g. utilities), so the estimate is only a guide. */
  isVariable: boolean;
  notes: string;
  /** 'fijo' is due every month; 'ocasional' is only tracked in months where it was actually paid. */
  frequency: ExpenseFrequency;
  active: boolean;
  /** First month (yyyy-MM) in which the expense is due. Older docs may lack it. */
  startMonth?: string;
  /**
   * The expense is due every this many months (1 = monthly, 2 = every other month, 12 = yearly…).
   * Missing means monthly. Months in between have no occurrence at all.
   */
  everyMonths?: number;
  /** Month (yyyy-MM) of one bill of the current cadence; the others fall every `everyMonths` from it. Missing: `startMonth`. */
  cycleStart?: string | null;
  /**
   * Per-occurrence date moves, keyed by the occurrence's own month (yyyy-MM, the same key
   * payments use). The occurrence is then due on `day` of `month`, which may be another month.
   */
  dueOverrides?: Record<string, DueOverride>;
  /**
   * Past values of the day/amount, so editing the configuration doesn't rewrite closed months:
   * months before `before` use that entry's values; the top-level fields apply from the latest edit on.
   */
  history?: SettingsRevision[];
  /**
   * Months in which the bank debits this expense by itself: on its due date the occurrence is
   * paid automatically. Ranges (not a flag) so switching it off doesn't rewrite what already happened.
   */
  autoDebit?: AutoDebitRange[];
  /**
   * Months in which the expense is switched off (it isn't due, e.g. the last installment was
   * paid). Ranges, so deactivating from a month leaves what already happened untouched and an
   * expense can be reactivated later.
   */
  pauses?: MonthRange[];
  /** A one-off payment the user scheduled for a date (not a recurring or an occasional expense): it exists for a single month. */
  oneTime?: boolean;
  /** Account this expense is paid from: automatic debits take the money from it and it is offered when paying. */
  accountId?: string;
  createdAt: Date;
}

/** A span of months: from `from` (inclusive) to `until` (exclusive); open-ended while `until` is undefined. */
export interface MonthRange {
  from: string;
  until?: string;
}

export interface AutoDebitRange {
  /** First month (yyyy-MM) paid automatically. */
  from: string;
  /** First month that is no longer automatic; open-ended while undefined. */
  until?: string;
}

export interface SettingsRevision {
  /** First month (yyyy-MM) that no longer uses these values. */
  before: string;
  paymentDay: number | null;
  estimatedAmount: number;
  /** Cadence that applied before that month (missing: monthly), with the month its bills were counted from. */
  everyMonths?: number;
  cycleStart?: string | null;
}

export interface DueOverride {
  month: string;
  day: number;
}

export interface FixedExpensePayment {
  id: string;
  fixedExpenseId: string;
  userId: string;
  concept: string;
  paidAmount: number;
  /** Account the money came out of; its balance went down by `paidAmount`. Older payments have none. */
  accountId?: string;
  /** Stored automatic debit (made on its due date by itself); it can't be undone from the payment screen. */
  auto?: boolean;
  month: string;
  paymentDate: Date;
  notes: string;
  /** Screenshot of the payment sent from Telegram (`attachments/{id}`). */
  attachmentId?: string;
  createdAt: Date;
}

export type NewFixedExpense = Omit<FixedExpense, 'id' | 'createdAt'>;
export type NewFixedExpensePayment = Omit<FixedExpensePayment, 'id' | 'createdAt'>;
