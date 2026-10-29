export interface Household {
  id: string;
  name: string;
  members: string[];
  memberNames: Record<string, string>;
  createdBy: string;
  inviteCode: string;
  createdAt: Date;
}

export interface HouseholdDebt {
  id: string;
  householdId: string;
  concept: string;
  tipo: 'Deuda' | 'Abono';
  amount: number;
  crossedAmount: number;   // total netted via crossings
  debtor: string;
  category: string;
  date: Date;
  registeredBy: string;
  notas: string;
  cruzado: boolean;        // legacy / period-close flag
  createdAt: Date;
}

export type NewHouseholdDebt = Omit<HouseholdDebt, 'id' | 'createdAt' | 'crossedAmount'>;

/** A crossing links two debts from opposing parties and nets a given amount from both */
export interface HouseholdCrossing {
  id: string;
  householdId: string;
  debt1Id: string;
  debt2Id: string;
  amount: number;
  initiatedBy: string;    // UID
  notes: string;
  createdAt: Date;
}

export type NewHouseholdCrossing = Omit<HouseholdCrossing, 'id' | 'createdAt'>;
