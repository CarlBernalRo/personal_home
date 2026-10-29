export type AccountType = 'checking' | 'savings' | 'cash' | 'investment';

export interface Account {
  id: string;
  userId: string;
  name: string;
  type: AccountType;
  balance: number;
  currency: string;
  color: string;
  createdAt: Date;
}

export type NewAccount = Omit<Account, 'id' | 'createdAt'>;
