export type AccountType = 'checking' | 'savings' | 'cash' | 'investment';

export interface Account {
  id: string;
  userId: string;
  name: string;
  type: AccountType;
  balance: number;
  currency: string;
  color: string;
  /** The account created for people who had payments set up before accounts existed. */
  isDefault?: boolean;
  /**
   * Set on a "cuenta hija" (bolsillo): money that lives inside this parent account but is tracked apart (e.g. what someone
   * else owes you). Its movements are its own; the parent's balance shown is what the bank really holds: its own + its pockets'.
   */
  parentId?: string;
  /** Last time the balance was typed by hand (matched to the bank): debits due before it are already inside it. */
  balanceSetAt?: Date;
  createdAt: Date;
}

export type NewAccount = Omit<Account, 'id' | 'createdAt'>;

/** Money moved from one of the user's accounts to another. */
export interface AccountTransfer {
  id: string;
  userId: string;
  fromId: string;
  toId: string;
  amount: number;
  date: Date;
  note: string;
  createdAt: Date;
}

export type NewAccountTransfer = Omit<AccountTransfer, 'id' | 'createdAt'>;
