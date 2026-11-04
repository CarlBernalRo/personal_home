/** What kind of record a movement read from a Telegram screenshot would become once the person confirms it. */
export type PendingKind = 'income' | 'fixed' | 'occasional';

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
  /** Account chosen in Telegram; the person can change it before confirming. */
  accountId?: string;
  comment?: string;
  /** Small copy of the screenshot (`attachments/{id}`); it moves to the real record when the movement is confirmed. */
  attachmentId?: string;
  source: 'telegram';
  status: 'pending' | 'confirmed' | 'discarded';
  /** What the screenshot said, kept for reference (the person may have corrected it). */
  read?: { amount?: number | null; date?: string | null; concept?: string | null; counterparty?: string | null; reference?: string | null; app?: string | null };
  createdAt: Date;
}
