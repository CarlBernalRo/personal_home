export type ExpenseFrequency = 'fijo' | 'ocasional';

export interface FixedExpense {
  id: string;
  userId: string;
  concept: string;
  estimatedAmount: number;
  paymentDay: number | null;
  category: string;
  isVariable: boolean;
  notes: string;
  frequency: ExpenseFrequency;
  active: boolean;
  createdAt: Date;
}

export interface FixedExpensePayment {
  id: string;
  fixedExpenseId: string;
  userId: string;
  concept: string;
  paidAmount: number;
  month: string;
  paymentDate: Date;
  notes: string;
  createdAt: Date;
}

export type NewFixedExpense = Omit<FixedExpense, 'id' | 'createdAt'>;
export type NewFixedExpensePayment = Omit<FixedExpensePayment, 'id' | 'createdAt'>;
