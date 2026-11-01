import { AlertTriangle, Banknote, CalendarCheck, CheckCircle2, Home, Info, Receipt, ShieldAlert, type LucideIcon } from 'lucide-react'
import type { NotificationSeverity, NotificationZone } from '@/shared/types/notification'

export const ZONE_LABEL: Record<NotificationZone, string> = {
  sueldo: 'Sueldo',
  fijos: 'Fijos',
  gastos: 'Gastos adicionales',
  hogar: 'Hogar',
}

export const ZONE_ICON: Record<NotificationZone, LucideIcon> = {
  sueldo: Banknote,
  fijos: CalendarCheck,
  gastos: Receipt,
  hogar: Home,
}

export const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  critical: 'Urgente',
  warning: 'Atención',
  info: 'Información',
  success: 'Buena noticia',
}

export const SEVERITY_ICON: Record<NotificationSeverity, LucideIcon> = {
  critical: ShieldAlert,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
}

// Severity is never color-only: it also has an icon and a text label (SEVERITY_LABEL)
export const SEVERITY_STYLE: Record<NotificationSeverity, { border: string; icon: string; chip: string }> = {
  critical: { border: 'border-l-red-400', icon: 'text-red-300 bg-red-500/15 border-red-500/40', chip: 'text-red-300' },
  warning: { border: 'border-l-amber-400', icon: 'text-amber-300 bg-amber-500/15 border-amber-500/40', chip: 'text-amber-300' },
  info: { border: 'border-l-sky-400', icon: 'text-sky-300 bg-sky-500/15 border-sky-500/40', chip: 'text-sky-300' },
  success: { border: 'border-l-brand-400', icon: 'text-brand-300 bg-brand-500/15 border-brand-500/40', chip: 'text-brand-300' },
}

/** Spanish relative time: "hace 2 h", "ayer", "hace 3 d". Future dates read as "ahora". */
export function relativeTime(date: Date, now = Date.now()): string {
  const diff = Math.max(0, now - date.getTime())
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ayer'
  if (d < 30) return `hace ${d} d`
  const mo = Math.floor(d / 30)
  return mo < 12 ? `hace ${mo} mes${mo > 1 ? 'es' : ''}` : `hace ${Math.floor(mo / 12)} a`
}

export type DateGroup = 'Hoy' | 'Esta semana' | 'Antes'

export function dateGroup(date: Date, now = new Date()): DateGroup {
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = date.getTime()
  if (t >= startToday) return 'Hoy'
  if (t >= startToday - 6 * 86400000) return 'Esta semana'
  return 'Antes'
}
