export type UserRole = 'admin' | 'integrante' | 'user';

export const PERMISSIONS = [
  { key: 'view_households',   label: 'Ver hogares' },
  { key: 'manage_expenses',   label: 'Gestionar gastos adicionales' },
  { key: 'manage_debts',      label: 'Gestionar deudas' },
  { key: 'view_finances',     label: 'Ver finanzas' },
  { key: 'manage_households', label: 'Gestionar hogares' },
  { key: 'manage_users',      label: 'Gestionar usuarios' },
] as const;

export interface AllowedUser {
  id: string;
  email: string;
  name: string;
  active: boolean;
  /** Soft delete: the record is kept but access is revoked and hidden from the default list. */
  deleted?: boolean;
  role?: UserRole;
  permissions?: string[];
  createdAt?: Date;
}
