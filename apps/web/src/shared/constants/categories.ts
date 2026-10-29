export const PERSONAL_CATEGORIES = [
  { id: 'alimentacion',  label: 'Alimentación',     icon: '🍽️', color: '#f97316' },
  { id: 'mercado',       label: 'Mercado',           icon: '🛒', color: '#22c55e' },
  { id: 'transporte',    label: 'Transporte',        icon: '🚗', color: '#3b82f6' },
  { id: 'servicios',     label: 'Servicios',         icon: '💡', color: '#f59e0b' },
  { id: 'entretenimiento', label: 'Entretenimiento', icon: '🎬', color: '#a855f7' },
  { id: 'salud',         label: 'Salud',             icon: '🏥', color: '#ec4899' },
  { id: 'otro',          label: 'Otro',              icon: '📦', color: '#6b7280' },
] as const;

export const FIXED_EXPENSE_CATEGORIES = [
  { id: 'arriendo',      label: 'Arriendo / Hipoteca', icon: '🏠', color: '#3b82f6' },
  { id: 'transporte',    label: 'Transporte',          icon: '🚗', color: '#06b6d4' },
  { id: 'servicios',     label: 'Servicios',           icon: '💡', color: '#f59e0b' },
  { id: 'entretenimiento', label: 'Entretenimiento',   icon: '🎬', color: '#a855f7' },
  { id: 'salud',         label: 'Salud',               icon: '🏥', color: '#ec4899' },
  { id: 'ahorro',        label: 'Ahorro',              icon: '🐷', color: '#10b981' },
  { id: 'deuda',         label: 'Deuda / Crédito',     icon: '💳', color: '#ef4444' },
  { id: 'otro',          label: 'Otro',                icon: '📦', color: '#6b7280' },
] as const;

export const HOUSEHOLD_DEBT_CATEGORIES = [
  { id: 'transporte',    label: 'Transporte',   icon: '🚗', color: '#3b82f6' },
  { id: 'salud',         label: 'Salud',        icon: '🏥', color: '#ec4899' },
  { id: 'mascotas',      label: 'Mascotas',     icon: '🐾', color: '#f97316' },
  { id: 'mercado',       label: 'Mercado',      icon: '🛒', color: '#22c55e' },
  { id: 'ropa',          label: 'Ropa',         icon: '👕', color: '#8b5cf6' },
  { id: 'otro',          label: 'Otro',         icon: '📦', color: '#6b7280' },
] as const;

export type PersonalCategoryId    = typeof PERSONAL_CATEGORIES[number]['id'];
export type FixedCategoryId       = typeof FIXED_EXPENSE_CATEGORIES[number]['id'];
export type HouseholdDebtCatId    = typeof HOUSEHOLD_DEBT_CATEGORIES[number]['id'];
