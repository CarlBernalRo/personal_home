import type { DebtLine } from '../types/variableBudget'
import { householdDebtsWithCredit } from './householdAbono'
import { debtLines } from './householdOwed'
import { buildHouseholdReport, toDate, type FrozenPlan, type Rec } from './householdReport'

/** Someone who still has to pay the user in a household. */
export interface HouseholdReceivable {
  householdId: string
  from: string
  name: string
  amount: number
}

export interface HouseholdStanding {
  householdId: string
  /** What the user still has to pay in this household (their payments in the plan). */
  owes: number
  /** What the others still have to pay the user. */
  owedToMe: number
  /** The household pays only by the plan (its accounts were crossed). */
  crossed: boolean
  /** Who still has to pay the user, and how much (from the household report). */
  receivables: HouseholdReceivable[]
  /** What the user has to pay, one by one: plan payments when crossed, their open debts otherwise. */
  lines: DebtLine[]
}

const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime()

/**
 * Where the user stands in one household, from the household engine, so the dashboard, Fijos, the household screen and
 * the Telegram bot never say different things. With `asOf`, only the records that exist by the end of that day count.
 */
export function householdStanding(
  household: Rec,
  expenses: Rec[],
  debts: Rec[],
  uid: string,
  asOf?: Date,
): HouseholdStanding {
  const householdId = household.id as string
  const limit = asOf ? endOfDay(asOf) : Infinity
  const exp = asOf ? expenses.filter((e) => toDate(e.date).getTime() <= limit) : expenses
  const members = (household.members as string[] | undefined) ?? []
  const dbt = householdDebtsWithCredit(asOf ? debts.filter((d) => toDate(d.date).getTime() <= limit) : debts, members)
  const memberNames = (household.memberNames as Record<string, string> | undefined) ?? {}
  const nameOf = (u?: string | null) => (u && memberNames[u]?.split(' ')[0]) || 'Integrante'
  const frozen = (household.settlementPlan as FrozenPlan | undefined) ?? null
  const crossed = !!frozen || household.payMode === 'plan'
  // before the plan was shared, the plan didn't exist yet
  const frozenPlan = frozen && frozen.atMs <= limit ? frozen : null

  const report = buildHouseholdReport({
    name: (household.name as string) ?? '',
    members,
    guestIds: (household.guestIds as string[] | undefined) ?? [],
    nameOf,
    expenses: exp,
    debts: dbt,
    frozenPlan,
  })
  const me = report.people.find((p) => p.uid === uid)
  const owes = Math.round(me?.pays.reduce((s, p) => s + p.amount, 0) ?? 0)
  const owedToMe = Math.round(me?.receives.reduce((s, p) => s + p.amount, 0) ?? 0)

  const lines: DebtLine[] = crossed
    ? (me?.pays ?? []).map((p) => ({
        id: `plan|${householdId}|${p.to}`,
        concept: `Pago a ${p.name} (plan del hogar)`,
        householdId,
        date: frozen ? new Date(frozen.atMs) : new Date(),
        dueDate: null,
        remaining: Math.round(p.amount),
      }))
    // paying debt by debt: the user's open debts, never for more than they really owe overall
    : debtLines(dbt as any[], uid, householdId, owes)

  const receivables: HouseholdReceivable[] = (me?.receives ?? [])
    .map((r) => ({ householdId, from: r.from, name: r.name, amount: Math.round(r.amount) }))
    .filter((r) => r.amount > 0)

  return { householdId, owes, owedToMe, crossed, lines, receivables }
}
