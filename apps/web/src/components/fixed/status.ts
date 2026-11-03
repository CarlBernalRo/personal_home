import type { FixedStatus, MonthEntry } from '@/shared'

/** 'arrears' is a display-only state: the entry also carries unpaid amounts from earlier months. */
export type StatusKey = FixedStatus | 'arrears' | 'auto'

export const STATUS_META: Record<StatusKey, { label: string; chip: string; cell: string; dot: string; border: string; hover: string }> = {
  paid:       { label: 'Pagado',    chip: 'bg-brand-500/20 text-brand-300 border-brand-500/40',  cell: 'bg-brand-500/70',   dot: '#52b69a', border: 'border-brand-500/40', hover: 'hover:border-brand-400/80' },
  overdue:    { label: 'Vencido',   chip: 'bg-red-500/20 text-red-300 border-red-500/40',        cell: 'bg-red-500/70',     dot: '#ef4444', border: 'border-red-500/40', hover: 'hover:border-red-400/80' },
  'due-soon': { label: 'Por vencer', chip: 'bg-amber-500/20 text-amber-300 border-amber-500/40', cell: 'bg-amber-500/70',   dot: '#f59e0b', border: 'border-amber-500/40', hover: 'hover:border-amber-400/80' },
  // indigo, not sky blue: "pagado automáticamente" is cyan and the two must not be mistaken for each other
  pending:    { label: 'Pendiente', chip: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/35', cell: 'bg-indigo-500/45', dot: '#818cf8', border: 'border-indigo-500/35', hover: 'hover:border-indigo-400/80' },
  // an overdue payment that also carries unpaid earlier months: same red as any overdue one
  arrears:    { label: 'Con atraso', chip: 'bg-red-500/20 text-red-300 border-red-500/40',        cell: 'bg-red-500/70',     dot: '#ef4444', border: 'border-red-500/40', hover: 'hover:border-red-400/80' },
  auto:       { label: 'Pagado automáticamente', chip: 'bg-cyan-500/15 text-cyan-200 border-cyan-500/40', cell: 'bg-cyan-500/60', dot: '#22d3ee', border: 'border-cyan-500/40', hover: 'hover:border-cyan-400/80' },
  upcoming:   { label: 'Próximo',   chip: 'bg-white/5 text-[#9aa4ac] border-white/10',           cell: 'bg-white/10',       dot: '#6b7280', border: 'border-white/10', hover: 'hover:border-white/40' },
  na:         { label: '—',         chip: 'bg-transparent text-[#5f6a72] border-white/5',        cell: 'bg-transparent',    dot: '#374151', border: 'border-white/5', hover: 'hover:border-white/20' },
}

/** State an entry is shown with, in the timeline, the calendar and the progress bar alike. */
export const entryStatusKey = (e: MonthEntry<any>): StatusKey =>
  e.arrears.length > 0 ? 'arrears' : e.payment?.auto && e.owed.length === 0 ? 'auto' : e.status

/**
 * Account of an entry: the one a paid payment came out of, or (while unpaid) the one the expense is set to be
 * paid from. A payment registered without an account has none: it does not borrow the expense's.
 */
export const entryAccountId = (e: MonthEntry<any>): string | undefined =>
  e.payment ? ((e.payment as any).accountId as string | undefined) : (e.fe.accountId as string | undefined)

/** The states the progress bar counts (and filters by): "con atraso" counts as overdue. */
export const statusGroup = (key: StatusKey): StatusKey => (key === 'arrears' ? 'overdue' : key)

/** Order the progress bar lists them in, from settled to far away. */
export const PROGRESS_STATES: StatusKey[] = ['paid', 'auto', 'overdue', 'due-soon', 'pending', 'upcoming']

/**
 * Day an entry is drawn on: the day it was paid once it is paid, otherwise its due date. A payment made
 * early (the 28th for a bill due on the 1st) shows on the 28th, with the due date kept as a note.
 */
export function entryDisplayDate(e: MonthEntry<any>): Date | null {
  if (e.owed.length === 0 && e.payment?.paymentDate) {
    const d = e.payment.paymentDate instanceof Date ? e.payment.paymentDate : new Date(e.payment.paymentDate)
    if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate())
  }
  return e.due
}

/** True when the payment was made on a different day than its due date. */
export const paidOffDue = (e: MonthEntry<any>): boolean => {
  const shown = entryDisplayDate(e)
  return !!(shown && e.due && e.owed.length === 0 && shown.toDateString() !== e.due.toDateString())
}
