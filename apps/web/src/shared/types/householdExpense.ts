export type SplitMode = 'equal' | 'percentage' | 'fixed';

export interface ExpenseShareInput {
  memberId: string;
  /** Required when splitMode = 'percentage' (0-100, must sum to 100 across all participants). */
  percentage?: number;
  /** Required when splitMode = 'fixed' (COP, must sum to the expense's total amount). */
  fixedAmount?: number;
}

/** One participant's resolved share, as `resolveExpenseShares` computes it (pure split math, nothing to do with who paid). */
export interface ExpenseShare {
  memberId: string;
  amount: number;
  isPayer: boolean;
}

/** A share as stored on the expense record, enriched with what that participant actually put in (0 if none). */
export interface ExpenseShareRecord {
  memberId: string;
  /** What this participant owes for the expense — always sums to `amount` across every share. */
  amount: number;
  /** What this participant actually put in towards the expense — independent of `amount`. */
  paid: number;
}

export interface ExpensePayerInput {
  memberId: string;
  /** What this person fronted. Every payer's amount must sum to the expense's total. */
  amount: number;
}

export interface ExpenseContribution {
  memberId: string;
  amount: number;
  /**
   * A guest (no account) or whoever registers the expense asserts it about themselves live, so both are
   * 'confirmed' right away. Any other real member's contribution starts 'pending': nothing is owed to them —
   * and no account of theirs is touched, and it doesn't show in their "Mis gastos adicionales" — until they
   * confirm it from the household's pending contributions.
   */
  status: 'confirmed' | 'pending' | 'declined';
  /** Who ends up owing this contributor, and how much — materialized as real debts once (and only once) confirmed. */
  edges: { debtor: string; amount: number }[];
}

export interface HouseholdExpense {
  id: string;
  householdId: string;
  description: string;
  amount: number;
  category: string;
  date: Date;
  splitMode: SplitMode;
  /** Resolved shares, one per participant — always sums to `amount`. */
  shares: ExpenseShareRecord[];
  /** Who fronted money and how much, with their confirmation status. */
  contributions: ExpenseContribution[];
  /** Agreed payment deadline. null = open-ended, no date was pactada yet. */
  dueDate: Date | null;
  notes: string;
  registeredBy: string;
  createdAt: Date;
  /** The receipt (hotel bill, restaurant check…), if one was attached — copied onto every debt this expense generates. */
  attachmentId?: string | null;
}

export type NewHouseholdExpense = Omit<HouseholdExpense, 'id' | 'createdAt' | 'shares' | 'contributions'> & {
  shareInputs: ExpenseShareInput[];
  payers: ExpensePayerInput[];
  /** When `registeredBy` is also a payer, which of their own accounts that money came out of (optional — may stay unlinked). */
  registeredByAccountId?: string | null;
};
