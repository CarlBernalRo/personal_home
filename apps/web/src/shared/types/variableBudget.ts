/** A recurring expense with no fixed day or amount (e.g. gasoline): an approximate amount per salary period. */
export interface VariableBudget {
  id: string;
  concept: string;
  /** Category used when a spend is registered (same ids as the personal expenses). */
  category: string;
  /** Approximate amount per salary period; it renews with every confirmed salary. */
  amount: number;
  /** Usual day of the month it is paid, for the ones that have one (a reminder, not a due date). */
  paymentDay?: number | null;
  active: boolean;
  notes?: string;
  /** Account its spends usually come out of (offered when registering one). */
  accountId?: string;
  /**
   * 'household-debt': the amount isn't typed in, it is what the user owes in their households
   * (and the abonos they pay there are this expense's spends).
   */
  source?: 'household-debt';
  /** For a household-debt budget: the households it follows. Missing/empty = all the user's households. */
  householdIds?: string[] | null;
  /** Months in which it is switched off (same meaning as for fixed expenses). */
  pauses?: { from: string; until?: string }[];
}

/** One real spend registered against a budget. */
export interface VariableSpend {
  id: string;
  budgetId: string;
  date: Date;
  amount: number;
  concept: string;
  /** Screenshot of the spend (`attachments/{id}`), when it was registered from Telegram. */
  attachmentId?: string;
}

/** What the user still owes on one household debt (after crossings and abonos). */
export interface DebtLine {
  id: string;
  concept: string;
  householdId: string;
  /** Date the debt was registered. */
  date: Date;
  /** Agreed payment date; null when the debt has none. */
  dueDate: Date | null;
  remaining: number;
}

export interface VariableData {
  budgets: VariableBudget[];
  spends: VariableSpend[];
  /** What the user currently owes in their households; the reserve of a household-debt budget. */
  householdOwed?: number;
  /** What the user owes in their households as of a date (debts, abonos and crossings up to it). */
  householdOwedAt?: (date: Date, householdIds?: string[] | null) => number;
  /** The part of that debt that has no agreed date (it is paid on the expense's usual day). */
  householdUndatedOwedAt?: (date: Date, householdIds?: string[] | null) => number;
  /** Pending household debts one by one, so those with an agreed date can sit on that date. */
  householdLines?: DebtLine[];
  /** Household names by id, to say which household each amount comes from. */
  householdNames?: Record<string, string>;
}
