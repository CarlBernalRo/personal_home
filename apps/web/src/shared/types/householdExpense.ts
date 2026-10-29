export type SplitMode = 'equal' | 'percentage' | 'fixed';

export interface ExpenseShareInput {
  memberId: string;
  /** Required when splitMode = 'percentage' (0-100, must sum to 100 across all participants). */
  percentage?: number;
  /** Required when splitMode = 'fixed' (COP, must sum to the expense's total amount). */
  fixedAmount?: number;
}

export interface ExpenseShare {
  memberId: string;
  amount: number;
  isPayer: boolean;
}

export interface HouseholdExpense {
  id: string;
  householdId: string;
  description: string;
  amount: number;
  category: string;
  date: Date;
  /** Who actually fronted the money. */
  paidBy: string;
  splitMode: SplitMode;
  /** Resolved shares, one per participant — always sums to `amount`. */
  shares: ExpenseShare[];
  /** Agreed payment deadline. null = open-ended, no date was pactada yet. */
  dueDate: Date | null;
  notes: string;
  registeredBy: string;
  createdAt: Date;
}

export type NewHouseholdExpense = Omit<HouseholdExpense, 'id' | 'createdAt' | 'shares'> & {
  shareInputs: ExpenseShareInput[];
};
