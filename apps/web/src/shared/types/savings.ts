export interface SavingsGoal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: Date;
  icon: string;
  color: string;
  createdAt: Date;
}

export type NewSavingsGoal = Omit<SavingsGoal, 'id' | 'createdAt'>;
