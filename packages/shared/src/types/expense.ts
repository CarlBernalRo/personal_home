export type ExpenseType = 'fixed' | 'variable';
export type RecurrenceType = 'monthly' | 'weekly' | 'biweekly' | 'yearly';
export type FixedFrequency = 'fijo' | 'ocasional';

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

export interface HouseholdExpense {
  id: string;
  householdId: string;
  paidBy: string;
  description: string;
  amount: number;
  category: string;
  date: Date;
  splitEqually: boolean;
  notes?: string;
  createdAt: Date;
}

export interface FixedExpense {
  id: string;
  userId: string;
  concept: string;
  estimatedAmount: number;
  paymentDay: number | null;
  category: string;
  isVariable: boolean;
  notes: string;
  frequency: FixedFrequency;
  active: boolean;
  createdAt: Date;
}

export interface FixedExpensePayment {
  id: string;
  userId: string;
  fixedExpenseId: string;
  concept: string;
  paidAmount: number;
  month: string;
  paymentDate: Date;
  notes: string;
  createdAt: Date;
}

export interface Income {
  id: string;
  userId: string;
  description: string;
  amount: number;
  month: string;
  date: Date;
  createdAt: Date;
}

export type NewExpense = Omit<Expense, 'id' | 'createdAt'>;
export type NewHouseholdExpense = Omit<HouseholdExpense, 'id' | 'createdAt'>;
export type NewFixedExpense = Omit<FixedExpense, 'id' | 'createdAt'>;
export type NewFixedExpensePayment = Omit<FixedExpensePayment, 'id' | 'createdAt'>;
export type NewIncome = Omit<Income, 'id' | 'createdAt'>;
