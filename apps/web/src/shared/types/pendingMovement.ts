/** What kind of record a movement read from a Telegram screenshot would become once the person confirms it. */
export type PendingKind = 'income' | 'fixed' | 'occasional' | 'abono' | 'received' | 'shared';

/** How a shared household expense prepared in Telegram is split: `value` is a percentage or an amount, by `mode`. */
export interface PendingSplit {
  mode: 'equal' | 'percentage' | 'fixed';
  shares: { memberId: string; value?: number }[];
}

/**
 * A movement the person prepared in Telegram (from a screenshot) and that is waiting for them to confirm it in the app.
 * Nothing is registered until then: confirming creates the real income / fixed payment / expense.
 */
export interface PendingMovement {
  id: string;
  userId: string;
  kind: PendingKind;
  amount: number;
  date: Date;
  concept: string;
  /** Category of an occasional expense. */
  category?: string;
  /** For a fixed expense: which one, and which of its occurrences (yyyy-MM) the payment is for. */
  fixedExpenseId?: string;
  occMonth?: string;
  /** For an occasional expense that belongs to one of the person's budgets. */
  budgetId?: string;
  /** Tags of an expense of its own (no budget): they go to the expense when it is confirmed. A budget's spend uses the budget's. */
  tagIds?: string[];
  /** An `income` that is the person's salary (confirmed from the payday button in Telegram): becomes `kind: 'salary'`
   * in `incomes`, instead of `'extra'`, so it counts for the salary period and stops the "pending pay day" alert. */
  isSalary?: boolean;
  /** For an abono to a household: which household, whom it pays and (optionally) the one debt it is meant for. */
  householdId?: string;
  creditorId?: string;
  targetDebtId?: string;
  /** For a `received` payment: who of the household (a member or a guest) paid the user. */
  debtorId?: string;
  /** For a `shared` household expense: among whom it is split, who put the money, and the agreed date to pay it. */
  split?: PendingSplit;
  payers?: { memberId: string; amount: number }[];
  dueDate?: Date | null;
  /** A line the bot wrote to explain a household movement in words (who paid, among whom it is split). */
  detail?: string;
  /** Account chosen in Telegram; the person can change it before confirming. */
  accountId?: string;
  comment?: string;
  /** Small copy of the screenshot (`attachments/{id}`); it moves to the real record when the movement is confirmed. */
  attachmentId?: string;
  /** Where it came from: a Telegram screenshot, or money a family member sent (registered once, on their side). */
  source: 'telegram' | 'family';
  /** For a transfer from a family member: who sent it, and their family. */
  fromUid?: string;
  fromName?: string;
  familyId?: string;
  /** A movement from Telegram marked as a transfer with a family member: their side was already sent to them. */
  familyTransfer?: { with: string; name: string; direction: 'in' | 'out'; familyId: string };
  status: 'pending' | 'confirmed' | 'discarded';
  /** What the screenshot said, kept for reference (the person may have corrected it). */
  read?: { amount?: number | null; date?: string | null; concept?: string | null; counterparty?: string | null; reference?: string | null; app?: string | null };
  createdAt: Date;
}
