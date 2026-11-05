import type { AppNotification } from '../types/notification';
import type { DebtLine, VariableBudget, VariableSpend } from '../types/variableBudget';
import { effectiveDue, type MonthEntry } from './fixedExpenses';
import type { PayDate, PeriodLedger } from './paySchedule';

const DAY_MS = 86_400_000;
/** Payments due within this many days count as coming up. */
const SOON_DAYS = 3;
/** Overdue bills are told on days 1, 3, 5, 7 and 9 late (stages 0 to 4); after that no more. */
const OVERDUE_LAST_STAGE = 4;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

/** "hoy", "mañana", "en 3 días" or "hace 2 días". */
export function relativeDay(date: Date, today: Date): string {
  const diff = Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / DAY_MS);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff > 1) return `en ${diff} días`;
  return diff === -1 ? 'ayer' : `hace ${-diff} días`;
}

export interface AlertInput {
  today: Date;
  /** The salary period running now (alerts about spending refer to it). */
  period: { start: Date; end: Date } | null;
  /** Fixed expenses falling in that period. */
  entries: MonthEntry<any>[];
  /** A pay day that arrived and hasn't been confirmed yet. */
  pending: PayDate | null;
  ledger: PeriodLedger | null;
  budgets: VariableBudget[];
  spends: VariableSpend[];
  /** What the user still owes in their households, one debt at a time. */
  householdLines: DebtLine[];
  householdNames: Record<string, string>;
  /** Movements prepared in Telegram that still wait for the person to confirm them. */
  pendingMovements?: number;
}

/**
 * Alerts that come from the user's own data (nothing is stored): they appear while the situation holds
 * and go away when it is solved. Their keys name what they are about, so dismissing one stays dismissed
 * until the situation changes.
 */
export function deriveAlerts(i: AlertInput): AppNotification[] {
  const out: AppNotification[] = [];
  const { today, period } = i;
  const periodKey = period ? period.start.getTime() : 0;
  const add = (a: Omit<AppNotification, 'source' | 'read' | 'createdAt'>) => out.push({ ...a, source: 'derived', read: false, createdAt: today });

  if (i.pending) {
    add({
      key: `pay|${i.pending.date.getTime()}`, zone: 'sueldo', severity: 'info',
      title: relativeDay(i.pending.date, today) === 'hoy' ? 'Hoy es día de pago' : 'Tienes un pago por confirmar',
      body: relativeDay(i.pending.date, today) === 'hoy'
        ? `Confirma tu sueldo de ${cop(i.pending.amount)} para actualizar lo que te queda.`
        : `Tu pago de ${cop(i.pending.amount)} del ${i.pending.date.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })} aún no está confirmado.`,
      link: '/',
    });
  }

  if (i.ledger && i.ledger.remaining < 0) {
    add({
      key: `over|${periodKey}`, zone: 'sueldo', severity: 'critical',
      title: 'Tus gastos superan tus ingresos',
      body: `Te pasas por ${cop(-i.ledger.remaining)} en este período de sueldo.`,
      link: '/fijos',
    });
  }

  if ((i.pendingMovements ?? 0) > 0) {
    const n = i.pendingMovements!;
    add({
      // the count is in the key: a new pending movement is a new alert even if the previous one was dismissed
      key: `pendmov|${n}`, zone: 'gastos', severity: 'info',
      title: n === 1 ? 'Tienes 1 movimiento de Telegram por confirmar' : `Tienes ${n} movimientos de Telegram por confirmar`,
      body: 'Los preparaste desde Telegram: confírmalos para que se registren en tus cuentas y gastos.',
      link: '/pendientes',
    });
  }

  // Fixed expenses. Each bill is told in stages, so a notice is not repeated until the situation moves on:
  //  · coming up (1 to 3 days left): one notice;  · due today: one notice;
  //  · overdue: one notice the day after, then one every two days (days 1, 3, 5, 7, 9), and no more after 10 days.
  const owed = i.entries.filter((e) => e.owed.length > 0);
  for (const e of owed) {
    const idKey = `${e.fe.id}|${e.hostMonth}`;
    // how long the oldest unpaid month has been overdue
    const oldest = e.owed[0];
    const oldestDue = oldest ? effectiveDue(e.fe, oldest.occMonth) : e.due;
    const late = oldestDue ? Math.round((startOfDay(today).getTime() - startOfDay(oldestDue).getTime()) / DAY_MS) : 0;

    if (late >= 1 && (e.arrears.length > 0 || e.status === 'overdue')) {
      const stage = Math.min(OVERDUE_LAST_STAGE, Math.floor((late - 1) / 2));
      const months = e.owed.length > 1 ? ` · ${e.owed.length} meses atrasados` : '';
      add({
        key: `fx-overdue|${e.fe.id}:${e.hostMonth}|${stage}`, zone: 'fijos', severity: 'critical',
        title: `${e.fe.concept as string} lleva ${late} ${late === 1 ? 'día' : 'días'} vencido`,
        body: `${cop(e.total)} por pagar${months}.`,
        link: '/fijos',
      });
      continue;
    }
    if (e.status === 'due-soon' && e.arrears.length === 0 && e.due) {
      const left = Math.round((startOfDay(e.due).getTime() - startOfDay(today).getTime()) / DAY_MS);
      add({
        key: `${left <= 0 ? 'fx-today' : 'fx-soon'}|${idKey}`, zone: 'fijos', severity: 'warning',
        title: `${e.fe.concept as string} vence ${relativeDay(e.due, today)}`,
        body: `${cop(e.total)} · ${(e.fe.autoDebit ?? []).length > 0 ? 'se debita automáticamente si tienes el saldo' : 'recuerda pagarlo'}.`,
        link: '/fijos',
      });
    }
  }

  // Occasional expenses that already spent more than their estimate
  if (period) {
    for (const b of i.budgets.filter((x) => x.active && x.source !== 'household-debt' && x.amount > 0)) {
      const spent = i.spends
        .filter((s) => s.budgetId === b.id && s.date.getTime() >= period.start.getTime() && s.date.getTime() < period.end.getTime())
        .reduce((sum, s) => sum + s.amount, 0);
      if (spent > b.amount) {
        add({
          key: `vb|${b.id}|${periodKey}`, zone: 'gastos', severity: 'warning',
          title: `${b.concept} superó su estimado`,
          body: `Llevas ${cop(spent)} de ${cop(b.amount)} estimados este período.`,
          link: '/fijos?tab=config',
        });
      }
    }
  }

  // Household debts with an agreed date
  for (const l of i.householdLines.filter((x) => x.dueDate)) {
    const days = Math.round((startOfDay(l.dueDate!).getTime() - startOfDay(today).getTime()) / DAY_MS);
    if (days > SOON_DAYS) continue;
    const hh = i.householdNames[l.householdId] ?? 'tu hogar';
    add({
      key: `hh|${l.id}`, zone: 'hogar', severity: days < 0 ? 'critical' : 'warning',
      title: days < 0 ? `Deuda vencida en ${hh}` : `Una deuda en ${hh} vence ${relativeDay(l.dueDate!, today)}`,
      body: `${l.concept || 'Deuda'} · ${cop(l.remaining)}.`,
      link: `/hogar?id=${l.householdId}`,
    });
  }

  const rank = { critical: 0, warning: 1, info: 2, success: 3 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
