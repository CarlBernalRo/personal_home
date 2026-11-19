/**
 * A reminder: something to do on a date, without money (deworm the cats, renew the license...). It can repeat every
 * few months and be shared with family members, who see it too and can mark it done.
 */
export interface Reminder {
  id: string;
  userId: string;
  /** Shown to the family members it is shared with. */
  ownerName: string;
  ownerPhoto: string | null;
  title: string;
  notes?: string;
  /** First date, `yyyy-MM-dd` (a calendar day, no time zone). */
  date: string;
  /** Repeats every this many months; 0 = only once. */
  every: number;
  /** Family members who see it. */
  sharedWith: string[];
  /** Occurrences already done, by their date: who marked it and when (ISO). */
  done: Record<string, { by: string; name: string; at: string }>;
  createdAt?: Date;
}

export const REMINDER_REPEATS: { value: number; label: string }[] = [
  { value: 0, label: 'No se repite' },
  { value: 1, label: 'Cada mes' },
  { value: 2, label: 'Cada 2 meses' },
  { value: 3, label: 'Cada 3 meses' },
  { value: 6, label: 'Cada 6 meses' },
  { value: 12, label: 'Cada año' },
];

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromDayKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** The `n`-th occurrence: the first date moved `n * every` months, on the same day (or the month's last day). */
function nth(first: Date, every: number, n: number): Date {
  const y = first.getFullYear();
  const m = first.getMonth() + n * every;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(first.getDate(), last));
}

/** The reminder's dates from `start` (inclusive) to `end` (exclusive), as `yyyy-MM-dd`. */
export function reminderDates(r: Pick<Reminder, 'date' | 'every'>, start: Date, end: Date): string[] {
  const first = fromDayKey(r.date);
  if (!r.every) return first >= start && first < end ? [r.date] : [];
  const out: string[] = [];
  // jump close to `start` instead of walking from the first date
  const monthsBefore = (start.getFullYear() - first.getFullYear()) * 12 + start.getMonth() - first.getMonth();
  let n = Math.max(0, Math.floor(monthsBefore / r.every) - 1);
  for (let guard = 0; guard < 500; guard++, n++) {
    const d = nth(first, r.every, n);
    if (d >= end) break;
    if (d >= start) out.push(dayKey(d));
  }
  return out;
}

/** The next date that is not done yet, from `today` on (or the pending one before it), or null. */
export function nextReminderDate(r: Pick<Reminder, 'date' | 'every' | 'done'>, today: Date): string | null {
  const from = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
  const to = new Date(today.getFullYear() + 2, today.getMonth(), today.getDate());
  return reminderDates(r, from, to).find((k) => !r.done?.[k] && fromDayKey(k) >= new Date(today.getFullYear(), today.getMonth(), today.getDate())) ?? null;
}
