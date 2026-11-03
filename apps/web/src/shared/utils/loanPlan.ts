export type LoanPlanKind = 'none' | 'single' | 'installments';
export type LoanFrequency = 'monthly' | 'biweekly' | 'weekly';

export interface LoanPlanInput {
  /** Amount lent (COP). */
  amount: number;
  kind: LoanPlanKind;
  /** 'single': the agreed payment date. 'installments': the date of the first one. */
  firstDate?: Date | null;
  /** Number of installments (2 or more) for 'installments'. */
  count?: number;
  frequency?: LoanFrequency;
}

export interface LoanInstallment {
  /** 1-based position, and how many there are. */
  number: number;
  of: number;
  amount: number;
  /** null when no payment date was agreed. */
  dueDate: Date | null;
}

const addMonthsKeepingDay = (d: Date, n: number): Date => {
  // the 31st plus one month is the end of that month, not a jump into the next one
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay));
};

/** Date of the i-th installment (0-based) counted from the first one. */
export function installmentDate(first: Date, i: number, frequency: LoanFrequency): Date {
  if (frequency === 'weekly') return new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7 * i);
  if (frequency === 'biweekly') return new Date(first.getFullYear(), first.getMonth(), first.getDate() + 14 * i);
  return addMonthsKeepingDay(first, i);
}

/**
 * How a loan is paid back: no agreed date (one open debt), a single payment on a date, or several equal
 * installments. The amounts always add up to what was lent: the last installment absorbs the rounding.
 */
export function buildLoanPlan(input: LoanPlanInput): LoanInstallment[] {
  const amount = Math.round(input.amount);
  if (!(amount > 0)) return [];

  if (input.kind === 'installments') {
    const count = Math.max(2, Math.floor(input.count ?? 2));
    const base = Math.floor(amount / count);
    const first = input.firstDate ?? null;
    const frequency = input.frequency ?? 'monthly';
    return Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      of: count,
      amount: i === count - 1 ? amount - base * (count - 1) : base,
      dueDate: first ? installmentDate(first, i, frequency) : null,
    }));
  }

  return [{ number: 1, of: 1, amount, dueDate: input.kind === 'single' ? (input.firstDate ?? null) : null }];
}
