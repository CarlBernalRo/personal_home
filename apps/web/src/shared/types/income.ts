export interface Income {
  id: string;
  userId: string;
  concept: string;
  amount: number;
  month: string;
  date: Date;
  /** 'salary' marks a confirmed pay-day income (`date` is the scheduled pay date); 'extra' a one-off one. */
  kind?: 'salary' | 'extra';
  /** Account the money went into; its balance went up by `amount`. Older incomes have none. */
  accountId?: string;
  /** Screenshot of the income sent from Telegram (`attachments/{id}`). */
  attachmentId?: string;
  createdAt: Date;
}

export type NewIncome = Omit<Income, 'id' | 'createdAt'>;
