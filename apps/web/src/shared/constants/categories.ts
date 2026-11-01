/**
 * Categories of the money that goes out. 'otro' is always the last one of each list (it is the fallback
 * when a record carries a category that no longer exists).
 */

/** Gastos adicionales y ocasionales (lo que se registra día a día). */
export const PERSONAL_CATEGORIES = [
  { id: 'alimentacion',    label: 'Comidas y restaurantes', icon: 'food',      color: '#f97316' },
  { id: 'mercado',         label: 'Mercado',                icon: 'market',    color: '#52b69a' },
  { id: 'transporte',      label: 'Transporte',             icon: 'transport', color: '#3b82f6' },
  { id: 'combustible',     label: 'Combustible y peajes',   icon: 'fuel',      color: '#0ea5e9' },
  { id: 'vehiculo',        label: 'Mantenimiento del vehículo', icon: 'wrench', color: '#64748b' },
  { id: 'servicios',       label: 'Servicios públicos',     icon: 'services',  color: '#f59e0b' },
  { id: 'comunicaciones',  label: 'Internet y telefonía',   icon: 'wifi',      color: '#14b8a6' },
  { id: 'suscripciones',   label: 'Suscripciones y apps',   icon: 'repeat',    color: '#6366f1' },
  { id: 'entretenimiento', label: 'Entretenimiento',        icon: 'fun',       color: '#a855f7' },
  { id: 'videojuegos',     label: 'Videojuegos',            icon: 'gamepad',   color: '#8b5cf6' },
  { id: 'social',          label: 'Salidas y celebraciones', icon: 'party',    color: '#e879f9' },
  { id: 'salud',           label: 'Salud',                  icon: 'health',    color: '#ec4899' },
  { id: 'cuidado',         label: 'Cuidado personal',       icon: 'sparkles',  color: '#f472b6' },
  { id: 'ropa',            label: 'Ropa y calzado',         icon: 'clothes',   color: '#c084fc' },
  { id: 'tecnologia',      label: 'Tecnología y electrónica', icon: 'laptop',  color: '#38bdf8' },
  { id: 'hogar',           label: 'Hogar y muebles',        icon: 'sofa',      color: '#d97706' },
  { id: 'educacion',       label: 'Educación',              icon: 'edu',       color: '#22c55e' },
  { id: 'mascotas',        label: 'Mascotas',               icon: 'pets',      color: '#fb923c' },
  { id: 'deuda',           label: 'Deudas y tarjetas',      icon: 'debt',      color: '#ef4444' },
  { id: 'transferencias',  label: 'Transferencias a personas', icon: 'swap',   color: '#84cc16' },
  { id: 'efectivo',        label: 'Retiros de efectivo',    icon: 'cash',      color: '#a3a3a3' },
  { id: 'otro',            label: 'Otro',                   icon: 'other',     color: '#6b7280' },
] as const;

/** Gastos fijos (lo que se paga cada mes o cada cierto número de meses). */
export const FIXED_EXPENSE_CATEGORIES = [
  { id: 'arriendo',        label: 'Arriendo / Hipoteca',    icon: 'housing',   color: '#3b82f6' },
  { id: 'administracion',  label: 'Administración',         icon: 'building',  color: '#0284c7' },
  { id: 'servicios',       label: 'Servicios públicos',     icon: 'services',  color: '#f59e0b' },
  { id: 'comunicaciones',  label: 'Internet y telefonía',   icon: 'wifi',      color: '#14b8a6' },
  { id: 'suscripciones',   label: 'Suscripciones y apps',   icon: 'repeat',    color: '#6366f1' },
  { id: 'seguros',         label: 'Seguros y previsión',    icon: 'shield',    color: '#0d9488' },
  { id: 'salud',           label: 'Salud',                  icon: 'health',    color: '#ec4899' },
  { id: 'educacion',       label: 'Educación',              icon: 'edu',       color: '#22c55e' },
  { id: 'transporte',      label: 'Transporte',             icon: 'transport', color: '#06b6d4' },
  { id: 'entretenimiento', label: 'Entretenimiento',        icon: 'fun',       color: '#a855f7' },
  { id: 'hogar',           label: 'Hogar y mantenimiento',  icon: 'sofa',      color: '#d97706' },
  { id: 'mascotas',        label: 'Mascotas',               icon: 'pets',      color: '#fb923c' },
  { id: 'impuestos',       label: 'Impuestos',              icon: 'receipt',   color: '#94a3b8' },
  { id: 'ahorro',          label: 'Ahorro',                 icon: 'savings',   color: '#76c893' },
  { id: 'deuda',           label: 'Deuda / Crédito',        icon: 'debt',      color: '#ef4444' },
  { id: 'otro',            label: 'Otro',                   icon: 'other',     color: '#6b7280' },
] as const;

/** Gastos compartidos de un hogar. */
export const HOUSEHOLD_DEBT_CATEGORIES = [
  { id: 'alimentacion',    label: 'Comidas y restaurantes', icon: 'food',      color: '#f97316' },
  { id: 'mercado',         label: 'Mercado',                icon: 'market',    color: '#52b69a' },
  { id: 'hogar',           label: 'Hogar y muebles',        icon: 'sofa',      color: '#d97706' },
  { id: 'servicios',       label: 'Servicios públicos',     icon: 'services',  color: '#f59e0b' },
  { id: 'transporte',      label: 'Transporte',             icon: 'transport', color: '#3b82f6' },
  { id: 'salud',           label: 'Salud',                  icon: 'health',    color: '#ec4899' },
  { id: 'mascotas',        label: 'Mascotas',               icon: 'pets',      color: '#fb923c' },
  { id: 'ropa',            label: 'Ropa y calzado',         icon: 'clothes',   color: '#8b5cf6' },
  { id: 'tecnologia',      label: 'Tecnología y electrónica', icon: 'laptop',  color: '#38bdf8' },
  { id: 'entretenimiento', label: 'Entretenimiento',        icon: 'fun',       color: '#a855f7' },
  { id: 'videojuegos',     label: 'Videojuegos',            icon: 'gamepad',   color: '#7c3aed' },
  { id: 'educacion',       label: 'Educación',              icon: 'edu',       color: '#22c55e' },
  { id: 'otro',            label: 'Otro',                   icon: 'other',     color: '#6b7280' },
] as const;

export type PersonalCategoryId    = typeof PERSONAL_CATEGORIES[number]['id'];
export type FixedCategoryId       = typeof FIXED_EXPENSE_CATEGORIES[number]['id'];
export type HouseholdDebtCatId    = typeof HOUSEHOLD_DEBT_CATEGORIES[number]['id'];
