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
  createdAt: Date;
}

export type NewExpense = Omit<Expense, 'id' | 'createdAt'>;
