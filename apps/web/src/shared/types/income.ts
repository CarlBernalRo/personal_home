export interface Income {
  id: string;
  userId: string;
  concept: string;
  amount: number;
  month: string;
  date: Date;
  createdAt: Date;
}

export type NewIncome = Omit<Income, 'id' | 'createdAt'>;
