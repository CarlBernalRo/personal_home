export type ExpenseType = 'fixed' | 'variable';
export type RecurrenceType = 'monthly' | 'weekly' | 'biweekly' | 'yearly';

export interface Expense {
  id: string;
  userId: string;
  description: string;
  amount: number;
  category: string;
  date: Date;
  type: ExpenseType;
  isRecurring: boolean;
  recurrence?: RecurrenceType;
  notes?: string;
  /** Set when the spend was registered against a variable budget (e.g. gasoline). */
  variableBudgetId?: string;
  /**
   * Registered from Gastos once spends counted toward the balance: it lowers the money on hand and
   * the salary period's leftover. Older records lack it and are history only.
   */
  tracked?: boolean;
  /** Account the money came out of; its balance went down by `amount`. */
  accountId?: string;
  /** Screenshot of the spend sent from Telegram (`attachments/{id}`). */
  attachmentId?: string;
  createdAt: Date;
}

export type NewExpense = Omit<Expense, 'id' | 'createdAt'>;
