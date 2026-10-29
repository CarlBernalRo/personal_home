export const PERSONAL_CATEGORIES = [
  { id: 'alimentacion',    label: 'Alimentación',     icon: '🍔', color: '#f97316' },
  { id: 'transporte',      label: 'Transporte',        icon: '🚗', color: '#3b82f6' },
  { id: 'salud',           label: 'Salud',             icon: '🏥', color: '#22c55e' },
  { id: 'entretenimiento', label: 'Entretenimiento',   icon: '🎬', color: '#a855f7' },
  { id: 'ropa',            label: 'Ropa',              icon: '👕', color: '#ec4899' },
  { id: 'educacion',       label: 'Educación',         icon: '📚', color: '#06b6d4' },
  { id: 'tecnologia',      label: 'Tecnología',        icon: '💻', color: '#6366f1' },
  { id: 'belleza',         label: 'Belleza / Cuidado', icon: '💆', color: '#f43f5e' },
  { id: 'suscripciones',   label: 'Suscripciones',     icon: '📱', color: '#8b5cf6' },
  { id: 'deudas',          label: 'Deudas / Crédito',  icon: '💳', color: '#ef4444' },
  { id: 'otros',           label: 'Otros',             icon: '📦', color: '#6b7280' },
] as const;

export const HOUSEHOLD_CATEGORIES = [
  { id: 'mercado',         label: 'Mercado',           icon: '🛒', color: '#22c55e' },
  { id: 'arriendo',        label: 'Arriendo',          icon: '🏠', color: '#3b82f6' },
  { id: 'servicios',       label: 'Servicios',         icon: '💡', color: '#f59e0b' },
  { id: 'internet',        label: 'Internet / Cable',  icon: '📡', color: '#6366f1' },
  { id: 'aseo',            label: 'Aseo / Limpieza',   icon: '🧹', color: '#10b981' },
  { id: 'mascotas',        label: 'Mascotas',          icon: '🐾', color: '#f97316' },
  { id: 'reparaciones',    label: 'Reparaciones',      icon: '🔧', color: '#64748b' },
  { id: 'salidas',         label: 'Salidas en pareja', icon: '🍽️', color: '#ec4899' },
  { id: 'vacaciones',      label: 'Vacaciones',        icon: '✈️', color: '#0ea5e9' },
  { id: 'otros_hogar',     label: 'Otros',             icon: '📦', color: '#6b7280' },
] as const;

export const FIXED_EXPENSE_CATEGORIES = [
  { id: 'arriendo',        label: 'Arriendo / Hipoteca', icon: '🏠', color: '#3b82f6' },
  { id: 'transporte',      label: 'Transporte',           icon: '🚗', color: '#64748b' },
  { id: 'servicios',       label: 'Servicios públicos',   icon: '💡', color: '#f59e0b' },
  { id: 'suscripciones',   label: 'Suscripciones',        icon: '📱', color: '#8b5cf6' },
  { id: 'salud',           label: 'Salud',                icon: '🏥', color: '#22c55e' },
  { id: 'entretenimiento', label: 'Entretenimiento',      icon: '🎬', color: '#a855f7' },
  { id: 'deudas',          label: 'Deudas / Crédito',     icon: '💳', color: '#ef4444' },
  { id: 'ahorro',          label: 'Ahorro',               icon: '💰', color: '#10b981' },
  { id: 'otros',           label: 'Otros',                icon: '📦', color: '#6b7280' },
] as const;

export const HOUSEHOLD_DEBT_CATEGORIES = HOUSEHOLD_CATEGORIES;

export type PersonalCategoryId = typeof PERSONAL_CATEGORIES[number]['id'];
export type HouseholdCategoryId = typeof HOUSEHOLD_CATEGORIES[number]['id'];
export type FixedExpenseCategoryId = typeof FIXED_EXPENSE_CATEGORIES[number]['id'];
