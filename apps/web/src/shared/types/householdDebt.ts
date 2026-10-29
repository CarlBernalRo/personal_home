export type DebtTipo = 'Deuda' | 'Abono';
export type DebtEstado = '' | 'Saldado';

export interface HouseholdDebt {
  id: string;
  householdId: string;
  concept: string;
  tipo: DebtTipo;
  amount: number;
  debtor: string;
  category: string;
  date: Date;
  registeredBy: string;
  estado: DebtEstado;
  saldaId: string | null;
  notas: string;
  cruzado: boolean;
  createdAt: Date;
}

export type NewHouseholdDebt = Omit<HouseholdDebt, 'id' | 'createdAt'>;
