import { creditorOf } from './householdCreditors';
import { inPaymentOrder } from './householdSettlement';

/**
 * THE household engine. Every figure about who owes whom comes from here, whatever the screen, the bot or the alert.
 *
 * Facts, as stored in `householdDebts`:
 * - a `Deuda` says "debtor owes creditor `amount`" — born from a shared expense (one row per settled edge), a loan
 *   installment, or anything else registered;
 * - an `Abono` says "debtor handed creditor `amount`" — real money that moved, whatever debt it was tied to (or none).
 * Crossings move no money: they only say two debts compensate each other, so they never change anyone's balance.
 *
 * Each person's position is `owed to them − what they owe + what they paid − what they received`: below zero they still
 * have to pay that much, above zero they are owed that much. Positions always add up to zero.
 *
 * Each debt's coverage follows from its debtor's position, so it never depends on HOW people paid (debt by debt, by the
 * plan, more than owed, to someone else): if the debtor is even or owed, all their debts are covered (what they owe is
 * compensated by what is owed to them); if they still owe X, X stays open on their debts — crossings and abonos tied to a
 * debt cover that debt first, the rest is covered oldest-first. The open part of every debt adds up to what is owed.
 */

type Rec = Record<string, any>;

export interface PersonBalance {
  uid: string;
  /** Every registered debt where this person is the creditor (their share of expenses others owe them, loans they gave…). */
  owedToThem: number;
  /** Every registered debt where this person is the debtor. */
  owes: number;
  /** Money this person handed to others. */
  paid: number;
  /** Money others handed to this person. */
  received: number;
  /** owedToThem − owes + paid − received. < 0: still has to pay that much · > 0: is owed that much. */
  position: number;
  /** Received more than they were owed: money to give back on top of every debt of theirs. */
  owesBack: number;
}

export interface DebtCoverage {
  /** Covered by a crossing against a debt of the other person. */
  crossed: number;
  /** Covered by abonos tied to this debt. */
  abonado: number;
  /** Covered because the debtor's overall position already pays it (what others owe them, or payments not tied to it). */
  netted: number;
  remaining: number;
}

export interface Inconsistency {
  kind: 'unknown-counterpart';
  id: string;
  amount: number;
}

/** A debt row as the screens read it once the engine ran: `remaining` is what is still open on it. */
export type CoveredDebt<T> = T & {
  remaining: number;
  coverage: DebtCoverage;
  /** What was paid on it: tied abonos + what the debtor's position covers (kept for the screens that split it). */
  paidAbono: number;
  /** The part of `paidAbono` that comes from compensation, not from abonos tied to this debt. */
  creditApplied: number;
};

export interface HouseholdBalances<T extends Rec> {
  people: Map<string, PersonBalance>;
  /** Every row given, with the debts annotated. Abonos are returned untouched. */
  rows: (T | CoveredDebt<T>)[];
  /** Sum of every debt ever registered. */
  total: number;
  /** What of it is still open (= what still has to be paid, debt by debt). */
  remaining: number;
  /** Records whose counterpart cannot be told (old rows without creditor in a household of more than two). */
  unmatched: Inconsistency[];
}

/**
 * A record closed by the old period close (every row marked `cruzado` with no crossing behind it): it was declared
 * settled as a whole, so it no longer counts on either side. A debt crossed by a real crossing carries `crossedAmount`.
 */
export const isLegacyClosed = (r: Rec): boolean =>
  r.cruzado === true && (r.tipo === 'Abono' || ((r.crossedAmount as number) || 0) < (r.amount as number));

const blank = (uid: string): PersonBalance => ({ uid, owedToThem: 0, owes: 0, paid: 0, received: 0, position: 0, owesBack: 0 });

export function householdBalances<T extends Rec>(rows: T[], members: string[]): HouseholdBalances<T> {
  const people = new Map<string, PersonBalance>(members.map((m) => [m, blank(m)]));
  const person = (uid: string) => {
    let p = people.get(uid);
    if (!p) { p = blank(uid); people.set(uid, p); }
    return p;
  };
  const unmatched: Inconsistency[] = [];
  const tied = new Map<string, number>();
  const debtsOf = new Map<string, T[]>();

  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    if (amount <= 0 || isLegacyClosed(r) || !r.debtor) continue;
    const other = creditorOf(r as any, members);
    if (r.tipo === 'Abono') {
      if (other === r.debtor) continue;
      person(r.debtor).paid += amount;
      if (other) person(other).received += amount;
      else unmatched.push({ kind: 'unknown-counterpart', id: r.id, amount });
      if (r.saldaId) tied.set(r.saldaId, (tied.get(r.saldaId) ?? 0) + amount);
    } else if (r.tipo === 'Deuda') {
      if (other === r.debtor) continue;
      person(r.debtor).owes += amount;
      if (other) person(other).owedToThem += amount;
      else unmatched.push({ kind: 'unknown-counterpart', id: r.id, amount });
      debtsOf.set(r.debtor, [...(debtsOf.get(r.debtor) ?? []), r]);
    }
  }

  for (const p of people.values()) {
    p.position = Math.round(p.owedToThem - p.owes + p.paid - p.received);
    p.owesBack = Math.max(0, -p.position - p.owes);
  }

  const coverage = new Map<string, DebtCoverage>();
  for (const [uid, list] of debtsOf) {
    const p = people.get(uid)!;
    const outstanding = Math.max(0, -p.position);
    let left = Math.max(0, p.owes - outstanding);
    const ordered = inPaymentOrder(list);
    const cov = new Map<string, DebtCoverage>(ordered.map((d) => [d.id, { crossed: 0, abonado: 0, netted: 0, remaining: 0 }]));
    const take = (want: number) => { const t = Math.max(0, Math.min(want, left)); left -= t; return t; };
    for (const d of ordered) cov.get(d.id)!.crossed = take(Math.min(Number(d.crossedAmount) || 0, Number(d.amount)));
    for (const d of ordered) { const c = cov.get(d.id)!; c.abonado = take(Math.min(tied.get(d.id) ?? 0, Number(d.amount) - c.crossed)); }
    for (const d of ordered) { const c = cov.get(d.id)!; c.netted = take(Number(d.amount) - c.crossed - c.abonado); }
    for (const d of ordered) { const c = cov.get(d.id)!; c.remaining = Number(d.amount) - c.crossed - c.abonado - c.netted; coverage.set(d.id, c); }
  }

  let total = 0;
  let remaining = 0;
  const out = rows.map((r) => {
    if (r.tipo !== 'Deuda') return r;
    const amount = Number(r.amount) || 0;
    total += amount;
    // closed by the old period close, owed to oneself or with no amount: nothing is open on it
    const c = coverage.get(r.id) ?? { crossed: amount, abonado: 0, netted: 0, remaining: 0 };
    remaining += c.remaining;
    return { ...r, remaining: c.remaining, coverage: c, paidAbono: c.abonado + c.netted, creditApplied: c.netted } as CoveredDebt<T>;
  });

  return { people, rows: out, total, remaining, unmatched };
}
