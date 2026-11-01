export type WeekendAdjust = 'before' | 'after' | 'none';

/** One payment per month: a fixed day of the month, or the last business day (Mon–Fri) of it. */
export type PayRule =
  | { kind: 'day'; day: number; amount: number }
  | { kind: 'last-business-day'; amount: number };

export interface PaySchedule {
  /** One rule per payment: a single rule is a monthly salary, two is a biweekly (quincena) one. */
  rules: PayRule[];
  /** Where a fixed day that falls on a weekend moves: back to Friday, forward to Monday, or stays. */
  weekendAdjust: WeekendAdjust;
  /** Account where the salary is deposited when it is confirmed. */
  accountId?: string;
}
